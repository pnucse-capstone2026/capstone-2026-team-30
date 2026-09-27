import { buildPolicyExceptionManifest } from "./policy-exception-manifest";

describe("buildPolicyExceptionManifest", () => {
  it("matches a namespaced Deployment and its generated Pods", () => {
    const manifest = buildPolicyExceptionManifest({
      name: "exception-1",
      namespace: "kyverno",
      requestId: "request-1",
      policyName: "require-labels",
      ruleNames: ["require-team", "autogen-require-team"],
      resourceKind: "Deployment",
      resourceName: "api",
      resourceNamespace: "production",
    });

    expect(manifest.spec.match.any).toEqual([
      {
        resources: {
          kinds: ["Deployment"],
          names: ["api"],
          namespaces: ["production"],
        },
      },
      {
        resources: {
          kinds: ["Pod"],
          names: ["api-*"],
          namespaces: ["production"],
        },
      },
    ]);
    expect(manifest.spec.exceptions[0].ruleNames).toEqual([
      "require-team",
      "autogen-require-team",
    ]);
    expect(manifest.metadata.labels["pac.kyverno.io/request-id"]).toBe(
      "request-1",
    );
  });

  it("does not add a namespace for cluster-scoped resources", () => {
    const manifest = buildPolicyExceptionManifest({
      name: "exception-2",
      namespace: "kyverno",
      requestId: "request-2",
      policyName: "policy",
      ruleNames: ["rule"],
      resourceKind: "Namespace",
      resourceName: "temporary",
      resourceNamespace: null,
    });

    expect(manifest.spec.match.any).toEqual([
      { resources: { kinds: ["Namespace"], names: ["temporary"] } },
    ]);
  });
});
