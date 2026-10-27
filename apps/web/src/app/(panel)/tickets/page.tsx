'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Input, LongText, Modal, PageHeader, Select, Spinner, Table, Tabs, Td, Textarea, statusTone,
} from '@/components/ui';

interface Ticket {
  id: string;
  subject: string;
  category: string;
  description: string;
  status: string;
  createdOn: string;
  employee?: { id: string; name: string };
}

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

export default function TicketsPage() {
  const { session, isManagerial, isCompanyAdmin } = useAuth();
  const [tab, setTab] = useState('My tickets');
  const tabs = ['My tickets', ...(isManagerial ? ['All tickets'] : [])];
  const mine = useFetch<Ticket[]>(tab === 'My tickets' ? '/tickets?scope=me' : null);
  const all = useFetch<Ticket[]>(tab === 'All tickets' ? '/tickets?scope=company' : null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: '', category: 'IT', description: '' });
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      await api('/tickets', { method: 'POST', body: form });
      setOpen(false);
      setForm({ subject: '', category: 'IT', description: '' });
      mine.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const setStatus = async (id: string, status: string) => {
    await api(`/tickets/${id}/status`, { method: 'PATCH', body: { status } });
    all.reload();
  };

  const renderRows = (tickets: Ticket[], withEmployee: boolean) =>
    tickets.map((t) => (
      <tr key={t.id}>
        {withEmployee && <Td className="font-medium text-ink-900">{t.employee?.name}</Td>}
        <Td className="font-medium text-ink-900">{t.subject}</Td>
        <Td>
          <Badge tone="slate">{t.category}</Badge>
        </Td>
        <Td>
          <LongText text={t.description} />
        </Td>
        <Td>{fmtDate(t.createdOn)}</Td>
        <Td>
          {withEmployee && isCompanyAdmin ? (
            <Select value={t.status} onChange={(e) => void setStatus(t.id, e.target.value)} className="w-36 py-1 text-xs">
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          ) : (
            <Badge tone={statusTone(t.status)}>{t.status.replace('_', ' ')}</Badge>
          )}
        </Td>
      </tr>
    ));

  return (
    <div>
      <PageHeader
        title="Helpdesk"
        actions={session?.employee ? <Button onClick={() => setOpen(true)}>+ Raise ticket</Button> : undefined}
      />
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setTab} />}

      <Card>
        {tab === 'My tickets' ? (
          mine.loading ? (
            <Spinner />
          ) : !mine.data || mine.data.length === 0 ? (
            <Empty message="No tickets raised yet" />
          ) : (
            <Table headers={['Subject', 'Category', 'Description', 'Created', 'Status']}>{renderRows(mine.data, false)}</Table>
          )
        ) : all.loading ? (
          <Spinner />
        ) : !all.data || all.data.length === 0 ? (
          <Empty message="No tickets in the company" />
        ) : (
          <Table headers={['Employee', 'Subject', 'Category', 'Description', 'Created', 'Status']}>{renderRows(all.data, true)}</Table>
        )}
      </Card>

      <Modal title="Raise a ticket" open={open} onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Subject">
            <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {['IT', 'HR', 'Payroll', 'Facilities', 'General'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Button onClick={() => void create()} disabled={form.subject.length < 3 || form.description.length < 3} className="w-full">
            Submit ticket
          </Button>
        </div>
      </Modal>
    </div>
  );
}
