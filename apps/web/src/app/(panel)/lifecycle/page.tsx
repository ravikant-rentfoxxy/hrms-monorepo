'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Avatar, Badge, Card, Empty, ErrorNote, Icon, PageHeader, Spinner, Stat, Table, Td, type IconName } from '@/components/ui';
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

/** Recruitment → employment → exit. Stages are split by their position in the pipeline. */
const PHASES = [
  {
    key: 'hire',
    title: 'Recruitment',
    caption: 'Requisition to pre-onboarding',
    icon: 'briefcase',
    from: 0,
    to: 8,
    color: '#0EA5E9',
    accent: 'bg-sky-500',
    soft: 'bg-sky-50 text-sky-600',
    tile: 'hover:border-sky-300',
    ring: 'border-sky-400 ring-4 ring-sky-100',
    bar: 'bg-sky-400',
  },
  {
    key: 'work',
    title: 'Employment',
    caption: 'Joining, active service, transfers & payroll',
    icon: 'users',
    from: 8,
    to: 11,
    color: '#10B981',
    accent: 'bg-emerald-500',
    soft: 'bg-emerald-50 text-emerald-600',
    tile: 'hover:border-emerald-300',
    ring: 'border-emerald-400 ring-4 ring-emerald-100',
    bar: 'bg-emerald-400',
  },
  {
    key: 'exit',
    title: 'Exit',
    caption: 'Resignation to archive',
    icon: 'door',
    from: 11,
    to: 16,
    color: '#F59E0B',
    accent: 'bg-amber-500',
    soft: 'bg-amber-50 text-amber-600',
    tile: 'hover:border-amber-300',
    ring: 'border-amber-400 ring-4 ring-amber-100',
    bar: 'bg-amber-400',
  },
] as const;

type Phase = (typeof PHASES)[number];

const STAGE_ICON: Record<string, IconName> = {
  REQUISITION: 'tasks',
  POSTING: 'megaphone',
  APPLICATIONS: 'folder',
  SCREENING: 'search',
  INTERVIEW: 'calendar',
  SELECTED: 'star',
  OFFER_ACCEPTED: 'check',
  PRE_ONBOARDING: 'box',
  JOINED: 'plus',
  ACTIVE: 'user',
  PERFORMANCE_PAYROLL: 'banknote',
  RESIGNATION: 'logout',
  NOTICE: 'clock',
  CLEARANCE: 'shield',
  SETTLEMENT: 'receipt',
  ARCHIVED: 'box',
};

const statusLabel = (s: string) => EMPLOYMENT_STATUS_LABEL[s] ?? humanize(s);
const sum = (stages: Stage[]) => stages.reduce((n, s) => n + s.count, 0);

export default function LifecyclePage() {
  const { isCompanyAdmin, session } = useAuth();
  const { data, loading, error } = useFetch<{ stages: Stage[] }>(isCompanyAdmin ? '/lifecycle/pipeline' : null);
  const [stage, setStage] = useState<string | null>(null);
  const list = useFetch<{ label: string; items: StageItem[] }>(stage ? `/lifecycle/pipeline?stage=${stage}` : null);
  const detailRef = useRef<HTMLDivElement>(null);

  // Non-admins get their own hire-to-retire timeline.
  if (!isCompanyAdmin) {
    return (
      <div>
        <PageHeader title="My lifecycle" subtitle="Your journey from hiring to today" />
        {session?.employee ? <LifecycleTimeline employeeId="me" /> : <Empty message="No employee profile" />}
      </div>
    );
  }

  const stages = data?.stages ?? [];
  const byKey = (k: string) => stages.find((s) => s.key === k)?.count ?? 0;
  const activeIndex = stages.findIndex((s) => s.key === stage);
  const active = activeIndex >= 0 ? stages[activeIndex] : null;
  const activePhase = PHASES.find((p) => activeIndex >= p.from && activeIndex < p.to) ?? PHASES[0];

  const select = (key: string) => {
    const next = stage === key ? null : key;
    setStage(next);
    if (next) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

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
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="In recruitment" value={sum(stages.slice(0, 8))} icon="briefcase" accent="text-sky-600" />
            <Stat label="Active employees" value={byKey('ACTIVE')} icon="users" accent="text-emerald-600" />
            <Stat label="Exiting" value={sum(stages.slice(11, 15))} icon="door" accent="text-amber-600" />
            <Stat label="Archived" value={byKey('ARCHIVED')} icon="box" />
          </div>

          <div className="space-y-4">
            {PHASES.map((phase) => (
              <PhaseLane
                key={phase.key}
                phase={phase}
                stages={stages.slice(phase.from, phase.to)}
                offset={phase.from}
                selected={stage}
                onSelect={select}
              />
            ))}
          </div>
        </>
      )}

      {active && (
        <div ref={detailRef} className="mt-6 scroll-mt-6">
          <Card className="overflow-hidden">
            <div className={`h-1 ${activePhase.accent}`} />
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${activePhase.soft}`}>
                  <Icon name={STAGE_ICON[active.key] ?? 'box'} className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    Stage {activeIndex + 1} · {activePhase.title}
                  </p>
                  <h3 className="text-base font-semibold text-ink-900">
                    {active.label} <span className="font-normal text-ink-400">({active.count})</span>
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setStage(null)}
                className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
                aria-label="Close"
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
            </div>
            {Object.keys(active.breakdown).length > 0 && (
              <div className="flex flex-wrap gap-2 border-b border-ink-100 bg-ink-50/60 px-5 py-2.5">
                {Object.entries(active.breakdown).map(([k, v]) => (
                  <Badge key={k} tone="slate">
                    {statusLabel(k)} · {v}
                  </Badge>
                ))}
              </div>
            )}
            {list.loading ? (
              <Spinner />
            ) : list.error ? (
              <div className="p-5">
                <ErrorNote error={list.error} />
              </div>
            ) : !list.data || list.data.items.length === 0 ? (
              <Empty message="Nobody in this stage right now" />
            ) : (
              <Table headers={['Who / what', 'Details', 'Status', 'Date']}>
                {list.data.items.map((it) => (
                  <tr key={`${it.refType}-${it.id}`} className="hover:bg-ink-50">
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={it.title} color={activePhase.color} />
                        <div>
                          <Link
                            href={it.employeeId ? `/employees/${it.employeeId}` : it.link}
                            className="font-medium text-ink-900 hover:text-brand-700 hover:underline"
                          >
                            {it.title}
                          </Link>
                          <span className="block text-xs text-ink-400">
                            {humanize(it.refType.replace(/([a-z])([A-Z])/g, '$1_$2'))}
                          </span>
                        </div>
                      </div>
                    </Td>
                    <Td className="max-w-lg text-xs text-ink-600">{it.subtitle || '—'}</Td>
                    <Td>
                      <Badge tone="slate">{statusLabel(it.status)}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-600">{it.date ? fmtDate(it.date) : '—'}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function PhaseLane({
  phase,
  stages,
  offset,
  selected,
  onSelect,
}: {
  phase: Phase;
  stages: Stage[];
  offset: number;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <Card className="overflow-hidden">
      <div className={`h-1 ${phase.accent}`} />
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${phase.soft}`}>
            <Icon name={phase.icon} className="h-4.5 w-4.5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink-900">{phase.title}</h2>
            <p className="text-xs text-ink-400">{phase.caption}</p>
          </div>
        </div>
        <p className="text-xs text-ink-500">
          <span className="text-lg font-semibold tabular-nums text-ink-900">{sum(stages)}</span> across {stages.length} stages
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-4">
        {stages.map((s, i) => {
          const isActive = selected === s.key;
          return (
            <button
              key={s.key}
              onClick={() => onSelect(s.key)}
              className={`group flex flex-col rounded-xl border bg-white p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${
                isActive ? phase.ring : `border-ink-200 ${phase.tile}`
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${phase.soft}`}>
                  <Icon name={STAGE_ICON[s.key] ?? 'box'} className="h-4 w-4" />
                </span>
                <span className="text-[10px] font-semibold tabular-nums text-ink-300">
                  {String(offset + i + 1).padStart(2, '0')}
                </span>
              </div>
              <p className="mt-3 min-h-[2.25rem] text-xs font-medium leading-snug text-ink-600">{s.label}</p>
              <p className={`text-2xl font-semibold tabular-nums ${s.count ? 'text-ink-900' : 'text-ink-300'}`}>{s.count}</p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-100">
                <div className={`h-full rounded-full ${phase.bar}`} style={{ width: `${(s.count / max) * 100}%` }} />
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
