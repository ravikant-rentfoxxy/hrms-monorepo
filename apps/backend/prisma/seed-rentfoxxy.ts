/**
 * Fills the EXISTING Rentfoxxy company (created via the panel) with rich demo
 * data for showcasing. Existing users, memberships and passwords are kept —
 * their employee profiles are enriched and woven into the data.
 *
 * Re-runnable: wipes and re-seeds Rentfoxxy's tenant data (attendance, leaves,
 * payroll, …) each time. Run: npm run db:seed-rentfoxxy
 */
import { PrismaClient, type AttendanceStatus, type Prisma, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ensureBucket, objectKey, putObject } from '../src/lib/storage';

const prisma = new PrismaClient();

const TODAY = new Date();
const dateUTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const daysAgo = (n: number) =>
  new Date(Date.UTC(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - n));
const at = (day: Date, h: number, min: number) =>
  new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h - 5, min - 30)); // ~IST
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const json = (v: unknown) => v as Prisma.InputJsonValue;

const AVATARS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'];

interface NewPerson {
  email: string;
  name: string;
  code: string;
  designation: string;
  department: string;
  role: Role;
  managerEmail?: string;
  dob: Date;
  salary: number;
}

/** Added alongside the existing Rentfoxxy users. All passwords: Employee@123 */
const NEW_PEOPLE: NewPerson[] = [
  { email: 'ananya@rentfoxxy.com', name: 'Ananya Gupta', code: 'RF-003', designation: 'HR Manager', department: 'Human Resources', role: 'HR', managerEmail: 'ravikant@rentfoxxy.com', dob: dateUTC(1992, 8, 12), salary: 90000 },
  { email: 'vikram@rentfoxxy.com', name: 'Vikram Singh', code: 'RF-004', designation: 'Engineering Manager', department: 'Engineering', role: 'MANAGER', managerEmail: 'ravikant@rentfoxxy.com', dob: dateUTC(1990, 1, 30), salary: 140000 },
  { email: 'sneha@rentfoxxy.com', name: 'Sneha Iyer', code: 'RF-005', designation: 'UI/UX Designer', department: 'Design', role: 'EMPLOYEE', managerEmail: 'vikram@rentfoxxy.com', dob: dateUTC(1997, 10, 24), salary: 85000 },
  { email: 'arjun@rentfoxxy.com', name: 'Arjun Reddy', code: 'RF-006', designation: 'Backend Engineer', department: 'Engineering', role: 'EMPLOYEE', managerEmail: 'vikram@rentfoxxy.com', dob: dateUTC(1995, 9, 14), salary: 100000 },
  { email: 'kavya@rentfoxxy.com', name: 'Kavya Joshi', code: 'RF-007', designation: 'Finance Analyst', department: 'Finance', role: 'EMPLOYEE', managerEmail: 'ravikant@rentfoxxy.com', dob: dateUTC(1996, 2, 19), salary: 75000 },
  { email: 'rohan@rentfoxxy.com', name: 'Rohan Das', code: 'RF-008', designation: 'QA Engineer', department: 'Engineering', role: 'EMPLOYEE', managerEmail: 'vikram@rentfoxxy.com', dob: dateUTC(1998, 11, 9), salary: 70000 },
  { email: 'isha@rentfoxxy.com', name: 'Isha Patel', code: 'RF-009', designation: 'Product Manager', department: 'Product', role: 'EMPLOYEE', managerEmail: 'ravikant@rentfoxxy.com', dob: dateUTC(1993, 5, 27), salary: 120000 },
  { email: 'meera@rentfoxxy.com', name: 'Meera Nair', code: 'RF-010', designation: 'Sales Executive', department: 'Sales', role: 'EMPLOYEE', managerEmail: 'ravikant@rentfoxxy.com', dob: dateUTC(1999, 7, 7), salary: 60000 },
];

async function main(): Promise<void> {
  await ensureBucket();

  const company = await prisma.company.findFirst({
    where: { OR: [{ name: { contains: 'rentfoxxy', mode: 'insensitive' } }, { code: 'code01' }] },
    include: { leaveTypes: true },
  });
  if (!company) throw new Error('Rentfoxxy company not found — create it from the admin panel first.');

  // ---- Idempotent: wipe this tenant's transactional data (keep users/memberships) ----
  await prisma.$transaction([
    prisma.attendanceRecord.deleteMany({ where: { companyId: company.id } }),
    prisma.leaveRequest.deleteMany({ where: { companyId: company.id } }),
    prisma.payslip.deleteMany({ where: { companyId: company.id } }),
    prisma.holiday.deleteMany({ where: { companyId: company.id } }),
    prisma.announcement.deleteMany({ where: { companyId: company.id } }),
    prisma.expenseClaim.deleteMany({ where: { companyId: company.id } }),
    prisma.document.deleteMany({ where: { companyId: company.id } }),
    prisma.ticket.deleteMany({ where: { companyId: company.id } }),
  ]);

  // ---- Office (one per company) ----
  const hasOffice = await prisma.office.findFirst({ where: { companyId: company.id, isActive: true } });
  if (!hasOffice) {
    await prisma.office.create({
      data: {
        companyId: company.id,
        name: 'Rentfoxxy HQ — Gurugram',
        latitude: 28.419019,
        longitude: 77.037803,
        radiusMeters: 300,
      },
    });
  }

  // ---- Leave types (panel-created companies already have defaults; ensure anyway) ----
  if (company.leaveTypes.length === 0) {
    await prisma.leaveType.createMany({
      data: [
        { code: 'CL', name: 'Casual Leave', totalPerYear: 12, color: '#0EA5E9' },
        { code: 'SL', name: 'Sick Leave', totalPerYear: 10, color: '#F59E0B' },
        { code: 'EL', name: 'Earned Leave', totalPerYear: 15, color: '#16A34A' },
        { code: 'WFH', name: 'Work From Home', totalPerYear: 24, color: '#7C3AED' },
      ].map((t) => ({ ...t, companyId: company.id })),
    });
  }
  const leaveTypes = await prisma.leaveType.findMany({ where: { companyId: company.id, isActive: true } });
  const type = (code: string) => leaveTypes.find((t) => t.code === code) ?? leaveTypes[0]!;

  // ---- People: enrich the EXISTING members, then add the new ones ----
  const byEmail = new Map<string, { id: string; name: string; salary: number; managerEmail?: string }>();

  const existing = await prisma.employee.findMany({
    where: { companyId: company.id },
    include: { user: { select: { email: true, role: true } } },
  });
  for (const [i, emp] of existing.entries()) {
    const isAdmin = emp.user.role === 'ADMIN';
    const enriched = await prisma.employee.update({
      where: { id: emp.id },
      data: {
        designation: emp.designation || (isAdmin ? 'Founder & CEO' : 'Flutter Developer'),
        department: emp.department || (isAdmin ? 'Management' : 'Engineering'),
        phone: emp.phone || `+91 98${rand(100, 999)} ${rand(10000, 99999)}`,
        location: emp.location || 'Gurugram',
        dateOfBirth: emp.dateOfBirth ?? dateUTC(isAdmin ? 1988 : 1995, TODAY.getMonth() + 1, Math.min(TODAY.getDate() + 6 + i * 4, 28)),
        bloodGroup: emp.bloodGroup || pick(['O+', 'A+', 'B+']),
        address: emp.address || `${rand(1, 200)}, Sector ${rand(14, 56)}, Gurugram`,
        emergencyContact: emp.emergencyContact || `+91 ${rand(70000, 99999)} ${rand(10000, 99999)}`,
        bankName: emp.bankName || 'HDFC Bank',
        accountNumber: emp.accountNumber || String(rand(10000000, 99999999)) + String(rand(1000, 9999)),
        ifsc: emp.ifsc || `HDFC000${rand(1000, 9999)}`,
        pan: emp.pan || `ABCPK${rand(1000, 9999)}F`,
        avatarColor: AVATARS[i % AVATARS.length]!,
        isActive: true,
      },
    });
    byEmail.set(emp.user.email, { id: enriched.id, name: enriched.name, salary: isAdmin ? 200000 : 95000 });
  }
  const adminEmail = existing.find((e) => e.user.role === 'ADMIN')?.user.email ?? existing[0]!.user.email;

  const employeePw = await bcrypt.hash('Employee@123', 12);
  for (const [i, p] of NEW_PEOPLE.entries()) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      create: { email: p.email, passwordHash: employeePw, role: p.role },
      update: {},
    });
    await prisma.membership.upsert({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      create: { userId: user.id, companyId: company.id, role: p.role },
      update: { role: p.role, isActive: true },
    });
    const managerId = p.managerEmail ? byEmail.get(p.managerEmail)?.id : undefined;
    const employee = await prisma.employee.upsert({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      create: {
        companyId: company.id,
        userId: user.id,
        employeeCode: p.code,
        name: p.name,
        designation: p.designation,
        department: p.department,
        phone: `+91 98${rand(100, 999)} ${rand(10000, 99999)}`,
        location: 'Gurugram',
        joiningDate: daysAgo(rand(200, 1000)),
        dateOfBirth: p.dob,
        managerId,
        bloodGroup: pick(['O+', 'A+', 'B+', 'AB+']),
        address: `${rand(1, 200)}, Sector ${rand(14, 56)}, Gurugram`,
        emergencyContact: `+91 ${rand(70000, 99999)} ${rand(10000, 99999)}`,
        bankName: pick(['HDFC Bank', 'ICICI Bank', 'Axis Bank']),
        accountNumber: String(rand(10000000, 99999999)) + String(rand(1000, 9999)),
        ifsc: `HDFC000${rand(1000, 9999)}`,
        pan: `ABCPK${rand(1000, 9999)}F`,
        avatarColor: AVATARS[(i + 2) % AVATARS.length]!,
        salaryBasic: p.salary,
        salaryHra: Math.round(p.salary * 0.4),
        salaryAllowance: Math.round(p.salary * 0.25),
        salaryPfEmployer: Math.min(1800, Math.round(p.salary * 0.12)),
        salaryPfEmployee: Math.min(1800, Math.round(p.salary * 0.12)),
      },
      update: { managerId, isActive: true },
    });
    byEmail.set(p.email, { id: employee.id, name: employee.name, salary: p.salary, managerEmail: p.managerEmail });
  }

  const everyone = [...byEmail.entries()].map(([email, e]) => ({ email, ...e }));
  const admin = byEmail.get(adminEmail)!;
  const office = await prisma.office.findFirstOrThrow({ where: { companyId: company.id, isActive: true } });

  // ---- Holidays ----
  const Y = TODAY.getFullYear();
  await prisma.holiday.createMany({
    data: [
      { name: 'New Year', date: dateUTC(Y, 1, 1) },
      { name: 'Republic Day', date: dateUTC(Y, 1, 26) },
      { name: 'Holi', date: dateUTC(Y, 3, 4) },
      { name: 'Independence Day', date: dateUTC(Y, 8, 15) },
      { name: 'Gandhi Jayanti', date: dateUTC(Y, 10, 2) },
      { name: 'Diwali', date: dateUTC(Y, 11, 8) },
      { name: 'Bhai Dooj', date: dateUTC(Y, 11, 10), optional: true },
      { name: 'Christmas', date: dateUTC(Y, 12, 25) },
    ].map((h) => ({ ...h, companyId: company.id })),
  });

  // ---- Announcements (+ read receipts for the older ones) ----
  const announcements = [
    { title: 'Diwali celebration at Rentfoxxy 🎉', body: 'Join us on Nov 7 for the office Diwali party — ethnic wear encouraged! Rangoli competition, sweets and a surprise performance await.', category: 'Events', days: 1 },
    { title: 'Health insurance enrollment window open', body: 'The annual enrollment window for the group health insurance plan is open until the end of this month. Add dependents from the HR portal or raise a helpdesk ticket.', category: 'Benefits', days: 4 },
    { title: 'Quarterly town hall — Q3 results', body: 'The Q3 town hall is scheduled for next Friday at 4 PM. Highlights: new product launch, hiring plans and the updated hybrid-work policy. Submit questions in advance to HR.', category: 'General', days: 9 },
    { title: 'Updated leave policy effective this month', body: 'Earned leave carry-forward is now capped at 30 days, and WFH requests should be applied at least a day in advance. See the Leave Policy document for details.', category: 'Policy', days: 16 },
    { title: 'Welcome our new joiners!', body: 'A warm welcome to everyone who joined Rentfoxxy this quarter. Say hi when you spot a new face — and check the directory to find your onboarding buddy.', category: 'People', days: 24 },
  ];
  for (const a of announcements) {
    const row = await prisma.announcement.create({
      data: { companyId: company.id, title: a.title, body: a.body, category: a.category, authorId: admin.id, postedOn: daysAgo(a.days) },
    });
    if (a.days > 3) {
      await prisma.announcementRead.createMany({
        data: everyone.filter(() => Math.random() < 0.8).map((e) => ({ announcementId: row.id, employeeId: e.id })),
      });
    }
  }

  // ---- Attendance: last 30 weekdays. Admin + japhar left unpunched TODAY for live demos. ----
  const skipToday = new Set([admin.id, byEmail.get('japhar@rentfoxxy.com')?.id].filter(Boolean));
  const attendance: Prisma.AttendanceRecordCreateManyInput[] = [];
  for (const e of everyone) {
    for (let d = 30; d >= 0; d--) {
      const day = daysAgo(d);
      const weekday = day.getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      if (d === 0 && skipToday.has(e.id)) continue;
      const roll = Math.random();
      if (roll < 0.06) {
        attendance.push({ companyId: company.id, employeeId: e.id, date: day, status: 'ABSENT' as AttendanceStatus });
        continue;
      }
      if (roll < 0.12) {
        attendance.push({ companyId: company.id, employeeId: e.id, date: day, status: 'LEAVE' as AttendanceStatus, note: 'Approved leave' });
        continue;
      }
      const inMin = rand(0, 55);
      const checkIn = at(day, 9, inMin);
      const status: AttendanceStatus = inMin > 30 ? 'LATE' : 'PRESENT';
      const checkOut = d === 0 ? null : at(day, 17 + rand(0, 2), rand(0, 59));
      attendance.push({
        companyId: company.id,
        employeeId: e.id,
        date: day,
        status,
        checkIn,
        checkOut,
        checkInLat: office.latitude + (Math.random() - 0.5) * 0.002,
        checkInLng: office.longitude + (Math.random() - 0.5) * 0.002,
        checkInDistance: rand(15, 280),
        checkOutLat: checkOut ? office.latitude : null,
        checkOutLng: checkOut ? office.longitude : null,
        checkOutDistance: checkOut ? rand(15, 280) : null,
      });
    }
  }
  await prisma.attendanceRecord.createMany({ data: attendance });

  // ---- Leave requests (japhar gets a visible mix for the app demo) ----
  const leaveFixtures: { email: string; type: string; from: number; to: number; reason: string; status: 'APPROVED' | 'PENDING' | 'REJECTED' }[] = [
    { email: 'japhar@rentfoxxy.com', type: 'CL', from: 18, to: 17, reason: 'Family function in hometown', status: 'APPROVED' },
    { email: 'japhar@rentfoxxy.com', type: 'EL', from: -12, to: -14, reason: 'Diwali vacation with family', status: 'PENDING' },
    { email: 'japhar@rentfoxxy.com', type: 'SL', from: 30, to: 30, reason: 'Viral fever', status: 'APPROVED' },
    { email: 'sneha@rentfoxxy.com', type: 'WFH', from: -3, to: -3, reason: 'Internet installation at home', status: 'PENDING' },
    { email: 'arjun@rentfoxxy.com', type: 'CL', from: -6, to: -7, reason: 'Cousin’s wedding', status: 'PENDING' },
    { email: 'rohan@rentfoxxy.com', type: 'EL', from: 25, to: 22, reason: 'Trip to Kerala', status: 'APPROVED' },
    { email: 'meera@rentfoxxy.com', type: 'CL', from: 5, to: 5, reason: 'Personal errand', status: 'REJECTED' },
    { email: 'kavya@rentfoxxy.com', type: 'SL', from: 2, to: 2, reason: 'Migraine', status: 'APPROVED' },
  ];
  for (const f of leaveFixtures) {
    const who = byEmail.get(f.email);
    if (!who) continue;
    const fromDate = daysAgo(f.from);
    const toDate = daysAgo(f.to);
    let days = 0;
    for (let t = new Date(fromDate); t <= toDate; t.setUTCDate(t.getUTCDate() + 1)) {
      if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6) days++;
    }
    await prisma.leaveRequest.create({
      data: {
        companyId: company.id,
        employeeId: who.id,
        leaveTypeId: type(f.type).id,
        fromDate,
        toDate,
        days: Math.max(days, 1),
        reason: f.reason,
        status: f.status,
        appliedOn: daysAgo(Math.max(f.from + 3, 1)),
        approverId: f.status === 'PENDING' ? null : admin.id,
        remarks: f.status === 'REJECTED' ? 'Month-end push — please reschedule' : f.status === 'APPROVED' ? 'Approved' : null,
      },
    });
  }

  // ---- Payslips: last 3 full months for everyone ----
  const payslips: Prisma.PayslipCreateManyInput[] = [];
  for (const e of everyone) {
    for (let m = 1; m <= 3; m++) {
      const month = new Date(Date.UTC(TODAY.getFullYear(), TODAY.getMonth() - m, 1));
      const basic = e.salary;
      payslips.push({
        companyId: company.id,
        employeeId: e.id,
        month,
        earnings: json([
          { label: 'Basic', amount: basic },
          { label: 'HRA', amount: Math.round(basic * 0.4) },
          { label: 'Special Allowance', amount: Math.round(basic * 0.25) },
        ]),
        deductions: json([
          { label: 'Provident Fund', amount: 1800 },
          { label: 'Professional Tax', amount: 200 },
          { label: 'TDS', amount: Math.round(basic * 0.09) },
        ]),
        workingDays: 22,
        paidDays: 22 - rand(0, 2),
        paidOn: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)),
      });
    }
  }
  await prisma.payslip.createMany({ data: payslips });

  // ---- Expenses (some with real receipts in MinIO) ----
  const expenseFixtures: { email: string; category: string; description: string; amount: number; days: number; status: 'APPROVED' | 'PENDING' | 'REJECTED'; receipt?: boolean }[] = [
    { email: 'japhar@rentfoxxy.com', category: 'Travel', description: 'Cab to client office (Cyber City)', amount: 540, days: 6, status: 'APPROVED', receipt: true },
    { email: 'japhar@rentfoxxy.com', category: 'Meals', description: 'Team lunch after sprint demo', amount: 2350, days: 3, status: 'PENDING', receipt: true },
    { email: 'sneha@rentfoxxy.com', category: 'Software', description: 'Figma professional plan (monthly)', amount: 1250, days: 10, status: 'APPROVED' },
    { email: 'arjun@rentfoxxy.com', category: 'Hardware', description: 'USB-C hub for workstation', amount: 3200, days: 12, status: 'REJECTED' },
    { email: 'meera@rentfoxxy.com', category: 'Travel', description: 'Client visit — Jaipur (train + auto)', amount: 1860, days: 5, status: 'PENDING', receipt: true },
    { email: 'isha@rentfoxxy.com', category: 'Learning', description: 'Product management course', amount: 4100, days: 8, status: 'APPROVED' },
  ];
  for (const f of expenseFixtures) {
    const who = byEmail.get(f.email);
    if (!who) continue;
    let receiptKey: string | null = null;
    if (f.receipt) {
      receiptKey = objectKey(company.id, 'receipts', `receipt-${f.days}.pdf`);
      await putObject(
        receiptKey,
        Buffer.from(`RENTFOXXY — DEMO RECEIPT\n${f.description}\nAmount: INR ${f.amount}\nDate: ${daysAgo(f.days).toDateString()}`),
        'application/pdf'
      );
    }
    await prisma.expenseClaim.create({
      data: {
        companyId: company.id,
        employeeId: who.id,
        category: f.category,
        description: f.description,
        amount: f.amount,
        date: daysAgo(f.days),
        status: f.status,
        approverId: f.status === 'PENDING' ? null : admin.id,
        receiptKey,
        remarks: f.status === 'REJECTED' ? 'Please buy via the IT procurement portal' : null,
      },
    });
  }

  // ---- Documents (bytes in MinIO) ----
  const japhar = byEmail.get('japhar@rentfoxxy.com');
  const docs: { name: string; ownerId: string | null; content: string }[] = [
    { name: 'Employee Handbook 2026.pdf', ownerId: null, content: 'RENTFOXXY — EMPLOYEE HANDBOOK 2026\nCulture, conduct, benefits and everything in between.' },
    { name: 'Leave Policy 2026.pdf', ownerId: null, content: 'RENTFOXXY — LEAVE POLICY\nCL 12 / SL 10 / EL 15 / WFH 24 days per year.' },
    { name: 'Holiday Calendar 2026.pdf', ownerId: null, content: 'RENTFOXXY — HOLIDAY CALENDAR 2026' },
    ...(japhar
      ? [
          { name: 'Offer Letter.pdf', ownerId: japhar.id, content: `Offer letter for ${japhar.name} — Rentfoxxy private limited.` },
          { name: 'Form 16 FY 2025-26.pdf', ownerId: japhar.id, content: `Form 16 for ${japhar.name}, FY 2025-26.` },
        ]
      : []),
  ];
  for (const d of docs) {
    const key = objectKey(company.id, 'documents', d.name);
    const buffer = Buffer.from(d.content);
    await putObject(key, buffer, 'application/pdf');
    await prisma.document.create({
      data: {
        companyId: company.id, employeeId: d.ownerId, name: d.name, fileKey: key,
        mimeType: 'application/pdf', size: buffer.length, uploadedById: admin.id, uploadedOn: daysAgo(rand(3, 60)),
      },
    });
  }

  // ---- Helpdesk tickets ----
  const ticketFixtures: { email: string; subject: string; category: string; description: string; status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'; days: number }[] = [
    { email: 'japhar@rentfoxxy.com', subject: 'Laptop battery drains in 2 hours', category: 'IT', description: 'Battery backup dropped drastically after the last OS update. Need a checkup or replacement.', status: 'IN_PROGRESS', days: 4 },
    { email: 'sneha@rentfoxxy.com', subject: 'Access to design asset drive', category: 'IT', description: 'Requesting access to the shared design asset drive for the brand refresh project.', status: 'RESOLVED', days: 12 },
    { email: 'arjun@rentfoxxy.com', subject: 'ID card not working at gate 2', category: 'Facilities', description: 'My access card beeps red at gate 2 since Monday, works fine at the main gate.', status: 'OPEN', days: 1 },
    { email: 'meera@rentfoxxy.com', subject: 'Payslip component clarification', category: 'Payroll', description: 'Could someone explain the TDS calculation on my September payslip?', status: 'OPEN', days: 2 },
    { email: 'kavya@rentfoxxy.com', subject: 'Add spouse to insurance', category: 'HR', description: 'Recently married — need to add my spouse to the group health insurance policy.', status: 'IN_PROGRESS', days: 6 },
  ];
  for (const f of ticketFixtures) {
    const who = byEmail.get(f.email);
    if (!who) continue;
    await prisma.ticket.create({
      data: {
        companyId: company.id, employeeId: who.id, subject: f.subject, category: f.category,
        description: f.description, status: f.status, createdOn: daysAgo(f.days),
        resolvedAt: f.status === 'RESOLVED' ? daysAgo(Math.max(f.days - 2, 0)) : null,
      },
    });
  }

  /* eslint-disable no-console */
  console.log(`Seeded "${company.name}" with ${everyone.length} employees (your 2 existing users kept).`);
  console.log('Existing logins unchanged: ravikant@rentfoxxy.com (ADMIN), japhar@rentfoxxy.com (EMPLOYEE)');
  console.log('New employees all use password: Employee@123 (e.g. vikram@rentfoxxy.com — MANAGER)');
  console.log('Live-demo tip: ravikant and japhar have NO punch today, so check-in can be demoed live.');
  /* eslint-enable no-console */
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
