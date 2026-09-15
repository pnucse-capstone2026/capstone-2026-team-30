import { KyvernoRuleTemplateEngine } from "./rule-template.engine";

describe("KyvernoRuleTemplateEngine", () => {
  let engine: KyvernoRuleTemplateEngine;

  beforeEach(() => {
    engine = new KyvernoRuleTemplateEngine();
  });

  describe("preValidateManifest (Tier 1 In-Memory Fast-Fail)", () => {
    const compliantManifest = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: prod
  labels:
    app.kubernetes.io/name: payment-api
    team: payment-platform
spec:
  replicas: 2
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
      containers:
        - name: app
          image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/payment:1.2.0
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
`;

    it("should return valid=true within 5ms for a compliant manifest", () => {
      const result = engine.preValidateManifest(compliantManifest);

      expect(result.valid).toBe(true);
      expect(result.blockedCount).toBe(0);
      expect(result.passedCount).toBe(1);
      expect(result.violations).toHaveLength(0);
      expect(result.latencyMs).toBeLessThanOrEqual(5);
      expect(result.tier).toBe("TIER_1_LOCAL");
    });

    it("should detect require-labels violation when labels are missing", () => {
      const yamlMissingLabels = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: unlabelled-app
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
      containers:
        - name: app
          image: app:1.0.0
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
`;

      const result = engine.preValidateManifest(yamlMissingLabels);

      expect(result.valid).toBe(false);
      expect(result.blockedCount).toBe(1);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            policyName: "require-labels",
            ruleName: "check-for-labels",
          }),
        ]),
      );
    });

    it("should detect disallow-privileged-containers when privileged: true", () => {
      const yamlPrivileged = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: priv-app
  labels:
    app.kubernetes.io/name: priv-app
    team: sec
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
      containers:
        - name: app
          image: app:1.0.0
          securityContext:
            privileged: true
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
`;

      const result = engine.preValidateManifest(yamlPrivileged);

      expect(result.valid).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            policyName: "disallow-privileged-containers",
            ruleName: "disallow-privileged-containers",
          }),
        ]),
      );
    });

    it("should detect require-run-as-non-root when runAsUser is 0 or runAsNonRoot is missing/false", () => {
      const yamlRootUser = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: root-app
  labels:
    app.kubernetes.io/name: root-app
    team: sec
spec:
  template:
    spec:
      securityContext:
        runAsUser: 0
      containers:
        - name: app
          image: app:1.0.0
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
`;

      const result = engine.preValidateManifest(yamlRootUser);

      expect(result.valid).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            policyName: "require-run-as-non-root",
            ruleName: "run-as-non-root",
          }),
        ]),
      );
    });

    it("should detect require-pod-requests-limits when resources limits/requests are missing", () => {
      const yamlNoLimits = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: unconstrained-app
  labels:
    app.kubernetes.io/name: unconstrained-app
    team: infra
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
      containers:
        - name: app
          image: app:1.0.0
`;

      const result = engine.preValidateManifest(yamlNoLimits);

      expect(result.valid).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            policyName: "require-pod-requests-limits",
            ruleName: "validate-resource-requests-limits",
          }),
        ]),
      );
    });

    it("should handle multi-document YAML manifests and aggregate results", () => {
      const multiDoc = `${compliantManifest}---
apiVersion: v1
kind: Pod
metadata:
  name: bad-pod
spec:
  containers:
    - name: c1
      image: test:latest
`;

      const result = engine.preValidateManifest(multiDoc);

      expect(result.totalResources).toBe(2);
      expect(result.passedCount).toBe(1);
      expect(result.blockedCount).toBe(1);
      expect(result.valid).toBe(false);
    });

    it("should gracefully handle malformed YAML input", () => {
      const invalidYaml = `::: invalid yaml string {{{`;
      const result = engine.preValidateManifest(invalidYaml);

      expect(result.valid).toBe(false);
      expect(result.violations[0].policyName).toBe("yaml-syntax-error");
    });
  });

  describe("matchAndGenerate (Offline Rule Template)", () => {
    it("should match DISALLOW_LATEST_TAG and return advice", () => {
      const result = engine.matchAndGenerate({
        errorMessage: "image tag latest is not allowed by policy",
      });

      expect(result.summary).toContain("latest");
      expect(result.provider).toBe("RULE_ENGINE_FALLBACK");
    });

    it("should auto-inject metadata.labels for REQUIRE_LABELS error", () => {
      const result = engine.matchAndGenerate({
        errorMessage: "require-labels: missing label",
        resourceManifest: `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app`,
      });

      expect(result.suggestedFixYaml).toContain("app.kubernetes.io/name");
      expect(result.suggestedFixYaml).toContain("team");
    });
  });
});
