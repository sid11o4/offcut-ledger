# Formgrid Factory

A production-oriented web application for a panel-processing factory: daily machine job-work
logging, automatic revenue calculation, project-wise reporting, estimates, billing, expenses
(including recurring fixed costs), and an income/expense statement — all derived from the same
underlying transaction records (a single source of truth), never from manually-entered totals.

## Stack

- **React 19 + Vite**, React Router, TanStack Query
- **Supabase** (Postgres 17) for the database, auth, and row-level security — the calculation
  engine, billing rules, and authorization all live in Postgres (triggers, functions, RLS), not
  just in the frontend
- Tailwind CSS
- jsPDF for estimate/bill documents, PapaParse for CSV export
- Vitest for unit tests

## Why this stack

The repository already had a React + Vite + Supabase scaffold from a prior, unrelated project on
this same repo (an offcut-inventory tool, kept intact on `main`); this app reuses that stack —
Postgres gives triggers/RLS for real data integrity, Supabase Auth gives real login — rather than
introducing a second stack for no reason. This app's tables, functions, and business logic are
entirely new (see `supabase/migrations/`) and live in a dedicated Supabase project
(`formgrid-factory`, project ref `hawypgqheoddtoiefwls`), separate from the old app's database.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with your Supabase project's URL and anon/publishable key:

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-or-publishable-key>
VITE_APP_TIMEZONE=Asia/Kolkata
```

```bash
npm run dev       # start the dev server
npm run build     # production build
npm run lint      # oxlint
npm test          # vitest (calculation engine + date-range unit tests)
```

### Database

All schema, triggers, RPC functions, RLS policies, and seed/demo data live in
`supabase/migrations/`, applied in filename order. Against a fresh Supabase project (via the
Supabase CLI, `supabase db push`, or by running each file through the SQL editor in order):

1. `0001`–`0014` — core schema, calculation engine, billing, expenses, audit trail, RLS
2. `0015` — initial masters (machines, processes, units, job-work services & combinations, rate
   categories, expense categories) — **no invented monetary rates**, per spec
3. `0016` — clearly-marked sample/demo data (`DEMO-` prefixed clients/projects, illustrative
   rates, a few days of job-work, one partial bill, one estimate) so the app is immediately
   explorable
4. `0017`–`0020` — security/performance hardening and a company-info settings table

### First login

A demo project needs at least one login. If you're using the Supabase project this was built
against, an admin account already exists:

- **Email:** `sidxcool75@gmail.com`
- A generated password was shared with the requester in chat (not committed here) — change it
  from the account menu → "Change password" after first login.

For a fresh Supabase project, create the first user any way Supabase Auth supports (dashboard
invite, or `supabase.auth.admin.createUser`), then in the SQL editor:

```sql
update public.profiles set role_id = (select id from public.roles where key = 'admin')
where email = 'you@example.com';
```

New users beyond that are provisioned the same way (Supabase dashboard → Authentication →
Users → Invite), then assigned a role from **Users & Permissions** in the app — see
"Known limitations" below for why this is dashboard-based rather than in-app.

## Architecture

### Single source of truth

Every job-work entry is a row in `job_work_entries`, expanded into one row per underlying atomic
service in `job_work_entry_components` (this is what makes machine-wise/process-wise reporting
work even for composite services like "Double Side Cutting"). All reporting, billing, and the
income/expense statement read from these rows — nothing is a manually-entered total. See
`supabase/migrations/0012_calculation_engine.sql`.

### Configuration over code

Machines, processes, units, job-work services & their combinations, rate categories, and expense
categories are all data (Masters / Settings in the app), not hard-coded. A new combination (e.g.
"Special Panel Processing = 2x Cutting + 2x Pasting + 1x Edgebanding 0.8mm") is built entirely
through the Job Work & Combinations screen — zero code changes.

### Rate history

Rates are effective-dated (`rates.effective_from` / `effective_to`). Adding a new rate for a
service+category automatically closes the previous open-ended rate the day before — see
`0006_rates.sql`. A job-work entry stores the rate it actually used at the time
(`job_work_entry_components.rate_value`), so later rate changes never rewrite history.

### Permissions

The role set (Admin, Manager, Factory Staff, Accounts) is fixed, but exactly what each role can
do is fully configurable from **Users & Permissions → Permissions**, and is enforced by Postgres
Row Level Security — not just hidden UI. See the permission key list in
`0014_rls_policies.sql`.

### Billing integrity

`bill_items` has a trigger that atomically locks and checks the referenced `job_work_entries`
row before allowing it onto a bill, so the same entry cannot be billed twice even under
concurrent requests. Cancelling a bill reverses this, freeing its entries back to unbilled. See
`0009_billing.sql` and `0012_calculation_engine.sql`.

## Documented assumptions

The spec was extremely detailed but a handful of points were ambiguous or (in one case)
internally inconsistent. Rather than block, each was resolved in favor of data integrity,
auditability, and consistency with the spec's own worked examples — documented at the point of
decision in the migration files, and summarized here:

- **Atomic vs. composite job-work** (`0015_seed_masters.sql`): spec section 9's rate table and
  section 6's combination examples disagree about whether "Pasting" is itself rate-bearing.
  Section 42's fully worked calculation example ("Double Side Cutting = 1x Cutting + 2x Pasting,
  using the Cutting Rate and the Pasting Rate") is treated as authoritative, since it's the one
  place the spec shows the actual formula.
- **Role set is fixed, permissions are configurable** (`0002_roles_permissions_profiles.sql`):
  four roles (Admin, Manager, Factory Staff, Accounts) rather than fully dynamic role creation.
  What's configurable without code changes is which permissions each role holds.
- **New users are created in-app by an admin** (`UsersPermissions.jsx` → `supabase/functions/manage-user`):
  a client-side `supabase.auth.signUp` would hijack the admin's own session, so user create /
  delete / email-change go through a JWT-verified, admin-only Edge Function that holds the
  service-role key server-side. New logins land on the least-privileged "Staff" role; the admin
  then assigns the real role. The last active admin can't be demoted, deactivated, or deleted
  (enforced in `0024_last_admin_guard.sql` and the Edge Function).
- **Recurring expense recognition** (`0010_expenses_and_recurring.sql`): a recurring expense is
  recognized exactly once per its frequency cycle, on that cycle's due date, when that due date
  falls on/before the date a report or sync is run for. A partial-period report includes a
  recurring expense only if its due date falls inside that exact window — no proration is
  invented.
- **`generate_bill()` issues immediately** (`0009_billing.sql`): selecting entries and generating
  the bill is the drafting step in this UI, so the resulting bill is created as `issued`, not a
  separate `draft` requiring a second confirmation step. `draft` remains a valid status.
- **Tax/GST is configurable, not assumed** (`0019_app_settings.sql`, `projects.tax_info`): a
  factory-wide default tax percent (seeded at 0%) plus a per-bill override — no GST treatment is
  hard-coded.
- **Company letterhead details are placeholders** (`0019_app_settings.sql`): update them from
  Masters → Company Info before sending real documents to clients.

## Known limitations / next steps

- **No in-sandbox browser E2E test.** This was built and verified inside a network-restricted
  container; outbound HTTPS to the Supabase host was blocked by the container's own egress
  policy (confirmed via the proxy's diagnostics — a `403` policy denial, not an app bug), so a
  headless-Chromium run against the live app couldn't complete a login inside that sandbox. The
  frontend build is clean, the login page renders and calls the correct endpoint, and — most
  importantly — **every business rule was verified against the real database**: the calculation
  engine, rate history, partial billing, duplicate-billing prevention, bill cancellation, rate
  overrides, and recurring-expense idempotency were each exercised live via the actual RPC
  functions (not hand-verified SQL), with results checked against hand-computed expected values.
  Please do a manual click-through after deploying — normal browser environments won't hit this
  restriction.
- **Reports use client-side date-range queries plus a handful of Postgres aggregate functions**
  (`report_revenue_by_*`, `income_expense_statement`, etc.) so large date ranges aggregate in the
  database, not the browser. There's room to add more indexes as data volume grows (a few
  low-value indexes on rarely-filtered audit columns were deliberately skipped — see the
  performance advisor notes below).
- **Leaked-password protection** (Supabase Auth's HaveIBeenPwned check) is off by default on a
  new project; enable it from the Supabase dashboard → Authentication → Policies.
- Bundle size warning at build time (single ~1MB chunk) — fine for an internal tool, but code-
  splitting the PDF/export libraries would help if this ever needs to load fast on a slow
  factory-floor connection.

## Testing

`npm test` runs Vitest unit tests for the client-side calculation-preview engine
(`src/lib/calc.js`) and date-range helpers — rate calculation, combination calculation, rate-
category variance, and rate history (a job dated before a rate revision keeps using the old rate
even after a newer one is added) are all covered with fixtures mirroring the real schema.

The rules that require a real database (billing duplicate-prevention, partial billing, bill
cancellation reinstating unbilled work, rate overrides recording an audit trail, recurring-
expense generation being idempotent even under concurrent calls, and the income/expense
statement reconciling exactly with the underlying job-work and expense rows) were verified live
against the actual Supabase project during development, each against hand-computed expected
totals.
