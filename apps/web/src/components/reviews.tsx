'use client';

/** Review writing form (shared by /reviews and the cycle detail page). */
import { useEffect, useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { Badge, Button, ErrorNote, Field, Modal, Select, Spinner, Textarea } from '@/components/ui';
import { errMsg, label } from '@/components/talent';

export interface Cycle {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  selfReviewDue: string | null;
  managerReviewDue: string | null;
  ratingScale: number;
  includePeer: boolean;
  progress?: Record<string, { total: number; submitted: number }>;
}

export interface ReviewRow {
  id: string;
  type: string;
  status: string;
  rating: number | null;
  submittedAt: string | null;
  cycle: Cycle;
  employee: { id: string; name: string; designation: string; department: string };
}

interface GoalRating {
  goalId: string;
  title: string;
  rating: number;
  comment?: string;
}

interface ReviewDetail {
  id: string;
  type: string;
  status: string;
  rating: number | null;
  strengths: string;
  improvements: string;
  comments: string;
  goalRatings: GoalRating[] | null;
  canEdit: boolean;
  cycle: Cycle;
  employee: { id: string; name: string; designation: string };
  reviewer: { id: string; name: string } | null;
  goals: { id: string; title: string; description: string; progress: number; weightage: number; dueDate: string }[];
  selfReview: { rating: number | null; strengths: string; improvements: string; comments: string; goalRatings: GoalRating[] | null } | null;
}

export const cycleTone = (s: string) =>
  (({ DRAFT: 'slate', SELF_REVIEW: 'blue', MANAGER_REVIEW: 'violet', CALIBRATION: 'amber', CLOSED: 'green', PENDING: 'amber', SUBMITTED: 'green',
    PROPOSED: 'amber', APPROVED: 'blue', APPLIED: 'green' }) as Record<string, 'slate' | 'blue' | 'violet' | 'amber' | 'green'>)[s] ?? 'slate';

function RatingSelect({ value, onChange, scale, disabled }: { value: string; onChange: (v: string) => void; scale: number; disabled?: boolean }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">—</option>
      {Array.from({ length: scale }, (_, i) => scale - i).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </Select>
  );
}

/** Opens a review by id; editable when the caller is the reviewer and the phase is open. */
export function ReviewModal({ reviewId, onClose, onSaved }: { reviewId: string | null; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ rating: '', strengths: '', improvements: '', comments: '' });
  const [goalRatings, setGoalRatings] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!reviewId) return;
    let live = true;
    api<ReviewDetail>(`/reviews/${reviewId}`)
      .then((r) => {
        if (!live) return;
        setData(r);
        setError(null);
        setForm({ rating: r.rating ? String(r.rating) : '', strengths: r.strengths, improvements: r.improvements, comments: r.comments });
        setGoalRatings(Object.fromEntries((r.goalRatings ?? []).map((g) => [g.goalId, String(g.rating)])));
      })
      .catch((err: unknown) => live && setError(errMsg(err)));
    return () => {
      live = false;
      setData(null);
    };
  }, [reviewId]);

  const save = async (draft: boolean) => {
    if (!data) return;
    setError(null);
    try {
      await api(`/reviews/${data.id}/submit`, {
        method: 'POST',
        body: {
          ...(form.rating ? { rating: Number(form.rating) } : {}),
          strengths: form.strengths,
          improvements: form.improvements,
          comments: form.comments,
          goalRatings: Object.entries(goalRatings)
            .filter(([, v]) => v)
            .map(([goalId, v]) => ({ goalId, rating: Number(v) })),
          draft,
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const title = data
    ? data.type === 'SELF'
      ? `Self review — ${data.cycle.name}`
      : `${label(data.type)} review: ${data.employee.name}`
    : 'Review';
  const ro = !data?.canEdit;
  const scale = data?.cycle.ratingScale ?? 5;

  return (
    <Modal title={title} open={!!reviewId} onClose={onClose} wide>
      {!data ? (
        error ? <ErrorNote error={error} /> : <Spinner />
      ) : (
        <div className="space-y-4">
          <ErrorNote error={error} />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge tone={cycleTone(data.status)}>{label(data.status)}</Badge>
            <span>
              Period {fmtDate(data.cycle.periodStart)} – {fmtDate(data.cycle.periodEnd)} · rating scale 1–{scale}
            </span>
            {data.reviewer && data.type !== 'SELF' && <span>· Reviewer: {data.reviewer.name}</span>}
          </div>

          {data.selfReview && (
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Self assessment {data.selfReview.rating ? `· ${data.selfReview.rating}/${scale}` : ''}
              </p>
              {data.selfReview.strengths && <p className="text-slate-600">Strengths: {data.selfReview.strengths}</p>}
              {data.selfReview.improvements && <p className="text-slate-600">To improve: {data.selfReview.improvements}</p>}
              {data.selfReview.comments && <p className="text-slate-600">{data.selfReview.comments}</p>}
            </div>
          )}

          {data.goals.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Goals in this period</p>
              <div className="space-y-2">
                {data.goals.map((g) => {
                  const selfGoal = data.selfReview?.goalRatings?.find((x) => x.goalId === g.id);
                  return (
                    <div key={g.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-2.5">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-800">{g.title}</p>
                        <p className="text-xs text-slate-400">
                          {Math.round(g.progress * 100)}% done · weight {g.weightage}% · due {fmtDate(g.dueDate)}
                          {selfGoal ? ` · self ${selfGoal.rating}/${scale}` : ''}
                        </p>
                      </div>
                      <div className="w-20">
                        <RatingSelect
                          scale={scale}
                          value={goalRatings[g.id] ?? ''}
                          onChange={(v) => setGoalRatings({ ...goalRatings, [g.id]: v })}
                          disabled={ro}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <Field label={`Overall rating (1–${scale})`}>
            <RatingSelect scale={scale} value={form.rating} onChange={(v) => setForm({ ...form, rating: v })} disabled={ro} />
          </Field>
          <Field label="Strengths">
            <Textarea value={form.strengths} onChange={(e) => setForm({ ...form, strengths: e.target.value })} disabled={ro} />
          </Field>
          <Field label="Areas to improve">
            <Textarea value={form.improvements} onChange={(e) => setForm({ ...form, improvements: e.target.value })} disabled={ro} />
          </Field>
          <Field label="Comments">
            <Textarea value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} disabled={ro} />
          </Field>
          {data.canEdit && (
            <div className="flex gap-2">
              {data.status !== 'SUBMITTED' && (
                <Button variant="secondary" onClick={() => void save(true)} className="flex-1">
                  Save draft
                </Button>
              )}
              <Button onClick={() => void save(false)} disabled={!form.rating} className="flex-1">
                {data.status === 'SUBMITTED' ? 'Update' : 'Submit'}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
