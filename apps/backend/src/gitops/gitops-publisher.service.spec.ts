import * as fs from "fs";
import * as path from "path";
import { ConfigService } from "@nestjs/config";
import { ExceptionStatus, PolicyExceptionRequest } from "@prisma/client";
import {
  dumpPolicyExceptionYaml,
  getGitOpsRelativePath,
  GitOpsPublisherService,
} from "./gitops-publisher.service";

function createMockRequest(
  overrides: Partial<PolicyExceptionRequest> = {},
): PolicyExceptionRequest {
  const now = new Date();
  return {
    id: "req-12345",
    status: ExceptionStatus.APPROVED,
    reason: "Test exception reason",
    policyName: "disallow-latest-tag",
    ruleNames: ["require-image-tag"],
    appliedRuleNames: ["require-image-tag", "autogen-require-image-tag"],
    resourceKind: "Deployment",
    resourceName: "sample-app",
    resourceNamespace: "production",
    targetClusterId: "cluster-alpha",
    targetClusterDisplayName: "Cluster Alpha",
    k8sExceptionName: "pac-exception-req-12345",
    expiresAt: new Date(now.getTime() + 86400000),
    decisionNote: "Approved for testing",
    decidedAt: now,
    activatedAt: now,
    applyAttempts: 0,
    lastError: null,
    nextAttemptAt: null,
    createdAt: now,
    updatedAt: now,
    requestUserId: "user-1",
    approverUserId: "admin-1",
    ...overrides,
  };
}

describe("GitOpsPublisherService", () => {
  let service: GitOpsPublisherService;
  let configService: ConfigService;

  beforeEach(() => {
    configService = new ConfigService({
      GITOPS_PUBLISHING_MODE: "DUAL_PATH",
      GITOPS_MIN_DURATION_HOURS: "24",
    });
    service = new GitOpsPublisherService(configService);
  });

  describe("dumpPolicyExceptionYaml", () => {
    it("serializes PolicyExceptionRequest to valid kyverno.io/v2 PolicyException YAML format", () => {
      const request = createMockRequest();
      const yamlStr = dumpPolicyExceptionYaml(request);

      expect(yamlStr).toContain("apiVersion: kyverno.io/v2");
      expect(yamlStr).toContain("kind: PolicyException");
      expect(yamlStr).toContain("name: pac-exception-req-12345");
      expect(yamlStr).toContain("namespace: production");
      expect(yamlStr).toContain("policyName: disallow-latest-tag");
      expect(yamlStr).toContain("require-image-tag");
      expect(yamlStr).toContain("autogen-require-image-tag");
      expect(yamlStr).toContain("kinds:");
      expect(yamlStr).toContain("- Deployment");
      expect(yamlStr).toContain("- Pod");
    });

    it("uses default namespace when resourceNamespace is null", () => {
      const request = createMockRequest({ resourceNamespace: null });
      const yamlStr = dumpPolicyExceptionYaml(request);

      expect(yamlStr).toContain("namespace: default");
    });
  });

  describe("getGitOpsRelativePath", () => {
    it("returns correct relative path for namespaced request", () => {
      const request = createMockRequest();
      const relativePath = getGitOpsRelativePath(request);

      expect(relativePath).toBe(
        path.join(
          "k8s-manifests",
          "exceptions",
          "production",
          "req-12345.yaml",
        ),
      );
    });

    it("uses default namespace when resourceNamespace is missing", () => {
      const request = createMockRequest({ resourceNamespace: null });
      const relativePath = getGitOpsRelativePath(request);

      expect(relativePath).toBe(
        path.join("k8s-manifests", "exceptions", "default", "req-12345.yaml"),
      );
    });
  });

  describe("publishManifest", () => {
    it("saves YAML manifest to local disk and returns publishing status in DUAL_PATH mode", async () => {
      const request = createMockRequest();
      const result = await service.publishManifest(request);

      expect(result.publishedToGitOps).toBe(true);
      expect(result.appliedDirectly).toBe(true);
      expect(result.filePath).toBe(
        path.join(
          "k8s-manifests",
          "exceptions",
          "production",
          "req-12345.yaml",
        ),
      );

      let baseDir = path.resolve(process.cwd(), "k8s-manifests");
      if (
        !fs.existsSync(baseDir) &&
        fs.existsSync(path.resolve(process.cwd(), "../../k8s-manifests"))
      ) {
        baseDir = path.resolve(process.cwd(), "../../k8s-manifests");
      }
      const savedFilePath = path.join(
        baseDir,
        "exceptions",
        "production",
        "req-12345.yaml",
      );
      expect(fs.existsSync(savedFilePath)).toBe(true);

      const content = fs.readFileSync(savedFilePath, "utf8");
      expect(content).toContain("apiVersion: kyverno.io/v2");

      let baseDirCleanup = path.resolve(process.cwd(), "k8s-manifests");
      if (
        !fs.existsSync(baseDirCleanup) &&
        fs.existsSync(path.resolve(process.cwd(), "../../k8s-manifests"))
      ) {
        baseDirCleanup = path.resolve(process.cwd(), "../../k8s-manifests");
      }
      const kustomizationPath = path.join(
        baseDirCleanup,
        "exceptions",
        "production",
        "kustomization.yaml",
      );
      if (fs.existsSync(savedFilePath)) fs.unlinkSync(savedFilePath);
      if (fs.existsSync(kustomizationPath)) fs.unlinkSync(kustomizationPath);
    });

    it("skips file generation in RUNTIME_ONLY mode", async () => {
      const runtimeConfig = new ConfigService({
        GITOPS_PUBLISHING_MODE: "RUNTIME_ONLY",
      });
      const runtimeService = new GitOpsPublisherService(runtimeConfig);
      const request = createMockRequest({ id: "req-runtime-only" });

      const result = await runtimeService.publishManifest(request);

      expect(result.publishedToGitOps).toBe(false);
      expect(result.appliedDirectly).toBe(true);
      expect(result.filePath).toBeUndefined();
    });

    it("safely falls back when file writing encounters an error", async () => {
      const request = createMockRequest({ resourceNamespace: "\0invalid" });

      const result = await service.publishManifest(request);

      expect(result.publishedToGitOps).toBe(false);
      expect(result.appliedDirectly).toBe(true);
    });
  });

  describe("unpublishManifest", () => {
    it("deletes existing manifest file and removes it from kustomization.yaml", async () => {
      const request = createMockRequest({
        id: "req-to-delete",
        resourceNamespace: "test-ns",
      });
      await service.publishManifest(request);

      let baseDir = path.resolve(process.cwd(), "k8s-manifests");
      if (
        !fs.existsSync(baseDir) &&
        fs.existsSync(path.resolve(process.cwd(), "../../k8s-manifests"))
      ) {
        baseDir = path.resolve(process.cwd(), "../../k8s-manifests");
      }
      const savedFilePath = path.join(
        baseDir,
        "exceptions",
        "test-ns",
        "req-to-delete.yaml",
      );
      const kustomizationPath = path.join(
        baseDir,
        "exceptions",
        "test-ns",
        "kustomization.yaml",
      );

      expect(fs.existsSync(savedFilePath)).toBe(true);
      expect(fs.existsSync(kustomizationPath)).toBe(true);
      let kContent = fs.readFileSync(kustomizationPath, "utf8");
      expect(kContent).toContain("req-to-delete.yaml");

      const unpublishResult = await service.unpublishManifest(request);
      expect(unpublishResult.unpublishedFromGitOps).toBe(true);
      expect(fs.existsSync(savedFilePath)).toBe(false);

      kContent = fs.readFileSync(kustomizationPath, "utf8");
      expect(kContent).not.toContain("req-to-delete.yaml");

      if (fs.existsSync(kustomizationPath)) {
        fs.unlinkSync(kustomizationPath);
      }
    });

    it("skips file deletion in RUNTIME_ONLY mode", async () => {
      const runtimeConfig = new ConfigService({
        GITOPS_PUBLISHING_MODE: "RUNTIME_ONLY",
      });
      const runtimeService = new GitOpsPublisherService(runtimeConfig);
      const result = await runtimeService.unpublishManifest(
        "req-any",
        "default",
      );

      expect(result.unpublishedFromGitOps).toBe(false);
    });
  });
});
