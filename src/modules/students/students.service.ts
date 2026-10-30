import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { QueryStudentsDto } from './dto/query-students.dto';
import { normalizeEthiopianPhone } from '../../common/phone/phone';
import { toEthiopianDate } from '../../common/calendar/ethiopian-calendar';
import { StudentStatus, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';

@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Auto-generate sequential student number per tenant per Ethiopian year
   * e.g. ST-2017-001
   */
  private async generateStudentNo(tenantId: string): Promise<string> {
    const currentEcYear = toEthiopianDate(new Date()).year;
    const prefix = `ST-${currentEcYear}-`;

    const lastStudent = await this.prisma.student.findFirst({
      where: {
        tenantId,
        studentNo: { startsWith: prefix },
      },
      orderBy: { studentNo: 'desc' },
      select: { studentNo: true },
    });

    let seqNum = 1;
    if (lastStudent?.studentNo) {
      const parts = lastStudent.studentNo.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) {
        seqNum = lastSeq + 1;
      }
    }

    const seq = seqNum.toString().padStart(3, '0');
    return `${prefix}${seq}`;
  }

  /**
   * Create a new student with duplicate detection
   */
  async create(tenantId: string, dto: CreateStudentDto) {
    const phoneRes = normalizeEthiopianPhone(dto.phone);
    if (!phoneRes.isValid || !phoneRes.normalized) {
      throw new BadRequestException(phoneRes.error || 'Invalid phone number format');
    }

    // Check duplicate phone in the same academy tenant
    const duplicate = await this.prisma.student.findFirst({
      where: {
        tenantId,
        phoneNorm: phoneRes.normalized,
        deletedAt: null,
      },
    });

    if (duplicate) {
      throw new ConflictException(
        `A student with phone number ${phoneRes.normalized} is already registered (${duplicate.firstName} ${duplicate.lastName} - ${duplicate.studentNo}).`,
      );
    }

    const studentNo = await this.generateStudentNo(tenantId);

    const student = await this.prisma.student.create({
      data: {
        tenantId,
        studentNo,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        firstNameAm: dto.firstNameAm?.trim(),
        lastNameAm: dto.lastNameAm?.trim(),
        sex: dto.sex,
        dob: dto.dob ? new Date(dto.dob) : null,
        phone: dto.phone,
        phoneNorm: phoneRes.normalized,
        guardianName: dto.guardianName?.trim(),
        guardianPhone: dto.guardianPhone?.trim(),
        address: dto.address?.trim(),
        status: dto.status || StudentStatus.ACTIVE,
      },
    });

    // Optional direct enrolment into batch if provided
    if (dto.batchId) {
      const batch = await this.prisma.batch.findFirst({
        where: { id: dto.batchId, tenantId },
        include: { course: true },
      });

      if (batch) {
        await this.prisma.enrolment.create({
          data: {
            tenantId,
            studentId: student.id,
            batchId: batch.id,
            enrolledOn: new Date(),
            feeMinor: batch.course.defaultFeeMinor,
          },
        });
      }
    }

    return student;
  }

  /**
   * Search and filter students with pagination
   */
  async findAll(tenantId: string, query: QueryStudentsDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.StudentWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.batchId
        ? { enrolments: { some: { batchId: query.batchId } } }
        : {}),
    };

    if (query.search && query.search.trim()) {
      const q = query.search.trim();
      where.OR = [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { firstNameAm: { contains: q, mode: 'insensitive' } },
        { lastNameAm: { contains: q, mode: 'insensitive' } },
        { studentNo: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { phoneNorm: { contains: q } },
      ];
    }

    const [total, students] = await Promise.all([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          enrolments: {
            include: {
              batch: {
                include: { course: true },
              },
            },
          },
          payments: {
            select: { amountMinor: true, status: true },
          },
        },
      }),
    ]);

    // Format students with computed balance summary
    const items = students.map((s) => {
      const totalTuition = s.enrolments.reduce(
        (sum, e) => sum + (e.feeMinor - e.discountMinor),
        0n,
      );
      const totalPaid = s.payments
        .filter((p) => p.status === 'POSTED')
        .reduce((sum, p) => sum + p.amountMinor, 0n);
      const balanceMinor = totalTuition - totalPaid;

      return {
        id: s.id,
        studentNo: s.studentNo,
        firstName: s.firstName,
        lastName: s.lastName,
        firstNameAm: s.firstNameAm,
        lastNameAm: s.lastNameAm,
        phone: s.phone,
        phoneNorm: s.phoneNorm,
        status: s.status,
        enrolledBatches: s.enrolments.map((e) => ({
          enrolmentId: e.id,
          batchCode: e.batch.code,
          courseName: e.batch.course.name,
          courseNameAm: e.batch.course.nameAm,
        })),
        totalTuitionMinor: totalTuition.toString(),
        totalPaidMinor: totalPaid.toString(),
        balanceMinor: balanceMinor.toString(),
        createdAt: s.createdAt,
      };
    });

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get detailed student profile
   */
  async findOne(tenantId: string, id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        enrolments: {
          include: {
            batch: {
              include: {
                course: true,
                trainer: true,
                room: true,
              },
            },
          },
        },
        payments: {
          orderBy: { paidOn: 'desc' },
        },
        certificates: true,
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found in this academy');
    }

    // Compute balance
    const totalTuition = student.enrolments.reduce(
      (sum, e) => sum + (e.feeMinor - e.discountMinor),
      0n,
    );
    const totalPaid = student.payments
      .filter((p) => p.status === 'POSTED')
      .reduce((sum, p) => sum + p.amountMinor, 0n);

    return {
      ...student,
      totalTuitionMinor: totalTuition.toString(),
      totalPaidMinor: totalPaid.toString(),
      balanceMinor: (totalTuition - totalPaid).toString(),
    };
  }

  /**
   * Update student details
   */
  async update(tenantId: string, id: string, dto: UpdateStudentDto) {
    await this.findOne(tenantId, id);

    let phoneNorm: string | undefined;
    if (dto.phone) {
      const res = normalizeEthiopianPhone(dto.phone);
      if (!res.isValid || !res.normalized) {
        throw new BadRequestException(res.error || 'Invalid phone format');
      }
      phoneNorm = res.normalized;
    }

    return this.prisma.student.update({
      where: { id },
      data: {
        ...(dto.firstName ? { firstName: dto.firstName.trim() } : {}),
        ...(dto.lastName ? { lastName: dto.lastName.trim() } : {}),
        ...(dto.firstNameAm ? { firstNameAm: dto.firstNameAm.trim() } : {}),
        ...(dto.lastNameAm ? { lastNameAm: dto.lastNameAm.trim() } : {}),
        ...(dto.sex ? { sex: dto.sex } : {}),
        ...(dto.dob ? { dob: new Date(dto.dob) } : {}),
        ...(dto.phone ? { phone: dto.phone, phoneNorm } : {}),
        ...(dto.guardianName ? { guardianName: dto.guardianName.trim() } : {}),
        ...(dto.guardianPhone ? { guardianPhone: dto.guardianPhone.trim() } : {}),
        ...(dto.address ? { address: dto.address.trim() } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
    });
  }

  /**
   * Soft delete student
   */
  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.student.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Bulk import students from parsed rows or an Excel/CSV file buffer
   */
  async importStudents(
    tenantId: string,
    options: {
      fileBuffer?: Buffer;
      rawRows?: Record<string, any>[];
      commit?: boolean;
    },
  ) {
    let rows: Record<string, any>[] = [];

    if (options.fileBuffer) {
      const workbook = XLSX.read(options.fileBuffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new BadRequestException('Uploaded spreadsheet contains no sheets.');
      }
      const sheet = workbook.Sheets[firstSheetName];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    } else if (options.rawRows && Array.isArray(options.rawRows)) {
      rows = options.rawRows;
    } else {
      throw new BadRequestException('No file buffer or rows provided for import.');
    }

    if (rows.length === 0) {
      return {
        totalRows: 0,
        validCount: 0,
        errorCount: 0,
        importedCount: 0,
        errors: [],
        created: [],
      };
    }

    const errors: Array<{ rowNumber: number; data: any; reason: string }> = [];
    const validRows: Array<{
      rowNumber: number;
      firstName: string;
      lastName: string;
      firstNameAm?: string;
      lastNameAm?: string;
      phone: string;
      phoneNorm: string;
      guardianName?: string;
      guardianPhone?: string;
      address?: string;
    }> = [];

    const seenPhonesInBatch = new Set<string>();

    // 1. Validate each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // header is row 1, 1-indexed

      const firstName = (row['First Name'] || row['firstName'] || row['first_name'] || '').toString().trim();
      const lastName = (row['Last Name'] || row['lastName'] || row['last_name'] || '').toString().trim();
      const rawPhone = (row['Phone'] || row['phone'] || row['Mobile'] || '').toString().trim();
      const firstNameAm = (row['First Name (Amharic)'] || row['firstNameAm'] || '').toString().trim() || undefined;
      const lastNameAm = (row['Last Name (Amharic)'] || row['lastNameAm'] || '').toString().trim() || undefined;
      const guardianName = (row['Guardian Name'] || row['guardianName'] || '').toString().trim() || undefined;
      const guardianPhone = (row['Guardian Phone'] || row['guardianPhone'] || '').toString().trim() || undefined;
      const address = (row['Address'] || row['address'] || '').toString().trim() || undefined;

      if (!firstName || !lastName) {
        errors.push({
          rowNumber: rowNum,
          data: row,
          reason: 'Missing required field: First Name and Last Name are required.',
        });
        continue;
      }

      if (!rawPhone) {
        errors.push({
          rowNumber: rowNum,
          data: row,
          reason: 'Missing required field: Phone is required.',
        });
        continue;
      }

      const phoneRes = normalizeEthiopianPhone(rawPhone);
      if (!phoneRes.isValid || !phoneRes.normalized) {
        errors.push({
          rowNumber: rowNum,
          data: row,
          reason: `Invalid Ethiopian phone number '${rawPhone}': ${phoneRes.error || 'Must be Ethio Telecom or Safaricom prefix'}`,
        });
        continue;
      }

      if (seenPhonesInBatch.has(phoneRes.normalized)) {
        errors.push({
          rowNumber: rowNum,
          data: row,
          reason: `Duplicate phone number within file: ${phoneRes.normalized}`,
        });
        continue;
      }

      seenPhonesInBatch.add(phoneRes.normalized);

      validRows.push({
        rowNumber: rowNum,
        firstName,
        lastName,
        firstNameAm,
        lastNameAm,
        phone: rawPhone,
        phoneNorm: phoneRes.normalized,
        guardianName,
        guardianPhone,
        address,
      });
    }

    // 2. Check duplicates against existing database records
    const phoneNormsToCheck = validRows.map((r) => r.phoneNorm);
    const existingStudents = await this.prisma.student.findMany({
      where: {
        tenantId,
        phoneNorm: { in: phoneNormsToCheck },
        deletedAt: null,
      },
      select: { phoneNorm: true, firstName: true, lastName: true, studentNo: true },
    });

    const existingMap = new Map(existingStudents.map((s) => [s.phoneNorm, s]));
    const toCreate = validRows.filter((row) => {
      const match = existingMap.get(row.phoneNorm);
      if (match) {
        errors.push({
          rowNumber: row.rowNumber,
          data: row,
          reason: `Phone ${row.phoneNorm} is already registered to ${match.firstName} ${match.lastName} (${match.studentNo})`,
        });
        return false;
      }
      return true;
    });

    // 3. If commit requested, insert records
    const created: any[] = [];
    if (options.commit && toCreate.length > 0) {
      const currentEcYear = toEthiopianDate(new Date()).year;
      const prefix = `ST-${currentEcYear}-`;

      const lastStudent = await this.prisma.student.findFirst({
        where: {
          tenantId,
          studentNo: { startsWith: prefix },
        },
        orderBy: { studentNo: 'desc' },
        select: { studentNo: true },
      });

      let seqNum = 0;
      if (lastStudent?.studentNo) {
        const parts = lastStudent.studentNo.split('-');
        const lastSeq = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastSeq)) {
          seqNum = lastSeq;
        }
      }

      for (const row of toCreate) {
        seqNum++;
        const studentNo = `${prefix}${seqNum.toString().padStart(3, '0')}`;
        const newStudent = await this.prisma.student.create({
          data: {
            tenantId,
            studentNo,
            firstName: row.firstName,
            lastName: row.lastName,
            firstNameAm: row.firstNameAm,
            lastNameAm: row.lastNameAm,
            phone: row.phone,
            phoneNorm: row.phoneNorm,
            guardianName: row.guardianName,
            guardianPhone: row.guardianPhone,
            address: row.address,
            status: StudentStatus.ACTIVE,
          },
        });
        created.push(newStudent);
      }
    }

    return {
      totalRows: rows.length,
      validCount: toCreate.length,
      errorCount: errors.length,
      importedCount: created.length,
      committed: !!options.commit,
      preview: toCreate.slice(0, 50),
      errors,
      created,
    };
  }
}
