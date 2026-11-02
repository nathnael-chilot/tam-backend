# Tsehafi (TAM) — Production Readiness & Gap Fulfillment Guide

> **Target Audience:** Founding Engineer, DevOps, Platform Administrator & Legal/Compliance Team  
> **Applicable Regulations:** Personal Data Protection Proclamation No. 1321/2024 · Electronic Invoicing Directive No. 1142/2026  
> **Status:** Code Complete (Phases 1–9) · Infrastructure & External Integrations Gate  
> **Last Updated:** November 2026 / 2017 E.C.

---

## 1. Executive Summary & Readiness Radar

The **Tsehafi (ጸሐፊ)** Training Academy Management platform codebase has reached **100% Phase 1–9 milestone completion** with strict adherence to architectural and regional invariants:
- **Database Isolation:** PostgreSQL Row-Level Security (`FORCE ROW LEVEL SECURITY`) with `SET LOCAL app.tenant_id`.
- **Financial Arithmetic:** Integer minor units (`BIGINT` santim, 1 ETB = 100 santims) via an append-only double-entry ledger with gapless receipt numbering.
- **Regionalization:** 13-month Ethiopian Calendar (Pagume leap logic, Meskerem 1 fiscal start), bilingual Ge'ez/Latin typography, and +251 phone normalization.
- **Verification:** 80/80 backend E2E tests, 15/15 unit tests, and 32/32 Next.js App Router routes compiling cleanly.

### Gap Status by Operational Urgency

```
┌────────────────────────────────────────────────────────────────────────┐
│                        LAUNCH READINESS RADAR                          │
├────────────────────────────────┬───────────────┬───────────────────────┤
│ Domain                         │ Current State │ Production Action     │
├────────────────────────────────┼───────────────┼───────────────────────┤
│ 1. Data Localisation & Hosting │ Docker Local  │ [CRITICAL] ET Hosting │
│ 2. AfroMessage SMS Gateway     │ Mock Provider │ [CRITICAL] Sender ID  │
│ 3. Chapa Payment Gateway       │ Mock/Sandbox  │ [HIGH] Live API Keys  │
│ 4. Private Object Storage      │ Local Disk    │ [HIGH] MinIO / S3     │
│ 5. Asynchronous Job Worker     │ In-Process    │ [MEDIUM] Redis/BullMQ │
│ 6. Fiscal & Legal Compliance   │ Documented    │ [HIGH] DPA & MoR Gate │
│ 7. PWA Service Worker          │ Client Lib    │ [MEDIUM] PWA Manifest │
└────────────────────────────────┴───────────────┴───────────────────────┘
```

---

## 2. Gap 1: Infrastructure & Data Localisation (Proclamation 1321/2024 Art. 36)

### A. Statutory Requirement
Under **Proclamation No. 1321/2024 (Art. 36)**, personal data collected in Ethiopia (specifically student identities, national IDs/passports, guardian contacts, and financial records) must be **stored on servers physically located within Ethiopia**, unless explicit permission is granted by the data protection supervisory authority.

> [!WARNING]
> Do **NOT** host production databases containing real student or guardian records on foreign cloud providers (e.g., AWS Frankfurt, Contabo Germany, or DigitalOcean) without formal regulatory approval.

### B. Recommended Ethiopian Cloud / VPS Providers
1. **Ethio Telecom Cloud (TeleCloud VPS):**
   - Location: Addis Ababa Data Center (Churchill Road / Kality Tier III).
   - Website: [ethiotelecom.et/cloud](https://www.ethiotelecom.et/)
   - Specs for Pilot: 4 vCPU, 8 GB RAM, 100 GB SSD, Ubuntu 24.04 LTS.
2. **Wingu Africa Data Center (Addis Ababa Tier III):**
   - Location: ICT Park, Bole Lemi, Addis Ababa.
   - Website: [wingu.africa](https://wingu.africa)
3. **RedFox Solutions Group:**
   - Location: ICT Park, Addis Ababa.
   - Website: [redfox.et](https://redfox.et)

### C. Production Host Provisioning Steps

```bash
# 1. Update OS and install Docker & Docker Compose
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl ufw git postgresql-client

curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 2. Configure Firewall (UFW)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# 3. Clone Repository & Setup Production Config
git clone https://github.com/your-org/tam.git /opt/tsehafi
cd /opt/tsehafi
```

### D. Production Environment Variables (`/opt/tsehafi/tam-backend/.env`)

```ini
# Core
NODE_ENV=production
PORT=4000
FRONTEND_URL=https://tsehafi.et

# Security
JWT_SECRET=generate_with_openssl_rand_hex_64_here!
JWT_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# Database (Local Ethiopian Postgres)
DATABASE_URL="postgresql://tsehafi_prod:ComplexPassword2017!@postgres:5432/tsehafi_production?schema=public"

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# Third-Party SMS (AfroMessage)
AFROMESSAGE_API_KEY=YOUR_PRODUCTION_AFROMESSAGE_API_KEY
AFROMESSAGE_SENDER_ID=Tsehafi
AFROMESSAGE_API_URL=https://api.afromessage.com/api/send

# Third-Party Payments (Chapa)
CHAPA_SECRET_KEY=CHASECK_TEST-or-LIVE-KEY-HERE
CHAPA_WEBHOOK_SECRET=your_chapa_hmac_webhook_secret_here
CHAPA_CALLBACK_URL=https://tsehafi.et/settings/subscription?payment=success
```

---

## 3. Gap 2: Third-Party SMS Integration (AfroMessage)

### A. Overview
Tsehafi uses SMS for critical time-sensitive events:
- 3-day instalment due reminders.
- Overdue balance alerts.
- Student absence notifications.
- Two-factor OTP codes for password reset.

In Amharic, SMS is billed under UCS-2 (Unicode) encoding at **70 characters per segment** (compared to 160 characters in GSM-7).

### B. Step-by-Step AfroMessage Onboarding

1. **Register Merchant Account:**
   - Sign up at [afromessage.com](https://afromessage.com).
   - Complete business profile verification (TIN certificate and commercial registration).
2. **Apply for Sender-ID ("Tsehafi"):**
   - Telecommunications regulations in Ethiopia require official Sender-ID registration through the **Ethiopian Communications Authority (ECA)** and Ethio Telecom / Safaricom Ethiopia.
   - Letter template to AfroMessage Support (`support@afromessage.com`):
     ```
     Subject: Sender ID Application Request — Tsehafi Academy Management

     Dear AfroMessage Team,

     We are requesting the registration of the Alphanumeric Sender ID: "Tsehafi"
     Company Name: [Your Registered PLC / Entity Name]
     TIN Number: [Your TIN]
     Use Case: Transactional fee instalment reminders, attendance alerts, and OTP authentication for private educational academies in Ethiopia.
     
     Attached:
     1. Business Registration License
     2. TIN Certificate
     3. Letter of Authorization
     ```
3. **Configure AfroMessage in Tsehafi:**
   - In `tam-backend/.env`:
     ```ini
     AFROMESSAGE_API_KEY=Bearer_Token_From_AfroMessage_Console
     AFROMESSAGE_SENDER_ID=Tsehafi
     ```
   - In production, `tam-backend/src/modules/notifications/notifications.module.ts` automatically binds `AfroMessageProvider` when `AFROMESSAGE_API_KEY` is present.
4. **Delivery Callback Webhook:**
   - In the AfroMessage Portal, configure callback URL:  
     `https://api.tsehafi.et/v1/notifications/webhook/afromessage`

---

## 4. Gap 3: Live Payment Gateway (Chapa & CBE Birr / Telebirr)

### A. Overview
Tsehafi uses Chapa to collect subscription payments from academies (Starter: 1,200 Br, Growth: 2,400 Br, Pro: 4,800 Br) supporting:
- **Telebirr**
- **CBE Birr**
- **Amole / Awash / BOA**
- Direct Visa / Mastercard

Manual bank deposit slips (CBE, Awash, Abyssinia, Telebirr) are also supported via the built-in slip upload and verification queue (`/v1/admin/payments`).

### B. Chapa Activation Steps

1. **Create Chapa Account:**
   - Register at [chapa.co](https://chapa.co).
   - Submit business documents (Business License, Principal Registration, TIN, Tax Clearance, and Valid Kebele ID / Passport of General Manager).
2. **Retrieve API Keys:**
   - Navigate to **Settings > API & Webhooks**.
   - Copy **Live Secret Key** (`CHASECK_LIVE-...`) and **Public Key**.
3. **Configure Webhook:**
   - Webhook URL: `https://api.tsehafi.et/v1/subscription/webhook/chapa`
   - Set Secret Hash: Generate a secure random token (e.g., `openssl rand -hex 32`) and enter it in Chapa and in `.env` as `CHAPA_WEBHOOK_SECRET`.
   - Events to Subscribe: `charge.complete`, `transfer.reversed`.
4. **Verify Signature Security:**
   - `tam-backend` validates incoming requests with HMAC SHA-256 against `request.headers['x-chapa-signature']`.

---

## 5. Gap 4: Private Object Storage (MinIO / S3)

### A. Overview
Receipt PDFs, QR-coded graduation certificates, student photos, and uploaded bank transfer slips must be stored in secure, private object storage with signed URLs.

### B. Provisioning MinIO with Docker Compose
Add MinIO to `/opt/tsehafi/docker-compose.prod.yml`:

```yaml
  minio:
    image: minio/minio:RELEASE.2024-10-13T13-34-11Z
    container_name: tsehafi_minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: tsehafi_storage_admin
      MINIO_ROOT_PASSWORD: ComplexMinioPassword2017!
    volumes:
      - minio_data:/data
    networks:
      - tsehafi_network

volumes:
  minio_data:
```

### C. Create Buckets & Access Policies
1. Access MinIO console at `http://localhost:9001`.
2. Create bucket `tsehafi-private`.
3. Set bucket access policy to **Private** (all files served exclusively via backend presigned URLs with 15-minute expiry).

---

## 6. Gap 5: Asynchronous Worker (Redis + BullMQ)

### A. Overview
To prevent HTTP requests from hanging during:
- Bulk student Excel uploads (500+ rows with phone normalization and duplicate checks).
- Mass certificate generation (100+ PDF renderings with embedded Noto Sans Ethiopic fonts).
- Nightly SMS reminder dispatching (filtering unpaid instalments across all tenants).

### B. Production Worker Setup
Run the background worker in standalone mode:

```bash
# In tam-backend:
npm run start:worker
```

Or configure via `systemd` on the server:

```ini
# /etc/systemd/system/tsehafi-worker.service
[Unit]
Description=Tsehafi Background Job Worker
After=network.target redis.service

[Service]
Type=simple
User=tsehafi
WorkingDirectory=/opt/tsehafi/tam-backend
ExecStart=/usr/bin/node dist/worker.js
Restart=always
RestartSec=10
EnvironmentFile=/opt/tsehafi/tam-backend/.env

[Install]
WantedBy=multi-user.target
```

---

## 7. Gap 6: Fiscal & Legal Compliance Checklist

### A. Proclamation No. 1321/2024 (Personal Data Protection)
- [ ] **Data Controller & Processor Registration:** Register with the Ethiopian Data Protection Authority once the public registry opens.
- [ ] **Data Processing Agreements (DPA):** Provide each onboarding academy with Tsehafi's standard DPA establishing:
  - The **Academy** is the **Data Controller**.
  - **Tsehafi** is the **Data Processor**.
  - Student records are kept strictly confidential and isolated.
- [ ] **Minor & Guardian Consent Protocol:** Enrolment flows must capture guardian consent for students under 18 years of age.
- [ ] **Data Subject Rights Verification:**
  - Verify `GET /v1/students/:id/export-data` (JSON export of complete profile, ledger, attendance, and certificates).
  - Verify `POST /v1/students/:id/anonymize` (replaces personal identifiers with `ANON-XXXXX` while preserving financial audit ledger rows).
- [ ] **72-Hour Breach Notification Drill:** Test run the bilingual incident communication template located at [INCIDENT_RESPONSE_AND_BREACH.md](file:///home/nathnael/nathnael/TAM/tam-backend/docs/runbooks/INCIDENT_RESPONSE_AND_BREACH.md).

### B. Electronic Invoicing Directive No. 1142/2026 (Ministry of Revenues)
- [ ] Verify that all student receipts issued by academies explicitly carry the legal disclaimer:  
  `"Payment Receipt / የክፍያ ደረሰኝ — Not an Official Tax Invoice / ሕጋዊ የግብር ደረሰኝ አይደለም"`.
- [ ] Consult with a qualified Ethiopian tax adviser regarding your own SaaS subscription billing to academies:
  - Determine whether Tsehafi's monthly subscription invoices require Ministry of Revenues e-invoicing accreditation / IRN QR clearance during the 2026 rollout for large/medium taxpayers.

---

## 8. Gap 7: Offline PWA & Service Worker Registration

### A. Web App Manifest
Create `/home/nathnael/nathnael/TAM/tam-frontend/public/manifest.json`:

```json
{
  "name": "Tsehafi Academy Management",
  "short_name": "Tsehafi",
  "description": "Calm administration for private academies in Ethiopia",
  "start_url": "/dashboard",
  "display": "standalone",
  "background_color": "#F7F2E8",
  "theme_color": "#16291F",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

### B. Link Manifest in App Layout
Ensure `src/app/layout.tsx` links the manifest:

```tsx
<head>
  <link rel="manifest" href="/manifest.json" />
  <meta name="theme-color" content="#16291F" />
</head>
```

---

## 9. Pre-Flight Go-Live Gate Checklist

| Step | Task | Owner | Status |
| :---: | :--- | :---: | :---: |
| **1.1** | Provision VPS in Addis Ababa (Ethio Telecom Cloud / Wingu) | DevOps | [ ] |
| **1.2** | Configure domain DNS: `tsehafi.et` and `api.tsehafi.et` | DevOps | [ ] |
| **1.3** | Generate TLS certificates via Let's Encrypt / Certbot | DevOps | [ ] |
| **2.1** | Submit Sender-ID application "Tsehafi" to AfroMessage & ECA | Product | [ ] |
| **2.2** | Verify live AfroMessage SMS delivery on Ethio Telecom & Safaricom | QA | [ ] |
| **3.1** | Submit KYC business documents to Chapa | Finance | [ ] |
| **3.2** | Test live Telebirr & CBE Birr subscription checkout end-to-end | QA | [ ] |
| **4.1** | Execute automated database backup script (`scripts/backup-db.sh`) | DevOps | [ ] |
| **4.2** | Execute restore drill script (`scripts/verify-restore.sh`) | DevOps | [ ] |
| **5.1** | Distribute [TSEHAFI_ONE_PAGE_BROCHURE.md](file:///home/nathnael/nathnael/TAM/tam-backend/docs/sales/TSEHAFI_ONE_PAGE_BROCHURE.md) to 3 pilot academies | Sales | [ ] |
| **5.2** | Initiate Week 1 setup using [PILOT_ACADEMY_ONBOARDING_PLAYBOOK.md](file:///home/nathnael/nathnael/TAM/tam-backend/docs/sales/PILOT_ACADEMY_ONBOARDING_PLAYBOOK.md) | Operations | [ ] |
| **5.3** | Verify live cashier cash-up report against daily cash drawer | Operations | [ ] |

---

*For technical or regulatory questions regarding this guide, refer to [COMPLIANCE_PROCLAMATION_1321.md](file:///home/nathnael/nathnael/TAM/tam-backend/docs/COMPLIANCE_PROCLAMATION_1321.md) or open an issue on the platform repository.*
