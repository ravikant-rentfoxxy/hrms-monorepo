/**
 * Outbound integrations (Slack / Teams / webhooks / calendars / accounting).
 *
 * Configuration is stored per company; `dispatchIntegrationEvent()` is the
 * single hook services call when something happens. Delivery is NOT wired
 * yet — it only resolves the matching integrations and logs what it would
 * send. The accounting export (payroll journal CSV) works today.
 */
import type { Integration } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { ApiError } from '../utils/http';
import { monthStart } from '../utils/people';

export interface IntegrationInput {
  type: string;
  name: string;
  url?: string;
  events?: string;
  isActive?: boolean;
}

/** Known event names (for the editor's suggestions). Integrations may subscribe to others, to "*" or to "area.*". */
export const EVENT_CATALOGUE = [
  'employee.joined', 'employee.exited', 'leave.applied', 'leave.approved', 'leave.rejected',
  'expense.approved', 'payroll.published', 'timesheet.approved', 'timesheet.rejected',
  'travel.approved', 'travel.settled', 'kudos.received', 'announcement.posted', 'ticket.created', 'ticket.resolved',
];

export async function listIntegrations(companyId: string) {
  return prisma.integration.findMany({ where: { companyId }, orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }] });
}

export async function getIntegration(companyId: string, id: string) {
  const integration = await prisma.integration.findFirst({ where: { id, companyId } });
  if (!integration) throw ApiError.notFound('Integration not found');
  return integration;
}

export async function createIntegration(companyId: string, input: IntegrationInput) {
  return prisma.integration.create({ data: { ...input, companyId } });
}

export async function updateIntegration(companyId: string, id: string, data: Partial<IntegrationInput>) {
  const before = await getIntegration(companyId, id);
  const type = data.type ?? before.type;
  const url = data.url ?? before.url;
  if (['SLACK', 'TEAMS', 'WEBHOOK'].includes(type) && !url) {
    throw ApiError.badRequest('A URL is required for Slack / Teams / webhook integrations');
  }
  return prisma.integration.update({ where: { id }, data });
}

export async function deleteIntegration(companyId: string, id: string) {
  const integration = await getIntegration(companyId, id);
  await prisma.integration.delete({ where: { id } });
  return integration;
}

/** True when the integration's events CSV subscribes to `event` ("*", exact name, or "area.*"). */
export function subscribes(integration: Pick<Integration, 'events'>, event: string): boolean {
  const wanted = integration.events.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const ev = event.toLowerCase();
  return wanted.some((w) => w === '*' || w === ev || (w.endsWith('.*') && ev.startsWith(w.slice(0, -1))));
}

/** The HTTP request an integration would make for an event (also used by the "test" endpoint). */
export function buildDelivery(integration: Integration, event: string, payload: Record<string, unknown>) {
  const summary = typeof payload.title === 'string' ? payload.title : event;
  const detail = typeof payload.body === 'string' ? payload.body : '';
  const sentAt = new Date().toISOString();
  switch (integration.type) {
    case 'SLACK':
      return {
        method: 'POST',
        url: integration.url,
        headers: { 'Content-Type': 'application/json' },
        body: { text: `*${summary}*${detail ? `\n${detail}` : ''}`, event, payload },
      };
    case 'TEAMS':
      return {
        method: 'POST',
        url: integration.url,
        headers: { 'Content-Type': 'application/json' },
        body: { '@type': 'MessageCard', '@context': 'https://schema.org/extensions', summary, title: summary, text: detail || event },
      };
    case 'WEBHOOK':
      return {
        method: 'POST',
        url: integration.url,
        headers: { 'Content-Type': 'application/json', 'X-HRMS-Event': event },
        body: { event, companyId: integration.companyId, sentAt, payload },
      };
    case 'GOOGLE_CALENDAR':
    case 'OUTLOOK_CALENDAR':
      return {
        method: 'CALENDAR_EVENT',
        url: integration.url,
        headers: {},
        body: { note: 'Approved leave / travel would be written as calendar events (OAuth not configured).', event, payload },
      };
    default:
      return {
        method: 'EXPORT',
        url: integration.url,
        headers: {},
        body: { note: 'Accounting integrations are pull-based: download the payroll journal CSV and import it.', event },
      };
  }
}

/**
 * Hook for services: finds the company's active integrations subscribed to
 * `event` and delivers `payload` to each. Never throws. Returns how many
 * integrations matched.
 */
export async function dispatchIntegrationEvent(companyId: string, event: string, payload: Record<string, unknown>): Promise<number> {
  try {
    const integrations = await prisma.integration.findMany({ where: { companyId, isActive: true } });
    const matching = integrations.filter((i) => subscribes(i, event));
    for (const integration of matching) {
      const delivery = buildDelivery(integration, event, payload);
      // TODO(integrations): deliver — POST `delivery.body` to Slack/Teams/webhook URLs (with retry + signing secret),
      // create calendar events via Google/Microsoft OAuth, and record delivery status per attempt.
      logger.debug({ companyId, event, integrationId: integration.id, type: integration.type, url: delivery.url }, 'integration dispatch (TODO: delivery not wired)');
    }
    return matching.length;
  } catch (err) {
    logger.error({ err, companyId, event }, 'integration dispatch failed');
    return 0;
  }
}

/** What a test event would send — nothing is delivered. */
export async function testIntegration(companyId: string, id: string, event: string) {
  const integration = await getIntegration(companyId, id);
  const payload = { title: `Test event from your HRMS (${integration.name})`, body: 'If you can read this, the integration is configured.' };
  return {
    integration,
    event,
    subscribed: subscribes(integration, event),
    delivered: false,
    note: 'Delivery is not enabled yet — this is exactly what would be sent.',
    wouldSend: buildDelivery(integration, event, payload),
  };
}

// ---- Accounting export ----

type Ledger = { ledger: string; debit: number; credit: number };

function deductionLedger(label: string): string {
  if (/\besic?\b|employee state insurance/i.test(label)) return 'ESI Payable';
  if (/professional tax|^pt\b/i.test(label)) return 'Professional Tax Payable';
  if (/\btds\b|income tax/i.test(label)) return 'TDS Payable';
  if (/\blwf\b|labour welfare/i.test(label)) return 'LWF Payable';
  if (/loan|advance/i.test(label)) return 'Loan Recovery';
  if (/\bv?pf\b|provident/i.test(label)) return 'PF Payable';
  return 'Other Deductions Payable';
}

/** Employer contribution → [expense ledger, payable ledger]. */
function employerLedgers(label: string): [string, string] {
  if (/\besic?\b|employee state insurance/i.test(label)) return ['Employer ESI Contribution', 'ESI Payable'];
  if (/\blwf\b|labour welfare/i.test(label)) return ['Employer LWF Contribution', 'LWF Payable'];
  if (/gratuity/i.test(label)) return ['Gratuity Expense', 'Gratuity Payable'];
  return ['Employer PF Contribution', 'PF Payable']; // PF / EPS / EDLI / admin charges
}

const items = (v: unknown): { label: string; amount: number }[] =>
  Array.isArray(v)
    ? v
        .map((x) => x as { label?: unknown; amount?: unknown })
        .filter((x) => typeof x.label === 'string' && typeof x.amount === 'number')
        .map((x) => ({ label: x.label as string, amount: x.amount as number }))
    : [];

/**
 * Month-end payroll journal from PUBLISHED payslips, totalled by ledger:
 *   Dr Salary Expense, Employer PF / ESI (/LWF) contributions
 *   Cr Salary Payable (net), PF / ESI / PT / TDS / LWF payable, Loan Recovery
 * Columns import into Tally (Journal voucher) and Zoho Books (manual journal).
 */
export async function payrollJournal(companyId: string, monthKey: string) {
  const month = monthStart(monthKey);
  const payslips = await prisma.payslip.findMany({ where: { companyId, month, status: 'PUBLISHED' } });
  if (payslips.length === 0) throw ApiError.badRequest(`No published payslips for ${monthKey}`);

  const ledgers = new Map<string, Ledger>();
  const post = (ledger: string, debit: number, credit: number) => {
    const l = ledgers.get(ledger) ?? { ledger, debit: 0, credit: 0 };
    l.debit += debit;
    l.credit += credit;
    ledgers.set(ledger, l);
  };
  for (const p of payslips) {
    const earnings = items(p.earnings);
    const gross = earnings.length > 0 ? earnings.reduce((s, e) => s + e.amount, 0) : p.gross;
    const deductions = items(p.deductions);
    post('Salary Expense', gross, 0);
    for (const d of deductions) if (d.amount) post(deductionLedger(d.label), 0, d.amount);
    post('Salary Payable', 0, gross - deductions.reduce((s, d) => s + d.amount, 0));
    for (const c of items(p.employerContributions)) {
      if (!c.amount) continue;
      const [expense, payable] = employerLedgers(c.label);
      post(expense, c.amount, 0);
      post(payable, 0, c.amount);
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const order = (l: Ledger) => (l.debit > l.credit ? 0 : 1);
  const lines = [...ledgers.values()]
    .map((l) => {
      const net = r2(l.debit - l.credit);
      return { ledger: l.ledger, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    })
    .filter((l) => l.debit || l.credit)
    .sort((a, b) => order(a) - order(b) || a.ledger.localeCompare(b.ledger));
  const voucherDate = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
  return {
    month: monthKey,
    voucherDate,
    voucherNo: `PAY-${monthKey}`,
    payslips: payslips.length,
    lines,
    totalDebit: r2(lines.reduce((s, l) => s + l.debit, 0)),
    totalCredit: r2(lines.reduce((s, l) => s + l.credit, 0)),
  };
}
