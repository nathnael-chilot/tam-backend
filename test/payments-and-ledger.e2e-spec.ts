import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import cookieParser from 'cookie-parser';
import { PrismaService } from '../src/prisma/prisma.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Payments & Money Core Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let tenantId: string;
  let studentId: string;
  let batchId: string;
  let firstPaymentId: string;
  let secondPaymentId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    // 1. Log in as Lucy Academy owner
    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        identifier: '0911000001',
        password: 'Password123!',
      })
      .expect(200);

    authToken = loginRes.body.accessToken;
    tenantId = loginRes.body.user.tenantId;

    // 2. Create a test student with unique phone
    const randomPhone = `09${Math.floor(10000000 + Math.random() * 89999999)}`;
    const studentRes = await request(app.getHttpServer())
      .post('/v1/students')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Solomon',
        lastName: 'Tekle',
        phone: randomPhone,
      })
      .expect(201);
    studentId = studentRes.body.id;

    // 3. Create a test course and batch
    const courseRes = await request(app.getHttpServer())
      .post('/v1/courses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Financial Audit Course',
        defaultFee: 5000, // 5,000 ETB
        requiredAttendancePct: 80,
      })
      .expect(201);

    const batchRes = await request(app.getHttpServer())
      .post('/v1/batches')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        courseId: courseRes.body.id,
        code: `FAC-${Date.now().toString().slice(-4)}`,
        capacity: 25,
        startDate: '2024-11-01',
        endDate: '2024-11-30',
        daysOfWeek: [1, 3, 5],
        startTime: '10:00',
        endTime: '12:00',
        skipHolidays: false,
      })
      .expect(201);
    batchId = batchRes.body.batch.id;

    // 4. Enroll student with a discount of 500 ETB (Net: 4,500 ETB)
    await request(app.getHttpServer())
      .post('/v1/enrolments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        studentId,
        batchId,
        discount: 500,
        discountReason: 'Early bird registration',
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Verifies initial enrolment ledger invariant: sum of ledger entries equals 4,500 ETB net', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/payments/students/${studentId}/statement`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.student.id).toBe(studentId);
    expect(res.body.summary.totalChargesEtb).toBe(5000);
    expect(res.body.summary.totalDiscountsEtb).toBe(500);
    expect(res.body.summary.totalPaidEtb).toBe(0);
    expect(res.body.summary.balanceEtb).toBe(4500);
    expect(res.body.instalments).toHaveLength(1);
    expect(res.body.instalments[0].status).toBe('PENDING');
  });

  const testRef = `TLB-${Date.now()}`;

  it('2. Records payment with santims conversion and issues gapless receipt #YYYY/0001', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        studentId,
        amount: 2000, // 2,000 ETB
        method: 'TELEBIRR',
        reference: testRef,
        paidOn: '2026-10-30',
        notes: 'Partial payment',
      })
      .expect(201);

    firstPaymentId = res.body.payment.id;
    expect(res.body.payment.amountEtb).toBe(2000);
    expect(res.body.receipt.receiptNumber).toMatch(/^\d{4}\/\d{4}$/);
    expect(res.body.receipt.number).toBeGreaterThanOrEqual(1);
    expect(res.body.amountInWords.english).toContain('Two Thousand Birr');
    expect(res.body.amountInWords.amharic).toContain('ሁለት ሺህ ብር');
    expect(res.body.allocations).toHaveLength(1);
    expect(res.body.allocations[0].amountMinor).toBe('200000');
  });

  it('3. Rejects duplicate transaction reference under the same payment method with 409 Conflict', async () => {
    await request(app.getHttpServer())
      .post('/v1/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        studentId,
        amount: 500,
        method: 'TELEBIRR',
        reference: testRef, // Duplicate reference
        paidOn: '2026-10-30',
      })
      .expect(409);
  });

  it('4. Records second payment and verifies strictly sequential receipt numbering', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        studentId,
        amount: 2500, // Fully clears remaining 2,500 ETB
        method: 'CASH',
        paidOn: '2026-10-30',
      })
      .expect(201);

    secondPaymentId = res.body.payment.id;
    expect(res.body.payment.amountEtb).toBe(2500);

    // Verify receipt number is strictly sequential
    const firstReceipt = await request(app.getHttpServer())
      .get(`/v1/payments/${firstPaymentId}/receipt`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.receipt.number).toBe(firstReceipt.body.receipt.number + 1);

    // Verify statement balance is now 0.00 ETB and instalment is PAID
    const stmtRes = await request(app.getHttpServer())
      .get(`/v1/payments/students/${studentId}/statement`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(stmtRes.body.summary.balanceEtb).toBe(0);
    expect(stmtRes.body.summary.totalPaidEtb).toBe(4500);
    expect(stmtRes.body.instalments[0].status).toBe('PAID');
  });

  it('5. Retrieves printable receipt voucher and tracks reprint count', async () => {
    const receiptRes = await request(app.getHttpServer())
      .get(`/v1/payments/${firstPaymentId}/receipt`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(receiptRes.body.receipt.isReprint).toBe(true); // Since it was fetched previously
    expect(receiptRes.body.receipt.reprintCount).toBeGreaterThanOrEqual(1);
    expect(receiptRes.body.student.fullName).toBe('Solomon Tekle');
  });

  it('6. Voids payment with mandatory reason; verifies compensating ledger entry and re-opened instalment', async () => {
    const voidRes = await request(app.getHttpServer())
      .post(`/v1/payments/${secondPaymentId}/void`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        voidReason: 'Duplicate teller entry by cashier',
      })
      .expect(201);

    expect(voidRes.body.status).toBe('VOIDED');

    // Verify statement shows balance restored to 2,500 ETB and instalment is PARTIAL again
    const stmtRes = await request(app.getHttpServer())
      .get(`/v1/payments/students/${studentId}/statement`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(stmtRes.body.summary.balanceEtb).toBe(2500);
    expect(stmtRes.body.summary.totalPaidEtb).toBe(2000);
    expect(stmtRes.body.instalments[0].status).toBe('PARTIAL');

    // Confirm append-only ledger has a VOID entry
    const voidEntries = stmtRes.body.ledgerEntries.filter(
      (e: any) => e.kind === 'VOID',
    );
    expect(voidEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('7. Generates end-of-day cash-up report matching exact method breakdown', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/payments/cash-up')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.date).toBeDefined();
    expect(res.body.methods.TELEBIRR).toBeDefined();
    expect(res.body.methods.TELEBIRR.postedMinor).toBeGreaterThanOrEqual(200000);
    expect(res.body.totals.voidedCount).toBeGreaterThanOrEqual(1);
    expect(res.body.totals.netIntakeMinor).toBeDefined();
  });
});
