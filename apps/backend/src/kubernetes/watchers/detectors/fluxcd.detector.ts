import { KubeConfig } from "@kubernetes/client-node";
import { Injectable, Logger } from "@nestjs/common";
import {
  IncidentDetector,
  IncidentHandler,
} from "../interfaces/incident-detector.interface";

/**
 * Flux CD (Kustomization & HelmRelease) 연동 인시던트 감지기 스텁 (TODO)
 */
@Injectable()
export class FluxCdIncidentDetector implements IncidentDetector {
  readonly source = "FluxCD";
  private readonly logger = new Logger(FluxCdIncidentDetector.name);

  async start(
    clusterId: string,
    _kubeConfig: KubeConfig,
    _onIncident: IncidentHandler,
  ): Promise<void> {
    // TODO: Implement Flux CD Kustomization (kustomize.toolkit.fluxcd.io) & HelmRelease Watcher
    this.logger.debug(
      `[FluxCdDetector] Flux CD incident detector is a stub for cluster ${clusterId}.`,
    );
  }

  async stop(_clusterId?: string): Promise<void> {
    // TODO: Clean up Flux CD Informers when implemented
  }
}
