-- Row-Level Security Policies for Multi-Tenancy Isolation
-- This script applies RLS to all tenant-scoped tables in tam_db

DO $$
DECLARE
    tbl text;
    tenant_tables text[] := ARRAY[
        'Student',
        'Course',
        'Trainer',
        'Room',
        'Batch',
        'Session',
        'Enrolment',
        'AttendanceRecord',
        'Payment',
        'Certificate',
        'LedgerEntry',
        'Instalment',
        'PaymentAllocation',
        'Receipt',
        'ReceiptCounter',
        'CertificateCounter',
        'SmsTemplate',
        'NotificationSettings',
        'SmsLog',
        'InAppNotification',
        'Subscription',
        'SubscriptionInvoice'
    ];
BEGIN
    FOREACH tbl IN ARRAY tenant_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', 'tenant_isolation_' || tbl, tbl);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL USING (
                NULLIF(current_setting(''app.tenant_id'', true), '''') IS NULL
                OR "tenantId" = current_setting(''app.tenant_id'', true)
            ) WITH CHECK (
                NULLIF(current_setting(''app.tenant_id'', true), '''') IS NULL
                OR "tenantId" = current_setting(''app.tenant_id'', true)
            );',
            'tenant_isolation_' || tbl,
            tbl
        );
    END LOOP;
END $$;
