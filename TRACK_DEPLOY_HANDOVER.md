# Handover: deploy the new FORMGRID Track to track.formgrid.in

For an agent with access to the web dashboards (hosting, DNS, Supabase). Everything in code and
database is already done; what is left is deployment, one access grant, and verification.

## 1. What this is

- **FORMGRID Track** is the site-progress app (rooms -> BOQ -> weighted task checklists, daily site log,
  material requests). It was rebuilt as the `track/` folder inside the repo
  `github.com/sid11o4/offcut-ledger` (branch `main`).
- It stores its data in the **factory Supabase project**, project ref `hawypgqheoddtoiefwls`
  (name `formgrid-factory`, region ap-south-1), in tables prefixed `track_`.
- `track.formgrid.in` currently serves the **old** tracker (repo `sid11o4/interior-project-tracker`, backed
  by a different Supabase project `eqykmjxbjkspacrajqim`). The job is to switch the domain to the new app.
- The factory app (`factory.formgrid.in`, the repo root) already shows a read-only "Site progress" card; it
  needs nothing from you.

## 2. Already done (do not redo)

- Database migrations `0140_track_schema.sql` and `0141_track_lockdown_helpers.sql` are applied to the
  factory project. All Track tables have row-level security; factory staff can only read.
- Old tracker data was copied in: 2 projects (A5 SKYVILLE, B2 SKYVILLE), 19 rooms, 89 BOQ items with
  progress, 24 daily reports. "B2 SKYVILLE" is linked to the B2 Design Build project.
- All code is merged to `main`. `npm run build` and `npm test` pass inside `track/`.

## 3. Tasks, in order

### Task A: give the owner Track admin access (Supabase dashboard -> SQL Editor, project `hawypgqheoddtoiefwls`)

Nobody can sign in to Track until one account is a Track member. Ask the owner which email they use for
the factory app; the existing factory accounts are `formgrid.in@gmail.com`, `madhuaadhavan32030@gmail.com`,
`madhu@formgrid.in`. Then run, with that email:

```sql
insert into public.track_members (user_id, email, role)
select id, email, 'admin' from auth.users where email = 'OWNER-EMAIL';
```

Expect "1 row". If 0 rows, the email has no account: stop and ask the owner. Do not create accounts or
pick an email on your own.

### Task B: get the two build-time values

- `VITE_SUPABASE_URL` = `https://hawypgqheoddtoiefwls.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = the **anon / public** key from Supabase -> Project Settings -> API.
  Use the anon key only. **Never use the service_role key** in the app or paste it anywhere.

### Task C: deploy `track/` (host dashboard; the old README says Hostinger Git "Deploy Web App")

1. Create a **new** web-app deployment (do not edit the old one yet) from repo `sid11o4/offcut-ledger`,
   branch `main`.
2. Root / base directory: `track`.
3. Install `npm install` (or the host default), build command `npm run build`, output directory `dist`.
4. Add the two environment variables from Task B **as build-time variables** (Vite bakes them in at build;
   they must exist during the build, not only at runtime).
5. The app is a single-page app: every unknown path must serve `index.html`
   (`track/vercel.json` does this on Vercel; on Hostinger/Apache add a rewrite to `/index.html`).
6. Build and open the generated preview URL.

### Task D: verify on the preview URL BEFORE switching the domain

Sign in with the account from Task A, then check:
1. Overview shows **A5 SKYVILLE** (about 81%) and **B2 SKYVILLE** (about 70%) in the project picker.
2. Rooms & BOQ lists rooms; tapping an item opens task buttons (0/25/50/75/100). Changing one saves
   (reload and confirm it stuck, then set it back).
3. Site log: the date dropdown lists past dates (24 imported reports, July to October).
4. Materials -> New request -> "Choose from live inventory": real factory stock appears with
   "factory" and "site" quantities. Search works.
5. Admin tab is visible (admin only).
6. Browser console shows no red errors, and no request goes to any Supabase project other than
   `hawypgqheoddtoiefwls`.

If sign-in fails with "No Track access yet", Task A did not take effect for that email.

### Task E: switch the domain

1. Point `track.formgrid.in` at the new deployment (host domain settings / DNS as the host requires).
2. Keep the old deployment, and the old Supabase project, untouched for rollback.
3. After DNS settles, repeat Task D checks 1 and 3 on `https://track.formgrid.in`.

## 4. Rollback

Point `track.formgrid.in` back at the old deployment. Nothing in the database needs reverting.

## 5. Guardrails

- Do **not** modify or delete anything in Supabase project `eqykmjxbjkspacrajqim` (old tracker) or the old
  repo; it still holds the only copy of 106 site photos.
- Do **not** run migrations or edit data in the factory project beyond the single insert in Task A.
- Do **not** disable row-level security or add policies; factory read-only access is enforced there.
- Do not put keys in the repo, in chat transcripts, or in screenshots.
- Do not merge, force-push, or change anything on GitHub; code is final.

## 6. Out of scope (tell the owner, do not do)

- Old tracker's 106 photos are not copied (the new site log starts with none).
- The old tracker's four logins (`sidharth.1104@gmail.com`, `rajkumar1@formgrid.in` admins;
  `test@formgrid.in`, `rajkumar@formgrid.in` site team) do not exist in the factory project. Adding team
  members = create the login in the factory app's user management, then Track -> Admin -> Who has access.

## 7. Report back

State, for each of Tasks A to E: done / blocked, the preview URL, the final URL check result, and anything
unexpected. If blocked, say exactly what you need from the owner.

## 8. Reference

- Setup and scripts: `track/README.md`. Schema: `supabase/migrations/0140_track_schema.sql`.
- Overall project handover: `HANDOVER.md`.
