'use client';

import { Fragment, useState } from 'react';
import { Badge, Empty, Table, Td } from './ui';

export interface AuditEntry {
  id: string;
  companyId: string | null;
  actorName: string;
  actorEmployeeId: string | null;
  entity: string;
  entityId: string;
  entityLabel: string | null;
  action: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

export interface AuditPage {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

const actionTone = (action: string): 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'slate' => {
  if (/CREATE|GRANT|APPROVE|ENABLE/.test(action)) return 'green';
  if (/DELETE|REVOKE|REJECT|DEACTIVATE|DISABLE|LOCK/.test(action)) return 'red';
  if (/PASSWORD|RESET|2FA/.test(action)) return 'violet';
  if (/UPDATE/.test(action)) return 'blue';
  return 'slate';
};

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString('en-IN');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : v === null || v === undefined ? {} : { value: v };

/** Field-by-field before → after table of one entry. */
export function AuditDiff({ before, after }: { before: unknown; after: unknown }) {
  const b = asRecord(before);
  const a = asRecord(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  if (keys.length === 0) return <p className="text-xs text-ink-400">No field details recorded.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-ink-400">
            <th className="py-1 pr-4 font-semibold">Field</th>
            <th className="py-1 pr-4 font-semibold">Before</th>
            <th className="py-1 font-semibold">After</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="border-t border-ink-100 align-top">
              <td className="py-1.5 pr-4 font-medium text-ink-600">{k.replace(/([A-Z])/g, ' $1')}</td>
              <td className="max-w-xs break-all py-1.5 pr-4 text-rose-600">{show(b[k])}</td>
              <td className="max-w-xs break-all py-1.5 text-emerald-700">{show(a[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Audit rows with an expandable before/after diff per row. */
export function AuditTable({ items, showEntity = true }: { items: AuditEntry[]; showEntity?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (items.length === 0) return <Empty message="No audit entries match" />;
  return (
    <Table headers={['When', 'Who', ...(showEntity ? ['Subject'] : []), 'Action', '']}>
      {items.map((e) => (
        <Fragment key={e.id}>
          <tr className="cursor-pointer" onClick={() => setOpen(open === e.id ? null : e.id)}>
            <Td className="whitespace-nowrap text-xs text-ink-500">{new Date(e.createdAt).toLocaleString('en-IN')}</Td>
            <Td>
              <span className="font-medium text-ink-800">{e.actorName || 'System'}</span>
              {e.ip && <span className="block text-[11px] text-ink-400">{e.ip}</span>}
            </Td>
            {showEntity && (
              <Td>
                <span className="text-ink-700">{e.entity}</span>
                <span className="block text-[11px] text-ink-400">{e.entityLabel ?? e.entityId}</span>
              </Td>
            )}
            <Td>
              <Badge tone={actionTone(e.action)}>{e.action}</Badge>
            </Td>
            <Td className="text-right text-xs text-brand-600">{open === e.id ? 'Hide' : 'Details'}</Td>
          </tr>
          {open === e.id && (
            <tr>
              <td colSpan={showEntity ? 5 : 4} className="bg-ink-50/70 px-4 py-3">
                <AuditDiff before={e.before} after={e.after} />
              </td>
            </tr>
          )}
        </Fragment>
      ))}
    </Table>
  );
}
