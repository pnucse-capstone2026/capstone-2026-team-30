import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PolicyExceptionRequest } from "@prisma/client";

export type PublishingMode = "DUAL_PATH" | "STRICT_GITOPS" | "RUNTIME_ONLY";

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

  // 런타임 모드 검사
  shouldApplyDirectly(emergencyBypass = false): boolean {
    if (emergencyBypass) return true;
    return (
      this.publishingMode === "DUAL_PATH" ||
      this.publishingMode === "RUNTIME_ONLY"
    );
  }

  // 잔여수명, 정책 등을 검사하여 GitOps 매니페스트 수행
  async publishManifest(
    request: PolicyExceptionRequest,
  ): Promise<{
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

    // TODO: connect getGitOpsRelativePath and dumpPolicyExceptionYaml here
    this.logger.log(
      `[Draft] GitOps publish triggered for request ${request.id} (minDurationHours: ${this.minDurationHours}h)`,
    );

    return {
      publishedToGitOps: true,
      appliedDirectly,
    };
  }
}
