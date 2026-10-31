import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import cookieParser from 'cookie-parser';
import { PrismaService } from '../src/prisma/prisma.service';
import { SmsTriggerType, SmsStatus } from '@prisma/client';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe('Notifications, SMS Reminders & In-App Communications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let tenantId: string;
  let testStudentId: string;
  let testStudentPhone: string;
  let createdNotificationId: string;

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

    // 1. Log in as owner
    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        identifier: '0911000001',
        password: 'Password123!',
      })
      .expect(200);

    authToken = loginRes.body.accessToken;
    tenantId = loginRes.body.activeTenant.id;

    // Ensure tenant has at least 300 credits for testing
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { smsCredits: 300 },
    });

    // Reset settings for idempotent runs
    await prisma.notificationSettings.deleteMany({
      where: { tenantId },
    });

    // 2. Create student with phone
    testStudentPhone = `09${Math.floor(10000000 + Math.random() * 89999999)}`;
    const studentRes = await request(app.getHttpServer())
      .post('/v1/students')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Solomon',
        lastName: 'Bogale',
        phone: testStudentPhone,
        status: 'ACTIVE',
      })
      .expect(201);

    testStudentId = studentRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // Test 1: Settings
  it('1. GET /v1/notifications/settings returns settings, available credits and provider', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/notifications/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.settings).toBeDefined();
    expect(res.body.credits).toBeGreaterThanOrEqual(300);
    expect(res.body.provider).toBeDefined();
    expect(res.body.settings.quietHoursEnabled).toBe(true);
    expect(res.body.settings.quietHoursStart).toBe('20:00');
  });

  // Test 2: Update Settings
  it('2. PUT /v1/notifications/settings updates reminder rules and quiet hours', async () => {
    const res = await request(app.getHttpServer())
      .put('/v1/notifications/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        remindBeforeDueDays: 4,
        remindWhenOverdue: true,
        quietHoursStart: '21:00',
        quietHoursEnd: '06:30',
      })
      .expect(200);

    expect(res.body.remindBeforeDueDays).toBe(4);
    expect(res.body.quietHoursStart).toBe('21:00');
    expect(res.body.quietHoursEnd).toBe('06:30');
  });

  // Test 3: Templates List & Seeding
  it('3. GET /v1/notifications/templates returns seeded bilingual templates', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/notifications/templates')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(4);

    const overdueTemplate = res.body.find(
      (t: any) => t.triggerType === SmsTriggerType.PAYMENT_OVERDUE,
    );
    expect(overdueTemplate).toBeDefined();
    expect(overdueTemplate.contentAm).toContain('[የተማሪ ስም]');
    expect(overdueTemplate.contentEn).toContain('{{student_name}}');
  });

  // Test 4: Update Template
  it('4. PUT /v1/notifications/templates/:triggerType updates template content', async () => {
    const res = await request(app.getHttpServer())
      .put(`/v1/notifications/templates/${SmsTriggerType.PAYMENT_REMINDER_DUE}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        contentAm: 'ክቡር [የተማሪ ስም]፣ የትምህርት ክፍያ [መጠን] ብር በ [ቀን] ይጠበቃል።',
        contentEn: 'Notice to {{student_name}}: {{amount}} Br due on {{due_date}}.',
      })
      .expect(200);

    expect(res.body.contentAm).toContain('ክቡር [የተማሪ ስም]');
    expect(res.body.contentEn).toContain('Notice to {{student_name}}');
  });

  // Test 5: Single SMS Dispatch & Segment Calculation (Amharic Unicode: 70 chars vs > 70 chars)
  it('5. POST /v1/notifications/sms/send computes Amharic Unicode segments and deducts credits', async () => {
    const initialSettings = await request(app.getHttpServer())
      .get('/v1/notifications/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const initialCredits = initialSettings.body.credits;

    // Send Amharic message with > 70 characters (requires 2 segments in UCS-2)
    const longAmharicMessage =
      'ሰላም ሰለሞን ቦጋለ፣ የሉሲ አካዳሚ የኮምፒውተር ፕሮግራሚንግ ስልጠና ክፍያ 1,500.00 ብር ቀን ስላለፈ እባክዎ በአፋጣኝ በቴሌብር ይክፈሉ። እናመሰግናለን።';

    const sendRes = await request(app.getHttpServer())
      .post('/v1/notifications/sms/send')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        phone: testStudentPhone,
        message: longAmharicMessage,
        studentId: testStudentId,
        triggerType: SmsTriggerType.PAYMENT_OVERDUE,
      })
      .expect(201);

    expect(sendRes.body.status).toBe(SmsStatus.SENT);
    expect(sendRes.body.segments).toBe(2); // > 70 Amharic chars = 2 parts
    expect(sendRes.body.creditsDeducted).toBe(2);
    expect(sendRes.body.remainingCredits).toBe(initialCredits - 2);
  });

  // Test 6: Insufficient Credits Protection
  it('6. POST /v1/notifications/sms/send rejects dispatch when credits are insufficient', async () => {
    // Set tenant credits to 1
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { smsCredits: 1 },
    });

    // Try to send message requiring 2 segments
    const multiSegmentMessage =
      'ሰላም ሰለሞን ቦጋለ፣ የሉሲ አካዳሚ የኮምፒውተር ፕሮግራሚንግ ስልጠና ክፍያ 1,500.00 ብር ቀን ስላለፈ እባክዎ በአፋጣኝ በቴሌብር ይክፈሉ። እናመሰግናለን።';

    const res = await request(app.getHttpServer())
      .post('/v1/notifications/sms/send')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        phone: testStudentPhone,
        message: multiSegmentMessage,
        studentId: testStudentId,
      })
      .expect(400);

    expect(res.body.message).toContain('Insufficient SMS credits');
  });

  // Test 7: Recharge Credits
  it('7. POST /v1/notifications/credits/recharge tops up credit balance atomically', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/notifications/credits/recharge')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        credits: 500,
        paymentReference: 'CBE-BIRR-TX-998811',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.creditsAdded).toBe(500);
    expect(res.body.currentBalance).toBe(501); // 1 + 500
  });

  // Test 8: Batch SMS Dispatch with Dynamic Variable Interpolation
  it('8. POST /v1/notifications/sms/batch interpolates student variables and deducts credits', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/notifications/sms/batch')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        triggerType: SmsTriggerType.PAYMENT_OVERDUE,
        recipients: [
          {
            phone: '0911223344',
            name: 'Selamawit Tesfaye',
            amount: '1,500.00',
            dueDate: 'ጥቅምት 15',
          },
          {
            phone: '0922334455',
            name: 'Dawit Alemayehu',
            amount: '2,250.00',
            dueDate: 'ጥቅምት 20',
          },
        ],
        messageTemplate:
          'ሰላም [የተማሪ ስም]፣ የትምህርት ክፍያ [መጠን] ብር ቀን አልፏል። እናመሰግናለን።',
      })
      .expect(201);

    expect(res.body.totalRecipients).toBe(2);
    expect(res.body.successful).toBe(2);
    expect(res.body.totalCreditsDeducted).toBeGreaterThanOrEqual(2);
  });

  // Test 9: Outbox Logs
  it('9. GET /v1/notifications/sms/logs returns paginated audit records', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/notifications/sms/logs?limit=10')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data[0].recipientPhone).toBeDefined();
    expect(res.body.data[0].segments).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
  });

  // Test 10: In-App Notifications Feed & Mark As Read
  it('10. GET /v1/notifications/in-app and PATCH mark-read manages staff notifications', async () => {
    const feedRes = await request(app.getHttpServer())
      .get('/v1/notifications/in-app')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(feedRes.body.unreadCount).toBeGreaterThan(0);
    expect(Array.isArray(feedRes.body.notifications)).toBe(true);

    createdNotificationId = feedRes.body.notifications[0].id;

    // Mark as read
    const readRes = await request(app.getHttpServer())
      .patch(`/v1/notifications/in-app/${createdNotificationId}/read`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(readRes.body.isRead).toBe(true);
  });
});
