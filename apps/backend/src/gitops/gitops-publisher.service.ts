import * as fs from "fs";
import * as path from "path";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PolicyExceptionRequest } from "@prisma/client";
import { dumpYaml } from "@kubernetes/client-node";
import { buildPolicyExceptionManifest } from "../kubernetes/policy-exception-manifest";

export type PublishingMode = "DUAL_PATH" | "STRICT_GITOPS" | "RUNTIME_ONLY";

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
}
