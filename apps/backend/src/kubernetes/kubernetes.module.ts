import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import { ClustersController } from "./clusters.controller";
import { ClusterProvider } from "./cluster-provider";
import { KyvernoAdapter } from "./kyverno.adapter";
import { MultiClusterProvider } from "./multi-cluster.provider";
import { SingleClusterProvider } from "./single-cluster.provider";
import { K8sResourceWatcher } from "./k8s-watcher.util";
import { ClusterOverviewService } from "./cluster-overview.service";
import { K8sInformerService } from "./k8s-informer.service";
import { IncidentsModule } from "../incidents/incidents.module";
import { AdmissionIncidentWatcherService } from "./watchers/admission-incident-watcher.service";
import { CoreEventIncidentDetector } from "./watchers/detectors/k8s-core-event.detector";
import { ArgoCdIncidentDetector } from "./watchers/detectors/argocd.detector";
import { FluxCdIncidentDetector } from "./watchers/detectors/fluxcd.detector";
import { K8sLeaderElectorService } from "./coordination/k8s-leader-elector.service";

export type ClusterProviderMode = "single" | "multi";

export function resolveClusterProviderMode(
  config: ConfigService,
): ClusterProviderMode {
  const configuredMode = config
    .get<string>("CLUSTER_PROVIDER")
    ?.trim()
    .toLowerCase();
  if (configuredMode) {
    if (configuredMode !== "single" && configuredMode !== "multi") {
      throw new Error("CLUSTER_PROVIDER must be either 'single' or 'multi'.");
    }
    return configuredMode;
  }

  const hasMultiConfig = Boolean(
    config.get<string>("KUBERNETES_CLUSTERS")?.trim() ||
    config.get<string>("KUBERNETES_CLUSTERS_FILE")?.trim(),
  );
  return hasMultiConfig ? "multi" : "single";
}

function resolveClusterProvider(config: ConfigService): ClusterProvider {
  return resolveClusterProviderMode(config) === "multi"
    ? new MultiClusterProvider(config)
    : new SingleClusterProvider(config);
}

@Module({
  imports: [PrismaModule, IncidentsModule],
  controllers: [ClustersController],
  providers: [
    {
      provide: ClusterProvider,
      inject: [ConfigService],
      useFactory: resolveClusterProvider,
    },
    K8sLeaderElectorService,
    K8sInformerService,
    KyvernoAdapter,
    K8sResourceWatcher,
    ClusterOverviewService,
    CoreEventIncidentDetector,
    ArgoCdIncidentDetector,
    FluxCdIncidentDetector,
    AdmissionIncidentWatcherService,
  ],
  exports: [
    ClusterProvider,
    K8sLeaderElectorService,
    K8sInformerService,
    KyvernoAdapter,
    K8sResourceWatcher,
    ClusterOverviewService,
    CoreEventIncidentDetector,
    ArgoCdIncidentDetector,
    FluxCdIncidentDetector,
    AdmissionIncidentWatcherService,
  ],
})
export class KubernetesModule {}
