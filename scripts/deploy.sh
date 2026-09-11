#!/usr/bin/env bash
# ==============================================================================
# PaC Kyverno Governance Platform - Universal Cluster Deployment Script
# ==============================================================================
# Environment-independent one-click installer supporting:
#  - AWS EKS (ALB Ingress, gp3 StorageClass, IRSA)
#  - On-Premise / Generic K8s (Bare-Metal, Kind, k3s, kubeadm, OpenShift)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_BIN="${SCRIPT_DIR}/bin"
mkdir -p "${LOCAL_BIN}"
export PATH="${LOCAL_BIN}:${PATH}"

# Default parameters
ENV_TARGET="auto"
ADMIN_EMAIL="admin@pac-kyverno.local"
ADMIN_PASSWORD=""
USER_EMAIL="user@pac-kyverno.local"
USER_PASSWORD=""
BACKEND_IMAGE="kyverno-backend:latest"
FRONTEND_IMAGE="kyverno-frontend:latest"
BUILD_LOCAL=false
UNINSTALL=false
DRY_RUN=false
NAMESPACE="kyverno-platform"
STORAGE_CLASS=""

# Color output helpers
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
BLUE="\033[0;34m"
CYAN="\033[0;36m"
NC="\033[0m"

log_info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_header()  { echo -e "\n${BOLD}${BLUE}=== $* ===${NC}\n"; }

usage() {
  cat <<HELP
Usage: $(basename "$0") [OPTIONS]

Universal one-click deployer for PaC Kyverno Governance Platform.

Options:
  -e, --env <target>          Deployment target: auto (default), eks, or onprem
  -a, --admin-email <email>   Platform administrator email (default: admin@pac-kyverno.local)
  -p, --admin-password <pwd>  Platform administrator password (auto-generated if omitted)
  --backend-image <image>     Custom backend container image (default: kyverno-backend:latest)
  --frontend-image <image>    Custom frontend container image (default: kyverno-frontend:latest)
  --storage-class <name>      Override PVC StorageClass (auto-configured per environment if omitted)
  --build                     Build Docker images locally before deploying
  --uninstall                 Teardown and delete platform deployment from the cluster
  --dry-run                   Render manifests without applying to the cluster
  -h, --help                  Display this help message

Examples:
  # Deploy with auto-detection of existing cluster:
  ./scripts/deploy.sh

  # Deploy explicitly to AWS EKS with custom admin email:
  ./scripts/deploy.sh --env eks --admin-email admin@mycompany.com

  # Build images locally and deploy to local Kind/on-prem cluster:
  ./scripts/deploy.sh --env onprem --build

  # Teardown the platform:
  ./scripts/deploy.sh --uninstall
HELP
  exit 0
}

# Parse command line options
while [[ $# -gt 0 ]]; do
  case "$1" in
    -e|--env)
      ENV_TARGET="$2"
      shift 2
      ;;
    -a|--admin-email)
      ADMIN_EMAIL="$2"
      shift 2
      ;;
    -p|--admin-password)
      ADMIN_PASSWORD="$2"
      shift 2
      ;;
    --backend-image)
      BACKEND_IMAGE="$2"
      shift 2
      ;;
    --frontend-image)
      FRONTEND_IMAGE="$2"
      shift 2
      ;;
    --storage-class)
      STORAGE_CLASS="$2"
      shift 2
      ;;
    --build)
      BUILD_LOCAL=true
      shift
      ;;
    --uninstall)
      UNINSTALL=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      log_error "Unknown option: $1"
      usage
      ;;
  esac
done

# Ensure kubectl CLI is available
find_or_install_kubectl() {
  if command -v kubectl >/dev/null 2>&1; then
    KUBECTL="kubectl"
    return 0
  fi
  if [ -x "${LOCAL_BIN}/kubectl" ]; then
    KUBECTL="${LOCAL_BIN}/kubectl"
    return 0
  fi

  log_warn "kubectl CLI not found in PATH. Attempting automatic download to ${LOCAL_BIN}..."
  KUBECTL_VER="v1.29.2"
  OS_NAME="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH_NAME="$(uname -m)"
  [ "${ARCH_NAME}" = "x86_64" ] && ARCH_NAME="amd64"
  [ "${ARCH_NAME}" = "aarch64" ] && ARCH_NAME="arm64"

  curl -sLo "${LOCAL_BIN}/kubectl" "https://dl.k8s.io/release/${KUBECTL_VER}/bin/${OS_NAME}/${ARCH_NAME}/kubectl" || {
    log_error "Failed to download kubectl. Please install kubectl manually."
    exit 1
  }
  chmod +x "${LOCAL_BIN}/kubectl"
  KUBECTL="${LOCAL_BIN}/kubectl"
  log_success "kubectl installed to ${LOCAL_BIN}/kubectl"
}

find_or_install_kubectl

# Handle uninstall request
if [ "${UNINSTALL}" = true ]; then
  log_header "Teardown Kyverno Governance Platform"
  echo "Deleting platform namespace '${NAMESPACE}' and RBAC resources..."
  "${KUBECTL}" delete namespace "${NAMESPACE}" --ignore-not-found=true
  "${KUBECTL}" delete clusterrole kyverno-backend-cluster-role --ignore-not-found=true
  "${KUBECTL}" delete clusterrolebinding kyverno-backend-cluster-role-binding --ignore-not-found=true
  log_success "Platform resources uninstalled successfully."
  exit 0
fi

log_header "PaC Kyverno Platform Universal Setup"

# 1. Verify Kubernetes connectivity
log_info "Verifying cluster connection..."
CURRENT_CONTEXT="$("${KUBECTL}" config current-context 2>/dev/null || echo "unknown")"
if [ "${CURRENT_CONTEXT}" = "unknown" ]; then
  log_error "Could not obtain current Kubernetes context. Check your KUBECONFIG setting."
  exit 1
fi
log_success "Connected to Kubernetes context: ${BOLD}${CURRENT_CONTEXT}${NC}"

# 2. Detect cluster environment (EKS vs On-Premise)
if [ "${ENV_TARGET}" = "auto" ]; then
  log_info "Auto-detecting cluster environment..."
  PROVIDER_IDS="$("${KUBECTL}" get nodes -o jsonpath='{.items[*].spec.providerID}' 2>/dev/null || echo "")"
  if echo "${CURRENT_CONTEXT}" | grep -qE "arn:aws:eks" || echo "${PROVIDER_IDS}" | grep -qE "aws://"; then
    ENV_TARGET="eks"
    log_success "Detected environment: ${BOLD}AWS EKS${NC}"
  else
    ENV_TARGET="onprem"
    log_success "Detected environment: ${BOLD}On-Premise / Generic Kubernetes${NC}"
  fi
else
  log_info "Environment target explicitly set to: ${BOLD}${ENV_TARGET}${NC}"
fi

# 3. Check Kyverno CRD availability
log_info "Checking Kyverno Policy Engine installation..."
if ! "${KUBECTL}" get crd clusterpolicies.kyverno.io >/dev/null 2>&1; then
  log_warn "Kyverno CRD (clusterpolicies.kyverno.io) was not detected in this cluster."
  echo -n "Would you like to install the official Kyverno release (v1.12.5) now? [Y/n]: "
  if [ -t 0 ]; then
    read -r KYVERNO_CHOICE
  else
    KYVERNO_CHOICE="Y"
  fi
  if [[ "${KYVERNO_CHOICE}" =~ ^[Yy]?$ ]]; then
    log_info "Installing Kyverno v1.12.5 manifests..."
    "${KUBECTL}" create -f https://github.com/kyverno/kyverno/releases/download/v1.12.5/install.yaml || true
    log_info "Waiting for Kyverno admission controller readiness..."
    "${KUBECTL}" -n kyverno rollout status deployment/kyverno-admission-controller --timeout=120s || true
    log_success "Kyverno installed successfully."
  fi
else
  log_success "Kyverno Policy Engine is present."
fi

# 4. Local image building if requested
if [ "${BUILD_LOCAL}" = true ]; then
  log_header "Building Container Images Locally"
  if ! command -v docker >/dev/null 2>&1; then
    log_error "Docker is required to build container images locally."
    exit 1
  fi
  log_info "Building backend image '${BACKEND_IMAGE}'..."
  docker build -t "${BACKEND_IMAGE}" -f "${ROOT_DIR}/apps/backend/Dockerfile" "${ROOT_DIR}"
  log_info "Building frontend image '${FRONTEND_IMAGE}'..."
  docker build -t "${FRONTEND_IMAGE}" -f "${ROOT_DIR}/apps/frontend/Dockerfile" "${ROOT_DIR}"

  # If running in local Kind cluster, load images into nodes
  if command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -q "^k8s-lab$"; then
    log_info "Loading images into Kind cluster 'k8s-lab'..."
    kind load docker-image "${BACKEND_IMAGE}" --name k8s-lab || true
    kind load docker-image "${FRONTEND_IMAGE}" --name k8s-lab || true
  fi
  log_success "Container images built successfully."
fi

# 5. Prepare namespace and secrets
log_header "Configuring Secrets & Security Credentials"
"${KUBECTL}" create namespace "${NAMESPACE}" --dry-run=client -o yaml | "${KUBECTL}" apply -f -

# Generate random secure passwords if not provided
if [ -z "${ADMIN_PASSWORD}" ]; then
  ADMIN_PASSWORD="$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 14)!A1"
fi
if [ -z "${USER_PASSWORD}" ]; then
  USER_PASSWORD="$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 14)!U1"
fi
POSTGRES_PASSWORD="$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)"
JWT_ACCESS_SECRET="$(openssl rand -base64 32)"
JWT_REFRESH_SECRET="$(openssl rand -base64 32)"
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@postgres.${NAMESPACE}.svc.cluster.local:5432/kyverno_dashboard?schema=public"

log_info "Synchronizing platform secret 'kyverno-platform-secret' in namespace '${NAMESPACE}'..."
"${KUBECTL}" create secret generic kyverno-platform-secret \
  --namespace="${NAMESPACE}" \
  --from-literal=POSTGRES_USER=postgres \
  --from-literal=POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  --from-literal=POSTGRES_DB=kyverno_dashboard \
  --from-literal=DATABASE_URL="${DATABASE_URL}" \
  --from-literal=JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET}" \
  --from-literal=JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET}" \
  --from-literal=SEED_ADMIN_EMAIL="${ADMIN_EMAIL}" \
  --from-literal=SEED_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  --from-literal=SEED_USER_EMAIL="${USER_EMAIL}" \
  --from-literal=SEED_USER_PASSWORD="${USER_PASSWORD}" \
  --dry-run=client -o yaml | "${KUBECTL}" apply -f -

# Optionally synchronize host backend .env if present
HOST_ENV="${ROOT_DIR}/apps/backend/.env"
if [ -f "${HOST_ENV}" ]; then
  log_info "Synchronizing host backend .env to 'backend-env-secret'..."
  "${KUBECTL}" create secret generic backend-env-secret \
    --namespace="${NAMESPACE}" \
    --from-env-file="${HOST_ENV}" \
    --dry-run=client -o yaml | "${KUBECTL}" apply -f -
fi

# 6. Apply manifests via Kustomize overlay
OVERLAY_DIR="${ROOT_DIR}/k8s-manifests/overlays/${ENV_TARGET}"
log_header "Applying Kubernetes Manifests (${ENV_TARGET} overlay)"

if [ "${DRY_RUN}" = true ]; then
  log_info "[DRY-RUN] Rendering manifests with kustomize:"
  "${KUBECTL}" kustomize "${OVERLAY_DIR}"
  log_success "Dry run complete."
  exit 0
fi

log_info "Applying Kustomize overlay from: ${OVERLAY_DIR}"
"${KUBECTL}" apply -k "${OVERLAY_DIR}"

# 7. Apply core governance and MLOps policies if present
POLICIES_DIR="${ROOT_DIR}/k8s-manifests/policies"
if [ -d "${POLICIES_DIR}" ]; then
  log_info "Applying default Kyverno governance policies..."
  "${KUBECTL}" apply -f "${POLICIES_DIR}/" || true
  if [ -d "${POLICIES_DIR}/mlops" ]; then
    "${KUBECTL}" apply -f "${POLICIES_DIR}/mlops/" || true
  fi
fi

# 8. Wait for workload rollouts
log_header "Verifying Rollout Status"
log_info "1/3. Waiting for PostgreSQL database to be ready..."
"${KUBECTL}" rollout status deployment/postgres -n "${NAMESPACE}" --timeout=180s

log_info "2/3. Waiting for Backend & DB Migrations to complete..."
"${KUBECTL}" rollout status deployment/kyverno-backend -n "${NAMESPACE}" --timeout=240s

log_info "3/3. Waiting for Frontend Dashboard to be ready..."
"${KUBECTL}" rollout status deployment/kyverno-frontend -n "${NAMESPACE}" --timeout=180s

# 9. Determine external access endpoint
log_header "Deployment Summary & Credentials"

INGRESS_HOST=""
if [ "${ENV_TARGET}" = "eks" ]; then
  INGRESS_HOST="$("${KUBECTL}" get ingress kyverno-ingress -n "${NAMESPACE}" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")"
  [ -z "${INGRESS_HOST}" ] && INGRESS_HOST="(AWS ALB provisioning in progress... check 'kubectl get ingress -n ${NAMESPACE}')"
  UI_URL="http://${INGRESS_HOST}"
  API_URL="http://${INGRESS_HOST}/api"
else
  # On-prem: Check NodePort or Ingress
  NODE_IP="$("${KUBECTL}" get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || echo "localhost")"
  UI_URL="http://${NODE_IP}:30080"
  API_URL="http://${NODE_IP}:30081/api"
fi

cat <<SUMMARY
==============================================================================
 ${GREEN}${BOLD}🎉 PaC Kyverno Governance Platform Successfully Deployed!${NC}
==============================================================================
 Target Environment : ${BOLD}${ENV_TARGET}${NC}
 Target Namespace   : ${BOLD}${NAMESPACE}${NC}
 Kubernetes Context : ${BOLD}${CURRENT_CONTEXT}${NC}

 ${CYAN}${BOLD}[ Access Endpoints ]${NC}
 - Frontend Dashboard : ${BOLD}${UI_URL}${NC}
 - Backend REST API   : ${BOLD}${API_URL}${NC}
 - Swagger API Docs   : ${BOLD}${API_URL}/docs${NC}

 ${YELLOW}${BOLD}[ Admin Credentials ]${NC}
 - Admin Email        : ${BOLD}${ADMIN_EMAIL}${NC}
 - Admin Password     : ${BOLD}${ADMIN_PASSWORD}${NC}

 ${YELLOW}${BOLD}[ User Credentials ]${NC}
 - User Email         : ${BOLD}${USER_EMAIL}${NC}
 - User Password      : ${BOLD}${USER_PASSWORD}${NC}

 ${BLUE}${BOLD}[ Local Port-Forwarding Alternative (Quick Access) ]${NC}
   kubectl port-forward -n ${NAMESPACE} svc/kyverno-frontend 3000:3000 &
   kubectl port-forward -n ${NAMESPACE} svc/kyverno-backend 3001:3001 &
==============================================================================
SUMMARY
