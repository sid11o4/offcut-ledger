# Scubo Lead Desk

Lead CRM for Scubo's real-estate sales team: Meta lead-form / WhatsApp enquiries, follow-up queue,
pipeline board, activity timeline, Meta CSV import and CSV export.

This is the standalone, deployable version of the original Claude artifact. It lives in this
repo but is a **separate app**: its own `package.json`, build and deployment. The Formgrid
Factory app at the repo root doesn't import anything from here (and root lint/tests skip this folder).

## Stack

- Vite + React 19, no router (views use `#list`, `#followups`, `#pipeline`, `#settings`)
- Supabase: the **same project as Formgrid Factory** (`formgrid-factory`), but every table is in its
  own `leaddesk` schema. Logins (`auth.users`) are shared; access is not (see below).
- Supabase Realtime keeps every open screen in sync.

## Access model

Signing in isn't enough. A person needs an active row in `leaddesk.members`:

- **Agent**: add, edit and work leads, log calls and notes, import and export CSVs.
- **Admin**: also delete leads, manage projects, and add or remove team members.

The first time a Formgrid admin signs in, they can click **Become lead desk admin** (this only works
while the team is empty). After that, admins add people in **Settings → Sales team**:

- For an email that already has a Formgrid login, leave the password blank to give that person lead
  desk access.
- For a new email, set a password to create a login. That login's Formgrid profile is turned off,
  so sales agents can't get into the factory app. It appears as an inactive "staff" user in
  Formgrid's Users screen; leave it inactive.

The database blocks removing or demoting the last active admin.

## Database

Migrations are in `supabase/migrations/ld_*.sql` (already applied to `formgrid-factory`):

- `ld_0001`: schema, tables (`members`, `projects`, `leads`, `activities`), RLS, triggers that
  write stage, follow-up and assignee changes to the timeline, a unique phone per lead,
  `import_leads()`, `claim_first_admin()`, and Realtime publication.
- `ld_0002`: `leads.last_note` for the follow-up list and export.

Edge function `supabase/functions/leaddesk-members` (deployed) lets an admin create logins and reset
passwords of lead-desk-only accounts.

**One-time dashboard setting:** Supabase → Project Settings → Data API → *Exposed schemas* → add
`leaddesk`. Without it the app shows "The leaddesk schema is not exposed".

## Develop

```bash
cd scubo-lead-desk
cp .env.example .env    # same URL + anon key as the Formgrid app
npm install
npm run dev             # http://localhost:5174
npm test
npm run build           # -> scubo-lead-desk/dist
```

## Live

**https://crm.scubo.in** is a Hostinger Web App deployed from this repo. Its root directory is
`scubo-lead-desk`, and it auto-deploys on every push to `main`. Its environment variables are
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

DNS for `scubo.in` is hosted at **Wix** (nameservers `ns2`/`ns3.wixdns.net`) because the main
website is on Wix, even though the domain is registered at Hostinger. The lead desk only needs one
record in Wix's DNS: `CNAME crm → crm.scubo.in.cdn.hstgr.net`. **Never click Hostinger's
"Connect domain" for scubo.in.** It moves the whole domain's nameservers to Hostinger and takes
the Wix site offline.

## Deploy (separately from Formgrid)

**Vercel:** create a *new* project from the same GitHub repo and set **Root Directory =
`scubo-lead-desk`**. Framework: Vite. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
`vercel.json` has the SPA rewrite. To stop each project rebuilding on the other's commits, set
*Ignored Build Step* to `git diff HEAD^ HEAD --quiet -- .` in this project, and to
`git diff HEAD^ HEAD --quiet -- . ':!scubo-lead-desk'` in the Formgrid project.

**Hostinger / any static host:** `npm run build` and upload the contents of `dist/`
(`.htaccess` for the SPA fallback is included).

After the first deploy, add the site URL under Supabase → Authentication → URL Configuration →
Redirect URLs. This app uses password sign-in only, so it's just for completeness.
