/**
 * Training / LMS: course catalog, bulk assignment (employees, departments,
 * everyone), self-paced progress, and HR's completion matrix + overdue list.
 * New joiners get mandatory courses automatically (daily job).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { dateOnlyUTC } from '../utils/geo';
import { type Actor, addDays, isHrAdmin } from './talent.helpers';
import { certifyCourseCompletion } from './career.service';
import { logger } from '../lib/logger';

export interface CourseInput {
  title: string;
  description?: string;
  category?: string;
  durationMinutes?: number;
  contentUrl?: string;
  mandatory?: boolean;
  dueDays?: number;
  isActive?: boolean;
}

/** Status shown to people: ASSIGNED / IN_PROGRESS / COMPLETED, or OVERDUE when past due and not completed. */
function displayStatus(e: { status: string; dueDate: Date | null }, today = dateOnlyUTC()): string {
  if (e.status !== 'COMPLETED' && e.dueDate && e.dueDate < today) return 'OVERDUE';
  return e.status;
}

async function getCourseOrThrow(companyId: string, id: string) {
  const course = await prisma.course.findFirst({ where: { id, companyId } });
  if (!course) throw ApiError.notFound('Course not found');
  return course;
}

// ---- Catalog ----

export async function listCourses(companyId: string, actor: Actor, filter: { category?: string; includeInactive?: string }) {
  const hr = isHrAdmin(actor.role);
  const courses = await prisma.course.findMany({
    where: {
      companyId,
      ...(filter.category ? { category: filter.category } : {}),
      ...(hr && filter.includeInactive === 'true' ? {} : { isActive: true }),
    },
    orderBy: [{ mandatory: 'desc' }, { title: 'asc' }],
  });
  if (!hr) {
    const mine = actor.employeeId
      ? await prisma.courseEnrollment.findMany({ where: { companyId, employeeId: actor.employeeId }, select: { courseId: true, status: true } })
      : [];
    const byCourse = new Map(mine.map((m) => [m.courseId, m.status]));
    return courses.map((c) => ({ ...c, myStatus: byCourse.get(c.id) ?? null }));
  }
  const counts = await prisma.courseEnrollment.groupBy({
    by: ['courseId', 'status'],
    where: { companyId, courseId: { in: courses.map((c) => c.id) } },
    _count: { _all: true },
  });
  return courses.map((c) => {
    const rows = counts.filter((r) => r.courseId === c.id);
    const enrolled = rows.reduce((s, r) => s + r._count._all, 0);
    const completed = rows.filter((r) => r.status === 'COMPLETED').reduce((s, r) => s + r._count._all, 0);
    return { ...c, enrolled, completed, completionRate: enrolled ? completed / enrolled : 0 };
  });
}

export async function createCourse(companyId: string, input: CourseInput) {
  return prisma.course.create({ data: { ...input, companyId } });
}

export async function updateCourse(companyId: string, id: string, input: Partial<CourseInput>) {
  const before = await getCourseOrThrow(companyId, id);
  const after = await prisma.course.update({ where: { id }, data: input });
  return { before, after };
}

/** Deletes a course nobody has started; otherwise it is retired (isActive=false) to keep completion history. */
export async function deleteCourse(companyId: string, id: string) {
  const course = await getCourseOrThrow(companyId, id);
  const started = await prisma.courseEnrollment.count({ where: { companyId, courseId: id, status: { not: 'ASSIGNED' } } });
  if (started > 0) {
    await prisma.course.update({ where: { id }, data: { isActive: false } });
    return { course, retired: true };
  }
  await prisma.course.delete({ where: { id } });
  return { course, retired: false };
}

// ---- Assignment ----

async function enroll(companyId: string, course: { id: string; title: string; dueDays: number }, employeeIds: string[], dueDate?: Date) {
  if (employeeIds.length === 0) return { assigned: 0, skipped: 0 };
  const existing = await prisma.courseEnrollment.findMany({
    where: { companyId, courseId: course.id, employeeId: { in: employeeIds } },
    select: { employeeId: true },
  });
  const have = new Set(existing.map((e) => e.employeeId));
  const fresh = employeeIds.filter((id) => !have.has(id));
  const due = dueDate ? dateOnlyUTC(dueDate) : addDays(new Date(), course.dueDays);
  if (fresh.length) {
    await prisma.courseEnrollment.createMany({
      data: fresh.map((employeeId) => ({ companyId, courseId: course.id, employeeId, dueDate: due })),
      skipDuplicates: true,
    });
    await notify(companyId, fresh, {
      event: 'training.assigned',
      title: 'New course assigned',
      body: `"${course.title}" has been assigned to you — due ${due.toISOString().slice(0, 10)}.`,
      link: '/training',
    });
  }
  return { assigned: fresh.length, skipped: employeeIds.length - fresh.length };
}

export async function assign(
  companyId: string,
  courseId: string,
  input: { employeeIds: string[]; departments: string[]; all: boolean; dueDate?: Date }
) {
  const course = await getCourseOrThrow(companyId, courseId);
  if (!course.isActive) throw ApiError.badRequest('This course is retired — reactivate it to assign');
  const or: Prisma.EmployeeWhereInput[] = [];
  if (input.employeeIds.length) or.push({ id: { in: input.employeeIds } });
  if (input.departments.length) or.push({ department: { in: input.departments } });
  const employees = await prisma.employee.findMany({
    where: { companyId, isActive: true, ...(input.all ? {} : { OR: or }) },
    select: { id: true },
  });
  if (!input.all && input.employeeIds.length) {
    const found = new Set(employees.map((e) => e.id));
    if (input.employeeIds.some((id) => !found.has(id))) throw ApiError.badRequest('One or more employees were not found in this company');
  }
  return enroll(companyId, course, employees.map((e) => e.id), input.dueDate);
}

/** Employees can sign up for any active course themselves. */
export async function selfEnroll(companyId: string, employeeId: string, courseId: string) {
  const course = await getCourseOrThrow(companyId, courseId);
  if (!course.isActive) throw ApiError.badRequest('This course is no longer offered');
  const existing = await prisma.courseEnrollment.findUnique({ where: { courseId_employeeId: { courseId, employeeId } } });
  if (existing) throw ApiError.conflict('You are already enrolled in this course');
  return prisma.courseEnrollment.create({
    data: { companyId, courseId, employeeId, dueDate: addDays(new Date(), course.dueDays) },
  });
}

export async function unassign(companyId: string, enrollmentId: string) {
  const enrollment = await prisma.courseEnrollment.findFirst({ where: { id: enrollmentId, companyId } });
  if (!enrollment) throw ApiError.notFound('Enrollment not found');
  if (enrollment.status === 'COMPLETED') throw ApiError.badRequest('A completed course stays on record');
  await prisma.courseEnrollment.delete({ where: { id: enrollmentId } });
  return enrollment;
}

// ---- Learner ----

export async function myCourses(companyId: string, employeeId: string) {
  const rows = await prisma.courseEnrollment.findMany({
    where: { companyId, employeeId },
    include: { course: true },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
  });
  const today = dateOnlyUTC();
  return rows.map((r) => ({ ...r, displayStatus: displayStatus(r, today) }));
}

async function myEnrollment(companyId: string, employeeId: string, id: string) {
  const enrollment = await prisma.courseEnrollment.findFirst({ where: { id, companyId }, include: { course: true } });
  if (!enrollment) throw ApiError.notFound('Enrollment not found');
  if (enrollment.employeeId !== employeeId) throw ApiError.forbidden('This is not your course');
  return enrollment;
}

export async function start(companyId: string, employeeId: string, id: string) {
  const enrollment = await myEnrollment(companyId, employeeId, id);
  if (enrollment.status !== 'ASSIGNED') return enrollment;
  return prisma.courseEnrollment.update({ where: { id }, data: { status: 'IN_PROGRESS' }, include: { course: true } });
}

export async function updateProgress(companyId: string, employeeId: string, id: string, progress: number) {
  const enrollment = await myEnrollment(companyId, employeeId, id);
  if (enrollment.status === 'COMPLETED') throw ApiError.badRequest('This course is already completed');
  if (progress >= 1) return complete(companyId, employeeId, id, undefined);
  return prisma.courseEnrollment.update({
    where: { id },
    data: { progress, status: 'IN_PROGRESS' },
    include: { course: true },
  });
}

export async function complete(companyId: string, employeeId: string, id: string, score: number | undefined) {
  const enrollment = await myEnrollment(companyId, employeeId, id);
  if (enrollment.status === 'COMPLETED') return enrollment;
  const updated = await prisma.courseEnrollment.update({
    where: { id },
    data: { status: 'COMPLETED', progress: 1, completedAt: new Date(), ...(score !== undefined ? { score } : {}) },
    include: { course: true },
  });
  // Completion goes on the employee's certifications (once per course); never fails the completion.
  await certifyCourseCompletion(companyId, employeeId, updated.course, updated.completedAt ?? new Date()).catch((err: unknown) =>
    logger.warn({ err, enrollmentId: id }, 'could not record course certification')
  );
  return updated;
}

// ---- HR reports ----

/** Employees × courses grid. Cells: status / progress / due, or null when not assigned. */
export async function matrix(companyId: string, filter: { department?: string; courseId?: string }) {
  const [courses, employees] = await Promise.all([
    prisma.course.findMany({
      where: { companyId, isActive: true, ...(filter.courseId ? { id: filter.courseId } : {}) },
      orderBy: [{ mandatory: 'desc' }, { title: 'asc' }],
      select: { id: true, title: true, category: true, mandatory: true },
    }),
    prisma.employee.findMany({
      where: { companyId, isActive: true, ...(filter.department ? { department: filter.department } : {}) },
      select: { id: true, name: true, employeeCode: true, department: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const enrollments = await prisma.courseEnrollment.findMany({
    where: { companyId, courseId: { in: courses.map((c) => c.id) }, employeeId: { in: employees.map((e) => e.id) } },
  });
  const today = dateOnlyUTC();
  const byKey = new Map(enrollments.map((e) => [`${e.employeeId}:${e.courseId}`, e]));
  const rows = employees.map((emp) => {
    const cells: Record<string, { enrollmentId: string; status: string; progress: number; dueDate: Date | null; completedAt: Date | null; score: number | null } | null> = {};
    let assigned = 0;
    let completed = 0;
    for (const c of courses) {
      const e = byKey.get(`${emp.id}:${c.id}`);
      if (e) {
        assigned++;
        if (e.status === 'COMPLETED') completed++;
      }
      cells[c.id] = e
        ? { enrollmentId: e.id, status: displayStatus(e, today), progress: e.progress, dueDate: e.dueDate, completedAt: e.completedAt, score: e.score }
        : null;
    }
    return { employee: emp, cells, assigned, completed };
  });
  const totalAssigned = rows.reduce((s, r) => s + r.assigned, 0);
  const totalCompleted = rows.reduce((s, r) => s + r.completed, 0);
  const overdue = enrollments.filter((e) => displayStatus(e, today) === 'OVERDUE').length;
  return {
    courses,
    rows,
    summary: { assigned: totalAssigned, completed: totalCompleted, overdue, completionRate: totalAssigned ? totalCompleted / totalAssigned : 0 },
  };
}

export async function overdue(companyId: string, filter: { department?: string; courseId?: string }) {
  const today = dateOnlyUTC();
  const rows = await prisma.courseEnrollment.findMany({
    where: {
      companyId,
      status: { not: 'COMPLETED' },
      dueDate: { lt: today },
      ...(filter.courseId ? { courseId: filter.courseId } : {}),
      employee: { isActive: true, ...(filter.department ? { department: filter.department } : {}) },
    },
    include: {
      course: { select: { id: true, title: true, mandatory: true } },
      employee: { select: { id: true, name: true, employeeCode: true, department: true, managerId: true } },
    },
    orderBy: { dueDate: 'asc' },
  });
  return rows.map((r) => ({ ...r, daysOverdue: Math.round((today.getTime() - (r.dueDate as Date).getTime()) / 86_400_000) }));
}

// ---- Jobs ----

/** Assigns every active mandatory course to employees who joined (or were added) in the last 2 days. Idempotent. */
export async function autoAssignNewJoiners(companyId: string): Promise<number> {
  const since = addDays(new Date(), -2);
  const [courses, joiners] = await Promise.all([
    prisma.course.findMany({ where: { companyId, isActive: true, mandatory: true } }),
    prisma.employee.findMany({
      where: { companyId, isActive: true, OR: [{ joiningDate: { gte: since } }, { createdAt: { gte: since } }] },
      select: { id: true },
    }),
  ]);
  let assigned = 0;
  for (const course of courses) {
    const result = await enroll(companyId, course, joiners.map((j) => j.id));
    assigned += result.assigned;
  }
  return assigned;
}

/** Reminds learners 3 days before the due date and on the first day overdue. */
export async function sendDueReminders(companyId: string): Promise<number> {
  const today = dateOnlyUTC();
  const soon = addDays(today, 3);
  const yesterday = addDays(today, -1);
  const rows = await prisma.courseEnrollment.findMany({
    where: { companyId, status: { not: 'COMPLETED' }, dueDate: { in: [soon, yesterday] }, employee: { isActive: true } },
    include: { course: { select: { title: true } }, employee: { select: { managerId: true } } },
  });
  for (const r of rows) {
    const isOverdue = (r.dueDate as Date).getTime() === yesterday.getTime();
    await notify(companyId, [r.employeeId, isOverdue ? r.employee.managerId : null], {
      event: isOverdue ? 'training.overdue' : 'training.due_soon',
      title: isOverdue ? 'Course overdue' : 'Course due soon',
      body: `"${r.course.title}" ${isOverdue ? 'is overdue' : `is due on ${(r.dueDate as Date).toISOString().slice(0, 10)}`}.`,
      link: '/training',
    });
  }
  return rows.length;
}
