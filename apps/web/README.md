# HRMS Admin Panel

Role-based admin panel for the multi-tenant HRMS — **Next.js 16 (App Router) + React 19 + Tailwind CSS 4 + TypeScript**.

It talks to the **dedicated admin API** (`/api/admin/v1`), which is separate from the Flutter app API (`/api/v1`). Only the admin surface exposes platform (super admin) routes.

## Run

```bash
# backend + containers must be running (see ../hrms backend/README.md)
npm install
npm run dev     # http://localhost:3000
```

`NEXT_PUBLIC_API_URL` in `.env.local` points at the admin API (default `http://localhost:4000/api/admin/v1`).

Demo logins (after seeding):

| Who | Email | Password |
|---|---|---|
| Super admin | `superadmin@hrms.local` | `SuperAdmin@123` |
| Employer (ADMIN) | `admin@acme.test` | `Admin@12345` |
| Employee | `bob@acme.test` | `Employee@123` |

## Role-based access

Navigation and page actions adapt to the active role (from the JWT, re-checked by the API on every call):

| Capability | SUPER_ADMIN | ADMIN / HR | MANAGER | EMPLOYEE |
|---|---|---|---|---|
| Companies (create, enable/disable, grant/revoke member access) | ✅ | — | — | — |
| Act in any company (X-Company-Id switcher in the top bar) | ✅ | — | — | — |
| Add/edit/deactivate employees, offices, leave types, holidays, announcements, payslips | ✅ | ✅ | — | — |
| Approve/reject leaves & expenses, company attendance view, assign goals/tasks | ✅ | ✅ | ✅ (own reports) | — |
| Check in/out (geofenced), apply leave, claim expenses, payslips, goals, tasks, documents, tickets, directory, profile | ✅* | ✅ | ✅ | ✅ |

\* where the super admin has an employee profile in the acting company.

Users who belong to several companies get a company switcher in the top bar (re-issues tokens via `/auth/switch-company`).

## Modules

Dashboard · Companies · Employees (directory + full profile) · Attendance (browser-geolocation check-in/out, monthly + company views) · Leaves (balances, apply, approvals, types) · Payroll (payslip viewer + generator) · Expenses (claims with receipt upload, approvals) · Performance (goals with progress, 360° feedback) · Tasks · Documents (any file format via MinIO presigned URLs) · Helpdesk · Announcements · Holidays · Offices (geofences) · Profile (incl. change password).
