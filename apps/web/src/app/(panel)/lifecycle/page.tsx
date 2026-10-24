'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Card, Empty, ErrorNote, PageHeader, Spinner, Table, Td } from '@/components/ui';
import { humanize } from '@/components/lifecycle';
import { EMPLOYMENT_STATUS_LABEL, LifecycleTimeline } from '@/components/career';

interface Stage {
  key: string;
  label: string;
  count: number;
  breakdown: Record<string, number>;
}

interface StageItem {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  date: string | null;
  refType: string;
  employeeId?: string | null;
  link: string;
}

/** Recruitment → employment → exit, coloured by phase. */
const phaseOf = (i: number) => (i < 8 ? 'hire' : i < 11 ? 'work' : 'exit');
const PHASE_STYLE: Record<string, string> = {
  hire: 'border-sky-200 bg-sky-50/60',
  work: 'border-emerald-200 bg-emerald-50/60',
  exit: 'border-amber-200 bg-amber-50/60',
};

const statusLabel = (s: string) => EMPLOYMENT_STATUS_LABEL[s] ?? humanize(s);

export default function LifecyclePage() {
  const { isCompanyAdmin, session } = useAuth();
  const { data, loading, error } = useFetch<{ stages: Stage[] }>(isCompanyAdmin ? '/lifecycle/pipeline' : null);
  const [stage, setStage] = useState<string | null>(null);
  const list = useFetch<{ label: string; items: StageItem[] }>(stage ? `/lifecycle/pipeline?stage=${stage}` : null);

  // Non-admins get their own hire-to-retire timeline.
  if (!isCompanyAdmin) {
    return (
      <div>
        <PageHeader title="My lifecycle" subtitle="Your journey from hiring to today" />
        {session?.employee ? <LifecycleTimeline employeeId="me" /> : <Empty message="No employee profile" />}
      </div>
    );
  }

  const active = data?.stages.find((s) => s.key === stage) ?? null;
  return (
    <div>
      <PageHeader
        title="Employee lifecycle"
        subtitle="Hire-to-retire pipeline — Job Requisition through Employee Archived. Click a stage to see who is in it."
      />
      <ErrorNote error={error} />
      {loading ? (
        <Spinner />
      ) : (
        <div className="mb-5 overflow-x-auto pb-2">
          <div className="flex min-w-max items-stretch gap-1.5">
            {data?.stages.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <button
                  onClick={() => setStage(stage === s.key ? null : s.key)}
                  className={`w-32 rounded-xl border p-3 text-left transition-all hover:shadow-md ${PHASE_STYLE[phaseOf(i)]} ${
                    stage === s.key ? 'ring-2 ring-indigo-500' : ''
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{i + 1}</p>
                  <p className="min-h-[2.5rem] text-xs font-semibold leading-tight text-slate-700">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{s.count}</p>
                </button>
                {i < (data?.stages.length ?? 0) - 1 && <span className="text-slate-300">›</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {active && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
            <h3 className="mr-2 text-sm font-semibold text-slate-900">{active.label}</h3>
            {Object.entries(active.breakdown).map(([k, v]) => (
              <Badge key={k} tone="slate">
                {statusLabel(k)}: {v}
              </Badge>
            ))}
          </div>
          {list.loading ? (
            <Spinner />
          ) : list.error ? (
            <ErrorNote error={list.error} />
          ) : !list.data || list.data.items.length === 0 ? (
            <Empty message="Nobody in this stage right now" />
          ) : (
            <Table headers={['Who / what', 'Details', 'Status', 'Date']}>
              {list.data.items.map((it) => (
                <tr key={`${it.refType}-${it.id}`} className="hover:bg-slate-50">
                  <Td>
                    <Link href={it.employeeId ? `/employees/${it.employeeId}` : it.link} className="font-medium text-indigo-700 hover:underline">
                      {it.title}
                    </Link>
                    <span className="block text-xs text-slate-400">{humanize(it.refType.replace(/([a-z])([A-Z])/g, '$1_$2'))}</span>
                  </Td>
                  <Td className="max-w-lg text-xs text-slate-600">{it.subtitle || '—'}</Td>
                  <Td>
                    <Badge tone="slate">{statusLabel(it.status)}</Badge>
                  </Td>
                  <Td>{it.date ? fmtDate(it.date) : '—'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
