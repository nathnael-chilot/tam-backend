# Operational Runbook: Incident Response & Data Breach Protocol

**Statutory Framework:** Ethiopian Personal Data Protection Proclamation No. 1321/2024 (Art. 38 - Breach Notification)  
**Mandatory Notification Window:** 72 Hours from Detection  
**Authority:** Information Network Security Administration (INSA) / Competent Data Protection Authority

---

## 1. Incident Classification & Severity Levels
- **P0 (Critical / Severe Data Breach):** Unauthorized extraction or cross-tenant exposure of student PII, financial ledger entries, or passwords.
- **P1 (High / Potential Exposure):** Unauthenticated endpoint vulnerability identified or brute-force pattern detected.
- **P2 (Moderate / System Disruption):** Service outage, SMS gateway downtime, or performance degradation without data exposure.

---

## 2. 72-Hour Response Timeline (Proclamation 1321/2024)

```mermaid
gantt
    title 72-Hour Breach Response Protocol
    dateFormat  HH
    axisFormat  %H h
    section Immediate
    Isolate & Contain (Revoke tokens, block IP) :00, 04
    Forensic Snapshot & Root-Cause Analysis     :04, 16
    section Assessment
    Data Subject & Tenant Impact Audit        :16, 32
    Legal & Regulatory Consultation             :24, 40
    section Notification
    Notify Competent Authority (INSA)           :40, 56
    Notify Affected Academies & Students        :50, 72
```

### Phase 1: Containment (0–4 Hours)
1. Revoke all active JWT sessions for affected tenant(s) by invalidating user session timestamps or rotating JWT secrets.
2. Block offending IP addresses at firewall / Nginx level:
   ```bash
   sudo iptables -A INPUT -s <OFFENDING_IP> -j DROP
   ```
3. Take forensic snapshot of PostgreSQL logs and database backup:
   ```bash
   ./scripts/backup-db.sh
   cp /var/log/postgresql/postgresql-16-main.log /tmp/incident_log_$(date +%s).log
   ```

### Phase 2: Impact Assessment (4–24 Hours)
1. Run audit query on `AdminAuditLog` and system logs to identify compromised rows.
2. Determine exact categories of compromised personal data (names, phone numbers, payment records).

### Phase 3: Authority & Public Notification (24–72 Hours)
Under Proclamation 1321/2024, the platform must notify the authority and affected academies within 72 hours.

---

## 3. Bilingual Breach Notification Templates

### English Notification Template
> **Subject:** [URGENT] Security Notification: Data Incident at Tsehafi Academy Platform  
> **Dear Academy Administrator,**  
> We are writing to inform you of a security incident detected on [DATE] at [TIME] EAT affecting [ACADEMY NAME].  
> **What Happened:** Our security monitoring detected [UNAUTHORIZED ACCESS / ANOMALOUS ACTIVITY].  
> **What Information Was Involved:** The data affected was limited to [e.g. Student Name, Phone Number, Enrolment Record]. Financial payment card numbers and raw passwords were NOT compromised.  
> **What We Have Done:** The vulnerability was patched immediately within [X] minutes. Offending sessions have been terminated, and additional rate limiting has been enforced.  
> **Recommended Actions:** We recommend instructing all staff members to reset their account passwords.  
> For any inquiries, please contact our Data Protection Officer at `security@tam.et` or `+251 11 550 0000`.

### Amharic Notification Template (የደህንነት ማሳሰቢያ)
> **ርዕስ:** [አስቸኳይ] የደህንነት ማሳሰቢያ፡ በጸሐፊ አካዳሚ መድረክ ላይ የተከሰተ የደህንነት ክስተት  
> **ለተከበራችሁ የአካዳሚ አመራሮች፣**  
> በ [ቀን] በ [ሰዓት] በ [አካዳሚ ስም] መረጃ ላይ የተከሰተ ያልተፈቀደ የመረጃ ተደራሽነት ሙከራ መከሰቱን በአክብሮት እናሳውቃለን።  
> **ምን ተከሰተ?** የስርዓታችን የደህንነት ክትትል [ያልተፈቀደ የይለፍ ሙከራ / የመረጃ መዳረሻ] አግኝቶ ወዲያውኑ አግዶታል።  
> **ምን አይነት መረጃ ተነክቷል?** የተነካው መረጃ [የተማሪ ስም፣ ስልክ ቁጥር፣ የክፍል ምዝገባ] ሲሆን፣ የክፍያ ሚስጥራዊ ቁጥሮች እና ዋና የይለፍ ቃሎች በፍጹም አልተነኩም።  
> **የተወሰዱ እርምጃዎች:** ችግሩ በ [X] ደቂቃዎች ውስጥ ሙሉ በሙሉ ተስተካክሏል።  
> **የሚመከሩ እርምጃዎች:** ሁሉም የአካዳሚው ሰራተኞች የይለፍ ቃላቸውን በአዲስ እንዲቀይሩ እንመክራለን።  
> ለተጨማሪ መረጃ በ `security@tam.et` ወይም በስልክ `+251 11 550 0000` ያግኙን።
