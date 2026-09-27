/**
 * GitOps PR 생성을 위한 매개변수 규격
 */
export interface VcsCreatePrParams {
  requestId: string;
  policyName: string;
  resourceKind: string;
  resourceName: string;
  namespace: string;
  clusterId: string;
  clusterDisplayName?: string;
  yamlContent: string;
  relativePath: string;
  targetRepo?: string;
  targetBaseBranch?: string;
}

/**
 * GitOps PR 생성 결과 규격
 */
export interface VcsPrResult {
  prUrl?: string;
  prNumber?: number;
  branchName?: string;
}

/**
 * PR 인라인/일반 코멘트 작성 매개변수 규격
 */
export interface VcsCommentParams {
  repository: string;
  pullNumber: number;
  commentMarkdown: string;
}

/**
 * 커밋 상태(Commit Status / Pipeline Status) 갱신 매개변수 규격
 */
export interface VcsCommitStatusParams {
  repository: string;
  commitSha: string;
  state: "success" | "failure" | "pending";
  description: string;
  context?: string;
  targetUrl?: string;
}

/**
 * GitHub Check Run 생성 및 업데이트 매개변수 규격
 */
export interface VcsCheckRunParams {
  repository: string;
  commitSha: string;
  name: string;
  status: "queued" | "in_progress" | "completed";
  title?: string;
  summary?: string;
  conclusion?:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "timed_out"
    | "action_required";
  checkRunId?: number | string;
}

/**
 * 형상 관리 및 VCS(Version Control System) 연동 공급자 추상화 인터페이스 (SPI)
 *
 * GitHub, GitLab, Gitea, Bitbucket, 로컬 파일시스템 등
 * 다양한 Git 플랫폼과의 PR 생성, 코멘트 등록, 커밋 상태 관리를 코어 서비스로부터 격리합니다.
 */
export interface VcsProvider {
  /** 공급자 고유 식별자 (예: 'GITHUB', 'GITLAB', 'LOCAL_FILE') */
  readonly providerType: string;

  /**
   * 신규 브랜치를 생성하고 매니페스트를 푸시한 뒤 Pull Request(또는 Merge Request)를 개설합니다.
   */
  createPullRequest(params: VcsCreatePrParams): Promise<VcsPrResult>;

  /**
   * PR/MR에 검증 리포트 마크다운 코멘트를 게시합니다.
   */
  postReviewComment(params: VcsCommentParams): Promise<string | undefined>;

  /**
   * 특정 커밋 SHA에 대해 거버넌스 게이트 상태를 기록합니다.
   */
  setCommitStatus(params: VcsCommitStatusParams): Promise<void>;

  /**
   * GitHub Check Run을 생성합니다. (비동기 작업 큐 연동용)
   */
  createCheckRun?(
    params: VcsCheckRunParams,
  ): Promise<number | string | undefined>;

  /**
   * GitHub Check Run의 진행 상태 및 최종 결론(conclusion)을 업데이트합니다.
   */
  updateCheckRun?(params: VcsCheckRunParams): Promise<void>;
}

/**
 * NestJS Dependency Injection을 위한 VcsProvider 토큰
 */
export const VCS_PROVIDER_TOKEN = "VCS_PROVIDER_TOKEN";
