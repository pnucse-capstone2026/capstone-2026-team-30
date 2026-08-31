"use client";

import { create } from "zustand";

import { getAuditLogs, type AuditLog } from "@/lib/audit-logs";
import {
  listClusterCatalog,
  listClusters,
  type ClusterMetadata,
} from "@/lib/clusters";
import { type ExceptionRequest } from "@/lib/exception-requests";
import { listExceptionRequests } from "@/lib/exception-requests-api";
import { getPolicies, type KyvernoPolicy } from "@/lib/policies";
import { getViolations, type PolicyViolation } from "@/lib/policy-violations";

type DataState = {
  clusters: ClusterMetadata[] | null;
  policies: KyvernoPolicy[] | null;
  violations: PolicyViolation[] | null;
  exceptions: ExceptionRequest[] | null;
  auditLogs: AuditLog[] | null;

  clustersLoading: boolean;
  policiesLoading: boolean;
  violationsLoading: boolean;
  exceptionsLoading: boolean;
  auditLogsLoading: boolean;

  fetchClusters: (force?: boolean) => Promise<ClusterMetadata[]>;
  fetchPolicies: (force?: boolean) => Promise<KyvernoPolicy[]>;
  fetchViolations: (force?: boolean) => Promise<PolicyViolation[]>;
  fetchExceptions: (force?: boolean) => Promise<ExceptionRequest[]>;
  fetchAuditLogs: (force?: boolean) => Promise<AuditLog[]>;
};

let clustersPromise: Promise<ClusterMetadata[]> | null = null;
let policiesPromise: Promise<KyvernoPolicy[]> | null = null;
let violationsPromise: Promise<PolicyViolation[]> | null = null;
let exceptionsPromise: Promise<ExceptionRequest[]> | null = null;
let auditLogsPromise: Promise<AuditLog[]> | null = null;

export const useDataStore = create<DataState>((set, get) => ({
  clusters: null,
  policies: null,
  violations: null,
  exceptions: null,
  auditLogs: null,

  clustersLoading: false,
  policiesLoading: false,
  violationsLoading: false,
  exceptionsLoading: false,
  auditLogsLoading: false,

  async fetchClusters(force = false) {
    const { clusters } = get();
    if (clusters !== null && !force) {
      // 배경 재검증 (Stale-While-Revalidate)
      void (async () => {
        try {
          const fresh = await listClusterCatalog().catch(() => listClusters());
          if (Array.isArray(fresh)) {
            set({ clusters: fresh });
          }
        } catch {
          // ignore background errors
        }
      })();
      return clusters;
    }

    if (clustersPromise) {
      return clustersPromise;
    }

    set({ clustersLoading: clusters === null });

    clustersPromise = (async () => {
      try {
        const fresh = await listClusterCatalog().catch(() => listClusters());
        if (Array.isArray(fresh)) {
          set({ clusters: fresh });
          return fresh;
        }
        return get().clusters ?? [];
      } catch {
        return get().clusters ?? [];
      } finally {
        set({ clustersLoading: false });
      }
    })().finally(() => {
      clustersPromise = null;
    });

    return clustersPromise;
  },

  async fetchPolicies(force = false) {
    const { policies } = get();
    if (policies !== null && !force) {
      void (async () => {
        try {
          const fresh = await getPolicies();
          if (Array.isArray(fresh)) {
            set({ policies: fresh });
          }
        } catch {
          // ignore
        }
      })();
      return policies;
    }

    if (policiesPromise) {
      return policiesPromise;
    }

    set({ policiesLoading: policies === null });

    policiesPromise = (async () => {
      try {
        const fresh = await getPolicies();
        if (Array.isArray(fresh)) {
          set({ policies: fresh });
          return fresh;
        }
        return get().policies ?? [];
      } catch {
        return get().policies ?? [];
      } finally {
        set({ policiesLoading: false });
      }
    })().finally(() => {
      policiesPromise = null;
    });

    return policiesPromise;
  },

  async fetchViolations(force = false) {
    const { violations } = get();
    if (violations !== null && !force) {
      void (async () => {
        try {
          const fresh = await getViolations();
          if (Array.isArray(fresh)) {
            set({ violations: fresh });
          }
        } catch {
          // ignore
        }
      })();
      return violations;
    }

    if (violationsPromise) {
      return violationsPromise;
    }

    set({ violationsLoading: violations === null });

    violationsPromise = (async () => {
      try {
        const fresh = await getViolations();
        if (Array.isArray(fresh)) {
          set({ violations: fresh });
          return fresh;
        }
        return get().violations ?? [];
      } catch {
        return get().violations ?? [];
      } finally {
        set({ violationsLoading: false });
      }
    })().finally(() => {
      violationsPromise = null;
    });

    return violationsPromise;
  },

  async fetchExceptions(force = false) {
    const { exceptions } = get();
    if (exceptions !== null && !force) {
      void (async () => {
        try {
          const fresh = await listExceptionRequests();
          if (Array.isArray(fresh)) {
            set({ exceptions: fresh });
          }
        } catch {
          // ignore
        }
      })();
      return exceptions;
    }

    if (exceptionsPromise) {
      return exceptionsPromise;
    }

    set({ exceptionsLoading: exceptions === null });

    exceptionsPromise = (async () => {
      try {
        const fresh = await listExceptionRequests();
        if (Array.isArray(fresh)) {
          set({ exceptions: fresh });
          return fresh;
        }
        return get().exceptions ?? [];
      } catch {
        return get().exceptions ?? [];
      } finally {
        set({ exceptionsLoading: false });
      }
    })().finally(() => {
      exceptionsPromise = null;
    });

    return exceptionsPromise;
  },

  async fetchAuditLogs(force = false) {
    const { auditLogs } = get();
    if (auditLogs !== null && !force) {
      void (async () => {
        try {
          const fresh = await getAuditLogs({ limit: 100 });
          if (fresh && Array.isArray(fresh.items)) {
            set({ auditLogs: fresh.items });
          }
        } catch {
          // ignore
        }
      })();
      return auditLogs;
    }

    if (auditLogsPromise) {
      return auditLogsPromise;
    }

    set({ auditLogsLoading: auditLogs === null });

    auditLogsPromise = (async () => {
      try {
        const fresh = await getAuditLogs({ limit: 100 });
        if (fresh && Array.isArray(fresh.items)) {
          set({ auditLogs: fresh.items });
          return fresh.items;
        }
        return get().auditLogs ?? [];
      } catch {
        return get().auditLogs ?? [];
      } finally {
        set({ auditLogsLoading: false });
      }
    })().finally(() => {
      auditLogsPromise = null;
    });

    return auditLogsPromise;
  },
}));

export { useNotificationStore } from "@/lib/notifications-store";
