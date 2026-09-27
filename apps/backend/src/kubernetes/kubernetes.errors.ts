import type { BusinessErrorDefinition } from "../common/errors/business-error";

export const KUBERNETES_ERROR = {
  CLUSTER_NOT_CONFIGURED: {
    code: "CLUSTER_NOT_CONFIGURED",
    message: "Cluster is not configured.",
  },
} as const satisfies Record<string, BusinessErrorDefinition>;
