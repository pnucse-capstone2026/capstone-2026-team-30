#!/usr/bin/env bash
# ==============================================================================
# Deploy KubeView via Helm to Multi-Cluster (Hub & Spoke)
# ==============================================================================
# 도입 배경: Hub 및 Spoke EKS 클러스터에 KubeView를 Helm으로 배포하여
#             현재 가동 중인 노드와 파드를 경량 그래픽 다이어그램으로 시각화
# ==============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

KUBECTL="${LOCAL_BIN_DIR}/kubectl"
HELM="${LOCAL_BIN_DIR}/helm"

if [ ! -f "${KUBECTL}" ]; then
  KUBECTL="kubectl"
fi
if [ ! -f "${HELM}" ]; then
  HELM="helm"
fi

REGION="${1:-${AWS_REGION:-us-east-1}}"
HUB_CLUSTER="${2:-kyverno-eks-lab}"
SPOKE_CLUSTER="${3:-kyverno-eks-spoke-01}"

echo "=========================================================="
echo " Deploying KubeView via Helm to Multi-Cluster"
echo ">>> Region        : ${REGION}"
echo ">>> Hub Cluster   : ${HUB_CLUSTER}"
echo ">>> Spoke Cluster : ${SPOKE_CLUSTER}"
echo "=========================================================="

# 컨텍스트 확인
HUB_CTX=$("${KUBECTL}" config get-contexts -o name | grep -E "${HUB_CLUSTER}.*eksctl\.io" | head -n 1 || echo "")
SPOKE_CTX=$("${KUBECTL}" config get-contexts -o name | grep -E "${SPOKE_CLUSTER}.*eksctl\.io" | head -n 1 || echo "")

if [ -z "${HUB_CTX}" ] || [ -z "${SPOKE_CTX}" ]; then
  echo ">>> Updating kubeconfigs via eksctl..."
  eksctl utils write-kubeconfig --cluster="${HUB_CLUSTER}" --region="${REGION}" || true
  eksctl utils write-kubeconfig --cluster="${SPOKE_CLUSTER}" --region="${REGION}" || true
  HUB_CTX=$("${KUBECTL}" config get-contexts -o name | grep -E "${HUB_CLUSTER}.*eksctl\.io" | head -n 1 || echo "")
  SPOKE_CTX=$("${KUBECTL}" config get-contexts -o name | grep -E "${SPOKE_CLUSTER}.*eksctl\.io" | head -n 1 || echo "")
fi

# 1. Spoke Cluster 배포 (메인 워크로드 관제용)
if [ -n "${SPOKE_CTX}" ]; then
  echo ""
  echo ">>> [1/2] Deploying KubeView to Spoke Cluster (${SPOKE_CLUSTER})..."
  "${HELM}" repo add kubeview https://code.benco.io/kubeview/deploy/helm --kube-context="${SPOKE_CTX}" 2>/dev/null || true
  "${HELM}" repo update kubeview 2>/dev/null || true
  "${HELM}" upgrade --install kubeview kubeview/kubeview \
    --kube-context="${SPOKE_CTX}" \
    --namespace kubeview \
    --create-namespace \
    --set limitNamespace=""
  "${KUBECTL}" --context="${SPOKE_CTX}" -n kubeview rollout status deployment/kubeview --timeout=120s
  echo ">>> Spoke KubeView deployed successfully! ✅"
else
  echo "[WARN] Spoke Cluster context not found. Skipping Spoke."
fi

# 2. Hub Cluster 배포 (중앙 관리 허브 관제용)
if [ -n "${HUB_CTX}" ]; then
  echo ""
  echo ">>> [2/2] Deploying KubeView to Hub Cluster (${HUB_CLUSTER})..."
  "${HELM}" repo add kubeview https://benc-uk.github.io/kubeview/ --kube-context="${HUB_CTX}" 2>/dev/null || true
  "${HELM}" repo update kubeview 2>/dev/null || true
  "${HELM}" upgrade --install kubeview kubeview/kubeview \
    --kube-context="${HUB_CTX}" \
    --namespace kubeview \
    --create-namespace \
    --set limitNamespace=""
  "${KUBECTL}" --context="${HUB_CTX}" -n kubeview rollout status deployment/kubeview --timeout=120s
  echo ">>> Hub KubeView deployed successfully! ✅"
else
  echo "[WARN] Hub Cluster context not found. Skipping Hub."
fi

echo ""
echo "=========================================================="
echo " KubeView Multi-Cluster Rollout Complete!"
echo "=========================================================="
echo ">>> Access Spoke KubeView (Workloads Topology):"
echo "    kubectl --context=${SPOKE_CTX} port-forward svc/kubeview 8080:80 -n kubeview"
echo "    👉 http://localhost:8080"
echo ""
echo ">>> Access Hub KubeView (Management Control Plane):"
echo "    kubectl --context=${HUB_CTX} port-forward svc/kubeview 8081:80 -n kubeview"
echo "    👉 http://localhost:8081"
echo "=========================================================="
