# Lead CRM — React + Vite + Supabase

Lead capture → follow-up → quotation → order → payment tracking, with role-based
access (Admin, Subadmin, Sales, BDE, Calling).

**To install this for a new client, follow [`SETUP_GUIDE.md`](./SETUP_GUIDE.md).**

## Quick commands
```
npm install
cp .env.example .env     # then fill in the two Supabase values
npm run dev              # http://localhost:5173
npm run build            # production build -> dist/
```

## Folder map
```
src/                     React app (pages, components, lib)
src/assets/logo.jpeg     logo (name "Wavexa Lead Generation" is in code - see SETUP_GUIDE.md > Rebranding)
supabase/
  00_SETUP_NEW_CLIENT.sql           run once on a new, empty Supabase project
  01_OPTIONAL_enable_rls.sql        database-level per-role security (recommended)
  02_OPTIONAL_disable_rls_rollback.sql   emergency undo for the file above
  functions/create-user/            Edge Function: Admin adds a user
  functions/reset-password/         Edge Function: Admin resets a password
  config.toml                       lets `supabase functions deploy` work as-is
```
