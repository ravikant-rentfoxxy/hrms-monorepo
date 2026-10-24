'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Avatar, Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, MonthPicker, PageHeader, Select, Spinner, Stat, Tabs, Textarea,
} from '@/components/ui';
import { errMsg } from '@/components/engage';

interface Person {
  id: string;
  name: string;
  designation: string;
  department: string;
  avatarColor: string;
}

interface Kudos {
  id: string;
  badge: string;
  message: string;
  points: number;
  createdAt: string;
  fromEmployee: Person;
  toEmployee: Person;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface Leaderboard {
  month: string;
  entries: { rank: number; employee: Person | null; points: number; kudos: number }[];
}

interface Mine {
  received: Kudos[];
  given: Kudos[];
  totalPoints: number;
  totalReceived: number;
  remainingToday: number;
  dailyLimit: number;
}

const BADGES: Record<string, { label: string; emoji: string }> = {
  THANK_YOU: { label: 'Thank you', emoji: '🙏' },
  TEAM_PLAYER: { label: 'Team player', emoji: '🤝' },
  INNOVATOR: { label: 'Innovator', emoji: '💡' },
  CUSTOMER_HERO: { label: 'Customer hero', emoji: '🦸' },
  GO_GETTER: { label: 'Go-getter', emoji: '🚀' },
  MENTOR: { label: 'Mentor', emoji: '🧭' },
};

function KudosCard({ k, onDelete }: { k: Kudos; onDelete?: () => void }) {
  const badge = BADGES[k.badge] ?? { label: k.badge, emoji: '⭐' };
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Avatar name={k.toEmployee.name} color={k.toEmployee.avatarColor} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{k.fromEmployee.name}</span> recognised{' '}
            <span className="font-semibold text-slate-900">{k.toEmployee.name}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone="violet">
              {badge.emoji} {badge.label}
            </Badge>
            <Badge tone="amber">+{k.points} pts</Badge>
            <span className="text-xs text-slate-400">{fmtDate(k.createdAt)}</span>
          </div>
          <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{k.message}</p>
        </div>
        {onDelete && (
          <Button variant="ghost" onClick={onDelete}>
            ✕
          </Button>
        )}
      </div>
    </Card>
  );
}

function GiveModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { session } = useAuth();
  const directory = useFetch<{ items: { id: string; name: string; department: string }[] }>('/employees?pageSize=100');
  const [form, setForm] = useState({ toEmployeeId: '', badge: 'THANK_YOU', message: '', points: '10' });
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const people = (directory.data?.items ?? [])
    .filter((p) => p.id !== session?.employee?.id)
    .filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()));

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('/recognition', { method: 'POST', body: { ...form, points: Number(form.points) } });
      onDone();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Give kudos" open onClose={onClose}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <Field label="Colleague">
          <Input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-2" />
          <Select value={form.toEmployeeId} onChange={(e) => setForm({ ...form, toEmployeeId: e.target.value })}>
            <option value="">Select a colleague…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.department ? ` — ${p.department}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Badge">
          <div className="flex flex-wrap gap-2">
            {Object.entries(BADGES).map(([key, b]) => (
              <button
                key={key}
                type="button"
                onClick={() => setForm({ ...form, badge: key })}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  form.badge === key ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {b.emoji} {b.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Message">
          <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
        </Field>
        <Field label="Points">
          <Select value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })}>
            {['5', '10', '20', '30', '50'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </Field>
        <Button onClick={() => void submit()} disabled={busy || !form.toEmployeeId || form.message.trim().length < 3} className="w-full">
          Send kudos
        </Button>
      </div>
    </Modal>
  );
}

export default function RecognitionPage() {
  const { session } = useAuth();
  const isAdmin = session?.role === 'ADMIN' || session?.role === 'SUPER_ADMIN';
  const tabs = ['Wall', 'Leaderboard', ...(session?.employee ? ['My kudos'] : [])];
  const [tab, setTab] = useState('Wall');
  const [page, setPage] = useState(1);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const wall = useFetch<Page<Kudos>>(tab === 'Wall' ? `/recognition?page=${page}&pageSize=20` : null);
  const board = useFetch<Leaderboard>(tab === 'Leaderboard' ? `/recognition/leaderboard?month=${month}&limit=20` : null);
  const mine = useFetch<Mine>(session?.employee ? '/recognition/me' : null);
  const [giveOpen, setGiveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (id: string) => {
    if (!window.confirm('Remove this kudos from the wall?')) return;
    setError(null);
    try {
      await api(`/recognition/${id}`, { method: 'DELETE' });
      wall.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const pages = wall.data ? Math.max(1, Math.ceil(wall.data.total / wall.data.pageSize)) : 1;

  return (
    <div>
      <PageHeader
        title="Recognition"
        subtitle="Celebrate great work"
        actions={
          session?.employee ? (
            <Button onClick={() => setGiveOpen(true)} disabled={mine.data?.remainingToday === 0}>
              + Give kudos
            </Button>
          ) : undefined
        }
      />
      {mine.data && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="My points" value={mine.data.totalPoints} icon="award" />
          <Stat label="Kudos received" value={mine.data.totalReceived} icon="heart" />
          <Stat label="Kudos given" value={mine.data.given.length} icon="star" />
          <Stat label="Left today" value={`${mine.data.remainingToday} / ${mine.data.dailyLimit}`} />
        </div>
      )}
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="mb-4">
        <ErrorNote error={error} />
      </div>

      {tab === 'Wall' &&
        (wall.loading && !wall.data ? (
          <Spinner />
        ) : !wall.data || wall.data.items.length === 0 ? (
          <Card>
            <Empty message="No kudos yet — be the first to recognise someone" />
          </Card>
        ) : (
          <div className="space-y-3">
            {wall.data.items.map((k) => (
              <KudosCard key={k.id} k={k} onDelete={isAdmin ? () => void remove(k.id) : undefined} />
            ))}
            {pages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  ← Newer
                </Button>
                <span className="text-sm text-slate-500">
                  Page {page} of {pages}
                </span>
                <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Older →
                </Button>
              </div>
            )}
          </div>
        ))}

      {tab === 'Leaderboard' && (
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 p-4">
            <p className="text-sm font-semibold text-slate-900">Top recognised</p>
            <div className="w-44">
              <MonthPicker value={month} onChange={setMonth} />
            </div>
          </div>
          {board.loading ? (
            <Spinner />
          ) : !board.data || board.data.entries.length === 0 ? (
            <Empty message="No kudos in this month" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {board.data.entries.map((e) => (
                <li key={e.employee?.id ?? e.rank} className="flex items-center gap-3 px-4 py-3">
                  <span className={`w-7 text-center text-sm font-bold ${e.rank <= 3 ? 'text-amber-500' : 'text-slate-400'}`}>
                    {e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : `#${e.rank}`}
                  </span>
                  <Avatar name={e.employee?.name ?? '?'} color={e.employee?.avatarColor} />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900">{e.employee?.name ?? 'Former employee'}</p>
                    <p className="text-xs text-slate-400">{e.employee?.department}</p>
                  </div>
                  <span className="text-sm text-slate-500">{e.kudos} kudos</span>
                  <Badge tone="amber">{e.points} pts</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'My kudos' && mine.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-900">Received</p>
            {mine.data.received.length === 0 ? (
              <Card>
                <Empty message="No kudos received yet" />
              </Card>
            ) : (
              mine.data.received.map((k) => <KudosCard key={k.id} k={k} />)
            )}
          </div>
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-900">Given</p>
            {mine.data.given.length === 0 ? (
              <Card>
                <Empty message="You haven't given kudos yet" />
              </Card>
            ) : (
              mine.data.given.map((k) => <KudosCard key={k.id} k={k} />)
            )}
          </div>
        </div>
      )}

      {giveOpen && (
        <GiveModal
          onClose={() => setGiveOpen(false)}
          onDone={() => {
            wall.reload();
            mine.reload();
          }}
        />
      )}
    </div>
  );
}
