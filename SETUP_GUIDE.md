# Lead CRM — Setup Guide for a New Client

Follow the steps in order. Total time: about 30–40 minutes.

You need: a free [Supabase](https://supabase.com) account, [Node.js](https://nodejs.org) 18 or newer, and (for Step 4) a terminal.

---

## Step 1 — Create the Supabase project

1. Supabase Dashboard → **New project**. Pick a name, a strong database password (save it) and the region closest to the users.
2. Wait until the project finishes provisioning.

## Step 2 — Create all tables (one SQL script)

1. Dashboard → **SQL Editor → New query**.
2. Open `supabase/00_SETUP_NEW_CLIENT.sql`, copy **everything**, paste it, click **Run**.
3. You should see *Success. No rows returned.*

This creates every table, the automatic numbering (ORD-1000 / QUO-1000), the "Won Order → create order + customer" automation, notifications, lead auto-assignment, payment roll-up, the lead add/delete activity log, and the two file-upload storage buckets.

> Run it **once, on an empty project only**. If the tables already exist it stops with a clear message instead of changing anything.

## Step 3 — Create the first Admin

1. Dashboard → **Authentication → Users → Add user → Create new user**. Enter the admin's email and a password and tick **Auto Confirm User**.
2. Back in **SQL Editor**, run (use the same email):

```sql
update profiles set role = 'admin' where email = 'ADMIN_EMAIL_HERE';
```

(New users always start as `bde`; this promotes the first one. After this, the Admin adds everyone else from inside the app: **Users → Add New User**.)

## Step 4 — Deploy the two Edge Functions

They let an Admin add users and reset passwords from inside the app (these actions need the secret key, which must stay on the server).

From the project folder, in a terminal:

```
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase functions deploy create-user
npx supabase functions deploy reset-password
```

`YOUR-PROJECT-REF` is the part before `.supabase.co` in your project URL (also under Project Settings → General). No secrets need to be set — Supabase provides them to the functions automatically. `supabase/config.toml` is already set up for this.

*Alternative without the CLI:* Dashboard → **Edge Functions → Deploy a new function → Via Editor**, name it `create-user`, paste `supabase/functions/create-user/index.ts`, and **turn "Verify JWT" off**; repeat for `reset-password`.

## Step 5 — Connect the website to Supabase

1. Copy `.env.example` to `.env`.
2. Dashboard → **Project Settings → API**. Put the **Project URL** in `VITE_SUPABASE_URL` and the **anon / public** key in `VITE_SUPABASE_ANON_KEY`.
   Never use the `service_role` / secret key here.

## Step 6 — Run it

```
npm install
npm run dev
```

Open http://localhost:5173 and sign in as the Admin.

## Step 7 — Put it online

```
npm run build
```

Upload the `dist/` folder, or connect the repo to Vercel / Netlify with build command `npm run build` and output folder `dist`. Add the same two `VITE_…` values as environment variables on the host (they are baked in at build time, so rebuild after changing them). Page-refresh routing is already configured for both (`vercel.json`).

---

## Rebranding for the client

The name "Wavexa Lead Generation" is written directly in these files — search & replace it:

- `src/components/AppShell.jsx`, `src/components/TopHeader.jsx`, `src/pages/Login.jsx` (name shown in the app)
- `src/lib/quotationPdf.js` (letterhead and footer of the quotation PDF)
- `index.html` (browser tab title)
- Logo: replace `src/assets/logo.jpeg` (same file name)
