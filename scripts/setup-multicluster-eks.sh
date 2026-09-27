#!/bin/bash
# AWS EKS 기반 Hub/Spoke 멀티 클러스터 환경 자동 구축 및 최신 풀스택(백엔드, 프론트엔드, Kyverno, IRSA) 통합 배포 스크립트
# 주 리전(us-east-1) Hub 클러스터와 Spoke 클러스터를 순차 프로비저닝하고 멀티 클러스터 설정(KUBERNETES_CLUSTERS)을 자동 연동하는 목적

set -e

HUB_CLUSTER_NAME="${1:-kyverno-eks-hub}"
SPOKE_CLUSTER_NAME="${2:-kyverno-eks-spoke-01}"
HUB_REGION="${3:-us-east-1}"
SPOKE_REGION="${4:-us-east-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
LOCAL_BIN_DIR="${SCRIPT_DIR}/bin"
mkdir -p "${LOCAL_BIN_DIR}"
export PATH="${LOCAL_BIN_DIR}:${PATH}"

KUBECTL="${LOCAL_BIN_DIR}/kubectl"
if [ ! -f "${KUBECTL}" ]; then
  KUBECTL="kubectl"
fi

echo "=========================================================="
echo " Starting AWS EKS Multi-Cluster Setup & Rollout"
echo ">>> Hub Cluster Name   : ${HUB_CLUSTER_NAME} (${HUB_REGION})"
echo ">>> Spoke Cluster Name : ${SPOKE_CLUSTER_NAME} (${SPOKE_REGION})"
echo "=========================================================="

# AWS CLI 자격 증명 유효성을 사전 검증하여 중간 오류로 인한 리소스 생성 유실 방지
if ! aws sts get-caller-identity &> /dev/null; then
  echo "[ERROR] AWS CLI authentication failed. Please run 'aws configure' before proceeding."
  exit 1
fi

echo ">>> Phase 1: Provisioning Primary Hub Cluster '${HUB_CLUSTER_NAME}' in ${HUB_REGION}..."
bash "${SCRIPT_DIR}/setup-eks-cluster.sh" "${HUB_CLUSTER_NAME}" "${HUB_REGION}" "hub"

echo ">>> Phase 1.5: Setting up AWS Load Balancer Controller on Hub Cluster '${HUB_CLUSTER_NAME}'..."
bash "${SCRIPT_DIR}/setup-alb-controller.sh" "${HUB_CLUSTER_NAME}" "${HUB_REGION}" || echo "[WARNING] ALB Controller setup skipped or failed."

# Hub 클러스터의 API Server 엔드포인트와 CA 증명서를 추출하여 멀티 클러스터 연동 정보 수집
HUB_SERVER=$(aws eks describe-cluster --name "${HUB_CLUSTER_NAME}" --region "${HUB_REGION}" --query "cluster.endpoint" --output text)
HUB_CA=$(aws eks describe-cluster --name "${HUB_CLUSTER_NAME}" --region "${HUB_REGION}" --query "cluster.certificateAuthority.data" --output text)

echo ">>> Phase 2: Provisioning Remote Spoke Cluster '${SPOKE_CLUSTER_NAME}' in ${SPOKE_REGION}..."
bash "${SCRIPT_DIR}/setup-eks-cluster.sh" "${SPOKE_CLUSTER_NAME}" "${SPOKE_REGION}" "spoke"

# Spoke 클러스터의 API Server 엔드포인트 및 CA 데이터 추출
SPOKE_SERVER=$(aws eks describe-cluster --name "${SPOKE_CLUSTER_NAME}" --region "${SPOKE_REGION}" --query "cluster.endpoint" --output text)
SPOKE_CA=$(aws eks describe-cluster --name "${SPOKE_CLUSTER_NAME}" --region "${SPOKE_REGION}" --query "cluster.certificateAuthority.data" --output text)

# Spoke 클러스터에 백엔드가 접근할 수 있도록 원격 어드민 에이전트 ServiceAccount 및 토큰 시크릿 바인딩
echo ">>> Phase 3: Configuring ServiceAccount and Access Token on Spoke Cluster '${SPOKE_CLUSTER_NAME}'..."
eksctl utils write-kubeconfig --cluster="${SPOKE_CLUSTER_NAME}" --region="${SPOKE_REGION}"

"${KUBECTL}" apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: kyverno
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kyverno-dashboard-spoke-sa
  namespace: kyverno
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kyverno-dashboard-spoke-sa-binding
subjects:
- kind: ServiceAccount
  name: kyverno-dashboard-spoke-sa
  namespace: kyverno
roleRef:
  kind: ClusterRole
  name: cluster-admin
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: v1
kind: Secret
metadata:
  name: kyverno-dashboard-spoke-sa-token
  namespace: kyverno
  annotations:
    kubernetes.io/service-account.name: kyverno-dashboard-spoke-sa
type: kubernetes.io/service-account-token
EOF

# Spoke 클러스터 ServiceAccount 토큰 발급 완료 시까지 동기 대기
sleep 3

SPOKE_TOKEN=$("${KUBECTL}" get secret kyverno-dashboard-spoke-sa-token -n kyverno -o jsonpath='{.data.token}' | base64 --decode 2>/dev/null || echo "")

if [ -z "${SPOKE_TOKEN}" ]; then
  SPOKE_TOKEN=$("${KUBECTL}" create token kyverno-dashboard-spoke-sa -n kyverno --duration=87600h 2>/dev/null || echo "")
fi

# Hub 클러스터 context로 다시 원복
echo ">>> Phase 4: Switching context back to Hub Cluster '${HUB_CLUSTER_NAME}'..."
eksctl utils write-kubeconfig --cluster="${HUB_CLUSTER_NAME}" --region="${HUB_REGION}"

# Hub 클러스터 ServiceAccount 토큰 발급
"${KUBECTL}" apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: kyverno-backend-sa-token
  namespace: kyverno-platform
  annotations:
    kubernetes.io/service-account.name: kyverno-backend-sa
type: kubernetes.io/service-account-token
EOF
sleep 3
HUB_TOKEN=$("${KUBECTL}" get secret kyverno-backend-sa-token -n kyverno-platform -o jsonpath='{.data.token}' | base64 --decode 2>/dev/null || echo "")

# Multi-Cluster JSON 설정 동적 생성 (NestJS MultiClusterProvider 호환 규격)
KUBERNETES_CLUSTERS_JSON=$(cat <<EOF
[
  {
    "id": "${HUB_CLUSTER_NAME}",
    "displayName": "Primary Hub Cluster (${HUB_REGION})",
    "exceptionNamespace": "kyverno",
    "server": "${HUB_SERVER}",
    "caData": "${HUB_CA}",
    "token": "${HUB_TOKEN}",
    "default": true
  },
  {
    "id": "${SPOKE_CLUSTER_NAME}",
    "displayName": "Remote Spoke Cluster 01 (${SPOKE_REGION})",
    "exceptionNamespace": "kyverno",
    "server": "${SPOKE_SERVER}",
    "caData": "${SPOKE_CA}",
    "token": "${SPOKE_TOKEN}"
  }
]
EOF
)

# Hub 클러스터의 kyverno-platform 네임스페이스 내 멀티 클러스터 JSON ConfigMap 생성
"${KUBECTL}" create namespace kyverno-platform --dry-run=client -o yaml | "${KUBECTL}" apply -f -
"${KUBECTL}" create configmap kyverno-multi-cluster-config \
  --namespace kyverno-platform \
  --from-literal=clusters.json="${KUBERNETES_CLUSTERS_JSON}" \
  --dry-run=client -o yaml | "${KUBECTL}" apply -f -

# 백엔드 Deployment 매니페스트에 멀티 클러스터 환경변수(KUBERNETES_CLUSTERS) 주입을 보장하여 다중 클러스터 동시 제어 지원
echo ">>> Phase 5: Building and Deploying Latest Full-Stack App to Hub Cluster..."
bash "${SCRIPT_DIR}/deploy-backend-docker.sh" "${HUB_REGION}"
bash "${SCRIPT_DIR}/deploy-frontend-docker.sh" "${HUB_REGION}"

# 백엔드 Deployment에 멀티클러스터 JSON 환경 변수 반영
"${KUBECTL}" set env deployment/kyverno-backend -n kyverno-platform \
  CLUSTER_PROVIDER="multi" \
  KUBERNETES_CLUSTERS="${KUBERNETES_CLUSTERS_JSON}"

"${KUBECTL}" rollout status deployment/kyverno-backend -n kyverno-platform --timeout=180s
"${KUBECTL}" rollout status deployment/kyverno-frontend -n kyverno-platform --timeout=180s

echo "=========================================================="
echo " AWS EKS Multi-Cluster Setup Completed Successfully! 🎉"
echo ">>> Hub Cluster   : ${HUB_CLUSTER_NAME} (${HUB_REGION})"
echo ">>> Spoke Cluster : ${SPOKE_CLUSTER_NAME} (${SPOKE_REGION})"
echo "=========================================================="
