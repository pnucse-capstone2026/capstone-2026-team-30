import { ConfigService } from "@nestjs/config";
import { BusinessException } from "../common/errors/business.exception";
import { MultiClusterProvider } from "./multi-cluster.provider";

const mockLoadFromClusterAndUser = jest.fn();
const mockGetClusterCustomObject = jest.fn().mockResolvedValue({});
// provider 는 팩토리를 거쳐 클라이언트를 만든다. 팩토리가 감싸는 대상과 같은 표면이
// 있어야 감싼 결과를 확인할 수 있다.
const mockMakeApiClient = jest.fn(() => ({
  tag: "api",
  getClusterCustomObject: mockGetClusterCustomObject,
}));

jest.mock("@kubernetes/client-node", () => ({
  KubeConfig: jest.fn().mockImplementation(() => ({
    loadFromClusterAndUser: mockLoadFromClusterAndUser,
    makeApiClient: mockMakeApiClient,
  })),
  CustomObjectsApi: class CustomObjectsApi {},
}));

function configWith(entries: unknown, extra: Record<string, string> = {}) {
  const values: Record<string, string> = {
    KUBERNETES_CLUSTERS: JSON.stringify(entries),
    ...extra,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

const prod = {
  id: "prod",
  displayName: "Production",
  exceptionNamespace: "kyverno-prod",
  server: "https://prod.example.com:6443",
  caData: "ca",
  token: "prod-token",
};
const staging = {
  id: "staging",
  server: "https://staging.example.com:6443",
  caData: "ca",
  token: "staging-token",
};

describe("MultiClusterProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws when no config source is provided", () => {
    expect(
      () => new MultiClusterProvider({ get: () => undefined } as never),
    ).toThrow(/KUBERNETES_CLUSTERS/);
  });

  it("throws on invalid JSON", () => {
    const config = {
      get: (key: string) =>
        key === "KUBERNETES_CLUSTERS" ? "{ not json" : undefined,
    } as unknown as ConfigService;
    expect(() => new MultiClusterProvider(config)).toThrow(/JSON/);
  });

  it("throws on a schema violation (duplicate ids)", () => {
    expect(() => new MultiClusterProvider(configWith([prod, prod]))).toThrow();
  });

  it("lists all configured clusters as metadata only", () => {
    const provider = new MultiClusterProvider(configWith([prod, staging]));
    expect(provider.list()).toEqual([
      {
        id: "prod",
        displayName: "Production",
        exceptionNamespace: "kyverno-prod",
      },
      {
        id: "staging",
        displayName: "staging",
        exceptionNamespace: "kyverno",
      },
    ]);
    expect(mockMakeApiClient).not.toHaveBeenCalled();
  });

  it("returns metadata without building a connection", () => {
    const provider = new MultiClusterProvider(configWith([prod]));
    expect(provider.getMetadata("prod")).toEqual({
      id: "prod",
      displayName: "Production",
      exceptionNamespace: "kyverno-prod",
    });
    expect(mockMakeApiClient).not.toHaveBeenCalled();
  });

  it("builds and caches a connection per cluster", () => {
    const provider = new MultiClusterProvider(configWith([prod]));

    const first = provider.get("prod");
    const second = provider.get("prod");

    expect(first).toBe(second);
    expect(first.customObjectsApi).toMatchObject({ tag: "api" });
    expect(mockMakeApiClient).toHaveBeenCalledTimes(1);
    expect(mockLoadFromClusterAndUser).toHaveBeenCalledTimes(1);
    expect(mockLoadFromClusterAndUser).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "prod",
        server: "https://prod.example.com:6443",
        caData: "ca",
        skipTLSVerify: false,
      }),
      expect.objectContaining({ name: "prod", token: "prod-token" }),
    );
  });

  // 타임아웃이 실제로 요청 중단으로 이어지는지는 custom-objects-api.factory.spec.ts
  // 가 본다. 여기서는 provider 가 raw 클라이언트가 아니라 팩토리를 거친 것을
  // 돌려주는지만 확인한다.
  it("hands out a client that carries the request timeout", async () => {
    const provider = new MultiClusterProvider(configWith([prod]));

    await provider.get("prod").customObjectsApi.getClusterCustomObject({
      group: "kyverno.io",
      version: "v1",
      plural: "clusterpolicies",
      name: "policy",
    });

    const options = mockGetClusterCustomObject.mock.calls[0][1];
    expect(options.middleware).toHaveLength(1);
  });

  it("throws CLUSTER_NOT_CONFIGURED for an unknown id", () => {
    const provider = new MultiClusterProvider(configWith([prod]));
    expect(() => provider.get("missing")).toThrow(BusinessException);
    expect(() => provider.getMetadata("missing")).toThrow(BusinessException);
  });

  it("returns the flagged default cluster", () => {
    const provider = new MultiClusterProvider(
      configWith([prod, { ...staging, default: true }]),
    );
    expect(provider.getDefault().id).toBe("staging");
  });

  it("returns the sole cluster as default when only one is configured", () => {
    const provider = new MultiClusterProvider(configWith([prod]));
    expect(provider.getDefault().id).toBe("prod");
  });

  it("throws when the default is ambiguous", () => {
    const provider = new MultiClusterProvider(configWith([prod, staging]));
    expect(() => provider.getDefault()).toThrow(BusinessException);
  });
});
