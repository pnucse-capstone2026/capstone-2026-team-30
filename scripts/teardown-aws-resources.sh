#!/usr/bin/env bash
# ==============================================================================
# AWS Multi-Cluster Resource Teardown Script
# ==============================================================================
# Safely tears down all AWS resources (Hub & Spoke EKS, Spot Nodes, VPCs, NAT GWs, EIPs)
# Preserves ECR repository images as requested by user.
# ==============================================================================
set -eo pipefail

export HOME="/tmp"
export PATH="/home/user/.local/bin:/tmp/bin:${PATH}"
export AWS_REGION="us-east-1"

echo "=== Starting Complete AWS Resource Teardown (us-east-1) ==="
echo "Note: ECR images will be strictly preserved."

# 1. Clean up KubeView services / ELBs if any remain
HUB_CTX="iam-root-account@kyverno-eks-lab.us-east-1.eksctl.io"
SPOKE_CTX="iam-root-account@kyverno-eks-spoke-01.us-east-1.eksctl.io"

echo "[1/4] Ensuring all Kubernetes LoadBalancers / ELBs are released..."
kubectl --context="${HUB_CTX}" delete svc --all -n kyverno-platform --wait=false 2>/dev/null || true
kubectl --context="${SPOKE_CTX}" delete svc --all -n kubeview --wait=false 2>/dev/null || true
sleep 5

# 2. Trigger parallel eksctl cluster deletion
echo "[2/4] Triggering parallel deletion of Spoke (kyverno-eks-spoke-01) and Hub (kyverno-eks-lab)..."

(
  echo ">>> Deleting Spoke cluster (kyverno-eks-spoke-01)..."
  eksctl delete cluster --name kyverno-eks-spoke-01 --region "${AWS_REGION}" --wait
  echo ">>> Spoke cluster deletion completed successfully!"
) > /tmp/teardown-spoke.log 2>&1 &
PID_SPOKE=$!

(
  echo ">>> Deleting Hub cluster (kyverno-eks-lab)..."
  eksctl delete cluster --name kyverno-eks-lab --region "${AWS_REGION}" --wait
  echo ">>> Hub cluster deletion completed successfully!"
) > /tmp/teardown-hub.log 2>&1 &
PID_HUB=$!

echo "Teardown background jobs launched (Spoke PID: $PID_SPOKE, Hub PID: $PID_HUB)."
echo "Waiting for Spoke cluster teardown..."
wait $PID_SPOKE
echo "Spoke teardown finished."

echo "Waiting for Hub cluster teardown..."
wait $PID_HUB
echo "Hub teardown finished."

# 3. Verify CloudFormation Stacks
echo "[3/4] Verifying CloudFormation stacks in ${AWS_REGION}..."
REMAINING_STACKS=$(aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --region "${AWS_REGION}" --query "StackSummaries[*].StackName" --output text)
echo "Remaining CloudFormation stacks: ${REMAINING_STACKS:-None}"

# 4. Verify EKS Clusters & NAT Gateways
echo "[4/4] Verifying remaining AWS infrastructure..."
REMAINING_CLUSTERS=$(aws eks list-clusters --region "${AWS_REGION}" --query "clusters" --output text)
echo "Remaining EKS clusters: ${REMAINING_CLUSTERS:-None}"

REMAINING_NATS=$(aws ec2 describe-nat-gateways --filter "Name=state,Values=available" --region "${AWS_REGION}" --query "NatGateways[*].NatGatewayId" --output text)
echo "Remaining NAT Gateways: ${REMAINING_NATS:-None}"

REMAINING_EIPS=$(aws ec2 describe-addresses --region "${AWS_REGION}" --query "Addresses[*].PublicIp" --output text)
echo "Remaining Elastic IPs: ${REMAINING_EIPS:-None}"

echo "=== AWS Resource Teardown Completed Successfully! ==="
