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
npm test                 # unit tests (Vitest), see "Testing" below
```

Seeded accounts:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@farm.local` | `admin1234` |
| Farm user | `worker@farm.local` | `worker1234` |

## Testing

Three layers, from fastest to most realistic:

| Layer | Command | Needs | Where it lives |
|---|---|---|---|
| **Unit tests** (Vitest) | `npm test` (or `npm run test:watch`) | nothing | `src/lib/import/*.test.ts` |
| **Database check** of the real import | `npm run test:db` | a throwaway Postgres | `scripts/import-smoke.ts` |
| **Manual UI check** with sample files | `npm run dev`, then Pigs, then Import CSV | the same Postgres | `tests/csv-samples/` (see its README for what to expect) |

Run one file with `npx vitest run src/lib/import/suggest.test.ts`, or one test by name with `-t "date order"`.

The unit tests cover everything pure: file encodings (`decode.test.ts`), the import
template and its transforms (`mapping.test.ts`), header/value matching and the
"does a person need to look at this" rules (`suggest.test.ts`), row validation
(`validate.test.ts`), and the limits (`columns.test.ts`, `parse.test.ts`).

For the database check and the manual UI check, start a throwaway Postgres (this
works in Docker or OrbStack) and point the app at it:

```bash
docker run -d --name nhoma-test-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=nhoma -p 55433:5432 postgres:16-alpine
export DATABASE_URL=postgresql://postgres:pw@localhost:55433/nhoma
npx prisma migrate deploy
npm run test:db                  # prints one "ok" line per check
npx prisma db seed && npm run dev   # then log in as admin@farm.local / admin1234
docker rm -f nhoma-test-pg       # when you are done
```

The database check creates its own farm on every run, so it never touches the seeded demo data.

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
