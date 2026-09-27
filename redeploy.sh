#!/usr/bin/env bash
# ==============================================================================
# Kyverno Governance Platform - Local Redeployment Wrapper
# ==============================================================================
# Seamlessly builds local container images and deploys the platform into the
# active Kubernetes cluster using the universal environment-independent installer.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/scripts/deploy.sh" --env onprem --build "$@"
