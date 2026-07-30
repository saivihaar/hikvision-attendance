-- Adds night-shift support: shift type + expected in/out times per person,
-- and fixes the live-status view so overnight shifts (e.g. check in 6:30pm,
-- check out 9am next day) are grouped as one shift instead of split across
-- two calendar days.
-- Run this once in Supabase's SQL Editor.

alter table people add column if not exists shift_type text not null default 'day' check (shift_type in ('day', 'night'));
alter table people add column if not exists expected_in_time time;
alter table people add column if not exists expected_out_time time;

-- Ramesh (006) and Shekhar (005): night shift, in by 7:00 PM, out by 9:30 AM.
-- Adjust employee_no values here if they change on the device later.
update people set shift_type = 'night', expected_in_time = '19:00', expected_out_time = '09:30'
where employee_no in ('005', '006');

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
  where e.event_type in ('face_success', 'card_success', 'fingerprint_success')
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
