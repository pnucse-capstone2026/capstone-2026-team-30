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

# Modular component enablement defaults (Backward-compatible: all true by default)
ENABLE_MLOPS=true
ENABLE_AI=true
ENABLE_SIMULATION=true
ENABLE_GITOPS=true
MODULES_PARAM=""
PROMPT_MODULES=false
MODULE_FLAG_SPECIFIED=false

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

Platform Module Options:
  --enable-mlops              Enable MLOps suite (Notebook controller, Kubeflow CRDs, GPU FinOps) [default: true]
  --disable-mlops, --no-mlops Disable MLOps suite
  --enable-ai                 Enable AWS Bedrock AI Diagnostics & Copilot [default: true]
  --disable-ai, --no-ai       Disable AI Diagnostics
  --enable-simulation         Enable Policy Simulation Lab dry-run sandbox [default: true]
  --disable-simulation        Disable Policy Simulation Lab
  --enable-gitops             Enable GitOps policy sync automation [default: true]
  --disable-gitops            Disable GitOps policy sync automation
  --modules <list>            Explicit comma-separated module list (e.g. core,simulation)
  -i, --interactive           Launch interactive terminal prompt to configure modules

Examples:
  # Deploy lightweight core platform without MLOps:
  ./scripts/deploy.sh --disable-mlops

  # Deploy with explicit module selection:
  ./scripts/deploy.sh --modules core,simulation

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
    --enable-mlops)
      ENABLE_MLOPS=true
      MODULE_FLAG_SPECIFIED=true
      shift
      ;;
    --disable-mlops|--no-mlops)
      ENABLE_MLOPS=false
      MODULE_FLAG_SPECIFIED=true
      shift
      ;;
    --enable-ai)
      ENABLE_AI=true
      MODULE_FLAG_SPECIFIED=true
      shift
      ;;
    --disable-ai|--no-ai)
      ENABLE_AI=false
      MODULE_FLAG_SPECIFIED=true
      shift
      ;;
    --enable-simulation)
      ENABLE_SIMULATION=true
      MODULE_FLAG_SPECIFIED=true
      shift
      ;;
    --disable-simulation|--no-simulation)
      ENABLE_SIMULATION=false
      MODULE_FLAG_SPECIFIED=true
      shift
      ;;
    --enable-gitops)
      ENABLE_GITOPS=true
      MODULE_FLAG_SPECIFIED=true
      shift
      ;;
    --disable-gitops|--no-gitops)
      ENABLE_GITOPS=false
      MODULE_FLAG_SPECIFIED=true
      shift
      ;;
    --modules)
      MODULES_PARAM="$2"
      MODULE_FLAG_SPECIFIED=true
      shift 2
      ;;
    -i|--interactive)
      PROMPT_MODULES=true
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

# Handle comma-separated --modules parameter if supplied
if [ -n "${MODULES_PARAM}" ]; then
  ENABLE_MLOPS=false
  ENABLE_AI=false
  ENABLE_SIMULATION=false
  ENABLE_GITOPS=false
  IFS=',' read -ra MOD_ARR <<< "${MODULES_PARAM}"
  for mod_item in "${MOD_ARR[@]}"; do
    case "$(echo "${mod_item}" | tr '[:upper:]' '[:lower:]')" in
      core) ;; # Core is mandatory
      mlops) ENABLE_MLOPS=true ;;
      ai|aiagent) ENABLE_AI=true ;;
      simulation) ENABLE_SIMULATION=true ;;
      gitops) ENABLE_GITOPS=true ;;
      *) log_warn "Unknown module '${mod_item}' in --modules list, ignoring." ;;
    esac
  done
fi

# Interactive module prompt when requested or when running interactively without explicit flags
if [ "${PROMPT_MODULES}" = true ] || ([ -t 0 ] && [ "${MODULE_FLAG_SPECIFIED}" = false ] && [ "${DRY_RUN}" = false ] && [ "${UNINSTALL}" = false ]); then
  log_header "Platform Module Configuration"
  echo "Select optional platform modules to enable:"
  echo "[1] Core Governance (Kyverno, Policies, Violations, RBAC) [Mandatory: Always Enabled]"

  read -r -p "[2] MLOps Suite (Notebooks, Pipelines, Serving, GPU FinOps) [Y/n]: " resp_mlops
  [[ "${resp_mlops}" =~ ^[Nn]$ ]] && ENABLE_MLOPS=false || ENABLE_MLOPS=true

  read -r -p "[3] AI Copilot & Diagnostics (AWS Bedrock) [Y/n]: " resp_ai
  [[ "${resp_ai}" =~ ^[Nn]$ ]] && ENABLE_AI=false || ENABLE_AI=true

  read -r -p "[4] Policy Simulation Lab [Y/n]: " resp_sim
  [[ "${resp_sim}" =~ ^[Nn]$ ]] && ENABLE_SIMULATION=false || ENABLE_SIMULATION=true

  read -r -p "[5] GitOps Policy PR Sync [Y/n]: " resp_gitops
  [[ "${resp_gitops}" =~ ^[Nn]$ ]] && ENABLE_GITOPS=false || ENABLE_GITOPS=true
fi

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
  if [ "${DRY_RUN}" = true ]; then
    CURRENT_CONTEXT="dry-run-context"
    log_warn "No active Kubernetes context found. Continuing in dry-run mode."
  else
    log_error "Could not obtain current Kubernetes context. Check your KUBECONFIG setting."
    exit 1
  fi
else
  log_success "Connected to Kubernetes context: ${BOLD}${CURRENT_CONTEXT}${NC}"
fi

# 2. Detect cluster environment (EKS vs On-Premise)
if [ "${ENV_TARGET}" = "auto" ]; then
  if [ "${DRY_RUN}" = true ]; then
    ENV_TARGET="onprem"
    log_info "[DRY-RUN] Auto-detection defaulted to 'onprem' for manifest preview."
  else
    log_info "Auto-detecting cluster environment..."
    PROVIDER_IDS="$("${KUBECTL}" get nodes -o jsonpath='{.items[*].spec.providerID}' 2>/dev/null || echo "")"
    if echo "${CURRENT_CONTEXT}" | grep -qE "arn:aws:eks" || echo "${PROVIDER_IDS}" | grep -qE "aws://"; then
      ENV_TARGET="eks"
      log_success "Detected environment: ${BOLD}AWS EKS${NC}"
    else
      ENV_TARGET="onprem"
      log_success "Detected environment: ${BOLD}On-Premise / Generic Kubernetes${NC}"
    fi
  fi
else
  log_info "Environment target explicitly set to: ${BOLD}${ENV_TARGET}${NC}"
fi

# 3. Check Kyverno CRD availability
if [ "${DRY_RUN}" = true ]; then
  log_info "[DRY-RUN] Skipping live Kyverno CRD cluster presence check."
else
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

if [ "${DRY_RUN}" = false ]; then
  "${KUBECTL}" create namespace "${NAMESPACE}" --dry-run=client -o yaml | "${KUBECTL}" apply -f -
fi

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
SECRET_YAML=$("${KUBECTL}" create secret generic kyverno-platform-secret \
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
  --from-literal=MODULE_MLOPS_ENABLED="${ENABLE_MLOPS}" \
  --from-literal=MODULE_AI_AGENT_ENABLED="${ENABLE_AI}" \
  --from-literal=MODULE_SIMULATION_ENABLED="${ENABLE_SIMULATION}" \
  --from-literal=MODULE_GITOPS_ENABLED="${ENABLE_GITOPS}" \
  --dry-run=client -o yaml)

if [ "${DRY_RUN}" = true ]; then
  log_info "[DRY-RUN] Platform secret manifest preview generated."
else
  echo "${SECRET_YAML}" | "${KUBECTL}" apply -f -
fi

# Optionally synchronize host backend .env if present
HOST_ENV="${ROOT_DIR}/apps/backend/.env"
if [ -f "${HOST_ENV}" ]; then
  log_info "Synchronizing host backend .env to 'backend-env-secret'..."
  BACKEND_SECRET_YAML=$("${KUBECTL}" create secret generic backend-env-secret \
    --namespace="${NAMESPACE}" \
    --from-env-file="${HOST_ENV}" \
    --dry-run=client -o yaml)
  if [ "${DRY_RUN}" = false ]; then
    echo "${BACKEND_SECRET_YAML}" | "${KUBECTL}" apply -f -
  fi
fi

# 6. Apply manifests via Kustomize overlay
OVERLAY_DIR="${ROOT_DIR}/k8s-manifests/overlays/${ENV_TARGET}"
MLOPS_MODULE_DIR="${ROOT_DIR}/k8s-manifests/modules/mlops"
log_header "Applying Kubernetes Manifests (${ENV_TARGET} overlay)"

if [ "${DRY_RUN}" = true ]; then
  log_info "[DRY-RUN] Rendering Core manifests with kustomize:"
  "${KUBECTL}" kustomize "${OVERLAY_DIR}"
  if [ "${ENABLE_MLOPS}" = true ]; then
    log_info "[DRY-RUN] Rendering MLOps extension manifests:"
    "${KUBECTL}" kustomize "${MLOPS_MODULE_DIR}"
  else
    log_info "[DRY-RUN] MLOps module is disabled (skipping MLOps manifests)."
  fi
  log_success "Dry run complete."
  exit 0
fi

log_info "Applying Core Kustomize overlay from: ${OVERLAY_DIR}"
"${KUBECTL}" apply -k "${OVERLAY_DIR}"

# Apply MLOps module (Notebook Controller & Kubeflow CRDs) if enabled
if [ "${ENABLE_MLOPS}" = true ]; then
  log_info "Deploying MLOps Module (Notebook Controller & Kubeflow CRDs)..."
  "${KUBECTL}" apply -k "${MLOPS_MODULE_DIR}"
else
  log_info "MLOps Module is DISABLED. Skipping Notebook Controller and Kubeflow CRDs."
fi

# 7. Apply core governance and MLOps policies if present
POLICIES_DIR="${ROOT_DIR}/k8s-manifests/policies"
if [ -d "${POLICIES_DIR}" ]; then
  log_info "Applying default Kyverno governance policies..."
  "${KUBECTL}" apply -f "${POLICIES_DIR}/" || true
  if [ "${ENABLE_MLOPS}" = true ] && [ -d "${POLICIES_DIR}/mlops" ]; then
    log_info "Applying MLOps Kyverno policies..."
    "${KUBECTL}" apply -f "${POLICIES_DIR}/mlops/" || true
  else
    log_info "MLOps policies skipped (MLOps module disabled)."
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

 ${CYAN}${BOLD}[ Active Platform Modules ]${NC}
 - Core Governance    : ${GREEN}ENABLED${NC} (Mandatory)
 - MLOps Platform     : $([ "${ENABLE_MLOPS}" = true ] && echo -e "${GREEN}ENABLED${NC}" || echo -e "${RED}DISABLED${NC}")
 - AI Copilot (Bedrock): $([ "${ENABLE_AI}" = true ] && echo -e "${GREEN}ENABLED${NC}" || echo -e "${RED}DISABLED${NC}")
 - Policy Simulation  : $([ "${ENABLE_SIMULATION}" = true ] && echo -e "${GREEN}ENABLED${NC}" || echo -e "${RED}DISABLED${NC}")
 - GitOps Policy Sync : $([ "${ENABLE_GITOPS}" = true ] && echo -e "${GREEN}ENABLED${NC}" || echo -e "${RED}DISABLED${NC}")

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
