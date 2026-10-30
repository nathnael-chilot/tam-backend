import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import cookieParser from 'cookie-parser';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth & Tenancy Isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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

    // Clean up any existing test records
    const existingBethel = await prisma.tenant.findFirst({
      where: { name: 'Bethel Vocational Training' },
    });
    if (existingBethel) {
      await prisma.tenant.delete({ where: { id: existingBethel.id } });
    }
    await prisma.user.deleteMany({
      where: { OR: [{ email: 'owner@bethel.edu.et' }, { phone: '+251988776655' }] },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const testAcademyPhone = '0988776655';
  const testOwnerEmail = 'owner@bethel.edu.et';

  it('1. should register a new academy with owner account (Wizard Step 1-3)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register-academy')
      .send({
        academyName: 'Bethel Vocational Training',
        academyNameAm: 'ቤቴል የሙያ ማሰልጠኛ',
        city: 'Addis Ababa',
        subcity: 'Kolfe',
        academyPhone: '+251911998877',
        ownerName: 'Mulugeta Lemma',
        ownerNameAm: 'ሙሉጌታ ለማ',
        ownerEmail: testOwnerEmail,
        ownerPhone: testAcademyPhone,
        password: 'Password123!',
      })
      .expect(201);

    expect(res.body.tenant).toBeDefined();
    expect(res.body.tenant.name).toBe('Bethel Vocational Training');
    expect(res.body.user).toBeDefined();
    expect(res.body.accessToken).toBeDefined();

    // Verify cookie was set
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
  });

  it('2. should reject duplicate registration with the same phone', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/register-academy')
      .send({
        academyName: 'Another Academy',
        academyPhone: '+251911000000',
        ownerName: 'Duplicate Test',
        ownerPhone: testAcademyPhone,
        password: 'Password123!',
      })
      .expect(409);
  });

  it('3. should log in with phone and password and return active tenant', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        identifier: testAcademyPhone,
        password: 'Password123!',
      })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.activeTenant.name).toBe('Bethel Vocational Training');
  });

  it('4. should access /v1/auth/me using bearer token', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({
        identifier: testOwnerEmail,
        password: 'Password123!',
      });

    const token = loginRes.body.accessToken;

    const meRes = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(meRes.body.name).toBe('Mulugeta Lemma');
    expect(meRes.body.memberships.length).toBeGreaterThan(0);
  });

  it('5. should enforce PostgreSQL RLS tenant isolation between tenants', async () => {
    // Fetch Lucy Academy tenant ID and Bethel Academy tenant ID
    const lucyTenant = await prisma.tenant.findFirst({
      where: { name: 'Lucy Language & Music Academy' },
    });
    const bethelTenant = await prisma.tenant.findFirst({
      where: { name: 'Bethel Vocational Training' },
    });

    expect(lucyTenant).toBeDefined();
    expect(bethelTenant).toBeDefined();

    // Under Lucy's tenant context, students of Bethel should not be visible
    await prisma.withTenant(lucyTenant!.id, async (tx) => {
      const students = await tx.student.findMany();
      // All returned students must belong to Lucy tenant
      for (const s of students) {
        expect(s.tenantId).toBe(lucyTenant!.id);
      }
    });

    // Under Bethel's tenant context, Lucy students must be invisible (0 returned)
    await prisma.withTenant(bethelTenant!.id, async (tx) => {
      const students = await tx.student.findMany();
      expect(students.length).toBe(0);
    });
  });
});
