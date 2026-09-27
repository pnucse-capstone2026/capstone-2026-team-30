#!/bin/bash
# 로컬 개발용 가상 Kubernetes 클러스터 정지 및 리소스 완전히 삭제 스크립트 (단일 및 멀티클러스터 지원)
set -euo pipefail

TARGET_CLUSTER="${1:-all}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. 로컬 가상 실행 경로 바인딩
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

echo "================================================"
echo " Stopping and Cleaning Local Kubernetes Lab Environment"
echo " Target: ${TARGET_CLUSTER}"
echo "================================================"

delete_cluster_if_exists() {
  local c_name="$1"
  if kind get clusters 2>/dev/null | grep -q "^${c_name}$"; then
    echo ">>> Deleting Kind cluster '${c_name}' to free up CPU/RAM..."
    kind delete cluster --name "${c_name}"
    echo ">>> Cluster '${c_name}' successfully removed."
  else
    echo ">>> Cluster '${c_name}' does not exist. Skipping."
  fi
}

if [ "${TARGET_CLUSTER}" = "all" ]; then
  # 단일 랩 및 멀티클러스터(Hub/Spoke) 전수 검사 및 정리
  for cluster in "k8s-lab" "k8s-hub" "k8s-spoke"; do
    delete_cluster_if_exists "${cluster}"
  done
else
  delete_cluster_if_exists "${TARGET_CLUSTER}"
fi

echo "================================================"
echo " Cleanup Completed. Host resources restored!"
echo "================================================"
