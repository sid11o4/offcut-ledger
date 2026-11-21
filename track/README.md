# FORMGRID Track (track.formgrid.in)

Site-progress tracking for interior fit-outs, rebuilt as an app inside this repo and stored in the
**factory Supabase project** (`hawypgqheoddtoiefwls`) under `track_*` tables.

- **Progress**: rooms -> BOQ items -> weighted task checklists. The maths is unchanged from the old
  tracker (`src/lib/progress.js`, tested; mirrored in SQL by `track_item_progress`).
- **Site log**: start day (records where every task stands), update tasks, labour, materials, issues,
  photos, close day, and print the end-of-day report. Details autosave.
- **Material requests**: pick from the **live inventory** (factory stock plus the project's own stock,
  read-only) or type material that is **outside inventory**. Admins approve / reject / mark fulfilled.
- **Factory read-only**: factory staff (active factory users) get SELECT only on every `track_*` table.
  The factory project dashboard shows a "Site progress" card from `track_progress_for_design_project`.
  Nothing in the factory app can write Track data, and that is enforced by RLS, not the UI.

## Set up

1. Apply `supabase/migrations/0140_track_schema.sql` (repo root) to the factory project.
2. Create the first admin (the SQL editor has no `auth.uid()`, so insert directly):
   ```sql
   insert into public.track_members (user_id, email, role)
   select id, email, 'admin' from auth.users where email = 'you@example.com';
   ```
   After that, admins add people under **Admin -> Who has access** (accounts themselves are created
   in the factory app).
3. Link each site project to its Design Build project in **Admin -> Projects**; this powers the factory
   card and the project-stock figure in material requests.
4. `cp .env.example .env`, fill in the anon key, then `npm install && npm run dev`.
5. Optional: bring the old tracker's data across with `scripts/migrate-legacy.mjs` (see its header).

## Deploy

Static SPA (`npm run build` -> `dist/`). Point `track.formgrid.in` at a build of the `track/`
directory with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` set at build time. `vercel.json`
already rewrites every path to `index.html`.

## Scripts

`npm run dev` · `npm run build` · `npm test` · `npm run lint`
