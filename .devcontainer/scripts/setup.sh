#!/bin/bash
set -e

echo "================================================"
echo " Start Dev Container Post-Creation Setup"
echo "================================================"

echo ">>> [1/5] Installing pnpm..."
npm install -g pnpm

echo ">>> [2/5] Installing kind CLI..."
curl -Lo /tmp/kind https://kind.sigs.k8s.io/dl/latest/kind-linux-amd64
chmod +x /tmp/kind
sudo mv /tmp/kind /usr/local/bin/kind

echo ">>> [3/5] Installing GitHub CLI..."
curl -sS https://webi.sh/gh | sh
export PATH="$HOME/.local/opt/gh/bin:$PATH"

echo ">>> [4/5] Installing Kyverno CLI..."
KYVERNO_VERSION="v1.12.0"
KYVERNO_TMP=$(mktemp -d)
trap 'rm -rf "${KYVERNO_TMP}"' EXIT
curl -L "https://github.com/kyverno/kyverno/releases/download/${KYVERNO_VERSION}/kyverno-cli_${KYVERNO_VERSION}_linux_x86_64.tar.gz" \
    -o "${KYVERNO_TMP}/kyverno-cli.tar.gz"
tar -xvf "${KYVERNO_TMP}/kyverno-cli.tar.gz" -C "${KYVERNO_TMP}"
sudo cp "${KYVERNO_TMP}/kyverno" /usr/local/bin/
sudo chmod +x /usr/local/bin/kyverno

echo ">>> [5/5] Detecting Host Environment..."
if getent hosts k8s-lab-control-plane > /dev/null; then
    echo " WSL2 + Docker Desktop (kind network) environment detected."
    echo " Re-configuring kubectl cluster endpoint for container network..."
    kubectl config set-cluster kind-k8s-lab \
        --server=https://k8s-lab-control-plane:6443 \
        --insecure-skip-tls-verify=true
else
    echo " Native Linux (Systemd) environment detected."
    echo " Keeping default host kubeconfig settings."
fi

echo ">>> Installing Monorepo Dependencies..."
pnpm install

echo ">>> [6/6] Setting up environment files safely..."
# Frontend env
if [ ! -f apps/frontend/.env.local ]; then
    echo "Creating apps/frontend/.env.local from example..."
    cp apps/frontend/.env.local.example apps/frontend/.env.local
else
    echo "apps/frontend/.env.local already exists, skipping."
fi

# Backend env
if [ ! -f apps/backend/.env ]; then
    echo "Creating apps/backend/.env from example..."
    cp apps/backend/.env.example apps/backend/.env
else
    echo "apps/backend/.env already exists, skipping."
fi

echo ">>> Generating Prisma client..."
pnpm --filter @kyverno-platform/backend exec prisma generate

echo "================================================"
echo " Setup Completed"
echo "================================================"