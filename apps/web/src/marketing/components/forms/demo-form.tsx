'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Check, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { Button } from '@/marketing/components/ui/button';
import { FormField, fieldAria } from '@/marketing/components/ui/form-field';
import { Input, NativeSelect, Textarea } from '@/marketing/components/ui/input';
import { submitDemoRequest, type DemoRequest } from '@/marketing/lib/api/demo';
import { NotConfiguredError } from '@/marketing/lib/api/http';
import { COMPANY_SIZES, DEMO_MODULES } from '@/marketing/lib/content';
import { site } from '@/marketing/lib/site';
import { cn } from '@/marketing/lib/utils';
import { compact, v } from '@/marketing/lib/validation';

type Field = keyof DemoRequest;
type Errors = Partial<Record<Field, string>>;

const EMPTY: DemoRequest = {
  fullName: '',
  workEmail: '',
  phone: '',
  companyName: '',
  companySize: '',
  jobTitle: '',
  modules: [],
  preferredDate: '',
  requirements: '',
};

/** Local date as yyyy-mm-dd for the date input's min. */
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function validate(f: DemoRequest): Errors {
  return compact({
    fullName: v.required(f.fullName, 'Full name') ?? v.minLength(f.fullName, 2, 'Full name'),
    workEmail: v.workEmail(f.workEmail),
    phone: v.phone(f.phone),
    companyName: v.required(f.companyName, 'Company name'),
    companySize: f.companySize ? undefined : 'Select your company size',
    jobTitle: v.required(f.jobTitle, 'Job title'),
    modules: f.modules.length ? undefined : 'Pick at least one module',
    preferredDate: v.futureDate(f.preferredDate),
    requirements: f.requirements.length > 2000 ? 'Keep this under 2,000 characters' : undefined,
  });
}

type Status = { kind: 'idle' } | { kind: 'submitting' } | { kind: 'success' } | { kind: 'error'; message: string; notConfigured?: boolean };

/** `onClose` is set when the form sits in the demo dialog. */
export function DemoForm({ onClose }: { onClose?: () => void } = {}) {
  const [form, setForm] = React.useState<DemoRequest>(EMPTY);
  const [errors, setErrors] = React.useState<Errors>({});
  const [status, setStatus] = React.useState<Status>({ kind: 'idle' });
  const formRef = React.useRef<HTMLFormElement>(null);

  const set = <K extends Field>(key: K, value: DemoRequest[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    // Clear a field's error as soon as it's edited.
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const toggleModule = (m: string) =>
    set('modules', form.modules.includes(m) ? form.modules.filter((x) => x !== m) : [...form.modules, m]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) {
      // Move focus to the first invalid control for keyboard and screen-reader users.
      const first = Object.keys(found)[0];
      const el = formRef.current?.querySelector<HTMLElement>(first === 'modules' ? '[data-modules] button' : `#${first}`);
      el?.focus();
      return;
    }
    setStatus({ kind: 'submitting' });
    try {
      await submitDemoRequest({ ...form, workEmail: form.workEmail.trim().toLowerCase() });
      setStatus({ kind: 'success' });
    } catch (err) {
      setStatus({
        kind: 'error',
        notConfigured: err instanceof NotConfiguredError,
        message: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      });
    }
  };

  if (status.kind === 'success') {
    return (
      <div className="flex flex-col items-center py-10 text-center" role="status">
        <span className="grid size-16 place-items-center rounded-full bg-brand-50 text-brand-600 ring-8 ring-brand-50/50">
          <CheckCircle2 className="size-8" aria-hidden="true" />
        </span>
        <h2 className="mt-6 text-2xl font-bold tracking-tight text-ink-950">Request received</h2>
        <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-ink-600">
          Thanks, {form.fullName.split(' ')[0]}. We’ll contact you at <span className="font-semibold text-ink-900">{form.workEmail}</span> to confirm a
          time for your demo.
        </p>
        {onClose ? (
          <Button variant="outline" className="mt-8" onClick={onClose}>
            Close
          </Button>
        ) : (
          <Button variant="outline" asChild className="mt-8">
            <Link href="/">Back to home</Link>
          </Button>
        )}
      </div>
    );
  }

  const submitting = status.kind === 'submitting';
  const dateMin = todayIso();

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-describedby="demo-privacy" className="space-y-5">
      {status.kind === 'error' && (
        <div role="alert" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">{status.message}</p>
            {status.notConfigured ? (
              <p className="mt-1 text-rose-700">
                Your details haven’t been sent. Please email us at{' '}
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Mail className="size-3.5" aria-hidden="true" />
                  {site.contact.email}
                </span>{' '}
                to book a demo.
              </p>
            ) : (
              <p className="mt-1 text-rose-700">Your details are still here — try submitting again.</p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormField id="fullName" label="Full name" required error={errors.fullName}>
          <Input {...fieldAria('fullName', errors.fullName)} autoComplete="name" placeholder="Aarav Sharma" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
        </FormField>
        <FormField id="workEmail" label="Work email" required error={errors.workEmail}>
          <Input
            {...fieldAria('workEmail', errors.workEmail)}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="aarav@company.com"
            value={form.workEmail}
            onChange={(e) => set('workEmail', e.target.value)}
          />
        </FormField>
        <FormField id="phone" label="Phone number" required error={errors.phone}>
          <Input {...fieldAria('phone', errors.phone)} type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </FormField>
        <FormField id="jobTitle" label="Job title" required error={errors.jobTitle}>
          <Input {...fieldAria('jobTitle', errors.jobTitle)} autoComplete="organization-title" placeholder="HR Manager" value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
        </FormField>
        <FormField id="companyName" label="Company name" required error={errors.companyName}>
          <Input {...fieldAria('companyName', errors.companyName)} autoComplete="organization" placeholder="Acme Pvt Ltd" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} />
        </FormField>
        <FormField id="companySize" label="Company size" required error={errors.companySize}>
          <NativeSelect {...fieldAria('companySize', errors.companySize)} value={form.companySize} onChange={(e) => set('companySize', e.target.value)}>
            <option value="" disabled>
              Select number of employees
            </option>
            {COMPANY_SIZES.map((s) => (
              <option key={s} value={s}>
                {s} employees
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </div>

      <fieldset aria-describedby={errors.modules ? 'modules-error' : 'modules-hint'}>
        <legend className="text-sm font-medium text-ink-800">
          Interested modules<span className="ml-0.5 text-rose-600" aria-hidden="true">*</span>
        </legend>
        <div data-modules className="mt-2 flex flex-wrap gap-2">
          {DEMO_MODULES.map((m) => {
            const on = form.modules.includes(m);
            return (
              <button
                key={m}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggleModule(m)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-all',
                  on ? 'border-brand-600 bg-brand-600 text-white shadow-soft' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300'
                )}
              >
                {on && <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />}
                {m}
              </button>
            );
          })}
        </div>
        {errors.modules ? (
          <p id="modules-error" role="alert" className="mt-1.5 text-[13px] font-medium text-rose-600">
            {errors.modules}
          </p>
        ) : (
          <p id="modules-hint" className="mt-1.5 text-[13px] text-ink-500">
            Select all that apply — we’ll tailor the walkthrough.
          </p>
        )}
      </fieldset>

      <FormField id="preferredDate" label="Preferred demo date" required error={errors.preferredDate} hint="We’ll confirm an exact time by email.">
        <Input
          {...fieldAria('preferredDate', errors.preferredDate, 'hint')}
          type="date"
          min={dateMin}
          value={form.preferredDate}
          onChange={(e) => set('preferredDate', e.target.value)}
          className="sm:max-w-xs"
        />
      </FormField>

      <FormField id="requirements" label="Additional requirements" error={errors.requirements} hint="Optional — e.g. number of offices, current tools, payroll needs.">
        <Textarea
          {...fieldAria('requirements', errors.requirements, 'hint')}
          maxLength={2000}
          placeholder="Tell us about your team and what you’d like to see."
          value={form.requirements}
          onChange={(e) => set('requirements', e.target.value)}
        />
      </FormField>

      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" /> Sending request…
          </>
        ) : (
          <>
            Request My Demo <ArrowRight aria-hidden="true" />
          </>
        )}
      </Button>
      <p id="demo-privacy" className="text-center text-[13px] leading-relaxed text-ink-500">
        We use these details only to schedule and prepare your demo. We don’t sell your information or add you to marketing lists without
        consent. See our{' '}
        <Link href="#" className="font-medium text-ink-700 underline underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}
