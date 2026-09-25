#!/usr/bin/env bash
# ==============================================================================
# Multi-Cluster Automated Orchestration Script for Kyverno Platform
# ==============================================================================
# [도입 배경] Hub/Spoke EKS 클러스터 생성 직후 Kyverno HA, Argo CD, 원격 RBAC,
#             Bedrock IRSA, 제로-트러스트 격리 정책 및 v1.1.0 풀스택을 무인 자동 연동
# [기대 효과] 수동 설정 실수 방지 및 100% 재현 가능한 프로덕션 엔터프라이즈 멀티클러스터 환경 배포
# ==============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
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

export HOME="/tmp"
export XDG_CACHE_HOME="/tmp/.cache"
export XDG_CONFIG_HOME="/tmp/.config"
export PATH="/tmp/bin:${LOCAL_BIN_DIR}:${PATH}"
export KUBECONFIG="${KUBECONFIG:-/tmp/kubeconfig}"

mkdir -p /tmp/.cache /tmp/.config /tmp/.aws
if [ -d "/home/user/.aws" ]; then
  cp -rf /home/user/.aws/* /tmp/.aws/ 2>/dev/null || true
  chmod -R u+rwX /tmp/.aws 2>/dev/null || true
fi
touch "${KUBECONFIG}" 2>/dev/null || true

REGION="us-east-1"
HUB_CLUSTER="kyverno-eks-lab"
SPOKE_CLUSTER="kyverno-eks-spoke-01"

echo "=========================================================="
echo " Starting Full Multi-Cluster Orchestration & Rollout"
echo ">>> Hub Cluster   : ${HUB_CLUSTER} (${REGION})"
echo ">>> Spoke Cluster : ${SPOKE_CLUSTER} (${REGION})"
echo "=========================================================="

# 1. Kubeconfig 업데이트
echo ">>> [Step 1] Updating kubeconfig for Hub and Spoke..."
eksctl utils write-kubeconfig --cluster="${HUB_CLUSTER}" --region="${REGION}"
eksctl utils write-kubeconfig --cluster="${SPOKE_CLUSTER}" --region="${REGION}"

HUB_CTX=$("${KUBECTL}" config get-contexts -o name | grep -E "${HUB_CLUSTER}.*eksctl\.io" | head -n 1)
SPOKE_CTX=$("${KUBECTL}" config get-contexts -o name | grep -E "${SPOKE_CLUSTER}.*eksctl\.io" | head -n 1)

echo ">>> Hub Context   : ${HUB_CTX}"
echo ">>> Spoke Context : ${SPOKE_CTX}"

# 2. Spoke 클러스터 인프라 및 Argo CD 배포
echo "=========================================================="
echo ">>> [Step 2] Configuring Spoke Cluster: ${SPOKE_CLUSTER}..."
echo "=========================================================="
"${KUBECTL}" --context="${SPOKE_CTX}" patch storageclass gp2 -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}' 2>/dev/null || true

# EBS CSI 드라이버 확인/설치
if ! aws eks describe-addon --cluster-name "${SPOKE_CLUSTER}" --addon-name aws-ebs-csi-driver --region "${REGION}" &>/dev/null; then
  echo ">>> Installing AWS EBS CSI driver addon on Spoke..."
  eksctl create iamserviceaccount \
    --name ebs-csi-controller-sa \
    --namespace kube-system \
    --cluster "${SPOKE_CLUSTER}" \
    --attach-policy-arn arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy \
    --approve \
    --region "${REGION}" 2>/dev/null || true
  eksctl create addon \
    --name aws-ebs-csi-driver \
    --cluster "${SPOKE_CLUSTER}" \
    --force \
    --region "${REGION}" 2>/dev/null || true
fi

# Kyverno Helm 배포 (Spoke)
echo ">>> Deploying Kyverno HA on Spoke..."
"${HELM}" repo add kyverno https://kyverno.github.io/kyverno/ --kube-context="${SPOKE_CTX}" 2>/dev/null || true
"${HELM}" repo update kyverno 2>/dev/null || true
"${HELM}" upgrade --install kyverno kyverno/kyverno \
  --kube-context="${SPOKE_CTX}" \
  --namespace kyverno \
  --create-namespace \
  --set admissionController.replicas=2 \
  --set backgroundController.replicas=1 \
  --set cleanupController.replicas=1 \
  --set reportsController.replicas=1 \
  --set "reportsController.backgroundScan=true" \
  --set "reportsController.backgroundScanInterval=1h" \
  --set "backgroundController.backgroundScanInterval=1h" \
  --set admissionController.resources.requests.cpu=100m \
  --set admissionController.resources.requests.memory=128Mi \
  --set admissionController.resources.limits.cpu=1000m \
  --set admissionController.resources.limits.memory=768Mi \
  --set features.policyExceptions.enabled=true \
  --set "features.policyExceptions.namespace=*" \
  --set features.validatingAdmissionPolicyReports.enabled=false \
  --set features.admissionReports.enabled=false \
  --set features.aggregateReports.enabled=true \
  --set features.policyReports.enabled=true

echo ">>> Waiting for Kyverno Admission Controller to be Ready on Spoke..."
"${KUBECTL}" --context="${SPOKE_CTX}" -n kyverno rollout status deployment/kyverno-admission-controller --timeout=180s

# Kubeflow Notebook CRD 배포 (Spoke)
echo ">>> Installing Kubeflow Notebooks CRDs on Spoke..."
"${KUBECTL}" --context="${SPOKE_CTX}" apply -f https://raw.githubusercontent.com/kubeflow/kubeflow/v1.8.0/components/notebook-controller/config/crd/bases/kubeflow.org_notebooks.yaml 2>/dev/null || true
"${KUBECTL}" --context="${SPOKE_CTX}" create namespace mlops-workspace --dry-run=client -o yaml | "${KUBECTL}" --context="${SPOKE_CTX}" apply -f -

# Argo CD 배포 (Spoke)
echo ">>> Deploying Argo CD to Spoke..."
"${KUBECTL}" --context="${SPOKE_CTX}" create namespace argocd --dry-run=client -o yaml | "${KUBECTL}" --context="${SPOKE_CTX}" apply -f -
"${KUBECTL}" --context="${SPOKE_CTX}" apply --server-side=true --force-conflicts -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Spoke 원격 에이전트 RBAC 및 ServiceAccount 생성
echo ">>> Applying Spoke Remote Agent RBAC..."
"${KUBECTL}" --context="${SPOKE_CTX}" apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kyverno-remote-agent-sa
  namespace: kyverno
---
apiVersion: v1
kind: Secret
metadata:
  name: kyverno-remote-agent-sa-token
  namespace: kyverno
  annotations:
    kubernetes.io/service-account.name: kyverno-remote-agent-sa
type: kubernetes.io/service-account-token
EOF

"${KUBECTL}" --context="${SPOKE_CTX}" apply -f "${ROOT_DIR}/k8s-manifests/rbac/spoke-remote-agent-rbac.yaml"

sleep 3
SPOKE_SERVER=$(aws eks describe-cluster --name "${SPOKE_CLUSTER}" --region "${REGION}" --query "cluster.endpoint" --output text)
SPOKE_CA_DATA=$("${KUBECTL}" --context="${SPOKE_CTX}" config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')
SPOKE_TOKEN=$("${KUBECTL}" --context="${SPOKE_CTX}" get secret kyverno-remote-agent-sa-token -n kyverno -o jsonpath='{.data.token}' | base64 -d || "${KUBECTL}" --context="${SPOKE_CTX}" create token kyverno-remote-agent-sa -n kyverno --duration=87600h)

echo ">>> Spoke Server: ${SPOKE_SERVER}"
echo ">>> Spoke Token retrieved successfully!"

# KubeView Helm 배포 (Spoke)
echo ">>> Deploying KubeView via Helm on Spoke (${SPOKE_CLUSTER})..."
"${HELM}" repo add kubeview https://code.benco.io/kubeview/deploy/helm --kube-context="${SPOKE_CTX}" 2>/dev/null || true
"${HELM}" repo update kubeview 2>/dev/null || true
"${HELM}" upgrade --install kubeview kubeview/kubeview \
  --kube-context="${SPOKE_CTX}" \
  --namespace kubeview \
  --create-namespace \
  --set limitNamespace=""
"${KUBECTL}" --context="${SPOKE_CTX}" -n kubeview rollout status deployment/kubeview --timeout=120s || true

# 3. Hub 클러스터 인프라, Kyverno HA, Bedrock IRSA 및 플랫폼 배포
echo "=========================================================="
echo ">>> [Step 3] Configuring Hub Cluster: ${HUB_CLUSTER}..."
echo "=========================================================="
"${KUBECTL}" --context="${HUB_CTX}" patch storageclass gp2 -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}' 2>/dev/null || true

# EBS CSI 드라이버 확인/설치
if ! aws eks describe-addon --cluster-name "${HUB_CLUSTER}" --addon-name aws-ebs-csi-driver --region "${REGION}" &>/dev/null; then
  echo ">>> Installing AWS EBS CSI driver addon on Hub..."
  eksctl create iamserviceaccount \
    --name ebs-csi-controller-sa \
    --namespace kube-system \
    --cluster "${HUB_CLUSTER}" \
    --attach-policy-arn arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy \
    --approve \
    --region "${REGION}" 2>/dev/null || true
  eksctl create addon \
    --name aws-ebs-csi-driver \
    --cluster "${HUB_CLUSTER}" \
    --force \
    --region "${REGION}" 2>/dev/null || true
fi

# Kyverno Helm 배포 (Hub)
echo ">>> Deploying Kyverno HA on Hub..."
"${HELM}" repo add kyverno https://kyverno.github.io/kyverno/ --kube-context="${HUB_CTX}" 2>/dev/null || true
"${HELM}" upgrade --install kyverno kyverno/kyverno \
  --kube-context="${HUB_CTX}" \
  --namespace kyverno \
  --create-namespace \
  --set admissionController.replicas=2 \
  --set backgroundController.replicas=1 \
  --set cleanupController.replicas=1 \
  --set reportsController.replicas=1 \
  --set "reportsController.backgroundScan=true" \
  --set "reportsController.backgroundScanInterval=1h" \
  --set "backgroundController.backgroundScanInterval=1h" \
  --set admissionController.resources.requests.cpu=100m \
  --set admissionController.resources.requests.memory=128Mi \
  --set admissionController.resources.limits.cpu=1000m \
  --set admissionController.resources.limits.memory=768Mi \
  --set features.policyExceptions.enabled=true \
  --set "features.policyExceptions.namespace=*" \
  --set features.validatingAdmissionPolicyReports.enabled=false \
  --set features.admissionReports.enabled=false \
  --set features.aggregateReports.enabled=true \
  --set features.policyReports.enabled=true

echo ">>> Waiting for Kyverno Admission Controller to be Ready on Hub..."
"${KUBECTL}" --context="${HUB_CTX}" -n kyverno rollout status deployment/kyverno-admission-controller --timeout=180s

# Hub 격리 정책 배포 (Hub 제로-트러스트)
echo ">>> Applying Hub Zero-Trust Isolation Policy..."
"${KUBECTL}" --context="${HUB_CTX}" apply -f "${ROOT_DIR}/k8s-manifests/policies-hub-only/isolate-management-hub-cluster.yaml"

# Kubeflow Notebook CRD 및 Controller 배포 (Hub)
echo ">>> Installing Kubeflow Notebooks CRDs and Controller on Hub..."
"${KUBECTL}" --context="${HUB_CTX}" apply -f https://raw.githubusercontent.com/kubeflow/kubeflow/v1.8.0/components/notebook-controller/config/crd/bases/kubeflow.org_notebooks.yaml 2>/dev/null || true
"${KUBECTL}" --context="${HUB_CTX}" apply -f "${ROOT_DIR}/k8s-manifests/system/notebook-controller.yaml"

# Bedrock IRSA 연동
echo ">>> Setting up Bedrock IRSA for Hub..."
bash "${SCRIPT_DIR}/setup-bedrock-irsa.sh" "${HUB_CLUSTER}" "${REGION}" || echo "[WARN] Bedrock IRSA skipped."

# Hub 네임스페이스 및 RBAC 생성
echo ">>> Creating 'kyverno-platform' namespace and RBAC on Hub..."
"${KUBECTL}" --context="${HUB_CTX}" apply -f "${ROOT_DIR}/k8s-manifests/system/namespace.yaml"
"${KUBECTL}" --context="${HUB_CTX}" apply -f "${ROOT_DIR}/k8s-manifests/system/rbac.yaml"

# Hub PostgreSQL 배포
echo ">>> Deploying PostgreSQL on Hub..."
if [ -f "${ROOT_DIR}/k8s-manifests/system/postgres-init.sql" ]; then
  "${KUBECTL}" --context="${HUB_CTX}" create configmap postgres-init-sql \
    --from-file=init.sql="${ROOT_DIR}/k8s-manifests/system/postgres-init.sql" \
    -n kyverno-platform \
    --dry-run=client -o yaml | "${KUBECTL}" --context="${HUB_CTX}" apply -f -
fi
"${KUBECTL}" --context="${HUB_CTX}" apply -f "${ROOT_DIR}/k8s-manifests/system/postgres.yaml"
"${KUBECTL}" --context="${HUB_CTX}" rollout status deployment/postgres -n kyverno-platform --timeout=180s

# PostgreSQL 스키마 푸시 및 시드
echo ">>> Pushing DB schema and seeding initial data..."
"${KUBECTL}" --context="${HUB_CTX}" port-forward svc/postgres 5432:5432 -n kyverno-platform > /dev/null 2>&1 &
PF_PG_PID=$!
sleep 4
DATABASE_URL="postgresql://devuser:devpassword@localhost:5432/kyverno_dashboard?schema=public" pnpm --filter @kyverno-platform/backend exec prisma db push --accept-data-loss || true
DATABASE_URL="postgresql://devuser:devpassword@localhost:5432/kyverno_dashboard?schema=public" SEED_ADMIN_EMAIL="admin@test.com" SEED_ADMIN_PASSWORD="test1234!" SEED_USER_EMAIL="user@test.com" SEED_USER_PASSWORD="test1234!" pnpm --filter @kyverno-platform/backend exec prisma db seed || true
kill $PF_PG_PID 2>/dev/null || true

# Hub 백엔드 토큰 및 CA Data 추출
HUB_CA_DATA=$("${KUBECTL}" --context="${HUB_CTX}" get cm kube-root-ca.crt -n kyverno-platform -o jsonpath='{.data.ca\.crt}' 2>/dev/null | base64 -w 0 || echo "")
HUB_TOKEN=$("${KUBECTL}" --context="${HUB_CTX}" create token kyverno-backend-sa -n kyverno-platform --duration=87600h 2>/dev/null || echo "")

# Multi-Cluster JSON 생성 (NestJS ClusterProvider 호환)
KUBERNETES_CLUSTERS_JSON=$(cat <<EOF
[
  {
    "id": "${HUB_CLUSTER}",
    "displayName": "Central Governance Hub (Management Only)",
    "server": "https://kubernetes.default.svc",
    "caData": "${HUB_CA_DATA}",
    "token": "${HUB_TOKEN}",
    "exceptionNamespace": "kyverno",
    "default": true,
    "gitopsRepo": "YeongrimGo/test-for",
    "gitopsBranch": "main",
    "gitopsPath": "k8s-manifests/exceptions"
  },
  {
    "id": "external-argocd-cluster",
    "displayName": "Production Spoke Cluster (Argo CD Managed)",
    "server": "${SPOKE_SERVER}",
    "caData": "${SPOKE_CA_DATA}",
    "token": "${SPOKE_TOKEN}",
    "exceptionNamespace": "kyverno",
    "default": false,
    "gitopsRepo": "YeongrimGo/test-for",
    "gitopsBranch": "main",
    "gitopsPath": "k8s-manifests/exceptions"
  }
]
EOF
)

# backend-env-secret 생성 및 주입
echo ">>> Creating backend-env-secret with multi-cluster configuration on Hub..."
"${KUBECTL}" --context="${HUB_CTX}" create secret generic backend-env-secret \
  -n kyverno-platform \
  --from-literal=CLUSTER_PROVIDER="multi" \
  --from-literal=KUBERNETES_CLUSTERS="${KUBERNETES_CLUSTERS_JSON}" \
  --from-literal=DATABASE_URL="postgresql://devuser:devpassword@postgres:5432/kyverno_dashboard?schema=public" \
  --from-literal=JWT_SECRET="kyverno-super-secret-jwt-key-2026-production" \
  --from-literal=JWT_ACCESS_SECRET="in-cluster-jwt-access-secret-key-12345" \
  --from-literal=JWT_REFRESH_SECRET="in-cluster-jwt-refresh-secret-key-12345" \
  --from-literal=JWT_ACCESS_EXPIRES_IN="1d" \
  --from-literal=JWT_REFRESH_EXPIRES_IN="7d" \
  --from-literal=GITOPS_CI_TOKEN="test-ci-token-secret" \
  --from-literal=PLATFORM_BASE_URL="http://localhost:3000" \
  --from-literal=PORT="3001" \
  --from-literal=K8S_LEASE_NAMESPACE="kyverno-platform" \
  --from-literal=GITOPS_GITHUB_REPO="YeongrimGo/test-for" \
  --from-literal=GITOPS_GITHUB_BRANCH="main" \
  --from-literal=NODE_ENV="production" \
  --dry-run=client -o yaml | "${KUBECTL}" --context="${HUB_CTX}" apply -f -

# Hub KubeView Helm 배포
echo ">>> [Step 3.6] Deploying KubeView via Helm on Hub (${HUB_CLUSTER})..."
"${HELM}" repo add kubeview https://code.benco.io/kubeview/deploy/helm --kube-context="${HUB_CTX}" 2>/dev/null || true
"${HELM}" repo update kubeview 2>/dev/null || true
"${HELM}" upgrade --install kubeview kubeview/kubeview \
  --kube-context="${HUB_CTX}" \
  --namespace kyverno-platform \
  --set limitNamespace=""
"${KUBECTL}" --context="${HUB_CTX}" -n kyverno-platform rollout status deployment/kubeview --timeout=120s || true

# Hub 백엔드 및 프론트엔드 배포 (기존 ECR 이미지 활용)
echo ">>> [Step 3.7] Deploying Backend and Frontend to Hub using existing ECR images..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BACKEND_IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/kyverno-backend:latest"
FRONTEND_IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/kyverno-frontend:latest"

echo ">>> ECR Backend Image  : ${BACKEND_IMAGE}"
echo ">>> ECR Frontend Image : ${FRONTEND_IMAGE}"

sed "s|image: .*/kyverno-backend:.*|image: ${BACKEND_IMAGE}|g" "${ROOT_DIR}/k8s-manifests/system/backend.yaml" | "${KUBECTL}" --context="${HUB_CTX}" apply -f -
sed "s|image: .*/kyverno-frontend:.*|image: ${FRONTEND_IMAGE}|g" "${ROOT_DIR}/k8s-manifests/system/frontend.yaml" | "${KUBECTL}" --context="${HUB_CTX}" apply -f -

"${KUBECTL}" --context="${HUB_CTX}" set image deployment/kyverno-backend backend="${BACKEND_IMAGE}" -n kyverno-platform
"${KUBECTL}" --context="${HUB_CTX}" set image deployment/kyverno-frontend frontend="${FRONTEND_IMAGE}" -n kyverno-platform

echo ">>> Waiting for Backend and Frontend rollout to complete..."
"${KUBECTL}" --context="${HUB_CTX}" rollout status deployment/kyverno-backend -n kyverno-platform --timeout=180s
"${KUBECTL}" --context="${HUB_CTX}" rollout status deployment/kyverno-frontend -n kyverno-platform --timeout=180s

echo "=========================================================="
echo " Multi-Cluster Platform Deployment Finished Successfully! 🎉"
echo "=========================================================="
echo ""
echo ">>> [Port-Forward Commands for Live Demo Presentation]"
echo "1. PaC Kyverno Governance Dashboard (Hub):"
echo "   kubectl --context=${HUB_CTX} port-forward svc/kyverno-frontend 3000:3000 -n kyverno-platform"
echo "   👉 http://localhost:3000"
echo ""
echo "2. KubeView Live Topology (Spoke - Main Workloads):"
echo "   kubectl --context=${SPOKE_CTX} port-forward svc/kubeview 8080:80 -n kubeview"
echo "   👉 http://localhost:8080"
echo ""
echo "3. Argo CD Dashboard (Spoke):"
echo "   kubectl --context=${SPOKE_CTX} port-forward svc/argocd-server 8443:443 -n argocd"
echo "   👉 https://localhost:8443"
echo "=========================================================="
