import { Injectable, Logger, NotImplementedException } from "@nestjs/common";
import {
  VcsCommentParams,
  VcsCommitStatusParams,
  VcsCreatePrParams,
  VcsPrResult,
  VcsProvider,
} from "./vcs-provider.interface";

/**
 * GitLab REST API (Merge Request, Pipeline / Commit Status) 연동 VcsProvider 스텁 (TODO)
 */
@Injectable()
export class GitLabVcsProvider implements VcsProvider {
  readonly providerType = "GITLAB";
  private readonly logger = new Logger(GitLabVcsProvider.name);

  async createPullRequest(params: VcsCreatePrParams): Promise<VcsPrResult> {
    // TODO: Implement GitLab Merge Request creation via GitLab API
    this.logger.warn(
      `[GitLabVcsProvider] GitLab MR creation is a stub for request ${params.requestId}.`,
    );
    throw new NotImplementedException(
      "GitLab VCS provider is not implemented yet.",
    );
  }

  async postReviewComment(
    _params: VcsCommentParams,
  ): Promise<string | undefined> {
    // TODO: Implement GitLab MR note posting
    this.logger.warn(
      "[GitLabVcsProvider] GitLab MR comment posting is a stub.",
    );
    return undefined;
  }

  async setCommitStatus(_params: VcsCommitStatusParams): Promise<void> {
    // TODO: Implement GitLab Commit status (POST /projects/:id/statuses/:sha)
    this.logger.warn("[GitLabVcsProvider] GitLab Commit Status is a stub.");
  }
}
