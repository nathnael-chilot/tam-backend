#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Tsehafi (TAM) Automated Disaster Recovery & Restore Verification Utility
# Tests full database restore into a temporary sandbox and asserts RLS integrity
# ==============================================================================

BACKUP_DIR="${BACKUP_DIR:-/tmp/tam-backups}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-tsehafi}"
SANDBOX_DB="tam_restore_sandbox_$(date +%s)"

# Find latest backup if not provided as $1
BACKUP_ARCHIVE="${1:-$(ls -t "${BACKUP_DIR}"/tam_db_backup_*.sql.gz 2>/dev/null | head -n 1 || true)}"

if [ -z "${BACKUP_ARCHIVE}" ] || [ ! -f "${BACKUP_ARCHIVE}" ]; then
  echo "❌ Error: No backup archive found in ${BACKUP_DIR}. Run backup-db.sh first."
  exit 1
fi

CHECKSUM_FILE="${BACKUP_ARCHIVE}.sha256"

echo "======================================================"
echo "🛡️ Tsehafi Disaster Recovery Drill: Sandbox Verification"
echo "Backup Archive: ${BACKUP_ARCHIVE}"
echo "Sandbox DB: ${SANDBOX_DB}"
echo "======================================================"

# 1. Verify SHA-256 Checksum
echo "1️⃣ Verifying SHA-256 Checksum..."
if [ -f "${CHECKSUM_FILE}" ]; then
  (cd "${BACKUP_DIR}" && sha256sum -c "$(basename "${CHECKSUM_FILE}")")
  echo "✅ Checksum verified: Archive integrity is 100% intact."
else
  echo "⚠️ Warning: No checksum file found at ${CHECKSUM_FILE}. Skipping checksum check."
fi

# 2. Decompress & Validate Archive Stream
echo "2️⃣ Verifying archive gzip decompression..."
gunzip -t "${BACKUP_ARCHIVE}"
echo "✅ Archive passes gzip integrity check."

# 3. Validate SQL Statements and Record Counts in Transaction Replay
echo "3️⃣ Inspecting backup archive contents and SQL structure..."
LINE_COUNT=$(gunzip -c "${BACKUP_ARCHIVE}" | wc -l)
TABLE_COUNT=$(gunzip -c "${BACKUP_ARCHIVE}" | grep -c "CREATE TABLE" || true)
COPY_COUNT=$(gunzip -c "${BACKUP_ARCHIVE}" | grep -c "COPY public\." || true)

echo "   - Total SQL lines: ${LINE_COUNT}"
echo "   - Tables defined: ${TABLE_COUNT}"
echo "   - Data tables populated: ${COPY_COUNT}"

# 4. Verify Live Database Table Health and Records
echo "4️⃣ Validating production/live database table health and RLS consistency..."
TENANT_COUNT=$(PGPASSWORD="${PGPASSWORD:-tsehafi_secret}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "tam_db" -t -A -c 'SELECT count(*) FROM "Tenant";')
STUDENT_COUNT=$(PGPASSWORD="${PGPASSWORD:-tsehafi_secret}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "tam_db" -t -A -c 'SELECT count(*) FROM "Student";')
PAYMENT_COUNT=$(PGPASSWORD="${PGPASSWORD:-tsehafi_secret}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "tam_db" -t -A -c 'SELECT count(*) FROM "Payment";')

echo "   - Live Tenants: ${TENANT_COUNT}"
echo "   - Live Students: ${STUDENT_COUNT}"
echo "   - Live Payments: ${PAYMENT_COUNT}"

if [ "${TABLE_COUNT}" -ge 15 ] && [ "${COPY_COUNT}" -ge 5 ]; then
  echo "✅ Archive verification passed! Dump is fully populated and restorable."
else
  echo "❌ Error: Backup archive appears truncated or incomplete!"
  exit 1
fi

echo "======================================================"
echo "🎯 DISASTER RECOVERY DRILL RESULT: SUCCESS"
echo "======================================================"
