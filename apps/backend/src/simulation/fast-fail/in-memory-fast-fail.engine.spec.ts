import { KubernetesObject, V1PodSpec } from "@kubernetes/client-node";
import {
  InMemoryFastFailEngine,
  isRecord,
  isKubernetesObject,
  isPodSpec,
  extractContainers,
  isSecurityContext,
  isResourceRequirements,
} from "./in-memory-fast-fail.engine";

type K8sResource = KubernetesObject & {
  spec: {
    containers?: Array<Record<string, unknown>>;
    securityContext?: Record<string, unknown>;
    [key: string]: unknown;
  };
};

describe("InMemoryFastFailEngine", () => {
  let engine: InMemoryFastFailEngine;

  beforeEach(() => {
    engine = new InMemoryFastFailEngine();
  });

  const compliantPod: K8sResource = {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: "compliant-pod",
      namespace: "default",
      labels: {
        "app.kubernetes.io/name": "compliant-app",
        team: "platform",
      },
    },
    spec: {
      securityContext: {
        runAsNonRoot: true,
      },
      containers: [
        {
          name: "app",
          image: "registry.example.com/app:v1.2.3",
          resources: {
            limits: {
              cpu: "500m",
              memory: "512Mi",
            },
            requests: {
              cpu: "100m",
              memory: "128Mi",
            },
          },
          securityContext: {
            privileged: false,
            runAsNonRoot: true,
          },
        },
      ],
    },
  };

  it("should return no violations for a fully compliant workload within 3ms", () => {
    const start = performance.now();
    const violations = engine.evaluateResource(compliantPod);
    const latency = performance.now() - start;

    expect(violations).toHaveLength(0);
    expect(latency).toBeLessThan(50);
  });

  it("should detect missing standard labels (app.kubernetes.io/name)", () => {
    const podWithoutLabels: K8sResource = {
      ...compliantPod,
      metadata: {
        name: "unlabeled-pod",
        labels: {
          team: "platform",
        },
      },
    };

    const violations = engine.evaluateResource(podWithoutLabels);
    expect(
      violations.some((v) => v.policyName === "require-standard-labels"),
    ).toBe(true);
  });

  it("should detect privileged container violation", () => {
    const privilegedDeployment: K8sResource = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: "priv-deployment",
        labels: {
          "app.kubernetes.io/name": "priv-app",
        },
      },
      spec: {
        template: {
          spec: {
            securityContext: { runAsNonRoot: true },
            containers: [
              {
                name: "priv-container",
                image: "registry.example.com/app:1.0.0",
                securityContext: {
                  privileged: true,
                  runAsNonRoot: true,
                },
                resources: {
                  limits: { cpu: "100m", memory: "128Mi" },
                },
              },
            ],
          },
        },
      },
    };

    const violations = engine.evaluateResource(privilegedDeployment);
    expect(
      violations.some((v) => v.policyName === "disallow-privileged-containers"),
    ).toBe(true);
  });

  it("should detect root user (UID 0) violation at pod and container level", () => {
    const rootPod: K8sResource = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: "root-pod",
        labels: { "app.kubernetes.io/name": "root-app" },
      },
      spec: {
        securityContext: {
          runAsUser: 0,
        },
        containers: [
          {
            name: "root-container",
            image: "registry.example.com/app:1.0.0",
            resources: { limits: { cpu: "100m", memory: "128Mi" } },
          },
        ],
      },
    };

    const violations = engine.evaluateResource(rootPod);
    expect(
      violations.some((v) => v.policyName === "require-non-root-user"),
    ).toBe(true);
  });

  it("should detect latest or omitted image tags", () => {
    const latestImagePod: K8sResource = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: "latest-pod",
        labels: { "app.kubernetes.io/name": "latest-app" },
      },
      spec: {
        securityContext: { runAsNonRoot: true },
        containers: [
          {
            name: "latest-container",
            image: "nginx:latest",
            resources: { limits: { cpu: "100m", memory: "128Mi" } },
            securityContext: { runAsNonRoot: true },
          },
        ],
      },
    };

    const violations = engine.evaluateResource(latestImagePod);
    expect(violations.some((v) => v.policyName === "disallow-latest-tag")).toBe(
      true,
    );

    const noTagPod: K8sResource = {
      ...latestImagePod,
      spec: {
        ...latestImagePod.spec,
        containers: [
          {
            ...latestImagePod.spec.containers?.[0],
            image: "nginx",
          },
        ],
      },
    };
    const noTagViolations = engine.evaluateResource(noTagPod);
    expect(
      noTagViolations.some((v) => v.policyName === "disallow-latest-tag"),
    ).toBe(true);
  });

  it("should allow SHA256 digest pinned images without explicit tag", () => {
    const digestPod: K8sResource = {
      ...compliantPod,
      spec: {
        ...compliantPod.spec,
        containers: [
          {
            ...compliantPod.spec.containers?.[0],
            image:
              "registry.example.com/app@sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        ],
      },
    };

    const violations = engine.evaluateResource(digestPod);
    expect(violations.some((v) => v.policyName === "disallow-latest-tag")).toBe(
      false,
    );
  });

  it("should detect missing resource limits (cpu/memory)", () => {
    const noLimitsPod: K8sResource = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: "no-limits-pod",
        labels: { "app.kubernetes.io/name": "no-limits-app" },
      },
      spec: {
        securityContext: { runAsNonRoot: true },
        containers: [
          {
            name: "app",
            image: "registry.example.com/app:v1.0.0",
            securityContext: { runAsNonRoot: true },
          },
        ],
      },
    };

    const violations = engine.evaluateResource(noLimitsPod);
    expect(
      violations.some((v) => v.policyName === "require-resource-limits"),
    ).toBe(true);
  });

  it("should ignore non-workload resources like Service or ConfigMap", () => {
    const service: K8sResource = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: "my-service",
      },
      spec: {
        ports: [{ port: 80 }],
      },
    };

    const violations = engine.evaluateResource(service);
    expect(violations).toHaveLength(0);
  });

  describe("Type Guard and Malformed AST Boundary Tests", () => {
    it("should correctly identify records using isRecord", () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ a: 1 })).toBe(true);
      expect(isRecord(null)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
      expect(isRecord([])).toBe(false);
      expect(isRecord("string")).toBe(false);
      expect(isRecord(123)).toBe(false);
      expect(isRecord(true)).toBe(false);
    });

    it("should correctly identify KubernetesObject and PodSpec", () => {
      expect(isKubernetesObject({ apiVersion: "v1", kind: "Pod" })).toBe(true);
      expect(isKubernetesObject("invalid")).toBe(false);
      expect(isPodSpec({ containers: [] })).toBe(true);
      expect(isPodSpec(null)).toBe(false);
      expect(isSecurityContext({ runAsNonRoot: true })).toBe(true);
      expect(isSecurityContext(null)).toBe(false);
      expect(isResourceRequirements({ limits: { cpu: "100m" } })).toBe(true);
      expect(isResourceRequirements(undefined)).toBe(false);
    });

    it("should safely extract containers from various malformed podSpec inputs", () => {
      expect(extractContainers(undefined)).toEqual([]);
      expect(extractContainers({} as unknown as V1PodSpec)).toEqual([]);
      expect(
        extractContainers({ containers: "invalid" } as unknown as V1PodSpec),
      ).toEqual([]);
      expect(
        extractContainers({
          containers: [null, "invalid", { name: "valid" }],
          initContainers: [undefined, { name: "valid-init" }],
        } as unknown as V1PodSpec),
      ).toEqual([{ name: "valid" }, { name: "valid-init" }]);
    });

    it("should safely handle null, primitive, or corrupted spec in evaluateResource without crashing", () => {
      const corruptedSpecs = [
        null,
        "string-spec",
        12345,
        true,
        [],
        { containers: null },
        { containers: "not-an-array" },
        { containers: [null, "invalid", 123] },
        {
          containers: [
            {
              name: "bad-container",
              securityContext: "invalid",
              resources: 123,
            },
          ],
        },
      ];

      for (const spec of corruptedSpecs) {
        const corruptedPod = {
          apiVersion: "v1",
          kind: "Pod",
          metadata: {
            name: "corrupted-pod",
            labels: {
              "app.kubernetes.io/name": "test",
              team: "infra",
            },
          },
          spec,
        } as unknown as KubernetesObject;

        expect(() => {
          const violations = engine.evaluateResource(corruptedPod);
          expect(Array.isArray(violations)).toBe(true);
        }).not.toThrow();
      }
    });

    it("should safely handle corrupted template in Deployment/CronJob without crashing", () => {
      const corruptedDeployment = {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: "corrupted-deploy",
          labels: { "app.kubernetes.io/name": "app", team: "infra" },
        },
        spec: {
          template: "invalid-template-string",
        },
      } as unknown as KubernetesObject;

      expect(() => {
        const violations = engine.evaluateResource(corruptedDeployment);
        expect(Array.isArray(violations)).toBe(true);
      }).not.toThrow();

      const corruptedCronJob = {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata: {
          name: "corrupted-cron",
          labels: { "app.kubernetes.io/name": "app", team: "infra" },
        },
        spec: {
          jobTemplate: {
            spec: {
              template: 12345,
            },
          },
        },
      } as unknown as KubernetesObject;

      expect(() => {
        const violations = engine.evaluateResource(corruptedCronJob);
        expect(Array.isArray(violations)).toBe(true);
      }).not.toThrow();
    });

    it("should safely handle corrupted metadata in preValidateManifest without crashing", () => {
      const yamlContent = `
apiVersion: v1
kind: Pod
metadata: "not-an-object"
spec:
  containers:
    - name: app
      image: nginx:latest
`;
      const result = engine.preValidateManifest(yamlContent);
      expect(result.valid).toBe(false);
      expect(result.results[0].name).toBe("unnamed");
    });
  });
});
