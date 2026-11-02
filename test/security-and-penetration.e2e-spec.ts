import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Security, Penetration & Compliance Suite (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Tenant A: Alpha Academy
  let tenantAId: string;
  let tokenA: string;
  let studentAId: string;
  let courseAId: string;
  let batchAId: string;

  // Tenant B: Beta Academy
  let tenantBId: string;
  let tokenB: string;
  let studentBId: string;
  let courseBId: string;
  let batchBId: string;

  beforeAll(async () => {
    (BigInt.prototype as any).toJSON = function () {
      return this.toString();
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    // Register Academy A
    const uA = Date.now().toString().slice(-6);
    const regARes = await request(app.getHttpServer())
      .post('/v1/auth/register-academy')
      .send({
        academyName: `Alpha Academy ${uA}`,
        academyPhone: `01155${uA}`,
        ownerEmail: `owner.alpha.${uA}@example.com`,
        password: 'AlphaPassword123!',
        ownerName: 'Abebe Kebede',
        ownerPhone: `0911${uA}`,
      })
      .expect(201);

    tenantAId = regARes.body.tenant.id;
    tokenA = regARes.body.accessToken;

    // Register Academy B
    const uB = (Date.now() + 1).toString().slice(-6);
    const regBRes = await request(app.getHttpServer())
      .post('/v1/auth/register-academy')
      .send({
        academyName: `Beta Academy ${uB}`,
        academyPhone: `01156${uB}`,
        ownerEmail: `owner.beta.${uB}@example.com`,
        password: 'BetaPassword123!',
        ownerName: 'Chala Desta',
        ownerPhone: `0912${uB}`,
      })
      .expect(201);

    tenantBId = regBRes.body.tenant.id;
    tokenB = regBRes.body.accessToken;

    // Create Student in Academy A
    const studentARes = await request(app.getHttpServer())
      .post('/v1/students')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        firstName: 'Solomon',
        lastName: 'Tekle',
        phone: '+251911223344',
        sex: 'MALE',
      })
      .expect(201);
    studentAId = studentARes.body.id;

    // Create Course and Batch in Academy A
    const courseARes = await request(app.getHttpServer())
      .post('/v1/courses')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Alpha Graphics',
        defaultFee: 3000,
      })
      .expect(201);
    courseAId = courseARes.body.id;

    const batchARes = await request(app.getHttpServer())
      .post('/v1/batches')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        courseId: courseAId,
        code: `AG-B1-${Date.now()}`,
        startDate: '2026-11-01',
        endDate: '2027-01-31',
        capacity: 25,
        daysOfWeek: [1, 3, 5],
        startTime: '10:00',
        endTime: '12:00',
      })
      .expect(201);
    batchAId = batchARes.body.id;

    // Create Student in Academy B
    const studentBRes = await request(app.getHttpServer())
      .post('/v1/students')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        firstName: 'Hanna',
        lastName: 'Hailu',
        phone: '+251922334455',
        sex: 'FEMALE',
      })
      .expect(201);
    studentBId = studentBRes.body.id;

    // Create Course and Batch in Academy B
    const courseBRes = await request(app.getHttpServer())
      .post('/v1/courses')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        name: 'Beta Accounting',
        defaultFee: 4000,
      })
      .expect(201);
    courseBId = courseBRes.body.id;

    const batchBRes = await request(app.getHttpServer())
      .post('/v1/batches')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        courseId: courseBId,
        code: `BA-B1-${Date.now()}`,
        startDate: '2026-11-01',
        endDate: '2027-01-31',
        capacity: 30,
        daysOfWeek: [2, 4, 6],
        startTime: '14:00',
        endTime: '16:00',
      })
      .expect(201);
    batchBId = batchBRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Cross-Tenant RLS & Data Isolation Penetration', () => {
    it('Blocks Tenant A from reading Tenant B student by UUID (returns 404 NotFound)', async () => {
      await request(app.getHttpServer())
        .get(`/v1/students/${studentBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('Blocks Tenant A from updating Tenant B student (returns 404 NotFound)', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/students/${studentBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ firstName: 'Malicious Hijack' })
        .expect(404);

      // Verify Tenant B's student was NOT modified
      const checkB = await request(app.getHttpServer())
        .get(`/v1/students/${studentBId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(checkB.body.firstName).toBe('Hanna');
    });

    it('Blocks Tenant A from deleting Tenant B student (returns 404 NotFound)', async () => {
      await request(app.getHttpServer())
        .delete(`/v1/students/${studentBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('Ignores forged x-tenant-id header and strictly enforces token tenant scope', async () => {
      // Tenant A sends x-tenant-id: tenantBId in header
      const res = await request(app.getHttpServer())
        .get('/v1/students')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-tenant-id', tenantBId)
        .expect(200);

      // Must only return Tenant A's students, never Tenant B's
      const studentIds = res.body.items.map((s: any) => s.id);
      expect(studentIds).toContain(studentAId);
      expect(studentIds).not.toContain(studentBId);
    });

    it('Blocks Tenant A from viewing Tenant B batches (returns 404 NotFound)', async () => {
      await request(app.getHttpServer())
        .get(`/v1/batches/${batchBId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('Blocks Tenant A from posting payment against Tenant B student', async () => {
      await request(app.getHttpServer())
        .post('/v1/payments')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          studentId: studentBId, // Belongs to Tenant B
          amount: 500,
          method: 'CASH',
          paidOn: new Date().toISOString().slice(0, 10),
        })
        .expect(404);
    });
  });

  describe('2. Authentication, Token Tampering & Privilege Escalation', () => {
    it('Rejects requests with forged/tampered JWT signature with 401 Unauthorized', async () => {
      const tamperedToken = tokenA.slice(0, -6) + 'xyz123';
      await request(app.getHttpServer())
        .get('/v1/students')
        .set('Authorization', `Bearer ${tamperedToken}`)
        .expect(401);
    });

    it('Rejects requests without Bearer prefix with 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .get('/v1/students')
        .set('Authorization', tokenA)
        .expect(401);
    });

    it('Blocks normal tenant owner from accessing Platform Admin endpoints with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/v1/admin/academies')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(403);
    });

    it('Blocks normal tenant from approving bank slips on platform admin queue', async () => {
      await request(app.getHttpServer())
        .post('/v1/admin/payments/fake-invoice-id/approve')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(403);
    });
  });

  describe('3. Proclamation 1321/2024 Data Subject Rights & Erasure', () => {
    it('Exports full structured personal data archive for student (Art. 28)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/students/${studentAId}/export-data`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.legalBasis).toContain('Proclamation 1321/2024');
      expect(res.body.exportedAt).toBeDefined();
      expect(res.body.studentProfile).toBeDefined();
      expect(res.body.studentProfile.firstName).toBe('Solomon');
      expect(res.body.studentProfile.lastName).toBe('Tekle');
      expect(res.body.enrolments).toBeDefined();
      expect(res.body.attendanceHistory).toBeDefined();
      expect(res.body.financialRecords).toBeDefined();
      expect(res.body.certificates).toBeDefined();
      expect(res.body.communications).toBeDefined();
    });

    it('Blocks cross-tenant data export attempts (Tenant A cannot export Tenant B student)', async () => {
      await request(app.getHttpServer())
        .get(`/v1/students/${studentBId}/export-data`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('Anonymizes student personal data while preserving ledger integrity (Art. 31)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/students/${studentAId}/anonymize`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(201);

      expect(res.body.message).toContain('anonymized');
      expect(res.body.status).toBe('DROPPED');
      expect(res.body.deletedAt).toBeDefined();

      // Verify student in DB has scrubbed PII
      const scrubbed = await prisma.student.findUnique({
        where: { id: studentAId },
      });

      expect(scrubbed).toBeDefined();
      expect(scrubbed?.firstName).toBe('Anonymized');
      expect(scrubbed?.lastName).toMatch(/^Student-/);
      expect(scrubbed?.firstNameAm).toBe('የተሰረዘ');
      expect(scrubbed?.phone).toBeNull();
      expect(scrubbed?.phoneNorm).toBeNull();
      expect(scrubbed?.guardianName).toBeNull();
      expect(scrubbed?.guardianPhone).toBeNull();
      expect(scrubbed?.smsConsent).toBe(false);
      expect(scrubbed?.deletedAt).not.toBeNull();
    });
  });
});
