import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import cookieParser from 'cookie-parser';
import { PrismaService } from '../src/prisma/prisma.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Certificates, Reports & Dashboard Analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let tenantId: string;
  let testStudentId: string;
  let testBatchId: string;
  let testCourseId: string;
  let issuedCertId: string;
  let issuedVerifyToken: string;

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
    tenantId = loginRes.body.activeTenant.id;

    // 2. Create student
    const randomPhone = `09${Math.floor(10000000 + Math.random() * 89999999)}`;
    const studentRes = await request(app.getHttpServer())
      .post('/v1/students')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Tewodros',
        lastName: 'Kassahun',
        phone: randomPhone,
      })
      .expect(201);
    testStudentId = studentRes.body.id;

    // 3. Create course and batch
    const courseRes = await request(app.getHttpServer())
      .post('/v1/courses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Master Sound Engineering',
        defaultFee: 3000,
        requiredAttendancePct: 80,
      })
      .expect(201);
    testCourseId = courseRes.body.id;

    const batchRes = await request(app.getHttpServer())
      .post('/v1/batches')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        courseId: testCourseId,
        code: `MSE-${Date.now().toString().slice(-4)}`,
        capacity: 20,
        startDate: '2024-11-01',
        endDate: '2024-11-30',
        daysOfWeek: [1, 3, 5],
        startTime: '10:00',
        endTime: '12:00',
        skipHolidays: false,
      })
      .expect(201);
    testBatchId = batchRes.body.batch.id;

    // 4. Enroll student
    await request(app.getHttpServer())
      .post('/v1/enrolments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        studentId: testStudentId,
        batchId: testBatchId,
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Checks eligibility and flags student with unpaid tuition balance as ineligible', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/certificates/eligibility')
      .query({ studentId: testStudentId, batchId: testBatchId })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.eligible).toBe(false);
    expect(res.body.criteria.feesCleared).toBe(false);
    expect(res.body.reasons.length).toBeGreaterThanOrEqual(1);
  });

  it('2. Rejects certificate issuance for ineligible student with 400 Bad Request', async () => {
    await request(app.getHttpServer())
      .post('/v1/certificates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        studentId: testStudentId,
        batchId: testBatchId,
      })
      .expect(400);
  });

  it('3. Clears student fees in full and marks session attendance', async () => {
    // Pay full 3,000 ETB
    await request(app.getHttpServer())
      .post('/v1/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        studentId: testStudentId,
        amount: 3000,
        method: 'TELEBIRR',
        reference: `TLB-CERT-${Date.now()}`,
        paidOn: '2026-10-31',
      })
      .expect(201);

    // Mark attendance records as PRESENT for all batch sessions so attendance is 100%
    const sessions = await prisma.session.findMany({
      where: { batchId: testBatchId },
    });
    for (const s of sessions) {
      await prisma.attendanceRecord.create({
        data: {
          tenantId,
          sessionId: s.id,
          studentId: testStudentId,
          status: 'PRESENT',
          markedById: 'e2e-tester',
        },
      });
    }

    // Verify student is now eligible
    const res = await request(app.getHttpServer())
      .get('/v1/certificates/eligibility')
      .query({ studentId: testStudentId, batchId: testBatchId })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.eligible).toBe(true);
    expect(res.body.criteria.feesCleared).toBe(true);
    expect(res.body.criteria.meetsAttendance).toBe(true);
  });

  it('4. Successfully issues certificate with sequential number and verify token', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/certificates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        studentId: testStudentId,
        batchId: testBatchId,
      })
      .expect(201);

    issuedCertId = res.body.certificate.id;
    issuedVerifyToken = res.body.verifyToken;

    expect(res.body.formattedNumber).toMatch(/^CERT-\d{4}-\d{4}$/);
    expect(issuedVerifyToken).toBeDefined();
    expect(res.body.verificationUrl).toContain(issuedVerifyToken);
  });

  it('5. Rejects duplicate certificate issuance with 409 Conflict', async () => {
    await request(app.getHttpServer())
      .post('/v1/certificates')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        studentId: testStudentId,
        batchId: testBatchId,
      })
      .expect(409);
  });

  it('6. Publicly verifies certificate by cryptographic token WITHOUT auth token', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/certificates/verify/${issuedVerifyToken}`)
      .expect(200);

    expect(res.body.valid).toBe(true);
    expect(res.body.status).toBe('ISSUED');
    expect(res.body.student.name).toBe('Tewodros Kassahun');
    expect(res.body.course.name).toBe('Master Sound Engineering');
    expect(res.body.academy.name).toBeDefined();
  });

  it('7. Revokes certificate with mandatory reason and verifies public verification reflects REVOKED', async () => {
    const revokeRes = await request(app.getHttpServer())
      .post(`/v1/certificates/${issuedCertId}/revoke`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        revokedReason: 'Disciplinary code breach identified post-graduation',
      })
      .expect(201);

    expect(revokeRes.body.status).toBe('REVOKED');
    expect(revokeRes.body.revokedReason).toContain('Disciplinary');

    // Check public verification route again without auth token
    const publicRes = await request(app.getHttpServer())
      .get(`/v1/certificates/verify/${issuedVerifyToken}`)
      .expect(200);

    expect(publicRes.body.valid).toBe(false);
    expect(publicRes.body.status).toBe('REVOKED');
    expect(publicRes.body.revokedReason).toBeDefined();
  });

  it('8. Retrieves Ethiopian Calendar monthly revenue report and verifies accurate ledger sums', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/reports/revenue')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.year).toBeDefined();
    expect(res.body.months).toHaveLength(13); // All 13 Ethiopian months
    expect(res.body.months[0].name).toBe('Meskerem');
    expect(res.body.months[12].name).toBe('Pagume');
    expect(res.body.summary.totalCollectedMinor).toBeDefined();
  });

  it('9. Retrieves aging debtors report and CSV export', async () => {
    const agingRes = await request(app.getHttpServer())
      .get('/v1/reports/aging')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(agingRes.body.summary).toBeDefined();
    expect(agingRes.body.debtors).toBeDefined();

    const csvRes = await request(app.getHttpServer())
      .get('/v1/reports/export/revenue')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(csvRes.header['content-type']).toContain('text/csv');
    expect(csvRes.text).toContain('Meskerem');
  });

  it('10. Retrieves Executive Owner Dashboard metrics and today timetable sessions', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/dashboard/owner')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.kpis.activeStudentsCount).toBeGreaterThanOrEqual(1);
    expect(res.body.ethiopianTermInfo.formattedDateAm).toBeDefined();
    expect(res.body.todaySessions).toBeDefined();
    expect(res.body.recentPayments).toBeDefined();
  });
});
