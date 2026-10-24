'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea } from '@/components/ui';
import { errMsg, label, pct } from '@/components/talent';

interface Question {
  id?: string;
  text: string;
  type: 'RATING' | 'NPS' | 'TEXT' | 'CHOICE';
  options?: string[];
  required?: boolean;
}

interface Survey {
  id: string;
  title: string;
  description: string;
  anonymous: boolean;
  status: string;
  questions: Question[];
  closesOn: string | null;
  createdAt: string;
  questionCount?: number;
  responses?: number;
  responseRate?: number;
  responded?: boolean;
}

const tone = (s: string) => (({ DRAFT: 'slate', OPEN: 'green', CLOSED: 'blue' }) as Record<string, 'slate' | 'green' | 'blue'>)[s] ?? 'slate';
const TYPE_LABEL: Record<Question['type'], string> = { RATING: 'Rating 1–5', NPS: 'NPS 0–10', TEXT: 'Free text', CHOICE: 'Multiple choice' };

export default function SurveysPage() {
  const { session, isCompanyAdmin } = useAuth();
  const tabs = [...(session?.employee ? ['Open surveys'] : []), ...(isCompanyAdmin ? ['Manage'] : [])];
  const [tab, setTab] = useState(tabs[0] ?? 'Manage');
  const open = useFetch<Survey[]>(tab === 'Open surveys' ? '/surveys/open' : null);
  const all = useFetch<Survey[]>(tab === 'Manage' ? '/surveys' : null);

  const [builder, setBuilder] = useState<Survey | 'new' | null>(null);
  const [form, setForm] = useState({ title: '', description: '', anonymous: true, closesOn: '' });
  const [questions, setQuestions] = useState<Question[]>([]);
  const [error, setError] = useState<string | null>(null);

  const openBuilder = (s: Survey | 'new') => {
    setError(null);
    if (s === 'new') {
      setForm({ title: '', description: '', anonymous: true, closesOn: '' });
      setQuestions([
        { text: 'How likely are you to recommend us as a place to work?', type: 'NPS', required: true },
        { text: 'How satisfied are you with your role?', type: 'RATING', required: true },
        { text: 'What one thing should we improve?', type: 'TEXT', required: false },
      ]);
    } else {
      setForm({ title: s.title, description: s.description, anonymous: s.anonymous, closesOn: s.closesOn?.slice(0, 10) ?? '' });
      setQuestions(s.questions);
    }
    setBuilder(s);
  };

  const setQ = (i: number, patch: Partial<Question>) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  const save = async () => {
    setError(null);
    const locked = builder !== 'new' && builder?.status === 'OPEN';
    const body = {
      title: form.title,
      description: form.description,
      closesOn: form.closesOn || null,
      ...(locked
        ? {}
        : {
            anonymous: form.anonymous,
            questions: questions.map((q) => ({
              ...(q.id ? { id: q.id } : {}),
              text: q.text,
              type: q.type,
              required: q.required ?? true,
              ...(q.type === 'CHOICE' ? { options: (q.options ?? []).map((o) => o.trim()).filter(Boolean) } : {}),
            })),
          }),
    };
    try {
      if (builder === 'new') await api('/surveys', { method: 'POST', body });
      else if (builder) await api(`/surveys/${builder.id}`, { method: 'PATCH', body });
      setBuilder(null);
      all.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const locked = builder !== 'new' && builder?.status === 'OPEN';

  return (
    <div>
      <PageHeader
        title="Surveys"
        subtitle="Engagement and pulse surveys"
        actions={isCompanyAdmin && <Button onClick={() => openBuilder('new')}>+ New survey</Button>}
      />
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}

      {tab === 'Open surveys' &&
        (open.loading ? (
          <Spinner />
        ) : !open.data?.length ? (
          <Card>
            <Empty message="No open surveys right now" />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {open.data.map((s) => (
              <Card key={s.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">{s.title}</h2>
                    <p className="text-xs text-slate-400">
                      {s.questions.length} questions{s.anonymous ? ' · anonymous' : ''}
                      {s.closesOn ? ` · closes ${fmtDate(s.closesOn)}` : ''}
                    </p>
                  </div>
                  {s.responded ? <Badge tone="green">Submitted</Badge> : <Badge tone="amber">Pending</Badge>}
                </div>
                {s.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{s.description}</p>}
                {!s.responded && (
                  <Link href={`/surveys/${s.id}`} className="mt-3 inline-block text-sm font-medium text-indigo-600">
                    Take survey →
                  </Link>
                )}
              </Card>
            ))}
          </div>
        ))}

      {tab === 'Manage' && (
        <Card>
          {all.loading ? (
            <Spinner />
          ) : !all.data?.length ? (
            <Empty message="No surveys yet" />
          ) : (
            <Table headers={['Survey', 'Status', 'Questions', 'Responses', 'Closes', '']}>
              {all.data.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <Link href={`/surveys/${s.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                      {s.title}
                    </Link>
                    <p className="text-xs text-slate-400">{s.anonymous ? 'Anonymous' : 'Named'} · created {fmtDate(s.createdAt)}</p>
                  </Td>
                  <Td>
                    <Badge tone={tone(s.status)}>{label(s.status)}</Badge>
                  </Td>
                  <Td>{s.questionCount}</Td>
                  <Td>
                    {s.responses} <span className="text-xs text-slate-400">({pct(s.responseRate)})</span>
                  </Td>
                  <Td>{fmtDate(s.closesOn)}</Td>
                  <Td>
                    <div className="flex gap-1">
                      {s.status !== 'CLOSED' && (
                        <Button variant="ghost" onClick={() => openBuilder(s)}>
                          Edit
                        </Button>
                      )}
                      <Link href={`/surveys/${s.id}`} className="px-2 py-2 text-sm font-medium text-indigo-600">
                        {s.status === 'DRAFT' ? 'Preview' : 'Results'}
                      </Link>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <Modal title={builder === 'new' ? 'New survey' : 'Edit survey'} open={!!builder} onClose={() => setBuilder(null)} wide>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Title">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Closes on (optional)">
              <DatePicker value={form.closesOn} onChange={(v) => setForm({ ...form, closesOn: v })} />
            </Field>
            <label className="mt-6 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.anonymous} disabled={locked} onChange={(e) => setForm({ ...form, anonymous: e.target.checked })} />
              Anonymous responses
            </label>
          </div>
          {locked && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">The survey is open — questions and anonymity are locked.</p>}
          <div className="space-y-2">
            {questions.map((q, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3">
                <div className="flex gap-2">
                  <span className="mt-2.5 text-xs font-semibold text-slate-400">{i + 1}.</span>
                  <Input value={q.text} disabled={locked} onChange={(e) => setQ(i, { text: e.target.value })} placeholder="Question" />
                  <Select
                    value={q.type}
                    disabled={locked}
                    onChange={(e) => setQ(i, { type: e.target.value as Question['type'], options: e.target.value === 'CHOICE' ? (q.options ?? ['', '']) : undefined })}
                    className="max-w-[160px]"
                  >
                    {(Object.keys(TYPE_LABEL) as Question['type'][]).map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                  {!locked && (
                    <Button variant="ghost" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>
                      ✕
                    </Button>
                  )}
                </div>
                {q.type === 'CHOICE' && (
                  <Input
                    className="mt-2"
                    disabled={locked}
                    placeholder="Options, comma separated"
                    value={(q.options ?? []).join(', ')}
                    onChange={(e) => setQ(i, { options: e.target.value.split(',').map((o) => o.trimStart()) })}
                  />
                )}
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  <input type="checkbox" checked={q.required ?? true} disabled={locked} onChange={(e) => setQ(i, { required: e.target.checked })} />
                  Required
                </label>
              </div>
            ))}
            {!locked && (
              <Button variant="secondary" onClick={() => setQuestions([...questions, { text: '', type: 'RATING', required: true }])}>
                + Add question
              </Button>
            )}
          </div>
          <Button
            onClick={() => void save()}
            disabled={form.title.length < 3 || !questions.length || questions.some((q) => q.text.trim().length < 3)}
            className="w-full"
          >
            Save {builder === 'new' ? 'as draft' : ''}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
