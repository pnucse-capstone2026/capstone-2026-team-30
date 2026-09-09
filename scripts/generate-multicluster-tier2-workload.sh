#!/usr/bin/env bash
# ==============================================================================
# 멀티클러스터 EKS / Kind Tier 2 대규모 워크로드 & PolicyReport 위반 생성기
# ==============================================================================
# [도입 배경] 단일 클러스터 검증 한계를 넘어 실제 분산 멀티클러스터 환경에서
#             수천 건 규모의 PolicyReport 및 수백 대의 Pod 부하를 유발하기 위함
# [기대 효과] 초경량 Pause Container를 활용하여 최소 노드 자원으로 3,000+건의
#             실시간 정책 위반을 발생시키고 멀티클러스터 수집 성능을 측정 가능
# ==============================================================================

set -uo pipefail

HUB_NS_COUNT="${1:-15}"
SPOKE_NS_COUNT="${2:-15}"
REPLICAS_PER_NS="${3:-10}"
HUB_CONTEXT="${HUB_CONTEXT:-}"
SPOKE_CONTEXTS="${SPOKE_CONTEXTS:-}"
NAMESPACE_PREFIX="tenant-bench"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

KUBECTL="kubectl"
if [ -f "${LOCAL_BIN_DIR}/kubectl" ]; then
  KUBECTL="${LOCAL_BIN_DIR}/kubectl"
fi

echo "=============================================================================="
echo " 🚀 Multi-Cluster Tier-2 Benchmark Workload Generator"
echo "=============================================================================="
echo " 🏢 Hub Namespaces      : ${HUB_NS_COUNT} (${NAMESPACE_PREFIX}-hub-01 ~ ${HUB_NS_COUNT})"
echo " 🏢 Spoke Namespaces    : ${SPOKE_NS_COUNT} (${NAMESPACE_PREFIX}-spoke-01 ~ ${SPOKE_NS_COUNT})"
echo " 📦 Replicas per NS     : ${REPLICAS_PER_NS}"
echo " 🎯 Target CRD          : PolicyReport & ClusterPolicyReport"
echo "=============================================================================="

# 단일 클러스터에 워크로드를 주입하는 함수
deploy_workload_to_cluster() {
  local cluster_role="$1"
  local ns_count="$2"
  local ctx="$3"
  local ctx_arg=""

  if [ -n "${ctx}" ]; then
    ctx_arg="--context=${ctx}"
    echo ">>> Target Cluster Context [${cluster_role}]: ${ctx}"
  else
    echo ">>> Target Cluster [${cluster_role}]: Current Kubeconfig Context"
  fi

  echo ">>> Creating ${ns_count} namespaces on [${cluster_role}]..."

  for i in $(seq -w 1 "${ns_count}"); do
    local ns_name="${NAMESPACE_PREFIX}-${cluster_role}-${i}"

    # 네임스페이스 생성
    ${KUBECTL} ${ctx_arg} create namespace "${ns_name}" --dry-run=client -o yaml | ${KUBECTL} ${ctx_arg} apply -f - >/dev/null 2>&1

    # 복합 위반 유발 초경량 Pause Deployment 배포
    # 1. :latest 이미지 태그 (disallow-latest-tag)
    # 2. 리소스 Limits 누락 (require-resource-limits)
    # 3. 비공인 외부 레지스트리 (restrict-image-registries)
    cat <<MANIFEST | ${KUBECTL} ${ctx_arg} apply -f - >/dev/null 2>&1
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bench-workload-${cluster_role}
  namespace: ${ns_name}
  labels:
    app: bench-dummy-workload
    benchmark: tier2
    cluster-role: ${cluster_role}
spec:
  replicas: ${REPLICAS_PER_NS}
  selector:
    matchLabels:
      app: bench-dummy-workload
  template:
    metadata:
      labels:
        app: bench-dummy-workload
        benchmark: tier2
        cluster-role: ${cluster_role}
    spec:
      containers:
        - name: dummy-pause-container
          image: registry.k8s.io/pause:latest
          imagePullPolicy: IfNotPresent
          resources:
            requests:
              cpu: 1m
              memory: 4Mi
MANIFEST

    printf "."
  done
  echo ""
  echo ">>> Workloads submitted to [${cluster_role}]."
}

# 1. Hub 클러스터 워크로드 배포
deploy_workload_to_cluster "hub" "${HUB_NS_COUNT}" "${HUB_CONTEXT}"

# 2. Spoke 클러스터 워크로드 배포
if [ -n "${SPOKE_CONTEXTS}" ]; then
  IFS=',' read -ra SPOKES <<< "${SPOKE_CONTEXTS}"
  for spoke_ctx in "${SPOKES[@]}"; do
    deploy_workload_to_cluster "spoke" "${SPOKE_NS_COUNT}" "${spoke_ctx}"
  done
else
  # 단일 Kubeconfig context 또는 Spoke 분리 미지정 시 spoke 접두사로 동일 클러스터에 주입
  deploy_workload_to_cluster "spoke" "${SPOKE_NS_COUNT}" ""
fi

# 3. 전체 Pod 기동 상태 점검
echo ">>> Checking Pod status across benchmark namespaces..."
sleep 3

TOTAL_PODS=$(${KUBECTL} get pods -A -l benchmark=tier2 --no-headers 2>/dev/null | wc -l || echo 0)
RUNNING_PODS=$(${KUBECTL} get pods -A -l benchmark=tier2 --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l || echo 0)
POLICY_REPORTS=$(${KUBECTL} get policyreports -A --no-headers 2>/dev/null | wc -l || echo 0)

echo "=============================================================================="
echo " 🎉 Multi-Cluster Tier-2 Benchmark Workload Setup Completed!"
echo "=============================================================================="
echo " 📊 Total Benchmark Pods   : ${TOTAL_PODS} (Running: ${RUNNING_PODS})"
echo " 📋 Total PolicyReports    : ${POLICY_REPORTS} namespaces"
echo " 💡 Ready to execute multi-cluster benchmark suite."
echo "=============================================================================="
