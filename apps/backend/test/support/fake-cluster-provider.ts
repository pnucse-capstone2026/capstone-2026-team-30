import { ApiException, CustomObjectsApi } from "@kubernetes/client-node";
import { BusinessException } from "../../src/common/errors/business.exception";
import {
  ClusterConnection,
  ClusterMetadata,
  ClusterProvider,
} from "../../src/kubernetes/cluster-provider";
import { KUBERNETES_ERROR } from "../../src/kubernetes/kubernetes.errors";

export type FakeClusterSpec = {
  id: string;
  displayName?: string;
  exceptionNamespace?: string;
  policyRules?: string[];
  autogenRules?: string[];
};

export type FakeCustomObjectsApi = {
  getClusterCustomObject: jest.Mock;
  getNamespacedCustomObject: jest.Mock;
  createNamespacedCustomObject: jest.Mock;
  deleteNamespacedCustomObject: jest.Mock;
};

export type FakeClusterProvider = ClusterProvider & {
  apiFor(clusterId: string): FakeCustomObjectsApi;
};

function notFoundError(): Error {
  return new ApiException(404, "Not Found", { kind: "Status" }, {});
}

/**
 * 실제 provider(SingleClusterProvider/MultiClusterProvider)와 같은 예외를 던져야
 * 미설정 클러스터가 필터를 거쳐 404로 나가는 경로까지 테스트가 덮을 수 있다.
 */
function throwNotConfigured(clusterId: string): never {
  throw new BusinessException(KUBERNETES_ERROR.CLUSTER_NOT_CONFIGURED, {
    message: `Cluster '${clusterId}' is not configured.`,
    context: { clusterId },
  });
}

export function buildFakeClusterProvider(
  specs: FakeClusterSpec[],
): FakeClusterProvider {
  const apis = new Map<string, FakeCustomObjectsApi>();
  const metas = new Map<string, ClusterMetadata>();

  for (const spec of specs) {
    metas.set(spec.id, {
      id: spec.id,
      displayName: spec.displayName ?? spec.id,
      exceptionNamespace: spec.exceptionNamespace ?? "kyverno",
    });

    const policy = {
      spec: { rules: (spec.policyRules ?? []).map((name) => ({ name })) },
      status: {
        autogen: { rules: (spec.autogenRules ?? []).map((name) => ({ name })) },
      },
    };

    apis.set(spec.id, {
      getClusterCustomObject: jest.fn().mockResolvedValue(policy),
      // No pre-existing PolicyException → drives the create path.
      getNamespacedCustomObject: jest.fn().mockRejectedValue(notFoundError()),
      createNamespacedCustomObject: jest.fn().mockResolvedValue({}),
      deleteNamespacedCustomObject: jest.fn().mockResolvedValue({}),
    });
  }

  const metadataFor = (clusterId: string): ClusterMetadata => {
    const meta = metas.get(clusterId);
    if (!meta) throwNotConfigured(clusterId);
    return meta;
  };

  const connectionFor = (clusterId: string): ClusterConnection => ({
    ...metadataFor(clusterId),
    customObjectsApi: apis.get(clusterId) as unknown as CustomObjectsApi,
  });

  const provider = {
    get: (clusterId: string) => connectionFor(clusterId),
    getMetadata: (clusterId: string) => metadataFor(clusterId),
    getDefault: () => connectionFor(specs[0].id),
    list: () => [...metas.values()],
    apiFor: (clusterId: string) => {
      const api = apis.get(clusterId);
      if (!api)
        throw new Error(`fake cluster '${clusterId}' is not configured`);
      return api;
    },
  };

  return provider as unknown as FakeClusterProvider;
}
