#!/usr/bin/env bash
# ==============================================================================
# Comprehensive Test Cluster Cleanup & Disk Space Reclamation Script
# ==============================================================================
# Deletes all Kind test clusters, prunes unused test Docker resources, and
# restores maximum host disk space.
# ==============================================================================

set -uo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
NC="\033[0m"

echo -e "${BOLD}${CYAN}==============================================================================${NC}"
echo -e "${BOLD}${CYAN} 🧹 Kind Test Cluster Cleanup & Disk Space Reclamation${NC}"
echo -e "${BOLD}${CYAN}==============================================================================${NC}"

# Pre-cleanup disk inspection
echo -e "\n${BOLD}[ Disk Usage Before Cleanup ]${NC}"
df -h / | awk 'NR==1 || NR==2'

# 1. Delete all matching test Kind clusters
if command -v kind >/dev/null 2>&1; then
  CLUSTERS=$(kind get clusters 2>/dev/null || true)
  if [ -n "${CLUSTERS}" ]; then
    echo -e "\n${BOLD}[ Removing Kind Clusters ]${NC}"
    for c in ${CLUSTERS}; do
      echo -e ">>> Deleting Kind cluster: ${YELLOW}${c}${NC}..."
      kind delete cluster --name "${c}" || true
    done
  else
    echo -e "\n>>> No active Kind clusters found."
  fi
fi

# 2. Remove stopped test containers & networks
if command -v docker >/dev/null 2>&1; then
  echo -e "\n${BOLD}[ Pruning Docker Artifacts & Volumes ]${NC}"
  # Prune stopped containers
  docker container prune -f >/dev/null 2>&1 || true
  # Prune dangling volumes created by Kind or testcontainers
  docker volume prune -f >/dev/null 2>&1 || true
  # Prune unused docker networks
  docker network prune -f >/dev/null 2>&1 || true
fi

# 3. Clean up temporary test directories and kubeconfigs
echo -e "\n${BOLD}[ Cleaning Temporary Test Artifacts ]${NC}"
rm -rf /tmp/pac-cluster-e2e-* /tmp/bare-cluster-* /tmp/bare-mc-* 2>/dev/null || true
echo ">>> Temporary files under /tmp/ cleaned."

# Post-cleanup disk inspection
echo -e "\n${BOLD}[ Disk Usage After Cleanup ]${NC}"
df -h / | awk 'NR==1 || NR==2'

echo -e "\n${BOLD}${GREEN}==============================================================================${NC}"
echo -e "${BOLD}${GREEN} ✅ All test environments cleaned and disk space reclaimed!${NC}"
echo -e "${BOLD}${GREEN}==============================================================================${NC}"
