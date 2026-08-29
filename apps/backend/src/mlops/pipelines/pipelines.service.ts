import { Injectable, Logger, MessageEvent } from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { AuthenticatedUser } from "../../auth/auth.types";
import { BusinessException } from "../../common/errors/business.exception";
import { MLOPS_ERROR } from "../mlops.errors";
import { KFPAdapter } from "./kfp.adapter";
import { CreateRunDto } from "./dto/create-run.dto";
import {
  PipelineRunDto,
  PipelineTemplateDto,
} from "./dto/pipeline-response.dto";

/**
 * Kubeflow Pipelines (KFP) 워크플로우 실행 및 모니터링 비즈니스 로직을 처리하는 서비스 클래스입니다.
 */
@Injectable()
export class PipelinesService {
  private readonly logger = new Logger(PipelinesService.name);

  constructor(private readonly kfpAdapter: KFPAdapter) {}

  /**
   * 사용자의 클러스터 접근 권한을 검증합니다.
   */
  private validateClusterAccess(
    clusterId: string,
    user: AuthenticatedUser,
  ): void {
    if (user.clusterIds && !user.clusterIds.includes(clusterId)) {
      throw new BusinessException(MLOPS_ERROR.CLUSTER_ACCESS_DENIED);
    }
  }

  /**
   * 등록된 KFP 파이프라인 템플릿 목록을 조회합니다.
   *
   * @param clusterId 조회 대상 클러스터 식별자
   * @param user 요청자 인증 컨텍스트
   * @returns 파이프라인 템플릿 목록
   * @throws {BusinessException} 클러스터 접근 권한 미보유 시 (MLOPS_CLUSTER_ACCESS_DENIED)
   */
  async getPipelineTemplates(
    clusterId: string,
    user: AuthenticatedUser,
  ): Promise<PipelineTemplateDto[]> {
    this.validateClusterAccess(clusterId, user);
    return this.kfpAdapter.listPipelineTemplates(clusterId);
  }

  /**
   * 파이프라인 실행(Run) 인스턴스를 제출(트리거)합니다.
   *
   * @param dto 파이프라인 트리거 요청 DTO
   * @param user 요청자 인증 컨텍스트
   * @returns 작성된 파이프라인 Run 응답
   * @throws {BusinessException} 클러스터 미배정 또는 트리거 실패 시
   */
  async createRun(
    dto: CreateRunDto,
    user: AuthenticatedUser,
  ): Promise<PipelineRunDto> {
    this.validateClusterAccess(dto.clusterId, user);

    try {
      this.logger.log(
        `Triggering pipeline run '${dto.runName}' by user '${user.email}'`,
      );
      return await this.kfpAdapter.createPipelineRun(dto);
    } catch (error) {
      this.logger.error(`Failed to trigger pipeline run: ${String(error)}`);
      throw new BusinessException(MLOPS_ERROR.PIPELINE_RUN_FAILED);
    }
  }

  /**
   * 지정된 클러스터/네임스페이스의 파이프라인 Run 목록을 조회합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param user 요청자 인증 컨텍스트
   * @returns 파이프라인 Run 목록
   */
  async getRuns(
    clusterId: string,
    namespace: string,
    user: AuthenticatedUser,
  ): Promise<PipelineRunDto[]> {
    this.validateClusterAccess(clusterId, user);
    return this.kfpAdapter.listPipelineRuns(clusterId, namespace);
  }

  /**
   * 단일 파이프라인 Run 상세 정보를 조회합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param runId 파이프라인 Run ID
   * @param user 요청자 인증 컨텍스트
   * @returns 파이프라인 Run 상세 객체
   */
  async getRunDetail(
    clusterId: string,
    namespace: string,
    runId: string,
    user: AuthenticatedUser,
  ): Promise<PipelineRunDto> {
    this.validateClusterAccess(clusterId, user);

    const run = await this.kfpAdapter.getPipelineRun(
      clusterId,
      namespace,
      runId,
    );
    if (!run) {
      throw new BusinessException(MLOPS_ERROR.PIPELINE_RUN_FAILED);
    }
    return run;
  }

  /**
   * 특정 파이프라인 스텝 Pod의 컨테이너 실행 로그를 조회합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param podName 대상 Pod 명칭
   * @param containerName 컨테이너 명칭 (옵션)
   * @param tailLines 출력 라인 수
   * @param user 요청자 인증 컨텍스트
   * @returns 텍스트 형태 로그
   */
  async getPodLogs(
    clusterId: string,
    namespace: string,
    podName: string,
    containerName: string | undefined,
    tailLines: number,
    user: AuthenticatedUser,
  ): Promise<string> {
    this.validateClusterAccess(clusterId, user);
    return this.kfpAdapter.getPodLogs(
      clusterId,
      namespace,
      podName,
      containerName,
      tailLines,
    );
  }

  /**
   * 클러스터 및 네임스페이스 내 KFP 파이프라인/Workflow 실시간 SSE 상태 변경 이벤트를 구독합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param user 요청자 인증 컨텍스트
   * @returns SSE MessageEvent Observable 스트림
   * @throws {BusinessException} 클러스터 접근 권한 미보유 시
   */
  subscribeEvents(
    clusterId: string,
    namespace: string,
    user: AuthenticatedUser,
  ): Observable<MessageEvent> {
    this.validateClusterAccess(clusterId, user);
    return this.kfpAdapter.watchWorkflowEvents(clusterId, namespace).pipe(
      map(
        (item) =>
          ({
            type: item.event,
            data: JSON.stringify(item.data),
          }) as MessageEvent,
      ),
    );
  }

  /**
   * 파이프라인 execution step Pod의 실시간 로그 스트림 SSE 이벤트를 구독합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param runId 파이프라인 Run 식별자
   * @param podName Pod 이름
   * @param containerName 컨테이너 이름 (옵션)
   * @param user 요청자 인증 컨텍스트
   * @returns SSE MessageEvent Observable 스트림
   * @throws {BusinessException} 클러스터 접근 권한 미보유 시
   */
  streamLogs(
    clusterId: string,
    namespace: string,
    runId: string,
    podName: string,
    containerName: string | undefined,
    user: AuthenticatedUser,
  ): Observable<MessageEvent> {
    void runId;
    this.validateClusterAccess(clusterId, user);
    return this.kfpAdapter
      .streamPodLogs(clusterId, namespace, podName, containerName)
      .pipe(
        map(
          (item) =>
            ({
              type: item.event,
              data: JSON.stringify(item.data),
            }) as MessageEvent,
        ),
      );
  }
}
