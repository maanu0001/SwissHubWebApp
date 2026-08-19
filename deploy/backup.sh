#!/usr/bin/env bash
# SwissHub - taeglicher Datenbank-Dump.
#
#   cp deploy/backup.sh /usr/local/bin/swisshub-backup
#   chmod +x /usr/local/bin/swisshub-backup
#   crontab -e   ->   30 3 * * * /usr/local/bin/swisshub-backup
#
# Erwartet entweder eine laufende Docker-Compose-Umgebung (Standard) oder
# gesetztes DATABASE_URL fuer eine System-PostgreSQL-Installation.

set -euo pipefail

BACKUP_DIR="${SWISSHUB_BACKUP_DIR:-/var/backups/swisshub}"
PROJECT_DIR="${SWISSHUB_PROJECT_DIR:-/opt/swisshub}"
KEEP_DAYS="${SWISSHUB_BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H-%M)"
TARGET="${BACKUP_DIR}/swisshub_${STAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

if [[ -n "${DATABASE_URL:-}" ]]; then
  # Variante A: PostgreSQL laeuft direkt auf dem System.
  pg_dump --no-owner --clean --if-exists "${DATABASE_URL}" | gzip -9 > "${TARGET}"
else
  # Variante B: PostgreSQL laeuft im Docker-Compose-Stack.
  cd "${PROJECT_DIR}"
  docker compose -f docker-compose.prod.yml exec -T postgres \
    pg_dump --no-owner --clean --if-exists -U "${POSTGRES_USER:-swisshub}" "${POSTGRES_DB:-swisshub}" \
    | gzip -9 > "${TARGET}"
fi

chmod 600 "${TARGET}"

# Alte Sicherungen aufraeumen.
find "${BACKUP_DIR}" -name 'swisshub_*.sql.gz' -mtime "+${KEEP_DAYS}" -delete

echo "Backup geschrieben: ${TARGET} ($(du -h "${TARGET}" | cut -f1))"
