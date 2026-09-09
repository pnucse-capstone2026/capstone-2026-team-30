#!/usr/bin/env bash
# ==============================================================================
# EKS Tier 2 더미 벤치마크 워크로드 정리 스크립트
# ==============================================================================

set -uo pipefail

NAMESPACE_PREFIX="tenant-bench"

echo "=============================================================================="
echo " 🧹 Cleaning up Tier 2 Benchmark Workload on EKS"
echo "=============================================================================="

NAMESPACES=$(kubectl get namespaces -o jsonpath="{.items[*].metadata.name}" | tr ' ' '\n' | grep "^${NAMESPACE_PREFIX}-" || true)

if [ -z "${NAMESPACES}" ]; then
  echo ">>> No benchmark namespaces (${NAMESPACE_PREFIX}-*) found."
  exit 0
fi

echo ">>> Deleting benchmark namespaces in parallel..."
for ns in ${NAMESPACES}; do
  kubectl delete namespace "${ns}" --wait=false >/dev/null 2>&1 &
done

wait
echo ">>> All ${NAMESPACE_PREFIX}-* namespaces deletion requested."
echo "=============================================================================="
