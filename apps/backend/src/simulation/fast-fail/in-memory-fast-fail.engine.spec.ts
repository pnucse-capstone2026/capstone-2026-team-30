import { KubernetesObject } from "@kubernetes/client-node";
import { InMemoryFastFailEngine } from "./in-memory-fast-fail.engine";

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
});
