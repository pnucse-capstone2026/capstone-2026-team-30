import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DEFAULT_APPROVED_RECHECK_INTERVAL_SECONDS,
  DEFAULT_RECONCILE_CLAIM_TTL_SECONDS,
  ExceptionReconcileSettings,
} from "./exception-reconcile.settings";

describe("ExceptionReconcileSettings", () => {
  afterEach(() => jest.restoreAllMocks());

  it("uses safe defaults", () => {
    const settings = new ExceptionReconcileSettings(new ConfigService());

    expect(settings.approvedRecheckIntervalSeconds).toBe(
      DEFAULT_APPROVED_RECHECK_INTERVAL_SECONDS,
    );
    expect(settings.claimTtlSeconds).toBe(DEFAULT_RECONCILE_CLAIM_TTL_SECONDS);
  });

  it("accepts valid interval and claim TTL overrides", () => {
    const settings = new ExceptionReconcileSettings(
      new ConfigService({
        EXCEPTION_APPROVED_RECHECK_INTERVAL_SECONDS: "900",
        EXCEPTION_RECONCILE_CLAIM_TTL_SECONDS: "120",
      }),
    );

    expect(settings.approvedRecheckIntervalSeconds).toBe(900);
    expect(settings.claimTtlSeconds).toBe(120);
  });

  it("falls back when configured values are invalid", () => {
    const settings = new ExceptionReconcileSettings(
      new ConfigService({
        EXCEPTION_APPROVED_RECHECK_INTERVAL_SECONDS: "1",
        EXCEPTION_RECONCILE_CLAIM_TTL_SECONDS: "not-a-number",
      }),
    );

    expect(settings.approvedRecheckIntervalSeconds).toBe(
      DEFAULT_APPROVED_RECHECK_INTERVAL_SECONDS,
    );
    expect(settings.claimTtlSeconds).toBe(DEFAULT_RECONCILE_CLAIM_TTL_SECONDS);
  });

  it("raises a short claim TTL to cover two Kubernetes requests", () => {
    const warning = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const settings = new ExceptionReconcileSettings(
      new ConfigService({
        EXCEPTION_RECONCILE_CLAIM_TTL_SECONDS: "20",
        KUBERNETES_REQUEST_TIMEOUT_MS: "30000",
      }),
    );

    expect(settings.claimTtlSeconds).toBe(70);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("raised from 20 to 70"),
    );
  });
});
