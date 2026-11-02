#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Tsehafi (TAM) Automated Database Backup Utility
# Format: Custom/Directory pg_dump with Gzip Compression and SHA-256 Checksum
# ==============================================================================

BACKUP_DIR="${BACKUP_DIR:-/tmp/tam-backups}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-tam_db}"
DB_USER="${DB_USER:-tsehafi}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_backup_${TIMESTAMP}.sql.gz"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"

mkdir -p "${BACKUP_DIR}"

echo "======================================================"
echo "📦 Tsehafi Database Backup: ${DB_NAME}"
echo "Time: $(date)"
echo "Target: ${BACKUP_FILE}"
echo "======================================================"

# Export schema + data with pg_dump and gzip
PGPASSWORD="${PGPASSWORD:-tsehafi_secret}" pg_dump \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --enable-row-security \
  --no-owner \
  --no-acl \
  | gzip -9 > "${BACKUP_FILE}"

# Generate SHA-256 Checksum for archive integrity verification
sha256sum "${BACKUP_FILE}" > "${CHECKSUM_FILE}"

FILESIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "✅ Backup completed successfully!"
echo "Size: ${FILESIZE}"
echo "Checksum: $(cat "${CHECKSUM_FILE}")"

# Retention Cleanup: remove backups older than RETENTION_DAYS
echo "🧹 Pruning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "${DB_NAME}_backup_*.sql.gz*" -mtime +"${RETENTION_DAYS}" -delete || true

echo "🏁 Backup procedure completed cleanly."
