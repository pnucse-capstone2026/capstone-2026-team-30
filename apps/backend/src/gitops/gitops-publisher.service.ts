import * as fs from "fs";
import * as path from "path";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PolicyExceptionRequest } from "@prisma/client";
import { dumpYaml, loadYaml } from "@kubernetes/client-node";
import { buildPolicyExceptionManifest } from "../kubernetes/policy-exception-manifest";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import {
  VCS_PROVIDER_TOKEN,
  VcsProvider,
} from "./providers/vcs-provider.interface";

export type PublishingMode = "DUAL_PATH" | "STRICT_GITOPS" | "RUNTIME_ONLY";
export type GitOpsStrategy = "LOCAL_FILE" | "GITHUB_PR";

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
  private readonly gitOpsStrategy: GitOpsStrategy;
  private readonly minDurationHours: number;
  private readonly githubToken?: string;
  private readonly githubRepo?: string;
  private readonly githubBaseBranch: string;
  private readonly autoMerge: boolean;

  constructor(
    config: ConfigService,
    @Optional() private readonly clusterProvider?: ClusterProvider,
    @Optional()
    @Inject(VCS_PROVIDER_TOKEN)
    private readonly vcsProvider?: VcsProvider,
  ) {
    const mode = config
      .get<string>("GITOPS_PUBLISHING_MODE", "DUAL_PATH")
      .toUpperCase();
    this.publishingMode =
      mode === "STRICT_GITOPS" || mode === "RUNTIME_ONLY" ? mode : "DUAL_PATH";

    const strategy = config
      .get<string>("GITOPS_STRATEGY", "LOCAL_FILE")
      .toUpperCase();
    this.gitOpsStrategy = strategy === "GITHUB_PR" ? "GITHUB_PR" : "LOCAL_FILE";

    this.githubToken =
      config.get<string>("GITOPS_GITHUB_TOKEN") ||
      config.get<string>("GITHUB_TOKEN");
    this.githubRepo =
      config.get<string>("GITOPS_GITHUB_REPO") ||
      config.get<string>("GITHUB_REPOSITORY") ||
      "YeongrimGo/test-for";
    this.githubBaseBranch = config.get<string>(
      "GITOPS_GITHUB_BASE_BRANCH",
      "main",
    );
    this.autoMerge =
      config.get<string>("GITOPS_AUTO_MERGE", "false").toLowerCase() ===
        "true" || config.get<string>("GITOPS_AUTO_MERGE", "false") === "1";

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
   * GitHub REST API를 사용하여 신규 브랜치를 생성하고 매니페스트를 푸시한 뒤 PR(Pull Request)을 개설합니다.
   * 클러스터별로 지정된 전용 GitOps repo/branch/path 정보가 존재하면 우선적으로 주입하여 사용합니다.
   *
   * @param request 정책 예외 요청 객체
   * @param yamlContent 직렬화된 Kyverno PolicyException YAML 문자열
   * @param relativePath 매니페스트 파일 상대 경로
   * @returns PR 생성 결과 객체 ({ prUrl?: string, prNumber?: number })
   */
  async createGitHubPullRequest(
    request: PolicyExceptionRequest,
    yamlContent: string,
    relativePath: string,
  ): Promise<{ prUrl?: string; prNumber?: number }> {
    let targetRepo = this.githubRepo;
    let targetBaseBranch = this.githubBaseBranch;
    let targetPath = relativePath;

    // 클러스터별 전용 GitOps repo/branch/path 메타데이터가 존재하면 최우선 적용
    if (this.clusterProvider && request.targetClusterId) {
      try {
        const metadata = this.clusterProvider.getMetadata(
          request.targetClusterId,
        );
        if (metadata.gitopsRepo) {
          targetRepo = metadata.gitopsRepo;
        }
        if (metadata.gitopsBranch) {
          targetBaseBranch = metadata.gitopsBranch;
        }
        if (metadata.gitopsPath) {
          const ns = request.resourceNamespace || "default";
          targetPath = path.join(metadata.gitopsPath, ns, `${request.id}.yaml`);
        }
      } catch {
        // clusterNotConfigured 시 전역 기본 설정으로 fallback
      }
    }

    if (this.vcsProvider) {
      try {
        const result = await this.vcsProvider.createPullRequest({
          requestId: request.id,
          policyName: request.policyName,
          resourceKind: request.resourceKind,
          resourceName: request.resourceName,
          namespace: request.resourceNamespace || "default",
          clusterId: request.targetClusterId,
          clusterDisplayName: request.targetClusterDisplayName,
          yamlContent,
          relativePath: targetPath,
          targetRepo,
          targetBaseBranch,
        });
        return {
          prUrl: result.prUrl,
          prNumber: result.prNumber,
        };
      } catch (err) {
        this.logger.error(
          `Failed to create PR via VcsProvider (${this.vcsProvider.providerType}): ${
            (err as Error).message
          }`,
        );
        return {};
      }
    }

    if (!this.githubToken || !targetRepo) {
      this.logger.warn(
        "GitHub token or repository not configured (GITOPS_GITHUB_TOKEN, GITOPS_GITHUB_REPO or cluster.gitopsRepo). Falling back to local file publishing.",
      );
      return {};
    }

    const [owner, repo] = targetRepo.split("/");
    if (!owner || !repo) {
      this.logger.warn(
        `Invalid GITOPS_GITHUB_REPO format: '${targetRepo}'. Expected 'owner/repo'.`,
      );
      return {};
    }

    const branchName = `gitops/exception-${request.id}`;
    const commitMessage = `feat(gitops): publish PolicyException for request ${request.id}`;
    const prTitle = `feat(gitops): publish PolicyException manifest for request ${request.id}`;
    const prBody = `## 🛡️ Kyverno Governance Platform - Automated GitOps PR

* **Request ID**: \`${request.id}\`
* **Policy Name**: \`${request.policyName}\`
* **Target Resource**: \`${request.resourceKind}/${request.resourceName}\`
* **Namespace**: \`${request.resourceNamespace || "default"}\`
* **Target Cluster**: \`${request.targetClusterDisplayName || request.targetClusterId}\`

---
*Automated PR generated by Kyverno Governance Platform GitOps Publisher Service.*`;

    try {
      const headers = {
        Authorization: `Bearer ${this.githubToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Kyverno-Governance-Platform",
        "Content-Type": "application/json",
      };

      // 1. Base branch의 최신 commit SHA 조회
      const refRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${targetBaseBranch}`,
        { headers },
      );
      if (!refRes.ok) {
        throw new Error(
          `Failed to fetch base branch ref: HTTP ${refRes.status}`,
        );
      }
      const refData = (await refRes.json()) as { object?: { sha?: string } };
      const baseSha = refData.object?.sha;
      if (!baseSha) throw new Error("Base branch SHA not found.");

      // 2. 신규 브랜치 생성 (refs/heads/gitops/exception-<id>)
      const createRefRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/refs`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            ref: `refs/heads/${branchName}`,
            sha: baseSha,
          }),
        },
      );
      if (!createRefRes.ok && createRefRes.status !== 422) {
        throw new Error(`Failed to create branch: HTTP ${createRefRes.status}`);
      }

      // 3. 신규 브랜치에 매니페스트 파일 생성/업데이트
      const contentEncoded = Buffer.from(yamlContent).toString("base64");
      const createFileRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${targetPath}`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({
            message: commitMessage,
            content: contentEncoded,
            branch: branchName,
          }),
        },
      );
      if (!createFileRes.ok) {
        throw new Error(
          `Failed to commit file to GitHub branch: HTTP ${createFileRes.status}`,
        );
      }

      // 4. Pull Request 개설
      const prRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: prTitle,
            head: branchName,
            base: targetBaseBranch,
            body: prBody,
          }),
        },
      );
      if (!prRes.ok) {
        throw new Error(`Failed to create Pull Request: HTTP ${prRes.status}`);
      }
      const prData = (await prRes.json()) as {
        html_url?: string;
        number?: number;
      };

      this.logger.log(
        `[GitOps PR Created] Pull Request successfully opened: ${prData.html_url}`,
      );

      // GITOPS_AUTO_MERGE가 활성화되어 있는 경우 GitHub REST API를 통해 즉시 PR 자동 머지 실행
      if (this.autoMerge && prData.number) {
        await this.autoMergePullRequest(
          owner,
          repo,
          prData.number,
          request.id,
          targetBaseBranch,
          headers,
        );
      }

      return {
        prUrl: prData.html_url,
        prNumber: prData.number,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create GitHub PR for request ${request.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {};
    }
  }

  /**
   * 개설된 GitHub PR에 대해 GitHub REST API를 호출하여 base 브랜치로 자동 머지(Auto-Merge)를 수행합니다.
   * GitHub의 mergeable 상태 계산 딜레이에 대응하여 최대 3회 재시도(Backoff)를 수행합니다.
   */
  private async autoMergePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    requestId: string,
    targetBaseBranch: string,
    headers: Record<string, string>,
  ): Promise<void> {
    this.logger.log(
      `[GitOps Auto-Merge] Initiating auto-merge for PR #${prNumber}...`,
    );

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // GitHub 백엔드의 머지 가능 상태 계산을 위해 첫 시도 및 재시도 전 약간의 딜레이
        await new Promise((resolve) => setTimeout(resolve, attempt * 1200));

        const mergeRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
          {
            method: "PUT",
            headers,
            body: JSON.stringify({
              commit_title: `feat(gitops): auto-merge PolicyException for request ${requestId} (#${prNumber})`,
              commit_message: `Automatically merged by Kyverno Governance Platform GitOps Publisher Service.`,
              merge_method: "squash",
            }),
          },
        );

        if (mergeRes.ok) {
          const mergeData = (await mergeRes.json()) as { merged?: boolean };
          if (mergeData.merged) {
            this.logger.log(
              `[GitOps Auto-Merged] Pull Request #${prNumber} successfully merged into '${targetBaseBranch}'! 🟣`,
            );
            return;
          }
        }

        const errText = await mergeRes.text();
        this.logger.warn(
          `[GitOps Auto-Merge Attempt ${attempt}/${maxRetries}] HTTP ${mergeRes.status}: ${errText}`,
        );
      } catch (err) {
        this.logger.warn(
          `[GitOps Auto-Merge Attempt ${attempt}/${maxRetries}] Network error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /**
   * 승인된 PolicyException 요청에 대한 GitOps 매니페스트를 생성하고 로컬 및 원격 저장소에 게시합니다.
   *
   * @param request 승인된 정책 예외 요청 객체
   * @returns 매니페스트 게시 및 런타임 적용 결과 객체
   */
  async publishManifest(request: PolicyExceptionRequest): Promise<{
    publishedToGitOps: boolean;
    appliedDirectly: boolean;
    filePath?: string;
    prUrl?: string;
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

      let localSaved = false;
      try {
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(targetFilePath, yamlContent, "utf8");
        this.updateKustomizationYaml(targetDir, `${request.id}.yaml`, "add");
        localSaved = true;

        this.logger.log(
          `[Mock GitOps] Manifest successfully saved to ${targetFilePath} for request ${request.id} (minDurationHours: ${this.minDurationHours}h)`,
        );
      } catch (fileErr) {
        this.logger.warn(
          `[GitOps Publisher] Local file write bypassed (container filesystem constraint): ${
            fileErr instanceof Error ? fileErr.message : String(fileErr)
          }`,
        );
      }

      let prUrl: string | undefined;
      if (this.gitOpsStrategy === "GITHUB_PR") {
        const prResult = await this.createGitHubPullRequest(
          request,
          yamlContent,
          relativePath,
        );
        prUrl = prResult.prUrl;
      }

      const published = Boolean(prUrl || localSaved);
      return {
        publishedToGitOps: published,
        appliedDirectly,
        filePath: relativePath,
        prUrl,
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
