import {
  CoordinationV1Api,
  KubeConfig,
  V1Lease,
} from "@kubernetes/client-node";
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { v4 as uuidv4 } from "uuid";
import { ClusterProvider } from "../cluster-provider";

export const COORDINATION_V1_API = "COORDINATION_V1_API";

/**
 * Kubernetes coordination.k8s.io/v1 Lease API 기반 분산 리더 선출(Leader Election) 서비스
 *
 * 백엔드 Pod가 수평 확장(Replicas >= 2)되었을 때 오직 선출된 단 1개의 리더 Pod만
 * K8s Watcher/Informer를 가동하여 API Server 부하와 DB Row Lock 경합을 방지합니다.
 */
@Injectable()
export class K8sLeaderElectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(K8sLeaderElectorService.name);

  private readonly leaseNamespace: string;
  private readonly leaseName = "kyverno-platform-watcher-lease";
  private readonly holderIdentity: string;
  private readonly leaseDurationSeconds = 15;
  private readonly renewIntervalMs = 2000;
  private readonly retryIntervalMs = 5000;

  private api: CoordinationV1Api | null = null;
  private isLeader = false;
  private lastRenewSuccessTime = 0;
  private running = false;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly acquiredCallbacks: Array<() => void> = [];
  private readonly lostCallbacks: Array<() => void> = [];

  constructor(
    @Optional() private readonly clusterProvider?: ClusterProvider,
    @Optional() private readonly configService?: ConfigService,
    @Optional()
    @Inject(COORDINATION_V1_API)
    injectedApi?: CoordinationV1Api,
  ) {
    this.leaseNamespace =
      this.configService?.get<string>("K8S_LEASE_NAMESPACE") ||
      process.env.K8S_LEASE_NAMESPACE ||
      "default";

    this.holderIdentity =
      process.env.POD_NAME || process.env.HOSTNAME || uuidv4();

    if (injectedApi) {
      this.api = injectedApi;
    } else {
      this.initApi();
    }
  }

  /**
   * 모듈 기동 시 백그라운드 리더 선출 루프를 시작합니다.
   */
  async onModuleInit(): Promise<void> {
    this.start();
  }

  /**
   * 모듈 종료 시 타이머를 해제하고 리더십을 즉시 정리합니다.
   */
  async onModuleDestroy(): Promise<void> {
    this.stop();
  }

  /**
   * 리더 선출 루프를 시작합니다.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.runElectionLoop();
  }

  /**
   * 리더 선출 루프를 중단하고 리더십을 상실 처리합니다.
   */
  stop(): void {
    this.running = false;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    this.lastRenewSuccessTime = 0;
    if (this.isLeader) {
      this.setLeader(false);
    }
  }

  /**
   * 현재 리더 상태 여부를 반환합니다.
   */
  isCurrentLeader(): boolean {
    return this.isLeader;
  }

  /**
   * 현재 인스턴스의 식별자를 반환합니다.
   */
  getHolderIdentity(): string {
    return this.holderIdentity;
  }

  /**
   * 리더십 획득 시 실행될 콜백을 등록합니다.
   *
   * @param callback 리더 획득 이벤트 핸들러
   * @returns 리스너 등록 해제 함수
   */
  onLeaderAcquired(callback: () => void): () => void {
    this.acquiredCallbacks.push(callback);
    // 이미 리더 상태일 경우 즉시 알림
    if (this.isLeader) {
      try {
        callback();
      } catch (err) {
        this.logger.error(
          "Error executing immediate onLeaderAcquired callback",
          err,
        );
      }
    }
    return () => {
      const idx = this.acquiredCallbacks.indexOf(callback);
      if (idx !== -1) {
        this.acquiredCallbacks.splice(idx, 1);
      }
    };
  }

  /**
   * 리더십 상실 시 실행될 콜백을 등록합니다.
   *
   * @param callback 리더 상실 이벤트 핸들러
   * @returns 리스너 등록 해제 함수
   */
  onLeaderLost(callback: () => void): () => void {
    this.lostCallbacks.push(callback);
    return () => {
      const idx = this.lostCallbacks.indexOf(callback);
      if (idx !== -1) {
        this.lostCallbacks.splice(idx, 1);
      }
    };
  }

  /**
   * 단일 주기 리더십 획득/갱신/승계를 시도합니다.
   *
   * @returns 리더십 유지 또는 획득 성공 여부
   */
  async tryAcquireOrRenew(): Promise<boolean> {
    if (!this.api) {
      this.logger.debug(
        "[LeaderElector] CoordinationV1Api not available. Maintaining standby.",
      );
      this.setLeader(false);
      return false;
    }

    if (
      this.isLeader &&
      Date.now() - this.lastRenewSuccessTime > this.leaseDurationSeconds * 1000
    ) {
      this.logger.warn(
        "[LeaderElector] Lease renewal timed out (> 15s). Self-demoting to standby.",
      );
      this.setLeader(false);
    }

    try {
      let existingLease: V1Lease | null = null;
      try {
        existingLease = await this.readLease();
      } catch (err: unknown) {
        if (this.isNotFoundError(err)) {
          // 1) Lease 객체가 존재하지 않음 -> 신규 생성하여 리더 획득 시도
          return await this.createNewLease();
        }
        this.logger.warn(
          `[LeaderElector] Failed to read lease ${this.leaseNamespace}/${this.leaseName}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        this.setLeader(false);
        return false;
      }

      if (!existingLease) {
        return await this.createNewLease();
      }

      const spec = existingLease.spec || {};
      const currentHolder = spec.holderIdentity;
      const renewTimeMs = spec.renewTime
        ? new Date(spec.renewTime).getTime()
        : 0;
      const durationSeconds =
        spec.leaseDurationSeconds ?? this.leaseDurationSeconds;
      const nowMs = Date.now();

      if (currentHolder === this.holderIdentity) {
        // 2) 내가 이미 리더인 경우 -> renewTime 갱신 (Heartbeat)
        return await this.renewExistingLease(existingLease);
      }

      // 3) 다른 Pod가 리더인 경우 -> 하트비트 만료 여부 판별
      const isExpired = renewTimeMs + durationSeconds * 1000 < nowMs;
      if (isExpired) {
        // 이전 리더 만료 -> 리더십 승계(Takeover) 시도
        return await this.takeOverLease(existingLease);
      }

      // 아직 유효한 다른 리더가 존재 -> Standby 유지
      this.setLeader(false);
      return false;
    } catch (err: unknown) {
      this.logger.warn(
        `[LeaderElector] Unexpected error during election: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (this.isConflictError(err)) {
        this.setLeader(false);
      }
      return false;
    }
  }

  /**
   * 백그라운드 선출 루프를 재귀 실행합니다.
   */
  private async runElectionLoop(): Promise<void> {
    if (!this.running) return;

    await this.tryAcquireOrRenew();

    if (!this.running) return;

    // 리더는 2초 간격 갱신, 스탠바이는 5초 간격으로 상태를 폴링
    const nextInterval = this.isLeader
      ? this.renewIntervalMs
      : this.retryIntervalMs;

    this.loopTimer = setTimeout(() => {
      void this.runElectionLoop();
    }, nextInterval);

    // Jest 및 테스트 환경에서 타이머로 인한 프로세스 행(Hang) 방지
    this.loopTimer?.unref?.();
  }

  /**
   * 리더 상태 전이를 반영하고 등록된 콜백을 실행합니다.
   */
  private setLeader(newLeaderState: boolean): void {
    if (this.isLeader === newLeaderState) return;

    this.isLeader = newLeaderState;

    if (newLeaderState) {
      this.logger.log(
        `[LeaderElector] Acquired leader lease (${this.holderIdentity}) on ${this.leaseNamespace}/${this.leaseName}`,
      );
      for (const cb of this.acquiredCallbacks) {
        try {
          cb();
        } catch (err) {
          this.logger.error(
            "[LeaderElector] Exception occurred in onLeaderAcquired callback",
            err,
          );
        }
      }
    } else {
      this.logger.warn(
        `[LeaderElector] Lost leader lease (${this.holderIdentity}) on ${this.leaseNamespace}/${this.leaseName}`,
      );
      for (const cb of this.lostCallbacks) {
        try {
          cb();
        } catch (err) {
          this.logger.error(
            "[LeaderElector] Exception occurred in onLeaderLost callback",
            err,
          );
        }
      }
    }
  }

  /**
   * Kubernetes MicroTime 스펙(6자리 마이크로초 .000000Z)과 호환되는 Date 객체를 생성합니다.
   */
  private toMicroTime(d: Date = new Date()): Date {
    const iso = d.toISOString().replace(/\.\d+Z$/, ".000000Z");
    const date = new Date(d);
    date.toISOString = () => iso;
    date.toJSON = () => iso;
    return date;
  }

  /**
   * 신규 Lease 객체를 생성하여 리더십을 획득합니다.
   */
  private async createNewLease(): Promise<boolean> {
    const newLease: V1Lease = {
      apiVersion: "coordination.k8s.io/v1",
      kind: "Lease",
      metadata: {
        name: this.leaseName,
        namespace: this.leaseNamespace,
      },
      spec: {
        holderIdentity: this.holderIdentity,
        leaseDurationSeconds: this.leaseDurationSeconds,
        acquireTime: this.toMicroTime(),
        renewTime: this.toMicroTime(),
        leaseTransitions: 0,
      },
    };

    try {
      await this.createLease(newLease);
      this.lastRenewSuccessTime = Date.now();
      this.setLeader(true);
      return true;
    } catch (err: unknown) {
      // 다른 Pod가 동시에 먼저 생성(409 Conflict)한 경우 정상 스탠바이 전환
      if (this.isConflictError(err)) {
        this.logger.debug(
          "[LeaderElector] Conflict while creating new lease. Another pod became leader.",
        );
      } else {
        this.logger.warn(
          `[LeaderElector] Failed to create lease: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      this.setLeader(false);
      return false;
    }
  }

  /**
   * 현재 리더로서 Lease 갱신(Heartbeat)을 수행합니다.
   */
  private async renewExistingLease(existingLease: V1Lease): Promise<boolean> {
    const updatedLease: V1Lease = {
      ...existingLease,
      spec: {
        ...existingLease.spec,
        renewTime: this.toMicroTime(),
      },
    };

    try {
      await this.replaceLease(updatedLease);
      this.lastRenewSuccessTime = Date.now();
      this.setLeader(true);
      return true;
    } catch (err: unknown) {
      if (this.isConflictError(err)) {
        // 낙관적 동시성 제어(OCC) 충돌 발생 시 리더십 즉시 상실
        this.logger.warn(
          "[LeaderElector] 409 Conflict occurred during lease renew. Relinquishing leadership.",
        );
        this.setLeader(false);
        return false;
      }

      this.logger.warn(
        `[LeaderElector] Transient error during lease renew: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // 일시적인 네트워크 오류 시에도 연속 장애 방지를 위해 상태 유지하되 실패 반환
      return false;
    }
  }

  /**
   * 만료된 Lease의 리더십을 승계(Takeover)합니다.
   */
  private async takeOverLease(existingLease: V1Lease): Promise<boolean> {
    const prevTransitions = existingLease.spec?.leaseTransitions || 0;
    const updatedLease: V1Lease = {
      ...existingLease,
      spec: {
        ...existingLease.spec,
        holderIdentity: this.holderIdentity,
        leaseDurationSeconds: this.leaseDurationSeconds,
        acquireTime: this.toMicroTime(),
        renewTime: this.toMicroTime(),
        leaseTransitions: prevTransitions + 1,
      },
    };

    try {
      await this.replaceLease(updatedLease);
      this.lastRenewSuccessTime = Date.now();
      this.setLeader(true);
      return true;
    } catch (err: unknown) {
      if (this.isConflictError(err)) {
        this.logger.debug(
          "[LeaderElector] Conflict during takeover. Another standby pod acquired leadership first.",
        );
      } else {
        this.logger.warn(
          `[LeaderElector] Failed to take over expired lease: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      this.setLeader(false);
      return false;
    }
  }

  /**
   * K8s API 호출 어댑터: Lease 조회
   */
  private async readLease(): Promise<V1Lease> {
    if (!this.api) throw new Error("CoordinationV1Api is null");
    // @kubernetes/client-node 1.4+ 객체 파라미터 우선 시도 후 구버전 mock 시그니처 호환
    const legacyApi = this.api as unknown as {
      readNamespacedLease: (...args: unknown[]) => Promise<unknown>;
    };
    try {
      const res = await this.api.readNamespacedLease({
        name: this.leaseName,
        namespace: this.leaseNamespace,
      });
      return this.unwrapResponse<V1Lease>(res);
    } catch (err) {
      if (
        err instanceof TypeError ||
        (err instanceof Error && err.message.includes("is not a function"))
      ) {
        const res = await legacyApi.readNamespacedLease(
          this.leaseName,
          this.leaseNamespace,
        );
        return this.unwrapResponse<V1Lease>(res);
      }
      throw err;
    }
  }

  /**
   * K8s API 호출 어댑터: Lease 생성
   */
  private async createLease(body: V1Lease): Promise<V1Lease> {
    if (!this.api) throw new Error("CoordinationV1Api is null");
    const legacyApi = this.api as unknown as {
      createNamespacedLease: (...args: unknown[]) => Promise<unknown>;
    };
    try {
      const res = await this.api.createNamespacedLease({
        namespace: this.leaseNamespace,
        body,
      });
      return this.unwrapResponse<V1Lease>(res);
    } catch (err) {
      if (
        err instanceof TypeError ||
        (err instanceof Error && err.message.includes("is not a function"))
      ) {
        const res = await legacyApi.createNamespacedLease(
          this.leaseNamespace,
          body,
        );
        return this.unwrapResponse<V1Lease>(res);
      }
      throw err;
    }
  }

  /**
   * K8s API 호출 어댑터: Lease 교체/갱신
   */
  private async replaceLease(body: V1Lease): Promise<V1Lease> {
    if (!this.api) throw new Error("CoordinationV1Api is null");
    const legacyApi = this.api as unknown as {
      replaceNamespacedLease: (...args: unknown[]) => Promise<unknown>;
    };
    try {
      const res = await this.api.replaceNamespacedLease({
        name: this.leaseName,
        namespace: this.leaseNamespace,
        body,
      });
      return this.unwrapResponse<V1Lease>(res);
    } catch (err) {
      if (
        err instanceof TypeError ||
        (err instanceof Error && err.message.includes("is not a function"))
      ) {
        const res = await legacyApi.replaceNamespacedLease(
          this.leaseName,
          this.leaseNamespace,
          body,
        );
        return this.unwrapResponse<V1Lease>(res);
      }
      throw err;
    }
  }

  /**
   * 응답 객체 정규화 헬퍼 ({ body: T } 또는 T 형태 지원)
   */
  private unwrapResponse<T>(res: unknown): T {
    if (
      res !== null &&
      typeof res === "object" &&
      "body" in res &&
      (res as { body: unknown }).body !== undefined
    ) {
      return (res as { body: T }).body;
    }
    return res as T;
  }

  /**
   * 404 Not Found 에러 여부를 판별합니다.
   */
  private isNotFoundError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const e = err as {
      statusCode?: number | string;
      status?: number | string;
      code?: number | string;
      response?: { statusCode?: number | string };
    };
    return (
      e.response?.statusCode === 404 ||
      e.statusCode === 404 ||
      e.status === 404 ||
      e.code === 404 ||
      e.code === "404"
    );
  }

  /**
   * 409 Conflict 에러 여부를 판별합니다.
   */
  private isConflictError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const e = err as {
      statusCode?: number | string;
      status?: number | string;
      code?: number | string;
      response?: { statusCode?: number | string };
    };
    return (
      e.response?.statusCode === 409 ||
      e.statusCode === 409 ||
      e.status === 409 ||
      e.code === 409 ||
      e.code === "409"
    );
  }

  /**
   * KubeConfig 또는 ClusterProvider를 통해 CoordinationV1Api를 초기화합니다.
   */
  private initApi(): void {
    try {
      let kubeConfig: KubeConfig;

      if (this.clusterProvider) {
        try {
          const defaultCluster = this.clusterProvider.getDefault();
          kubeConfig = this.clusterProvider.getKubeConfig(defaultCluster.id);
        } catch {
          kubeConfig = new KubeConfig();
          kubeConfig.loadFromDefault();
        }
      } else {
        kubeConfig = new KubeConfig();
        kubeConfig.loadFromDefault();
      }

      this.api = kubeConfig.makeApiClient(CoordinationV1Api);
    } catch (err) {
      this.logger.debug(
        `[LeaderElector] Failed to initialize CoordinationV1Api: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.api = null;
    }
  }
}
