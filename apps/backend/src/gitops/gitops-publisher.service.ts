import * as fs from "fs";
import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PolicyExceptionRequest } from "@prisma/client";
import { dumpYaml, loadYaml } from "@kubernetes/client-node";
import { buildPolicyExceptionManifest } from "../kubernetes/policy-exception-manifest";

export type PublishingMode = "DUAL_PATH" | "STRICT_GITOPS" | "RUNTIME_ONLY";

interface KustomizationManifest {
  apiVersion?: string;
  kind?: string;
  resources?: string[];
  [key: string]: unknown;
}

/**
 * PolicyExceptionRequest 객체를 kyverno.io/v2 PolicyException YAML 포맷으로 직렬화합니다.
 *
 * @param request 승인된 정책 예외 요청 객체
 * @returns kyverno.io/v2 규격의 YAML 문자열
 */
export function dumpPolicyExceptionYaml(
  request: PolicyExceptionRequest,
): string {
  const namespace = request.resourceNamespace || "default";
  const ruleNames =
    request.appliedRuleNames && request.appliedRuleNames.length > 0
      ? request.appliedRuleNames
      : request.ruleNames;

  const manifest = buildPolicyExceptionManifest({
    name: request.k8sExceptionName || `pac-exception-${request.id}`,
    namespace,
    requestId: request.id,
    policyName: request.policyName,
    ruleNames,
    resourceKind: request.resourceKind,
    resourceName: request.resourceName,
    resourceNamespace: request.resourceNamespace,
  });

  const v2Manifest = {
    ...manifest,
    apiVersion: "kyverno.io/v2",
  };

  return dumpYaml(v2Manifest);
}

/**
 * GitOps 매니페스트 저장 대상 상대 경로를 생성합니다.
 *
 * @param request 승인된 정책 예외 요청 객체
 * @returns k8s-manifests/exceptions/<namespace>/<request-id>.yaml 포맷의 상대 경로
 */
export function getGitOpsRelativePath(request: PolicyExceptionRequest): string {
  const namespace = request.resourceNamespace || "default";
  return path.join(
    "k8s-manifests",
    "exceptions",
    namespace,
    `${request.id}.yaml`,
  );
}

/**
 * GitOps 매니페스트 게시 및 Dual-Path 배포 제어
 *
 * 승인된 PolicyException 요청에 대해 모드 및 GITOPS_MIN_DURATION_HOURS을 참조,
 * 다양한 배포정책 집행
 */
@Injectable()
export class GitOpsPublisherService {
  private readonly logger = new Logger(GitOpsPublisherService.name);
  private readonly publishingMode: PublishingMode;
  private readonly minDurationHours: number;

  constructor(config: ConfigService) {
    const mode = config
      .get<string>("GITOPS_PUBLISHING_MODE", "DUAL_PATH")
      .toUpperCase();
    this.publishingMode =
      mode === "STRICT_GITOPS" || mode === "RUNTIME_ONLY" ? mode : "DUAL_PATH";

    const configuredHours = Number(
      config.get<string>("GITOPS_MIN_DURATION_HOURS", "24"),
    );
    this.minDurationHours =
      Number.isFinite(configuredHours) && configuredHours >= 0
        ? configuredHours
        : 24;
  }

  /**
   * PolicyExceptionRequest를 kyverno.io/v2 PolicyException YAML 문자열로 변환합니다.
   *
   * @param request 승인된 정책 예외 요청 객체
   * @returns kyverno.io/v2 YAML 문자열
   */
  dumpPolicyExceptionYaml(request: PolicyExceptionRequest): string {
    return dumpPolicyExceptionYaml(request);
  }

  /**
   * GitOps 매니페스트 저장 상대 경로를 반환합니다.
   *
   * @param request 승인된 정책 예외 요청 객체
   * @returns 매니페스트 파일 상대 경로
   */
  getGitOpsRelativePath(request: PolicyExceptionRequest): string {
    return getGitOpsRelativePath(request);
  }

  // 런타임 모드 검사
  shouldApplyDirectly(emergencyBypass = false): boolean {
    if (emergencyBypass) return true;
    return (
      this.publishingMode === "DUAL_PATH" ||
      this.publishingMode === "RUNTIME_ONLY"
    );
  }

  /**
   * 승인된 PolicyException 요청에 대한 GitOps 매니페스트를 생성하고 로컬 파일 시스템에 저장합니다.
   *
   * @param request 승인된 정책 예외 요청 객체
   * @returns 매니페스트 게시 및 런타임 적용 결과 객체
   */
  async publishManifest(request: PolicyExceptionRequest): Promise<{
    publishedToGitOps: boolean;
    appliedDirectly: boolean;
    filePath?: string;
  }> {
    const appliedDirectly = this.shouldApplyDirectly();

    if (this.publishingMode === "RUNTIME_ONLY") {
      this.logger.log(
        `Publishing mode is RUNTIME_ONLY. Skipping GitOps file generation for ${request.id}`,
      );
      return { publishedToGitOps: false, appliedDirectly };
    }

    try {
      const yamlContent = dumpPolicyExceptionYaml(request);
      const relativePath = getGitOpsRelativePath(request);

      // 모노레포 루트 또는 패키지 실행 위치에 대응하여 k8s-manifests 디렉토리 결정
      let baseDir = path.resolve(process.cwd(), "k8s-manifests");
      if (
        !fs.existsSync(baseDir) &&
        fs.existsSync(path.resolve(process.cwd(), "../../k8s-manifests"))
      ) {
        baseDir = path.resolve(process.cwd(), "../../k8s-manifests");
      }

      const namespace = request.resourceNamespace || "default";
      const targetDir = path.join(baseDir, "exceptions", namespace);
      const targetFilePath = path.join(targetDir, `${request.id}.yaml`);

      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(targetFilePath, yamlContent, "utf8");

      this.updateKustomizationYaml(targetDir, `${request.id}.yaml`, "add");

      this.logger.log(
        `[Mock GitOps] Manifest successfully saved to ${targetFilePath} for request ${request.id} (minDurationHours: ${this.minDurationHours}h)`,
      );

      return {
        publishedToGitOps: true,
        appliedDirectly,
        filePath: relativePath,
      };
    } catch (error) {
      // remote Git 접근 오류나 파일 시스템 이슈 발생 시 런타임 직접 적용으로 안전하게 폴백
      this.logger.error(
        `Failed to generate GitOps manifest for request ${request.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        publishedToGitOps: false,
        appliedDirectly: true,
      };
    }
  }

  /**
   * 승인 취소/만료/철회된 PolicyException 요청의 GitOps 매니페스트 및 kustomization.yaml 항목을 제거합니다.
   *
   * @param requestIdOrRequest 대상 정책 예외 요청 식별자 또는 요청 객체
   * @param namespaceArg 대상 리소스 네임스페이스 (기본값: 'default')
   * @returns 매니페스트 제거 결과 객체
   */
  async unpublishManifest(
    requestIdOrRequest:
      | string
      | Pick<PolicyExceptionRequest, "id" | "resourceNamespace">,
    namespaceArg?: string,
  ): Promise<{
    unpublishedFromGitOps: boolean;
    filePath?: string;
  }> {
    if (this.publishingMode === "RUNTIME_ONLY") {
      this.logger.log(
        "Publishing mode is RUNTIME_ONLY. Skipping GitOps file deletion.",
      );
      return { unpublishedFromGitOps: false };
    }

    const requestId =
      typeof requestIdOrRequest === "string"
        ? requestIdOrRequest
        : requestIdOrRequest.id;
    const namespace =
      (typeof requestIdOrRequest === "object"
        ? requestIdOrRequest.resourceNamespace
        : namespaceArg) || "default";

    try {
      let baseDir = path.resolve(process.cwd(), "k8s-manifests");
      if (
        !fs.existsSync(baseDir) &&
        fs.existsSync(path.resolve(process.cwd(), "../../k8s-manifests"))
      ) {
        baseDir = path.resolve(process.cwd(), "../../k8s-manifests");
      }

      const targetDir = path.join(baseDir, "exceptions", namespace);
      const targetFilePath = path.join(targetDir, `${requestId}.yaml`);
      const relativePath = path.join(
        "k8s-manifests",
        "exceptions",
        namespace,
        `${requestId}.yaml`,
      );

      let fileRemoved = false;
      if (fs.existsSync(targetFilePath)) {
        fs.unlinkSync(targetFilePath);
        fileRemoved = true;
      }

      this.updateKustomizationYaml(targetDir, `${requestId}.yaml`, "remove");

      this.logger.log(
        `[Mock GitOps] Manifest successfully removed from ${targetFilePath} for request ${requestId}`,
      );

      return {
        unpublishedFromGitOps: fileRemoved,
        filePath: relativePath,
      };
    } catch (error) {
      this.logger.error(
        `Failed to delete GitOps manifest for request ${requestId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { unpublishedFromGitOps: false };
    }
  }

  /**
   * k8s-manifests/exceptions/<namespace>/kustomization.yaml 의 resources 목록을 자동 추가/제거합니다.
   *
   * @param targetDir kustomization.yaml 위치 디렉터리 경로
   * @param filename 추가/제거할 매니페스트 파일 이름
   * @param action 'add' | 'remove'
   */
  updateKustomizationYaml(
    targetDir: string,
    filename: string,
    action: "add" | "remove",
  ): void {
    try {
      const kustomizationPath = path.join(targetDir, "kustomization.yaml");

      let content: KustomizationManifest = {
        apiVersion: "kustomize.config.k8s.io/v1beta1",
        kind: "Kustomization",
        resources: [],
      };

      if (fs.existsSync(kustomizationPath)) {
        const raw = fs.readFileSync(kustomizationPath, "utf8");
        const loaded = loadYaml(raw) as KustomizationManifest;
        if (loaded && typeof loaded === "object") {
          content = { ...loaded };
        }
      } else if (action === "remove") {
        return;
      }

      let resources = Array.isArray(content.resources)
        ? [...content.resources]
        : [];

      if (action === "add") {
        if (!resources.includes(filename)) {
          resources.push(filename);
        }
      } else if (action === "remove") {
        resources = resources.filter((res) => res !== filename);
      }

      content.resources = resources;
      const yamlString = dumpYaml(content);
      fs.writeFileSync(kustomizationPath, yamlString, "utf8");
    } catch (error) {
      this.logger.warn(
        `Failed to update kustomization.yaml in ${targetDir}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
