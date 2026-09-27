#!/bin/bash
# AWS EKS 클러스터 및 관련 AWS 리소스 삭제 스크립트 (불필요한 클라우드 요금 청구 방지 목적)
# 사용법: ./cleanup-eks-cluster.sh [CLUSTER_NAME] [REGION]
#   예시: ./cleanup-eks-cluster.sh kyverno-eks-lab us-east-1
set -e

CLUSTER_NAME="${1:-kyverno-eks-lab}"
REGION="${2:-us-east-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PATH="${SCRIPT_DIR}/eksctl-config.yaml"

LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

echo "=========================================================="
echo " Stopping and Deleting AWS EKS Cluster"
echo ">>> Target Cluster Name : ${CLUSTER_NAME}"
echo ">>> Target Region       : ${REGION}"
echo "=========================================================="

if eksctl get cluster --name "${CLUSTER_NAME}" --region "${REGION}" 2>/dev/null | grep -q "${CLUSTER_NAME}"; then
  echo ">>> Deleting EKS cluster '${CLUSTER_NAME}' in ${REGION} and all associated AWS resources..."
  TIER2_CONFIG="${SCRIPT_DIR}/eksctl-tier2-config.yaml"
  LAB_CONFIG="${SCRIPT_DIR}/eksctl-config.yaml"
  
  if [ "${CLUSTER_NAME}" = "kyverno-eks-tier2" ] && [ -f "${TIER2_CONFIG}" ]; then
    echo ">>> Using tier2 cluster config: ${TIER2_CONFIG}"
    eksctl delete cluster -f "${TIER2_CONFIG}" --wait
  elif [ "${CLUSTER_NAME}" = "kyverno-eks-lab" ] && [ -f "${LAB_CONFIG}" ]; then
    echo ">>> Using lab cluster config: ${LAB_CONFIG}"
    eksctl delete cluster -f "${LAB_CONFIG}" --wait
  else
    eksctl delete cluster --name "${CLUSTER_NAME}" --region "${REGION}" --wait
  fi
  echo ">>> EKS cluster '${CLUSTER_NAME}' successfully deleted."
else
  echo ">>> EKS cluster '${CLUSTER_NAME}' does not exist in ${REGION}. Nothing to clean."
fi

echo "=========================================================="
echo " Cleanup Completed for '${CLUSTER_NAME}' (${REGION})!"
echo "=========================================================="
