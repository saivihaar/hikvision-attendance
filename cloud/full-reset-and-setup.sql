-- FULL RESET: drops and recreates every table for this project.
-- This wipes any previously synced people/events data. Run once in Supabase's
-- SQL Editor. After running this, tell the assistant so it can re-run
-- SyncPeople/SyncEvents and backfill attendance history from the device.

drop view if exists current_status;
drop table if exists events;
drop table if exists sync_state;
drop table if exists people;

-- People enrolled on the device, mirrored to the cloud.
-- shift_type/expected_in_time/expected_out_time support night-shift staff
-- whose "day" runs overnight (e.g. in 6:30-7pm, out 9-9:30am next morning).
create table people (
  employee_no        text primary key,
  name                text not null,
  active              boolean not null default true,
  shift_type          text not null default 'day' check (shift_type in ('day', 'night')),
  expected_in_time    time,
  expected_out_time   time,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Raw attendance/verification events pulled from the device's AcsEvent search.
-- employee_no is intentionally NOT a foreign key to people: historical events
-- must stay valid even after someone is removed or the device renumbers users.
create table events (
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
  -- door_no intentionally excluded: the device reports it inconsistently
  -- (present via polling, absent via the live event stream for some minor
  -- codes), which caused the same physical scan to insert as two rows.
  unique (device_serial, employee_no, event_time, minor)
);
create index events_employee_time_idx on events (employee_no, event_time desc);
create index events_time_idx on events (event_time desc);

-- Cursor bookkeeping for the local sync agent.
create table sync_state (
  device_serial            text primary key,
  last_synced_time         timestamptz not null,
  updated_at               timestamptz not null default now()
);

-- Computed "currently in/out" status per person.
-- HEURISTIC, not device truth: this device does not support hardware check-in/check-out
-- distinction, so we alternate IN/OUT per successful scan per person per shift-day.
-- For 'night' shift people, a shift-day runs from evening to the next morning:
-- any scan before noon local time is attributed to the PREVIOUS calendar date's
-- shift, so an evening check-in and next-morning check-out pair up correctly.
create or replace view current_status
with (security_invoker = true) as
with ranked as (
  select
    e.employee_no,
    p.name,
    p.shift_type,
    e.event_time,
    e.event_type,
    row_number() over (
      partition by e.employee_no,
        case
          when p.shift_type = 'night' and extract(hour from (e.event_time at time zone 'Asia/Kolkata')) < 12
            then ((e.event_time at time zone 'Asia/Kolkata')::date - interval '1 day')::date
          else (e.event_time at time zone 'Asia/Kolkata')::date
        end
      order by e.event_time asc
    ) as scan_seq
  from events e
  join people p on p.employee_no = e.employee_no
  where e.event_type in ('face_success','card_success','fingerprint_success')
),
latest as (
  select distinct on (employee_no) employee_no, name, shift_type, event_time, event_type, scan_seq
  from ranked
  order by employee_no, event_time desc
)
select
  l.employee_no, l.name, l.shift_type,
  l.event_time as last_event_time,
  l.event_type as last_event_type,
  case when l.scan_seq % 2 = 1 then 'IN' else 'OUT' end as status,
  p.expected_in_time, p.expected_out_time
from latest l
join people p on p.employee_no = l.employee_no;

-- Row Level Security: logged-in (authenticated) users get read-only access.
-- The local sync agent writes using the service_role key, which bypasses RLS entirely.
alter table people enable row level security;
alter table events enable row level security;
alter table sync_state enable row level security;

create policy "authenticated read people" on people
  for select using (auth.role() = 'authenticated');
create policy "authenticated read events" on events
  for select using (auth.role() = 'authenticated');
create policy "authenticated read sync_state" on sync_state
  for select using (auth.role() = 'authenticated');

-- people table is empty right after this reset - the assistant will re-run
-- SyncPeople/SyncEvents next to repopulate it and mark Ramesh/Shekhar as
-- night shift, then backfill attendance history from the device.
