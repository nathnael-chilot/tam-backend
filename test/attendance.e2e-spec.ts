import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import cookieParser from 'cookie-parser';
import { PrismaService } from '../src/prisma/prisma.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Attendance Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let testSessionId: string;
  let testBatchId: string;
  let testStudent1Id: string;
  let testStudent2Id: string;
  let testRecordId: string;

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
      });
    authToken = loginRes.body.accessToken;

    // 2. Setup test course, batch, students, and session
    const courseRes = await request(app.getHttpServer())
      .post('/v1/courses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Attendance E2E Course',
        defaultFee: 2000,
        requiredAttendancePct: 80,
      })
      .expect(201);

    const batchRes = await request(app.getHttpServer())
      .post('/v1/batches')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        courseId: courseRes.body.id,
        code: 'ATT-2017-B1',
        capacity: 10,
        startDate: '2024-11-01',
        endDate: '2024-11-30',
        daysOfWeek: [1, 3, 5],
        startTime: '10:00',
        endTime: '12:00',
        skipHolidays: false,
      })
      .expect(201);

    testBatchId = batchRes.body.batch.id;

    // Get the first generated session directly from prisma
    const sessions = await prisma.session.findMany({
      where: { batchId: testBatchId },
      orderBy: { date: 'asc' },
    });
    testSessionId = sessions[0].id;

    // Create 2 test students
    const s1Res = await request(app.getHttpServer())
      .post('/v1/students')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Tsedey',
        lastName: 'Alemu',
        phone: '0999112233',
      });
    testStudent1Id = s1Res.body.id;

    const s2Res = await request(app.getHttpServer())
      .post('/v1/students')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Bereket',
        lastName: 'Kassa',
        phone: '0999445566',
      });
    testStudent2Id = s2Res.body.id;

    // Enrol students into batch
    await request(app.getHttpServer())
      .post('/v1/enrolments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ studentId: testStudent1Id, batchId: testBatchId });

    await request(app.getHttpServer())
      .post('/v1/enrolments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ studentId: testStudent2Id, batchId: testBatchId });
  });

  afterAll(async () => {
    // Clean up test data
    if (testBatchId) {
      await prisma.attendanceRecord.deleteMany({
        where: { session: { batchId: testBatchId } },
      });
      await prisma.enrolment.deleteMany({ where: { batchId: testBatchId } });
      await prisma.session.deleteMany({ where: { batchId: testBatchId } });
      await prisma.batch.deleteMany({ where: { id: testBatchId } });
    }
    await prisma.student.deleteMany({
      where: { phone: { in: ['0999112233', '0999445566'] } },
    });
    await prisma.course.deleteMany({
      where: { name: 'Attendance E2E Course' },
    });
    await app.close();
  });

  it('1. should query session attendance roster with unmarked students', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/attendance/sessions/${testSessionId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.session.id).toBe(testSessionId);
    expect(res.body.session.batchCode).toBe('ATT-2017-B1');
    expect(res.body.session.ethiopianDate).toBeDefined();
    expect(res.body.stats.totalStudents).toBe(2);
    expect(res.body.stats.markedCount).toBe(0);
    expect(res.body.roster.length).toBe(2);
    expect(res.body.roster[0].status).toBeNull();
  });

  it('2. should bulk mark session attendance and update session to COMPLETED', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/attendance/sessions/${testSessionId}/bulk`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        records: [
          {
            studentId: testStudent1Id,
            status: 'PRESENT',
            clientId: 'client-sync-uuid-1',
          },
          {
            studentId: testStudent2Id,
            status: 'LATE',
            note: 'Arrived 15 minutes late due to traffic',
            clientId: 'client-sync-uuid-2',
          },
        ],
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.markedCount).toBe(2);
    expect(res.body.status).toBe('COMPLETED');
  });

  it('3. should return marked roster with attendanceRecordIds', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/attendance/sessions/${testSessionId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.stats.markedCount).toBe(2);
    expect(res.body.stats.progressPct).toBe(100);

    const s1 = res.body.roster.find((r: any) => r.studentId === testStudent1Id);
    const s2 = res.body.roster.find((r: any) => r.studentId === testStudent2Id);

    expect(s1.status).toBe('PRESENT');
    expect(s2.status).toBe('LATE');
    expect(s2.note).toBe('Arrived 15 minutes late due to traffic');
    expect(s2.attendanceRecordId).toBeDefined();

    testRecordId = s2.attendanceRecordId;
  });

  it('4. should idempotently re-submit bulk attendance without duplicating records', async () => {
    // Re-submit with same client IDs
    await request(app.getHttpServer())
      .post(`/v1/attendance/sessions/${testSessionId}/bulk`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        records: [
          {
            studentId: testStudent1Id,
            status: 'PRESENT',
            clientId: 'client-sync-uuid-1',
          },
          {
            studentId: testStudent2Id,
            status: 'PRESENT', // Changed from LATE to PRESENT
            clientId: 'client-sync-uuid-2',
          },
        ],
      })
      .expect(201);

    // Verify record count is still exactly 2
    const recordsInDb = await prisma.attendanceRecord.count({
      where: { sessionId: testSessionId },
    });
    expect(recordsInDb).toBe(2);
  });

  it('5. should edit an attendance record with mandatory edit reason', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/attendance/records/${testRecordId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        status: 'EXCUSED',
        editReason: 'Student brought formal medical certificate from clinic',
        note: 'Excused sick leave',
      })
      .expect(200);

    expect(res.body.status).toBe('EXCUSED');
    expect(res.body.editReason).toBe('Student brought formal medical certificate from clinic');
    expect(res.body.editedAt).toBeDefined();
  });

  it('6. should reject retroactive edit without editReason', async () => {
    await request(app.getHttpServer())
      .patch(`/v1/attendance/records/${testRecordId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        status: 'ABSENT',
        // Missing editReason
      })
      .expect(400);
  });

  it('7. should query batch broadsheet register matrix and compute attendance rates', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/attendance/batches/${testBatchId}/register`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.batch.code).toBe('ATT-2017-B1');
    expect(res.body.sessions.length).toBeGreaterThan(0);
    expect(res.body.students.length).toBe(2);
    expect(res.body.matrix).toBeDefined();

    const studentSummary = res.body.students.find(
      (s: any) => s.studentId === testStudent1Id,
    );
    expect(studentSummary.stats.presentCount).toBeGreaterThanOrEqual(1);
    expect(studentSummary.stats.ratePct).toBeDefined();
  });
});
