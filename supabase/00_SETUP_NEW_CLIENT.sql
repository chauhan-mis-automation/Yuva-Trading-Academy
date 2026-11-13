-- ============================================================================
-- LEAD CRM — COMPLETE DATABASE SETUP FOR A NEW (EMPTY) SUPABASE PROJECT
-- ============================================================================
-- HOW TO RUN
--   1. Create a brand-new Supabase project.
--   2. Supabase Dashboard -> SQL Editor -> New query.
--   3. Paste this ENTIRE file and click Run — once.
--   4. Follow the remaining steps in SETUP_GUIDE.md (first admin user,
--      Edge Functions, .env).
--
-- WHAT IT CREATES
--   Tables      : profiles, products, leads, followup_history, call_history,
--                 orders, customers, quotations, quotation_items, payments,
--                 notifications, login_history, lead_activity_log
--   Automation  : auto order-numbers (ORD-/QUO-), auto order + customer when a
--                 lead is "Won Order", assignment notifications, assigned_at
--                 tracking, round-robin auto-assign for non-manual leads,
--                 payment status roll-up, lead add/delete activity log,
--                 profile row for every new auth user
--   Storage     : buckets "quotation-files" and "call-recordings" (+ policies)
--
-- SAFE TO RE-RUN?  No — run on an EMPTY project only. A guard below stops it
-- if the CRM tables already exist, so it cannot overwrite a live database.
--
-- ROW LEVEL SECURITY
--   This script leaves RLS OFF on the app tables (same as the original build),
--   but removes all table access from the public "anon" key, so nobody who is
--   not logged in can read or write data. Logged-in users can still reach every
--   table through the API. Before go-live, run 01_OPTIONAL_enable_rls.sql to
--   enforce per-role access in the database itself.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. GUARD — refuse to run on a database that already has the CRM
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.leads') is not null or to_regclass('public.profiles') is not null then
    raise exception 'CRM tables already exist in this database. Run this script only on a NEW, empty Supabase project.';
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 1. ENUM TYPES
-- ----------------------------------------------------------------------------
create type user_role as enum ('admin', 'subadmin', 'sales', 'bde', 'calling');

create type lead_status as enum (
  'new_lead', 'contacted', 'followup_required', 'hot_lead', 'warm_lead',
  'proposal_sent', 'negotiation', 'won_order', 'lost_order', 'not_interested'
);

-- Must match SOURCE_OPTIONS in src/lib/constants.js
create type lead_source as enum (
  'meta_ads', 'instagram', 'google_ads', 'website_form', 'website_chatbot',
  'google_sheets', 'bulk_upload', 'manual_entry', 'indiamart', 'justdial',
  'referral', 'api', 'other'
);


-- ----------------------------------------------------------------------------
-- 2. CORE TABLES
-- ----------------------------------------------------------------------------

-- 2.1 profiles — extends Supabase Auth users with name + role
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role user_role not null default 'bde',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2.2 products / services
create table products (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  category text,
  product_code text,
  description text,
  price numeric(12,2),
  price_max numeric(12,2),            -- optional upper end of a price range
  tax_percent numeric(5,2) default 18,
  discount_percent numeric(5,2) default 0,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_products_active on products(is_active);

-- 2.3 leads
create table leads (
  id uuid primary key default gen_random_uuid(),

  -- who / what
  lead_name text not null,
  client_name text,
  mobile text,
  email text,
  company text,
  industry_type text,
  city text,
  state text,
  source lead_source not null default 'manual_entry',
  product_id uuid references products(id) on delete set null,
  requirement text,

  -- ownership
  assigned_to uuid references profiles(id),
  assigned_at timestamptz,

  -- pipeline
  status lead_status not null default 'new_lead',
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  lead_temperature text check (lead_temperature in ('hot', 'warm', 'cold')),
  budget numeric(12,2),
  expected_deal_value numeric(12,2),
  closing_tat text check (closing_tat in ('7_days', '15_days', '30_days', '60_days')),
  next_followup_date timestamptz,
  next_action_type text not null default 'call' check (next_action_type in ('call', 'meeting', 'visit')),
  next_action_location text,

  -- order closure (filled when Won / Lost)
  order_value numeric(12,2),
  closing_date date,
  project_details text,
  loss_reason text,
  competitor_name text,

  -- campaign / ad tracking (Meta, Google, website)
  campaign_name text,
  ad_name text,
  ad_id text,
  form_name text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  gclid text,
  external_lead_id text,

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_leads_assigned_to on leads(assigned_to);
create index idx_leads_status on leads(status);
create index idx_leads_source on leads(source);
create index idx_leads_next_followup on leads(next_followup_date);
create index idx_leads_mobile on leads(mobile);
-- lets a Meta/Google webhook insert with "on conflict do nothing" so a retried
-- delivery never creates the same lead twice (manual leads keep NULL here)
create unique index idx_leads_external_lead_id on leads(external_lead_id) where external_lead_id is not null;

-- 2.4 follow-up + call history
create table followup_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  followup_date timestamptz not null default now(),
  remarks text,
  status lead_status,
  action_type text not null default 'call' check (action_type in ('call', 'meeting', 'visit')),
  location text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index idx_followup_lead_id on followup_history(lead_id);

create table call_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  call_date timestamptz not null default now(),
  duration_seconds integer,
  remarks text,
  attachments jsonb not null default '[]'::jsonb,   -- [{ "name": "...", "url": "..." }]
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index idx_call_lead_id on call_history(lead_id);

-- 2.5 orders + customers
create sequence order_number_seq start 1000;

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique,
  lead_id uuid references leads(id) on delete set null,
  company text,
  order_value numeric(12,2),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  order_date date not null default current_date,
  delivery_date date,
  project_details text,
  paid_amount numeric(12,2) not null default 0,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'partial', 'paid')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_orders_lead_id on orders(lead_id);
create index idx_orders_status on orders(status);
create index idx_orders_created_by on orders(created_by);

create table customers (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid unique references leads(id) on delete set null,
  company_name text,
  contact_name text,
  mobile text,
  email text,
  created_at timestamptz not null default now()
);
create index idx_customers_lead_id on customers(lead_id);

-- 2.6 quotations
create sequence quotation_number_seq start 1000;

create table quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_number text unique,
  lead_id uuid references leads(id) on delete set null,
  company text,
  description text,
  amount numeric(12,2),               -- grand total
  subtotal numeric(12,2),
  discount_total numeric(12,2),
  tax_total numeric(12,2),
  valid_until date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  terms text,
  product_id uuid references products(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  attachments jsonb not null default '[]'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_quotations_lead_id on quotations(lead_id);
create index idx_quotations_status on quotations(status);

create table quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references quotations(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  item_name text not null,
  quantity numeric(10,2) not null default 1,
  rate numeric(12,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  tax_percent numeric(5,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index idx_quotation_items_quotation_id on quotation_items(quotation_id);

-- 2.7 payments
create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  amount numeric(12,2) not null,
  payment_date date not null default current_date,
  payment_mode text not null default 'cash'
    check (payment_mode in ('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other')),
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index idx_payments_order_id on payments(order_id);

-- 2.8 notifications (in-app bell)
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  type text not null default 'assignment',
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notifications_user on notifications(user_id, is_read);

-- 2.9 login / logout tracking
create table login_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  login_at timestamptz not null default now(),
  logout_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_login_history_user_id on login_history(user_id);
create index idx_login_history_login_at on login_history(login_at);

-- 2.10 lead add / delete activity log (keeps a snapshot after a lead is deleted,
--      so it deliberately has NO foreign key on lead_id)
create table lead_activity_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null,
  lead_name text,
  company text,
  mobile text,
  action text not null check (action in ('created', 'deleted')),
  performed_by uuid references profiles(id) on delete set null,
  performed_by_name text,
  created_at timestamptz not null default now()
);
create index idx_lead_activity_log_created_at on lead_activity_log(created_at desc);


-- ----------------------------------------------------------------------------
-- 3. FUNCTIONS + TRIGGERS
-- ----------------------------------------------------------------------------

-- 3.1 keep updated_at fresh
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_leads_updated_at      before update on leads      for each row execute function set_updated_at();
create trigger trg_orders_updated_at     before update on orders     for each row execute function set_updated_at();
create trigger trg_quotations_updated_at before update on quotations for each row execute function set_updated_at();
create trigger trg_products_updated_at   before update on products   for each row execute function set_updated_at();

-- 3.2 every new Supabase Auth user gets a profile row.
--     Role is always 'bde' here; the create-user Edge Function sets the real
--     role right after creating the user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    'bde'
  );
  return new;
end;
$$;

create trigger trg_on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 3.3 ORD-1000 / QUO-1000 numbering
create or replace function generate_order_number()
returns trigger
language plpgsql
as $$
begin
  if new.order_number is null then
    new.order_number := 'ORD-' || nextval('order_number_seq');
  end if;
  return new;
end;
$$;
create trigger trg_orders_order_number before insert on orders for each row execute function generate_order_number();

create or replace function generate_quotation_number()
returns trigger
language plpgsql
as $$
begin
  if new.quotation_number is null then
    new.quotation_number := 'QUO-' || nextval('quotation_number_seq');
  end if;
  return new;
end;
$$;
create trigger trg_quotations_number before insert on quotations for each row execute function generate_quotation_number();

-- 3.4 lead marked "Won Order" -> create its order + customer record
create or replace function auto_create_order_on_won()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'won_order' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if not exists (select 1 from orders where lead_id = new.id) then
      insert into orders (lead_id, company, order_value, status, project_details, created_by)
      values (new.id, new.company, new.order_value, 'pending', new.project_details, new.assigned_to);
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_auto_create_order
after insert or update of status on leads
for each row execute function auto_create_order_on_won();

create or replace function auto_create_customer_on_won()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'won_order' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if not exists (select 1 from customers where lead_id = new.id) then
      insert into customers (lead_id, company_name, contact_name, mobile, email)
      values (new.id, new.company, new.lead_name, new.mobile, new.email);
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_auto_create_customer
after insert or update of status on leads
for each row execute function auto_create_customer_on_won();

-- 3.5 notify a user when a lead is assigned / reassigned to them
create or replace function notify_lead_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is not null and (
    tg_op = 'INSERT' or old.assigned_to is distinct from new.assigned_to
  ) then
    insert into notifications (user_id, lead_id, type, message)
    values (
      new.assigned_to,
      new.id,
      'assignment',
      'You have been assigned a new lead: ' || new.lead_name ||
        case when new.company is not null then ' (' || new.company || ')' else '' end
    );
  end if;
  return new;
end;
$$;
create trigger trg_notify_lead_assignment
after insert or update of assigned_to on leads
for each row execute function notify_lead_assignment();

-- 3.6 remember WHEN a lead was last assigned (Reports Hub)
create or replace function set_lead_assigned_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is not null and (
    tg_op = 'INSERT' or old.assigned_to is distinct from new.assigned_to
  ) then
    new.assigned_at := now();
  end if;
  return new;
end;
$$;
create trigger trg_set_lead_assigned_at
before insert or update of assigned_to on leads
for each row execute function set_lead_assigned_at();

-- 3.7 auto-assign: a lead created with NO assignee from any source other than a
--     manual entry (bulk upload, Meta/Google ads, website, IndiaMART ...) goes to
--     the active Sales/BDE user who currently holds the fewest leads.
--     NOTE: trigger names matter — Postgres fires same-table BEFORE INSERT
--     triggers alphabetically, so "trg_auto_assign_lead" runs BEFORE
--     "trg_set_lead_assigned_at" and assigned_at is stamped correctly.
create or replace function auto_assign_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user uuid;
begin
  if new.assigned_to is null and new.source is distinct from 'manual_entry'::lead_source then
    select p.id into target_user
    from profiles p
    where p.role in ('sales', 'bde') and p.is_active = true
    order by (select count(*) from leads l where l.assigned_to = p.id) asc, p.full_name asc
    limit 1;

    if target_user is not null then
      new.assigned_to := target_user;
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_auto_assign_lead
before insert on leads
for each row execute function auto_assign_lead();

-- 3.8 keep orders.paid_amount / payment_status in sync with the payments table
create or replace function recompute_order_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order_id uuid;
  total_paid numeric(12,2);
  v_order_value numeric(12,2);
  new_status text;
begin
  target_order_id := coalesce(new.order_id, old.order_id);

  select coalesce(sum(amount), 0) into total_paid from payments where order_id = target_order_id;
  select o.order_value into v_order_value from orders o where o.id = target_order_id;

  if v_order_value is null or v_order_value <= 0 then
    new_status := case when total_paid > 0 then 'partial' else 'pending' end;
  elsif total_paid <= 0 then
    new_status := 'pending';
  elsif total_paid >= v_order_value then
    new_status := 'paid';
  else
    new_status := 'partial';
  end if;

  update orders set paid_amount = total_paid, payment_status = new_status where id = target_order_id;
  return null;
end;
$$;
create trigger trg_payments_after_change
after insert or update or delete on payments
for each row execute function recompute_order_payment_status();

-- 3.9 lead add / delete activity log
create or replace function log_lead_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
begin
  if tg_op = 'INSERT' then
    select full_name into actor_name from profiles where id = new.created_by;
    insert into lead_activity_log (lead_id, lead_name, company, mobile, action, performed_by, performed_by_name)
    values (new.id, new.lead_name, new.company, new.mobile, 'created', new.created_by, actor_name);
    return new;
  elsif tg_op = 'DELETE' then
    select full_name into actor_name from profiles where id = auth.uid();
    insert into lead_activity_log (lead_id, lead_name, company, mobile, action, performed_by, performed_by_name)
    values (old.id, old.lead_name, old.company, old.mobile, 'deleted', auth.uid(), actor_name);
    return old;
  end if;
  return null;
end;
$$;
create trigger trg_log_lead_created after insert on leads for each row execute function log_lead_activity();
create trigger trg_log_lead_deleted after delete on leads for each row execute function log_lead_activity();


-- ----------------------------------------------------------------------------
-- 4. REALTIME — lets the notification bell update instantly
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when duplicate_object then null;
    end;
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 5. STORAGE — file uploads (call recordings + quotation attachments)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('quotation-files', 'quotation-files', true),
       ('call-recordings', 'call-recordings', true)
on conflict (id) do nothing;

-- Logged-in users can upload / read / replace / remove files in these two
-- buckets; because the buckets are public, anyone holding a file's link can view it.
create policy "crm-files: authenticated can upload" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('quotation-files', 'call-recordings'));

create policy "crm-files: authenticated can read" on storage.objects
  for select to authenticated
  using (bucket_id in ('quotation-files', 'call-recordings'));

create policy "crm-files: public can read" on storage.objects
  for select to public
  using (bucket_id in ('quotation-files', 'call-recordings'));

create policy "crm-files: authenticated can update" on storage.objects
  for update to authenticated
  using (bucket_id in ('quotation-files', 'call-recordings'));

create policy "crm-files: authenticated can delete" on storage.objects
  for delete to authenticated
  using (bucket_id in ('quotation-files', 'call-recordings'));


-- ----------------------------------------------------------------------------
-- 6. API ACCESS — only logged-in users and the server (service_role) may touch
--    the app tables. The public "anon" key gets nothing, so someone who copies
--    the key out of the website still cannot read or write any data.
-- ----------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;


-- ============================================================================
-- DONE.  Next (see SETUP_GUIDE.md):
--   a) Authentication -> Users -> "Add user" for the first admin
--   b) then run:
--        update profiles set role = 'admin' where email = 'ADMIN_EMAIL_HERE';
--   c) deploy the two Edge Functions, fill .env, run the app
-- ============================================================================
