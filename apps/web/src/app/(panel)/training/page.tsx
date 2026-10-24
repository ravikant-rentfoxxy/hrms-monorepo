'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, DatePicker, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Stat, Table, Tabs, Td, Textarea } from '@/components/ui';
import { Progress, downloadFile, errMsg, label, pct } from '@/components/talent';
import { useDirectory } from '@/components/recruitment';

interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  durationMinutes: number;
  contentUrl: string;
  mandatory: boolean;
  dueDays: number;
  isActive: boolean;
  enrolled?: number;
  completed?: number;
  completionRate?: number;
  myStatus?: string | null;
}

interface Enrollment {
  id: string;
  status: string;
  displayStatus: string;
  progress: number;
  score: number | null;
  dueDate: string | null;
  completedAt: string | null;
  course: Course;
}

interface Matrix {
  courses: { id: string; title: string; mandatory: boolean }[];
  rows: {
    employee: { id: string; name: string; employeeCode: string; department: string };
    cells: Record<string, { enrollmentId: string; status: string; progress: number; dueDate: string | null } | null>;
    assigned: number;
    completed: number;
  }[];
  summary: { assigned: number; completed: number; overdue: number; completionRate: number };
}

interface Overdue {
  id: string;
  status: string;
  progress: number;
  dueDate: string;
  daysOverdue: number;
  course: { title: string; mandatory: boolean };
  employee: { name: string; employeeCode: string; department: string };
}

const tone = (s: string) =>
  (({ ASSIGNED: 'slate', IN_PROGRESS: 'blue', COMPLETED: 'green', OVERDUE: 'red' }) as Record<string, 'slate' | 'blue' | 'green' | 'red'>)[s] ?? 'slate';

const emptyCourse = { title: '', description: '', category: 'General', durationMinutes: '60', contentUrl: '', mandatory: false, dueDays: '30', isActive: true };

export default function TrainingPage() {
  const { session, isCompanyAdmin } = useAuth();
  const tabs = [...(session?.employee ? ['My learning'] : []), 'Catalog', ...(isCompanyAdmin ? ['Completion matrix', 'Overdue'] : [])];
  const [tab, setTab] = useState(tabs[0] as string);
  const people = useDirectory();
  const departments = useMemo(() => [...new Set(people.map((p) => p.department).filter(Boolean))].sort(), [people]);
  const [dept, setDept] = useState('');

  const my = useFetch<Enrollment[]>(tab === 'My learning' ? '/training/my' : null);
  const courses = useFetch<Course[]>(tab === 'Catalog' ? `/training/courses${isCompanyAdmin ? '?includeInactive=true' : ''}` : null);
  const deptQuery = dept ? `?department=${encodeURIComponent(dept)}` : '';
  const matrix = useFetch<Matrix>(tab === 'Completion matrix' ? `/training/matrix${deptQuery}` : null);
  const overdue = useFetch<Overdue[]>(tab === 'Overdue' ? `/training/overdue${deptQuery}` : null);

  const [error, setError] = useState<string | null>(null);
  const [courseOpen, setCourseOpen] = useState<Course | 'new' | null>(null);
  const [form, setForm] = useState(emptyCourse);
  const [assignFor, setAssignFor] = useState<Course | null>(null);
  const [assign, setAssign] = useState<{ mode: 'employees' | 'departments' | 'all'; employeeIds: string[]; departments: string[]; dueDate: string }>({
    mode: 'employees', employeeIds: [], departments: [], dueDate: '',
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [completeFor, setCompleteFor] = useState<Enrollment | null>(null);
  const [score, setScore] = useState('');

  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await fn();
      after?.();
      my.reload();
      courses.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const openCourse = (c: Course | 'new') => {
    setError(null);
    setForm(
      c === 'new'
        ? emptyCourse
        : { title: c.title, description: c.description, category: c.category, durationMinutes: String(c.durationMinutes), contentUrl: c.contentUrl,
            mandatory: c.mandatory, dueDays: String(c.dueDays), isActive: c.isActive }
    );
    setCourseOpen(c);
  };

  const saveCourse = () => {
    const body = { ...form, durationMinutes: Number(form.durationMinutes) || 60, dueDays: Number(form.dueDays) || 30 };
    return act(
      () => (courseOpen === 'new' ? api('/training/courses', { method: 'POST', body }) : api(`/training/courses/${(courseOpen as Course).id}`, { method: 'PATCH', body })),
      () => setCourseOpen(null)
    );
  };

  const doAssign = () =>
    assignFor &&
    act(
      async () => {
        const r = await api<{ assigned: number; skipped: number }>(`/training/courses/${assignFor.id}/assign`, {
          method: 'POST',
          body: {
            employeeIds: assign.mode === 'employees' ? assign.employeeIds : [],
            departments: assign.mode === 'departments' ? assign.departments : [],
            all: assign.mode === 'all',
            ...(assign.dueDate ? { dueDate: assign.dueDate } : {}),
          },
        });
        setNotice(`Assigned to ${r.assigned} employee(s)${r.skipped ? `, ${r.skipped} already enrolled` : ''}.`);
      },
      () => setAssignFor(null)
    );

  const openContent = (e: Enrollment) => {
    if (e.course.contentUrl) window.open(e.course.contentUrl, '_blank', 'noopener');
    if (e.status === 'ASSIGNED') void act(() => api(`/training/enrollments/${e.id}/start`, { method: 'POST' }));
  };

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div>
      <PageHeader
        title="Learning"
        subtitle="Courses, assignments and completion"
        actions={
          <>
            {(tab === 'Completion matrix' || tab === 'Overdue') && (
              <>
                <Select value={dept} onChange={(e) => setDept(e.target.value)} className="max-w-[200px]">
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </Select>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void downloadFile(
                      `/training/${tab === 'Overdue' ? 'overdue' : 'matrix'}/export${deptQuery}`,
                      tab === 'Overdue' ? 'training-overdue.csv' : 'training-completion.csv'
                    ).catch((err: unknown) => setError(errMsg(err)))
                  }
                >
                  Export CSV
                </Button>
              </>
            )}
            {isCompanyAdmin && tab === 'Catalog' && <Button onClick={() => openCourse('new')}>+ Course</Button>}
          </>
        }
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <ErrorNote error={error} />
      {notice && (
        <p className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{notice}</p>
      )}

      {tab === 'My learning' &&
        (my.loading ? (
          <Spinner />
        ) : !my.data?.length ? (
          <Card>
            <Empty message="No courses assigned — browse the catalog to enrol" />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {my.data.map((e) => (
              <Card key={e.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-slate-900">{e.course.title}</h2>
                      {e.course.mandatory && <Badge tone="amber">Mandatory</Badge>}
                    </div>
                    <p className="text-xs text-slate-400">
                      {e.course.category} · {e.course.durationMinutes} min{e.dueDate ? ` · due ${fmtDate(e.dueDate)}` : ''}
                    </p>
                  </div>
                  <Badge tone={tone(e.displayStatus)}>{label(e.displayStatus)}</Badge>
                </div>
                {e.course.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{e.course.description}</p>}
                <Progress value={e.progress} className="mt-3" />
                {e.status !== 'COMPLETED' ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {e.course.contentUrl && (
                      <Button variant="secondary" onClick={() => openContent(e)}>
                        Open content
                      </Button>
                    )}
                    {[0.25, 0.5, 0.75].filter((p) => p > e.progress).slice(0, 1).map((p) => (
                      <Button key={p} variant="ghost" onClick={() => void act(() => api(`/training/enrollments/${e.id}/progress`, { method: 'PATCH', body: { progress: p } }))}>
                        Mark {Math.round(p * 100)}%
                      </Button>
                    ))}
                    <Button
                      onClick={() => {
                        setScore('');
                        setCompleteFor(e);
                      }}
                    >
                      Complete
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-emerald-700">
                    Completed {fmtDate(e.completedAt)}
                    {e.score !== null ? ` · score ${e.score}` : ''}
                  </p>
                )}
              </Card>
            ))}
          </div>
        ))}

      {tab === 'Catalog' && (
        <Card>
          {courses.loading ? (
            <Spinner />
          ) : !courses.data?.length ? (
            <Empty message="No courses yet" />
          ) : (
            <Table headers={['Course', 'Category', 'Duration', isCompanyAdmin ? 'Completion' : 'Status', '']}>
              {courses.data.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{c.title}</span>
                      {c.mandatory && <Badge tone="amber">Mandatory</Badge>}
                      {!c.isActive && <Badge>Retired</Badge>}
                    </div>
                    {c.description && <p className="line-clamp-1 max-w-md text-xs text-slate-400">{c.description}</p>}
                  </Td>
                  <Td>{c.category}</Td>
                  <Td>
                    {c.durationMinutes} min
                    <p className="text-xs text-slate-400">due in {c.dueDays} days</p>
                  </Td>
                  <Td>
                    {isCompanyAdmin ? (
                      <span>
                        {c.completed}/{c.enrolled} · {pct(c.completionRate)}
                      </span>
                    ) : c.myStatus ? (
                      <Badge tone={tone(c.myStatus)}>{label(c.myStatus)}</Badge>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      {isCompanyAdmin ? (
                        <>
                          <Button variant="ghost" onClick={() => openCourse(c)}>
                            Edit
                          </Button>
                          {c.isActive && (
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setError(null);
                                setNotice(null);
                                setAssign({ mode: 'employees', employeeIds: [], departments: [], dueDate: '' });
                                setAssignFor(c);
                              }}
                            >
                              Assign
                            </Button>
                          )}
                        </>
                      ) : null}
                      {session?.employee && !c.myStatus && c.isActive && (
                        <Button variant="ghost" onClick={() => void act(() => api(`/training/courses/${c.id}/enroll`, { method: 'POST' }))}>
                          Enrol
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'Completion matrix' &&
        (matrix.loading || !matrix.data ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Assignments" value={matrix.data.summary.assigned} icon="graduation" />
              <Stat label="Completed" value={matrix.data.summary.completed} icon="check" />
              <Stat label="Completion rate" value={pct(matrix.data.summary.completionRate)} icon="chart" />
              <Stat label="Overdue" value={matrix.data.summary.overdue} accent="text-rose-600" icon="clock" />
            </div>
            <Card>
              {!matrix.data.rows.length || !matrix.data.courses.length ? (
                <Empty message="No data" />
              ) : (
                <Table headers={['Employee', ...matrix.data.courses.map((c) => c.title), 'Done']}>
                  {matrix.data.rows.map((r) => (
                    <tr key={r.employee.id}>
                      <Td>
                        <p className="font-medium text-slate-900">{r.employee.name}</p>
                        <p className="text-xs text-slate-400">{r.employee.department}</p>
                      </Td>
                      {matrix.data?.courses.map((c) => {
                        const cell = r.cells[c.id];
                        return (
                          <Td key={c.id}>
                            {cell ? (
                              <span title={cell.dueDate ? `Due ${fmtDate(cell.dueDate)}` : undefined}>
                                <Badge tone={tone(cell.status)}>
                                  {cell.status === 'IN_PROGRESS' ? `${Math.round(cell.progress * 100)}%` : label(cell.status)}
                                </Badge>
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </Td>
                        );
                      })}
                      <Td>
                        {r.completed}/{r.assigned}
                      </Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>
        ))}

      {tab === 'Overdue' && (
        <Card>
          {overdue.loading ? (
            <Spinner />
          ) : !overdue.data?.length ? (
            <Empty message="Nothing overdue" />
          ) : (
            <Table headers={['Employee', 'Course', 'Progress', 'Due', 'Overdue by']}>
              {overdue.data.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <p className="font-medium text-slate-900">{o.employee.name}</p>
                    <p className="text-xs text-slate-400">
                      {o.employee.employeeCode} · {o.employee.department}
                    </p>
                  </Td>
                  <Td>
                    {o.course.title} {o.course.mandatory && <Badge tone="amber">Mandatory</Badge>}
                  </Td>
                  <Td>
                    <Progress value={o.progress} className="w-32" />
                  </Td>
                  <Td>{fmtDate(o.dueDate)}</Td>
                  <Td>
                    <span className="font-medium text-rose-600">{o.daysOverdue} days</span>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <Modal title={courseOpen === 'new' ? 'New course' : 'Edit course'} open={!!courseOpen} onClose={() => setCourseOpen(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Title">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Category">
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </Field>
            <Field label="Duration (min)">
              <Input type="number" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
            </Field>
            <Field label="Due in (days)">
              <Input type="number" value={form.dueDays} onChange={(e) => setForm({ ...form, dueDays: e.target.value })} />
            </Field>
          </div>
          <Field label="Content URL" hint="Video, document or LMS link">
            <Input placeholder="https://…" value={form.contentUrl} onChange={(e) => setForm({ ...form, contentUrl: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.mandatory} onChange={(e) => setForm({ ...form, mandatory: e.target.checked })} />
            Mandatory (auto-assigned to new joiners)
          </label>
          {courseOpen !== 'new' && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Active
            </label>
          )}
          <div className="flex gap-2">
            <Button onClick={() => void saveCourse()} disabled={form.title.length < 2} className="flex-1">
              Save
            </Button>
            {courseOpen && courseOpen !== 'new' && (
              <Button
                variant="danger"
                onClick={() =>
                  confirm('Delete this course? Courses with progress are retired instead.') &&
                  void act(async () => {
                    const r = await api<{ retired: boolean }>(`/training/courses/${(courseOpen as Course).id}`, { method: 'DELETE' });
                    setNotice(r.retired ? 'Course retired (it has learner progress on record).' : 'Course deleted.');
                  }, () => setCourseOpen(null))
                }
              >
                Delete
              </Button>
            )}
          </div>
        </div>
      </Modal>

      <Modal title={`Assign: ${assignFor?.title ?? ''}`} open={!!assignFor} onClose={() => setAssignFor(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Assign to">
            <Select value={assign.mode} onChange={(e) => setAssign({ ...assign, mode: e.target.value as 'employees' | 'departments' | 'all' })}>
              <option value="employees">Selected employees</option>
              <option value="departments">Departments</option>
              <option value="all">Everyone</option>
            </Select>
          </Field>
          {assign.mode !== 'all' && (
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
              {(assign.mode === 'employees' ? people.map((p) => ({ id: p.id, name: `${p.name}${p.department ? ` · ${p.department}` : ''}` })) : departments.map((d) => ({ id: d, name: d }))).map((o) => {
                const list = assign.mode === 'employees' ? assign.employeeIds : assign.departments;
                return (
                  <label key={o.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={list.includes(o.id)}
                      onChange={() =>
                        setAssign(
                          assign.mode === 'employees'
                            ? { ...assign, employeeIds: toggle(assign.employeeIds, o.id) }
                            : { ...assign, departments: toggle(assign.departments, o.id) }
                        )
                      }
                    />
                    {o.name}
                  </label>
                );
              })}
            </div>
          )}
          <Field label="Due date" hint={`Defaults to ${assignFor?.dueDays ?? 30} days from today`}>
            <DatePicker value={assign.dueDate} onChange={(v) => setAssign({ ...assign, dueDate: v })} />
          </Field>
          <Button
            onClick={() => void doAssign()}
            disabled={assign.mode === 'employees' ? !assign.employeeIds.length : assign.mode === 'departments' ? !assign.departments.length : false}
            className="w-full"
          >
            Assign
          </Button>
        </div>
      </Modal>

      <Modal title="Complete course" open={!!completeFor} onClose={() => setCompleteFor(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <p className="text-sm text-slate-600">{completeFor?.course.title}</p>
          <Field label="Score (optional, 0–100)">
            <Input type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} />
          </Field>
          <Button
            onClick={() =>
              completeFor &&
              void act(
                () => api(`/training/enrollments/${completeFor.id}/complete`, { method: 'POST', body: score ? { score: Number(score) } : {} }),
                () => setCompleteFor(null)
              )
            }
            className="w-full"
          >
            Mark complete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
