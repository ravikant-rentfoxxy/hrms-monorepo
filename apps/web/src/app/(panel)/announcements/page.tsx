'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api, fmtDate } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Spinner, Textarea } from '@/components/ui';

interface Announcement {
  id: string;
  title: string;
  body: string;
  category: string;
  postedOn: string;
  read: boolean;
  author: { id: string; name: string } | null;
}

export default function AnnouncementsPage() {
  const { session, isCompanyAdmin } = useAuth();
  const { data, loading, reload } = useFetch<Announcement[]>('/announcements');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', category: 'General' });
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      await api('/announcements', { method: 'POST', body: form });
      setCreateOpen(false);
      setForm({ title: '', body: '', category: 'General' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const markRead = async (a: Announcement) => {
    if (a.read || !session?.employee) return;
    await api(`/announcements/${a.id}/read`, { method: 'POST' });
    reload();
  };

  const remove = async (id: string) => {
    await api(`/announcements/${id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <div>
      <PageHeader
        title="Announcements"
        actions={isCompanyAdmin ? <Button onClick={() => setCreateOpen(true)}>+ Post announcement</Button> : undefined}
      />
      {loading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <Card>
          <Empty message="No announcements yet" />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map((a) => (
            <Card key={a.id} className={`p-4 ${!a.read ? 'ring-1 ring-indigo-200' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="cursor-pointer" onClick={() => void markRead(a)}>
                  <div className="flex items-center gap-2">
                    <h2 className={`text-sm ${a.read ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>{a.title}</h2>
                    {!a.read && <Badge tone="blue">new</Badge>}
                    <Badge tone="slate">{a.category}</Badge>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{a.body}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    {a.author?.name ?? 'HR'} · {fmtDate(a.postedOn)}
                  </p>
                </div>
                {isCompanyAdmin && (
                  <Button variant="ghost" onClick={() => void remove(a.id)}>
                    Delete
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal title="Post announcement" open={createOpen} onClose={() => setCreateOpen(false)}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <Field label="Title">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Category">
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </Field>
          <Field label="Message">
            <Textarea rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </Field>
          <Button onClick={() => void create()} disabled={!form.title || !form.body} className="w-full">
            Post
          </Button>
        </div>
      </Modal>
    </div>
  );
}
