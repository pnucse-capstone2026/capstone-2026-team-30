import { ConfigService } from "@nestjs/config";
import { BusinessException } from "../common/errors/business.exception";
import { SingleClusterProvider } from "./single-cluster.provider";

function configWith(values: Record<string, string> = {}) {
  return {
    get: <T>(key: string, defaultValue?: T) =>
      key in values ? (values[key] as unknown as T) : defaultValue,
  } as unknown as ConfigService;
}

describe("SingleClusterProvider", () => {
  it("exposes the single configured cluster via metadata", () => {
    const provider = new SingleClusterProvider(
      configWith({
        KUBERNETES_CLUSTER_ID: "hub",
        KUBERNETES_CLUSTER_DISPLAY_NAME: "Hub",
        KUBERNETES_EXCEPTION_NAMESPACE: "kyverno",
      }),
    );

    expect(provider.getMetadata("hub")).toEqual({
      id: "hub",
      displayName: "Hub",
      exceptionNamespace: "kyverno",
    });
  });

  it("lists exactly the configured cluster", () => {
    const provider = new SingleClusterProvider(configWith());
    expect(provider.list()).toEqual([
      { id: "default", displayName: "default", exceptionNamespace: "kyverno" },
    ]);
  });

  it("rejects an unknown cluster id", () => {
    const provider = new SingleClusterProvider(configWith());
    expect(() => provider.getMetadata("other")).toThrow(BusinessException);
  });

  it("rejects an invalid exception namespace during startup", () => {
    expect(
      () =>
        new SingleClusterProvider(
          configWith({ KUBERNETES_EXCEPTION_NAMESPACE: "Kyverno_System" }),
        ),
    ).toThrow(/Namespace/);
  });
});
