import { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GitHubVcsProvider } from "./github-vcs.provider";
import { GitLabVcsProvider } from "./gitlab-vcs.provider";
import { LocalFileVcsProvider } from "./local-file-vcs.provider";
import { VCS_PROVIDER_TOKEN, VcsProvider } from "./vcs-provider.interface";

/**
 * 환경 설정(GITOPS_VCS_PROVIDER 또는 GITOPS_STRATEGY)에 따라 적절한 VcsProvider 구현체를 주입하는 팩토리
 */
export const VcsProviderFactory: Provider<VcsProvider> = {
  provide: VCS_PROVIDER_TOKEN,
  useFactory: (
    config: ConfigService,
    github: GitHubVcsProvider,
    gitlab: GitLabVcsProvider,
    localFile: LocalFileVcsProvider,
  ): VcsProvider => {
    const vcsType = (
      config.get<string>("GITOPS_VCS_PROVIDER") ||
      (config.get<string>("GITOPS_STRATEGY") === "LOCAL_FILE"
        ? "local_file"
        : "github")
    ).toLowerCase();

    switch (vcsType) {
      case "gitlab":
        return gitlab;
      case "local_file":
      case "local":
      case "none":
        return localFile;
      case "github":
      default:
        return github;
    }
  },
  inject: [
    ConfigService,
    GitHubVcsProvider,
    GitLabVcsProvider,
    LocalFileVcsProvider,
  ],
};
