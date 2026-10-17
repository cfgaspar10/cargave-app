#!/usr/bin/env bash
# ==============================================================================
# Script de Deploy Remoto na VPS — CargaVE
# ==============================================================================
# Executado via SSH pelo GitHub Actions.
# Parâmetros recebidos:
#   $1 -> STACK_NAME (ex: cargave-prod ou cargave-hml)
#   $2 -> LEGACY_STACK (ex: kwhub-prod ou kwhub-hml)
#   $3 -> TARGET_BRANCH (ex: main ou develop)
# ==============================================================================

set -euo pipefail

STACK_NAME="${1:-cargave-prod}"
LEGACY_STACK="${2:-kwhub-prod}"
TARGET_BRANCH="${3:-main}"

# Resolução de diretório (com suporte a symlinks e nomes legados)
if [ -d "$HOME/stacks/$STACK_NAME" ]; then
  TARGET_DIR="$HOME/stacks/$STACK_NAME"
elif [ -d "$HOME/stacks/$LEGACY_STACK" ]; then
  TARGET_DIR="$HOME/stacks/$LEGACY_STACK"
else
  TARGET_DIR="$HOME/stacks/$STACK_NAME"
fi

echo "==> Entrando no diretório $TARGET_DIR..."
cd -P "$TARGET_DIR"

echo "==> Garantindo branch correta e baixando atualizações ($TARGET_BRANCH)..."
git checkout "$TARGET_BRANCH"
git pull origin "$TARGET_BRANCH"

echo "==> Recriando o contêiner app-server..."
docker compose up -d --build app-server

echo "==> Status dos contêineres:"
docker ps --filter name=cargave --filter name=kwhub --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
