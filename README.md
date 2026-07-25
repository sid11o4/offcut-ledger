# Offcut Ledger

A stock-first cutting-list matcher for a cabinetry/interiors shop: track offcut inventory,
match a project cutlist against existing scrap before cutting a full sheet, print panel and
wrap labels, and keep a history of past runs.

Originally a single-file HTML app; this is a React (Vite) rewrite with data persisted in
Supabase instead of the browser's local storage.

## Stack

- React 19 + Vite
- [PapaParse](https://www.papaparse.com/) for CSV import/export
- [SheetJS (xlsx)](https://sheetjs.com/) for `.xlsx`/`.xls` inventory import
- [jsPDF](https://github.com/parallax/jsPDF) for labels, cutting schedules and cutting diagrams
- [Supabase](https://supabase.com/) (Postgres) for inventory, rules, and project history

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with your Supabase project's URL and anon key:

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

The app expects four tables in the `public` schema: `offcut_inventory`,
`offcut_unexposed_materials`, `offcut_discard_rules`, `offcut_projects`. See
`supabase/migrations/` for the schema.

```bash
npm run dev      # start the dev server
npm run build     # production build
npm run lint      # oxlint
```

## Security note

This app has no authentication layer — it's built as a single-user/internal tool, matching
the original. The Supabase tables use permissive row-level-security policies that grant the
`anon` key full read/write access. Anyone who has the URL and anon key (both are visible in
client-side code) can read or modify this data. Do not point this at a Supabase project that
holds anything else you care about, and don't treat the anon key as a secret.

## Data model

- **Inventory** — offcut stock shared across all projects (`material`, `length`, `width`,
  `bin`, `qty`).
- **Unexposed materials** — materials where a different-thickness offcut is an acceptable
  substitute (hidden/structural panels only).
- **Discard rules** — per-material minimum remnant size; below it, a cut leftover is
  discarded as scrap rather than returned to stock.
- **Projects** — a saved snapshot of a matching run (matched panels, panels still needing a
  full sheet, and the settings used), so labels/schedules can be regenerated later.
