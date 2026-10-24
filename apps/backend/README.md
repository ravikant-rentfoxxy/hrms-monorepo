# HRMS Backend

Multi-tenant HRMS API for the Flutter app — **Express + TypeScript + Prisma + PostgreSQL + MinIO**.

A single **SUPER_ADMIN** manages the platform and creates **companies** (tenants). Every other record (employees, attendance, leaves, payroll, documents, …) is scoped to its company; cross-tenant access is impossible by construction (every query filters on `companyId`, and file keys are namespaced per tenant).

**Multi-company access**: a user can belong to several companies via `Membership` (user ↔ company ↔ role, each with its own employee profile). The super admin grants anyone — a new email or an existing user from another company — access to a company with `POST /superadmin/companies/:id/members`. Tokens are scoped to one active company; `POST /auth/switch-company` re-issues tokens for another membership. Revoking a membership kills that company's access without touching the user's other companies.

## Stack & security

| Concern | Implementation |
|---|---|
| Runtime | Node.js 20+, Express 4, TypeScript (strict) |
| Database | PostgreSQL 16 (Docker) via Prisma ORM (parameterized queries — no SQL injection) |
| File storage | MinIO (Docker, S3-compatible) — any file format; short-lived presigned download URLs |
| Auth | JWT access (15 min) + refresh token (7 d) with rotation; refresh tokens stored only as SHA-256 hashes; bcrypt(12) passwords |
| RBAC | `SUPER_ADMIN` → `ADMIN` → `HR` → `MANAGER` → `EMPLOYEE` |
| Headers | helmet |
| Abuse | express-rate-limit (global 500/15 min; auth endpoints 20/15 min) |
| Input | zod validation on body/query of every endpoint; 1 MB JSON limit; 15 MB upload limit |
| Lint | ESLint 9 (flat config) + typescript-eslint |

## Quick start

```bash
cd "hrms backend"
cp .env.example .env            # already done; change secrets for production!
docker compose up -d db minio   # PostgreSQL :5433, MinIO :9000 (console :9001)
npm install
npm run db:push                 # create tables
npm run db:seed                 # create super admin from .env
npm run dev                     # API on http://localhost:4000
```

Run everything (API included) in Docker instead: `docker compose --profile full up -d --build`.

- Health check: `GET http://localhost:4000/health`
- MinIO console: http://localhost:9001 (`hrms_minio` / `hrms_minio_secret`)
- Default super admin: `superadmin@hrms.local` / `SuperAdmin@123`

## Typical flow

```bash
# 1. Super admin logs in
POST /api/v1/auth/login                      { "email", "password" }

# 2. Creates a company and grants access
POST /api/v1/superadmin/companies             { "name": "Acme", "code": "acme" }
POST /api/v1/superadmin/companies/:id/members { "email", "role": "ADMIN", "password", "name" }
#    password/name only needed for a NEW email; an existing user (even an
#    admin of another company) is simply granted a membership here.

# 3. Company admin logs in, sets up the office geofence, adds employees
POST /api/v1/offices    { "name": "HQ", "latitude": 12.97, "longitude": 77.59, "radiusMeters": 300 }
POST /api/v1/employees  { "email", "password", "name", "role": "EMPLOYEE", ... }
#    employee ID is auto-generated (continues the company's "RF-011" pattern);
#    pass "employeeCode" only to override it.

# 4. Employees use the app
POST /api/v1/attendance/check-in   { "latitude", "longitude" }   # rejected outside the geofence
POST /api/v1/leaves                { "leaveTypeId", "fromDate", "toDate", "reason" }
POST /api/v1/documents             multipart: file=<any format>
```

All tenant routes take `Authorization: Bearer <accessToken>`. A super admin acting inside a tenant adds `X-Company-Id: <companyId>`.

## Two API surfaces

- **`/api/v1`** — the Flutter app API. No platform routes.
- **`/api/admin/v1`** — the admin panel API (used by the Next.js panel in `../hrms web`). Same tenant modules **plus** the `/superadmin/*` platform routes.

## API overview (same paths under either surface)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login` (optional `companyId`), `/auth/switch-company`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`, `GET /auth/me` |
| Platform (SUPER_ADMIN) | `GET/POST /superadmin/companies`, `GET/PATCH/DELETE /superadmin/companies/:id`, `GET/POST /superadmin/companies/:id/members`, `DELETE /superadmin/companies/:id/members/:userId`, `GET /superadmin/stats` (`POST …/admins` kept as alias) |
| Employees | `GET/POST /employees`, `GET /employees/birthdays`, `GET/PATCH/DELETE /employees/:id`, `GET /employees/:id/salary-structure` (CTC breakup, self or ADMIN/HR). Create/update accept the typed monthly components `salaryBasic`/`salaryHra`/`salaryConveyance`/`salaryMedical`/`salaryAllowance`/`salaryPfEmployer`/`salaryPfEmployee`. Derived (never stored): Gross = sum of earnings (employer PF excluded); CTC = Gross + employer PF + gratuity provision (4.81% of basic); Net = Gross − employee PF. `salaryCtc` (monthly CTC) is also accepted and derives a standard structure per the Labour Codes (Basic = 50% of CTC, HRA 40% of basic, PF 12% of basic, standard conveyance ₹1,600 / medical ₹1,250, Special Allowance balances) |
| Offices (geofence) | `GET/POST /offices`, `PATCH/DELETE /offices/:id` — includes `workingDays` (payroll denominator: 0 = auto, calculated per month as days-in-month − weekends − weekday holidays; a value like 26 fixes the norm) |
| Attendance | `POST /attendance/check-in`, `/check-out`, `GET /attendance/today`, `GET /attendance?year&month[&employeeId]`, `GET /attendance/company?date`, `GET /attendance/export?year&month` (CSV, ADMIN/HR), `GET /attendance/working-days?year&month` (ADMIN/HR — per-employee payable days: check-in days + approved leave, capped at the office norm) |
| Regularization | `POST /attendance/regularizations` (employee), `GET /attendance/regularizations?scope=me\|company`, `POST /attendance/regularizations/:id/decide` (approval marks the day PRESENT) |
| Leaves | `GET/POST /leaves/types`, `PATCH /leaves/types/:id`, `GET /leaves/balance`, `GET/POST /leaves`, `POST /leaves/:id/cancel`, `POST /leaves/:id/decide` |
| Payroll | `POST /payroll/run` (ADMIN/HR; optional `workingDays` override) — pro-rata: earned component = fixed ÷ working days × payable days, where payable days come from attendance + approved leave; zero-day employees get no payslip. `GET/POST /payroll/payslips`, `GET/PATCH/DELETE /payroll/payslips/:id`, `GET /payroll/payslips/:id/pdf` (generates the payslip PDF and returns a short-lived link; `?inline=true` to view in the browser; owner or ADMIN/HR) |
| Holidays | `GET/POST /holidays` (single or bulk array), `PATCH/DELETE /holidays/:id` |
| Announcements | `GET/POST /announcements`, `POST /announcements/:id/read`, `DELETE /announcements/:id` |
| Expenses | `GET/POST /expenses` (multipart `receipt`), `GET /expenses/:id/receipt`, `POST /expenses/:id/decide`, `/cancel` |
| Performance | `GET/POST /performance/goals`, `PATCH/DELETE /performance/goals/:id`, `GET/POST /performance/feedback` |
| Tasks | `GET/POST /tasks`, `PATCH/DELETE /tasks/:id` |
| Documents | HR-managed: employees view/download only. `GET /documents`, `POST /documents` (ADMIN/HR; multipart `file`, any format; optional `category` = folder), `GET /documents/folders` (folder list with own counts + mandatory shortfall), `GET /documents/:id/download` (presigned URL; `?inline=true` returns a view-in-browser link instead of a download), `PATCH /documents/:id` (ADMIN/HR; edit name/folder/ownership), `DELETE /documents/:id` (ADMIN/HR) |
| Helpdesk | `GET/POST /tickets`, `PATCH /tickets/:id/status` |
| Dashboard | `GET /dashboard` — today's attendance, pending leaves/expenses, holidays, announcements, open tickets, tasks due |

Responses are `{ "success": true, "data": ... }` or `{ "success": false, "error": "...", "details": ... }`.

## Business rules baked in

- **Geofence**: check-in/out must be within `radiusMeters` of an active office (skipped when the company has no offices). Check-in after the company's `workStart` (default 09:30) is marked `LATE`.
- **Leaves**: working-day count excludes weekends (matches the app); balance and overlap are enforced; a `MANAGER` can only decide their reports' requests; nobody decides their own.
- **New companies** get default leave types (CL/SL/EL/WFH).
- **Privacy**: bank/PAN/address fields are hidden from non-ADMIN/HR users viewing someone else's profile; payslips and receipts are owner-or-privileged only.
- **Soft delete**: deleting an employee deactivates the profile and revokes their login.

## Project structure (MVC + services)

```
src/
├── routes/        # Route wiring only: paths + auth/role/validation middleware → controller
│   └── index.ts   # buildApiRouter() assembles a surface (app API vs admin API)
├── controllers/   # Thin HTTP layer: read req, call a service, shape the response
├── services/      # Business logic. No Express imports — reusable from scripts,
│   │              # jobs, tests or other services (see services/index.ts barrel)
│   └── index.ts   # import { leaveService } from './services'
├── validations/   # zod schemas per module
├── middleware/    # authenticate, tenant, requireRole, validate, upload, rate limits, errors
├── lib/           # prisma client, MinIO storage, logger
├── utils/         # ApiError, async handler, jwt/bcrypt, geo math
└── config/        # env validation
prisma/schema.prisma   # the "model" layer
```

A request flows `route → middleware → controller → service → prisma`, and every service function takes plain inputs (`companyId`, ids, data) and returns plain data or throws `ApiError` — so the same logic can back the Flutter API, the admin API, or a one-off script.

## Scripts

`npm run dev` · `build` · `start` · `lint` · `typecheck` · `db:push` · `db:seed` · `db:seed-finance` (statutory/identity demo data + Ravikant's Form 124 PDF) · `db:migrate`

## Production notes

1. Replace every secret in `.env` / `docker-compose.yml` (JWT secrets, DB and MinIO credentials, super admin password).
2. Set `CORS_ORIGINS` to your real origins and serve behind HTTPS.
3. Switch from `prisma db push` to proper migrations (`npm run db:migrate`).
