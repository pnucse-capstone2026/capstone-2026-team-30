import { Injectable, Logger } from "@nestjs/common";
import {
  VcsCommentParams,
  VcsCommitStatusParams,
  VcsCreatePrParams,
  VcsPrResult,
  VcsProvider,
} from "./vcs-provider.interface";

/**
 * 외부 Git 저장소 연동 없이 독립 실행되는 로컬 환경용 VcsProvider
 */
@Injectable()
export class LocalFileVcsProvider implements VcsProvider {
  readonly providerType = "LOCAL_FILE";
  private readonly logger = new Logger(LocalFileVcsProvider.name);

  async createPullRequest(params: VcsCreatePrParams): Promise<VcsPrResult> {
    this.logger.debug(
      `[LocalFileVcsProvider] Bypassing remote PR creation for ${params.requestId}. (Local-only mode)`,
    );
    return {};
  }

  async postReviewComment(
    params: VcsCommentParams,
  ): Promise<string | undefined> {
    this.logger.debug(
      `[LocalFileVcsProvider] Bypassing PR comment for #${params.pullNumber}.`,
    );
    return undefined;
  }

  async setCommitStatus(params: VcsCommitStatusParams): Promise<void> {
    this.logger.debug(
      `[LocalFileVcsProvider] Commit status for ${params.commitSha.slice(0, 7)}: ${params.state}`,
    );
  }
}
