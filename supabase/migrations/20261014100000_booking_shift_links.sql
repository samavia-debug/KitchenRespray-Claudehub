-- Microsoft Bookings -> Connecteam: which booking became which Connecteam shift.
-- The link is what stops a booking being copied twice and lets a rescheduled or
-- cancelled booking update or remove the right shift. No customer details are
-- stored here: only the booking's id, the shift it became, the showroom/service
-- name, the times and the title that was written to Connecteam.
--
-- Written and read only by server code (service role), so RLS is on with no policy.

create table if not exists booking_shift_links (
  booking_id    text primary key,
  shift_id      text not null,
  scheduler_id  bigint not null,
  service       text,
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  title         text not null,
  -- What was last written, so a change in times, title or assignees is noticed.
  signature     text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists booking_shift_links_start_idx on booking_shift_links (start_at);

-- One row: stops a scheduled run and a manual run from copying the same bookings
-- at the same time, and remembers how the last run went.
create table if not exists booking_sync_state (
  id             integer primary key default 1,
  running_since  timestamptz,
  last_run_at    timestamptz,
  last_result    jsonb,
  constraint booking_sync_state_single_row check (id = 1)
);

insert into booking_sync_state (id) values (1) on conflict (id) do nothing;

alter table booking_shift_links enable row level security;
alter table booking_sync_state enable row level security;
