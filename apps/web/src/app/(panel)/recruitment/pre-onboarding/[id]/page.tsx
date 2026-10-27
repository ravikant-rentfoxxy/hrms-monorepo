'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea } from '@/components/ui';
import { errMsg, label } from '@/components/talent';
import { EMPLOYMENT_TYPES, StatusBadge, money, useDirectory, ymd } from '@/components/recruitment';

interface Doc {
  id: string;
  type: string;
  name: string;
  required: boolean;
  status: string;
  remarks: string;
  fileName: string;
  hasFile: boolean;
  submittedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: { name: string } | null;
}

interface PreJoining {
  id: string;
  status: string;
  expectedJoiningDate: string;
  confirmedJoiningDate: string | null;
  instructions: string;
  bgvRequired: boolean;
  bgvStatus: string;
  bgvVendor: string;
  bgvNotes: string;
  bgvCompletedAt: string | null;
  joinedAt: string | null;
  blockers: string[];
  documents: Doc[];
  application: {
    id: string;
    code: string | null;
    stage: string;
    candidate: { id: string; code: string | null; name: string; email: string; phone: string };
    job: { id: string; code: string | null; title: string; department: string; location: string; hiringManagerId: string | null };
    hiringManager: { id: string; name: string } | null;
    offer: { id: string; code: string | null; designation: string; ctcAnnual: number; employmentType: string; probationMonths: number; noticePeriodDays: number; employeeId: string | null } | null;
    portal: { active: boolean; expiresAt: string | null };
  };
}

const DOC_TYPES = ['ID_PROOF', 'ADDRESS_PROOF', 'PAN', 'AADHAAR', 'PHOTO', 'EDUCATION', 'EXPERIENCE', 'RELIEVING', 'PAYSLIPS', 'BANK', 'OTHER'];

export default function PreJoiningPage() {
  const { id } = useParams<{ id: string }>();
  const po = useFetch<PreJoining>(`/recruitment/pre-onboarding/${id}`);
  const people = useDirectory();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [rejectDoc, setRejectDoc] = useState<Doc | null>(null);
  const [remarks, setRemarks] = useState('');
  const [newDoc, setNewDoc] = useState({ type: 'OTHER', name: '', required: 'true' });
  const [bgv, setBgv] = useState({ bgvRequired: 'false', bgvStatus: 'NOT_REQUIRED', bgvVendor: '', bgvNotes: '' });
  const [instructions, setInstructions] = useState('');
  const [joinDate, setJoinDate] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [join, setJoin] = useState({
    joiningDate: '', role: 'EMPLOYEE', managerId: '', departmentId: '', designationId: '', gradeId: '', officeId: '', shiftId: '',
    employmentType: 'Full-time', probationMonths: '6', noticePeriodDays: '30', ctcAnnual: '', assetIds: [] as string[],
  });
  const masters = {
    departments: useFetch<{ id: string; name: string }[]>(modal === 'join' ? '/masters/departments' : null).data ?? [],
    designations: useFetch<{ id: string; name: string }[]>(modal === 'join' ? '/masters/designations' : null).data ?? [],
    grades: useFetch<{ id: string; name: string }[]>(modal === 'join' ? '/masters/grades' : null).data ?? [],
    offices: useFetch<{ id: string; name: string }[]>(modal === 'join' ? '/offices' : null).data ?? [],
    shifts: useFetch<{ id: string; name: string }[]>(modal === 'join' ? '/shifts' : null).data ?? [],
    assets: useFetch<{ id: string; tag: string; name: string; category: string }[]>(modal === 'join' ? '/assets?status=AVAILABLE' : null).data ?? [],
  };

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await fn();
      setModal(null);
      setRejectDoc(null);
      after?.();
      po.reload();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  // Open the tab during the click (browsers block window.open after an await), then point it at the file.
  const openUrl = async (path: string) => {
    setError(null);
    const tab = window.open('', '_blank');
    try {
      const { url } = await api<{ url: string }>(path);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      tab?.close();
      setError(errMsg(err));
    }
  };

  const upload = (doc: Doc, file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    void run(() => api(`/recruitment/pre-onboarding/${id}/documents/${doc.id}/upload`, { method: 'POST', form: fd }));
  };

  if (po.loading && !po.data) return <Spinner />;
  if (!po.data) return <ErrorNote error={po.error ?? 'Not found'} />;
  const p = po.data;
  const open = !['JOINED', 'CANCELLED'].includes(p.status);
  const offer = p.application.offer;

  const openJoin = () => {
    setJoin({
      joiningDate: ymd(p.confirmedJoiningDate ?? p.expectedJoiningDate), role: 'EMPLOYEE', managerId: p.application.hiringManager?.id ?? '',
      departmentId: '', designationId: '', gradeId: '', officeId: '', shiftId: '', employmentType: offer?.employmentType ?? 'Full-time',
      probationMonths: String(offer?.probationMonths ?? 6), noticePeriodDays: String(offer?.noticePeriodDays ?? 30),
      ctcAnnual: String(offer?.ctcAnnual ?? ''), assetIds: [],
    });
    setError(null);
    setModal('join');
  };

  const confirmJoin = () =>
    run(async () => {
      const r = await api<{ employee: { id: string; employeeCode: string }; loginEmail: string; jobFilled: boolean; warnings: string[] }>(
        `/recruitment/pre-onboarding/${id}/join`,
        {
          method: 'POST',
          body: {
            joiningDate: join.joiningDate || undefined,
            role: join.role,
            managerId: join.managerId || null,
            departmentId: join.departmentId || null,
            designationId: join.designationId || null,
            gradeId: join.gradeId || null,
            officeId: join.officeId || null,
            shiftId: join.shiftId || null,
            employmentType: join.employmentType,
            probationMonths: Number(join.probationMonths) || 0,
            noticePeriodDays: Number(join.noticePeriodDays) || 0,
            ...(Number(join.ctcAnnual) ? { ctcAnnual: Number(join.ctcAnnual) } : {}),
            assetIds: join.assetIds,
          },
        }
      );
      setNotice(
        `${p.application.candidate.name} joined as ${r.employee.employeeCode}. They sign in with ${r.loginEmail} and set their password using ` +
          `“Forgot password” on the login screen. The onboarding checklist has started.` +
          (r.jobFilled ? ' All openings are filled — the job is marked filled.' : '') +
          (r.warnings.length ? ` ⚠ ${r.warnings.join(' ')}` : '')
      );
    });

  return (
    <div>
      <Link href={`/recruitment/applications/${p.application.id}`} className="mb-3 inline-block text-sm text-ink-500 hover:text-brand-600">
        ← Application {p.application.code}
      </Link>
      <PageHeader
        title={`Pre-joining · ${p.application.candidate.name}`}
        subtitle={[offer?.designation ?? p.application.job.title, p.application.job.code, offer?.code].filter(Boolean).join(' · ')}
        actions={
          open && (
            <>
              <Button variant="secondary" onClick={() => { setCancelReason(''); setError(null); setModal('cancel'); }}>
                Candidate not joining
              </Button>
              <Button onClick={openJoin} disabled={p.status !== 'READY_TO_JOIN'}>
                Confirm joining
              </Button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-ink-500">
        <StatusBadge status={p.status} />
        <span>
          Joining {fmtDate(p.confirmedJoiningDate ?? p.expectedJoiningDate)} ({p.confirmedJoiningDate ? 'confirmed' : 'expected'})
        </span>
        <span>· Portal link {p.application.portal.active ? `active until ${fmtDate(p.application.portal.expiresAt)}` : 'not active — create one on the application'}</span>
        {offer?.employeeId && (
          <Link href={`/employees/${offer.employeeId}`} className="font-medium text-brand-600">
            · Employee profile →
          </Link>
        )}
      </div>
      {notice && <p className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">{notice}</p>}
      {!modal && !rejectDoc && <ErrorNote error={error} />}
      {open && p.blockers.length > 0 && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">Before joining: {p.blockers.join(' · ')}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <div className="flex items-center justify-between px-5 pt-4">
            <h2 className="text-sm font-semibold text-ink-900">Document checklist</h2>
            {open && (
              <Button variant="ghost" onClick={() => { setNewDoc({ type: 'OTHER', name: '', required: 'true' }); setError(null); setModal('doc'); }}>
                + Add document
              </Button>
            )}
          </div>
          {!p.documents.length ? (
            <Empty message="No documents requested" />
          ) : (
            <Table headers={['Document', 'Status', 'File', '']}>
              {p.documents.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <span className="font-medium">{d.name}</span>
                    <p className="text-xs text-ink-400">
                      {label(d.type)} · {d.required ? 'required' : 'optional'}
                      {open && d.status !== 'VERIFIED' && (
                        <button
                          className="ml-2 text-brand-600"
                          onClick={() => void run(() => api(`/recruitment/pre-onboarding/${id}/documents/${d.id}`, { method: 'PATCH', body: { required: !d.required } }))}
                        >
                          make {d.required ? 'optional' : 'required'}
                        </button>
                      )}
                    </p>
                  </Td>
                  <Td>
                    <StatusBadge status={d.status} />
                    {d.remarks && <p className="mt-1 text-xs text-ink-400">{d.remarks}</p>}
                    {d.verifiedBy && <p className="mt-1 text-xs text-ink-400">by {d.verifiedBy.name}</p>}
                  </Td>
                  <Td>
                    {d.hasFile ? (
                      <div className="flex items-center gap-2">
                        <span className="max-w-44 truncate text-sm text-ink-700" title={d.fileName}>
                          {d.fileName || 'Document'}
                        </span>
                        <button
                          className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
                          title="Open in a new tab"
                          onClick={() => void openUrl(`/recruitment/pre-onboarding/${id}/documents/${d.id}/file?inline=true`)}
                        >
                          View ↗
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-ink-400">Not uploaded</span>
                    )}
                    {d.submittedAt && <p className="text-xs text-ink-400">{fmtDate(d.submittedAt)}</p>}
                  </Td>
                  <Td>
                    {open && (
                      <div className="flex flex-wrap gap-1">
                        {d.status !== 'VERIFIED' && (
                          <label className="cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50">
                            Upload
                            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" className="hidden" onChange={(e) => upload(d, e.target.files?.[0])} />
                          </label>
                        )}
                        {d.hasFile && d.status !== 'VERIFIED' && (
                          <Button
                            variant="ghost"
                            onClick={() => void run(() => api(`/recruitment/pre-onboarding/${id}/documents/${d.id}/verify`, { method: 'POST', body: { decision: 'VERIFIED' } }))}
                          >
                            Verify
                          </Button>
                        )}
                        {d.hasFile && d.status !== 'REJECTED' && (
                          <Button variant="ghost" onClick={() => { setRemarks(''); setError(null); setRejectDoc(d); }}>
                            Reject
                          </Button>
                        )}
                        {d.status !== 'VERIFIED' && (
                          <Button
                            variant="ghost"
                            onClick={() => confirm(`Remove "${d.name}" from the checklist?`) && void run(() => api(`/recruitment/pre-onboarding/${id}/documents/${d.id}`, { method: 'DELETE' }))}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-900">Joining date</h2>
              {open && (
                <Button variant="ghost" onClick={() => { setJoinDate(ymd(p.confirmedJoiningDate ?? p.expectedJoiningDate)); setError(null); setModal('date'); }}>
                  {p.confirmedJoiningDate ? 'Change' : 'Confirm'}
                </Button>
              )}
            </div>
            <p className="text-sm text-ink-600">
              {fmtDate(p.confirmedJoiningDate ?? p.expectedJoiningDate)} {p.confirmedJoiningDate ? '(confirmed)' : '(not yet confirmed)'}
            </p>
          </Card>
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-900">Background verification</h2>
              {open && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setBgv({ bgvRequired: String(p.bgvRequired), bgvStatus: p.bgvStatus, bgvVendor: p.bgvVendor, bgvNotes: p.bgvNotes });
                    setError(null);
                    setModal('bgv');
                  }}
                >
                  Update
                </Button>
              )}
            </div>
            {p.bgvRequired ? (
              <div className="space-y-1 text-sm text-ink-600">
                <StatusBadge status={p.bgvStatus} />
                {p.bgvVendor && <p>Vendor: {p.bgvVendor}</p>}
                {p.bgvNotes && <p className="whitespace-pre-line text-xs text-ink-500">{p.bgvNotes}</p>}
                {p.bgvCompletedAt && <p className="text-xs text-ink-400">Cleared {fmtDate(p.bgvCompletedAt)}</p>}
              </div>
            ) : (
              <p className="text-sm text-ink-400">Not required</p>
            )}
          </Card>
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-900">Joining instructions</h2>
              {open && (
                <Button variant="ghost" onClick={() => { setInstructions(p.instructions); setError(null); setModal('instructions'); }}>
                  Edit
                </Button>
              )}
            </div>
            <p className="whitespace-pre-line text-sm text-ink-600">{p.instructions || '—'}</p>
            <p className="mt-2 text-xs text-ink-400">Shown to the candidate on their portal.</p>
          </Card>
        </div>
      </div>

      <Modal title={`Reject ${rejectDoc?.name ?? ''}`} open={!!rejectDoc} onClose={() => setRejectDoc(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="What is wrong? (shown to the candidate)">
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          <Button
            variant="danger"
            className="w-full"
            disabled={remarks.trim().length < 3}
            onClick={() =>
              rejectDoc &&
              void run(() => api(`/recruitment/pre-onboarding/${id}/documents/${rejectDoc.id}/verify`, { method: 'POST', body: { decision: 'REJECTED', remarks } }))
            }
          >
            Reject document
          </Button>
        </div>
      </Modal>

      <Modal title="Add document" open={modal === 'doc'} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Type">
            <Select value={newDoc.type} onChange={(e) => setNewDoc({ ...newDoc, type: e.target.value })}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </Select>
          </Field>
          <Field label="Name">
            <Input value={newDoc.name} onChange={(e) => setNewDoc({ ...newDoc, name: e.target.value })} placeholder="e.g. Passport" />
          </Field>
          <Field label="Required?">
            <Select value={newDoc.required} onChange={(e) => setNewDoc({ ...newDoc, required: e.target.value })}>
              <option value="true">Required</option>
              <option value="false">Optional</option>
            </Select>
          </Field>
          <Button
            className="w-full"
            disabled={newDoc.name.trim().length < 2}
            onClick={() =>
              void run(() =>
                api(`/recruitment/pre-onboarding/${id}/documents`, { method: 'POST', body: { type: newDoc.type, name: newDoc.name, required: newDoc.required === 'true' } })
              )
            }
          >
            Add
          </Button>
        </div>
      </Modal>

      <Modal title="Confirm joining date" open={modal === 'date'} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Joining date">
            <Input type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />
          </Field>
          <Button
            className="w-full"
            disabled={!joinDate}
            onClick={() => void run(() => api(`/recruitment/pre-onboarding/${id}/confirm-joining`, { method: 'POST', body: { confirmedJoiningDate: joinDate } }))}
          >
            Confirm
          </Button>
        </div>
      </Modal>

      <Modal title="Background verification" open={modal === 'bgv'} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="BGV required?">
            <Select value={bgv.bgvRequired} onChange={(e) => setBgv({ ...bgv, bgvRequired: e.target.value })}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </Select>
          </Field>
          {bgv.bgvRequired === 'true' && (
            <>
              <Field label="Status">
                <Select value={bgv.bgvStatus} onChange={(e) => setBgv({ ...bgv, bgvStatus: e.target.value })}>
                  {['PENDING', 'IN_PROGRESS', 'CLEAR', 'DISCREPANCY'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </Select>
              </Field>
              <Field label="Vendor">
                <Input value={bgv.bgvVendor} onChange={(e) => setBgv({ ...bgv, bgvVendor: e.target.value })} />
              </Field>
              <Field label="Notes">
                <Textarea value={bgv.bgvNotes} onChange={(e) => setBgv({ ...bgv, bgvNotes: e.target.value })} />
              </Field>
            </>
          )}
          <Button
            className="w-full"
            onClick={() =>
              void run(() =>
                api(`/recruitment/pre-onboarding/${id}`, {
                  method: 'PATCH',
                  body: { bgvRequired: bgv.bgvRequired === 'true', bgvStatus: bgv.bgvRequired === 'true' ? bgv.bgvStatus : 'NOT_REQUIRED', bgvVendor: bgv.bgvVendor, bgvNotes: bgv.bgvNotes },
                })
              )
            }
          >
            Save
          </Button>
        </div>
      </Modal>

      <Modal title="Joining instructions" open={modal === 'instructions'} onClose={() => setModal(null)} wide>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Textarea rows={10} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <Button className="w-full" onClick={() => void run(() => api(`/recruitment/pre-onboarding/${id}`, { method: 'PATCH', body: { instructions } }))}>
            Save & notify candidate
          </Button>
        </div>
      </Modal>

      <Modal title="Candidate not joining" open={modal === 'cancel'} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Reason">
            <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </Field>
          <Button
            variant="danger"
            className="w-full"
            disabled={cancelReason.trim().length < 3}
            onClick={() => void run(() => api(`/recruitment/pre-onboarding/${id}/cancel`, { method: 'POST', body: { reason: cancelReason } }))}
          >
            Cancel pre-joining
          </Button>
        </div>
      </Modal>

      <Modal title={`Confirm joining · ${p.application.candidate.name}`} open={modal === 'join'} onClose={() => setModal(null)} wide>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <p className="text-sm text-ink-500">
            Creates the employee (Employee ID + login with {p.application.candidate.email}), sets salary from the CTC, probation and notice, files the verified
            documents and starts the onboarding checklist.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Actual joining date">
              <Input type="date" value={join.joiningDate} onChange={(e) => setJoin({ ...join, joiningDate: e.target.value })} />
            </Field>
            <Field label="App role">
              <Select value={join.role} onChange={(e) => setJoin({ ...join, role: e.target.value })}>
                {['EMPLOYEE', 'MANAGER', 'HR'].map((r) => <option key={r} value={r}>{label(r)}</option>)}
              </Select>
            </Field>
            <Field label="Reporting manager">
              <Select value={join.managerId} onChange={(e) => setJoin({ ...join, managerId: e.target.value })}>
                <option value="">— none —</option>
                {people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Department">
              <Select value={join.departmentId} onChange={(e) => setJoin({ ...join, departmentId: e.target.value })}>
                <option value="">{p.application.job.department || '— from offer —'}</option>
                {masters.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </Field>
            <Field label="Designation">
              <Select value={join.designationId} onChange={(e) => setJoin({ ...join, designationId: e.target.value })}>
                <option value="">{offer?.designation ?? '— from offer —'}</option>
                {masters.designations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </Field>
            {/* Grades are optional — only shown once the company has set some up. */}
            {masters.grades.length > 0 && (
              <Field label="Grade (optional)">
                <Select value={join.gradeId} onChange={(e) => setJoin({ ...join, gradeId: e.target.value })}>
                  <option value="">— none —</option>
                  {masters.grades.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
              </Field>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Office">
              <Select value={join.officeId} onChange={(e) => setJoin({ ...join, officeId: e.target.value })}>
                <option value="">— none —</option>
                {masters.offices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </Field>
            <Field label="Shift">
              <Select value={join.shiftId} onChange={(e) => setJoin({ ...join, shiftId: e.target.value })}>
                <option value="">— company default —</option>
                {masters.shifts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </Field>
            <Field label="Employment type">
              <Select value={join.employmentType} onChange={(e) => setJoin({ ...join, employmentType: e.target.value })}>
                {EMPLOYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Annual CTC (₹)" hint={`Offer: ${money(offer?.ctcAnnual)}`}>
              <Input type="number" value={join.ctcAnnual} onChange={(e) => setJoin({ ...join, ctcAnnual: e.target.value })} />
            </Field>
            <Field label="Probation (months)">
              <Input type="number" min={0} value={join.probationMonths} onChange={(e) => setJoin({ ...join, probationMonths: e.target.value })} />
            </Field>
            <Field label="Notice period (days)">
              <Input type="number" min={0} value={join.noticePeriodDays} onChange={(e) => setJoin({ ...join, noticePeriodDays: e.target.value })} />
            </Field>
          </div>
          <Field label="Issue assets (available)">
            <div className="flex flex-wrap gap-1">
              {join.assetIds.map((aid) => (
                <button
                  key={aid}
                  onClick={() => setJoin({ ...join, assetIds: join.assetIds.filter((x) => x !== aid) })}
                  className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"
                >
                  {masters.assets.find((x) => x.id === aid)?.tag ?? 'Asset'} ×
                </button>
              ))}
            </div>
            <Select value="" onChange={(e) => e.target.value && setJoin({ ...join, assetIds: [...join.assetIds, e.target.value] })} className="mt-2">
              <option value="">+ add asset</option>
              {masters.assets.filter((x) => !join.assetIds.includes(x.id)).map((x) => (
                <option key={x.id} value={x.id}>{x.tag} · {x.name} ({x.category})</option>
              ))}
            </Select>
          </Field>
          <p className="text-xs text-ink-400">The new joiner sets their password with “Forgot password” on the login screen (web or app).</p>
          <Button className="w-full" onClick={() => void confirmJoin()} disabled={!join.joiningDate}>
            Create employee & mark joined
          </Button>
        </div>
      </Modal>
    </div>
  );
}
