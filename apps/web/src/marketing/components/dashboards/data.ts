/**
 * Sample data for the product previews. Illustrative only — not customer
 * figures. Names are fictional.
 */
export const PEOPLE = [
  { name: 'Ananya Iyer', role: 'Product Designer', dept: 'Design', color: '#10b88a' },
  { name: 'Rohan Mehta', role: 'Backend Engineer', dept: 'Engineering', color: '#6366f1' },
  { name: 'Priya Nair', role: 'HR Business Partner', dept: 'People', color: '#f59e0b' },
  { name: 'Arjun Rao', role: 'Sales Manager', dept: 'Sales', color: '#0ea5e9' },
  { name: 'Kavya Joshi', role: 'Finance Analyst', dept: 'Finance', color: '#ec4899' },
  { name: 'Vikram Shah', role: 'Engineering Lead', dept: 'Engineering', color: '#8b5cf6' },
  { name: 'Meera Pillai', role: 'Support Lead', dept: 'Support', color: '#14b8a6' },
  { name: 'Karthik Reddy', role: 'Mobile Engineer', dept: 'Engineering', color: '#f97316' },
] as const;

export const KPIS = {
  employees: 248,
  employeesDelta: '+12 this quarter',
  present: 221,
  presentPct: 89,
  pendingLeave: 12,
  payroll: '₹1.86 Cr',
  payrollNote: 'October run · approved',
};

/** Headcount at month end (last 12 months). */
export const GROWTH = [196, 201, 204, 209, 213, 218, 222, 227, 233, 238, 242, 248];
export const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

/** This week: in office / remote / on leave per weekday. */
export const ATTENDANCE_WEEK = [
  { day: 'Mon', office: 168, remote: 52, leave: 9 },
  { day: 'Tue', office: 176, remote: 47, leave: 7 },
  { day: 'Wed', office: 181, remote: 41, leave: 8 },
  { day: 'Thu', office: 172, remote: 49, leave: 11 },
  { day: 'Fri', office: 154, remote: 63, leave: 14 },
];

export const PIPELINE = [
  { stage: 'Applied', count: 184 },
  { stage: 'Screening', count: 62 },
  { stage: 'Interview', count: 28 },
  { stage: 'Offer', count: 9 },
  { stage: 'Joined', count: 5 },
];

export const EVENTS = [
  { date: '28', month: 'Oct', title: 'Ananya Iyer — work anniversary', meta: '3 years', tone: 'brand' },
  { date: '31', month: 'Oct', title: 'October payroll — publish payslips', meta: 'Payroll', tone: 'sky' },
  { date: '01', month: 'Nov', title: 'Rohan Mehta — birthday', meta: 'Engineering', tone: 'amber' },
  { date: '03', month: 'Nov', title: 'Q3 all-hands', meta: '4:00 PM · Main hall', tone: 'violet' },
] as const;

export const LEAVE_REQUESTS = [
  { who: 0, type: 'Casual Leave', days: '2 days', when: 'Oct 30 – 31' },
  { who: 3, type: 'Earned Leave', days: '5 days', when: 'Nov 10 – 14' },
  { who: 7, type: 'Sick Leave', days: '1 day', when: 'Today' },
] as const;

export const PAYROLL_SPLIT = [
  { label: 'Basic', value: 42, color: '#059571' },
  { label: 'HRA', value: 21, color: '#34d1a3' },
  { label: 'Allowances', value: 23, color: '#6366f1' },
  { label: 'PF & statutory', value: 14, color: '#f59e0b' },
];

export const PAYROLL_HISTORY = [1.62, 1.66, 1.68, 1.71, 1.74, 1.79, 1.81, 1.86]; // ₹ Cr, last 8 months
