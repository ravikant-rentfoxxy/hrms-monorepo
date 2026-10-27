/**
 * Demo data seeder — fills the database with realistic data for showcasing
 * the admin panel (two companies, employees, 30 days of attendance, leaves,
 * payslips, expenses with receipts, documents,
 * tickets, announcements and holidays).
 *
 * Re-runnable: it deletes and recreates the demo companies each time.
 * Run: npm run db:seed-demo
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
  new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h - 5, min - 30)); // ~IST times stored in UTC
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

interface Person {
  email: string;
  name: string;
  code: string;
  designation: string;
  department: string;
  role: Role;
  managerCode?: string;
  dob: Date;
  phone: string;
  location: string;
  salary: number; // monthly basic
}

const ACME_PEOPLE: Person[] = [
  { email: 'admin@acme.test', name: 'Alice Admin', code: 'ACME-001', designation: 'HR Director', department: 'Management', role: 'ADMIN', dob: dateUTC(1988, 3, 14), phone: '+91 98450 10001', location: 'Bengaluru', salary: 160000 },
  { email: 'rahul@acme.test', name: 'Rahul Mehta', code: 'ACME-002', designation: 'Engineering Manager', department: 'Engineering', role: 'MANAGER', dob: dateUTC(1990, 10, 22), phone: '+91 98450 10002', location: 'Bengaluru', salary: 140000 },
  { email: 'priya@acme.test', name: 'Priya Sharma', code: 'ACME-003', designation: 'HR Executive', department: 'Management', role: 'HR', managerCode: 'ACME-001', dob: dateUTC(1995, 11, 2), phone: '+91 98450 10003', location: 'Bengaluru', salary: 70000 },
  { email: 'bob@acme.test', name: 'Bob Builder', code: 'ACME-004', designation: 'Senior Engineer', department: 'Engineering', role: 'EMPLOYEE', managerCode: 'ACME-002', dob: dateUTC(1994, 10, 25), phone: '+91 98450 10004', location: 'Bengaluru', salary: 110000 },
  { email: 'carol@acme.test', name: 'Carol Carter', code: 'ACME-005', designation: 'Product Designer', department: 'Design', role: 'EMPLOYEE', managerCode: 'ACME-002', dob: dateUTC(1996, 6, 18), phone: '+91 98450 10005', location: 'Bengaluru', salary: 95000 },
  { email: 'dev@acme.test', name: 'Dev Patel', code: 'ACME-006', designation: 'Frontend Engineer', department: 'Engineering', role: 'EMPLOYEE', managerCode: 'ACME-002', dob: dateUTC(1998, 1, 9), phone: '+91 98450 10006', location: 'Bengaluru', salary: 85000 },
  { email: 'esha@acme.test', name: 'Esha Nair', code: 'ACME-007', designation: 'QA Engineer', department: 'Engineering', role: 'EMPLOYEE', managerCode: 'ACME-002', dob: dateUTC(1997, 4, 30), phone: '+91 98450 10007', location: 'Bengaluru', salary: 80000 },
  { email: 'farhan@acme.test', name: 'Farhan Khan', code: 'ACME-008', designation: 'Sales Manager', department: 'Sales', role: 'MANAGER', dob: dateUTC(1989, 12, 12), phone: '+91 98450 10008', location: 'Mumbai', salary: 120000 },
  { email: 'gita@acme.test', name: 'Gita Rao', code: 'ACME-009', designation: 'Sales Executive', department: 'Sales', role: 'EMPLOYEE', managerCode: 'ACME-008', dob: dateUTC(1999, 7, 7), phone: '+91 98450 10009', location: 'Mumbai', salary: 60000 },
  { email: 'harsh@acme.test', name: 'Harsh Verma', code: 'ACME-010', designation: 'Accountant', department: 'Finance', role: 'EMPLOYEE', managerCode: 'ACME-001', dob: dateUTC(1993, 2, 27), phone: '+91 98450 10010', location: 'Bengaluru', salary: 75000 },
];

const GLOBEX_PEOPLE: Person[] = [
  { email: 'gina@globex.test', name: 'Gina Gomez', code: 'GLX-001', designation: 'Operations Head', department: 'Management', role: 'ADMIN', dob: dateUTC(1987, 9, 19), phone: '+91 98220 20001', location: 'Mumbai', salary: 150000 },
  { email: 'ivan@globex.test', name: 'Ivan Dsouza', code: 'GLX-002', designation: 'Support Engineer', department: 'Support', role: 'EMPLOYEE', managerCode: 'GLX-001', dob: dateUTC(1996, 10, 28), phone: '+91 98220 20002', location: 'Mumbai', salary: 65000 },
  { email: 'jaya@globex.test', name: 'Jaya Iyer', code: 'GLX-003', designation: 'Analyst', department: 'Finance', role: 'EMPLOYEE', managerCode: 'GLX-001', dob: dateUTC(1998, 12, 5), phone: '+91 98220 20003', location: 'Mumbai', salary: 70000 },
];

const AVATARS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6'];
const LEAVE_TYPES = [
  { code: 'CL', name: 'Casual Leave', totalPerYear: 12, color: '#0EA5E9' },
  { code: 'SL', name: 'Sick Leave', totalPerYear: 10, color: '#F59E0B' },
  { code: 'EL', name: 'Earned Leave', totalPerYear: 15, color: '#16A34A' },
  { code: 'WFH', name: 'Work From Home', totalPerYear: 24, color: '#7C3AED' },
];
const json = (v: unknown) => v as Prisma.InputJsonValue;

async function seedCompany(opts: {
  name: string;
  code: string;
  email: string;
  office: { name: string; latitude: number; longitude: number };
  people: Person[];
  rich: boolean; // full fixtures (attendance history, payroll, etc.)
}) {
  const company = await prisma.company.create({
    data: {
      name: opts.name,
      code: opts.code,
      email: opts.email,
      address: `${opts.office.name}, India`,
      leaveTypes: { create: LEAVE_TYPES },
      offices: { create: { ...opts.office, radiusMeters: 300 } },
    },
    include: { leaveTypes: true },
  });

  const employeePw = await bcrypt.hash('Employee@123', 12);
  const adminPw = await bcrypt.hash('Admin@12345', 12);

  // People: user (upsert by email) + membership + employee profile.
  const byCode = new Map<string, { id: string; userId: string; name: string }>();
  for (const [i, p] of opts.people.entries()) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      create: { email: p.email, passwordHash: p.role === 'ADMIN' ? adminPw : employeePw, role: p.role },
      update: { passwordHash: p.role === 'ADMIN' ? adminPw : employeePw, isActive: true },
    });
    await prisma.membership.upsert({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      create: { userId: user.id, companyId: company.id, role: p.role },
      update: { role: p.role, isActive: true },
    });
    const employee = await prisma.employee.create({
      data: {
        companyId: company.id,
        userId: user.id,
        employeeCode: p.code,
        name: p.name,
        designation: p.designation,
        department: p.department,
        phone: p.phone,
        location: p.location,
        joiningDate: daysAgo(rand(200, 1200)),
        dateOfBirth: p.dob,
        managerId: p.managerCode ? byCode.get(p.managerCode)?.id : undefined,
        bloodGroup: pick(['O+', 'A+', 'B+', 'AB+', 'O-']),
        address: `${rand(1, 200)}, ${pick(['MG Road', 'Residency Road', 'Koramangala', 'Indiranagar', 'Bandra West'])}, ${p.location}`,
        emergencyContact: `+91 ${rand(70000, 99999)} ${rand(10000, 99999)}`,
        bankName: pick(['HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank']),
        accountNumber: String(rand(10000000, 99999999)) + String(rand(1000, 9999)),
        ifsc: `${pick(['HDFC', 'ICIC', 'SBIN', 'UTIB'])}000${rand(1000, 9999)}`,
        pan: `${pick(['AB', 'CD', 'EF'])}CPK${rand(1000, 9999)}${pick(['A', 'B', 'F'])}`,
        avatarColor: AVATARS[i % AVATARS.length]!,
        salaryBasic: p.salary,
        salaryHra: Math.round(p.salary * 0.4),
        salaryAllowance: Math.round(p.salary * 0.25),
        salaryPfEmployer: Math.min(1800, Math.round(p.salary * 0.12)),
        salaryPfEmployee: Math.min(1800, Math.round(p.salary * 0.12)),
      },
    });
    byCode.set(p.code, { id: employee.id, userId: user.id, name: p.name });
  }
  const all = [...byCode.values()];
  const emp = (code: string) => byCode.get(code)!;

  // ---- Holidays (current year) ----
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
    ].map((holiday) => ({ ...holiday, companyId: company.id })),
  });

  // ---- Announcements (+ read receipts for the older ones) ----
  const announcements = [
    { title: `Diwali celebration at ${opts.name} 🎉`, body: 'Join us on Nov 7 for the office Diwali party — ethnic wear encouraged! Families are welcome from 5 PM. Snacks, rangoli competition and a surprise performance await.', category: 'Events', days: 1 },
    { title: 'Health insurance enrollment window open', body: 'The annual enrollment window for the group health insurance plan is open until the end of this month. Add dependents from the HR portal or raise a helpdesk ticket.', category: 'Benefits', days: 4 },
    { title: 'Quarterly town hall — Q3 results', body: 'The Q3 town hall is scheduled for next Friday at 4 PM in the cafeteria and on the usual video link. Submit your questions in advance to HR.', category: 'General', days: 9 },
    { title: 'Updated leave policy effective this month', body: 'Earned leave carry-forward is now capped at 30 days, and WFH requests should be applied at least a day in advance. See the Leave Policy document for details.', category: 'Policy', days: 16 },
    { title: `Welcome our new joiners!`, body: 'A warm welcome to everyone who joined us this quarter. Say hi when you spot a new face — and check the directory to find your onboarding buddy.', category: 'People', days: 24 },
  ];
  for (const a of announcements) {
    const row = await prisma.announcement.create({
      data: { companyId: company.id, title: a.title, body: a.body, category: a.category, authorId: all[0]!.id, postedOn: daysAgo(a.days) },
    });
    if (a.days > 3) {
      await prisma.announcementRead.createMany({
        data: all.filter(() => Math.random() < 0.8).map((e) => ({ announcementId: row.id, employeeId: e.id })),
      });
    }
  }

  if (!opts.rich) return company;

  // ---- Attendance: last 30 days of weekdays (today included, except the admin) ----
  const attendance: Prisma.AttendanceRecordCreateManyInput[] = [];
  for (const person of opts.people) {
    const e = emp(person.code);
    for (let d = 30; d >= 0; d--) {
      const day = daysAgo(d);
      const weekday = day.getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      if (d === 0 && person.role === 'ADMIN') continue; // let the demo driver punch in live
      const roll = Math.random();
      if (roll < 0.06) {
        attendance.push({ companyId: company.id, employeeId: e.id, date: day, status: 'ABSENT' as AttendanceStatus });
        continue;
      }
      if (roll < 0.12) {
        attendance.push({ companyId: company.id, employeeId: e.id, date: day, status: 'LEAVE' as AttendanceStatus, note: 'Approved leave' });
        continue;
      }
      const inMin = rand(0, 55); // 9:00 + 0..55 min
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
        checkInLat: opts.office.latitude + (Math.random() - 0.5) * 0.002,
        checkInLng: opts.office.longitude + (Math.random() - 0.5) * 0.002,
        checkInDistance: rand(15, 280),
        checkOutLat: checkOut ? opts.office.latitude : null,
        checkOutLng: checkOut ? opts.office.longitude : null,
        checkOutDistance: checkOut ? rand(15, 280) : null,
      });
    }
  }
  await prisma.attendanceRecord.createMany({ data: attendance });

  // ---- Leave requests ----
  const type = (code: string) => company.leaveTypes.find((t) => t.code === code)!;
  const leaveFixtures: { code: string; type: string; from: number; to: number; reason: string; status: 'APPROVED' | 'PENDING' | 'REJECTED'; approver?: string }[] = [
    { code: 'ACME-004', type: 'CL', from: 18, to: 17, reason: 'Family function in hometown', status: 'APPROVED', approver: 'ACME-002' },
    { code: 'ACME-004', type: 'EL', from: -12, to: -14, reason: 'Diwali vacation with family', status: 'PENDING' },
    { code: 'ACME-005', type: 'SL', from: 9, to: 9, reason: 'Fever and cold', status: 'APPROVED', approver: 'ACME-002' },
    { code: 'ACME-005', type: 'WFH', from: -3, to: -3, reason: 'Internet installation at home', status: 'PENDING' },
    { code: 'ACME-006', type: 'CL', from: -6, to: -7, reason: 'Cousin’s wedding', status: 'PENDING' },
    { code: 'ACME-007', type: 'EL', from: 25, to: 22, reason: 'Trip to Kerala', status: 'APPROVED', approver: 'ACME-002' },
    { code: 'ACME-009', type: 'CL', from: 5, to: 5, reason: 'Personal errand', status: 'REJECTED', approver: 'ACME-008' },
    { code: 'ACME-010', type: 'SL', from: 2, to: 2, reason: 'Migraine', status: 'APPROVED', approver: 'ACME-001' },
  ];
  for (const f of leaveFixtures) {
    const who = byCode.get(f.code);
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
        approverId: f.approver ? emp(f.approver).id : null,
        remarks: f.status === 'REJECTED' ? 'Month-end sales push — please reschedule' : f.status === 'APPROVED' ? 'Approved' : null,
      },
    });
  }

  // ---- Payslips: last 3 full months ----
  const payslips: Prisma.PayslipCreateManyInput[] = [];
  for (const person of opts.people) {
    const e = emp(person.code);
    for (let m = 1; m <= 3; m++) {
      const month = new Date(Date.UTC(TODAY.getFullYear(), TODAY.getMonth() - m, 1));
      const basic = person.salary;
      const hra = Math.round(basic * 0.4);
      const special = Math.round(basic * 0.25);
      const pf = 1800;
      const profTax = 200;
      const tds = Math.round(basic * 0.09);
      payslips.push({
        companyId: company.id,
        employeeId: e.id,
        month,
        earnings: json([
          { label: 'Basic', amount: basic },
          { label: 'HRA', amount: hra },
          { label: 'Special Allowance', amount: special },
        ]),
        deductions: json([
          { label: 'Provident Fund', amount: pf },
          { label: 'Professional Tax', amount: profTax },
          { label: 'TDS', amount: tds },
        ]),
        workingDays: 22,
        paidDays: 22 - rand(0, 2),
        paidOn: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)),
      });
    }
  }
  await prisma.payslip.createMany({ data: payslips });

  // ---- Expenses (a couple with real receipts in MinIO) ----
  const expenseFixtures: { code: string; category: string; description: string; amount: number; days: number; status: 'APPROVED' | 'PENDING' | 'REJECTED'; approver?: string; receipt?: boolean }[] = [
    { code: 'ACME-004', category: 'Travel', description: 'Cab to client office (Whitefield)', amount: 540, days: 6, status: 'APPROVED', approver: 'ACME-002', receipt: true },
    { code: 'ACME-004', category: 'Meals', description: 'Team lunch after sprint demo', amount: 2350, days: 3, status: 'PENDING', receipt: true },
    { code: 'ACME-005', category: 'Software', description: 'Figma professional plan (monthly)', amount: 1250, days: 10, status: 'APPROVED', approver: 'ACME-002' },
    { code: 'ACME-006', category: 'Hardware', description: 'USB-C hub for workstation', amount: 3200, days: 12, status: 'REJECTED', approver: 'ACME-002' },
    { code: 'ACME-009', category: 'Travel', description: 'Client visit — Pune (train + auto)', amount: 1860, days: 5, status: 'PENDING', receipt: true },
    { code: 'ACME-008', category: 'Entertainment', description: 'Prospect dinner meeting', amount: 4100, days: 8, status: 'APPROVED', approver: 'ACME-001' },
  ];
  for (const f of expenseFixtures) {
    const who = byCode.get(f.code);
    if (!who) continue;
    let receiptKey: string | null = null;
    if (f.receipt) {
      receiptKey = objectKey(company.id, 'receipts', `receipt-${f.code}-${f.days}.pdf`);
      await putObject(
        receiptKey,
        Buffer.from(`DEMO RECEIPT\n${f.description}\nAmount: INR ${f.amount}\nDate: ${daysAgo(f.days).toDateString()}`),
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
        approverId: f.approver ? emp(f.approver).id : null,
        receiptKey,
        remarks: f.status === 'REJECTED' ? 'Please buy via the IT procurement portal' : null,
      },
    });
  }

  // ---- Documents (bytes in MinIO) ----
  const docs: { name: string; owner: string | null; by: string; content: string }[] = [
    { name: 'Employee Handbook 2026.pdf', owner: null, by: 'ACME-001', content: 'ACME CORP — EMPLOYEE HANDBOOK 2026\nCulture, conduct, benefits and everything in between.' },
    { name: 'Leave Policy 2026.pdf', owner: null, by: 'ACME-001', content: 'ACME CORP — LEAVE POLICY\nCL 12 / SL 10 / EL 15 / WFH 24 days per year.' },
    { name: 'Holiday Calendar 2026.pdf', owner: null, by: 'ACME-003', content: 'ACME CORP — HOLIDAY CALENDAR 2026' },
    { name: 'Offer Letter - Bob Builder.pdf', owner: 'ACME-004', by: 'ACME-001', content: 'Offer letter for Bob Builder — Senior Engineer.' },
    { name: 'Offer Letter - Carol Carter.pdf', owner: 'ACME-005', by: 'ACME-001', content: 'Offer letter for Carol Carter — Product Designer.' },
    { name: 'Form 16 FY 2025-26 - Bob.pdf', owner: 'ACME-004', by: 'ACME-010', content: 'Form 16 for Bob Builder, FY 2025-26.' },
  ];
  for (const d of docs) {
    const by = byCode.get(d.by);
    const owner = d.owner ? byCode.get(d.owner) : null;
    if (!by || (d.owner && !owner)) continue;
    const key = objectKey(company.id, 'documents', d.name);
    const buffer = Buffer.from(d.content);
    await putObject(key, buffer, 'application/pdf');
    await prisma.document.create({
      data: {
        companyId: company.id,
        employeeId: owner?.id ?? null,
        name: d.name,
        fileKey: key,
        mimeType: 'application/pdf',
        size: buffer.length,
        uploadedById: by.id,
        uploadedOn: daysAgo(rand(3, 60)),
      },
    });
  }

  // ---- Helpdesk tickets ----
  const ticketFixtures: { code: string; subject: string; category: string; description: string; status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'; days: number }[] = [
    { code: 'ACME-004', subject: 'Laptop battery drains in 2 hours', category: 'IT', description: 'MacBook battery backup has dropped drastically after the last OS update. Need a checkup or replacement.', status: 'IN_PROGRESS', days: 4 },
    { code: 'ACME-005', subject: 'Access to design asset drive', category: 'IT', description: 'Requesting access to the shared design asset drive for the brand refresh project.', status: 'RESOLVED', days: 12 },
    { code: 'ACME-006', subject: 'ID card not working at gate 2', category: 'Facilities', description: 'My access card beeps red at gate 2 since Monday, works fine at the main gate.', status: 'OPEN', days: 1 },
    { code: 'ACME-009', subject: 'Payslip component clarification', category: 'Payroll', description: 'Could someone explain the TDS calculation on my September payslip?', status: 'OPEN', days: 2 },
    { code: 'ACME-007', subject: 'Standing desk request', category: 'Facilities', description: 'Requesting a height-adjustable desk due to a back condition (doctor’s note attached with HR).', status: 'RESOLVED', days: 20 },
    { code: 'ACME-010', subject: 'Add spouse to insurance', category: 'HR', description: 'Recently married — need to add my spouse to the group health insurance policy.', status: 'IN_PROGRESS', days: 6 },
  ];
  for (const f of ticketFixtures) {
    const who = byCode.get(f.code);
    if (!who) continue;
    await prisma.ticket.create({
      data: {
        companyId: company.id,
        employeeId: who.id,
        subject: f.subject,
        category: f.category,
        description: f.description,
        status: f.status,
        createdOn: daysAgo(f.days),
        resolvedAt: f.status === 'RESOLVED' || f.status === 'CLOSED' ? daysAgo(Math.max(f.days - 2, 0)) : null,
      },
    });
  }

  return company;
}

async function main(): Promise<void> {
  await ensureBucket();

  // Re-runnable: drop and recreate the demo tenants (cascades all their data).
  await prisma.company.deleteMany({ where: { code: { in: ['acme', 'globex'] } } });

  const acme = await seedCompany({
    name: 'Acme Corp',
    code: 'acme',
    email: 'hq@acme.test',
    office: { name: 'Acme HQ — Bengaluru', latitude: 12.9716, longitude: 77.5946 },
    people: ACME_PEOPLE,
    rich: true,
  });

  const globex = await seedCompany({
    name: 'Globex Industries',
    code: 'globex',
    email: 'ops@globex.test',
    office: { name: 'Globex House — Mumbai', latitude: 19.076, longitude: 72.8777 },
    people: GLOBEX_PEOPLE,
    rich: false,
  });

  const counts = await prisma.$transaction([
    prisma.employee.count({ where: { companyId: acme.id } }),
    prisma.attendanceRecord.count({ where: { companyId: acme.id } }),
    prisma.leaveRequest.count(),
    prisma.payslip.count(),
    prisma.expenseClaim.count(),
    prisma.document.count(),
    prisma.ticket.count(),
    prisma.announcement.count(),
  ]);
  /* eslint-disable no-console */
  console.log(`Seeded: ${acme.name} + ${globex.name}`);
  console.log(
    `employees=${counts[0]} attendance=${counts[1]} leaves=${counts[2]} payslips=${counts[3]} expenses=${counts[4]} documents=${counts[5]} tickets=${counts[6]} announcements=${counts[7]}`
  );
  console.log('\nDemo logins:');
  console.log('  Super admin : superadmin@hrms.local / SuperAdmin@123');
  console.log('  Employer    : admin@acme.test       / Admin@12345');
  console.log('  Manager     : rahul@acme.test       / Employee@123');
  console.log('  Employee    : bob@acme.test         / Employee@123');
  console.log('  Globex admin: gina@globex.test      / Admin@12345');
  /* eslint-enable no-console */
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
