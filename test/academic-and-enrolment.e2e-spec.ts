import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import cookieParser from 'cookie-parser';
import { PrismaService } from '../src/prisma/prisma.service';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Academic & Enrolment Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let tenantId: string;

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

    // Clean up test batches and courses if present
    await prisma.enrolment.deleteMany({
      where: { batch: { code: { in: ['DSN-2017-B1', 'CONFLICT-BATCH'] } } },
    });
    await prisma.session.deleteMany({
      where: { batch: { code: { in: ['DSN-2017-B1', 'CONFLICT-BATCH'] } } },
    });
    await prisma.batch.deleteMany({
      where: { code: { in: ['DSN-2017-B1', 'CONFLICT-BATCH'] } },
    });
    await prisma.course.deleteMany({
      where: { name: 'Graphic Design & UI/UX' },
    });
    await prisma.room.deleteMany({
      where: { name: 'Lab 304 (Design Lab)' },
    });
    await prisma.student.deleteMany({
      where: {
        OR: [
          { phone: { in: ['0944112233', '0955112233', '0966112233', '0977001122', '0988112233', '0988445566'] } },
          { phoneNorm: { in: ['+251944112233', '+251955112233', '+251966112233', '+251977001122', '+251988112233', '+251988445566'] } },
        ],
      },
    });

    // Log in as Lucy Academy owner
    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        identifier: '0911000001',
        password: 'Password123!',
      });

    authToken = loginRes.body.accessToken;
    tenantId = loginRes.body.activeTenant.id;
  });

  afterAll(async () => {
    await app.close();
  });

  let createdCourseId: string;
  let createdRoomId: string;
  let createdBatchId: string;
  let createdStudentId: string;

  it('1. should create a new Course with santim minor units', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/courses')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Graphic Design & UI/UX',
        nameAm: 'ግራፊክ ዲዛይን እና ዩአይ/ዩኤክስ',
        durationDays: 45,
        totalHours: 36,
        defaultFee: 5000, // 5,000 ETB
        requiredAttendancePct: 80,
      })
      .expect(201);

    expect(res.body.name).toBe('Graphic Design & UI/UX');
    expect(res.body.defaultFeeMinor).toBe('500000'); // BigInt serialized as string in JSON
    createdCourseId = res.body.id;
  });

  it('2. should create a Room with capacity limit', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/rooms')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Lab 304 (Design Lab)',
        capacity: 2, // Small capacity of 2 for testing capacity enforcement
      })
      .expect(201);

    expect(res.body.name).toBe('Lab 304 (Design Lab)');
    expect(res.body.capacity).toBe(2);
    createdRoomId = res.body.id;
  });

  it('3. should create a Batch and auto-generate sessions skipping Ethiopian public holidays', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/batches')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        code: 'DSN-2017-B1',
        courseId: createdCourseId,
        roomId: createdRoomId,
        capacity: 2,
        startDate: '2024-11-01',
        endDate: '2024-11-30',
        daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
        startTime: '10:00',
        endTime: '12:00',
        skipHolidays: true,
      })
      .expect(201);

    expect(res.body.batch).toBeDefined();
    expect(res.body.batch.code).toBe('DSN-2017-B1');
    expect(res.body.generatedSessionsCount).toBeGreaterThan(0);
    createdBatchId = res.body.batch.id;
  });

  it('4. should reject conflicting overlapping batch in the same room', async () => {
    // Attempt to book the same room Lab 304 on Mon/Wed at 10:00-12:00
    await request(app.getHttpServer())
      .post('/v1/batches')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        code: 'CONFLICT-BATCH',
        courseId: createdCourseId,
        roomId: createdRoomId,
        capacity: 2,
        startDate: '2024-11-01',
        endDate: '2024-11-30',
        daysOfWeek: [1, 3], // Overlaps with Mon, Wed
        startTime: '10:00',
        endTime: '12:00',
      })
      .expect(409);
  });

  it('5. should create student with auto-generated ST-2017-XXX number', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/students')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Nahom',
        lastName: 'Girma',
        firstNameAm: 'ናሆም',
        lastNameAm: 'ግርማ',
        phone: '0944112233',
        address: 'Gerji, Addis Ababa',
      })
      .expect(201);

    expect(res.body.studentNo).toMatch(/^ST-\d{4}-\d{3}$/);
    expect(res.body.phoneNorm).toBe('+251944112233');
    createdStudentId = res.body.id;
  });

  it('6. should reject duplicate student registration with the same phone in the same academy', async () => {
    await request(app.getHttpServer())
      .post('/v1/students')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Duplicate',
        lastName: 'Test',
        phone: '0944112233',
      })
      .expect(409);
  });

  it('7. should enrol student into batch and verify enrolment', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/enrolments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        studentId: createdStudentId,
        batchId: createdBatchId,
        discount: 500, // 500 Br discount
        discountReason: 'Student referral promo',
      })
      .expect(201);

    expect(res.body.status).toBe('ENROLLED');
    expect(res.body.feeMinor).toBe('500000');
    expect(res.body.discountMinor).toBe('50000');
  });

  it('8. should enforce seat capacity limit when batch is full', async () => {
    // Batch capacity is 2. Enrol student 2
    const student2Res = await request(app.getHttpServer())
      .post('/v1/students')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Helen',
        lastName: 'Berhe',
        phone: '0955112233',
      });

    await request(app.getHttpServer())
      .post('/v1/enrolments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        studentId: student2Res.body.id,
        batchId: createdBatchId,
      })
      .expect(201);

    // Now batch is full (2/2 seats). Attempt student 3
    const student3Res = await request(app.getHttpServer())
      .post('/v1/students')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Robel',
        lastName: 'Solomon',
        phone: '0966112233',
      });

    await request(app.getHttpServer())
      .post('/v1/enrolments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        studentId: student3Res.body.id,
        batchId: createdBatchId,
      })
      .expect(400); // 400 Bad Request because batch is full
  });

  it('9. should preview bulk student import and flag invalid phone or duplicates', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/students/import')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        rows: [
          { 'First Name': 'Birtukan', 'Last Name': 'Mideksa', Phone: '0977001122' },
          { 'First Name': 'Invalid', 'Last Name': 'Phone', Phone: '12345' }, // invalid
          { 'First Name': 'Duplicate', 'Last Name': 'InBatch', Phone: '0977001122' }, // duplicate in batch
          { 'First Name': 'Existing', 'Last Name': 'Student', Phone: '0944112233' }, // already exists from test 5
        ],
        commit: false,
      })
      .expect(201);

    expect(res.body.totalRows).toBe(4);
    expect(res.body.validCount).toBe(1);
    expect(res.body.errorCount).toBe(3);
    expect(res.body.committed).toBe(false);
    expect(res.body.preview.length).toBe(1);
    expect(res.body.preview[0].firstName).toBe('Birtukan');
  });

  it('10. should commit valid bulk student import and assign student IDs', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/students/import?commit=true')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        rows: [
          { 'First Name': 'Henok', 'Last Name': 'Abebe', Phone: '0988112233' },
          { 'First Name': 'Mahlet', 'Last Name': 'Gebre', Phone: '0988445566' },
        ],
      })
      .expect(201);

    expect(res.body.validCount).toBe(2);
    expect(res.body.importedCount).toBe(2);
    expect(res.body.committed).toBe(true);
    expect(res.body.created.length).toBe(2);
    expect(res.body.created[0].studentNo).toMatch(/^ST-\d{4}-\d{3}$/);
  });
});
