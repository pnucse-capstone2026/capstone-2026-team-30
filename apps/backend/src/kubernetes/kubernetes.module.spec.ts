import { ConfigService } from "@nestjs/config";
import { resolveClusterProviderMode } from "./kubernetes.module";

function configWith(values: Record<string, string> = {}) {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe("resolveClusterProviderMode", () => {
  it.each([
    [" single ", "single"],
    ["MULTI", "multi"],
  ] as const)("normalizes explicit mode %s", (configured, expected) => {
    expect(
      resolveClusterProviderMode(configWith({ CLUSTER_PROVIDER: configured })),
    ).toBe(expected);
  });

  it("infers multi mode from inline or file configuration", () => {
    expect(
      resolveClusterProviderMode(configWith({ KUBERNETES_CLUSTERS: "[]" })),
    ).toBe("multi");
    expect(
      resolveClusterProviderMode(
        configWith({ KUBERNETES_CLUSTERS_FILE: "/clusters.json" }),
      ),
    ).toBe("multi");
  });

  it("defaults to single mode without multi-cluster configuration", () => {
    expect(resolveClusterProviderMode(configWith())).toBe("single");
  });

  it("rejects an explicitly invalid provider mode", () => {
    expect(() =>
      resolveClusterProviderMode(configWith({ CLUSTER_PROVIDER: "remote" })),
    ).toThrow(/CLUSTER_PROVIDER/);
  });
});
