-- Connecteam time clock (one row per clock-in/out), the clock's job types,
-- and approved time off, so the dashboard and Eleven can total hours and
-- show who is off. Filled only by the server-side sync (service role), so
-- RLS is on with no policy for logged-in users.
--
-- Deliberately NOT stored: shift photos/attachments, any location data, and
-- the employee's free-text note on a leave request (can hold health details).

create table if not exists time_clock_shifts (
  shift_id           text primary key,
  clock_id           bigint not null,
  user_id            bigint not null,
  started_at         timestamptz not null,
  ended_at           timestamptz,
  job_id             text,
  scheduler_shift_id text,
  start_source       text,
  end_source         text,
  is_auto_clock_out  boolean not null default false,
  synced_at          timestamptz not null default now()
);

create index if not exists time_clock_shifts_started_idx on time_clock_shifts (started_at desc);
create index if not exists time_clock_shifts_user_idx on time_clock_shifts (user_id, started_at desc);

create table if not exists connecteam_jobs (
  job_id     text primary key,
  title      text not null,
  is_deleted boolean not null default false,
  synced_at  timestamptz not null default now()
);

create table if not exists time_off_requests (
  request_id     text primary key,
  user_id        bigint not null,
  policy_type_id text,
  leave_type     text not null,
  status         text not null,
  is_all_day     boolean not null default true,
  duration_days  numeric,
  start_date     date not null,
  end_date       date not null,
  start_time     text,
  end_time       text,
  synced_at      timestamptz not null default now()
);

create index if not exists time_off_requests_start_idx on time_off_requests (start_date);
create index if not exists time_off_requests_user_idx on time_off_requests (user_id, start_date);

alter table time_clock_shifts enable row level security;
alter table connecteam_jobs enable row level security;
alter table time_off_requests enable row level security;
