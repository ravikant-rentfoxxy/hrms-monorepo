/**
 * Marketing copy. Feature claims describe what this HRMS actually ships
 * (admin panel + mobile app + API) — keep them in sync with the product.
 */
import {
  BadgeCheck,
  BarChart3,
  Briefcase,
  Building2,
  CalendarCheck2,
  CalendarClock,
  ClipboardCheck,
  FileLock2,
  Fingerprint,
  GitBranch,
  HandCoins,
  Laptop,
  LogOut,
  Megaphone,
  MapPin,
  Network,
  Receipt,
  Rocket,
  Scale,
  ShieldCheck,
  Smartphone,
  Timer,
  UserPlus,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface Feature {
  icon: LucideIcon;
  title: string;
  text: string;
  points: string[];
}

export interface FeatureGroup {
  id: string;
  label: string;
  summary: string;
  features: Feature[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: 'core-hr',
    label: 'Core HR',
    summary: 'One source of truth for every employee record, document and device.',
    features: [
      {
        icon: Users,
        title: 'Employee directory & profiles',
        text: 'Complete profiles with job, reporting line, bank, statutory and identity details — sensitive numbers encrypted at rest.',
        points: ['Departments, designations & grades', 'Career history on every change', 'CSV import for bulk onboarding'],
      },
      {
        icon: FileLock2,
        title: 'Documents & letters',
        text: 'Generate offer, confirmation and experience letters on your letterhead and share files through short-lived secure links.',
        points: ['Company logo on every letter', '5-minute signed download links', 'Employee and company documents'],
      },
      {
        icon: Laptop,
        title: 'Asset management',
        text: 'Issue laptops and devices during onboarding and see who holds what, with returns handled at exit.',
        points: ['Auto-tagged asset codes', 'Issue from the onboarding checklist', 'Holder search & history'],
      },
    ],
  },
  {
    id: 'time',
    label: 'Time & Attendance',
    summary: 'Attendance that follows how people actually work — in the office, at home or in the field.',
    features: [
      {
        icon: MapPin,
        title: 'Location-aware attendance',
        text: 'Office staff check in inside the office geofence; work-from-home and field staff check in anywhere with their location captured.',
        points: ['Per-employee work mode', 'Shift-based late & half-day rules', 'Regularization with approvals'],
      },
      {
        icon: CalendarCheck2,
        title: 'Leave policy engine',
        text: 'CL, EL, SL and custom leave types with accrual, carry-forward, sandwich rules, encashment and comp-off.',
        points: ['Monthly or yearly accrual', 'Half-day & notice rules', 'Holiday calendar per company'],
      },
      {
        icon: Timer,
        title: 'Timesheets & projects',
        text: 'Daily entries with project and description, project-level access control and manager approval.',
        points: ['Project membership', 'Billable hours', 'Weekly submit & approve'],
      },
    ],
  },
  {
    id: 'payroll',
    label: 'Payroll',
    summary: 'From salary structures to published payslips, with Indian statutory compliance built in.',
    features: [
      {
        icon: Wallet,
        title: 'Payroll runs',
        text: 'A guided run — draft, lock, approve, publish, paid — with salary structures, monthly inputs and approved expense reimbursements.',
        points: ['Finance role for approvals', 'One-off earnings & deductions', 'Salary revisions with history'],
      },
      {
        icon: Scale,
        title: 'PF, ESI, PT & TDS',
        text: 'Statutory settings per company and office state, with projected annual TDS spread across the remaining months.',
        points: ['Old & new tax regime', 'Form 16 Part B', 'State-wise Professional Tax'],
      },
      {
        icon: Receipt,
        title: 'Payslips in-app & by email',
        text: 'Branded payslip PDFs employees open in the mobile app, or HR emails directly from the employee profile.',
        points: ['Company logo on payslips', 'Secure, expiring links', 'Full salary-slip history'],
      },
    ],
  },
  {
    id: 'talent',
    label: 'Hiring & Lifecycle',
    summary: 'Every stage from job requisition to final settlement, connected in one record.',
    features: [
      {
        icon: Briefcase,
        title: 'Recruitment',
        text: 'Requisitions with approval, job postings, candidate pipeline, interview panels, offers and a candidate pre-onboarding portal.',
        points: ['Guided hiring stepper', 'Interview feedback & scoring', 'Offer letters with your branding'],
      },
      {
        icon: Rocket,
        title: 'Onboarding & confirmation',
        text: 'Checklists for HR, IT, admin and the joiner — then probation reviews that move people to confirmed status.',
        points: ['Task owners & due dates', 'Asset issue from the checklist', 'Probation reminders'],
      },
      {
        icon: LogOut,
        title: 'Exits & full-and-final',
        text: 'Resignation, notice period, handover, department clearances and final settlement in one guided flow.',
        points: ['Exit interviews', 'Clearance tracking', 'Relieving & experience letters'],
      },
    ],
  },
  {
    id: 'workflow',
    label: 'Workflows & Self-service',
    summary: 'Requests, approvals and communication that run themselves.',
    features: [
      {
        icon: GitBranch,
        title: 'Approval engine',
        text: 'Multi-level approval chains for leave, attendance, expenses, travel, overtime and more — with a single approvals inbox.',
        points: ['Role or named approvers', 'Full approval timeline', 'Configurable per module'],
      },
      {
        icon: Smartphone,
        title: 'Employee mobile app',
        text: 'Employees check in, apply for leave, claim expenses, view payslips and raise helpdesk tickets from their phone.',
        points: ['Attendance with location', 'Payslips & documents', 'Announcements & kudos'],
      },
      {
        icon: Building2,
        title: 'Multi-company',
        text: 'Run several companies from one account — each with its own policies, payroll and data, fully isolated.',
        points: ['One login, many companies', 'Company switcher', 'Tenant-isolated data'],
      },
    ],
  },
];

/** Compact list for the header dropdown and footer. */
export const FEATURE_LINKS = FEATURE_GROUPS.map((g) => ({ id: g.id, label: g.label, summary: g.summary }));

export const LIFECYCLE: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Megaphone, title: 'Recruitment', text: 'Raise a requisition, get it approved and publish the job.' },
  { icon: UserPlus, title: 'Hiring', text: 'Screen candidates, run interviews and send the offer.' },
  { icon: Rocket, title: 'Onboarding', text: 'Checklists, documents, assets and day-one accounts.' },
  { icon: Users, title: 'Employee Management', text: 'Profiles, roles, transfers and promotions.' },
  { icon: CalendarClock, title: 'Attendance & Leave', text: 'Location-aware check-in and policy-driven leave.' },
  { icon: HandCoins, title: 'Payroll', text: 'Compliant payroll runs and branded payslips.' },
  { icon: BarChart3, title: 'Performance', text: 'Probation reviews, confirmations and salary revisions.' },
  { icon: LogOut, title: 'Offboarding', text: 'Handover, clearances and full-and-final settlement.' },
];

export const TRUST_POINTS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Network, title: 'Enterprise-ready architecture', text: 'Separate admin and mobile APIs, background jobs and a full audit trail.' },
  { icon: ShieldCheck, title: 'Secure employee data', text: 'Encrypted identity numbers, rate-limited sign-in and account lockout.' },
  { icon: Workflow, title: 'Automated HR workflows', text: 'Approvals, reminders and status changes that move on their own.' },
  { icon: Building2, title: 'Scalable workforce management', text: 'From one office to many companies under a single account.' },
  { icon: Fingerprint, title: 'Role-based access control', text: 'Admin, HR, Manager, Finance and Employee — each sees only what they should.' },
];

export const BENEFITS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Workflow, title: 'Reduce repetitive HR tasks', text: 'Leave accrual, reminders, approvals and payslip delivery run automatically.' },
  { icon: Users, title: 'Centralize employee information', text: 'One profile per person — documents, assets, history and pay in one place.' },
  { icon: Wallet, title: 'Simplify payroll processing', text: 'Attendance, leave and approved claims flow straight into the monthly run.' },
  { icon: BarChart3, title: 'Improve workforce visibility', text: 'Live headcount, attendance and pipeline views for every manager.' },
  { icon: ClipboardCheck, title: 'Streamline onboarding', text: 'Every joiner gets the same checklist, owners and deadlines.' },
  { icon: Smartphone, title: 'Enable employee self-service', text: 'Employees handle leave, claims and payslips themselves from the app.' },
];

export const STEPS: { title: string; text: string }[] = [
  { title: 'Set up your organization', text: 'Add your company, offices, departments, work timings and company logo.' },
  { title: 'Add employees & configure policies', text: 'Import your team, then set leave types, salary structures and statutory settings.' },
  { title: 'Automate HR workflows', text: 'Turn on approval chains, onboarding checklists and attendance rules.' },
  { title: 'Monitor everything from one dashboard', text: 'Track attendance, leave, hiring and payroll from a single view.' },
];

export const SOLUTIONS: { id: string; icon: LucideIcon; title: string; text: string; points: string[] }[] = [
  {
    id: 'small-business',
    icon: BadgeCheck,
    title: 'Small businesses',
    text: 'Get attendance, leave and payroll running in days — without an HR team of ten.',
    points: ['Guided setup & tutorials', 'Sensible default policies', 'Mobile app for every employee'],
  },
  {
    id: 'growing-teams',
    icon: Workflow,
    title: 'Growing teams',
    text: 'Add structure as you scale: multi-level approvals, hiring pipelines and role-based access.',
    points: ['Manager & Finance roles', 'Recruitment to onboarding', 'Project timesheets'],
  },
  {
    id: 'multi-company',
    icon: Building2,
    title: 'Multi-company groups',
    text: 'Run several legal entities from one account with separate policies, payroll and data.',
    points: ['Company switcher', 'Per-company statutory settings', 'Central administration'],
  },
];

export const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is an HRMS?',
    a: 'A Human Resource Management System is software that manages the whole employee lifecycle in one place — hiring, onboarding, employee records, attendance, leave, payroll, approvals and exits — instead of spreadsheets and separate tools.',
  },
  {
    q: 'Is the platform suitable for small businesses?',
    a: 'Yes. It is designed so a small team can get attendance, leave and payroll running quickly with sensible defaults and a built-in tutorial, and it grows with you as you add approval chains, hiring and more companies.',
  },
  {
    q: 'Can employees access their own information?',
    a: 'Yes. Employees use the mobile app to check in, apply for leave, claim expenses, view payslips and documents, and raise helpdesk tickets. They only ever see their own data.',
  },
  {
    q: 'Does the system support payroll?',
    a: 'Yes. Payroll runs follow a draft → lock → approve → publish → paid flow, with salary structures, monthly inputs, PF, ESI, Professional Tax and TDS, branded payslips and Form 16.',
  },
  {
    q: 'Can HR manage recruitment and onboarding?',
    a: 'Yes. HR can take a hire from requisition and job posting through interviews and offer to a pre-onboarding portal, then run an onboarding checklist that includes issuing assets.',
  },
  {
    q: 'Can the platform support multiple companies?',
    a: 'Yes. One account can run several companies, each with its own policies, payroll and fully isolated data. Users who belong to more than one company pick it when they sign in.',
  },
  {
    q: 'How can I schedule a demo?',
    a: 'Use the “Book a Demo” button to tell us about your team and the modules you are interested in, and pick a preferred date. Our team will get in touch to confirm a time.',
  },
];

export const DEMO_MODULES = [
  'Core HR',
  'Attendance',
  'Leave',
  'Payroll',
  'Recruitment',
  'Onboarding',
  'Expenses & Travel',
  'Timesheets',
  'Exits & F&F',
  'Mobile app',
] as const;

export const COMPANY_SIZES = ['1–10', '11–50', '51–200', '201–500', '501–1,000', '1,000+'] as const;

