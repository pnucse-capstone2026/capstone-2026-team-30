import {
  HttpMethod,
  KubeConfig,
  RequestContext,
} from "@kubernetes/client-node";
import { firstValueFrom } from "rxjs";
import {
  createCustomObjectsApi,
  DEFAULT_REQUEST_TIMEOUT_MS,
  resolveRequestTimeoutMs,
} from "./custom-objects-api.factory";

/** `makeApiClient` 만 흉내내는 최소 KubeConfig. 실제 클러스터를 필요로 하지 않는다. */
function stubKubeConfig() {
  const getClusterCustomObject = jest.fn().mockResolvedValue({});
  const api = { getClusterCustomObject, configuration: { baseServer: "x" } };
  return {
    kubeConfig: { makeApiClient: () => api } as unknown as KubeConfig,
    getClusterCustomObject,
  };
}

function abortedWithin(signal: AbortSignal, budgetMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const guard = setTimeout(
      () => reject(new Error(`signal did not abort within ${budgetMs}ms`)),
      budgetMs,
    );
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(guard);
        resolve();
      },
      { once: true },
    );
  });
}

describe("resolveRequestTimeoutMs", () => {
  it.each([
    ["5000", 5000],
    ["1", 1],
    ["2500.5", 2500.5],
  ])("accepts a positive numeric setting: %s", (raw, expected) => {
    expect(resolveRequestTimeoutMs(raw)).toBe(expected);
  });

  // 0 과 음수는 전송 계층에서 "타임아웃 없음"으로 해석될 수 있어 받지 않는다.
  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["zero", "0"],
    ["negative", "-1"],
    ["not a number", "abc"],
    ["infinity", "Infinity"],
  ])("falls back to the default for %s", (_label, raw) => {
    expect(resolveRequestTimeoutMs(raw)).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });
});

describe("createCustomObjectsApi", () => {
  it("attaches a signal that aborts a request outliving the timeout", async () => {
    const { kubeConfig, getClusterCustomObject } = stubKubeConfig();
    const client = createCustomObjectsApi(kubeConfig, 20);

    await client.getClusterCustomObject({
      group: "kyverno.io",
      version: "v1",
      plural: "clusterpolicies",
      name: "policy",
    });

    const options = getClusterCustomObject.mock.calls[0][1];
    const context = new RequestContext(
      "https://cluster.invalid/apis",
      HttpMethod.GET,
    );
    await firstValueFrom(options.middleware[0].pre(context));

    const signal = context.getSignal() as AbortSignal;
    expect(signal.aborted).toBe(false);
    await abortedWithin(signal, 1_000);
    expect(signal.aborted).toBe(true);
  });

  it("forwards the request object untouched and passes values through", async () => {
    const { kubeConfig, getClusterCustomObject } = stubKubeConfig();
    const client = createCustomObjectsApi(kubeConfig, 50);
    const param = {
      group: "kyverno.io",
      version: "v1",
      plural: "clusterpolicies",
      name: "policy",
    };

    await client.getClusterCustomObject(param);

    expect(getClusterCustomObject).toHaveBeenCalledTimes(1);
    expect(getClusterCustomObject.mock.calls[0][0]).toBe(param);
    expect(
      (client as unknown as { configuration: unknown }).configuration,
    ).toEqual({ baseServer: "x" });
  });

  it("injects HTTPS keep-alive agent into RequestContext for https URLs", async () => {
    const { kubeConfig, getClusterCustomObject } = stubKubeConfig();
    const client = createCustomObjectsApi(kubeConfig, 5000);

    await client.getClusterCustomObject({
      group: "kyverno.io",
      version: "v1",
      plural: "clusterpolicies",
      name: "policy",
    });

    const options = getClusterCustomObject.mock.calls[0][1];
    const context = new RequestContext(
      "https://eks-cluster.us-east-1.eks.amazonaws.com",
      HttpMethod.GET,
    );
    await firstValueFrom(options.middleware[0].pre(context));

    expect(context.getAgent()).toBeDefined();
  });
});
