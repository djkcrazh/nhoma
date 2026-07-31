# Pig Farm Management Dashboard

Pig farm management app serving as a ledger for
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
(`src/server/services/farm.service.ts`) and marks the invite used.

## Architecture

```
UI (app router pages/components)
  → Server Actions / API routes      src/server/actions.ts (thin)
    → Services (ALL business rules)  src/server/services/
      → Prisma                       src/server/db.ts
```

- **Derived fields are never stored.** Age, gestation, market readiness are
  pure functions in `src/lib/domain/compute.ts`. Only `Pig.status` is
  materialized, resolved exclusively by `resolveStatus()`. Recomputed on every
  write, plus a reconciliation job.
- **Reconciliation**: `GET /api/cron/reconcile` (protect with `CRON_SECRET`)
  and lazily every ≤6 h from page loads. Flips time-dependent statuses
  (piglet→adult, pregnant→ready-to-farrow, market readiness) and materializes
  deduplicated notifications.
- **Every mutation** goes through a service that validates (Zod + DB-aware
  rules incl. lineage cycle detection), checks permissions
  (`src/server/auth/permissions.ts`), writes an audit-log entry, and re-syncs
  status.
- `farmId` is on every table.

## Key flows

- **Quick Add (N)**: auto-suggested tag ID, live duplicate check, DOB
  shortcuts, parent autocomplete, *Save & add another* keeps breed/DOB/parents
  for litter entry.
- **Farrowing**: breeding board → record farrowing → Quick Add opens
  pre-filled with the sow as mother.
- **CSV**: import with dry-run validation report and two-pass parent linking;
  filtered export at `/api/pigs/export`.
- **Keyboard**: `⌘K` global search, `N` new pig, `Enter`/`⌘Enter` in modals.
