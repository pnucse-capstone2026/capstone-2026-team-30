import { parseClusterConfig } from "./cluster-config.schema";

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod",
    server: "https://prod.example.com:6443",
    caData: "ca",
    token: "token",
    ...overrides,
  };
}

describe("cluster-config.schema", () => {
  it("parses a valid entry and applies defaults", () => {
    const [entry] = parseClusterConfig([baseEntry()]);
    expect(entry.exceptionNamespace).toBe("kyverno");
    expect(entry.skipTLSVerify).toBe(false);
    expect(entry.default).toBe(false);
    expect(entry.displayName).toBeUndefined();
  });

  it("accepts client certificate auth", () => {
    const [entry] = parseClusterConfig([
      baseEntry({
        token: undefined,
        clientCertData: "cert",
        clientKeyData: "key",
      }),
    ]);
    expect(entry.clientCertData).toBe("cert");
    expect(entry.clientKeyData).toBe("key");
  });

  it("accepts skipTLSVerify without a CA", () => {
    expect(() =>
      parseClusterConfig([
        baseEntry({ caData: undefined, skipTLSVerify: true }),
      ]),
    ).not.toThrow();
  });

  it("rejects an empty list", () => {
    expect(() => parseClusterConfig([])).toThrow();
  });

  it("rejects a missing server", () => {
    expect(() =>
      parseClusterConfig([baseEntry({ server: undefined })]),
    ).toThrow();
  });

  it("rejects a non-URL server", () => {
    expect(() =>
      parseClusterConfig([baseEntry({ server: "not-a-url" })]),
    ).toThrow();
  });

  it("rejects a Kubernetes server URL that does not use HTTPS", () => {
    expect(() =>
      parseClusterConfig([
        baseEntry({ server: "http://prod.example.com:6443" }),
      ]),
    ).toThrow(/HTTPS/);
  });

  it("accepts DNS-1123 namespaces at the length boundaries", () => {
    expect(() =>
      parseClusterConfig([
        baseEntry({ id: "short", exceptionNamespace: "a" }),
        baseEntry({
          id: "long",
          exceptionNamespace: `a${"-a".repeat(31)}`,
        }),
      ]),
    ).not.toThrow();
  });

  it.each([
    "Kyverno",
    "-kyverno",
    "kyverno-",
    "kyverno_system",
    "a".repeat(64),
  ])("rejects invalid namespace %s", (exceptionNamespace) => {
    expect(() =>
      parseClusterConfig([baseEntry({ exceptionNamespace })]),
    ).toThrow();
  });

  it("rejects an entry with no credential", () => {
    expect(() =>
      parseClusterConfig([baseEntry({ token: undefined })]),
    ).toThrow();
  });

  it("rejects both token and client certificate", () => {
    expect(() =>
      parseClusterConfig([
        baseEntry({ clientCertData: "cert", clientKeyData: "key" }),
      ]),
    ).toThrow();
  });

  it("rejects a partial client certificate", () => {
    expect(() =>
      parseClusterConfig([
        baseEntry({ token: undefined, clientCertData: "cert" }),
      ]),
    ).toThrow();
  });

  it("rejects a missing CA without skipTLSVerify", () => {
    expect(() =>
      parseClusterConfig([baseEntry({ caData: undefined })]),
    ).toThrow();
  });

  it("rejects duplicate ids", () => {
    expect(() => parseClusterConfig([baseEntry(), baseEntry()])).toThrow(
      /Duplicate cluster id/,
    );
  });

  it("rejects more than one default cluster", () => {
    expect(() =>
      parseClusterConfig([
        baseEntry({ id: "a", default: true }),
        baseEntry({ id: "b", default: true }),
      ]),
    ).toThrow(/at most one cluster/i);
  });

  it("rejects unknown fields", () => {
    expect(() =>
      parseClusterConfig([baseEntry({ unexpected: "x" })]),
    ).toThrow();
  });
});
