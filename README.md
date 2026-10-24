# HRMS

HR management for small businesses: employee lifecycle (hiring → onboarding → confirmation → transfers → exit) and payroll.

| Folder | What | Stack |
|---|---|---|
| [`apps/backend`](apps/backend) | REST API, background jobs, PDF letters | Express 4, TypeScript, Prisma 6, PostgreSQL, MinIO |
| [`apps/web`](apps/web) | Admin portal for HR / managers / admins | Next.js 16, React 19, Tailwind 4 |

The Flutter mobile app lives in a separate repository and talks to the same API.

## Requirements

- Node.js 20+
- Docker (for PostgreSQL and MinIO)

## First-time setup

```bash
npm run install:all                               # installs both apps

cp apps/backend/.env.example apps/backend/.env    # then edit secrets
cp apps/web/.env.example apps/web/.env.local      # point at the API port

npm run infra:up                                  # PostgreSQL :5433, MinIO :9000
npm run db:push                                   # create tables
npm run db:seed                                   # super admin from .env
npm run db:seed-showcase                          # optional demo company "nimbus"
```

## Run (two terminals)

```bash
npm run dev:backend    # API on PORT from apps/backend/.env (default 4000), restarts on change (nodemon)
npm run dev:web        # portal on http://localhost:3000
```

`NEXT_PUBLIC_API_URL` in `apps/web/.env.local` must use the same port as the backend.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
```

## Notes

- Never commit `.env` files — only the `.env.example` templates are tracked.
- Notification and email delivery are TODO stubs (`apps/backend/src/lib/notify.ts`).
- Each app keeps its own `package.json` and lockfile; run app-specific commands with `npm --prefix apps/<app> run <script>`.
