/**
 * HRMS Postgres schema, applied automatically the first time the server
 * connects to an empty database (see connectDB in db.js). Point DATABASE_URL
 * at a fresh Supabase project and the server provisions everything itself:
 * tables → default leave policy → the one admin account from ADMIN_EMAIL /
 * ADMIN_PASSWORD. No manual SQL or seed step.
 *
 * Every table has RLS enabled with NO policies, so Supabase's auto-generated
 * Data API (anon/authenticated roles) can read nothing. The Express server
 * connects as the role in DATABASE_URL — the default `postgres` role owns the
 * tables and so is exempt from RLS. If you ever switch DATABASE_URL to a
 * non-owner role, grant it table access and add policies for it first.
 */

const SCHEMA_SQL = /* sql */ `
create extension if not exists pgcrypto;

-- Shared updated_at maintenance for all tables.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
alter function public.set_updated_at() set search_path = '';

create table employment_types (
  id uuid primary key default gen_random_uuid(),
  name varchar(60) not null,
  quotas jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table leave_types (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label varchar(60) not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  employee_id text unique,
  -- Null while the account is a pending invite (status 'invited') — the
  -- person sets their own password when they register via their invite link.
  password_hash text,
  status text not null default 'active' check (status in ('active','invited')),
  invite_token_hash text,
  invite_expires_at timestamptz,
  -- Self-service password reset (same hashed-token scheme as invites: the raw
  -- token exists only inside the emailed link).
  reset_token_hash text,
  reset_expires_at timestamptz,
  role text not null default 'employee' check (role in ('employee','manager','admin')),
  designation text not null default '',
  department text not null default '',
  joining_date timestamptz,
  manager_id uuid references users(id) on delete set null,
  employment_type_id uuid references employment_types(id) on delete set null,
  photo_url text not null default '',
  dob timestamptz,
  address varchar(300) not null default '',
  phone varchar(20) not null default '',
  education varchar(500) not null default '',
  aadhar_number varchar(12) not null default ''
    check (aadhar_number = '' or aadhar_number ~ '^\\d{12}$'),
  leave_balances jsonb not null default '{}'::jsonb,
  leave_quotas jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index users_manager_id_idx on users (manager_id);

create table teams (
  id uuid primary key default gen_random_uuid(),
  name varchar(60) not null,
  manager_id uuid not null references users(id) on delete cascade,
  member_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index teams_manager_id_idx on teams (manager_id);

create table leaves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null default 'leave' check (kind in ('leave','wfh')),
  type text check (kind <> 'leave' or type is not null),
  start_date timestamptz not null,
  end_date timestamptz not null,
  day_part text not null default 'full' check (day_part in ('full','first','second')),
  start_time text not null default '',
  end_time text not null default '',
  days numeric not null check (days >= 0.5),
  reason text not null default '',
  -- 'cancelled' = an APPROVED request withdrawn by its owner before the start
  -- date (pending ones are deleted outright instead — nothing to keep).
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  approver_id uuid references users(id) on delete set null,
  decided_at timestamptz,
  decision_comment text not null default '',
  cancel_reason varchar(300) not null default '',
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leaves_user_id_idx on leaves (user_id);
create index leaves_status_idx on leaves (status);
create index leaves_range_idx on leaves (start_date, end_date);

create table work_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  date text not null check (date ~ '^\\d{4}-\\d{2}-\\d{2}$'),
  events jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active','completed','auto_closed')),
  worked_seconds integer not null default 0,
  day_status text check (day_status in ('present','leave')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);
create index work_sessions_date_idx on work_sessions (date);
create index work_sessions_open_idx on work_sessions (status, date);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  title varchar(140) not null,
  body varchar(2000) not null,
  type text not null default 'announcement' check (type in ('announcement','urgent')),
  author_id uuid not null references users(id) on delete cascade,
  audience_scope text not null check (audience_scope in ('all','role','team','group')),
  audience_role text check (audience_role in ('employee','manager','admin')),
  audience_root_id uuid references users(id) on delete set null,
  audience_group_id uuid references teams(id) on delete set null,
  read_by uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index announcements_created_at_idx on announcements (created_at desc);

create table documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name varchar(200) not null,
  mime_type text not null,
  size integer not null check (size >= 0),
  data_url text not null,
  uploaded_by_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_user_id_idx on documents (user_id);

-- Enforced singleton.
create table app_settings (
  id smallint primary key default 1 check (id = 1),
  feedback_form_url varchar(2048) not null default '',
  hr_request_form_url varchar(2048) not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only request/audit trail behind the admin System Logs page: one row
-- per API call, 30-day retention (swept opportunistically — no cron on the
-- free tier). Deliberately no updated_at / trigger: rows are never updated,
-- and there is no write API — the audit trail must not be editable. Bodies,
-- query strings and headers are never stored (see middleware/requestLog.js).
create table request_logs (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  method varchar(10) not null,
  path varchar(300) not null,
  status integer not null check (status between 100 and 599),
  duration_ms integer check (duration_ms >= 0),
  user_email varchar(254),
  user_role varchar(20),
  ip varchar(64),
  error_code varchar(30),
  error_message varchar(500)
);
create index request_logs_ts_idx on request_logs (ts desc);

-- updated_at triggers on every table.
do $$
declare t text;
begin
  foreach t in array array['employment_types','leave_types','users','teams','leaves',
                           'work_sessions','announcements','documents','app_settings']
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end $$;

-- Lock every table away from the Supabase Data API roles (anon/authenticated):
-- RLS on, and deliberately NO policies for those roles.
alter table employment_types enable row level security;
alter table leave_types enable row level security;
alter table users enable row level security;
alter table teams enable row level security;
alter table leaves enable row level security;
alter table work_sessions enable row level security;
alter table announcements enable row level security;
alter table documents enable row level security;
alter table app_settings enable row level security;
alter table request_logs enable row level security;
`

/**
 * Idempotent catch-up DDL for databases created before a schema change —
 * every statement is a no-op when the column/constraint already exists, so
 * running it on each cold start is safe and keeps old databases current
 * without a migration tool. Fresh installs get the same shape from
 * SCHEMA_SQL directly.
 */
const MIGRATIONS_SQL = /* sql */ `
-- Invite-based onboarding (2026-08): admin adds people without a password;
-- they set their own when they register through their invite link.
alter table users alter column password_hash drop not null;
alter table users add column if not exists status text not null default 'active';
alter table users add column if not exists invite_token_hash text;
alter table users add column if not exists invite_expires_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_status_check') then
    alter table users add constraint users_status_check check (status in ('active','invited'));
  end if;
end $$;

-- Self-service password reset (2026-08): emailed single-use link, hashed
-- token at rest — same scheme as invite links above.
alter table users add column if not exists reset_token_hash text;
alter table users add column if not exists reset_expires_at timestamptz;

-- Cancellable approved leaves (2026-08): owners may withdraw an approved
-- request before it starts — kept as status 'cancelled' with their reason,
-- balance refunded (see DELETE /api/leaves/:id).
alter table leaves add column if not exists cancel_reason varchar(300) not null default '';
alter table leaves add column if not exists cancelled_at timestamptz;
do $$ begin
  if exists (select 1 from pg_constraint
              where conname = 'leaves_status_check'
                and pg_get_constraintdef(oid) not like '%cancelled%') then
    alter table leaves drop constraint leaves_status_check;
    alter table leaves add constraint leaves_status_check
      check (status in ('pending','approved','rejected','cancelled'));
  end if;
end $$;

-- Admin System Logs (2026-08): append-only request/audit trail, 30-day
-- retention. Same shape and rationale as the SCHEMA_SQL definition above.
create table if not exists request_logs (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  method varchar(10) not null,
  path varchar(300) not null,
  status integer not null check (status between 100 and 599),
  duration_ms integer check (duration_ms >= 0),
  user_email varchar(254),
  user_role varchar(20),
  ip varchar(64),
  error_code varchar(30),
  error_message varchar(500)
);
create index if not exists request_logs_ts_idx on request_logs (ts desc);
alter table request_logs enable row level security;
`

/**
 * Creates the schema if this database doesn't have it yet (detected by the
 * presence of the users table), or applies idempotent catch-up migrations if
 * it does. An advisory lock serializes concurrent cold starts so only one
 * instance runs the DDL; the others wait, re-check, and find the tables
 * already there.
 */
export async function ensureSchema(pool) {
  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock(727270001)')
    const { rows } = await client.query("select to_regclass('public.users') as users_table")
    if (!rows[0].users_table) {
      await client.query(SCHEMA_SQL)
      console.log('[db] empty database — created HRMS schema')
    } else {
      await client.query(MIGRATIONS_SQL)
    }
  } finally {
    try {
      await client.query('select pg_advisory_unlock(727270001)')
    } finally {
      client.release()
    }
  }
}
