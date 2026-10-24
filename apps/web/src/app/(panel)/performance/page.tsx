'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Avatar, Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, DatePicker } from '@/components/ui';
import { Progress } from '@/components/talent';

interface Goal {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  category: string;
  progress: number;
  weightage: number;
}

interface Feedback {
  id: string;
  fromName: string;
  fromRole: string;
  message: string;
  rating: number;
  date: string;
  fromEmployee: { id: string; name: string } | null;
}

interface TeamMember {
  employee: { id: string; name: string; designation: string; department: string; avatarColor: string };
  goals: Goal[];
  progress: number;
  overdue: number;
}

export default function PerformancePage() {
  const { session, isManagerial, isCompanyAdmin } = useAuth();
  const [tab, setTab] = useState('Goals');
  const goals = useFetch<Goal[]>(session?.employee ? '/performance/goals' : null);
  const feedback = useFetch<Feedback[]>(session?.employee ? '/performance/feedback' : null);
  const { data: directory } = useFetch<{ items: { id: string; name: string }[] }>('/employees?pageSize=100');
  const team = useFetch<TeamMember[]>(isManagerial ? '/performance/team-goals' : null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Managers set goals for direct reports only; ADMIN/HR for anyone.
  const assignable = isCompanyAdmin ? (directory?.items ?? []) : (team.data ?? []).map((m) => m.employee);

  const [goalOpen, setGoalOpen] = useState(false);
  const [goalForm, setGoalForm] = useState({ title: '', description: '', dueDate: '', category: 'General', weightage: '10', employeeId: '' });
  const [fbOpen, setFbOpen] = useState(false);
  const [fbForm, setFbForm] = useState({ employeeId: '', message: '', rating: '4', fromRole: 'Peer' });
  const [error, setError] = useState<string | null>(null);

  const createGoal = async () => {
    setError(null);
    try {
      await api('/performance/goals', {
        method: 'POST',
        body: {
          title: goalForm.title,
          description: goalForm.description,
          dueDate: goalForm.dueDate,
          category: goalForm.category,
          weightage: Number(goalForm.weightage),
          ...(goalForm.employeeId ? { employeeId: goalForm.employeeId } : {}),
        },
      });
      setGoalOpen(false);
      goals.reload();
      team.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const setProgress = async (g: Goal, progress: number) => {
    await api(`/performance/goals/${g.id}`, { method: 'PATCH', body: { progress } });
    goals.reload();
    team.reload();
  };

  const removeGoal = async (g: Goal) => {
    if (!confirm(`Delete goal "${g.title}"?`)) return;
    await api(`/performance/goals/${g.id}`, { method: 'DELETE' });
    goals.reload();
    team.reload();
  };

  const giveFeedback = async () => {
    setError(null);
    try {
      await api('/performance/feedback', {
        method: 'POST',
        body: { employeeId: fbForm.employeeId, message: fbForm.message, rating: Number(fbForm.rating), fromRole: fbForm.fromRole },
      });
      setFbOpen(false);
      setFbForm({ employeeId: '', message: '', rating: '4', fromRole: 'Peer' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div>
      <PageHeader
        title="Performance"
        subtitle="Goals and 360° feedback"
        actions={
          <>
            <Button variant="secondary" onClick={() => setFbOpen(true)}>
              Give feedback
            </Button>
            <Button
              onClick={() => {
                setGoalForm({ title: '', description: '', dueDate: '', category: 'General', weightage: '10', employeeId: '' });
                setGoalOpen(true);
              }}
            >
              + New goal
            </Button>
          </>
        }
      />
      <Tabs tabs={['Goals', ...(isManagerial ? ['Team goals'] : []), 'Feedback received']} active={tab} onChange={setTab} />

      {tab === 'Team goals' &&
        (team.loading ? (
          <Spinner />
        ) : !team.data?.length ? (
          <Card>
            <Empty message={isCompanyAdmin ? 'No employees found' : 'No direct reports'} />
          </Card>
        ) : (
          <Card className="divide-y divide-slate-100">
            {team.data.map((m) => (
              <div key={m.employee.id} className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={m.employee.name} color={m.employee.avatarColor} />
                  <div className="min-w-[160px] flex-1">
                    <p className="text-sm font-medium text-slate-900">{m.employee.name}</p>
                    <p className="text-xs text-slate-400">{m.employee.designation}</p>
                  </div>
                  <span className="text-xs text-slate-500">{m.goals.length} goals</span>
                  {m.overdue > 0 && <Badge tone="red">{m.overdue} overdue</Badge>}
                  <Progress value={m.progress} className="w-40" />
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setError(null);
                      setGoalForm({ title: '', description: '', dueDate: '', category: 'General', weightage: '10', employeeId: m.employee.id });
                      setGoalOpen(true);
                    }}
                  >
                    + Goal
                  </Button>
                  <Button variant="ghost" onClick={() => setExpanded(expanded === m.employee.id ? null : m.employee.id)}>
                    {expanded === m.employee.id ? 'Hide' : 'Details'}
                  </Button>
                </div>
                {expanded === m.employee.id && (
                  <div className="mt-3 space-y-2 pl-12">
                    {!m.goals.length && <p className="text-sm text-slate-400">No goals yet</p>}
                    {m.goals.map((g) => (
                      <div key={g.id} className="flex items-center gap-3 text-sm">
                        <span className="flex-1 text-slate-700">
                          {g.title} <span className="text-xs text-slate-400">· {g.weightage}% · due {fmtDate(g.dueDate)}</span>
                        </span>
                        <Progress value={g.progress} className="w-40" />
                        <Button variant="ghost" onClick={() => void removeGoal(g)}>
                          Delete
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Card>
        ))}

      {tab === 'Goals' &&
        (goals.loading ? (
          <Spinner />
        ) : !goals.data || goals.data.length === 0 ? (
          <Card>
            <Empty message="No goals yet — add one to get started" />
          </Card>
        ) : (
          <div className="space-y-3">
            {goals.data.map((g) => (
              <Card key={g.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-slate-900">{g.title}</h2>
                      <Badge tone="slate">{g.category}</Badge>
                      <Badge tone="blue">{g.weightage}%</Badge>
                    </div>
                    {g.description && <p className="mt-1 text-sm text-slate-500">{g.description}</p>}
                    <p className="mt-1 text-xs text-slate-400">Due {fmtDate(g.dueDate)}</p>
                  </div>
                  <span className="text-lg font-semibold text-indigo-700">{Math.round(g.progress * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  defaultValue={Math.round(g.progress * 100)}
                  onMouseUp={(e) => void setProgress(g, Number((e.target as HTMLInputElement).value) / 100)}
                  onTouchEnd={(e) => void setProgress(g, Number((e.target as HTMLInputElement).value) / 100)}
                  className="mt-3 w-full accent-indigo-600"
                />
              </Card>
            ))}
          </div>
        ))}

      {tab === 'Feedback received' &&
        (feedback.loading ? (
          <Spinner />
        ) : !feedback.data || feedback.data.length === 0 ? (
          <Card>
            <Empty message="No feedback received yet" />
          </Card>
        ) : (
          <div className="space-y-3">
            {feedback.data.map((f) => (
              <Card key={f.id} className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-900">
                    {f.fromEmployee?.name ?? f.fromName} <span className="font-normal text-slate-400">· {f.fromRole}</span>
                  </p>
                  <span className="text-amber-500">{'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{f.message}</p>
                <p className="mt-1 text-xs text-slate-400">{fmtDate(f.date)}</p>
              </Card>
            ))}
          </div>
        ))}

      <Modal title="New goal" open={goalOpen} onClose={() => setGoalOpen(false)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Title">
            <Input value={goalForm.title} onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea value={goalForm.description} onChange={(e) => setGoalForm({ ...goalForm, description: e.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Due date">
              <DatePicker value={goalForm.dueDate} onChange={(v) => setGoalForm({ ...goalForm, dueDate: v })} />
            </Field>
            <Field label="Category">
              <Input value={goalForm.category} onChange={(e) => setGoalForm({ ...goalForm, category: e.target.value })} />
            </Field>
            <Field label="Weightage %">
              <Input type="number" value={goalForm.weightage} onChange={(e) => setGoalForm({ ...goalForm, weightage: e.target.value })} />
            </Field>
          </div>
          {isManagerial && (
            <Field label="Assign to (optional)">
              <Select value={goalForm.employeeId} onChange={(e) => setGoalForm({ ...goalForm, employeeId: e.target.value })}>
                <option value="">Myself</option>
                {assignable.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button onClick={() => void createGoal()} disabled={!goalForm.title || !goalForm.dueDate} className="w-full">
            Create goal
          </Button>
        </div>
      </Modal>

      <Modal title="Give 360° feedback" open={fbOpen} onClose={() => setFbOpen(false)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="About">
            <Select value={fbForm.employeeId} onChange={(e) => setFbForm({ ...fbForm, employeeId: e.target.value })}>
              <option value="">— select employee —</option>
              {directory?.items
                .filter((emp) => emp.id !== session?.employee?.id)
                .map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Your role">
              <Select value={fbForm.fromRole} onChange={(e) => setFbForm({ ...fbForm, fromRole: e.target.value })}>
                {['Peer', 'Manager', 'Report', 'Stakeholder'].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
            <Field label="Rating (1–5)">
              <Input type="number" min={1} max={5} value={fbForm.rating} onChange={(e) => setFbForm({ ...fbForm, rating: e.target.value })} />
            </Field>
          </div>
          <Field label="Message">
            <Textarea value={fbForm.message} onChange={(e) => setFbForm({ ...fbForm, message: e.target.value })} />
          </Field>
          <Button onClick={() => void giveFeedback()} disabled={!fbForm.employeeId || fbForm.message.length < 3} className="w-full">
            Send feedback
          </Button>
        </div>
      </Modal>
    </div>
  );
}
