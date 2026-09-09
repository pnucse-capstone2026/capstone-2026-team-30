#!/usr/bin/env bash
# ==============================================================================
# EKS Tier 2 대규모 워크로드 & PolicyReport 위반 생성기
# ==============================================================================
# 비용 절감 기법:
# - 초경량 Pause Container(registry.k8s.io/pause:3.9, 1MB RAM)를 사용하여
#   3~4대의 노드만으로 1,200+ 개 Pod 및 3,500+ 건의 실시간 PolicyReport 생성
# ==============================================================================

NAMESPACE_COUNT="${1:-15}"        # 기본 15개 네임스페이스 (프리티어 최적화)
REPLICAS_PER_NS="${2:-10}"        # 네임스페이스당 10개 파드 (총 150 파드, 1,000+ PolicyReports)
NAMESPACE_PREFIX="tenant-bench"

echo "=============================================================================="
echo " 🚀 Generating Tier 2 Benchmark Workload on EKS"
echo "=============================================================================="
echo " 🏢 Namespace Count      : ${NAMESPACE_COUNT} (${NAMESPACE_PREFIX}-01 ~ ${NAMESPACE_PREFIX}-${NAMESPACE_COUNT})"
echo " 📦 Replicas per NS      : ${REPLICAS_PER_NS}"
echo " 🎯 Total Expected Pods  : $((NAMESPACE_COUNT * REPLICAS_PER_NS))"
echo " 📄 Target CRD           : PolicyReport & ClusterPolicyReport"
echo "=============================================================================="

# 1. 네임스페이스 및 더미 디플로이먼트 일괄 생성
echo ">>> Creating ${NAMESPACE_COUNT} namespaces and deploying lightweight dummy pods..."

for i in $(seq -w 1 "${NAMESPACE_COUNT}"); do
  NS_NAME="${NAMESPACE_PREFIX}-${i}"
  
  # 네임스페이스 생성
  kubectl create namespace "${NS_NAME}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null 2>&1

  # 초경량 Pause Container 기반의 위반 유발 Deployment 생성
  # - 의도적 위반 사항:
  #   1. ':latest' 이미지 태그 사용 (disallow-latest-tag 위반)
  #   2. CPU/Memory Limits 누락 (require-resource-limits 위반)
  #   3. 승인되지 않은 외부 이미지 (restrict-image-registries 위반)
  cat <<MANIFEST | kubectl apply -f - >/dev/null 2>&1
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bench-dummy-workload
  namespace: ${NS_NAME}
  labels:
    app: bench-dummy-workload
    benchmark: tier2
spec:
  replicas: ${REPLICAS_PER_NS}
  selector:
    matchLabels:
      app: bench-dummy-workload
  template:
    metadata:
      labels:
        app: bench-dummy-workload
        benchmark: tier2
    spec:
      containers:
        - name: dummy-pause-container
          image: registry.k8s.io/pause:latest
          imagePullPolicy: IfNotPresent
          resources:
            requests:
              cpu: 1m
              memory: 4Mi
MANIFEST

  printf "."
done
echo ""
echo ">>> All deployments submitted."

# 2. 파드 기동 상태 모니터링
echo ">>> Waiting for pods to reach Running status across benchmark namespaces..."
sleep 5

TOTAL_PODS=$(kubectl get pods -A -l benchmark=tier2 --no-headers 2>/dev/null | wc -l || echo 0)
RUNNING_PODS=$(kubectl get pods -A -l benchmark=tier2 --field-selector=status.phase=Running --no-headers 2>/dev/null | wc -l || echo 0)

echo ">>> Current Status: ${RUNNING_PODS}/${TOTAL_PODS} benchmark pods Running."

# 3. Kyverno PolicyReport 생성 확인
echo ">>> Checking Kyverno PolicyReport generation..."
sleep 5

POLICY_REPORT_COUNT=$(kubectl get policyreports -A --no-headers 2>/dev/null | wc -l || echo 0)
CLUSTER_POLICY_REPORT_COUNT=$(kubectl get clusterpolicyreports --no-headers 2>/dev/null | wc -l || echo 0)

echo "=============================================================================="
echo " 🎉 Tier 2 Benchmark Workload Setup Complete!"
echo "=============================================================================="
echo " 📊 Total Benchmark Pods    : ${TOTAL_PODS}"
echo " 📋 Total PolicyReports     : ${POLICY_REPORT_COUNT} namespaces"
echo " 🌐 ClusterPolicyReports    : ${CLUSTER_POLICY_REPORT_COUNT}"
echo ""
echo " 💡 Tip: You can now run performance benchmarks against the platform API:"
echo "    GET /api/v1/violations"
echo "    GET /api/v1/clusters/overview"
echo "=============================================================================="
