import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * 실 클러스터 통합 테스트용 kind 픽스처.
 *
 * Kyverno 컨트롤러는 설치하지 않고 CRD 두 개만 올린다. 어댑터가 클러스터로 나가는
 * 호출은 clusterpolicies GET 과 policyexceptions GET/CREATE/DELETE 네 개뿐이고,
 * `resolveRuleNames` 의 autogen 처리는 `status.autogen.rules` 가 비어 있어도
 * 아무것도 덧붙이지 않는 additive 로직이라 컨트롤러 없이도 전체 경로가 성립한다.
 */

const DEFAULT_CLUSTER_NAME = "pac-cluster-e2e";
const DEFAULT_KYVERNO_CRD_VERSION = "v1.12.6";
const NAMESPACE_A = "pac-e2e-a";
const NAMESPACE_B = "pac-e2e-b";
const POLICY_NAME = "disallow-latest-tag";
const POLICY_RULE = "disallow-latest-tag";
const CLUSTER_ROLE = "pac-e2e-policy-reader";

const CRD_FILES = [
  "kyverno.io_clusterpolicies.yaml",
  "kyverno.io_policyexceptions.yaml",
];

type ClusterFixture = {
  clusterName: string;
  kubeconfigPath: string;
  workDir: string;
  created: boolean;
};

function run(args: string[], input?: string): string {
  return execFileSync(args[0], args.slice(1), {
    encoding: "utf8",
    stdio: input === undefined ? "pipe" : ["pipe", "pipe", "pipe"],
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function kubectl(fixture: ClusterFixture, args: string[], input?: string) {
  return run(
    ["kubectl", "--kubeconfig", fixture.kubeconfigPath, ...args],
    input,
  );
}

/**
 * kind 가 기본으로 내보내는 kubeconfig 의 서버는 `https://127.0.0.1:<hostPort>` 라
 * devcontainer 안에서는 닿지 않는다. devcontainer 는 `--network=kind` 로 뜨므로
 * `--internal` 이 주는 `https://<cluster>-control-plane:6443` 을 써야 하고,
 * apiserver 인증서 SAN 에 그 DNS 이름이 들어 있어 TLS 검증도 그대로 통과한다.
 */
function writeInternalKubeconfig(clusterName: string, workDir: string): string {
  const kubeconfig = run([
    "kind",
    "get",
    "kubeconfig",
    "--name",
    clusterName,
    "--internal",
  ]);
  const path = join(workDir, "kubeconfig.yaml");
  writeFileSync(path, kubeconfig, { mode: 0o600 });
  return path;
}

function waitForApiServer(fixture: ClusterFixture): void {
  const deadline = Date.now() + 180_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      kubectl(fixture, ["get", "--raw", "/readyz"]);
      return;
    } catch (error) {
      lastError = error;
      execFileSync("sleep", ["3"]);
    }
  }
  throw new Error(
    `kind cluster '${fixture.clusterName}' API server did not become ready: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function installCrds(fixture: ClusterFixture): Promise<void> {
  const version =
    process.env.KYVERNO_CRD_VERSION?.trim() || DEFAULT_KYVERNO_CRD_VERSION;

  for (const file of CRD_FILES) {
    const url = `https://github.com/kyverno/kyverno/releases/download/${version}/${file}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    }
    const path = join(fixture.workDir, file);
    writeFileSync(path, await response.text());

    // ClusterPolicy CRD 는 1.4MB 를 넘어서 클라이언트 사이드 apply 의
    // last-applied-configuration 어노테이션 크기 제한(262144B)에 걸린다.
    kubectl(fixture, ["apply", "--server-side", "-f", path]);
  }

  kubectl(fixture, [
    "wait",
    "--for=condition=Established",
    "crd/clusterpolicies.kyverno.io",
    "crd/policyexceptions.kyverno.io",
    "--timeout=120s",
  ]);
}

/**
 * 어댑터가 실제로 쓰는 verb 만 준다. update/patch/list/watch 는 코드에 없다.
 * policyexceptions 권한은 각 네임스페이스로 한정해 토큰별 격리를 만든다.
 */
function rbacManifest(): string {
  const namespaceDocs = (namespace: string) => [
    `apiVersion: v1
kind: Namespace
metadata:
  name: ${namespace}`,
    `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${namespace}
  namespace: ${namespace}`,
    `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pac-e2e-exception-writer
  namespace: ${namespace}
rules:
  - apiGroups: ["kyverno.io"]
    resources: ["policyexceptions"]
    verbs: ["get", "create", "delete"]`,
    `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pac-e2e-exception-writer
  namespace: ${namespace}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: pac-e2e-exception-writer
subjects:
  - kind: ServiceAccount
    name: ${namespace}
    namespace: ${namespace}`,
  ];

  const documents = [
    ...namespaceDocs(NAMESPACE_A),
    ...namespaceDocs(NAMESPACE_B),
    `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ${CLUSTER_ROLE}
rules:
  - apiGroups: ["kyverno.io"]
    resources: ["clusterpolicies"]
    verbs: ["get"]`,
    `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ${CLUSTER_ROLE}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ${CLUSTER_ROLE}
subjects:
  - kind: ServiceAccount
    name: ${NAMESPACE_A}
    namespace: ${NAMESPACE_A}
  - kind: ServiceAccount
    name: ${NAMESPACE_B}
    namespace: ${NAMESPACE_B}`,
  ];

  return `${documents.join("\n---\n")}\n`;
}

function mintToken(fixture: ClusterFixture, namespace: string): string {
  return kubectl(fixture, [
    "create",
    "token",
    namespace,
    "-n",
    namespace,
    "--duration=1h",
  ]).trim();
}

export async function provisionClusterFixture(): Promise<ClusterFixture> {
  const clusterName =
    process.env.E2E_CLUSTER_NAME?.trim() || DEFAULT_CLUSTER_NAME;
  const workDir = mkdtempSync(join(tmpdir(), "pac-cluster-e2e-"));
  const reusedKubeconfig = process.env.E2E_KUBECONFIG?.trim();

  const fixture: ClusterFixture = {
    clusterName,
    workDir,
    kubeconfigPath: reusedKubeconfig ?? "",
    created: false,
  };

  try {
    if (reusedKubeconfig) {
      fixture.kubeconfigPath = reusedKubeconfig;
    } else {
      // `--wait` 는 kind 가 127.0.0.1 엔드포인트로 폴링해서 devcontainer 안에서는
      // 걸린다. 생성만 시키고 준비 확인은 internal kubeconfig 로 직접 한다.
      run(["kind", "create", "cluster", "--name", clusterName]);
      fixture.created = true;
      fixture.kubeconfigPath = writeInternalKubeconfig(clusterName, workDir);
    }

    waitForApiServer(fixture);
    await installCrds(fixture);
    kubectl(fixture, ["apply", "-f", "-"], rbacManifest());
    kubectl(fixture, [
      "apply",
      "-f",
      resolve(
        __dirname,
        "../../../../k8s-manifests/policies/disallow-latest-tag.yaml",
      ),
    ]);

    const caData = kubectl(fixture, [
      "config",
      "view",
      "--raw",
      "-o",
      "jsonpath={.clusters[0].cluster.certificate-authority-data}",
    ]).trim();
    const server = kubectl(fixture, [
      "config",
      "view",
      "--raw",
      "-o",
      "jsonpath={.clusters[0].cluster.server}",
    ]).trim();

    process.env.E2E_APISERVER = server;
    process.env.E2E_CA_DATA = caData;
    process.env.E2E_TOKEN_A = mintToken(fixture, NAMESPACE_A);
    process.env.E2E_TOKEN_B = mintToken(fixture, NAMESPACE_B);
    process.env.E2E_NS_A = NAMESPACE_A;
    process.env.E2E_NS_B = NAMESPACE_B;
    process.env.E2E_POLICY_NAME = POLICY_NAME;
    process.env.E2E_POLICY_RULE = POLICY_RULE;
    process.env.E2E_KUBECONFIG_PATH = fixture.kubeconfigPath;

    return fixture;
  } catch (error) {
    await teardownClusterFixture(fixture);
    throw error;
  }
}

export async function teardownClusterFixture(
  fixture: ClusterFixture,
): Promise<void> {
  try {
    if (fixture.created) {
      run(["kind", "delete", "cluster", "--name", fixture.clusterName]);
    } else if (fixture.kubeconfigPath) {
      // 재사용 모드에서는 우리가 만든 것만 걷어낸다.
      kubectl(fixture, [
        "delete",
        "namespace",
        NAMESPACE_A,
        NAMESPACE_B,
        "--ignore-not-found",
      ]);
      kubectl(fixture, [
        "delete",
        "clusterrole",
        CLUSTER_ROLE,
        "--ignore-not-found",
      ]);
      kubectl(fixture, [
        "delete",
        "clusterrolebinding",
        CLUSTER_ROLE,
        "--ignore-not-found",
      ]);
    }
  } finally {
    rmSync(fixture.workDir, { recursive: true, force: true });
  }
}

export type { ClusterFixture };
