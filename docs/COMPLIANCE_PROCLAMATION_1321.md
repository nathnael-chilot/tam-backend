# Compliance Audit: Ethiopian Personal Data Protection Proclamation No. 1321/2024

**Organization:** Tsehafi Training Academy Management (TAM) SaaS  
**Legal Framework:** Proclamation No. 1321/2024 on the Protection of Personal Data  
**Assessment Date:** 2026-11-02  
**Compliance Status:** Fully Implemented (Go-Live Gate Cleared)

---

## 1. Principles of Data Processing (Article 5)

| Principle | Statutory Requirement | Tsehafi Implementation |
|---|---|---|
| **Lawfulness & Transparency** | Clear legal basis; processing explained in native languages | Bilingual Privacy Notice in Amharic & English presented at registration; opt-in consent captured. |
| **Purpose Limitation** | Data used solely for academy management & education | Enforced by schema boundaries: academic enrolment, attendance, fee collection, certificates. |
| **Data Minimization** | Collect only necessary fields | No biometric, political, or sensitive genetic data collected; minimal emergency contact fields. |
| **Accuracy** | Keep records updated; provide correction mechanisms | Self-service student profile updates via `/v1/students/:id`. |
| **Storage Limitation** | Retain data only as long as necessary | Soft-deletion with purge schedule; ledger records retained in compliance with Ministry of Revenues directives. |
| **Integrity & Confidentiality** | Technical measures preventing unauthorized access | Row-Level Security (`SET LOCAL app.tenant_id`), bcrypt password hashing, JWT HMAC-SHA256, TLS encryption. |

---

## 2. Data Subject Rights Implementation Matrix

### A. Right of Access & Data Portability (Article 28 & 30)
- **Endpoint:** `GET /v1/students/:id/export-data`
- **Specification:** Generates a structured JSON archive containing the student profile, guardians, course enrolments, full attendance history, receipts, certificates, and communication logs.
- **Access Control:** Restricted strictly to authenticated academy administrators of the student's tenant.

### B. Right to Erasure / "Right to be Forgotten" (Article 31)
- **Endpoint:** `POST /v1/students/:id/anonymize`
- **Specification:**
  - PII (first name, last name, phone, email, guardian details, address, photo) scrubbed and replaced with anonymous identifiers (`Anonymized`, `Student-XXXXXXXX`, `የተሰረዘ`).
  - SMS consent revoked (`smsConsent: false`).
  - Student status set to `DROPPED` with `deletedAt` timestamp recorded.
- **Tax & Bookkeeping Reconcilation:** Underlying payment records and immutable santims ledger entries remain preserved without PII to comply with commercial tax laws.

### C. Right to Consent & Marketing Opt-Out (Article 16)
- `smsConsent` Boolean flag stored per student profile.
- Automated quiet-hours enforcement (no SMS between 20:00 and 07:00 local time).
- Explicit consent captured for marketing broadcasts vs transactional payment receipts.

---

## 3. Data Localization & Hosting Verification (Article 42)
- Database and file storage must reside on infrastructure within the Federal Democratic Republic of Ethiopia or on sovereign cloud instances compliant with INSA data localization mandates.
- Multi-tenant architecture is portable across any containerized VPS environment (Docker + PostgreSQL 16 + S3-compatible storage).
