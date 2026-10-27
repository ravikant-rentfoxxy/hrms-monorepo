/**
 * Expense claims with receipt files stored in the object bucket. Decisions go
 * through the approval engine (module EXPENSE): a claim stays PENDING until
 * the last level of its chain approves, or any level rejects.
 */
import type { RequestStatus, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from '../lib/notify';
import { ApiError } from '../utils/http';
import { objectKey, presignedGetUrl, putObject, FILE_LINK_TTL_SECONDS } from '../lib/storage';
import * as approvalService from './approval.service';

export interface ExpenseInput {
  category: string;
  description: string;
  amount: number;
  date: Date;
}

export interface ReceiptFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export async function listExpenses(
  companyId: string,
  filter: { status?: RequestStatus; scope: 'me' | 'company'; employeeId: string | null }
) {
  const expenses = await prisma.expenseClaim.findMany({
    where: {
      companyId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.scope === 'me' ? { employeeId: filter.employeeId ?? '' } : {}),
    },
    include: { employee: { select: { id: true, name: true } }, approver: { select: { id: true, name: true } } },
    orderBy: { date: 'desc' },
    take: 200,
  });
  // Where each pending claim sits in its approval chain ("level 2 of 3 · waiting on Priya").
  const pendingIds = expenses.filter((e) => e.status === 'PENDING').map((e) => e.id);
  const steps = pendingIds.length
    ? await prisma.approvalStep.findMany({
        where: { companyId, module: 'EXPENSE', requestId: { in: pendingIds } },
        orderBy: { level: 'asc' },
      })
    : [];
  const approverIds = [...new Set(steps.map((s) => s.approverEmployeeId).filter((x): x is string => !!x))];
  const approvers = approverIds.length
    ? await prisma.employee.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } })
    : [];
  return expenses.map((e) => {
    const chain = steps.filter((s) => s.requestId === e.id);
    const current = chain.find((s) => s.status === 'PENDING');
    const approval = current
      ? {
          level: current.level,
          totalLevels: chain.length,
          waitingOn: current.approverRole ?? approvers.find((a) => a.id === current.approverEmployeeId)?.name ?? null,
          approverEmployeeId: current.approverEmployeeId,
        }
      : null;
    return { ...e, hasReceipt: !!e.receiptKey, approval };
  });
}

export async function createExpense(companyId: string, employeeId: string, input: ExpenseInput, receipt?: ReceiptFile) {
  let receiptKey: string | null = null;
  if (receipt) {
    receiptKey = objectKey(companyId, 'receipts', receipt.originalname);
    await putObject(receiptKey, receipt.buffer, receipt.mimetype || 'application/octet-stream');
  }
  const claim = await prisma.expenseClaim.create({ data: { ...input, companyId, employeeId, receiptKey } });
  await approvalService.start(companyId, 'EXPENSE', claim.id, employeeId);
  return claim;
}

/** Short-lived download URL for the receipt (owner or managerial roles). */
export async function receiptUrl(
  companyId: string,
  expenseId: string,
  actor: { employeeId: string | null; canViewAll: boolean }
) {
  const expense = await prisma.expenseClaim.findFirst({ where: { id: expenseId, companyId } });
  if (!expense) throw ApiError.notFound('Expense not found');
  if (expense.employeeId !== actor.employeeId && !actor.canViewAll) {
    // Named approvers in the chain (e.g. a department head) may see the receipt they are judging.
    const isApprover = actor.employeeId
      ? await prisma.approvalStep.count({
          where: { companyId, module: 'EXPENSE', requestId: expense.id, approverEmployeeId: actor.employeeId },
        })
      : 0;
    if (!isApprover) throw ApiError.forbidden();
  }
  if (!expense.receiptKey) throw ApiError.notFound('No receipt attached');
  return { url: await presignedGetUrl(expense.receiptKey), expiresInSeconds: FILE_LINK_TTL_SECONDS };
}

/**
 * Records a decision on the claim's current approval level. The engine checks
 * that the actor is the current approver (ADMIN / HR may override any level);
 * claims raised before the engine existed get their chain created lazily.
 */
export async function decideExpense(
  companyId: string,
  expenseId: string,
  input: { decision: 'APPROVED' | 'REJECTED'; remarks?: string; actor: { role: Role; employeeId: string | null } }
) {
  const { decision, remarks, actor } = input;
  const expense = await prisma.expenseClaim.findFirst({ where: { id: expenseId, companyId } });
  if (!expense) throw ApiError.notFound('Expense not found');
  if (expense.status !== 'PENDING') throw ApiError.badRequest('Expense already decided');
  if (expense.employeeId === actor.employeeId) throw ApiError.forbidden('Cannot decide your own expense');

  const result = await approvalService.act(
    companyId, 'EXPENSE', expense.id, expense.employeeId,
    { role: actor.role, employeeId: actor.employeeId }, decision, remarks
  );
  if (result.outcome === 'PENDING') {
    return { ...expense, approvalOutcome: result.outcome, approvedLevel: result.step.level };
  }
  const updated = await prisma.expenseClaim.update({
    where: { id: expense.id },
    data: { status: result.outcome, remarks: remarks ?? null, approverId: actor.employeeId },
  });
  await notify(companyId, [expense.employeeId], {
    event: result.outcome === 'APPROVED' ? 'expense.approved' : 'expense.rejected',
    title: `Expense claim ${result.outcome === 'APPROVED' ? 'approved' : 'rejected'}`,
    body: `${expense.category} · ₹${expense.amount.toLocaleString('en-IN')}${remarks ? ` — ${remarks}` : ''}`,
    link: '/expenses',
  });
  return { ...updated, approvalOutcome: result.outcome, approvedLevel: result.step.level };
}

export async function cancelExpense(companyId: string, employeeId: string, expenseId: string) {
  const expense = await prisma.expenseClaim.findFirst({ where: { id: expenseId, companyId, employeeId } });
  if (!expense) throw ApiError.notFound('Expense not found');
  if (expense.status !== 'PENDING') throw ApiError.badRequest('Only pending claims can be cancelled');
  const updated = await prisma.expenseClaim.update({ where: { id: expense.id }, data: { status: 'CANCELLED' } });
  await approvalService.cancel(companyId, 'EXPENSE', expense.id);
  return updated;
}
