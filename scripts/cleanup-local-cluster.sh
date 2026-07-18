#!/bin/bash
# 로컬 개발용 가상 Kubernetes 클러스터 정지 및 리소스 완전히 삭제 스크립트 (자원 반환용)
set -e

CLUSTER_NAME="k8s-lab"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. 로컬 가상 실행 경로 바인딩
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

echo "================================================"
echo " Stopping and Cleaning Local Kubernetes Lab Environment"
echo "================================================"

# 2. Kind 클러스터 존재 여부 확인 후 삭제
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  echo ">>> Deleting Kind cluster '${CLUSTER_NAME}' to free up CPU/RAM..."
  kind delete cluster --name "${CLUSTER_NAME}"
  echo ">>> Cluster '${CLUSTER_NAME}' successfully removed."
else
  echo ">>> Cluster '${CLUSTER_NAME}' does not exist. Nothing to clean."
fi

echo "================================================"
echo " Cleanup Completed. Host resources restored!"
echo "================================================"
