#!/usr/bin/env bash
set -euo pipefail

DB_FILE="${DB_FILE:-/var/lib/pioneer-repair/repair.sqlite}"
ATTACHMENTS_DIR="${ATTACHMENTS_DIR:-/var/lib/pioneer-repair/attachments}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pioneer-repair}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/repair-$STAMP.sqlite'"
if [ -d "$ATTACHMENTS_DIR" ]; then
  tar -czf "$BACKUP_DIR/attachments-$STAMP.tar.gz" -C "$ATTACHMENTS_DIR" .
fi
find "$BACKUP_DIR" -type f -name 'repair-*.sqlite' -mtime +30 -delete
find "$BACKUP_DIR" -type f -name 'attachments-*.tar.gz' -mtime +30 -delete
