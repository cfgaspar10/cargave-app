#!/usr/bin/env bash
# ==============================================================================
# Script de Backup Diário Automatizado — kWhub (PostgreSQL)
# ==============================================================================
# Objetivo: Realizar dump compactado dos bancos de Produção e Homologação,
#           com política de retenção automática de 15 dias e logs detalhados.
# ==============================================================================

set -euo pipefail

# Configurações de Diretórios e Retenção
BACKUP_DIR="/home/gaspar/backups/kwhub"
LOG_FILE="/home/gaspar/backups/kwhub_backup.log"
RETENTION_DAYS=15
TIMESTAMP=$(date '+%Y-%m-%d_%H%M%S')

# Criação de pastas necessárias
mkdir -p "$BACKUP_DIR"

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "$msg" | tee -a "$LOG_FILE"
}

log "=========================================================="
log "INÍCIO DA ROTINA DE BACKUP — kWhub POSTGRESQL"
log "=========================================================="

# 1. Backup do Banco de Produção (cargave-prod-db ou kwhub-prod-db)
PROD_CONTAINER=""
for c in "cargave-prod-db" "kwhub-prod-db"; do
  if docker ps --format '{{.Names}}' | grep -q "^${c}$"; then
    PROD_CONTAINER="$c"
    break
  fi
done

if [ -n "$PROD_CONTAINER" ]; then
  PROD_USER="${POSTGRES_USER:-cargave_user}"
  # Se for o legado, tenta usar kwhub_user
  if [ "$PROD_CONTAINER" = "kwhub-prod-db" ]; then PROD_USER="kwhub_user"; fi
  PROD_DB="${POSTGRES_DB:-cargave_prod_db}"
  if [ "$PROD_CONTAINER" = "kwhub-prod-db" ]; then PROD_DB="kwhub_prod_db"; fi
  PROD_FILE="$BACKUP_DIR/cargave_prod_${TIMESTAMP}.sql.gz"

  log "==> [PRODUÇÃO] Iniciando dump de '${PROD_DB}' via contêiner '${PROD_CONTAINER}'..."
  docker exec -i "$PROD_CONTAINER" pg_dump -U "$PROD_USER" -d "$PROD_DB" | gzip > "$PROD_FILE"
  
  if [ -s "$PROD_FILE" ]; then
    FILE_SIZE=$(du -h "$PROD_FILE" | cut -f1)
    log "==> [PRODUÇÃO] Backup concluído com sucesso: $PROD_FILE ($FILE_SIZE)"
  else
    log "==> [ERRO] O arquivo de backup de produção está vazio: $PROD_FILE"
    rm -f "$PROD_FILE"
  fi
else
  log "==> [AVISO] Contêiner de produção (cargave-prod-db / kwhub-prod-db) não está em execução. Pulando backup de produção."
fi

# 2. Backup do Banco de Homologação (cargave-hml-db ou kwhub-hml-db)
HML_CONTAINER=""
for c in "cargave-hml-db" "kwhub-hml-db"; do
  if docker ps --format '{{.Names}}' | grep -q "^${c}$"; then
    HML_CONTAINER="$c"
    break
  fi
done

if [ -n "$HML_CONTAINER" ]; then
  HML_USER="${POSTGRES_USER:-cargave_user}"
  if [ "$HML_CONTAINER" = "kwhub-hml-db" ]; then HML_USER="kwhub_user"; fi
  HML_DB="${POSTGRES_DB:-cargave_hml_db}"
  if [ "$HML_CONTAINER" = "kwhub-hml-db" ]; then HML_DB="kwhub_hml_db"; fi
  HML_FILE="$BACKUP_DIR/cargave_hml_${TIMESTAMP}.sql.gz"

  log "==> [HOMOLOGAÇÃO] Iniciando dump de '${HML_DB}' via contêiner '${HML_CONTAINER}'..."
  docker exec -i "$HML_CONTAINER" pg_dump -U "$HML_USER" -d "$HML_DB" | gzip > "$HML_FILE"
  
  if [ -s "$HML_FILE" ]; then
    FILE_SIZE=$(du -h "$HML_FILE" | cut -f1)
    log "==> [HOMOLOGAÇÃO] Backup concluído com sucesso: $HML_FILE ($FILE_SIZE)"
  else
    log "==> [ERRO] O arquivo de backup de homologação está vazio: $HML_FILE"
    rm -f "$HML_FILE"
  fi
else
  log "==> [AVISO] Contêiner de homologação (cargave-hml-db / kwhub-hml-db) não está em execução. Pulando backup de homologação."
fi

# 3. Política de Retenção (Excluir backups com mais de 15 dias)
log "==> Aplicando política de retenção: removendo arquivos com mais de $RETENTION_DAYS dias..."
REMOVED_COUNT=$(find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime +"$RETENTION_DAYS" | wc -l)
find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime +"$RETENTION_DAYS" -exec rm -f {} \;
log "==> Arquivos antigos removidos: $REMOVED_COUNT"

# 4. Resumo de Armazenamento
TOTAL_BACKUPS=$(find "$BACKUP_DIR" -type f -name "*.sql.gz" | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
log "==> Total de backups preservados: $TOTAL_BACKUPS (Ocupando $TOTAL_SIZE em disco)"
log "=========================================================="
log "ROTINA DE BACKUP kWhub CONCLUÍDA COM SUCESSO"
log "=========================================================="
