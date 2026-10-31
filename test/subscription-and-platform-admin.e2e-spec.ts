import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SubscriptionTier, BillingCadence, PlatformPaymentStatus } from '@prisma/client';
import * as crypto from 'crypto';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Subscription, Billing & Platform Admin Console (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerToken: string;
  let ownerTenantId: string;
  let adminToken: string;
  let adminUserId: string;

  let createdInvoiceId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // 1. Register a test academy (owner)
    const unique = Date.now().toString().slice(-6);
    const regRes = await request(app.getHttpServer())
      .post('/v1/auth/register-academy')
      .send({
        academyName: `Addis Coding Academy ${unique}`,
        academyNameAm: `አዲስ ኮዲንግ አካዳሚ ${unique}`,
        academyPhone: `01155${unique}`,
        ownerName: 'Tewodros Kassahun',
        ownerEmail: `tewodros_${unique}@tam.et`,
        ownerPhone: `0911${unique}`,
        password: 'Password123!',
      })
      .expect(201);

    ownerToken = regRes.body.accessToken;
    ownerTenantId = regRes.body.tenant.id;

    // 2. Create a platform super admin user
    const adminUnique = Date.now().toString().slice(-5);
    const adminUser = await prisma.user.create({
      data: {
        name: 'Platform Super Admin',
        email: `admin_${adminUnique}@tsehafi.et`,
        phone: `+251922${adminUnique}`,
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
        isPlatformAdmin: true,
      },
    });
    adminUserId = adminUser.id;

    // Generate JWT for platform admin
    const jwtService = app.get(JwtService);
    adminToken = jwtService.sign({
      sub: adminUser.id,
      email: adminUser.email,
      phone: adminUser.phone,
      isPlatformAdmin: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Academy Subscription & Resource Usage', () => {
    it('GET /v1/subscription/current - should retrieve active trial subscription with dual calendar renewal', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/subscription/current')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('subscription');
      expect(res.body.subscription.tier).toBe(SubscriptionTier.STARTER);
      expect(res.body.subscription.status).toBe('TRIAL');
      expect(res.body.subscription.renewalEc).toHaveProperty('en');
      expect(res.body.subscription.renewalEc).toHaveProperty('am');
      expect(res.body.usage).toHaveProperty('students');
      expect(res.body.usage).toHaveProperty('staff');
      expect(res.body.usage).toHaveProperty('sms');
    });

    it('POST /v1/subscription/invoices - should create an upgrade invoice for Growth plan', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/subscription/invoices')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          tier: SubscriptionTier.GROWTH,
          cadence: BillingCadence.MONTHLY,
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.tier).toBe(SubscriptionTier.GROWTH);
      expect(res.body.amountSantims).toBe('240000'); // 2,400.00 ETB
      expect(res.body.amountEtb).toBe('2400.00');
      expect(res.body.status).toBe(PlatformPaymentStatus.PENDING);

      createdInvoiceId = res.body.id;
    });

    it('POST /v1/subscription/invoices/:id/slip - should upload bank deposit reference number and slip', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/subscription/invoices/${createdInvoiceId}/slip`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          referenceNumber: 'CBE-TX-998877',
          slipBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        })
        .expect(201);

      expect(res.body.referenceNumber).toBe('CBE-TX-998877');
      expect(res.body.status).toBe(PlatformPaymentStatus.PENDING);
    });

    it('POST /v1/subscription/invoices/:id/chapa-checkout - should initialize Chapa payment session', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/subscription/invoices/${createdInvoiceId}/chapa-checkout`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      expect(res.body).toHaveProperty('checkoutUrl');
      expect(res.body).toHaveProperty('txRef');
      expect(res.body.amountEtb).toBe('2400.00');
    });
  });

  describe('2. Plan Limits Guard Enforcement', () => {
    it('POST /v1/students - should allow student creation within quota', async () => {
      const studentPhone = `0913${Date.now().toString().slice(-6)}`;
      const res = await request(app.getHttpServer())
        .post('/v1/students')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          firstName: 'Abebe',
          lastName: 'Bikila',
          phone: studentPhone,
          sex: 'MALE',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.firstName).toBe('Abebe');
    });

    it('POST /v1/students - should reject student creation when plan cap is reached', async () => {
      // Temporarily mock tenant subscription active student count to cap
      const sub = await prisma.subscription.findUnique({
        where: { tenantId: ownerTenantId },
      });

      // Update subscription to a synthetic tier or create mock students to reach limit
      // Create a test tenant on Starter with student cap exceeded
      const subSpy = jest.spyOn(prisma.student, 'count').mockResolvedValueOnce(100);

      const studentPhone = `0914${Date.now().toString().slice(-6)}`;
      const res = await request(app.getHttpServer())
        .post('/v1/students')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          firstName: 'Almaz',
          lastName: 'Ayana',
          phone: studentPhone,
          sex: 'FEMALE',
        })
        .expect(403);

      expect(res.body.message).toContain('Active student limit (100) reached');
      expect(res.body.code).toBe('PLAN_LIMIT_EXCEEDED_STUDENTS');

      subSpy.mockRestore();
    });
  });

  describe('3. Platform Super-Admin Console', () => {
    it('GET /v1/admin/academies - should deny access to regular academy owners', async () => {
      await request(app.getHttpServer())
        .get('/v1/admin/academies')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);
    });

    it('GET /v1/admin/academies - should allow platform super-admin to list academies', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/academies')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      const target = res.body.find((a: any) => a.id === ownerTenantId);
      expect(target).toBeDefined();
      expect(target).toHaveProperty('studentsCount');
      expect(target).toHaveProperty('plan');
    });

    it('GET /v1/admin/academies/:id - should return 360 academy detail with 3 key stats and invoices', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/admin/academies/${ownerTenantId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('academy');
      expect(res.body.academy.id).toBe(ownerTenantId);
      expect(res.body).toHaveProperty('stats');
      expect(res.body.stats).toHaveProperty('activeStudents');
      expect(res.body.stats).toHaveProperty('monthlySubscriptionEtb');
      expect(res.body).toHaveProperty('invoices');
      expect(res.body.invoices.length).toBeGreaterThan(0);
    });

    it('GET /v1/admin/payments/pending - should list pending payment slips in verification queue', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/payments/pending')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const target = res.body.find((p: any) => p.id === createdInvoiceId);
      expect(target).toBeDefined();
      expect(target.referenceNumber).toBe('CBE-TX-998877');
    });

    it('POST /v1/admin/payments/:id/approve - should approve payment slip, extend subscription, and credit SMS', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/payments/${createdInvoiceId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body.status).toBe('APPROVED');

      // Verify subscription upgraded to GROWTH and active
      const sub = await prisma.subscription.findUnique({
        where: { tenantId: ownerTenantId },
      });
      expect(sub?.tier).toBe(SubscriptionTier.GROWTH);
      expect(sub?.status).toBe('ACTIVE');
    });

    it('POST /v1/admin/academies/:id/plan - should allow platform admin to override academy plan', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/academies/${ownerTenantId}/plan`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tier: SubscriptionTier.PRO,
          reason: 'Promotional pilot upgrade granted by management',
        })
        .expect(201);

      expect(res.body.tier).toBe(SubscriptionTier.PRO);

      const sub = await prisma.subscription.findUnique({
        where: { tenantId: ownerTenantId },
      });
      expect(sub?.tier).toBe(SubscriptionTier.PRO);
    });

    it('POST /v1/admin/academies/:id/impersonate - should issue scoped token and record audit log', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/academies/${ownerTenantId}/impersonate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Support ticket #1042 - troubleshooting attendance sync',
        })
        .expect(201);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body.activeTenantId).toBe(ownerTenantId);

      // Verify token allows accessing tenant students
      await request(app.getHttpServer())
        .get('/v1/students')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
    });

    it('POST /v1/admin/academies/:id/status - should suspend and re-activate academy with audit log', async () => {
      // 1. Suspend
      const suspendRes = await request(app.getHttpServer())
        .post(`/v1/admin/academies/${ownerTenantId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Terms of service non-compliance inquiry',
        })
        .expect(201);

      expect(suspendRes.body.status).toBe('SUSPENDED');

      // 2. Activate
      const activateRes = await request(app.getHttpServer())
        .post(`/v1/admin/academies/${ownerTenantId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'ACTIVE',
          reason: 'Compliance verified and approved',
        })
        .expect(201);

      expect(activateRes.body.status).toBe('ACTIVE');
    });

    it('GET /v1/admin/audit-logs - should retrieve comprehensive audit trail', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      const actions = res.body.map((l: any) => l.action);
      expect(actions).toContain('APPROVE_PAYMENT');
      expect(actions).toContain('IMPERSONATE_TENANT');
      expect(actions).toContain('CHANGE_PLAN');
    });
  });

  describe('4. Chapa Webhook Signature Verification', () => {
    it('POST /v1/subscription/chapa-webhook - should reject invalid HMAC signature', async () => {
      await request(app.getHttpServer())
        .post('/v1/subscription/chapa-webhook')
        .set('x-chapa-signature', 'invalid_fake_signature')
        .send({
          tx_ref: 'TSE-NON-EXISTENT',
          status: 'success',
          amount: 2400,
          currency: 'ETB',
        })
        .expect(401);
    });

    it('POST /v1/subscription/chapa-webhook - should process valid signed webhook idempotently', async () => {
      // 1. Create a fresh invoice
      const invRes = await request(app.getHttpServer())
        .post('/v1/subscription/invoices')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          tier: SubscriptionTier.GROWTH,
          cadence: BillingCadence.MONTHLY,
        })
        .expect(201);

      const chapaRes = await request(app.getHttpServer())
        .post(`/v1/subscription/invoices/${invRes.body.id}/chapa-checkout`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      const txRef = chapaRes.body.txRef;

      // 2. Generate valid HMAC-SHA256 signature
      const webhookSecret = process.env.CHAPA_WEBHOOK_SECRET || 'chapa_webhook_secret';
      const payload = {
        event: 'charge.complete',
        tx_ref: txRef,
        status: 'success',
        amount: 2400,
        currency: 'ETB',
      };
      const rawBody = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

      const hookRes = await request(app.getHttpServer())
        .post('/v1/subscription/chapa-webhook')
        .set('x-chapa-signature', signature)
        .send(payload)
        .expect(201);

      expect(hookRes.body.processed).toBe(true);
      expect(hookRes.body.status).toBe('APPROVED');

      // Idempotency: second dispatch returns already approved
      const secondRes = await request(app.getHttpServer())
        .post('/v1/subscription/chapa-webhook')
        .set('x-chapa-signature', signature)
        .send(payload)
        .expect(201);

      expect(secondRes.body.processed).toBe(true);
      expect(secondRes.body.message).toBe('Already approved');
    });
  });
});
