import type { Request } from 'express';
import { h, ok } from '../utils/http';
import { ctx, employeeIdOrThrow } from '../middleware/auth';
import { audit, diff } from '../lib/audit';
import { sendCsv, toCsv } from '../utils/csv';
import * as trainingService from '../services/training.service';
import type { CourseInput } from '../services/training.service';

const id = (req: Request): string => req.params.id as string;

// ---- Catalog ----

export const listCourses = h(async (req, res) => {
  const { auth, tenantId } = ctx(req);
  ok(
    res,
    await trainingService.listCourses(tenantId, { role: auth.role, employeeId: auth.employeeId }, req.query as {
      category?: string;
      includeInactive?: string;
    })
  );
});

export const createCourse = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const course = await trainingService.createCourse(tenantId, req.body as CourseInput);
  await audit(req, { entity: 'Course', entityId: course.id, action: 'CREATE', after: course });
  ok(res, course, 201);
});

export const updateCourse = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { before, after } = await trainingService.updateCourse(tenantId, id(req), req.body as Partial<CourseInput>);
  await audit(req, { entity: 'Course', entityId: after.id, action: 'UPDATE', ...diff(before, after) });
  ok(res, after);
});

export const deleteCourse = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const { course, retired } = await trainingService.deleteCourse(tenantId, id(req));
  await audit(req, { entity: 'Course', entityId: course.id, action: retired ? 'RETIRE' : 'DELETE', before: course });
  ok(res, { deleted: !retired, retired });
});

export const assign = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const body = req.body as { employeeIds: string[]; departments: string[]; all: boolean; dueDate?: Date };
  const result = await trainingService.assign(tenantId, id(req), body);
  await audit(req, {
    entity: 'Course',
    entityId: id(req),
    action: 'ASSIGN',
    after: { ...result, all: body.all, departments: body.departments, employees: body.employeeIds.length },
  });
  ok(res, result);
});

export const selfEnroll = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await trainingService.selfEnroll(tenantId, employeeIdOrThrow(req), id(req)), 201);
});

export const unassign = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const enrollment = await trainingService.unassign(tenantId, id(req));
  await audit(req, { entity: 'CourseEnrollment', entityId: enrollment.id, action: 'DELETE', before: enrollment });
  ok(res, { deleted: true });
});

// ---- Learner ----

export const myCourses = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await trainingService.myCourses(tenantId, employeeIdOrThrow(req)));
});

export const start = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await trainingService.start(tenantId, employeeIdOrThrow(req), id(req)));
});

export const progress = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await trainingService.updateProgress(tenantId, employeeIdOrThrow(req), id(req), (req.body as { progress: number }).progress));
});

export const complete = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await trainingService.complete(tenantId, employeeIdOrThrow(req), id(req), (req.body as { score?: number }).score));
});

// ---- HR reports ----

type ReportFilter = { department?: string; courseId?: string };

export const matrix = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await trainingService.matrix(tenantId, req.query as ReportFilter));
});

export const matrixCsv = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const data = await trainingService.matrix(tenantId, req.query as ReportFilter);
  const csv = toCsv(
    ['Employee ID', 'Name', 'Department', ...data.courses.map((c) => c.title), 'Assigned', 'Completed'],
    data.rows.map((r) => [
      r.employee.employeeCode,
      r.employee.name,
      r.employee.department,
      ...data.courses.map((c) => {
        const cell = r.cells[c.id];
        if (!cell) return '';
        return cell.status === 'IN_PROGRESS' ? `IN_PROGRESS (${Math.round(cell.progress * 100)}%)` : cell.status;
      }),
      r.assigned,
      r.completed,
    ])
  );
  sendCsv(res, 'training-completion.csv', csv);
});

export const overdue = h(async (req, res) => {
  const { tenantId } = ctx(req);
  ok(res, await trainingService.overdue(tenantId, req.query as ReportFilter));
});

export const overdueCsv = h(async (req, res) => {
  const { tenantId } = ctx(req);
  const rows = await trainingService.overdue(tenantId, req.query as ReportFilter);
  const csv = toCsv(
    ['Employee ID', 'Name', 'Department', 'Course', 'Mandatory', 'Status', 'Progress %', 'Due date', 'Days overdue'],
    rows.map((r) => [
      r.employee.employeeCode,
      r.employee.name,
      r.employee.department,
      r.course.title,
      r.course.mandatory ? 'Yes' : 'No',
      r.status,
      Math.round(r.progress * 100),
      r.dueDate,
      r.daysOverdue,
    ])
  );
  sendCsv(res, 'training-overdue.csv', csv);
});
