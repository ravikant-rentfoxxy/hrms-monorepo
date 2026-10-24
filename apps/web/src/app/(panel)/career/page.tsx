'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Input, PageHeader, Select, Spinner, Table, Tabs, Td } from '@/components/ui';
import { downloadFile } from '@/components/download';
import { errText, humanize } from '@/components/lifecycle';
import {
  CERT_STATUS_TONE, CareerHistory, SKILL_LEVELS, SkillLevelBadge, SkillsAndCertifications, openCertificate,
  type CertRow, type SkillRow,
} from '@/components/career';

interface MatrixRow extends SkillRow {
  employee: { id: string; name: string; employeeCode: string; department: string; designation: string };
}

interface MasterOption {
  id: string;
  name: string;
}

/** "Who knows React?" — skills search across current employees (ADMIN/HR/MANAGER). */
function SkillsMatrix({ canExport }: { canExport: boolean }) {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ q: '', level: '', department: '' });
  const { data: departments } = useFetch<MasterOption[]>('/masters/departments');
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  const { data, loading, error } = useFetch<{ items: MatrixRow[]; skills: { skill: string; people: number; experts: number; endorsed: number }[] }>(
    `/career/skills/search${qs ? `?${qs}` : ''}`
  );
  const [exportError, setExportError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...filters, q });
        }}
      >
        <Input placeholder="Skill, e.g. React" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <div className="w-44">
          <Select value={filters.level} onChange={(e) => setFilters({ ...filters, level: e.target.value })}>
            <option value="">Any level</option>
            {SKILL_LEVELS.map((l) => (
              <option key={l} value={l}>
                {humanize(l)} or above
              </option>
            ))}
          </Select>
        </div>
        {departments && departments.length > 0 && (
          <div className="w-48">
            <Select value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {canExport && (
          <Button
            variant="secondary"
            className="ml-auto"
            onClick={() => void downloadFile(`/career/skills/export${qs ? `?${qs}` : ''}`, 'skills.csv').catch((err: unknown) => setExportError(errText(err)))}
          >
            Export CSV
          </Button>
        )}
      </form>
      <ErrorNote error={error ?? exportError} />
      {data && data.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.skills.slice(0, 30).map((s) => (
            <button
              key={s.skill}
              onClick={() => {
                setQ(s.skill);
                setFilters({ ...filters, q: s.skill });
              }}
              className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
            >
              {s.skill} · {s.people}
            </button>
          ))}
        </div>
      )}
      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.items.length === 0 ? (
          <Empty message="Nobody matches — try another skill" />
        ) : (
          <Table headers={['Employee', 'Department', 'Skill', 'Level', 'Years', 'Endorsed']}>
            {data.items.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/employees/${r.employee.id}`} className="font-medium text-indigo-700 hover:underline">
                    {r.employee.name}
                  </Link>
                  <span className="block text-xs text-slate-400">{r.employee.designation}</span>
                </Td>
                <Td>{r.employee.department || '—'}</Td>
                <Td className="font-medium text-slate-800">{r.skill}</Td>
                <Td>
                  <SkillLevelBadge level={r.level} />
                </Td>
                <Td>{r.years || '—'}</Td>
                <Td>{r.endorsedByName ? <Badge tone="green">{r.endorsedByName}</Badge> : '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

/** Company-wide certifications (ADMIN/HR): filters, verify, CSV export. */
function CertificationList() {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ q: '', status: '', verified: '', internal: '' });
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  const { data, loading, error, reload } = useFetch<CertRow[]>(`/career/certifications${qs ? `?${qs}` : ''}`);
  const [actionError, setActionError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(errText(err));
    }
  };
  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...filters, q });
        }}
      >
        <Input placeholder="Certification, issuer or employee" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <div className="w-40">
          <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Any validity</option>
            <option value="VALID">Valid</option>
            <option value="EXPIRING">Expiring (30 days)</option>
            <option value="EXPIRED">Expired</option>
            <option value="NO_EXPIRY">No expiry</option>
          </Select>
        </div>
        <div className="w-40">
          <Select value={filters.verified} onChange={(e) => setFilters({ ...filters, verified: e.target.value })}>
            <option value="">Verified or not</option>
            <option value="false">Awaiting verification</option>
            <option value="true">Verified</option>
          </Select>
        </div>
        <div className="w-40">
          <Select value={filters.internal} onChange={(e) => setFilters({ ...filters, internal: e.target.value })}>
            <option value="">All sources</option>
            <option value="true">Internal courses</option>
            <option value="false">External</option>
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        <Button
          variant="secondary"
          className="ml-auto"
          onClick={() => void downloadFile(`/career/certifications/export${qs ? `?${qs}` : ''}`, 'certifications.csv').catch((err: unknown) => setActionError(errText(err)))}
        >
          Export CSV
        </Button>
      </form>
      <ErrorNote error={error ?? actionError} />
      <Card>
        {loading ? (
          <Spinner />
        ) : !data || data.length === 0 ? (
          <Empty message="No certifications found" />
        ) : (
          <Table headers={['Employee', 'Certification', 'Issued', 'Expires', 'Status', 'Verified', '']}>
            {data.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td>
                  {c.employee && (
                    <Link href={`/employees/${c.employee.id}`} className="font-medium text-indigo-700 hover:underline">
                      {c.employee.name}
                    </Link>
                  )}
                  <span className="block text-xs text-slate-400">{c.employee?.department}</span>
                </Td>
                <Td>
                  <span className="block font-medium text-slate-800">{c.name}</span>
                  <span className="block text-xs text-slate-400">{[c.issuer, c.courseId && 'internal course'].filter(Boolean).join(' · ')}</span>
                </Td>
                <Td>{c.issuedOn ? fmtDate(c.issuedOn) : '—'}</Td>
                <Td>{c.expiresOn ? fmtDate(c.expiresOn) : '—'}</Td>
                <Td>
                  <Badge tone={CERT_STATUS_TONE[c.status] ?? 'slate'}>{humanize(c.status)}</Badge>
                </Td>
                <Td>{c.verified ? <Badge tone="green">verified</Badge> : <Badge tone="amber">unverified</Badge>}</Td>
                <Td className="whitespace-nowrap text-right">
                  {c.hasFile && (
                    <Button variant="ghost" onClick={() => void act(() => openCertificate(c.id))}>
                      File
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => void act(() => api(`/career/certifications/${c.id}/verify`, { method: 'POST', body: { verified: !c.verified } }))}
                  >
                    {c.verified ? 'Unverify' : 'Verify'}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

/** Certifications expiring within 30 days (own / reports' / everyone's for HR). */
function ExpiringList() {
  const { data, loading, error } = useFetch<(CertRow & { daysLeft: number })[]>('/career/certifications/expiring?days=30');
  if (loading) return <Spinner />;
  return (
    <Card>
      <ErrorNote error={error} />
      {!data || data.length === 0 ? (
        <Empty message="Nothing expires in the next 30 days" />
      ) : (
        <Table headers={['Employee', 'Certification', 'Expires', 'Days left']}>
          {data.map((c) => (
            <tr key={c.id}>
              <Td>{c.employee?.name ?? '—'}</Td>
              <Td>
                {c.name}
                <span className="block text-xs text-slate-400">{c.issuer}</span>
              </Td>
              <Td>{c.expiresOn ? fmtDate(c.expiresOn) : '—'}</Td>
              <Td>
                <Badge tone={c.daysLeft <= 7 ? 'red' : 'amber'}>{c.daysLeft} days</Badge>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

export default function CareerPage() {
  const { session, isCompanyAdmin, isManagerial } = useAuth();
  const hasProfile = !!session?.employee;
  const tabs = [
    ...(hasProfile ? ['My skills & certifications', 'My career history'] : []),
    ...(isManagerial ? ['Skills matrix', 'Expiring'] : []),
    ...(isCompanyAdmin ? ['Certifications'] : []),
  ];
  const [tab, setTab] = useState(tabs[0] ?? '');
  return (
    <div>
      <PageHeader title="Skills & certifications" subtitle="Skill profiles, certifications and career history" />
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}
      {tab === 'My skills & certifications' && (
        <SkillsAndCertifications employeeId="me" canEdit canEndorse={false} canVerify={false} />
      )}
      {tab === 'My career history' && (
        <Card className="p-5">
          <CareerHistory employeeId="me" />
        </Card>
      )}
      {tab === 'Skills matrix' && <SkillsMatrix canExport={isCompanyAdmin} />}
      {tab === 'Expiring' && <ExpiringList />}
      {tab === 'Certifications' && <CertificationList />}
      {tabs.length === 0 && <Empty message="No employee profile on this account" />}
    </div>
  );
}
