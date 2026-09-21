# Chapter 6: Infrastructure, Deployment & Verification Guide

> **Document Version**: v1.0.0  
> **Target Platform**: Kubernetes v1.28+, Kyverno v1.12+, AWS EKS, On-Premise Bare-Metal / Kind  
> **Last Updated**: 2026-09-11  
> **Scope**: Infrastructure as Code (IaC), Universal Deployment Automation, Multi-Stage Containerization, Cluster Testing & Day-2 Operations  

---

## Table of Contents

1. [Architectural Overview & Scope](#1-architectural-overview--scope)
   - 1.1. [Deployment Topology Matrix](#11-deployment-topology-matrix)
   - 1.2. [High-Level Infrastructure Architecture](#12-high-level-infrastructure-architecture)
2. [Universal One-Click Deployment Engine](#2-universal-one-click-deployment-engine)
   - 2.1. [Installer Architecture (`install.sh` / `scripts/deploy.sh`)](#21-installer-architecture-installsh--scriptsdeploysh)
   - 2.2. [Environment Auto-Detection Engine](#22-environment-auto-detection-engine)
   - 2.3. [CLI Flags & Parameter Specification](#23-cli-flags--parameter-specification)
   - 2.4. [Self-Bootstrapping CLI Toolchain](#24-self-bootstrapping-cli-toolchain)
   - 2.5. [Kyverno Policy Engine Validation & Auto-Installation](#25-kyverno-policy-engine-validation--auto-installation)
   - 2.6. [Dynamic Cryptographic Credential & Secret Generation](#26-dynamic-cryptographic-credential--secret-generation)
   - 2.7. [Workload Rollout & Health Probing Pipeline](#27-workload-rollout--health-probing-pipeline)
   - 2.8. [Dynamic Endpoint Resolution & Output Summary](#28-dynamic-endpoint-resolution--output-summary)
   - 2.9. [Rapid Redeployment Loop (`redeploy.sh`)](#29-rapid-redeployment-loop-re舞台deploysh)
3. [Kubernetes Manifests & Kustomize Architecture](#3-kubernetes-manifests--kustomize-architecture)
   - 3.1. [Manifest Directory Layout & Separation of Concerns](#31-manifest-directory-layout--separation-of-concerns)
   - 3.2. [Modular Base Manifests (`k8s-manifests/base/`)](#32-modular-base-manifests-k8s-manifestsbase)
     - `namespace.yaml`: Platform Isolation
     - `rbac.yaml`: Least-Privilege In-Cluster RBAC
     - `postgres.yaml`: Persistent Database Service
     - `backend.yaml`: NestJS Engine & InitContainer DB Migration
     - `frontend.yaml`: Next.js Standalone Dashboard
     - `notebook-controller.yaml`: Kubeflow Notebook Provisioner
   - 3.3. [AWS EKS Production Overlay (`k8s-manifests/overlays/eks/`)](#33-aws-eks-production-overlay-k8s-manifestsoverlayseks)
     - ALB Ingress Controller Specification (`ingress-alb.yaml`)
     - Dynamic StorageClass Patch (`storage-patch.yaml`)
     - Bedrock IRSA Security Pipeline (`scripts/setup-bedrock-irsa.sh`)
   - 3.4. [On-Premise / Generic Kubernetes Overlay (`k8s-manifests/overlays/onprem/`)](#34-on-premise--generic-kubernetes-overlay-k8s-manifestsoverlaysonprem)
     - Ingress-Nginx Configuration (`ingress-nginx.yaml`)
     - NodePort Direct Service Mapping (`nodeport-services.yaml`)
4. [Local Development Environment & Containerization](#4-local-development-environment--containerization)
   - 4.1. [Kind Single-Node Bare-Minimum Setup (`scripts/setup-local-cluster.sh`)](#41-kind-single-node-bare-minimum-setup-scriptssetup-local-clustersh)
     - Minimal vs Full Mode Trade-Offs
     - Zero-I/O Optimization (BackgroundScan Throttling)
   - 4.2. [Standalone Installation & Deployment Pipeline (`install.sh`)](#42-standalone-installation--deployment-pipeline-installsh)
     - Universal One-Click Deployment (`install.sh` / `scripts/deploy.sh`)
     - Monorepo Scope & Target Environment Detection
     - Automated Database Provisioning & Health Verification
   - 4.3. [Docker Multi-Stage Optimization (`node:22-slim`)](#43-docker-multi-stage-optimization-node22-slim)
     - Backend Build Pipeline (`apps/backend/Dockerfile`)
     - Frontend Standalone Shrinking (`apps/frontend/Dockerfile`)
     - Layer Caching, Monorepo Scope, and Non-Root Security
5. [Testing & Verification Suite](#5-testing--verification-suite)
   - 5.1. [Bare-Minimum Single & Multi-Cluster Kind Test Runners (`scripts/tests/`)](#51-bare-minimum-single--multi-cluster-kind-test-runners-scriptstests)
     - Single-Cluster Bare Runner (`run-bare-single-cluster-test.sh`)
     - Literal Multi-Cluster Runner (`run-bare-multicluster-test.sh`)
     - Zero-Bloat Disk Reclamation (`cleanup-all-test-clusters.sh`)
   - 5.2. [Full-Lifecycle E2E Cluster Test Runner (`scripts/run-e2e-cluster-test.sh`)](#52-full-lifecycle-e2e-cluster-test-runner-scriptsrun-e2e-cluster-testsh)
     - Execution Lifecycle (Scenarios 1 through 6)
     - Automated Diagnostic Log Dumps & Crash Triage
   - 5.3. [Backend Integration Test Suite (`apps/backend/test/`)](#53-backend-integration-test-suite-appsbackendtest)
6. [Operational Playbook & Day-2 Operations](#6-operational-playbook--day-2-operations)
   - 6.1. [Common CLI Diagnostics & Troubleshooting Cheat Sheet](#61-common-cli-diagnostics--troubleshooting-cheat-sheet)
   - 6.2. [Kyverno Admission Webhook & Latency Troubleshooting](#62-kyverno-admission-webhook--latency-troubleshooting)
   - 6.3. [Database Migration, Schema Updates & Rollbacks](#63-database-migration-schema-updates--rollbacks)
   - 6.4. [Platform Teardown & Clean Uninstall Procedure](#64-platform-teardown--clean-uninstall-procedure)

---

## 1. Architectural Overview & Scope

The **PaC Kyverno Governance Platform** provides centralized Kubernetes policy management, policy exception lifecycles, GitOps automation, and generative AI remediation across enterprise Kubernetes clusters. Because production topologies vary drastically—from managed multi-node cloud environments to air-gapped bare-metal racks and developer laptops—the platform's deployment architecture enforces strict decoupling between **generic base workloads** and **environment-specific infrastructure overlays**.

### 1.1. Deployment Topology Matrix

| Environment Target | Target Runtime | Storage Provisioner | Ingress & Routing | Security / Identity | Deployment Script Option |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **AWS EKS Production** | AWS EKS Multi-Node (Managed Node Groups / Karpenter) | AWS EBS CSI Driver (`gp3` / `gp2`) | AWS Load Balancer Controller (ALB `target-type: ip`) | AWS IAM Roles for Service Accounts (IRSA) + OIDC | `install.sh --env eks` |
| **On-Premise / Bare-Metal** | kubeadm, k3s, OpenShift, VMware Tanzu | Default CSI / Local Path Provisioner | Ingress-Nginx or Direct NodePort (30080/30081) | In-Cluster ServiceAccount Tokens / X.509 PKI | `install.sh --env onprem` |
| **Local Kind Development** | Kind (Kubernetes in Docker) Single-Node | Standard HostPath (`rancher.io/local-path`) | NodePort (30080/30081) or `kubectl port-forward` | Local `k8s-lab` ServiceAccount & Docker Engine | `install.sh --env onprem --build` |

---

### 1.2. High-Level Infrastructure Architecture

```mermaid
flowchart TD
    subgraph ClientAccess["Client & Developer Layer"]
        DevBrowser["Web Browser (User / Admin)"]
        K8sCLI["kubectl / DevContainer CLI"]
    end

    subgraph EntryPoint["Entrypoint & Routing Layer"]
        EKS_ALB["AWS Application Load Balancer (ALB Ingress)"]
        OnPrem_Ingress["Ingress-Nginx Controller"]
        NodePortSvc["Direct NodePort (30080 / 30081)"]
    end

    subgraph PlatformNamespace["Namespace: kyverno-platform"]
        FrontendPod["kyverno-frontend Pod (Next.js Standalone :3000)"]
        BackendPod["kyverno-backend Pod (NestJS REST API :3001)"]
        PostgresPod["postgres Pod (PostgreSQL 16 Alpine :5432)"]
        PlatformSecret["Secret: kyverno-platform-secret"]
        PlatformPVC["PVC: postgres-pvc (10Gi gp3 / local-path)"]
    end

    subgraph ControlPlane["Kubernetes Control Plane & Kyverno"]
        K8sAPIServer["kube-apiserver"]
        KyvernoAdmission["kyverno-admission-controller"]
        KyvernoReports["kyverno-reports-controller"]
        CRD_CP["CRD: clusterpolicies.kyverno.io"]
        CRD_PE["CRD: policyexceptions.kyverno.io"]
        CRD_PR["CRD: policyreports.wgpolicyk8s.io"]
    end

    subgraph CloudServices["Cloud & External Services"]
        AWS_Bedrock["Amazon Bedrock (Claude 3.5 Sonnet / Nova Lite)"]
        GitHub_Remote["GitHub Repository (GitOps PR Automation)"]
    end

    DevBrowser -->|HTTP/HTTPS| EKS_ALB
    DevBrowser -->|HTTP/HTTPS| OnPrem_Ingress
    DevBrowser -->|Direct Port| NodePortSvc

    EKS_ALB -->|/api, /notebook| BackendPod
    EKS_ALB -->|/| FrontendPod
    OnPrem_Ingress -->|/api, /notebook| BackendPod
    OnPrem_Ingress -->|/| FrontendPod
    NodePortSvc --> FrontendPod
    NodePortSvc --> BackendPod

    FrontendPod -->|Reverse Proxy / ClusterIP| BackendPod
    BackendPod -->|PostgreSQL Wire Protocol| PostgresPod
    PostgresPod --> PlatformPVC

    BackendPod -->|IRSA / STS WebIdentityToken| AWS_Bedrock
    BackendPod -->|HTTPS REST / Octokit| GitHub_Remote
    BackendPod -->|In-Cluster Kubeconfig / SA| K8sAPIServer

    K8sAPIServer <--> KyvernoAdmission
    K8sAPIServer <--> KyvernoReports
    KyvernoAdmission -.->|Validates / Mutates| CRD_CP
    KyvernoAdmission -.->|Evaluates Exceptions| CRD_PE
    KyvernoReports -.->|Generates Audits| CRD_PR
```

---

## 2. Universal One-Click Deployment Engine

The repository provides a single, unified entry point for zero-friction platform provisioning: [`install.sh`](file:///home/user/work_dir/install.sh), mirrored via [`scripts/deploy.sh`](file:///home/user/work_dir/scripts/deploy.sh).

### 2.1. Installer Architecture (`install.sh` / `scripts/deploy.sh`)

Both scripts share identical logic and implement the following execution pipeline:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Platform Operator
    participant Script as install.sh / deploy.sh
    participant Toolchain as Local Toolchain (scripts/bin)
    participant K8s as Target Kubernetes Cluster
    participant Registry as Container Engine / Docker
    participant Kyverno as Kyverno Policy Engine

    Admin->>Script: Execute ./install.sh [OPTIONS]
    Script->>Toolchain: Verify or auto-install kubectl (v1.29.2)
    Script->>K8s: Test connection & extract current context
    Script->>K8s: Auto-detect provider (EKS vs On-Prem/Kind)
    Script->>K8s: Check crd/clusterpolicies.kyverno.io
    alt Kyverno Not Present
        Script->>Kyverno: Prompt & auto-install Kyverno v1.12.5 release
        Script->>Kyverno: Await deployment/kyverno-admission-controller rollout
    end
    opt Local Build Requested (--build)
        Script->>Registry: docker build backend & frontend images
        Script->>K8s: If Kind cluster, load images via 'kind load'
    end
    Script->>K8s: Create namespace 'kyverno-platform'
    Script->>Script: Generate cryptographically secure passwords & JWT keys
    Script->>K8s: Apply Secret 'kyverno-platform-secret'
    Script->>K8s: Execute 'kubectl apply -k k8s-manifests/overlays/<target>'
    Script->>K8s: Apply policies & testbed resources
    Script->>K8s: Wait for PostgreSQL, Backend, and Frontend rollouts
    Script->>Admin: Display deployment summary, credentials & access URLs
```

---

### 2.2. Environment Auto-Detection Engine

When invoked without explicit target flags (`-e auto`), the installer examines the active cluster node specifications and context strings:

```bash
# Inspection logic excerpt from install.sh (lines 181-195)
if [ "${ENV_TARGET}" = "auto" ]; then
  log_info "Auto-detecting cluster environment..."
  PROVIDER_IDS="$("${KUBECTL}" get nodes -o jsonpath='{.items[*].spec.providerID}' 2>/dev/null || echo "")"
  if echo "${CURRENT_CONTEXT}" | grep -qE "arn:aws:eks" || echo "${PROVIDER_IDS}" | grep -qE "aws://"; then
    ENV_TARGET="eks"
    log_success "Detected environment: AWS EKS"
  else
    ENV_TARGET="onprem"
    log_success "Detected environment: On-Premise / Generic Kubernetes"
  fi
fi
```

1. **EKS Detection**: Matches `arn:aws:eks` within `kubectl config current-context` or detects node `spec.providerID` strings prefixed with `aws://`. Automatically activates [`k8s-manifests/overlays/eks`](file:///home/user/work_dir/k8s-manifests/overlays/eks).
2. **On-Premise / Kind Detection**: Fallback for any cluster without AWS metadata (Kind, k3s, kubeadm, bare-metal). Activates [`k8s-manifests/overlays/onprem`](file:///home/user/work_dir/k8s-manifests/overlays/onprem).

---

### 2.3. CLI Flags & Parameter Specification

The installer supports granular override flags for CI/CD pipelines, headless executions, and production deployments:

| Flag | Long Option | Default Value | Description |
| :--- | :--- | :--- | :--- |
| `-e` | `--env <target>` | `auto` | Target overlay: `auto`, `eks`, or `onprem`. |
| `-a` | `--admin-email <email>` | `admin@pac-kyverno.local` | Platform administrator account email seeded into PostgreSQL. |
| `-p` | `--admin-password <pwd>` | *(Auto-generated)* | Platform administrator password. If omitted, generated via `openssl`. |
| `--` | `--backend-image <image>` | `kyverno-backend:latest` | Custom container image for the NestJS backend workload. |
| `--` | `--frontend-image <image>` | `kyverno-frontend:latest` | Custom container image for the Next.js frontend workload. |
| `--` | `--storage-class <name>` | *(Auto per overlay)* | Override PVC StorageClass (e.g., `gp3`, `standard`, `local-path`). |
| `--` | `--build` | `false` | Trigger local `docker build` and auto-load images if Kind is running. |
| `--` | `--uninstall` | `false` | Clean teardown: removes `kyverno-platform` namespace, ClusterRoles & bindings. |
| `--` | `--dry-run` | `false` | Renders Kustomize overlay manifests to stdout without applying to the cluster. |
| `-h` | `--help` | — | Prints command usage and execution examples. |

---

### 2.4. Self-Bootstrapping CLI Toolchain

To guarantee zero dependencies on root (`sudo`) access or pre-installed host packages, [`install.sh`](file:///home/user/work_dir/install.sh) incorporates a local bootstrapping routine:

```bash
# Self-bootstrapping kubectl routine (lines 131-157)
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

  curl -sLo "${LOCAL_BIN}/kubectl" "https://dl.k8s.io/release/${KUBECTL_VER}/bin/${OS_NAME}/${ARCH_NAME}/kubectl"
  chmod +x "${LOCAL_BIN}/kubectl"
  KUBECTL="${LOCAL_BIN}/kubectl"
}
```

Downloaded binaries are isolated inside `scripts/bin` and added to `PATH` for the duration of the script execution.

---

### 2.5. Kyverno Policy Engine Validation & Auto-Installation

Before deploying the platform, the installer validates the presence of the Kyverno admission controller:

1. Checks CRD existence:
   ```bash
   kubectl get crd clusterpolicies.kyverno.io
   ```
2. If missing, prompts the operator (or defaults to `Y` in non-interactive/CI sessions) and deploys official release manifests:
   ```bash
   kubectl create -f https://github.com/kyverno/kyverno/releases/download/v1.12.5/install.yaml
   kubectl -n kyverno rollout status deployment/kyverno-admission-controller --timeout=120s
   ```

---

### 2.6. Dynamic Cryptographic Credential & Secret Generation

The script dynamically provisions strong random credentials for all database, JWT, and application accounts using OpenSSL:

```bash
# Lines 242-267 of install.sh
ADMIN_PASSWORD="$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 14)!A1"
USER_PASSWORD="$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 14)!U1"
POSTGRES_PASSWORD="$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)"
JWT_ACCESS_SECRET="$(openssl rand -base64 32)"
JWT_REFRESH_SECRET="$(openssl rand -base64 32)"
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@postgres.${NAMESPACE}.svc.cluster.local:5432/kyverno_dashboard?schema=public"
```

The installer then applies `kyverno-platform-secret` in the `kyverno-platform` namespace:

```bash
kubectl create secret generic kyverno-platform-secret \
  --namespace="kyverno-platform" \
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
  --dry-run=client -o yaml | kubectl apply -f -
```

If a developer `.env` file exists at [`apps/backend/.env`](file:///home/user/work_dir/apps/backend/.env), the installer automatically mirrors it into Kubernetes as `backend-env-secret` via `--from-env-file`.

---

### 2.7. Workload Rollout & Health Probing Pipeline

Deployment manifests are applied via Kustomize:

```bash
kubectl apply -k k8s-manifests/overlays/${ENV_TARGET}
```

The script monitors three distinct rollout stages with bounded timeouts:

```bash
# 1. PostgreSQL Database
kubectl rollout status deployment/postgres -n kyverno-platform --timeout=180s

# 2. NestJS Backend & Automated Prisma DB Migrations (via initContainer)
kubectl rollout status deployment/kyverno-backend -n kyverno-platform --timeout=240s

# 3. Next.js Frontend Dashboard
kubectl rollout status deployment/kyverno-frontend -n kyverno-platform --timeout=180s
```

---

### 2.8. Dynamic Endpoint Resolution & Output Summary

Upon rollout completion, the installer resolves the external URL according to the chosen environment target:

- **EKS**: Queries the AWS ALB hostname from the Ingress status:
  ```bash
  INGRESS_HOST=$(kubectl get ingress kyverno-ingress -n kyverno-platform -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
  ```
- **On-Premise / Kind**: Queries the primary node's internal IP and outputs NodePort endpoints (`http://<NodeIP>:30080` and `http://<NodeIP>:30081/api`).

**Sample Output Summary Banner**:

```text
==============================================================================
 🎉 PaC Kyverno Governance Platform Successfully Deployed!
==============================================================================
 Target Environment : onprem
 Target Namespace   : kyverno-platform
 Kubernetes Context : kind-k8s-lab

 [ Access Endpoints ]
 - Frontend Dashboard : http://172.18.0.2:30080
 - Backend REST API   : http://172.18.0.2:30081/api
 - Swagger API Docs   : http://172.18.0.2:30081/api/docs

 [ Admin Credentials ]
 - Admin Email        : admin@pac-kyverno.local
 - Admin Password     : k9XvA209mLaQ!A1

 [ User Credentials ]
 - User Email         : user@pac-kyverno.local
 - User Password      : zT84vBm021Lx!U1

 [ Local Port-Forwarding Alternative (Quick Access) ]
   kubectl port-forward -n kyverno-platform svc/kyverno-frontend 3000:3000 &
   kubectl port-forward -n kyverno-platform svc/kyverno-backend 3001:3001 &
==============================================================================
```

---

### 2.9. Rapid Redeployment Loop (`redeploy.sh`)

For day-to-day development iterations, [`redeploy.sh`](file:///home/user/work_dir/redeploy.sh) acts as a high-speed wrapper around the deployment pipeline:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/scripts/deploy.sh" --env onprem --build "$@"
```

Executing `./redeploy.sh` rebuilds local Docker containers, updates the in-cluster images, refreshes configuration manifests, and checks rollout health in a single command.

---

## 3. Kubernetes Manifests & Kustomize Architecture

The platform manifests adhere strictly to the **Kustomize Base/Overlay pattern**, isolating common declarative requirements from infrastructure provider specifics.

```mermaid
graph TD
    subgraph Base["k8s-manifests/base/"]
        BaseKust["kustomization.yaml"]
        Namespace["namespace.yaml"]
        RBAC["rbac.yaml"]
        Postgres["postgres.yaml"]
        Backend["backend.yaml"]
        Frontend["frontend.yaml"]
        Notebook["notebook-controller.yaml"]
    end

    subgraph OverlayEKS["k8s-manifests/overlays/eks/"]
        EKSKust["kustomization.yaml"]
        EKS_ALB["ingress-alb.yaml"]
        EKS_Storage["storage-patch.yaml (gp3)"]
    end

    subgraph OverlayOnPrem["k8s-manifests/overlays/onprem/"]
        OnPremKust["kustomization.yaml"]
        OnPrem_Nginx["ingress-nginx.yaml"]
        OnPrem_NodePort["nodeport-services.yaml (30080/30081)"]
    end

    BaseKust --> Namespace
    BaseKust --> RBAC
    BaseKust --> Postgres
    BaseKust --> Backend
    BaseKust --> Frontend
    BaseKust --> Notebook

    EKSKust -->|inherits| BaseKust
    EKSKust --> EKS_ALB
    EKSKust --> EKS_Storage

    OnPremKust -->|inherits| BaseKust
    OnPremKust --> OnPrem_Nginx
    OnPremKust --> OnPrem_NodePort
```

---

### 3.1. Manifest Directory Layout & Separation of Concerns

```text
k8s-manifests/
├── base/                                # Universal, environment-agnostic core manifests
│   ├── kustomization.yaml               # Aggregates all base resources
│   ├── namespace.yaml                   # Platform namespace definition
│   ├── rbac.yaml                        # In-Cluster ClusterRole, ServiceAccount & Binding
│   ├── postgres.yaml                    # Database Deployment, Service & 10Gi PVC
│   ├── backend.yaml                     # NestJS Backend, InitContainer migrations & Service
│   ├── frontend.yaml                    # Next.js Standalone frontend Deployment & Service
│   └── notebook-controller.yaml         # Kubeflow v1.8.0 Notebook Controller & CRDs
├── overlays/
│   ├── eks/                             # Production AWS EKS customizations
│   │   ├── kustomization.yaml           # Ingress-alb & storage-patch reference
│   │   ├── ingress-alb.yaml             # AWS ALB Ingress with path-based routing
│   │   └── storage-patch.yaml           # JSON patch setting storageClassName: gp3
│   └── onprem/                          # On-Premise / Bare-Metal / Kind customizations
│       ├── kustomization.yaml           # Ingress-nginx & nodeport-services reference
│       ├── ingress-nginx.yaml           # Ingress-Nginx with 300s timeouts & 64m body size
│       └── nodeport-services.yaml       # NodePort 30080 (UI) & 30081 (API) definitions
├── crds/                                # Raw CRD definitions (e.g. kubeflow.org_notebooks.yaml)
├── exceptions/                          # Default & sample PolicyException CRDs
├── policies/                            # Production & MLOps Kyverno policies
│   ├── disallow-latest-tag.yaml
│   ├── disallow-privileged-containers.yaml
│   ├── require-resource-limits.yaml
│   ├── restrict-image-registries.yaml
│   └── mlops/                           # GPU limit & Spot node selector policies
└── testbed/                             # Validation workloads & attack simulation pods
```

---

### 3.2. Modular Base Manifests (`k8s-manifests/base/`)

#### 1. Namespace Isolation ([`base/namespace.yaml`](file:///home/user/work_dir/k8s-manifests/base/namespace.yaml))
Defines the `kyverno-platform` namespace with metadata labels:
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: kyverno-platform
  labels:
    app.kubernetes.io/name: kyverno-platform
    app.kubernetes.io/part-of: kyverno-governance-platform
```

#### 2. In-Cluster RBAC ([`base/rbac.yaml`](file:///home/user/work_dir/k8s-manifests/base/rbac.yaml))
To enforce least-privilege principles, the backend runs under the `kyverno-backend-sa` ServiceAccount bound to `kyverno-backend-cluster-role`. The ClusterRole explicitly grants access only to the necessary API groups:

```yaml
rules:
  # PolicyExceptions: full lifecycle for exception requests and approvals
  - apiGroups: ["kyverno.io"]
    resources: ["policyexceptions"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]

  # Policies & ClusterPolicies: inspection and mutation
  - apiGroups: ["kyverno.io"]
    resources: ["clusterpolicies", "policies"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]

  # PolicyReports & ClusterPolicyReports: audit data collection
  - apiGroups: ["wgpolicyk8s.io"]
    resources: ["policyreports", "clusterpolicyreports"]
    verbs: ["get", "list", "watch"]

  # Core resources: namespaces, pods, services, configmaps, persistentvolumeclaims
  - apiGroups: [""]
    resources: ["namespaces", "pods", "services", "configmaps", "persistentvolumeclaims"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]

  # Kubeflow Notebooks: MLOps notebook provisioning & lifecycle
  - apiGroups: ["kubeflow.org"]
    resources: ["notebooks"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]

  # Workload inspection: Deployments (for Bedrock AI context generation)
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch"]
```

#### 3. Persistent Database Service ([`base/postgres.yaml`](file:///home/user/work_dir/k8s-manifests/base/postgres.yaml))
- Deploys `postgres:16-alpine` configured with `strategy: Recreate` to prevent dual-mount corruption on ReadWriteOnce (RWO) storage.
- Requests 10Gi on `postgres-pvc`.
- Uses `pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}` for both liveness and readiness probes.

#### 4. NestJS Backend & InitContainer Migration ([`base/backend.yaml`](file:///home/user/work_dir/k8s-manifests/base/backend.yaml))
The backend deployment embeds an initContainer (`wait-and-migrate-db`) that ensures PostgreSQL is accepting connections before executing Prisma migrations:

```yaml
initContainers:
  - name: wait-and-migrate-db
    image: kyverno-backend:latest
    command:
      - sh
      - -c
      - |
        echo "Waiting for PostgreSQL database to be reachable..."
        until node -e "
          const net = require('net');
          const client = net.connect(5432, 'postgres.kyverno-platform.svc.cluster.local', () => {
            client.end();
            process.exit(0);
          });
          client.on('error', () => process.exit(1));
        " 2>/dev/null; do
          echo "PostgreSQL is not ready yet. Retrying in 2s..."
          sleep 2
        done
        echo "PostgreSQL is ready. Running Prisma DB migrations..."
        npx prisma migrate deploy --schema=/app/apps/backend/prisma/schema.prisma || \
        node /app/node_modules/prisma/build/index.js migrate deploy --schema=/app/apps/backend/prisma/schema.prisma
        echo "Prisma migrations completed."
```

The main backend container exposes port 3001, handles HTTP health checks at `/api/health`, and loads configuration via `kyverno-platform-secret` and optional `backend-env-secret`.

#### 5. Next.js Frontend ([`base/frontend.yaml`](file:///home/user/work_dir/k8s-manifests/base/frontend.yaml))
- Deploys the Next.js 14 standalone bundle on port 3000.
- Connects to the backend via in-cluster DNS: `INTERNAL_BACKEND_URL="http://kyverno-backend.kyverno-platform.svc.cluster.local:3001"`.
- Probes `/api/health` with a 5-second initial delay.

#### 6. Kubeflow Notebook Controller ([`base/notebook-controller.yaml`](file:///home/user/work_dir/k8s-manifests/base/notebook-controller.yaml))
- Deploys the official Kubeflow Notebook Controller (`docker.io/kubeflownotebookswg/notebook-controller:v1.8.0`) into namespace `kubeflow`.
- Reconciles `kubeflow.org/Notebook` Custom Resources, creating underlying `StatefulSets` and ClusterIP `Services` to enable user JupyterLab environments.

---

### 3.3. AWS EKS Production Overlay (`k8s-manifests/overlays/eks/`)

#### 1. AWS Load Balancer Controller ALB Ingress ([`overlays/eks/ingress-alb.yaml`](file:///home/user/work_dir/k8s-manifests/overlays/eks/ingress-alb.yaml))
Leverages the AWS Load Balancer Controller to dynamically provision an internet-facing ALB with IP target type:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kyverno-ingress
  namespace: kyverno-platform
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}]'
    alb.ingress.kubernetes.io/inbound-cidrs: 0.0.0.0/0
    alb.ingress.kubernetes.io/healthcheck-path: /api/health
    alb.ingress.kubernetes.io/load-balancer-attributes: idle_timeout.timeout_seconds=300
spec:
  ingressClassName: alb
  rules:
    - http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service: { name: kyverno-backend, port: { number: 3001 } }
          - path: /notebook
            pathType: Prefix
            backend:
              service: { name: kyverno-backend, port: { number: 3001 } }
          - path: /
            pathType: Prefix
            backend:
              service: { name: kyverno-frontend, port: { number: 3000 } }
```

#### 2. EBS CSI StorageClass Patch ([`overlays/eks/storage-patch.yaml`](file:///home/user/work_dir/k8s-manifests/overlays/eks/storage-patch.yaml))
Patches `postgres-pvc` to request high-performance AWS EBS storage:
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: kyverno-platform
spec:
  storageClassName: gp3
```

#### 3. AWS Bedrock IRSA Security Pipeline ([`scripts/setup-bedrock-irsa.sh`](file:///home/user/work_dir/scripts/setup-bedrock-irsa.sh))
To eliminate long-lived AWS IAM Access Keys inside containers, the backend utilizes **IAM Roles for Service Accounts (IRSA)**:
1. Associates the EKS cluster with an IAM OIDC Identity Provider via `eksctl utils associate-iam-oidc-provider`.
2. Generates a least-privilege IAM policy allowing invocation only for Claude 3.5 Sonnet / Nova Lite across primary (`us-east-1`) and secondary (`us-east-2`) regions:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "BedrockUniversalInvocation",
         "Effect": "Allow",
         "Action": [
           "bedrock:InvokeModel",
           "bedrock:InvokeModelWithResponseStream"
         ],
         "Resource": [
           "arn:aws:bedrock:us-east-1::foundation-model/*",
           "arn:aws:bedrock:us-east-2::foundation-model/*",
           "arn:aws:bedrock:us-east-1:*:inference-profile/*",
           "arn:aws:bedrock:us-east-2:*:inference-profile/*"
         ]
       }
     ]
   }
   ```
3. Binds the policy to an IAM Role (`<cluster>-backend-bedrock-irsa-role`) and annotates `kyverno-backend-sa` with `eks.amazonaws.com/role-arn`.
4. Triggers a rolling restart of `kyverno-backend` to mount the projected STS WebIdentityToken.

---

### 3.4. On-Premise / Generic Kubernetes Overlay (`k8s-manifests/overlays/onprem/`)

#### 1. Ingress-Nginx Configuration ([`overlays/onprem/ingress-nginx.yaml`](file:///home/user/work_dir/k8s-manifests/overlays/onprem/ingress-nginx.yaml))
Configured for standard Ingress-Nginx controllers:
- `nginx.ingress.kubernetes.io/proxy-read-timeout: "300"`
- `nginx.ingress.kubernetes.io/proxy-send-timeout: "300"`
- `nginx.ingress.kubernetes.io/proxy-body-size: "64m"`

#### 2. NodePort Direct Services ([`overlays/onprem/nodeport-services.yaml`](file:///home/user/work_dir/k8s-manifests/overlays/onprem/nodeport-services.yaml))
For bare-metal or Kind clusters lacking an Ingress controller, direct static NodePorts are exposed:
- **Frontend Dashboard**: NodePort `30080` (mapped to port 3000)
- **Backend REST API**: NodePort `30081` (mapped to port 3001)

---

## 4. Local Development Environment & Containerization

### 4.1. Kind Single-Node Bare-Minimum Setup (`scripts/setup-local-cluster.sh`)

Setting up full Kubernetes clusters on developer laptops often exhausts CPU, RAM, and disk I/O. The script [`scripts/setup-local-cluster.sh`](file:///home/user/work_dir/scripts/setup-local-cluster.sh) solves this via an optimized Kind topology.

```bash
# Launch lightweight development cluster
./scripts/setup-local-cluster.sh --minimal

# Launch full-stack cluster with all controllers and database seeding
./scripts/setup-local-cluster.sh --full
```

#### Minimal vs Full Mode Trade-Offs

| Operational Metric | Minimal Mode (`--minimal`, Default) | Full Stack Mode (`--full`) |
| :--- | :--- | :--- |
| **Kind Topology** | 1 Control-Plane Node (0 Workers) | 1 Control-Plane Node (0 Workers) |
| **Kyverno Pods** | Admission Controller Only (1 replica) | Admission (1), Background (1), Cleanup (1), Reports (1) |
| **Kyverno Memory Limits** | 64Mi Request / 256Mi Limit | 64Mi Request / 256Mi Limit per pod |
| **Background Scanning** | **Disabled (`backgroundScan: false`)** | **1-Hour Throttle (`backgroundScanInterval: 1h`)** |
| **Admission Reports** | **Disabled (`admissionReports: false`)** | **Disabled (`admissionReports: false`)** |
| **Platform Workloads** | None (Runs host `pnpm dev` servers) | PostgreSQL, Backend, Frontend in-cluster |
| **Local Disk I/O Impact** | **Zero-I/O background writes** | Controlled low-frequency writes |

#### Zero-I/O Optimization (BackgroundScan Throttling)
In local environments, standard Kyverno background scanning generates intense etcd read/write loops that churn developer SSDs. The setup script explicitly mitigates this:
- **Minimal Mode**: Sets `reportsController.backgroundScan=false` and `backgroundController.backgroundScanInterval=0`.
- **Full Mode**: Throttles the scan loop to `1h` and disables ephemeral admission report creation (`features.admissionReports.enabled=false`).

#### Container Network DNS Fixes for Containerized Environments
When running inside container network environments, Kind creates a Docker network named `kind`. The setup script checks if the control-plane host is resolvable and aligns the kubeconfig server URL:
```bash
if getent hosts "${CLUSTER_NAME}-control-plane" > /dev/null 2>&1; then
  kubectl config set-cluster "kind-${CLUSTER_NAME}" \
    --server="https://${CLUSTER_NAME}-control-plane:6443" \
    --insecure-skip-tls-verify=true
fi
```

---

### 4.2. Standalone Installation & Deployment Pipeline (`install.sh`)

The platform provides a universal one-click installer ([`install.sh`](file:///home/user/PaC-KyvernoDashboard/install.sh) -> [`scripts/deploy.sh`](file:///home/user/PaC-KyvernoDashboard/scripts/deploy.sh)) designed for direct production deployment by end users across any Kubernetes distribution.

```mermaid
graph TD
    User["Operator / User"]
    Installer["install.sh / scripts/deploy.sh"]
    Detect{"Target Environment Detection"}
    EKS["AWS EKS Overlay (ALB, gp3, IRSA)"]
    OnPrem["On-Premise Overlay (NodePort, HostPath)"]
    K8s["Kubernetes Cluster"]

    User -->|Executes with Options| Installer
    Installer --> Detect
    Detect -->|--env eks or EKS API detected| EKS
    Detect -->|--env onprem or Bare-Metal| OnPrem
    EKS -->|Kustomize Build & Apply| K8s
    OnPrem -->|Kustomize Build & Apply| K8s
    Installer -->|Verifies Kyverno & Rollout| K8s
```

#### Key Installer Features
1. **Zero External Toolchain Dependencies**: Operates with standard POSIX bash, automatically downloading required user CLI binaries locally into `scripts/bin/` if not present.
2. **Dynamic Secret Generation**: Cryptographically generates strong random passwords and JWT secrets on-the-fly, injecting them securely into `backend-env-secret`.
3. **Selective Component Modularization**: Allows toggling platform modules (`--disable-mlops`, `--enable-ai`, `--modules core,simulation`) to fit cluster resource budgets.
4. **Automated Kyverno Health Verification**: Probes Kyverno admission and reports controllers to ensure the admission webhook is ready before platform services start.
5. **Idempotent Deployment & Teardown**: Re-running updates existing resources without downtime; `--uninstall` performs a clean teardown of all provisioned platform resources.

---

### 4.3. Docker Multi-Stage Optimization (`node:22-slim`)

Both backend and frontend containers utilize multi-stage builds rooted on `node:22-slim` to reduce image size, accelerate layer caching, and improve security.

#### Backend Build Pipeline ([`apps/backend/Dockerfile`](file:///home/user/work_dir/apps/backend/Dockerfile))

```mermaid
flowchart TD
    subgraph BaseStage["Stage 1: base (node:22-slim)"]
        Init["WORKDIR /app, corepack enable pnpm"]
    end

    subgraph BuilderStage["Stage 2: builder"]
        CopyManifests["COPY package manifests & pnpm-workspace.yaml"]
        InstallDeps["RUN pnpm install --no-frozen-lockfile"]
        CopySource["COPY source code"]
        BuildShared["RUN pnpm --filter shared build"]
        GenPrisma["RUN prisma generate"]
        BuildBackend["RUN pnpm --filter backend build"]
    end

    subgraph RunnerStage["Stage 3: runner (Production <180MB)"]
        UserSetup["RUN adduser --uid 1001 nestjs"]
        CopyArtifacts["COPY --from=builder dist, prisma, shared, node_modules"]
        DropPrivileges["USER nestjs"]
        EntryPoint["CMD ['node', 'apps/backend/dist/main']"]
    end

    BaseStage --> BuilderStage
    BuilderStage --> RunnerStage
```

- **Layer Caching**: Manifest files (`pnpm-lock.yaml`, `package.json`, etc.) are copied and installed *before* copying source code, cutting rebuild times from 3 minutes to ~10 seconds.
- **Security**: Drops root privileges and executes as non-root user `nestjs:nodejs` (UID 1001).

#### Frontend Standalone Shrinking ([`apps/frontend/Dockerfile`](file:///home/user/work_dir/apps/frontend/Dockerfile))
- Uses Next.js **Standalone Output Mode** (`output: 'standalone'`).
- The production runner copies only `.next/standalone`, `.next/static`, and `public/`.
- Final container image footprint is **under 150MB**.
- Runs as non-root user `nextjs:nodejs` (UID 1001) with Next.js telemetry disabled (`NEXT_TELEMETRY_DISABLED=1`).

---

## 5. Testing & Verification Suite

### 5.1. Bare-Minimum Single & Multi-Cluster Kind Test Runners (`scripts/tests/`)

To validate cluster adapters, RBAC token isolation, and multi-cluster routing without bloated resource footprints, the platform provides dedicated bare test runners in [`scripts/tests/`](file:///home/user/work_dir/scripts/tests).

#### 1. Single-Cluster Bare Runner ([`run-bare-single-cluster-test.sh`](file:///home/user/work_dir/scripts/tests/run-bare-single-cluster-test.sh))
- **Anti-Bloat Design**: Creates a bare Kind control-plane without deploying Helm, Kyverno controller pods, or port forwardings.
- **CRD-Only Injection**: Fetches and server-side applies only the required Kyverno CRDs (`clusterpolicies.kyverno.io` and `policyexceptions.kyverno.io`).
- **Disk Safeguard**: Pre-asserts at least 5GB free host space before executing.
- **Exit Trap**: Registers an automated cleanup trap (`trap cleanup EXIT ERR SIGINT SIGTERM`) that deletes the Kind cluster and prunes Docker volumes immediately upon test completion or failure.
- **Test Target**: Executes Jest integration test `multi-cluster.integration-spec.ts`.

#### 2. Literal Multi-Cluster Runner ([`run-bare-multicluster-test.sh`](file:///home/user/work_dir/scripts/tests/run-bare-multicluster-test.sh))
- **True Multi-Cluster Topology**: Spawns two independent, simultaneous Kind clusters: `bare-mc-alpha` and `bare-mc-beta`.
- **Resource Reuse**: Both clusters share the exact same underlying Docker base image layer, avoiding image bloat.
- **Isolation Checks**: Verifies that ServiceAccount tokens from Cluster A cannot access Cluster B, validates independent CA certificate authorities, and tests unreachable cluster failovers.
- **Test Target**: Executes Jest integration test `bare-multicluster.integration-spec.ts`.

#### 3. Unified Disk Reclamation Script ([`cleanup-all-test-clusters.sh`](file:///home/user/work_dir/scripts/tests/cleanup-all-test-clusters.sh))
A single utility to restore the developer's workstation to a pristine state:
```bash
./scripts/tests/cleanup-all-test-clusters.sh
```
1. Deletes all active Kind test clusters.
2. Prunes stopped Docker containers, dangling volumes, and orphaned networks.
3. Cleans temporary kubeconfigs and manifests from `/tmp/bare-*` and `/tmp/pac-*`.
4. Prints before-and-after disk usage summaries.

---

### 5.2. Full-Lifecycle E2E Cluster Test Runner (`scripts/run-e2e-cluster-test.sh`)

[`scripts/run-e2e-cluster-test.sh`](file:///home/user/work_dir/scripts/run-e2e-cluster-test.sh) executes a complete, 6-phase integration verification suite against a live Kubernetes cluster:

```mermaid
flowchart TD
    Step1["Step 1: Prerequisites & CLI Validation"] --> Step2["Step 2: Provision Kind Cluster 'k8s-lab'"]
    Step2 --> Step3["Step 3: Deploy Kyverno v1.12 with PolicyExceptions"]
    Step3 --> Step4["Step 4: Build & Load Local Container Images"]
    Step4 --> Step5["Step 5: Deploy Platform Workloads & Migrations"]
    
    Step5 --> S1["Scenario 1: Platform & DB Health Probe (/api/health)"]
    S1 --> S2["Scenario 2: Kyverno Policy Enforcement Block (Admission Denial)"]
    S2 --> S3["Scenario 3: Backend SA RBAC & PolicyException Creation"]
    S3 --> S4["Scenario 4: PolicyException Bypass Verification (Pod Running)"]
    S4 --> S5["Scenario 5: Kyverno PolicyReport & Audit Inspection"]
    S5 --> S6["Scenario 6: AI Remediation Engine Verification (/explain-kyverno-error)"]
    S6 --> Pass["All 6 Scenarios Passed! 🎉"]
```

#### E2E Verification Scenarios Detail

| Scenario | Objective | Validation Mechanism | Expected Result |
| :--- | :--- | :--- | :--- |
| **Scenario 1** | In-Cluster Health Verification | `curl` against `/api/health` on frontend and backend | HTTP 200 OK; PostgreSQL connected |
| **Scenario 2** | Kyverno Policy Enforcement | Deploys pod with `:latest` image tag | Admission Webhook blocks request with `disallow-latest-tag` error |
| **Scenario 3** | RBAC Exception Creation | Injects `PolicyException` CRD using `kyverno-backend-sa` token | Exception resource created in `kyverno-platform` namespace |
| **Scenario 4** | Exception Bypass Verification | Re-deploys previously blocked `:latest` pod | Pod successfully admitted, scheduled, and transitions to `Running` |
| **Scenario 5** | PolicyReport Audit Inspection | Inspects `policyreports.wgpolicyk8s.io` | Audited non-blocking violations recorded with detailed rule metadata |
| **Scenario 6** | Generative AI Remediation API | Calls backend API `/ai-agent/explain-kyverno-error` | Receives structured AI JSON remediation plan & root-cause analysis |

#### Automated Diagnostic Log Dumps & Crash Triage
If any scenario fails, the script triggers `dump_diagnostics`:
- Gathers all pod statuses across `kyverno-platform`, `kyverno`, and test namespaces.
- Dumps the last 100 lines of `kyverno-backend` and `kyverno-admission-controller` logs.
- Dumps PostgreSQL connection logs to isolate database authentication or pool exhaustion issues.

---

### 5.3. Backend Integration Test Suite (`apps/backend/test/`)

The backend integration suite provides high-fidelity test coverage:

- [`multi-cluster.integration-spec.ts`](file:///home/user/work_dir/apps/backend/test/multi-cluster.integration-spec.ts): Validates multi-cluster context switching, in-memory cluster registry caching, and dynamic token rotation.
- [`bare-multicluster.integration-spec.ts`](file:///home/user/work_dir/apps/backend/test/bare-multicluster.integration-spec.ts): Tests cross-cluster API calls against real independent Kubernetes clusters.
- [`exception-lifecycle.integration-spec.ts`](file:///home/user/work_dir/apps/backend/test/exception-lifecycle.integration-spec.ts): Exercises the full exception lifecycle state machine:
  $$\text{PENDING} \xrightarrow{\text{Approve}} \text{APPROVED} \xrightarrow{\text{GitOps}} \text{PR OPENED} \xrightarrow{\text{Apply}} \text{IN-CLUSTER ACTIVE} \xrightarrow{\text{Expiry}} \text{EXPIRED}$$
- [`user-cluster-assignments.integration-spec.ts`](file:///home/user/work_dir/apps/backend/test/user-cluster-assignments.integration-spec.ts): Validates multi-tenant RBAC boundaries, ensuring requesters only see violations and workloads in their assigned clusters.

---

## 6. Operational Playbook & Day-2 Operations

### 6.1. Common CLI Diagnostics & Troubleshooting Cheat Sheet

#### Cluster Connectivity & Context
```bash
# Verify current Kubernetes context and node connectivity
kubectl config current-context
kubectl get nodes -o wide

# Check platform namespace events
kubectl get events -n kyverno-platform --sort-by='.metadata.creationTimestamp'
```

#### Platform Pods & Workloads
```bash
# Check platform workload status
kubectl get pods,svc,pvc,ingress -n kyverno-platform -o wide

# Stream real-time logs from backend
kubectl logs -n kyverno-platform -l app=kyverno-backend -f --tail=200

# Stream logs from PostgreSQL
kubectl logs -n kyverno-platform -l app=postgres -f --tail=100
```

#### Kyverno Policy Engine Inspection
```bash
# Check status of Kyverno controller pods
kubectl get pods -n kyverno -o wide

# View ClusterPolicies and their enforcement actions (Enforce vs Audit)
kubectl get clusterpolicies.kyverno.io -o custom-columns=NAME:.metadata.name,ACTION:.spec.validationFailureAction,BACKGROUND:.spec.background

# List active PolicyExceptions across all namespaces
kubectl get policyexceptions.kyverno.io -A

# Query cluster-wide PolicyReports
kubectl get policyreports.wgpolicyk8s.io -A
kubectl get clusterpolicyreports.wgpolicyk8s.io
```

---

### 6.2. Kyverno Admission Webhook & Latency Troubleshooting

If pod deployments hang or fail with webhook connection errors (`failed calling webhook "validate.kyverno.svc"`):

```mermaid
flowchart TD
    A["Pod Deployment Fails with Webhook Timeout"] --> B{"Is kyverno-admission-controller running?"}
    B -- No --> C["Check Kyverno pod logs: kubectl logs -n kyverno -l app=kyverno"]
    B -- Yes --> D{"Are Webhook configurations pointing to valid CA?"}
    D -- No --> E["Restart cert-renewer or recreate Kyverno certificates"]
    D -- Yes --> F{"Is failurePolicy set to Fail or Ignore?"}
    F -- Fail --> G["Temporarily patch failurePolicy to Ignore during recovery"]
    F -- Ignore --> H["Check network connectivity & security groups between API Server and Pods"]
```

```bash
# Inspect the ValidatingWebhookConfiguration
kubectl get validatingwebhookconfigurations -l webhook.kyverno.io/managed-by=kyverno

# If emergency recovery is needed, temporarily set failurePolicy to Ignore:
kubectl patch validatingwebhookconfiguration kyverno-resource-validating-webhook-cfg \
  --type='json' -p='[{"op": "replace", "path": "/webhooks/0/failurePolicy", "value": "Ignore"}]'
```

---

### 6.3. Database Migration, Schema Updates & Rollbacks

Prisma migrations run automatically via the backend initContainer. To perform manual migrations or maintenance:

```bash
# 1. Forward PostgreSQL port to localhost
kubectl port-forward -n kyverno-platform svc/postgres 5432:5432 &
PF_PID=$!

# 2. Extract database URL from platform secret
DATABASE_URL=$(kubectl get secret kyverno-platform-secret -n kyverno-platform -o jsonpath='{.data.DATABASE_URL}' | base64 -d)

# 3. Apply pending migrations
DATABASE_URL="${DATABASE_URL}" npx prisma migrate deploy --schema=apps/backend/prisma/schema.prisma

# 4. Check migration status
DATABASE_URL="${DATABASE_URL}" npx prisma migrate status --schema=apps/backend/prisma/schema.prisma

# 5. Clean up port-forward process
kill ${PF_PID}
```

---

### 6.4. Platform Teardown & Clean Uninstall Procedure

To completely remove the platform and all associated in-cluster resources:

```bash
# 1. Standard one-click teardown
./install.sh --uninstall
# or:
./scripts/deploy.sh --uninstall

# 2. Complete manual teardown (if uninstalling without script)
kubectl delete namespace kyverno-platform --ignore-not-found=true
kubectl delete clusterrole kyverno-backend-cluster-role --ignore-not-found=true
kubectl delete clusterrolebinding kyverno-backend-cluster-role-binding --ignore-not-found=true

# 3. (Optional) Remove Kubeflow Notebook Controller
kubectl delete -f k8s-manifests/base/notebook-controller.yaml --ignore-not-found=true

# 4. (Optional) Reclaim all local Kind test clusters and prune Docker storage
./scripts/tests/cleanup-all-test-clusters.sh
```

---

### End of Chapter 6
For architecture deep dives and policy authoring guidelines, consult [Chapter 4: Core Engine & Policy Framework](file:///home/user/work_dir/docs/TECHNICAL_FOUNDATION_REPORT.md).
