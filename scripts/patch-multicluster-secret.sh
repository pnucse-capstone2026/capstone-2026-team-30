#!/usr/bin/env bash
# ==============================================================================
# Hub 클러스터 backend-env-secret에 멀티클러스터 설정(Hub & Spoke)을 주입하는 스크립트
# ==============================================================================
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KUBECTL="${SCRIPT_DIR}/bin/kubectl"
if [ ! -f "${KUBECTL}" ]; then
  KUBECTL="kubectl"
fi

HUB_CTX=$("${KUBECTL}" config get-contexts -o name | grep -E "kyverno-eks-lab.*eksctl\.io" | head -n 1)
SPOKE_CTX=$("${KUBECTL}" config get-contexts -o name | grep -E "kyverno-eks-spoke-01.*eksctl\.io" | head -n 1)

echo ">>> Hub Context: ${HUB_CTX}"
echo ">>> Spoke Context: ${SPOKE_CTX}"

# Hub 정보
HUB_CA_DATA=$("${KUBECTL}" --context="${HUB_CTX}" get cm kube-root-ca.crt -n kyverno-platform -o jsonpath='{.data.ca\.crt}' 2>/dev/null | base64 -w 0 || echo "")
HUB_TOKEN=$("${KUBECTL}" --context="${HUB_CTX}" create token kyverno-backend-sa -n kyverno-platform --duration=87600h 2>/dev/null || echo "")

# Spoke 정보
SPOKE_SERVER=$("${KUBECTL}" --context="${SPOKE_CTX}" cluster-info 2>/dev/null | grep -o 'https://[^ ]*' | head -n 1 | sed -r "s/\x1B\[([0-9]{1,2}(;[0-9]{1,2})?)?[mGK]//g" || echo "")
SPOKE_CA_DATA=$("${KUBECTL}" --context="${SPOKE_CTX}" get cm kube-root-ca.crt -n kyverno -o jsonpath='{.data.ca\.crt}' 2>/dev/null | base64 -w 0 || echo "")
SPOKE_TOKEN=$("${KUBECTL}" --context="${SPOKE_CTX}" create token kyverno-remote-agent-sa -n kyverno --duration=87600h 2>/dev/null || echo "")

KUBERNETES_CLUSTERS_JSON=$(cat <<EOF
[
  {
    "id": "kyverno-eks-lab",
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

echo ">>> Patching backend-env-secret in kyverno-platform..."
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
  --from-literal=K8S_LEASE_NAMESPACE="kyverno-platform" \
  --from-literal=GITOPS_GITHUB_REPO="YeongrimGo/test-for" \
  --from-literal=GITOPS_GITHUB_BRANCH="main" \
  --from-literal=NODE_ENV="production" \
  --from-literal=PORT="3001" \
  --dry-run=client -o yaml | "${KUBECTL}" --context="${HUB_CTX}" apply -f -

echo ">>> Successfully updated backend-env-secret with Multi-Cluster configuration."
