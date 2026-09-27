import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { resolveRequestTimeoutMs } from "../kubernetes/custom-objects-api.factory";

export const DEFAULT_APPROVED_RECHECK_INTERVAL_SECONDS = 5 * 60;
export const DEFAULT_RECONCILE_CLAIM_TTL_SECONDS = 60;
const MIN_APPROVED_RECHECK_INTERVAL_SECONDS = 10;
const RECONCILE_DATABASE_MARGIN_SECONDS = 10;

function positiveInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

@Injectable()
export class ExceptionReconcileSettings {
  private readonly logger = new Logger(ExceptionReconcileSettings.name);
  readonly approvedRecheckIntervalSeconds: number;
  readonly claimTtlSeconds: number;

  constructor(config: ConfigService) {
    this.approvedRecheckIntervalSeconds = positiveInteger(
      config.get<string>("EXCEPTION_APPROVED_RECHECK_INTERVAL_SECONDS"),
      DEFAULT_APPROVED_RECHECK_INTERVAL_SECONDS,
      MIN_APPROVED_RECHECK_INTERVAL_SECONDS,
    );

    const configuredClaimTtl = positiveInteger(
      config.get<string>("EXCEPTION_RECONCILE_CLAIM_TTL_SECONDS"),
      DEFAULT_RECONCILE_CLAIM_TTL_SECONDS,
      1,
    );
    const requestTimeoutMs = resolveRequestTimeoutMs(
      config.get<string>("KUBERNETES_REQUEST_TIMEOUT_MS"),
    );
    const minimumClaimTtl =
      Math.ceil((requestTimeoutMs * 2) / 1_000) +
      RECONCILE_DATABASE_MARGIN_SECONDS;
    this.claimTtlSeconds = Math.max(configuredClaimTtl, minimumClaimTtl);

    if (this.claimTtlSeconds !== configuredClaimTtl) {
      this.logger.warn(
        `EXCEPTION_RECONCILE_CLAIM_TTL_SECONDS was raised from ${configuredClaimTtl} to ${this.claimTtlSeconds} to cover the Kubernetes request timeout.`,
      );
    }
  }
}
