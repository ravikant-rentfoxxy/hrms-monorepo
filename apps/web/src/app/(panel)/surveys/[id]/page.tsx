'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, ErrorNote, PageHeader, Select, Spinner, Stat, Textarea } from '@/components/ui';
import { BarChart, HBarList, errMsg, label, pct } from '@/components/talent';

interface Question {
  id: string;
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
  responded?: boolean;
  acceptingResponses?: boolean;
}

interface QuestionResult {
  id: string;
  text: string;
  type: Question['type'];
  answered: number;
  average?: number | null;
  distribution?: { value: number | string; count: number }[];
  nps?: number | null;
  promoters?: number;
  passives?: number;
  detractors?: number;
  answers?: { text: string; respondent?: string | null }[];
}

interface Results {
  responses: number;
  eligible: number;
  responseRate: number;
  suppressed: boolean;
  minGroupSize: number;
  departments: { name: string; responses: number | null; suppressed: boolean }[];
  questions: QuestionResult[];
}

function AnswerForm({ survey, onDone }: { survey: Survey; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await api(`/surveys/${survey.id}/respond`, { method: 'POST', body: { answers } });
      onDone();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const scale = (q: Question, from: number, to: number) => (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => setAnswers({ ...answers, [q.id]: n })}
          className={`h-9 w-9 rounded-lg border text-sm font-medium transition-colors ${
            answers[q.id] === n ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:border-indigo-300'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      {survey.anonymous && (
        <p className="rounded-xl bg-indigo-50 px-3.5 py-2.5 text-sm text-indigo-700">
          This survey is anonymous — your name is never stored with your answers.
        </p>
      )}
      {survey.questions.map((q, i) => (
        <Card key={q.id} className="p-4">
          <p className="mb-3 text-sm font-medium text-slate-800">
            {i + 1}. {q.text} {q.required !== false && <span className="text-rose-500">*</span>}
          </p>
          {q.type === 'RATING' && scale(q, 1, 5)}
          {q.type === 'NPS' && (
            <>
              {scale(q, 0, 10)}
              <div className="mt-1 flex max-w-[440px] justify-between text-[11px] text-slate-400">
                <span>Not likely</span>
                <span>Very likely</span>
              </div>
            </>
          )}
          {q.type === 'CHOICE' && (
            <Select value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}>
              <option value="">— choose —</option>
              {q.options?.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </Select>
          )}
          {q.type === 'TEXT' && <Textarea value={String(answers[q.id] ?? '')} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />}
        </Card>
      ))}
      <ErrorNote error={error} />
      <Button onClick={() => void submit()} disabled={busy} className="w-full">
        Submit response
      </Button>
    </div>
  );
}

export default function SurveyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isCompanyAdmin } = useAuth();
  const survey = useFetch<Survey>(`/surveys/${id}`);
  const [dept, setDept] = useState('');
  const results = useFetch<Results>(
    isCompanyAdmin && survey.data && survey.data.status !== 'DRAFT' ? `/surveys/${id}/results${dept ? `?department=${encodeURIComponent(dept)}` : ''}` : null
  );
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [done, setDone] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      survey.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  if (survey.loading && !survey.data) return <Spinner />;
  if (!survey.data) return <ErrorNote error={survey.error ?? 'Survey not found'} />;
  const s = survey.data;
  const canAnswer = s.status === 'OPEN' && s.responded === false && s.acceptingResponses !== false && !done;
  const showForm = canAnswer && (!isCompanyAdmin || answering);

  return (
    <div className="max-w-4xl">
      <Link href="/surveys" className="mb-3 inline-block text-sm text-slate-500 hover:text-indigo-600">
        ← Surveys
      </Link>
      <PageHeader
        title={s.title}
        subtitle={`${s.anonymous ? 'Anonymous' : 'Named'} · ${s.questions.length} questions${s.closesOn ? ` · closes ${fmtDate(s.closesOn)}` : ''}`}
        actions={
          isCompanyAdmin && (
            <>
              <Badge tone={s.status === 'OPEN' ? 'green' : s.status === 'CLOSED' ? 'blue' : 'slate'}>{label(s.status)}</Badge>
              {s.status === 'DRAFT' && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      confirm('Delete this survey?') &&
                      void api(`/surveys/${id}`, { method: 'DELETE' })
                        .then(() => router.replace('/surveys'))
                        .catch((err: unknown) => setError(errMsg(err)))
                    }
                  >
                    Delete
                  </Button>
                  <Button onClick={() => confirm('Open the survey? Everyone will be notified and questions get locked.') && void act(() => api(`/surveys/${id}/open`, { method: 'POST' }))}>
                    Open survey
                  </Button>
                </>
              )}
              {s.status === 'OPEN' && (
                <>
                  {canAnswer && !answering && (
                    <Button variant="secondary" onClick={() => setAnswering(true)}>
                      Answer it myself
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => confirm('Close the survey?') && void act(() => api(`/surveys/${id}/close`, { method: 'POST' }))}>
                    Close
                  </Button>
                </>
              )}
            </>
          )
        }
      />
      {s.description && <p className="-mt-3 mb-4 whitespace-pre-line text-sm text-slate-600">{s.description}</p>}
      <ErrorNote error={error} />

      {(done || (s.responded && !isCompanyAdmin)) && (
        <Card className="p-6 text-center text-sm text-emerald-700">Thank you — your response has been recorded.</Card>
      )}
      {showForm && (
        <AnswerForm
          survey={s}
          onDone={() => {
            setDone(true);
            setAnswering(false);
          }}
        />
      )}
      {!isCompanyAdmin && s.status !== 'OPEN' && <Card className="p-6 text-center text-sm text-slate-500">This survey is closed.</Card>}

      {isCompanyAdmin && s.status === 'DRAFT' && (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Preview</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            {s.questions.map((q) => (
              <li key={q.id}>
                {q.text} <span className="text-xs text-slate-400">({label(q.type)}{q.options ? `: ${q.options.join(' / ')}` : ''})</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {isCompanyAdmin && s.status !== 'DRAFT' && !answering && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={dept} onChange={(e) => setDept(e.target.value)} className="max-w-[240px]">
              <option value="">All departments</option>
              {results.data?.departments.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name} ({d.suppressed ? `<${results.data?.minGroupSize}` : d.responses})
                </option>
              ))}
            </Select>
          </div>
          {results.loading && !results.data ? (
            <Spinner />
          ) : !results.data ? (
            <ErrorNote error={results.error} />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Responses" value={results.data.responses} icon="users" />
                <Stat label="Eligible" value={results.data.eligible} icon="user" />
                <Stat label="Response rate" value={pct(results.data.responseRate)} icon="chart" />
              </div>
              {results.data.suppressed ? (
                <Card className="p-6 text-center text-sm text-slate-500">
                  Results are hidden until at least {results.data.minGroupSize} people have responded{dept ? ' in this department' : ''}, to protect anonymity.
                </Card>
              ) : (
                results.data.questions.map((q, i) => (
                  <Card key={q.id} className="p-5">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        {i + 1}. {q.text}
                      </p>
                      <span className="text-xs text-slate-400">{q.answered} answers</span>
                    </div>
                    {q.type === 'NPS' && (
                      <div className="mb-3 flex flex-wrap items-center gap-4">
                        <span className="text-3xl font-semibold text-indigo-700">{q.nps ?? '—'}</span>
                        <span className="text-xs text-slate-500">
                          NPS · {q.promoters} promoters · {q.passives} passives · {q.detractors} detractors
                        </span>
                      </div>
                    )}
                    {q.type === 'RATING' && (
                      <p className="mb-3 text-sm text-slate-500">
                        Average <span className="text-xl font-semibold text-indigo-700">{q.average ?? '—'}</span> / 5
                      </p>
                    )}
                    {(q.type === 'RATING' || q.type === 'NPS') && q.distribution && (
                      <BarChart data={q.distribution.map((d) => ({ label: String(d.value), value: d.count }))} height={150} />
                    )}
                    {q.type === 'CHOICE' && q.distribution && (
                      <HBarList data={q.distribution.map((d) => ({ label: String(d.value), value: d.count }))} total={q.answered} />
                    )}
                    {q.type === 'TEXT' && (
                      <div className="max-h-72 space-y-2 overflow-y-auto">
                        {!q.answers?.length && <p className="text-sm text-slate-400">No answers</p>}
                        {q.answers?.map((a, j) => (
                          <p key={j} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            {a.text}
                            {a.respondent && <span className="ml-2 text-xs text-slate-400">— {a.respondent}</span>}
                          </p>
                        ))}
                      </div>
                    )}
                  </Card>
                ))
              )}
            </>
          )}
        </div>
      )}
      {isCompanyAdmin && answering && (
        <Button variant="ghost" onClick={() => setAnswering(false)} className="mt-3">
          ← Back to results
        </Button>
      )}
    </div>
  );
}
