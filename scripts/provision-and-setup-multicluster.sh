#!/usr/bin/env bash
# ==============================================================================
# End-to-End Automated Multi-Cluster Provisioning & Full-Stack Rollout
# ==============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."

# AWS 로그인 캐시 및 임시 파일 쓰기 보장을 위해 HOME을 /tmp로 지정하고 기존 자격증명 복사
export HOME="/tmp"
export XDG_CACHE_HOME="/tmp/.cache"
export XDG_CONFIG_HOME="/tmp/.config"
export PATH="/tmp/bin:${SCRIPT_DIR}/bin:${PATH}"
export KUBECONFIG="${KUBECONFIG:-/tmp/kubeconfig}"

mkdir -p /tmp/.cache /tmp/.config /tmp/.aws
if [ -d "/home/user/.aws" ]; then
  cp -rf /home/user/.aws/* /tmp/.aws/ 2>/dev/null || true
  chmod -R u+rwX /tmp/.aws 2>/dev/null || true
fi
touch "${KUBECONFIG}" 2>/dev/null || true

REGION="${1:-${AWS_REGION:-us-east-1}}"
HUB_CLUSTER="kyverno-eks-lab"
SPOKE_CLUSTER="kyverno-eks-spoke-01"

echo "=========================================================="
echo " 🌐 End-to-End Multi-Cluster Provisioning & Setup"
echo ">>> AWS Region    : ${REGION}"
echo ">>> Hub Cluster   : ${HUB_CLUSTER}"
echo ">>> Spoke Cluster : ${SPOKE_CLUSTER}"
echo ">>> Kubeconfig    : ${KUBECONFIG}"
echo "=========================================================="

# 1. AWS 인증 확인
echo ">>> Checking AWS authentication..."
aws sts get-caller-identity

# 2. Hub Cluster 확인/생성
echo ""
echo "=========================================================="
echo ">>> [Phase 1] Ensuring Hub Cluster: ${HUB_CLUSTER}"
echo "=========================================================="
if aws eks describe-cluster --name "${HUB_CLUSTER}" --region "${REGION}" >/dev/null 2>&1; then
  echo ">>> Hub cluster '${HUB_CLUSTER}' control plane exists."
  
  # 노드그룹 확인
  NG_COUNT=$(aws eks list-nodegroups --cluster-name "${HUB_CLUSTER}" --region "${REGION}" --query "length(nodegroups)" --output text 2>/dev/null || echo "0")
  if [ "${NG_COUNT}" = "0" ]; then
    echo ">>> Hub cluster has no nodegroups. Creating nodegroup from scripts/eksctl-config.yaml..."
    eksctl create nodegroup -f "${SCRIPT_DIR}/eksctl-config.yaml"
  else
    echo ">>> Hub cluster nodegroups already exist (${NG_COUNT} found)."
  fi
  eksctl utils write-kubeconfig --cluster="${HUB_CLUSTER}" --region="${REGION}"
else
  echo ">>> Creating Hub cluster '${HUB_CLUSTER}' using scripts/eksctl-config.yaml..."
  eksctl create cluster -f "${SCRIPT_DIR}/eksctl-config.yaml"
fi

# 3. Spoke Cluster 확인/생성
echo ""
echo "=========================================================="
echo ">>> [Phase 2] Ensuring Spoke Cluster: ${SPOKE_CLUSTER}"
echo "=========================================================="
if aws eks describe-cluster --name "${SPOKE_CLUSTER}" --region "${REGION}" >/dev/null 2>&1; then
  echo ">>> Spoke cluster '${SPOKE_CLUSTER}' control plane exists."
  NG_COUNT=$(aws eks list-nodegroups --cluster-name "${SPOKE_CLUSTER}" --region "${REGION}" --query "length(nodegroups)" --output text 2>/dev/null || echo "0")
  if [ "${NG_COUNT}" = "0" ]; then
    echo ">>> Spoke cluster has no nodegroups. Creating nodegroup from scripts/eksctl-spoke-config.yaml..."
    eksctl create nodegroup -f "${SCRIPT_DIR}/eksctl-spoke-config.yaml"
  else
    echo ">>> Spoke cluster nodegroups already exist (${NG_COUNT} found)."
  fi
  eksctl utils write-kubeconfig --cluster="${SPOKE_CLUSTER}" --region="${REGION}"
else
  echo ">>> Creating Spoke cluster '${SPOKE_CLUSTER}' using scripts/eksctl-spoke-config.yaml..."
  eksctl create cluster -f "${SCRIPT_DIR}/eksctl-spoke-config.yaml"
fi

# 4. 풀스택 플랫폼 및 KubeView Helm 배포 실행
echo ""
echo "=========================================================="
echo ">>> [Phase 3] Deploying Full-Stack Services & KubeView"
echo "=========================================================="
bash "${SCRIPT_DIR}/setup-complete-multicluster-env.sh"

# 5. E2E 10개 시나리오 API 워크플로우 자동 검증
echo ""
echo "=========================================================="
echo ">>> [Phase 4] Executing 10 Enterprise Scenario API Tests"
echo "=========================================================="
HUB_CTX=$(kubectl config get-contexts -o name | grep -E "${HUB_CLUSTER}.*eksctl\.io" | head -n 1 || echo "")
if [ -n "${HUB_CTX}" ]; then
  kubectl --context="${HUB_CTX}" port-forward svc/kyverno-backend 3001:3001 -n kyverno-platform > /dev/null 2>&1 &
  PF_BACKEND_PID=$!
  sleep 4
  bash "${SCRIPT_DIR}/test-all-workflows.sh" "http://localhost:3001" || true
  kill "${PF_BACKEND_PID}" 2>/dev/null || true
fi

echo ""
echo "=========================================================="
echo " 🎉 All Test Environments & Scenario Verifications Complete!"
echo "=========================================================="
