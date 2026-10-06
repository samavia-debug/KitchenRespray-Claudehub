-- Connecteam's rota (scheduled shifts), so the dashboard can tell who was
-- meant to start when: late arrivals, people who haven't clocked in, and how
-- much of each shift's checklist was ticked. Filled only by the server-side
-- sync (service role), so RLS is on with no policy for logged-in users.
--
-- Deliberately NOT stored: the shift title, location and notes, which can
-- name a customer or an address. Only counts of the checklist are kept.

create table if not exists scheduled_shifts (
  shift_id          text primary key,
  scheduler_id      bigint not null,
  start_at          timestamptz not null,
  end_at            timestamptz not null,
  assigned_user_ids bigint[] not null default '{}',
  is_open           boolean not null default false,
  is_published      boolean not null default true,
  job_id            text,
  tasks_total       integer not null default 0,
  tasks_done        integer not null default 0,
  synced_at         timestamptz not null default now()
);

create index if not exists scheduled_shifts_start_idx on scheduled_shifts (start_at);

alter table scheduled_shifts enable row level security;
