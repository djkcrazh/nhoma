# Pig Farm Management Dashboard — “Farm Ledger”

A production-quality pig farm management app: a digitized livestock ledger for
recording pigs, tracking breeding and 114-day gestation, weight history, market
readiness, alerts, and farm analytics. Built per [PLAN.md](./PLAN.md).

## Stack

Next.js (App Router) · TypeScript · Prisma + SQLite (dev) / PostgreSQL-ready ·
Auth.js credentials (bcrypt, JWT) · Zod · Tailwind v4 + Radix · TanStack
Table/Query · Zustand · Recharts · PapaParse.

## Quick start

```bash
npm install
npx prisma migrate dev   # creates prisma/dev.db
npx prisma db seed       # demo farm, users, herd
npm run dev              # http://localhost:3000
```

Seeded accounts:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@farm.local` | `admin1234` |
| Farm user | `worker@farm.local` | `worker1234` |

## New farms (invite-only)

The app is multi-tenant: every table is scoped by `farmId`, so additional farms
run fully isolated from the seeded trial farm. New farms are provisioned by
redeeming a one-time invite code at `/onboarding`:

```bash
npm run invite:create -- --note "Acme Farms" --expires-days 14
```

This prints a code and a shareable `/onboarding?code=...` link. Redeeming it
creates a new `Farm` + first `ADMIN` user in one transaction
(`src/server/services/farm.service.ts`) and marks the invite used. Going
public later (self-serve signup) means only relaxing the invite-code check in
that service — the rest of the flow doesn't change.

## Architecture

```
UI (app router pages/components)
  → Server Actions / API routes      src/server/actions.ts (thin)
    → Services (ALL business rules)  src/server/services/
      → Prisma                       src/server/db.ts
```

- **Derived fields are never stored.** Age, gestation, market readiness are
  pure functions in `src/lib/domain/compute.ts`. Only `Pig.status` is
  materialized, resolved exclusively by `resolveStatus()` — recomputed on every
  write, plus a reconciliation job.
- **Reconciliation**: `GET /api/cron/reconcile` (protect with `CRON_SECRET`)
  and lazily every ≤6 h from page loads. Flips time-dependent statuses
  (piglet→adult, pregnant→ready-to-farrow, market readiness) and materializes
  deduplicated notifications.
- **Every mutation** goes through a service that validates (Zod + DB-aware
  rules incl. lineage cycle detection), checks permissions
  (`src/server/auth/permissions.ts`), writes an audit-log entry, and re-syncs
  status.
- `farmId` is on every table — multi-farm later is a query-scope change.

## Key flows

- **Quick Add (N)** — auto-suggested tag ID, live duplicate check, DOB
  shortcuts, parent autocomplete, *Save & add another* keeps breed/DOB/parents
  for litter entry.
- **Farrowing** — breeding board → record farrowing → Quick Add opens
  pre-filled with the sow as mother.
- **CSV** — import with dry-run validation report and two-pass parent linking;
  filtered export at `/api/pigs/export`.
- **Keyboard** — `⌘K` global search, `N` new pig, `Enter`/`⌘Enter` in modals.

## Production (Vercel + Postgres)

1. **Database** — create a Postgres instance (e.g. a free [Neon](https://neon.tech)
   project) and copy its connection string.
2. **Switch the datasource** — in `prisma/schema.prisma` change
   `datasource db { provider = "sqlite" ... }` to `provider = "postgresql"`,
   then run `DATABASE_URL="<postgres-url>" npx prisma migrate dev --name init`
   to create the baseline migration and apply it.
3. **Deploy to Vercel** — import the repo, set environment variables:
   - `DATABASE_URL` — the Postgres connection string (use a pooled connection
     string if your provider offers one, e.g. Neon's `-pooler` host)
   - `AUTH_SECRET` — a random 32+ byte secret (`openssl rand -hex 32`)
   - `CRON_SECRET` — a random secret; also add it as the `Authorization: Bearer
     <secret>` header if your scheduler needs it (Vercel Cron sends it
     automatically when set as an env var of the same name)
   - `APP_URL` — your production URL, used by `npm run invite:create` to print
     shareable links
4. **Build command** — `npm run build` already runs `prisma generate` first.
   After each deploy that changes the schema, run
   `DATABASE_URL="<postgres-url>" npx prisma migrate deploy` (locally or via a
   CI/deploy-hook step) to apply pending migrations to production.
5. **Cron** — `vercel.json` schedules `/api/cron/reconcile` daily at 05:00 UTC;
   Vercel Cron authenticates via `CRON_SECRET` automatically once both are set.
