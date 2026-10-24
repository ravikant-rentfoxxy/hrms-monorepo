/**
 * Organisation masters: departments, designations and grades.
 *
 * Employees link to them by id (departmentId / designationId / gradeId); the
 * legacy text columns Employee.department / designation are kept equal to the
 * linked master's name, so renaming a master renames it on every employee.
 */
import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { ApiError } from '../utils/http';

export interface DepartmentInput {
  name: string;
  code?: string;
  headId?: string | null;
  parentId?: string | null;
  isActive?: boolean;
}

export interface DesignationInput {
  name: string;
  level?: number;
  isActive?: boolean;
}

export interface GradeInput {
  code: string;
  name: string;
  minCtc?: number;
  maxCtc?: number;
  isActive?: boolean;
}

const isUniqueClash = (err: unknown) => (err as { code?: string }).code === 'P2002';

// ---- Departments ----

/**
 * Companies created before master data existed only have free-text
 * department / designation names on their employees. The first time either
 * list is read and the company has no masters at all, build them from those
 * names (and link the employees) so every dropdown has options.
 */
async function ensureMastersFromEmployees(companyId: string) {
  const [departments, designations] = await Promise.all([
    prisma.department.count({ where: { companyId } }),
    prisma.designation.count({ where: { companyId } }),
  ]);
  if (departments === 0 && designations === 0) await syncFromEmployees(companyId);
}

export async function listDepartments(companyId: string, opts: { includeInactive?: boolean } = {}) {
  await ensureMastersFromEmployees(companyId);
  const [departments, counts] = await Promise.all([
    prisma.department.findMany({
      where: { companyId, ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    }),
    prisma.employee.groupBy({ by: ['departmentId'], where: { companyId, isActive: true }, _count: { _all: true } }),
  ]);
  const headIds = departments.map((d) => d.headId).filter((x): x is string => !!x);
  const heads = await prisma.employee.findMany({
    where: { companyId, id: { in: headIds } },
    select: { id: true, name: true, designation: true },
  });
  return departments.map((d) => ({
    ...d,
    head: heads.find((h) => h.id === d.headId) ?? null,
    parent: departments.find((p) => p.id === d.parentId)
      ? { id: d.parentId as string, name: departments.find((p) => p.id === d.parentId)!.name }
      : null,
    employeeCount: counts.find((c) => c.departmentId === d.id)?._count._all ?? 0,
  }));
}

async function assertDepartmentRefs(companyId: string, id: string | null, input: Partial<DepartmentInput>) {
  if (input.headId) {
    const head = await prisma.employee.findFirst({ where: { id: input.headId, companyId } });
    if (!head) throw ApiError.badRequest('Department head does not belong to this company');
  }
  if (input.parentId) {
    if (input.parentId === id) throw ApiError.badRequest('A department cannot be its own parent');
    const parent = await prisma.department.findFirst({ where: { id: input.parentId, companyId } });
    if (!parent) throw ApiError.badRequest('Parent department not found');
    // Walk up from the new parent: meeting this department would create a cycle.
    const seen = new Set<string>();
    let cursor: string | null = parent.parentId;
    while (id && cursor && !seen.has(cursor)) {
      if (cursor === id) throw ApiError.badRequest('That parent sits under this department — it would create a loop');
      seen.add(cursor);
      const next: { parentId: string | null } | null = await prisma.department.findUnique({ where: { id: cursor }, select: { parentId: true } });
      cursor = next?.parentId ?? null;
    }
  }
}

export async function createDepartment(companyId: string, input: DepartmentInput, req: Request | null = null) {
  await assertDepartmentRefs(companyId, null, input);
  try {
    const dept = await prisma.department.create({ data: { ...input, name: input.name.trim(), companyId } });
    await audit(req, { entity: 'Department', entityId: dept.id, action: 'CREATE', after: dept });
    return dept;
  } catch (err) {
    if (isUniqueClash(err)) throw ApiError.conflict(`Department "${input.name}" already exists`);
    throw err;
  }
}

export async function updateDepartment(companyId: string, id: string, input: Partial<DepartmentInput>, req: Request | null = null) {
  const before = await prisma.department.findFirst({ where: { id, companyId } });
  if (!before) throw ApiError.notFound('Department not found');
  await assertDepartmentRefs(companyId, id, input);
  try {
    const name = input.name?.trim();
    const [dept] = await prisma.$transaction([
      prisma.department.update({ where: { id }, data: { ...input, ...(name ? { name } : {}) } }),
      // Keep the legacy text column in sync on rename.
      ...(name && name !== before.name
        ? [prisma.employee.updateMany({ where: { companyId, departmentId: id }, data: { department: name } })]
        : []),
    ]);
    await audit(req, { entity: 'Department', entityId: id, action: 'UPDATE', before, after: dept });
    return dept;
  } catch (err) {
    if (isUniqueClash(err)) throw ApiError.conflict(`Department "${input.name}" already exists`);
    throw err;
  }
}

/** Deletes an unused department; one that still has employees must be emptied (or deactivated) first. */
export async function deleteDepartment(companyId: string, id: string, req: Request | null = null) {
  const dept = await prisma.department.findFirst({ where: { id, companyId } });
  if (!dept) throw ApiError.notFound('Department not found');
  const [members, children] = await Promise.all([
    prisma.employee.count({ where: { companyId, departmentId: id, isActive: true } }),
    prisma.department.count({ where: { companyId, parentId: id } }),
  ]);
  if (members > 0) throw ApiError.conflict(`${members} active employee(s) are in this department — move them or deactivate the department instead`);
  if (children > 0) throw ApiError.conflict('Other departments sit under this one — re-parent them first');
  await prisma.department.delete({ where: { id } });
  await audit(req, { entity: 'Department', entityId: id, action: 'DELETE', before: dept });
}

// ---- Designations ----

export async function listDesignations(companyId: string, opts: { includeInactive?: boolean } = {}) {
  await ensureMastersFromEmployees(companyId);
  const [list, counts] = await Promise.all([
    prisma.designation.findMany({
      where: { companyId, ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ level: 'desc' }, { name: 'asc' }],
    }),
    prisma.employee.groupBy({ by: ['designationId'], where: { companyId, isActive: true }, _count: { _all: true } }),
  ]);
  return list.map((d) => ({ ...d, employeeCount: counts.find((c) => c.designationId === d.id)?._count._all ?? 0 }));
}

export async function createDesignation(companyId: string, input: DesignationInput, req: Request | null = null) {
  try {
    const des = await prisma.designation.create({ data: { ...input, name: input.name.trim(), companyId } });
    await audit(req, { entity: 'Designation', entityId: des.id, action: 'CREATE', after: des });
    return des;
  } catch (err) {
    if (isUniqueClash(err)) throw ApiError.conflict(`Designation "${input.name}" already exists`);
    throw err;
  }
}

export async function updateDesignation(companyId: string, id: string, input: Partial<DesignationInput>, req: Request | null = null) {
  const before = await prisma.designation.findFirst({ where: { id, companyId } });
  if (!before) throw ApiError.notFound('Designation not found');
  try {
    const name = input.name?.trim();
    const [des] = await prisma.$transaction([
      prisma.designation.update({ where: { id }, data: { ...input, ...(name ? { name } : {}) } }),
      ...(name && name !== before.name
        ? [prisma.employee.updateMany({ where: { companyId, designationId: id }, data: { designation: name } })]
        : []),
    ]);
    await audit(req, { entity: 'Designation', entityId: id, action: 'UPDATE', before, after: des });
    return des;
  } catch (err) {
    if (isUniqueClash(err)) throw ApiError.conflict(`Designation "${input.name}" already exists`);
    throw err;
  }
}

export async function deleteDesignation(companyId: string, id: string, req: Request | null = null) {
  const des = await prisma.designation.findFirst({ where: { id, companyId } });
  if (!des) throw ApiError.notFound('Designation not found');
  const members = await prisma.employee.count({ where: { companyId, designationId: id, isActive: true } });
  if (members > 0) throw ApiError.conflict(`${members} active employee(s) hold this designation — reassign them or deactivate it instead`);
  await prisma.designation.delete({ where: { id } });
  await audit(req, { entity: 'Designation', entityId: id, action: 'DELETE', before: des });
}

// ---- Grades ----

function assertBand(minCtc: number | undefined, maxCtc: number | undefined) {
  if (minCtc !== undefined && maxCtc !== undefined && maxCtc > 0 && minCtc > maxCtc) {
    throw ApiError.badRequest('Minimum CTC cannot exceed maximum CTC');
  }
}

export async function listGrades(companyId: string, opts: { includeInactive?: boolean } = {}) {
  const [list, counts] = await Promise.all([
    prisma.grade.findMany({
      where: { companyId, ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ minCtc: 'asc' }, { code: 'asc' }],
    }),
    prisma.employee.groupBy({ by: ['gradeId'], where: { companyId, isActive: true }, _count: { _all: true } }),
  ]);
  return list.map((g) => ({ ...g, employeeCount: counts.find((c) => c.gradeId === g.id)?._count._all ?? 0 }));
}

export async function createGrade(companyId: string, input: GradeInput, req: Request | null = null) {
  assertBand(input.minCtc, input.maxCtc);
  try {
    const grade = await prisma.grade.create({ data: { ...input, code: input.code.trim().toUpperCase(), companyId } });
    await audit(req, { entity: 'Grade', entityId: grade.id, action: 'CREATE', after: grade });
    return grade;
  } catch (err) {
    if (isUniqueClash(err)) throw ApiError.conflict(`Grade "${input.code}" already exists`);
    throw err;
  }
}

export async function updateGrade(companyId: string, id: string, input: Partial<GradeInput>, req: Request | null = null) {
  const before = await prisma.grade.findFirst({ where: { id, companyId } });
  if (!before) throw ApiError.notFound('Grade not found');
  assertBand(input.minCtc ?? before.minCtc, input.maxCtc ?? before.maxCtc);
  try {
    const grade = await prisma.grade.update({
      where: { id },
      data: { ...input, ...(input.code ? { code: input.code.trim().toUpperCase() } : {}) },
    });
    await audit(req, { entity: 'Grade', entityId: id, action: 'UPDATE', before, after: grade });
    return grade;
  } catch (err) {
    if (isUniqueClash(err)) throw ApiError.conflict(`Grade "${input.code}" already exists`);
    throw err;
  }
}

export async function deleteGrade(companyId: string, id: string, req: Request | null = null) {
  const grade = await prisma.grade.findFirst({ where: { id, companyId } });
  if (!grade) throw ApiError.notFound('Grade not found');
  const members = await prisma.employee.count({ where: { companyId, gradeId: id, isActive: true } });
  if (members > 0) throw ApiError.conflict(`${members} active employee(s) are on this grade — reassign them or deactivate it instead`);
  await prisma.grade.delete({ where: { id } });
  await audit(req, { entity: 'Grade', entityId: id, action: 'DELETE', before: grade });
}

// ---- Migration of free-text values ----

/**
 * One-shot (re-runnable) migration: creates Department / Designation masters
 * from the distinct free-text values on employees (case-insensitive, trimmed)
 * and links every unlinked employee to the matching master.
 */
export async function syncFromEmployees(companyId: string, req: Request | null = null) {
  const employees = await prisma.employee.findMany({
    where: { companyId },
    select: { id: true, department: true, designation: true, departmentId: true, designationId: true },
  });
  const result = { departmentsCreated: 0, designationsCreated: 0, employeesLinked: 0 };

  const departments = await prisma.department.findMany({ where: { companyId } });
  const designations = await prisma.designation.findMany({ where: { companyId } });
  const deptByName = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d]));
  const desByName = new Map(designations.map((d) => [d.name.trim().toLowerCase(), d]));

  for (const e of employees) {
    const deptName = e.department.trim();
    if (deptName && !deptByName.has(deptName.toLowerCase())) {
      const created = await prisma.department.create({ data: { companyId, name: deptName } });
      deptByName.set(deptName.toLowerCase(), created);
      result.departmentsCreated += 1;
    }
    const desName = e.designation.trim();
    if (desName && !desByName.has(desName.toLowerCase())) {
      const created = await prisma.designation.create({ data: { companyId, name: desName } });
      desByName.set(desName.toLowerCase(), created);
      result.designationsCreated += 1;
    }
  }

  for (const e of employees) {
    const dept = e.departmentId ? null : deptByName.get(e.department.trim().toLowerCase());
    const des = e.designationId ? null : desByName.get(e.designation.trim().toLowerCase());
    if (!dept && !des) continue;
    await prisma.employee.update({
      where: { id: e.id },
      data: {
        ...(dept ? { departmentId: dept.id, department: dept.name } : {}),
        ...(des ? { designationId: des.id, designation: des.name } : {}),
      },
    });
    result.employeesLinked += 1;
  }

  await audit(req, { entity: 'Masters', entityId: companyId, action: 'SYNC_FROM_EMPLOYEES', after: result });
  return result;
}
