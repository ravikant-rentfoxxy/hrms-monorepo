'use client';

import { useState } from 'react';
import { fmtMoney } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';

/**
 * Indian salary structure (mirrors services/salary.service.ts — the backend
 * stays authoritative; this copy powers the live preview and CTC auto-fill):
 *
 *   Gross = Basic + HRA + Conveyance + Medical + Special Allowance
 *   CTC   = Gross + Employer PF (12% of basic) + Employer ESI (3.25% of gross
 *           when gross ≤ ₹21,000) + Gratuity (4.81% of basic)
 *   Net   = Gross − Employee PF − Employee ESI   (TDS/PT apply at payroll time)
 *   Labour Codes: Basic must be ≥ 50% of CTC.
 */
const PF_RATE = 0.12;
const GRATUITY_RATE = 0.0481;
const STD_CONVEYANCE = 1600;
const STD_MEDICAL = 1250;
// ESI statutory defaults (the company's statutory settings may differ; payroll uses those).
const ESI_WAGE_LIMIT = 21000;
const ESI_EMPLOYEE_RATE = 0.0075;
const ESI_EMPLOYER_RATE = 0.0325;

export interface SalaryForm {
  salaryBasic: string;
  salaryHra: string;
  salaryConveyance: string;
  salaryMedical: string;
  salaryAllowance: string;
  salaryPfEmployer: string;
  salaryPfEmployee: string;
}

export const SALARY_KEYS = [
  'salaryBasic', 'salaryHra', 'salaryConveyance', 'salaryMedical', 'salaryAllowance',
  'salaryPfEmployer', 'salaryPfEmployee',
] as const;

export const emptySalaryForm: SalaryForm = {
  salaryBasic: '', salaryHra: '', salaryConveyance: '', salaryMedical: '', salaryAllowance: '',
  salaryPfEmployer: '', salaryPfEmployee: '',
};

/** The typed fields as numbers, for a PATCH/POST body. */
export function salaryBody(form: SalaryForm): Record<string, number> {
  const body: Record<string, number> = {};
  for (const key of SALARY_KEYS) if (form[key] !== '') body[key] = Number(form[key]) || 0;
  return body;
}

export const gratuityFor = (basic: number): number => (basic > 0 ? Math.round(basic * GRATUITY_RATE) : 0);

/** Monthly ESI on a full-month gross (0 above the wage limit), rounded up like the payroll. */
export function esiFor(gross: number): { employee: number; employer: number } {
  if (gross <= 0 || gross > ESI_WAGE_LIMIT) return { employee: 0, employer: 0 };
  const up = (n: number) => Math.ceil(Math.round(n * 100) / 100);
  return { employee: up(gross * ESI_EMPLOYEE_RATE), employer: up(gross * ESI_EMPLOYER_RATE) };
}

/** Monthly CTC = gross + employer PF + employer ESI + gratuity provision. */
export const ctcFor = (gross: number, basic: number, pfEmployer: number): number =>
  gross + pfEmployer + esiFor(gross).employer + gratuityFor(basic);

/** Standard structure from a monthly CTC — same maths as the backend. */
export function structureFromCtc(monthlyCtc: number): SalaryForm {
  if (monthlyCtc <= 0) return emptySalaryForm;
  const basic = Math.round(0.5 * monthlyCtc);
  const pf = Math.round(basic * PF_RATE);
  const left = monthlyCtc - pf - gratuityFor(basic);
  let gross = left;
  if (esiFor(gross).employer > 0) {
    gross = Math.floor(left / (1 + ESI_EMPLOYER_RATE));
    while (gross + esiFor(gross).employer > left) gross--;
  }
  let hra = Math.round(0.4 * basic);
  let conveyance = STD_CONVEYANCE;
  let medical = STD_MEDICAL;
  let special = gross - basic - hra - conveyance - medical;
  if (special < 0) { medical = 0; special = gross - basic - hra - conveyance; }
  if (special < 0) { conveyance = 0; special = gross - basic - hra; }
  if (special < 0) { hra = Math.max(0, gross - basic); special = 0; }
  return {
    salaryBasic: String(basic),
    salaryHra: String(hra),
    salaryConveyance: String(conveyance),
    salaryMedical: String(medical),
    salaryAllowance: String(special),
    salaryPfEmployer: String(pf),
    salaryPfEmployee: String(pf),
  };
}

function Row({ label, value, bold, negative, muted }: {
  label: string; value: number; bold?: boolean; negative?: boolean; muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className={`text-sm ${bold ? 'font-semibold text-slate-900' : muted ? 'text-slate-400' : 'text-slate-600'}`}>
        {label}
      </span>
      <span className={`text-sm tabular-nums ${bold ? 'font-semibold text-slate-900' : muted ? 'text-slate-400' : 'text-slate-700'}`}>
        {negative ? `-${fmtMoney(value)}` : fmtMoney(value)}
      </span>
    </div>
  );
}

const FIELDS: { key: keyof SalaryForm; label: string }[] = [
  { key: 'salaryBasic', label: 'Basic' },
  { key: 'salaryHra', label: 'HRA' },
  { key: 'salaryConveyance', label: 'Conveyance' },
  { key: 'salaryMedical', label: 'Medical Allowance' },
  { key: 'salaryAllowance', label: 'Special Allowance' },
  { key: 'salaryPfEmployer', label: 'PF - Employer' },
  { key: 'salaryPfEmployee', label: 'PF Employee' },
];

/** Typed component inputs + auto-calculated Gross / Gratuity / CTC / Net Pay. */
export function SalaryEditor({ form, onChange }: { form: SalaryForm; onChange: (f: SalaryForm) => void }) {
  const [ctcInput, setCtcInput] = useState('');
  const n = (v: string) => Number(v) || 0;
  const basic = n(form.salaryBasic);
  const gross = basic + n(form.salaryHra) + n(form.salaryConveyance) + n(form.salaryMedical) + n(form.salaryAllowance);
  const pfEmployer = n(form.salaryPfEmployer);
  const pfEmployee = n(form.salaryPfEmployee);
  const gratuity = gratuityFor(basic);
  const esi = esiFor(gross);
  const ctc = gross + pfEmployer + esi.employer + gratuity;
  const deductions = pfEmployee + esi.employee;
  const basicBelowHalf = ctc > 0 && basic < 0.5 * ctc - 1; // −1 absorbs rounding

  return (
    <div>
      <div className="mb-3 flex items-end gap-2 rounded-lg bg-indigo-50/60 p-2.5">
        <div className="flex-1">
          <Field label="Auto-fill from monthly CTC (optional)" hint="Basic 50% of CTC · HRA 40% of basic · PF 12% · gratuity 4.81%">
            <Input
              type="number"
              min={0}
              placeholder="e.g. 50000"
              value={ctcInput}
              onChange={(e) => setCtcInput(e.target.value)}
            />
          </Field>
        </div>
        <Button
          variant="secondary"
          onClick={() => Number(ctcInput) > 0 && onChange(structureFromCtc(Number(ctcInput)))}
        >
          Fill structure
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {FIELDS.map(({ key, label }) => (
          <Field key={key} label={`${label} (₹/mo)`}>
            <Input
              type="number"
              min={0}
              placeholder="0"
              value={form[key]}
              onChange={(e) => onChange({ ...form, [key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        PF is 12% of basic (₹1,800 if restricted to the default ₹15,000 wage ceiling — set in Statutory settings). Gratuity (4.81% of basic) and, for
        gross up to ₹21,000, employer ESI (3.25%) are added to CTC automatically.
      </p>
      {basicBelowHalf && (
        <p className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          Labour Codes 2025: Basic should be at least 50% of CTC — currently {((basic / ctc) * 100).toFixed(0)}%.
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-x-6 rounded-lg bg-slate-50 px-4 py-2 md:grid-cols-5">
        {[
          { label: 'Gross Salary', value: gross },
          { label: 'Gratuity (CTC)', value: gratuity },
          { label: 'Total CTC', value: ctc },
          { label: 'Deductions', value: deductions },
          { label: 'Net Pay', value: gross - deductions },
        ].map((t) => (
          <div key={t.label} className="py-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t.label}</p>
            <p className="text-sm font-semibold tabular-nums text-slate-800">{fmtMoney(t.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Keka-style salary breakup with a Monthly / Annually toggle. */
export function SalaryBreakup({
  basic, hra, conveyance = 0, medical = 0, allowance, pfEmployer, pfEmployee,
}: {
  basic: number; hra: number; conveyance?: number; medical?: number;
  allowance: number; pfEmployer: number; pfEmployee: number;
}) {
  const [period, setPeriod] = useState<'Monthly' | 'Annually'>('Monthly');
  const x = period === 'Monthly' ? 1 : 12;
  const monthlyGross = basic + hra + conveyance + medical + allowance;
  const gross = monthlyGross * x;
  const gratuity = gratuityFor(basic) * x;
  const esi = esiFor(monthlyGross);
  const esiEmployer = esi.employer * x;
  const esiEmployee = esi.employee * x;
  const totalDeductions = pfEmployee * x + esiEmployee;

  return (
    <div>
      <div className="mb-4 flex justify-center">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
          {(['Monthly', 'Annually'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                period === p ? 'border border-indigo-300 bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pb-1">
        <span className="text-sm font-bold text-slate-900">Earnings</span>
        <span className="text-xs font-medium text-slate-400">Amount (INR)</span>
      </div>
      <Row label="Basic" value={basic * x} />
      <Row label="HRA" value={hra * x} />
      {conveyance > 0 && <Row label="Conveyance" value={conveyance * x} />}
      {medical > 0 && <Row label="Medical Allowance" value={medical * x} />}
      <Row label="Special Allowance" value={allowance * x} />
      <div className="border-t border-slate-100">
        <Row label="Gross Salary" value={gross} bold />
      </div>
      <Row label="PF - Employer" value={pfEmployer * x} muted />
      {esiEmployer > 0 && <Row label="ESI - Employer" value={esiEmployer} muted />}
      <Row label="Gratuity (provision)" value={gratuity} muted />
      <div className="border-t border-slate-100">
        <Row label="Total (CTC)" value={gross + pfEmployer * x + esiEmployer + gratuity} bold />
      </div>

      <div className="mt-4 flex items-center justify-between pb-1">
        <span className="text-sm font-bold text-slate-900">Deductions</span>
        <span className="text-xs font-medium text-slate-400">Amount (INR)</span>
      </div>
      <Row label="PF Employee" value={pfEmployee * x} negative />
      {esiEmployee > 0 && <Row label="ESI Employee" value={esiEmployee} negative />}
      <div className="border-t border-slate-100">
        <Row label="Total Deductions" value={totalDeductions} bold negative />
      </div>

      <div className="mt-3 rounded-lg bg-emerald-50 px-3">
        <div className="flex items-center justify-between py-2.5">
          <span className="text-sm font-bold text-slate-900">Net Pay (take home)</span>
          <span className="text-base font-bold tabular-nums text-emerald-700">{fmtMoney(gross - totalDeductions)}</span>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        NOTE: Net Pay above does not include taxes or other deductions (if any) — TDS and professional tax are applied
        in the payroll run. Employer PF, employer ESI and gratuity are part of CTC, not of the employee&apos;s gross salary.
      </p>
    </div>
  );
}
