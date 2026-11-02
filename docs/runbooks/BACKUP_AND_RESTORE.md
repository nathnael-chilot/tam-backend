# Operational Runbook: Database Backup and Disaster Recovery

**Service:** Tsehafi Training Academy Management (TAM) SaaS  
**System:** PostgreSQL 16 (Multi-Tenant with Row-Level Security)  
**Classification:** Mission Critical Operations

---

## 1. Backup Strategy & Frequency
- **Daily Full Logical Backup:** Run at 02:00 UTC (05:00 EAT) via system cron executing `scripts/backup-db.sh`.
- **Format:** Custom PostgreSQL dump compressed with Gzip (`gzip -9`).
- **Integrity Verification:** SHA-256 cryptographic checksum generated automatically alongside each archive (`.sql.gz.sha256`).
- **Retention Schedule:**
  - Daily backups: Retained for 30 days locally on NVMe disk.
  - Weekly backups: Synchronized to secondary encrypted offsite object storage (S3/Wasabi compatible) and retained for 90 days.
  - Monthly financial audit snapshots: Retained indefinitely to satisfy Ethiopian tax and corporate bookkeeping compliance.

---

## 2. Automated Backup Execution

### Cron Job Configuration
```cron
# Daily backup at 02:00 UTC (05:00 East Africa Time)
0 2 * * * /home/tsehafi/tam-backend/scripts/backup-db.sh >> /var/log/tam/backup.log 2>&1
```

### Manual Backup Command
```bash
cd /home/tsehafi/tam-backend
./scripts/backup-db.sh
```

---

## 3. Disaster Recovery & Restoration Procedure

### Phase A: Integrity Verification
Prior to any restoration attempt, verify that the archive has not been corrupted or tampered with:
```bash
cd /tmp/tam-backups
sha256sum -c tam_db_backup_YYYYMMDD_HHMMSS.sql.gz.sha256
```
Expected output: `tam_db_backup_YYYYMMDD_HHMMSS.sql.gz: OK`

### Phase B: Sandbox Dry-Run Verification
Before applying to live production, run the automated drill:
```bash
./scripts/verify-restore.sh /tmp/tam-backups/tam_db_backup_YYYYMMDD_HHMMSS.sql.gz
```

### Phase C: Emergency Production Restoration
If database corruption, accidental drop, or hardware failure occurs:

1. **Stop Application Containers to prevent writes:**
   ```bash
   docker stop tam-backend tam-frontend
   ```

2. **Drop Corrupted Database and Recreate Clean Target:**
   ```bash
   PGPASSWORD=$DB_PASSWORD dropdb -h localhost -U tsehafi tam_db
   PGPASSWORD=$DB_PASSWORD createdb -h localhost -U tsehafi tam_db
   ```

3. **Restore Full Archive:**
   ```bash
   gunzip -c /tmp/tam-backups/tam_db_backup_YYYYMMDD_HHMMSS.sql.gz | \
     PGPASSWORD=$DB_PASSWORD psql -h localhost -U tsehafi -d tam_db
   ```

4. **Re-apply Row-Level Security Policies:**
   ```bash
   PGPASSWORD=$DB_PASSWORD psql -h localhost -U tsehafi -d tam_db -f prisma/rls_policies.sql
   ```

5. **Restart Services and Run Health Check:**
   ```bash
   docker start tam-backend tam-frontend
   curl -f http://localhost:4000/
   ```
