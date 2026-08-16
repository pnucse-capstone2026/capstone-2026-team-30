#!/bin/bash
# EKS 클러스터 내 배포된 서비스 수동 상태 점검, 포트포워딩 및 3가지 AI 모델 테스트 시나리오 실행 스크립트
# 개발자 및 리뷰어가 온디맨드로 인프라와 AI 에이전트 해설 기능을 손쉽게 수동 검증하기 위한 목적
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KUBECTL="${SCRIPT_DIR}/bin/kubectl"

if [ ! -f "${KUBECTL}" ]; then
  KUBECTL="kubectl"
fi

BACKEND_URL="http://localhost:3001"

echo "=========================================================="
echo " Kyverno Governance Platform - EKS Manual Test Suite"
echo "=========================================================="
echo "1) View All EKS Pods and Services Status"
echo "2) Start Local Port-Forwarding (Backend 3001 / Frontend 3000)"
echo "3) Trigger Live Kyverno Rejection in EKS (image:latest)"
echo "4) Run AI Model Test Scenarios (AWS Bedrock Explainer)"
echo "5) Verify & Inspect Bedrock IRSA Configuration"
echo "6) Setup / Reconfigure AWS Bedrock IRSA (eksctl)"
echo "7) Build & Deploy Docker Backend to EKS (One-Click Auto Rollout)"
echo "8) Build & Deploy Docker Frontend to EKS (One-Click Auto Rollout)"
echo "9) Build & Deploy Full Stack (Backend + Frontend) to EKS"
echo "10) Exit"
echo "=========================================================="
read -p "Select an option [1-10]: " CHOICE

case $CHOICE in
  1)
    echo ">>> Fetching Pods & Services in 'kyverno-platform' namespace..."
    "${KUBECTL}" get pods,svc -n kyverno-platform || true
    echo ""
    echo ">>> Fetching Pods & Services in 'kyverno' namespace..."
    "${KUBECTL}" get pods,svc -n kyverno || true
    ;;
  2)
    echo ">>> Starting Port-Forwarding for NestJS Backend (3001) and Frontend (3000)..."
    echo "    (Press Ctrl+C to terminate port-forwarding when done)"
    echo ">>> Open Swagger UI at: http://localhost:3001/api"
    echo ">>> Open Frontend UI at: http://localhost:3000"
    "${KUBECTL}" port-forward svc/kyverno-backend 3001:3001 -n kyverno-platform &
    PF_BACKEND_PID=$!
    "${KUBECTL}" port-forward svc/kyverno-frontend 3000:3000 -n kyverno-platform &
    PF_FRONTEND_PID=$!
    
    trap "kill $PF_BACKEND_PID $PF_FRONTEND_PID 2>/dev/null || true" EXIT
    wait
    ;;
  3)
    echo ">>> Attempting to deploy a Pod with 'nginx:latest' tag into EKS cluster..."
    echo ">>> Expecting Kyverno Admission Controller to REJECT the request:"
    "${KUBECTL}" run live-test-pod --image=nginx:latest --restart=Never || true
    ;;
  4)
    echo "----------------------------------------------------------"
    echo " AI Model Test Scenarios Sub-Menu"
    echo "----------------------------------------------------------"
    echo " [1] Scenario 1: Image ':latest' Tag Policy Rejection"
    echo " [2] Scenario 2: Read-Only Root FileSystem Violation"
    echo " [3] Scenario 3: Privileged Container Block"
    echo "----------------------------------------------------------"
    read -p "Select AI Test Scenario [1-3]: " AI_CHOICE
    
    case $AI_CHOICE in
      1)
        PAYLOAD='{
          "errorMessage": "admission webhook validate.kyverno.svc-fail denied the request: resource Pod/default/test-web was blocked by rule disallow-latest-tag: Using the :latest tag is prohibited.",
          "policyYaml": "apiVersion: kyverno.io/v1\nkind: ClusterPolicy\nmetadata:\n  name: disallow-latest-tag\nspec:\n  validationFailureAction: Enforce",
          "resourceManifest": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: test-web\nspec:\n  containers:\n  - name: nginx\n    image: nginx:latest",
          "clusterContext": "EKS Cluster: kyverno-eks-lab (us-east-1), K8s v1.35"
        }'
        ;;
      2)
        PAYLOAD='{
          "errorMessage": "action: deny, rule check-read-only-root-filesystem failed: rootFS must be read-only",
          "policyYaml": "apiVersion: kyverno.io/v1\nkind: ClusterPolicy\nmetadata:\n  name: require-ro-rootfs\nspec:\n  validationFailureAction: Enforce\n  rules:\n  - name: check-read-only-root-filesystem",
          "resourceManifest": "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: secure-app\nspec:\n  template:\n    spec:\n      containers:\n      - name: web\n        image: nginx:1.27.0\n        securityContext:\n          readOnlyRootFilesystem: false",
          "clusterContext": "EKS Cluster: kyverno-eks-lab (us-east-1), K8s v1.35"
        }'
        ;;
      3)
        PAYLOAD='{
          "errorMessage": "action: deny, rule check-privileged failed: privileged containers are not allowed",
          "policyYaml": "apiVersion: kyverno.io/v1\nkind: ClusterPolicy\nmetadata:\n  name: disallow-privileged-containers\nspec:\n  validationFailureAction: Enforce",
          "resourceManifest": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: privileged-pod\nspec:\n  containers:\n  - name: admin\n    image: alpine:latest\n    securityContext:\n      privileged: true",
          "clusterContext": "EKS Cluster: kyverno-eks-lab (us-east-1), K8s v1.35"
        }'
        ;;
      *)
        echo "Invalid scenario selected."
        exit 1
        ;;
    esac

    echo ">>> Sending test payload to AI Agent endpoint (${BACKEND_URL}/ai-agent/explain-kyverno-error)..."
    curl -X POST "${BACKEND_URL}/ai-agent/explain-kyverno-error" \
      -H "Content-Type: application/json" \
      -d "${PAYLOAD}" | pnpm --silent dlx json || curl -X POST "${BACKEND_URL}/ai-agent/explain-kyverno-error" -H "Content-Type: application/json" -d "${PAYLOAD}"
    ;;
  5)
    echo "=========================================================="
    echo " Inspecting Bedrock IRSA Configuration"
    echo "=========================================================="
    echo ">>> 1. Checking Kubernetes ServiceAccount 'kyverno-backend-sa' in 'kyverno-platform'..."
    "${KUBECTL}" get sa kyverno-backend-sa -n kyverno-platform -o yaml || true
    echo ""
    
    ROLE_ARN=$("${KUBECTL}" get sa kyverno-backend-sa -n kyverno-platform -o jsonpath='{.metadata.annotations.eks\.amazonaws\.com/role-arn}' 2>/dev/null || echo "")
    if [ -n "${ROLE_ARN}" ]; then
      echo ">>> [OK] Found IAM Role Annotation: ${ROLE_ARN}"
      ROLE_NAME="${ROLE_ARN##*/}"
      if command -v aws &> /dev/null && aws sts get-caller-identity &> /dev/null; then
        echo ">>> [OK] Querying IAM Role '${ROLE_NAME}' details from AWS..."
        aws iam get-role --role-name "${ROLE_NAME}" --output json || true
        echo ""
        echo ">>> [OK] Attached Policies on '${ROLE_NAME}':"
        aws iam list-attached-role-policies --role-name "${ROLE_NAME}" --output table || true
      fi
    else
      echo ">>> [INFO] ServiceAccount is not yet annotated with IAM Role ARN. Please run option (6) to setup IRSA."
    fi
    echo ""
    echo ">>> 2. Checking AWS Environment Variables injected into 'kyverno-backend' Pods..."
    POD_NAME=$("${KUBECTL}" get pods -n kyverno-platform -l app=kyverno-backend -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [ -n "${POD_NAME}" ]; then
      echo ">>> Target Pod: ${POD_NAME}"
      "${KUBECTL}" exec "${POD_NAME}" -n kyverno-platform -- env | grep -E "AWS_ROLE_ARN|AWS_WEB_IDENTITY_TOKEN_FILE|AWS_REGION|BEDROCK_MODEL_ID" || true
    else
      echo ">>> [INFO] kyverno-backend Pod is not currently running in 'kyverno-platform' namespace."
    fi
    ;;
  6)
    echo ">>> Executing AWS Bedrock IRSA Automated Setup..."
    bash "${SCRIPT_DIR}/setup-bedrock-irsa.sh"
    ;;
  7)
    echo ">>> Executing Docker-based Backend Build & Deploy to EKS..."
    bash "${SCRIPT_DIR}/deploy-backend-docker.sh"
    ;;
  8)
    echo ">>> Executing Docker-based Frontend Build & Deploy to EKS..."
    bash "${SCRIPT_DIR}/deploy-frontend-docker.sh"
    ;;
  9)
    echo ">>> Executing Full Stack (Backend + Frontend) Build & Deploy to EKS..."
    bash "${SCRIPT_DIR}/deploy-backend-docker.sh"
    bash "${SCRIPT_DIR}/deploy-frontend-docker.sh"
    ;;
  10)
    echo "Exiting test suite."
    exit 0
    ;;
  *)
    echo "Invalid option."
    exit 1
    ;;
esac
