'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Badge, Button, Card, Empty, ErrorNote, Field, Icon, Input, PageHeader, Select, Spinner } from '@/components/ui';
import { CompanyLetterhead } from '@/components/company-letterhead';
import { IdCardDesigner } from '@/components/id-card-designer';

interface Office {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  workingDays: number;
  state: string;
  city: string;
  isMetro: boolean;
}

/** States and union territories — the state selects Professional Tax / LWF rules. */
const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

/** Metro cities for the HRA exemption (50% of basic). */
const METRO_CITIES = ['delhi', 'new delhi', 'mumbai', 'kolkata', 'chennai'];

const emptyForm = {
  name: '', latitude: '', longitude: '', radiusMeters: '200', workingDays: '', state: '', city: '', isMetro: false,
};

export default function OfficesPage() {
  const { isCompanyAdmin } = useAuth();
  const { data, loading, reload } = useFetch<Office[]>('/offices');
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isCompanyAdmin) return <Empty message="Only ADMIN / HR can manage the office location." />;

  const office = data?.[0] ?? null;

  const useMyLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setForm((f) => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) })),
      () => setError('Location permission denied — enter coordinates manually')
    );
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = {
        name: form.name,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        radiusMeters: Number(form.radiusMeters),
        // 0 = auto: the backend computes weekdays − holidays for each month.
        workingDays: Number(form.workingDays) || 0,
        state: form.state,
        city: form.city.trim(),
        isMetro: form.isMetro,
      };
      if (editing && office) await api(`/offices/${office.id}`, { method: 'PATCH', body });
      else await api('/offices', { method: 'POST', body });
      setForm(emptyForm);
      setEditing(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!office || !confirm(`Remove ${office.name}? Employees will be able to punch from anywhere.`)) return;
    await api(`/offices/${office.id}`, { method: 'DELETE' });
    setForm(emptyForm);
    setEditing(false);
    reload();
  };

  const startEdit = () => {
    if (!office) return;
    setForm({
      name: office.name,
      latitude: String(office.latitude),
      longitude: String(office.longitude),
      radiusMeters: String(office.radiusMeters),
      workingDays: office.workingDays ? String(office.workingDays) : '',
      state: office.state ?? '',
      city: office.city ?? '',
      isMetro: !!office.isMetro,
    });
    setEditing(true);
  };

  const showForm = !office || editing;

  return (
    <div>
      <PageHeader
        title="Office location"
        subtitle="One geofenced location per company — attendance check-in/out must happen within its radius"
      />

      {loading ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {office && (
            <Card className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                    <Icon name="pin" />
                  </span>
                  <div>
                    <p className="font-semibold text-ink-900">{office.name}</p>
                    <p className="text-xs text-ink-400">
                      {office.latitude.toFixed(5)}, {office.longitude.toFixed(5)}
                    </p>
                  </div>
                </div>
                <Badge tone="green">active</Badge>
              </div>
              <dl className="mt-5 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-500">City / state</dt>
                  <dd className="font-medium text-ink-800">
                    {[office.city, office.state].filter(Boolean).join(', ') || '—'}
                    {office.isMetro && (
                      <span className="ml-2">
                        <Badge tone="blue">metro</Badge>
                      </span>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Geofence radius</dt>
                  <dd className="font-medium text-ink-800">{office.radiusMeters} m</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Working days / month</dt>
                  <dd className="font-medium text-ink-800">
                    {office.workingDays ? `${office.workingDays} days (fixed)` : 'Auto — weekdays minus holidays'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Map</dt>
                  <dd>
                    <a
                      className="font-medium text-brand-600 hover:underline"
                      href={`https://www.google.com/maps?q=${office.latitude},${office.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Google Map
                    </a>
                  </dd>
                </div>
              </dl>
              <div className="mt-5 flex gap-2">
                <Button variant="secondary" onClick={startEdit}>
                  Edit
                </Button>
                <Button variant="danger" onClick={() => void remove()}>
                  Remove
                </Button>
              </div>
            </Card>
          )}

          {showForm && (
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-ink-900">
                {editing ? 'Edit office location' : 'Add your office location'}
              </h2>
              <div className="space-y-3">
                <ErrorNote error={error} />
                <Field label="Office name">
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Head Office" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="State" hint="selects Professional Tax / LWF rules">
                    <Select value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                      <option value="">Select state</option>
                      {INDIAN_STATES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="City">
                    <Input
                      value={form.city}
                      onChange={(e) => {
                        const city = e.target.value;
                        // Suggest the metro flag for the HRA metro cities; HR can still untick it.
                        setForm({ ...form, city, isMetro: METRO_CITIES.includes(city.trim().toLowerCase()) || form.isMetro });
                      }}
                      placeholder="Bengaluru"
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm text-ink-700">
                  <input type="checkbox" checked={form.isMetro} onChange={(e) => setForm({ ...form, isMetro: e.target.checked })} />
                  Metro city (50% HRA exemption — Delhi, Mumbai, Kolkata, Chennai)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Latitude">
                    <Input value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="12.9716" />
                  </Field>
                  <Field label="Longitude">
                    <Input value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="77.5946" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Geofence radius (metres)" hint="employees must be within this distance to check in">
                    <Input value={form.radiusMeters} onChange={(e) => setForm({ ...form, radiusMeters: e.target.value })} />
                  </Field>
                  <Field
                    label="Working days / month"
                    hint="leave empty for auto: days in month − weekends − holidays. Set a number (e.g. 26) for a fixed norm"
                  >
                    <Input
                      type="number"
                      min={0}
                      max={31}
                      placeholder="auto"
                      value={form.workingDays}
                      onChange={(e) => setForm({ ...form, workingDays: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={useMyLocation}>
                    <Icon name="pin" className="h-4 w-4" /> Use my location
                  </Button>
                  <Button onClick={() => void save()} disabled={busy || !form.name || !form.latitude || !form.longitude}>
                    {editing ? 'Save changes' : 'Add location'}
                  </Button>
                  {editing && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditing(false);
                        setForm(emptyForm);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )}

          {!office && !loading && (
            <Card className="flex items-center justify-center p-5">
              <p className="max-w-60 text-center text-sm text-ink-400">
                No location set — employees can currently check in from anywhere.
              </p>
            </Card>
          )}
        </div>
      )}

      <div className="mt-10">
        <h2 className="text-base font-semibold text-ink-900">Employee ID card</h2>
        <p className="mb-4 text-sm text-ink-500">
          One design for every employee&apos;s card — they see it under My profile, with their own photo and a QR code that verifies it.
        </p>
        <IdCardDesigner />
      </div>

      <div className="mt-10 max-w-3xl">
        <h2 className="text-base font-semibold text-ink-900">Company logo & letterhead</h2>
        <p className="mb-4 text-sm text-ink-500">Printed on offer letters, every other HR letter and the employee ID card.</p>
        <CompanyLetterhead />
      </div>
    </div>
  );
}
