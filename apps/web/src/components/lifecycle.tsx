'use client';

/** Small shared pieces for the employee-lifecycle pages (onboarding, letters, assets, exits). */

import { useFetch } from '@/lib/useFetch';
import { Select } from '@/components/ui';

export interface EmployeeOption {
  id: string;
  name: string;
  employeeCode?: string;
  designation?: string;
}

/** Active employees for pickers (ADMIN/HR only — pass enabled=false otherwise). */
export function useEmployees(enabled = true) {
  const { data } = useFetch<{ items: EmployeeOption[] }>(enabled ? '/employees?pageSize=100' : null);
  return data?.items ?? [];
}

export function EmployeeSelect({
  employees,
  value,
  onChange,
  placeholder = 'Select an employee',
}: {
  employees: EmployeeOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {employees.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
          {e.employeeCode ? ` (${e.employeeCode})` : ''}
        </option>
      ))}
    </Select>
  );
}

export const errText = (err: unknown): string => (err instanceof Error ? err.message : 'Something went wrong');

/** "IN_PROGRESS" → "In progress". */
export const humanize = (s: string): string => {
  const t = s.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-ink-100">
        <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-ink-500">{pct}%</span>
    </div>
  );
}

/** Opens a short-lived signed URL returned by `{ url }` endpoints. */
export const openUrl = (url: string): void => {
  window.open(url, '_blank', 'noopener');
};
