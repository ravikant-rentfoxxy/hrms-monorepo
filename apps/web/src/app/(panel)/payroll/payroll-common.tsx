'use client';

import { useState } from 'react';
import { API_URL, fmtDate, fmtMoney, getActingCompanyId, getSession } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, ErrorNote, Modal, Select, Spinner } from '@/components/ui';
import { openSecureFile } from '@/lib/secure-file';

/* ---------------------------------- Types --------------------------------- */

export interface PayItem {
  label: string;
  amount: number;
  code?: string;
  taxable?: boolean;
}

export interface TaxComputation {
  fy: string;
  regime: 'NEW' | 'OLD';
  month: string;
  monthsRemaining: number;
  salary: { ytd: number; current: number; projected: number; previousEmployer: number; total: number };
  exemptions: { label: string; amount: number }[];
  standardDeduction: number;
  professionalTax: number;
  deductions: { section: string; label: string; claimed: number; allowed: number }[];
  totalDeductions: number;
  taxableIncome: number;
  slabTax: number;
  rebate: number;
  surcharge: number;
  cess: number;
  annualTax: number;
  tdsDeducted: number;
  previousEmployerTds: number;
  balanceTax: number;
  monthlyTds: number;
  declarationStatus: string | null;
  declarationBasis: 'VERIFIED' | 'DECLARED' | 'NONE';
}

export interface Payslip {
  id: string;
  employeeId: string;
  month: string;
  status: 'DRAFT' | 'PUBLISHED';
  earnings: PayItem[];
  deductions: PayItem[];
  employerContributions: PayItem[] | null;
  workingDays: number;
  paidDays: number;
  lopDays: number;
  paidOn: string;
  gross: number;
  totalDeductions: number;
  net: number;
  taxComputation: TaxComputation | null;
}

export interface PayslipDetail extends Payslip {
  employee: { name: string; employeeCode: string; designation: string; taxRegime: string };
  ytd: { fy: string; months: number; gross: number; deductions: number; net: number; tds: number; pf: number };
}

export interface RunTotals {
  employees: number;
  gross: number;
  deductions: number;
  net: number;
  employerContributions: number;
  employerCost: number;
  tds: number;
  lopDays: number;
  zeroDays: number;
  skipped: number;
}

export interface PayrollRun {
  id: string;
  month: string;
  status: 'DRAFT' | 'LOCKED' | 'APPROVED' | 'PUBLISHED';
  workingDays: number;
  totals: RunTotals | null;
  createdAt: string;
  lockedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  paidAt: string | null;
  paymentReference: string;
  paymentMode: string;
}

export const monthName = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const days = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const runTone = (status: string) =>
  status === 'PUBLISHED' || status === 'PAID' ? 'green' : status === 'APPROVED' ? 'violet' : status === 'LOCKED' ? 'blue' : status === 'DRAFT' ? 'amber' : 'slate';

const RUN_LABELS: Record<string, string> = { LOCKED: 'UNDER REVIEW' };

export function RunBadge({ status, paid }: { status: string; paid?: boolean }) {
  const s = paid ? 'PAID' : status;
  return <Badge tone={runTone(s)}>{RUN_LABELS[s] ?? s}</Badge>;
}

/** Current financial year ("2026-27") and the few before it. */
export function fyOptions(count = 4): string[] {
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: count }, (_, i) => {
    const y = start - i;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  });
}

/** Authenticated file download (the API needs the Bearer token). */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const session = getSession();
  const headers: Record<string, string> = { Authorization: `Bearer ${session?.accessToken}` };
  const acting = session?.role === 'SUPER_ADMIN' ? getActingCompanyId() : null;
  if (acting) headers['X-Company-Id'] = acting;
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error ?? `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------ Payslip detail ----------------------------- */

function Lines({ title, tone, items, total, totalLabel }: {
  title: string; tone: string; items: PayItem[]; total: number; totalLabel: string;
}) {
  return (
    <div>
      <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</h3>
      {items.map((e, i) => (
        <div key={`${e.label}-${i}`} className="flex justify-between border-b border-ink-100 py-1.5 text-sm">
          <span className="text-ink-600">
            {e.label}
            {e.taxable === false && <span className="ml-1 text-[11px] text-ink-400">(non-taxable)</span>}
          </span>
          <span className="font-medium tabular-nums">{fmtMoney(e.amount)}</span>
        </div>
      ))}
      <div className="flex justify-between py-1.5 text-sm font-semibold">
        <span>{totalLabel}</span>
        <span className="tabular-nums">{fmtMoney(total)}</span>
      </div>
    </div>
  );
}

/** Payslip drill-down: lines, employer contributions, LOP, YTD and the TDS working. */
export function PayslipModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: slip, loading, error } = useFetch<PayslipDetail>(`/payroll/payslips/${id}`);
  const [showTax, setShowTax] = useState(false);
  const employer = slip?.employerContributions ?? [];
  return (
    <Modal title={slip ? `Payslip — ${monthName(slip.month)}` : 'Payslip'} open onClose={onClose} wide>
      {loading || !slip ? (
        error ? <ErrorNote error={error} /> : <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
            <span className="font-medium text-ink-900">{slip.employee.name}</span>
            <span className="text-ink-400">{slip.employee.employeeCode}</span>
            {slip.status === 'DRAFT' && <Badge tone="amber">DRAFT</Badge>}
            <span className="ml-auto">
              Paid {days(slip.paidDays)}/{slip.workingDays} days · LOP {days(slip.lopDays)} ·{' '}
              {(slip.taxComputation?.regime ?? slip.employee.taxRegime) === 'OLD' ? 'Old' : 'New'} regime
            </span>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <Lines title="Earnings" tone="text-emerald-600" items={slip.earnings} total={slip.gross} totalLabel="Gross" />
            <Lines title="Deductions" tone="text-rose-600" items={slip.deductions} total={slip.totalDeductions} totalLabel="Total" />
          </div>
          <div className="flex items-center justify-between rounded-lg bg-brand-50 px-4 py-3">
            <span className="text-sm text-ink-600">Net pay · on {fmtDate(slip.paidOn)}</span>
            <span className="text-lg font-bold text-brand-700">{fmtMoney(slip.net)}</span>
          </div>
          {employer.length > 0 && (
            <div className="rounded-lg bg-ink-50 px-4 py-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Employer contributions (part of CTC)
              </p>
              {employer.map((e) => (
                <div key={e.label} className="flex justify-between py-1 text-sm">
                  <span className="text-ink-600">{e.label}</span>
                  <span className="tabular-nums">{fmtMoney(e.amount)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-5 gap-2 rounded-lg border border-ink-100 px-4 py-2.5">
            <p className="col-span-5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
              Year to date · FY {slip.ytd.fy}
            </p>
            {[
              ['Gross', slip.ytd.gross], ['Deductions', slip.ytd.deductions], ['Net', slip.ytd.net],
              ['TDS', slip.ytd.tds], ['PF', slip.ytd.pf],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p className="text-[11px] text-ink-400">{label}</p>
                <p className="text-sm font-semibold tabular-nums text-ink-800">{fmtMoney(value as number)}</p>
              </div>
            ))}
          </div>
          {slip.taxComputation && (
            <div>
              <button className="text-sm font-medium text-brand-600 hover:underline" onClick={() => setShowTax(!showTax)}>
                {showTax ? 'Hide' : 'Show'} TDS working
              </button>
              {showTax && <TaxBreakdown comp={slip.taxComputation} />}
            </div>
          )}
          <Button
            className="w-full"
            onClick={() =>
              void openSecureFile(`/payroll/payslips/${slip.id}/pdf?inline=true`).catch((err: unknown) =>
                window.alert(err instanceof Error ? err.message : 'Could not open the payslip')
              )
            }
          >
            Download PDF
          </Button>
        </div>
      )}
    </Modal>
  );
}

/* ----------------------------------- Tax ----------------------------------- */

function Row({ label, value, bold, negative }: { label: string; value: number; bold?: boolean; negative?: boolean }) {
  return (
    <div className={`flex justify-between py-1 text-sm ${bold ? 'font-semibold text-ink-900' : 'text-ink-600'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{negative ? `−${fmtMoney(value)}` : fmtMoney(value)}</span>
    </div>
  );
}

export function TaxBreakdown({ comp }: { comp: TaxComputation }) {
  return (
    <div className="mt-2 rounded-lg border border-ink-100 px-4 py-2">
      <Row label="Salary paid this FY" value={comp.salary.ytd} />
      <Row label="This month" value={comp.salary.current} />
      <Row label={`Projected (${comp.monthsRemaining - 1} more month${comp.monthsRemaining === 2 ? '' : 's'})`} value={comp.salary.projected} />
      {comp.salary.previousEmployer > 0 && <Row label="Previous employer" value={comp.salary.previousEmployer} />}
      <Row label="Gross annual income" value={comp.salary.total} bold />
      {comp.exemptions.map((e) => <Row key={e.label} label={e.label} value={e.amount} negative />)}
      <Row label="Standard deduction" value={comp.standardDeduction} negative />
      {comp.professionalTax > 0 && <Row label="Professional tax" value={comp.professionalTax} negative />}
      {comp.deductions.map((d) => (
        <Row key={d.section} label={`${d.section} · ${d.label}${d.claimed > d.allowed ? ` (capped from ${fmtMoney(d.claimed)})` : ''}`} value={d.allowed} negative />
      ))}
      <Row label="Taxable income" value={comp.taxableIncome} bold />
      <Row label="Tax on slabs" value={comp.slabTax} />
      {comp.rebate > 0 && <Row label="Rebate u/s 87A" value={comp.rebate} negative />}
      {comp.surcharge > 0 && <Row label="Surcharge" value={comp.surcharge} />}
      <Row label="Health & education cess" value={comp.cess} />
      <Row label="Annual tax" value={comp.annualTax} bold />
      <Row label="TDS already deducted" value={comp.tdsDeducted + comp.previousEmployerTds} negative />
      <Row label={`Monthly TDS (balance ÷ ${comp.monthsRemaining})`} value={comp.monthlyTds} bold />
      <p className="pt-1 text-xs text-ink-400">
        {comp.regime === 'NEW'
          ? 'New regime: investment declarations do not reduce tax.'
          : comp.declarationBasis === 'VERIFIED'
            ? 'Old regime: HR-verified declaration amounts are used.'
            : comp.declarationBasis === 'DECLARED'
              ? 'Old regime: declared amounts are used until proofs are verified (verified amounts only from January).'
              : 'Old regime: no submitted declaration — only employee PF counts under 80C.'}
      </p>
    </div>
  );
}

/** Live annual tax projection + Form 16 download for one employee. */
export function TaxCard({ employeeId, self }: { employeeId: string; self?: boolean }) {
  const query = self ? '' : `?employeeId=${employeeId}`;
  const { data, loading, error } = useFetch<{
    regime: 'NEW' | 'OLD'; tdsEnabled: boolean; hasStructure: boolean; projection: TaxComputation | null;
  }>(`/payroll/tax-projection${query}`);
  const [fy, setFy] = useState(fyOptions()[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);

  const form16 = async () => {
    setBusy(true);
    setFormError(null);
    try {
      await openSecureFile(`/payroll/form16/${employeeId}?fy=${fy}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const p = data?.projection;
  return (
    <div className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-900">
          Income tax {p ? `· FY ${p.fy}` : ''}{' '}
          {data && <Badge tone="violet">{data.regime === 'OLD' ? 'Old regime' : 'New regime'}</Badge>}
        </h2>
        <div className="flex items-center gap-2">
          <Select value={fy} onChange={(e) => setFy(e.target.value)} className="!w-28 !py-1.5">
            {fyOptions().map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
          <Button variant="secondary" onClick={() => void form16()} disabled={busy}>
            {busy ? 'Preparing…' : 'Form 16'}
          </Button>
        </div>
      </div>
      <ErrorNote error={formError ?? error} />
      {loading ? (
        <Spinner />
      ) : !data?.hasStructure || !p ? (
        <p className="text-sm text-ink-400">No salary structure yet — nothing to project.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Taxable income', p.taxableIncome],
              ['Annual tax', p.annualTax],
              ['TDS so far', p.tdsDeducted],
              ['Monthly TDS', p.monthlyTds],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg bg-ink-50 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
                <p className="text-sm font-semibold tabular-nums text-ink-800">{fmtMoney(value as number)}</p>
              </div>
            ))}
          </div>
          {!data.tdsEnabled && <p className="mt-2 text-xs text-amber-600">TDS is switched off in the statutory settings.</p>}
          <button className="mt-3 text-sm font-medium text-brand-600 hover:underline" onClick={() => setDetails(!details)}>
            {details ? 'Hide' : 'Show'} computation
          </button>
          {details && <TaxBreakdown comp={p} />}
        </>
      )}
    </div>
  );
}
