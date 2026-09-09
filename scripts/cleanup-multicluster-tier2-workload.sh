#!/usr/bin/env bash
# ==============================================================================
# 멀티클러스터 Tier 2 더미 벤치마크 워크로드 일괄 정리 스크립트
# ==============================================================================
# [도입 배경] 벤치마크 수행 후 남아있는 대규모 더미 네임스페이스와 파드를 신속히 회수
# [기대 효과] 백그라운드 병렬 삭제 처리를 통해 클러스터 자원을 즉각적으로 원복하고
#             불필요한 리소스 잔존 및 다음 테스트 간섭 방지
# ==============================================================================

set -uo pipefail

NAMESPACE_PREFIX="tenant-bench"
HUB_CONTEXT="${HUB_CONTEXT:-}"
SPOKE_CONTEXTS="${SPOKE_CONTEXTS:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

KUBECTL="kubectl"
if [ -f "${LOCAL_BIN_DIR}/kubectl" ]; then
  KUBECTL="${LOCAL_BIN_DIR}/kubectl"
fi

cleanup_cluster_workload() {
  local cluster_role="$1"
  local ctx="$2"
  local ctx_arg=""

  if [ -n "${ctx}" ]; then
    ctx_arg="--context=${ctx}"
    echo ">>> Cleaning up on [${cluster_role}] (Context: ${ctx})..."
  else
    echo ">>> Cleaning up on [${cluster_role}] (Current Context)..."
  fi

  local namespaces
  namespaces=$(${KUBECTL} ${ctx_arg} get namespaces -o jsonpath="{.items[*].metadata.name}" 2>/dev/null | tr ' ' '\n' | grep "^${NAMESPACE_PREFIX}-" || true)

  if [ -z "${namespaces}" ]; then
    echo ">>> No benchmark namespaces (${NAMESPACE_PREFIX}-*) found on [${cluster_role}]."
    return 0
  fi

  echo ">>> Deleting benchmark namespaces in parallel on [${cluster_role}]..."
  for ns in ${namespaces}; do
    ${KUBECTL} ${ctx_arg} delete namespace "${ns}" --wait=false >/dev/null 2>&1 &
  done
}

echo "=============================================================================="
echo " 🧹 Cleaning up Multi-Cluster Tier-2 Benchmark Workloads"
echo "=============================================================================="

# 1. Hub 클러스터 정리
cleanup_cluster_workload "hub" "${HUB_CONTEXT}"

# 2. Spoke 클러스터 정리
if [ -n "${SPOKE_CONTEXTS}" ]; then
  IFS=',' read -ra SPOKES <<< "${SPOKE_CONTEXTS}"
  for spoke_ctx in "${SPOKES[@]}"; do
    cleanup_cluster_workload "spoke" "${spoke_ctx}"
  done
fi

wait
echo ">>> All deletion requests dispatched across clusters."
echo "=============================================================================="
