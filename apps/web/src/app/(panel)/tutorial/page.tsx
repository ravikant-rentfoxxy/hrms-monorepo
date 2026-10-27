'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Badge, Card, Icon, PageHeader, Tabs, type IconName } from '@/components/ui';

/* ------------------------------------------------------------------------- */
/*  Content                                                                  */
/* ------------------------------------------------------------------------- */

type Actor = 'Manager' | 'HR' | 'Admin' | 'Employee' | 'Candidate' | 'System';

const ACTOR_TONE: Record<Actor, 'amber' | 'green' | 'blue' | 'slate' | 'violet' | 'red'> = {
  Manager: 'amber',
  HR: 'green',
  Admin: 'blue',
  Employee: 'slate',
  Candidate: 'violet',
  System: 'red',
};

interface Step {
  id: string;
  title: string;
  who: Actor[];
  /** Where in the portal: page link + which tab / button to use. */
  where: { href: string; label: string; hint?: string };
  /** What the user does, in order. */
  does: string[];
  /** What the system records / the status after this step. */
  result: string;
  tip?: string;
}

interface Phase {
  name: string;
  icon: IconName;
  color: string;
  steps: Step[];
}

const LIFECYCLE: Phase[] = [
  {
    name: 'Hire',
    icon: 'briefcase',
    color: 'bg-violet-500',
    steps: [
      {
        id: 'l-requisition',
        title: 'Raise a hiring requisition',
        who: ['Manager', 'HR'],
        where: { href: '/recruitment', label: 'Hiring', hint: 'Requisitions tab → “+ Hiring requisition”' },
        does: [
          'Enter job title, department, vacancies, experience, skills, location and the salary budget.',
          'Choose the reason (new position / replacement / expansion), priority and target date, then submit.',
        ],
        result: 'A requisition ID like REQ-2026-0001 is created with status “Pending approval”.',
        tip: 'If HR raises it, the HR review is skipped automatically and it goes straight to management.',
      },
      {
        id: 'l-req-approve',
        title: 'HR reviews, management approves the budget',
        who: ['HR', 'Admin'],
        where: { href: '/approvals', label: 'Approvals', hint: 'Open the request → Approve / Reject' },
        does: ['HR checks the requirement (step 1).', 'Admin / Finance approves the budget (step 2).'],
        result: 'A job opening with a unique Job ID (JOB-2026-0001) is created — status “Approved for posting”.',
        tip: 'Nobody can approve their own request.',
      },
      {
        id: 'l-posting',
        title: 'Post the job on LinkedIn, Naukri, Indeed …',
        who: ['HR'],
        where: { href: '/recruitment', label: 'Hiring', hint: 'Jobs tab → open the job → Postings → “+ Posting”' },
        does: [
          'Publish the advert on the job board, then record it here: platform, URL, external ID, posting & expiry date, cost.',
          'Move the posting Draft → Published → Active. Renew or close it later.',
        ],
        result: 'The job becomes “Open”. Every application is tracked per platform (cost per application, hires per platform).',
      },
      {
        id: 'l-candidates',
        title: 'Collect applications',
        who: ['HR', 'Employee'],
        where: { href: '/recruitment', label: 'Hiring', hint: '“+ Candidate”, or CSV import on the job page' },
        does: [
          'Add the candidate (resume, skills, experience, expected CTC, notice period) and link the posting they came from.',
          'Employees can refer friends from Careers & referrals (web) or the app.',
        ],
        result: 'Candidate ID (CAN-…) and Application ID (APP-…) are created. Duplicates are caught by email or mobile.',
      },
      {
        id: 'l-screening',
        title: 'Screen and shortlist',
        who: ['HR'],
        where: { href: '/recruitment', label: 'Hiring', hint: 'Candidates tab → open the application' },
        does: [
          'Compare the candidate with the job (match score), add notes and a rating.',
          'Shortlist, put on hold or reject. Then record the HR screening call (current/expected CTC, notice, interest).',
        ],
        result: 'Status: Applied → Shortlisted → HR screened. Every change is kept in the stage history.',
      },
      {
        id: 'l-interviews',
        title: 'Interviews',
        who: ['HR', 'Manager'],
        where: { href: '/recruitment', label: 'Hiring', hint: 'Application page → “Schedule interview”' },
        does: [
          'Pick round, type (technical / HR / managerial), mode, date & time and the interview panel.',
          'After the interview, mark attendance; each panelist submits rating + recommendation (web or app → My interviews).',
        ],
        result: 'Status: Interview scheduled → Interview completed. Add more rounds as needed.',
      },
      {
        id: 'l-selection',
        title: 'Select the candidate',
        who: ['Manager', 'HR'],
        where: { href: '/recruitment', label: 'Hiring', hint: 'Application page → Selection card' },
        does: ['Hiring manager clicks “Recommend for hire”.', 'HR proposes the CTC and joining date (warned if outside budget).'],
        result: 'Status: Selected.',
      },
      {
        id: 'l-offer',
        title: 'Offer letter',
        who: ['HR', 'Admin', 'Candidate'],
        where: { href: '/recruitment', label: 'Hiring', hint: 'Application page → “Create offer”' },
        does: [
          'HR creates the offer (designation, CTC, location, joining date, probation, notice, validity) and submits it.',
          'Admin approves it from Approvals. HR clicks “Send” — the offer PDF is generated and a candidate portal link is shown.',
          'Share the link with the candidate. On the portal they Accept, Decline or Negotiate (counter CTC).',
        ],
        result: 'Offer: Draft → Pending approval → Approved → Sent → Accepted. Pre-joining starts automatically on acceptance.',
        tip: 'Email is not connected yet — copy the portal link and send it yourself (email / WhatsApp).',
      },
      {
        id: 'l-prejoining',
        title: 'Pre-joining & documents',
        who: ['Candidate', 'HR'],
        where: { href: '/recruitment', label: 'Hiring', hint: 'Pre-joining tab → open the candidate' },
        does: [
          'The candidate uploads PAN, Aadhaar, education, experience letters, bank proof … on the portal (or HR uploads them).',
          'HR verifies or rejects each document, runs background verification if needed and confirms the joining date.',
        ],
        result: 'Status: Pre-onboarding → Documents verified → Ready to join.',
      },
    ],
  },
  {
    name: 'Join',
    icon: 'door',
    color: 'bg-sky-500',
    steps: [
      {
        id: 'l-join',
        title: 'Convert the candidate into an employee',
        who: ['HR'],
        where: { href: '/recruitment', label: 'Hiring', hint: 'Pre-joining → open → “Join”' },
        does: [
          'Confirm the actual joining date, department, designation, reporting manager, shift, probation and notice period.',
          'Optionally assign assets (laptop, ID card) in the same step.',
        ],
        result:
          'Employee ID and login are created, verified documents are filed, salary structure is set from the CTC, status “On probation”. The employee keeps a link to the job posting they were hired from.',
        tip: 'The new joiner sets their password with “Forgot password” on the login screen.',
      },
      {
        id: 'l-onboarding',
        title: 'Onboarding checklist',
        who: ['HR', 'Manager', 'Employee'],
        where: { href: '/onboarding', label: 'Onboarding' },
        does: [
          'Tasks are created automatically for HR, IT, Admin, the manager and the joiner (documents, laptop, email, ID card, policy acknowledgement, induction).',
          'Everyone ticks off their own tasks; the joiner does theirs in the app (More → Onboarding).',
        ],
        result: 'The case completes when every task is done.',
      },
      {
        id: 'l-setup',
        title: 'Policies already apply',
        who: ['System'],
        where: { href: '/shifts', label: 'Work timings', hint: 'Also Setup → Leave policies, Employees → Holidays' },
        does: ['Shift, weekly offs, holidays and leave policy apply from day one; leave is credited per policy.'],
        result: 'The employee can check in, apply leave and see holidays from the app.',
      },
    ],
  },
  {
    name: 'Work',
    icon: 'clock',
    color: 'bg-emerald-500',
    steps: [
      {
        id: 'l-daily',
        title: 'Daily work in the app',
        who: ['Employee', 'Manager'],
        where: { href: '/attendance', label: 'Attendance', hint: 'Also Leaves' },
        does: [
          'Employee: check in / out (inside the office geofence), apply leave, request regularization, submit expenses, raise tickets.',
          'Manager: approves leave, regularization, overtime and expenses from Approvals.',
        ],
        result: 'Attendance, leave and expenses feed straight into payroll at month end.',
      },
      {
        id: 'l-payroll-link',
        title: 'Monthly payroll',
        who: ['HR', 'Admin'],
        where: { href: '/payroll', label: 'Payroll runs' },
        does: ['See the Payroll tutorial tab for the full monthly flow.'],
        result: 'Payslips appear in the employee’s app; salary payment is recorded.',
      },
    ],
  },
  {
    name: 'Grow',
    icon: 'target',
    color: 'bg-amber-500',
    steps: [
      {
        id: 'l-confirmation',
        title: 'Probation confirmation',
        who: ['Manager', 'HR'],
        where: { href: '/confirmations', label: 'Confirmation' },
        does: [
          '15 days before probation ends a review is created automatically.',
          'Manager recommends Confirm / Extend / Terminate; HR approves.',
        ],
        result: 'Status: On probation → Active (confirmation letter can be generated).',
      },
      {
        id: 'l-transfer',
        title: 'Transfers & promotions',
        who: ['Manager', 'HR'],
        where: { href: '/transfers', label: 'Transfers & promotions' },
        does: ['Raise a transfer, promotion, designation / manager / location change with an effective date.', 'Approved by the manager chain and HR.'],
        result: 'Applied on the effective date and recorded in the employee’s career history.',
      },
    ],
  },
  {
    name: 'Exit',
    icon: 'logout',
    color: 'bg-rose-500',
    steps: [
      {
        id: 'l-resign',
        title: 'Resignation or separation',
        who: ['Employee', 'HR'],
        where: { href: '/exits', label: 'Exit', hint: 'Employee: app → More → Resignation' },
        does: [
          'Employee submits a resignation with reason and proposed last day — or HR initiates termination / retirement / end of contract.',
          'Manager and HR approve and confirm the last working day.',
        ],
        result: 'Exit case EXIT-2026-0001, acknowledgement letter generated, status “Serving notice”.',
      },
      {
        id: 'l-notice',
        title: 'Notice period & handover',
        who: ['Manager', 'Employee', 'HR'],
        where: { href: '/exits', label: 'Exit', hint: 'Exit case → Handover / Overview tabs' },
        does: [
          'Manager assigns handover tasks; the leaver marks them done; the manager verifies.',
          'Early release or extension requests are approved here. HR schedules the exit interview.',
        ],
        result: 'Notice served / remaining is tracked; shortfall is recovered in F&F unless waived.',
      },
      {
        id: 'l-clearance',
        title: 'Exit clearance',
        who: ['Manager', 'HR', 'Admin'],
        where: { href: '/exits', label: 'Exit', hint: 'Exit case → Clearance tab' },
        does: ['Each department (Manager, IT, Admin, Finance, HR) ticks its checklist: assets returned, access removed, loans settled, documents collected.'],
        result: 'Clearance: Pending → In progress → Completed.',
      },
      {
        id: 'l-fnf',
        title: 'Full & final settlement',
        who: ['HR', 'Admin'],
        where: { href: '/exits', label: 'Exit', hint: 'Exit case → F&F tab' },
        does: [
          'Compute F&F: unpaid salary, leave encashment, gratuity (5+ years), pending bonuses and reimbursements, minus notice recovery, loans and dues.',
          'Admin approves; HR records the payment (mode + reference) before the legal due date (2 working days).',
        ],
        result: 'F&F statement PDF is filed. Final-month salary is not paid twice by payroll.',
      },
      {
        id: 'l-archive',
        title: 'Letters, deactivation & archive',
        who: ['System', 'HR'],
        where: { href: '/exits', label: 'Exit', hint: 'Exit case → Letters & closure' },
        does: [
          'On the last day the system revokes access, moves the leaver’s team to their manager and re-routes their pending approvals to HR.',
          'Relieving and experience letters are issued. HR closes the case and records rehire eligibility.',
        ],
        result: 'Status “Separated”, profile archived (never deleted). Visible under Employees → Former employees.',
      },
      {
        id: 'l-overview',
        title: 'See the whole journey',
        who: ['HR', 'Admin'],
        where: { href: '/lifecycle', label: 'Lifecycle overview', hint: 'Or Employees → open → Lifecycle timeline' },
        does: ['Pipeline counts for all 16 stages, and a per-employee timeline from requisition to archive.'],
        result: '“Hired via LinkedIn (Job ID …) … left on … because …” — the complete story in one place.',
      },
    ],
  },
];

const PAYROLL: Phase[] = [
  {
    name: 'One-time setup',
    icon: 'settings',
    color: 'bg-ink-500',
    steps: [
      {
        id: 'p-statutory',
        title: 'Statutory settings',
        who: ['Admin'],
        where: { href: '/payroll/statutory', label: 'PF, ESI & tax settings' },
        does: [
          'Check PF (12% of basic, capped at the PF wage ceiling — default ₹15,000, change it here if the government revises it), ESI (gross ≤ ₹21,000), Professional Tax slabs per state, LWF and income-tax slabs for the year.',
          'Fill PF establishment code, ESI code, TAN and company PAN for the returns.',
        ],
        result: 'Every payroll run uses these rules. Defaults for Indian states are pre-filled.',
      },
      {
        id: 'p-offices',
        title: 'Offices & working days',
        who: ['Admin'],
        where: { href: '/offices', label: 'Offices' },
        does: ['Set each office’s state (drives PT / LWF) and metro flag (drives HRA exemption).'],
        result: 'Employees inherit PT and HRA rules from their office.',
      },
      {
        id: 'p-structure',
        title: 'Salary structures',
        who: ['HR'],
        where: { href: '/salary', label: 'Salary structures', hint: 'Components → Templates → Revisions' },
        does: [
          'Define components (Basic, HRA, conveyance, special allowance …) and templates.',
          'Set each employee’s CTC — the monthly breakup is calculated for you. Later changes go through a salary revision (with approval and automatic arrears).',
        ],
        result: 'Each employee has a monthly structure; history is kept.',
      },
    ],
  },
  {
    name: 'During the month',
    icon: 'calendar',
    color: 'bg-emerald-500',
    steps: [
      {
        id: 'p-attendance',
        title: 'Attendance & leave decide payable days',
        who: ['Employee', 'Manager'],
        where: { href: '/attendance', label: 'Attendance', hint: 'Also Leaves' },
        does: [
          'Check-ins, approved leave (paid types), holidays and weekly offs count as payable; absences and unpaid leave are Loss of Pay (LOP).',
          'Approved overtime is added to pay automatically.',
        ],
        result: 'Payable days = working days − LOP days.',
      },
      {
        id: 'p-inputs',
        title: 'One-off earnings & deductions',
        who: ['HR'],
        where: { href: '/payroll-inputs', label: 'Monthly inputs' },
        does: [
          'Add bonuses, incentives, other earnings or deductions for the month (or upload a CSV).',
          '“Import approved expenses” turns approved claims into reimbursements.',
        ],
        result: 'These lines appear on the payslip of that month.',
      },
    ],
  },
  {
    name: 'Run payroll',
    icon: 'banknote',
    color: 'bg-brand-500',
    steps: [
      {
        id: 'p-create',
        title: '1. Create the run (Draft)',
        who: ['HR'],
        where: { href: '/payroll', label: 'Payroll runs', hint: 'Payroll runs tab → “New run”' },
        does: ['Pick the month (optionally override working days).'],
        result:
          'Draft payslips for every eligible employee: pro-rated earnings, PF, ESI, PT, LWF, TDS, loan EMIs and inputs. Recalculate as often as needed.',
      },
      {
        id: 'p-review',
        title: '2. Review & lock',
        who: ['HR'],
        where: { href: '/payroll', label: 'Payroll runs', hint: 'Open the run → “Lock for review”' },
        does: ['Check totals, LOP days, variance vs last month, missing bank details; drill into any payslip.'],
        result: 'Status: Under review — figures can no longer change.',
      },
      {
        id: 'p-approve',
        title: '3. Management approval',
        who: ['Admin'],
        where: { href: '/payroll', label: 'Payroll runs', hint: 'Open the run → “Approve payroll”' },
        does: ['Admin / Finance signs off (or sends it back to draft for corrections).'],
        result: 'Status: Approved.',
      },
      {
        id: 'p-publish',
        title: '4. Publish payslips',
        who: ['HR'],
        where: { href: '/payroll', label: 'Payroll runs', hint: 'Open the run → “Publish payslips”' },
        does: ['Publish — employees can now see and download payslips in the app and web.'],
        result: 'Loan EMIs are posted, payroll inputs are marked used. Published payslips are final (corrections go into next month).',
      },
      {
        id: 'p-pay',
        title: '5. Pay salaries',
        who: ['HR', 'Admin'],
        where: { href: '/payroll', label: 'Payroll runs', hint: 'Run page → Downloads → Bank transfer file' },
        does: [
          'Download the bank transfer file and upload it to your bank.',
          'Click “Record salary payment” with the UTR / reference, mode and date.',
        ],
        result: 'Status: Salary paid. Employees are told their salary is credited.',
      },
      {
        id: 'p-returns',
        title: '6. Statutory returns',
        who: ['HR'],
        where: { href: '/payroll', label: 'Payroll runs', hint: 'Run page → Downloads' },
        does: ['Download PF ECR (upload to EPFO), ESI return, PT summary and the payroll register.'],
        result: 'Ready for monthly filing and accounts.',
      },
    ],
  },
  {
    name: 'Employee side',
    icon: 'user',
    color: 'bg-sky-500',
    steps: [
      {
        id: 'p-payslip',
        title: 'Payslips, tax & Form 16',
        who: ['Employee'],
        where: { href: '/payroll', label: 'Payroll runs', hint: 'Or the app → Payroll tab / My tax' },
        does: ['View or download payslips, see the live tax projection and download Form 16 (Part B) after the year.'],
        result: 'Self-service — no HR request needed.',
      },
    ],
  },
];

/* ------------------------------------------------------------------------- */
/*  Progress (per viewer, browser only)                                      */
/* ------------------------------------------------------------------------- */

const PROGRESS_KEY = 'hrms.tutorial.done';

function readProgress(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeProgress(done: Set<string>): void {
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify([...done]));
  } catch {
    // Private mode / blocked storage: progress just isn't remembered.
  }
}

/* ------------------------------------------------------------------------- */
/*  UI                                                                       */
/* ------------------------------------------------------------------------- */

function PhaseStrip({ phases, done }: { phases: Phase[]; done: Set<string> }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      {phases.map((p, i) => {
        const total = p.steps.length;
        const finished = p.steps.filter((s) => done.has(s.id)).length;
        return (
          <div key={p.name} className="flex items-center gap-2">
            <a
              href={`#phase-${i}`}
              className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-700 shadow-sm hover:border-brand-300"
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-lg text-white ${p.color}`}>
                <Icon name={p.icon} className="h-3.5 w-3.5" />
              </span>
              {p.name}
              <span className="text-xs text-ink-400">
                {finished}/{total}
              </span>
            </a>
            {i < phases.length - 1 && <span className="text-ink-300">→</span>}
          </div>
        );
      })}
    </div>
  );
}

function StepCard({
  step,
  number,
  isDone,
  onToggle,
}: {
  step: Step;
  number: number;
  isDone: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative pl-12">
      <button
        onClick={onToggle}
        title={isDone ? 'Mark as not done' : 'Mark as done'}
        className={`absolute left-0 top-4 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ring-4 ring-[var(--bg)] transition-colors ${
          isDone ? 'bg-emerald-500 text-white' : 'bg-white text-ink-500 ring-offset-0 border border-ink-300 hover:border-brand-400'
        }`}
      >
        {isDone ? '✓' : number}
      </button>
      <Card className={`p-4 transition-opacity ${isDone ? 'opacity-70' : ''}`}>
        <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpen(!open)}>
          <div>
            <p className="text-[15px] font-semibold text-ink-900">{step.title}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {step.who.map((w) => (
                <Badge key={w} tone={ACTOR_TONE[w]}>
                  {w}
                </Badge>
              ))}
              <span className="text-xs text-ink-400">· {step.where.hint ?? step.where.label}</span>
            </div>
          </div>
          <span className="text-xs font-medium text-brand-600">{open ? 'Hide' : 'How to'}</span>
        </button>

        {open && (
          <div className="mt-4 space-y-3 border-t border-ink-100 pt-4">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-700">
              {step.does.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ol>
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <span className="font-semibold">Result: </span>
              {step.result}
            </div>
            {step.tip && (
              <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <span className="font-semibold">Tip: </span>
                {step.tip}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={step.where.href}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
              >
                Open {step.where.label} →
              </Link>
              <button
                onClick={onToggle}
                className="rounded-xl border border-ink-200 px-3.5 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
              >
                {isDone ? 'Mark as not done' : 'Mark as done'}
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Flow({ phases, done, toggle }: { phases: Phase[]; done: Set<string>; toggle: (id: string) => void }) {
  // Steps are numbered continuously across phases.
  const firstNumber = phases.map((_, i) => phases.slice(0, i).reduce((sum, p) => sum + p.steps.length, 0) + 1);
  return (
    <div className="space-y-8">
      {phases.map((p, i) => (
        <section key={p.name} id={`phase-${i}`} className="scroll-mt-24">
          <div className="mb-3 flex items-center gap-2">
            <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-white ${p.color}`}>
              <Icon name={p.icon} className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold text-ink-900">{p.name}</h2>
          </div>
          <div className="relative space-y-3 before:absolute before:bottom-4 before:left-4 before:top-4 before:w-px before:bg-ink-200">
            {p.steps.map((s, j) => (
              <StepCard key={s.id} step={s} number={firstNumber[i]! + j} isDone={done.has(s.id)} onToggle={() => toggle(s.id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PayrollExample() {
  return (
    <Card className="mb-6 p-5">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">How one payslip is calculated (example)</p>
      <div className="grid gap-4 text-sm md:grid-cols-3">
        <div>
          <p className="font-semibold text-ink-900">1 · Payable days</p>
          <p className="mt-1 text-ink-600">22 working days in the month, 2 days absent (LOP).</p>
          <p className="mt-1 font-mono text-xs text-ink-500">payable = 22 − 2 = 20 days</p>
        </div>
        <div>
          <p className="font-semibold text-ink-900">2 · Earnings (pro-rated)</p>
          <p className="mt-1 text-ink-600">Monthly gross ₹45,000 (Basic ₹22,500).</p>
          <p className="mt-1 font-mono text-xs text-ink-500">₹45,000 × 20 / 22 = ₹40,909</p>
          <p className="font-mono text-xs text-ink-500">+ bonus / overtime / reimbursements</p>
        </div>
        <div>
          <p className="font-semibold text-ink-900">3 · Deductions</p>
          <p className="mt-1 font-mono text-xs text-ink-500">PF 12% of earned basic (capped at the PF wage ceiling, default ₹15,000)</p>
          <p className="font-mono text-xs text-ink-500">ESI only if gross ≤ ₹21,000</p>
          <p className="font-mono text-xs text-ink-500">PT by state slab · TDS by yearly projection</p>
          <p className="font-mono text-xs text-ink-500">loan EMI · other deductions</p>
        </div>
      </div>
      <p className="mt-4 rounded-xl bg-ink-50 px-3 py-2 text-sm text-ink-600">
        <span className="font-semibold text-ink-800">Net pay</span> = earnings − deductions. Employer PF / ESI are shown separately
        on the payslip and in the run’s employer cost.
      </p>
    </Card>
  );
}

const DEMO_LOGINS: { role: Actor; email: string; use: string }[] = [
  { role: 'Admin', email: 'arjun@nimbus.test', use: 'Approve requisitions, offers, payroll and F&F' },
  { role: 'HR', email: 'kavya@nimbus.test', use: 'Recruitment, joining, payroll runs, exits' },
  { role: 'Manager', email: 'vikram@nimbus.test', use: 'Approvals inbox, interviews, handover' },
  { role: 'Employee', email: 'priya@nimbus.test', use: 'Payslips, leave, tax declaration (app)' },
];

function DemoLogins() {
  return (
    <Card className="mb-6 p-5">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Try it with the demo company</p>
      <p className="mb-3 text-sm text-ink-600">
        Company <span className="font-semibold">Nimbus Technologies</span> has sample data at every stage. Password{' '}
        <span className="font-mono">Admin@12345</span> for the Admin, <span className="font-mono">Employee@123</span> for everyone else.
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {DEMO_LOGINS.map((d) => (
          <div key={d.email} className="rounded-xl border border-ink-200 p-3">
            <Badge tone={ACTOR_TONE[d.role]}>{d.role}</Badge>
            <p className="mt-1.5 font-mono text-xs text-ink-800">{d.email}</p>
            <p className="mt-1 text-xs text-ink-500">{d.use}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

const TABS = ['Employee lifecycle', 'Payroll'] as const;

export default function TutorialPage() {
  const { session } = useAuth();
  const router = useRouter();
  const isEmployee = session?.role === 'EMPLOYEE';
  useEffect(() => {
    // The tutorial is for HR, managers and admins only.
    if (isEmployee) router.replace('/dashboard');
  }, [isEmployee, router]);

  if (isEmployee) return null;
  return <Tutorial />;
}

function Tutorial() {
  const [tab, setTab] = useState<string>(TABS[0]);
  const [done, setDone] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    // Progress lives in this browser only; read it after mount (no localStorage during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDone(readProgress());
  }, []);

  const toggle = (id: string) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeProgress(next);
      return next;
    });
  };

  const phases = tab === 'Payroll' ? PAYROLL : LIFECYCLE;
  const { total, finished } = useMemo(() => {
    const ids = phases.flatMap((p) => p.steps.map((s) => s.id));
    return { total: ids.length, finished: ids.filter((id) => done.has(id)).length };
  }, [phases, done]);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Tutorial"
        subtitle="Step-by-step guides: who does what, where to click, and what happens next."
      />
      <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />

      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold text-ink-900">
              {tab === 'Payroll' ? 'Monthly payroll, from setup to salary paid' : 'From hiring request to archived employee'}
            </p>
            <p className="mt-0.5 text-sm text-ink-500">
              Open a step to see how it works, then jump straight to that page. Tick steps off as you try them.
            </p>
          </div>
          <div className="min-w-[180px]">
            <div className="mb-1 flex justify-between text-xs text-ink-500">
              <span>Your progress</span>
              <span>
                {finished}/{total}
              </span>
            </div>
            <div className="h-2 rounded-full bg-ink-100">
              <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${total ? (finished / total) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5 text-xs text-ink-500">
          <span className="mr-1">Who:</span>
          {(Object.keys(ACTOR_TONE) as Actor[]).map((a) => (
            <Badge key={a} tone={ACTOR_TONE[a]}>
              {a}
            </Badge>
          ))}
        </div>
      </Card>

      <PhaseStrip phases={phases} done={done} />
      {tab === 'Payroll' && <PayrollExample />}
      <Flow phases={phases} done={done} toggle={toggle} />

      <div className="mt-8">
        <DemoLogins />
      </div>
    </div>
  );
}
