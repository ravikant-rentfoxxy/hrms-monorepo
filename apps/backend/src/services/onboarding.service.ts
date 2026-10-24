/**
 * Onboarding: checklist templates → one case per new joiner with dated tasks
 * for the employee, their manager, HR, IT and Admin. Document tasks store the
 * uploaded file as a Document of the joiner. A case completes itself once
 * every task is done.
 *
 *   await startOnboarding(companyId, employee.id);   // after the employee is created
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { objectKey, putObject } from '../lib/storage';
import { ApiError } from '../utils/http';
import { addDays, dateOnly, employeeIdsWithRoles, isCompanyAdmin, todayUTC } from '../utils/lifecycle';

export type AssigneeRole = 'EMPLOYEE' | 'HR' | 'MANAGER' | 'IT' | 'ADMIN';

export interface TemplateTask {
  title: string;
  description: string;
  assigneeRole: AssigneeRole;
  dueOffsetDays: number;
  requiresDocument: boolean;
  documentCategory: string;
}

export interface TemplateInput {
  name: string;
  tasks: TemplateTask[];
  isDefault: boolean;
  isActive: boolean;
}

export interface Viewer {
  role: Role;
  employeeId: string | null;
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const task = (
  title: string,
  assigneeRole: AssigneeRole,
  dueOffsetDays: number,
  description: string,
  documentCategory = ''
): TemplateTask => ({ title, assigneeRole, dueOffsetDays, description, requiresDocument: !!documentCategory, documentCategory });

/** The checklist every company starts with (editable under Onboarding → Templates). */
export const DEFAULT_TASKS: TemplateTask[] = [
  task('Sign and upload the offer letter', 'EMPLOYEE', 0, 'Upload a signed copy of your offer letter.', 'Offer Letter'),
  task('Upload PAN card', 'EMPLOYEE', 0, 'Clear scan or photo of your PAN card (both sides not needed).', 'Identity'),
  task('Upload Aadhaar card', 'EMPLOYEE', 0, 'Front and back of your Aadhaar card in a single file.', 'Identity'),
  task('Upload a passport-size photograph', 'EMPLOYEE', 0, 'Recent photograph with a plain background — used for your ID card.', 'Onboarding'),
  task('Upload bank proof', 'EMPLOYEE', 2, 'Cancelled cheque or the first page of your passbook / bank statement for salary credit.', 'Important files'),
  task('Upload education certificates', 'EMPLOYEE', 3, 'Highest qualification degree and mark sheets.', 'Degrees & Certificates'),
  task('Upload experience & relieving letters', 'EMPLOYEE', 3, 'Relieving / experience letters and the last three payslips from previous employers (freshers may upload a declaration).', 'Previous Experience'),
  task('Fill in personal & bank details', 'EMPLOYEE', 1, 'Complete your profile: address, emergency contact, PAN, bank account and IFSC.'),
  task('Read and acknowledge company policies', 'EMPLOYEE', 3, 'Read the employee handbook, code of conduct and IT acceptable-use policy (Documents → company-wide).'),
  task('Laptop & official email setup', 'IT', 0, 'Issue a laptop (record it under Assets), create the official email account and grant tool access.'),
  task('Issue ID card & access card', 'ADMIN', 2, 'Print the ID card with the employee photograph and enable office access.'),
  task('Buddy introduction & team walkthrough', 'MANAGER', 1, 'Assign an onboarding buddy, introduce the team and share the first-30-days plan.'),
  task('Verify documents & complete the HR file', 'HR', 7, 'Verify the uploaded documents against originals and complete PF / ESI enrolment.'),
];

const DEFAULT_NAME = 'Standard onboarding';

// ---- Templates ----

/** Lazily seeds the default template the first time a company uses onboarding. */
export async function ensureDefaultTemplate(companyId: string) {
  const existing = await prisma.onboardingTemplate.findFirst({
    where: { companyId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  if (existing) return existing;
  const any = await prisma.onboardingTemplate.count({ where: { companyId } });
  if (any > 0) return null; // every template was archived on purpose — don't resurrect one
  return prisma.onboardingTemplate.create({
    data: { companyId, name: DEFAULT_NAME, tasks: DEFAULT_TASKS as unknown as Prisma.InputJsonValue, isDefault: true },
  });
}

export async function listTemplates(companyId: string) {
  await ensureDefaultTemplate(companyId);
  return prisma.onboardingTemplate.findMany({ where: { companyId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
}

async function clearOtherDefaults(companyId: string, keepId: string) {
  await prisma.onboardingTemplate.updateMany({ where: { companyId, NOT: { id: keepId } }, data: { isDefault: false } });
}

export async function createTemplate(companyId: string, input: TemplateInput) {
  const created = await prisma.onboardingTemplate.create({
    data: {
      companyId,
      name: input.name,
      tasks: input.tasks as unknown as Prisma.InputJsonValue,
      isDefault: input.isDefault,
      isActive: input.isActive,
    },
  });
  if (created.isDefault) await clearOtherDefaults(companyId, created.id);
  return created;
}

export async function updateTemplate(companyId: string, id: string, input: Partial<TemplateInput>) {
  const existing = await prisma.onboardingTemplate.findFirst({ where: { id, companyId } });
  if (!existing) throw ApiError.notFound('Template not found');
  const updated = await prisma.onboardingTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.tasks !== undefined ? { tasks: input.tasks as unknown as Prisma.InputJsonValue } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  if (updated.isDefault) await clearOtherDefaults(companyId, updated.id);
  return updated;
}

/** Existing cases keep their tasks; the template is only a blueprint. */
export async function deleteTemplate(companyId: string, id: string): Promise<void> {
  const result = await prisma.onboardingTemplate.deleteMany({ where: { id, companyId } });
  if (result.count === 0) throw ApiError.notFound('Template not found');
}

// ---- Cases ----

const caseInclude = {
  employee: {
    select: { id: true, name: true, employeeCode: true, designation: true, department: true, joiningDate: true, managerId: true, avatarColor: true },
  },
  tasks: { orderBy: [{ sortOrder: 'asc' as const }] },
};

function withProgress<T extends { tasks: { done: boolean }[] }>(c: T) {
  const total = c.tasks.length;
  const done = c.tasks.filter((t) => t.done).length;
  return { ...c, totalTasks: total, doneTasks: done, progress: total === 0 ? 100 : Math.round((done / total) * 100) };
}

/**
 * Starts onboarding for an employee. Idempotent: an employee has at most one
 * IN_PROGRESS case — calling again returns it unchanged.
 */
export async function startOnboarding(companyId: string, employeeId: string, templateId?: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: { id: true, name: true, joiningDate: true, managerId: true, isActive: true },
  });
  if (!employee) throw ApiError.notFound('Employee not found');

  const open = await prisma.onboardingCase.findFirst({
    where: { companyId, employeeId, status: 'IN_PROGRESS' },
    include: caseInclude,
  });
  if (open) return withProgress(open);

  const template = templateId
    ? await prisma.onboardingTemplate.findFirst({ where: { id: templateId, companyId } })
    : await ensureDefaultTemplate(companyId);
  if (templateId && !template) throw ApiError.notFound('Onboarding template not found');
  if (!template) throw ApiError.badRequest('No active onboarding template — create one under Onboarding → Templates');

  const tasks = (template.tasks as unknown as TemplateTask[]) ?? [];
  const joining = dateOnly(employee.joiningDate);
  const created = await prisma.onboardingCase.create({
    data: {
      companyId,
      employeeId,
      templateId: template.id,
      tasks: {
        create: tasks.map((t, i) => ({
          companyId,
          title: t.title,
          description: t.description ?? '',
          assigneeRole: t.assigneeRole,
          // Person-assigned tasks: the joiner, or their reporting manager.
          assigneeId: t.assigneeRole === 'EMPLOYEE' ? employeeId : t.assigneeRole === 'MANAGER' ? employee.managerId : null,
          dueDate: addDays(joining, t.dueOffsetDays ?? 0),
          requiresDocument: !!t.requiresDocument,
          documentCategory: t.documentCategory ?? '',
          sortOrder: i,
        })),
      },
    },
    include: caseInclude,
  });

  await notify(companyId, [employeeId], {
    event: 'onboarding.started',
    title: 'Welcome aboard! Your onboarding checklist is ready',
    body: `${tasks.filter((t) => t.assigneeRole === 'EMPLOYEE').length} tasks are waiting for you — upload your documents and complete your profile.`,
    link: '/onboarding',
    email: true,
  });
  await notify(companyId, [employee.managerId, ...(await employeeIdsWithRoles(companyId))], {
    event: 'onboarding.started',
    title: `Onboarding started for ${employee.name}`,
    body: 'Checklist tasks have been assigned to HR, IT, Admin and the reporting manager.',
    link: '/onboarding',
  });
  return withProgress(created);
}

/** HR dashboard (all cases) / manager view (their reports' cases). */
export async function listCases(companyId: string, viewer: Viewer, filter: { status?: string }) {
  const where: Prisma.OnboardingCaseWhereInput = { companyId, ...(filter.status ? { status: filter.status } : {}) };
  if (!isCompanyAdmin(viewer.role)) {
    if (viewer.role !== 'MANAGER' || !viewer.employeeId) throw ApiError.forbidden();
    where.employee = { managerId: viewer.employeeId };
  }
  const cases = await prisma.onboardingCase.findMany({ where, include: caseInclude, orderBy: { startedOn: 'desc' }, take: 300 });
  return cases.map(withProgress);
}

async function loadCase(companyId: string, id: string) {
  const c = await prisma.onboardingCase.findFirst({ where: { id, companyId }, include: caseInclude });
  if (!c) throw ApiError.notFound('Onboarding case not found');
  return c;
}

function assertCanView(c: { employeeId: string; employee: { managerId: string | null } }, viewer: Viewer) {
  if (isCompanyAdmin(viewer.role)) return;
  if (viewer.employeeId && (c.employeeId === viewer.employeeId || c.employee.managerId === viewer.employeeId)) return;
  throw ApiError.forbidden();
}

export async function getCase(companyId: string, id: string, viewer: Viewer) {
  const c = await loadCase(companyId, id);
  assertCanView(c, viewer);
  return withProgress(c);
}

/** The joiner's own (latest) case, or null. */
export async function myCase(companyId: string, employeeId: string) {
  const c = await prisma.onboardingCase.findFirst({
    where: { companyId, employeeId, status: { not: 'CANCELLED' } },
    include: caseInclude,
    orderBy: { startedOn: 'desc' },
  });
  return c ? withProgress(c) : null;
}

export async function cancelCase(companyId: string, id: string) {
  const c = await loadCase(companyId, id);
  if (c.status !== 'IN_PROGRESS') throw ApiError.badRequest(`Case is already ${c.status.toLowerCase()}`);
  await prisma.onboardingCase.update({ where: { id }, data: { status: 'CANCELLED' } });
  return withProgress(await loadCase(companyId, id));
}

// ---- Tasks ----

/** Department tasks (no named assignee) are handled by company admins. */
const ADMIN_HANDLED: AssigneeRole[] = ['HR', 'IT', 'ADMIN'];

/**
 * Tasks the viewer is expected to act on in open cases: tasks assigned to
 * them by name (joiner's own tasks, manager's tasks for their reports), plus
 * HR / IT / Admin department tasks for company admins.
 */
export async function myTasks(companyId: string, viewer: Viewer, opts: { includeDone?: boolean } = {}) {
  const or: Prisma.OnboardingTaskWhereInput[] = [];
  if (viewer.employeeId) or.push({ assigneeId: viewer.employeeId });
  if (isCompanyAdmin(viewer.role)) {
    or.push({ assigneeRole: { in: ADMIN_HANDLED } });
    // Manager tasks of joiners without a manager fall back to HR.
    or.push({ assigneeRole: 'MANAGER', assigneeId: null });
  }
  if (or.length === 0) return [];
  return prisma.onboardingTask.findMany({
    where: {
      companyId,
      OR: or,
      ...(opts.includeDone ? {} : { done: false }),
      case: { status: 'IN_PROGRESS' },
    },
    include: {
      case: { select: { id: true, status: true, employee: { select: { id: true, name: true, employeeCode: true, joiningDate: true } } } },
    },
    orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }],
    take: 500,
  });
}

async function loadTask(companyId: string, id: string) {
  const t = await prisma.onboardingTask.findFirst({
    where: { id, companyId },
    include: { case: { select: { id: true, status: true, employeeId: true, employee: { select: { name: true, managerId: true } } } } },
  });
  if (!t) throw ApiError.notFound('Task not found');
  return t;
}

function assertCanAct(t: Awaited<ReturnType<typeof loadTask>>, viewer: Viewer) {
  if (isCompanyAdmin(viewer.role)) return;
  if (viewer.employeeId && t.assigneeId === viewer.employeeId) return;
  if (t.assigneeRole === 'MANAGER' && viewer.employeeId && t.case.employee.managerId === viewer.employeeId) return;
  throw ApiError.forbidden('This task is assigned to someone else');
}

/** Completes the case when no open task remains (and re-opens it otherwise). */
async function syncCaseStatus(companyId: string, caseId: string) {
  const c = await prisma.onboardingCase.findFirst({ where: { id: caseId, companyId }, include: { tasks: true, employee: { select: { name: true } } } });
  if (!c || c.status === 'CANCELLED') return;
  const allDone = c.tasks.length > 0 && c.tasks.every((t) => t.done);
  if (allDone && c.status !== 'COMPLETED') {
    await prisma.onboardingCase.update({ where: { id: c.id }, data: { status: 'COMPLETED', completedOn: new Date() } });
    await notify(companyId, [c.employeeId, ...(await employeeIdsWithRoles(companyId))], {
      event: 'onboarding.completed',
      title: `Onboarding completed for ${c.employee.name}`,
      body: 'Every checklist task is done.',
      link: '/onboarding',
    });
  } else if (!allDone && c.status === 'COMPLETED') {
    await prisma.onboardingCase.update({ where: { id: c.id }, data: { status: 'IN_PROGRESS', completedOn: null } });
  }
}

/** Pre-joining document type → the onboarding upload task asking for the same thing (matched on the task title). */
const PREJOINING_TASK_MATCH: Record<string, RegExp> = {
  PAN: /\bpan\b/i,
  AADHAAR: /aadh?aar/i,
  ID_PROOF: /aadh?aar|\bid proof\b/i,
  PHOTO: /photo/i,
  BANK: /bank proof|cheque|passbook/i,
  EDUCATION: /education|degree|qualification/i,
  EXPERIENCE: /experience|relieving/i,
  RELIEVING: /experience|relieving/i,
  PAYSLIPS: /experience|relieving|payslip/i,
  OFFER: /offer letter/i,
};

/**
 * A joiner who already sent documents during pre-joining shouldn't be asked
 * again: ticks off the matching open upload tasks and links the filed document.
 * Returns the number of tasks completed.
 */
export async function completeTasksFromPrejoining(
  companyId: string,
  employeeId: string,
  docs: { type: string; documentId: string }[],
  actorId: string | null
): Promise<number> {
  if (docs.length === 0) return 0;
  const c = await prisma.onboardingCase.findFirst({ where: { companyId, employeeId, status: 'IN_PROGRESS' }, include: { tasks: true } });
  if (!c) return 0;
  let completed = 0;
  for (const t of c.tasks) {
    if (!t.requiresDocument || t.done) continue;
    const hit = docs.find((d) => PREJOINING_TASK_MATCH[d.type]?.test(t.title));
    if (!hit) continue;
    await prisma.onboardingTask.update({
      where: { id: t.id },
      data: {
        done: true,
        doneAt: new Date(),
        doneById: actorId,
        documentId: hit.documentId,
        description: t.description ? `${t.description}\n\nReceived and verified during pre-joining.` : 'Received and verified during pre-joining.',
      },
    });
    completed++;
  }
  if (completed > 0) await syncCaseStatus(companyId, c.id);
  return completed;
}

/**
 * Marks a task done. Document tasks need a file (unless one was uploaded
 * before a reopen); it is stored as a Document of the joiner in the task's folder.
 */
export async function completeTask(companyId: string, taskId: string, viewer: Viewer, file?: UploadedFile) {
  const t = await loadTask(companyId, taskId);
  assertCanAct(t, viewer);
  if (t.case.status === 'CANCELLED') throw ApiError.badRequest('This onboarding case was cancelled');
  if (t.done) throw ApiError.badRequest('Task is already done');
  if (t.requiresDocument && !file && !t.documentId) {
    throw ApiError.badRequest(`Upload the document for "${t.title}" to complete this task`);
  }

  let documentId = t.documentId;
  if (file) {
    const key = objectKey(companyId, 'documents', file.originalname);
    const mime = file.mimetype || 'application/octet-stream';
    await putObject(key, file.buffer, mime);
    const doc = await prisma.document.create({
      data: {
        companyId,
        employeeId: t.case.employeeId,
        name: `${t.title} — ${file.originalname}`.slice(0, 200),
        category: t.documentCategory || 'Onboarding',
        fileKey: key,
        mimeType: mime,
        size: file.size,
        uploadedById: viewer.employeeId,
      },
    });
    documentId = doc.id;
  }

  const updated = await prisma.onboardingTask.update({
    where: { id: t.id },
    data: { done: true, doneAt: new Date(), doneById: viewer.employeeId, documentId },
  });
  await syncCaseStatus(companyId, t.caseId);
  return updated;
}

export async function reopenTask(companyId: string, taskId: string, viewer: Viewer) {
  const t = await loadTask(companyId, taskId);
  assertCanAct(t, viewer);
  if (t.case.status === 'CANCELLED') throw ApiError.badRequest('This onboarding case was cancelled');
  if (!t.done) throw ApiError.badRequest('Task is not done yet');
  // The uploaded document stays on file; completing again may reuse it or replace it.
  const updated = await prisma.onboardingTask.update({
    where: { id: t.id },
    data: { done: false, doneAt: null, doneById: null },
  });
  await syncCaseStatus(companyId, t.caseId);
  if (t.assigneeId && t.assigneeId !== viewer.employeeId) {
    await notify(companyId, [t.assigneeId], {
      event: 'onboarding.task_reopened',
      title: `Onboarding task reopened: ${t.title}`,
      body: 'Please review and complete it again.',
      link: '/onboarding',
    });
  }
  return updated;
}

// ---- Reminders (daily job) ----

/** Notifies assignees of open tasks due today (department tasks → company admins). */
export async function notifyDueTasks(companyId: string): Promise<number> {
  const due = await prisma.onboardingTask.findMany({
    where: { companyId, done: false, dueDate: todayUTC(), case: { status: 'IN_PROGRESS' } },
    include: { case: { select: { employee: { select: { name: true } } } } },
  });
  if (due.length === 0) return 0;
  const admins = await employeeIdsWithRoles(companyId);
  for (const t of due) {
    await notify(companyId, t.assigneeId ? [t.assigneeId] : admins, {
      event: 'onboarding.task_due',
      title: `Onboarding task due today: ${t.title}`,
      body: `For ${t.case.employee.name}.`,
      link: '/onboarding',
    });
  }
  return due.length;
}
