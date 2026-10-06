-- Mirror of Connecteam's "Tools & PPE Order Request" form, one row per
-- request, including the manager's status and note, so the dashboard and
-- Eleven can show what is still open. Filled only by the server-side sync
-- (service role), so RLS is on with no policy for logged-in users.

create table if not exists ppe_requests (
  submission_id     text primary key,
  form_id           bigint not null,
  submitted_at      timestamptz not null,
  submitter_user_id bigint,
  items             text[] not null default '{}',
  quantity          integer,
  spray_suit_sizes  text[] not null default '{}',
  other_text        text,
  date_required     timestamptz,
  status            text,
  status_updated_at timestamptz,
  manager_note      text,
  synced_at         timestamptz not null default now()
);

create index if not exists ppe_requests_submitted_idx on ppe_requests (submitted_at desc);
create index if not exists ppe_requests_status_idx on ppe_requests (status);

alter table ppe_requests enable row level security;
