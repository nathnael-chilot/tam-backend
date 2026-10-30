import { PrismaClient, Role, MemberStatus, TenantStatus, Sex, StudentStatus, BatchStatus, EnrolmentStatus, AttendStatus, PayMethod, PaymentStatus, Locale, CalendarKind } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // 1. Clean existing records in reverse dependency order
  await prisma.auditLog.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.certificate.deleteMany();
  await prisma.enrolment.deleteMany();
  await prisma.session.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.course.deleteMany();
  await prisma.room.deleteMany();
  await prisma.trainer.deleteMany();
  await prisma.student.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 2. Create Tenant: Lucy Language & Music Academy
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Lucy Language & Music Academy',
      nameAm: 'ሉሲ የቋንቋ እና የሙዚቃ አካዳሚ',
      type: 'VOCATIONAL_INSTITUTE',
      city: 'Addis Ababa',
      subcity: 'Bole',
      phone: '+251911223344',
      tin: '0012345678',
      defaultLocale: Locale.am,
      defaultCalendar: CalendarKind.ETHIOPIAN,
      timezone: 'Africa/Addis_Ababa',
      status: TenantStatus.ACTIVE,
    },
  });
  console.log(`✅ Created Tenant: ${tenant.name} (${tenant.id})`);

  // 3. Create Users & Memberships for each role
  const usersData = [
    {
      name: 'Abebe Kebede',
      nameAm: 'አበበ ከበደ',
      email: 'owner@lucy.edu.et',
      phone: '+251911000001',
      role: Role.OWNER,
    },
    {
      name: 'Tigist Haile',
      nameAm: 'ትዕግስት ኃይሌ',
      email: 'admin@lucy.edu.et',
      phone: '+251911000002',
      role: Role.ADMIN,
    },
    {
      name: 'Meron Tadesse',
      nameAm: 'ሜሮን ታደሰ',
      email: 'cashier@lucy.edu.et',
      phone: '+251911000003',
      role: Role.CASHIER,
    },
    {
      name: 'Yonas Assefa',
      nameAm: 'ዮናስ አሰፋ',
      email: 'registrar@lucy.edu.et',
      phone: '+251911000004',
      role: Role.REGISTRAR,
    },
    {
      name: 'Kassahun Worku',
      nameAm: 'ካሳሁን ወርቁ',
      email: 'trainer@lucy.edu.et',
      phone: '+251911000005',
      role: Role.TRAINER,
    },
  ];

  const userMap: Record<string, string> = {};

  for (const u of usersData) {
    const user = await prisma.user.create({
      data: {
        name: u.name,
        nameAm: u.nameAm,
        email: u.email,
        phone: u.phone,
        passwordHash,
        locale: Locale.am,
      },
    });

    await prisma.membership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        role: u.role,
        status: MemberStatus.ACTIVE,
      },
    });

    userMap[u.role] = user.id;
  }
  console.log('✅ Created Users and Memberships for all roles');

  // 4. Create Trainer Profile & Rooms
  const trainer = await prisma.trainer.create({
    data: {
      tenantId: tenant.id,
      userId: userMap[Role.TRAINER],
      name: 'Kassahun Worku',
      nameAm: 'ካሳሁን ወርቁ',
      phone: '+251911000005',
    },
  });

  const roomBole101 = await prisma.room.create({
    data: {
      tenantId: tenant.id,
      name: 'Studio A (Music Hall)',
      capacity: 25,
    },
  });

  const roomBole102 = await prisma.room.create({
    data: {
      tenantId: tenant.id,
      name: 'Room 202 (Language Lab)',
      capacity: 30,
    },
  });

  // 5. Create Courses
  const englishCourse = await prisma.course.create({
    data: {
      tenantId: tenant.id,
      name: 'Spoken English Proficiency II',
      nameAm: 'የእንግሊዝኛ ቋንቋ ተናጋሪነት ደረጃ ፪',
      durationDays: 60,
      totalHours: 48,
      defaultFeeMinor: BigInt(450000), // 4,500.00 Br
      requiredAttendancePct: 80,
    },
  });

  const kirarCourse = await prisma.course.create({
    data: {
      tenantId: tenant.id,
      name: 'Kirar & Begena (Traditional Music)',
      nameAm: 'የክራር እና በገና ባህላዊ የሙዚቃ ትምህርት',
      durationDays: 90,
      totalHours: 72,
      defaultFeeMinor: BigInt(600000), // 6,000.00 Br
      requiredAttendancePct: 85,
    },
  });
  console.log('✅ Created Courses: English Proficiency & Kirar/Begena');

  // 6. Create Batches
  const batchEnglish = await prisma.batch.create({
    data: {
      tenantId: tenant.id,
      code: 'ENG-2017-B1',
      courseId: englishCourse.id,
      trainerId: trainer.id,
      roomId: roomBole102.id,
      capacity: 25,
      startDate: new Date('2024-10-01'),
      endDate: new Date('2024-11-30'),
      status: BatchStatus.IN_PROGRESS,
      pattern: { days: [1, 3, 5], start: '18:00', end: '20:00' },
    },
  });

  const batchKirar = await prisma.batch.create({
    data: {
      tenantId: tenant.id,
      code: 'KIR-2017-B4',
      courseId: kirarCourse.id,
      trainerId: trainer.id,
      roomId: roomBole101.id,
      capacity: 20,
      startDate: new Date('2024-10-15'),
      endDate: new Date('2025-01-15'),
      status: BatchStatus.IN_PROGRESS,
      pattern: { days: [2, 4, 6], start: '16:00', end: '18:00' },
    },
  });

  // 7. Create Students
  const students = [
    {
      studentNo: 'ST-2017-001',
      firstName: 'Selamawit',
      lastName: 'Tesfaye',
      firstNameAm: 'ሰላማዊት',
      lastNameAm: 'ተስፋዬ',
      sex: Sex.FEMALE,
      phone: '+251911445566',
      phoneNorm: '+251911445566',
      guardianName: 'Tesfaye Wolde',
      guardianPhone: '+251911889900',
      address: 'Bole Medhanialem, Addis Ababa',
    },
    {
      studentNo: 'ST-2017-002',
      firstName: 'Dawit',
      lastName: 'Alemayehu',
      firstNameAm: 'ዳዊት',
      lastNameAm: 'አለማየሁ',
      sex: Sex.MALE,
      phone: '+251922334455',
      phoneNorm: '+251922334455',
      address: 'Kazanchis, Addis Ababa',
    },
    {
      studentNo: 'ST-2017-003',
      firstName: 'Blen',
      lastName: 'Yohannes',
      firstNameAm: 'ብሌን',
      lastNameAm: 'ዮሐንስ',
      sex: Sex.FEMALE,
      phone: '+251933445566',
      phoneNorm: '+251933445566',
      address: 'Megenagna, Addis Ababa',
    },
  ];

  const studentRecords = [];
  for (const s of students) {
    const student = await prisma.student.create({
      data: {
        tenantId: tenant.id,
        ...s,
        status: StudentStatus.ACTIVE,
      },
    });
    studentRecords.push(student);
  }
  console.log(`✅ Created ${studentRecords.length} Students`);

  // 8. Enrolments
  const selamawit = studentRecords[0];
  const dawit = studentRecords[1];

  // Selamawit in Kirar batch
  await prisma.enrolment.create({
    data: {
      tenantId: tenant.id,
      studentId: selamawit.id,
      batchId: batchKirar.id,
      enrolledOn: new Date('2024-10-15'),
      status: EnrolmentStatus.ENROLLED,
      feeMinor: BigInt(600000), // 6,000 Br
      discountMinor: BigInt(0),
    },
  });

  // Dawit in English batch
  await prisma.enrolment.create({
    data: {
      tenantId: tenant.id,
      studentId: dawit.id,
      batchId: batchEnglish.id,
      enrolledOn: new Date('2024-10-01'),
      status: EnrolmentStatus.ENROLLED,
      feeMinor: BigInt(450000), // 4,500 Br
      discountMinor: BigInt(50000), // 500 Br discount
      discountReason: 'Early bird registration',
    },
  });

  // 9. Payments
  // Selamawit paid 3,000 Br partial instalment via Telebirr
  await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      studentId: selamawit.id,
      amountMinor: BigInt(300000),
      method: PayMethod.TELEBIRR,
      reference: 'TEL-2024-00124',
      paidOn: new Date('2024-10-18'),
      receivedById: userMap[Role.CASHIER],
      status: PaymentStatus.POSTED,
    },
  });

  // Dawit paid full 4,000 Br via CBE Birr
  await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      studentId: dawit.id,
      amountMinor: BigInt(400000),
      method: PayMethod.CBE_BIRR,
      reference: 'CBE-2024-88419',
      paidOn: new Date('2024-10-01'),
      receivedById: userMap[Role.CASHIER],
      status: PaymentStatus.POSTED,
    },
  });
  console.log('✅ Created Initial Enrolments and Payments');

  // 10. Sample Session & Attendance Record
  const session1 = await prisma.session.create({
    data: {
      tenantId: tenant.id,
      batchId: batchKirar.id,
      date: new Date('2024-10-18'),
      startTime: '16:00',
      endTime: '18:00',
      roomId: roomBole101.id,
      trainerId: trainer.id,
    },
  });

  await prisma.attendanceRecord.create({
    data: {
      tenantId: tenant.id,
      sessionId: session1.id,
      studentId: selamawit.id,
      status: AttendStatus.PRESENT,
      markedById: userMap[Role.TRAINER],
    },
  });
  console.log('✅ Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
