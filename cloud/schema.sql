-- Hikvision attendance dashboard schema.
-- Run this once in Supabase's SQL Editor (Project -> SQL Editor -> New query -> paste -> Run).

-- People enrolled on the device, mirrored to the cloud
create table if not exists people (
  employee_no   text primary key,
  name          text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Raw attendance/verification events pulled from the device's AcsEvent search
-- employee_no is intentionally NOT a foreign key to people: historical events
-- must stay valid even after someone is removed or the device renumbers users
-- (this happened in practice - a test user was deleted and its old events
-- would otherwise fail to sync). The dashboard left-joins to people and just
-- shows the raw employee_no if no matching name is found.
create table if not exists events (
  id                   bigserial primary key,
  employee_no          text not null,
  event_time           timestamptz not null,
  major                int not null,
  minor                int not null,
  event_type           text not null,   -- 'face_success' | 'card_success' | 'fingerprint_success' | 'face_fail' | 'other'
  verify_mode          text,
  door_no              int,
  device_serial        text not null default 'DSK1T320EFWX20221110V030500ENL43488191',
  raw                  jsonb,
  synced_at            timestamptz not null default now(),
  unique (device_serial, employee_no, event_time, minor, door_no)
);
create index if not exists events_employee_time_idx on events (employee_no, event_time desc);
create index if not exists events_time_idx on events (event_time desc);

-- Cursor bookkeeping for the local sync agent
create table if not exists sync_state (
  device_serial            text primary key,
  last_synced_time         timestamptz not null,
  updated_at               timestamptz not null default now()
);

-- Computed "currently in/out" status per person.
-- HEURISTIC, not device truth: this device does not support hardware check-in/check-out
-- distinction, so we alternate IN/OUT per successful scan per person per local day.
-- Ignores 'face_fail' and any event_type not in the success list below.
create or replace view current_status
with (security_invoker = true) as
with ranked as (
  select
    e.employee_no,
    p.name,
    e.event_time,
    e.event_type,
    row_number() over (
      partition by e.employee_no, (e.event_time at time zone 'Asia/Kolkata')::date
      order by e.event_time asc
    ) as scan_seq
  from events e
  join people p on p.employee_no = e.employee_no
  where e.event_type in ('face_success','card_success','fingerprint_success')
),
latest as (
  select distinct on (employee_no) employee_no, name, event_time, event_type, scan_seq
  from ranked
  order by employee_no, event_time desc
)
select
  employee_no, name,
  event_time as last_event_time,
  event_type as last_event_type,
  case when scan_seq % 2 = 1 then 'IN' else 'OUT' end as status
from latest;

-- Row Level Security: logged-in (authenticated) users get read-only access.
-- The local sync agent writes using the service_role key, which bypasses RLS entirely.
alter table people enable row level security;
alter table events enable row level security;
alter table sync_state enable row level security;

drop policy if exists "authenticated read people" on people;
create policy "authenticated read people" on people
  for select using (auth.role() = 'authenticated');

drop policy if exists "authenticated read events" on events;
create policy "authenticated read events" on events
  for select using (auth.role() = 'authenticated');

drop policy if exists "authenticated read sync_state" on sync_state;
create policy "authenticated read sync_state" on sync_state
  for select using (auth.role() = 'authenticated');

-- Intentionally no insert/update/delete policy for 'authenticated' - the dashboard is read-only.
