-- Mirror of Connecteam's "Weekly Driver's Vehicle Inspection Report" form,
-- one row per submission, so the dashboard and Eleven can query it
-- (latest odometer per van, who hasn't submitted this week, defect history).
-- Filled only by the server-side sync using the service role, so like
-- google_connections it has RLS on and no policy for logged-in users.

create table if not exists vehicle_inspections (
  submission_id     text primary key,
  form_id           bigint not null,
  submitted_at      timestamptz not null,
  inspected_at      timestamptz,
  submitter_user_id bigint,
  driver_name       text,
  vehicle_reg       text not null,
  vehicle_key       text not null,
  make_model        text,
  odometer_text     text,
  odometer_km       integer,
  trip_type         text,
  defects           text[] not null default '{}',
  safety_equipment_ok boolean,
  condition_ok      boolean,
  remarks           text,
  synced_at         timestamptz not null default now()
);

create index if not exists vehicle_inspections_vehicle_idx
  on vehicle_inspections (vehicle_key, submitted_at desc);
create index if not exists vehicle_inspections_submitted_idx
  on vehicle_inspections (submitted_at desc);

alter table vehicle_inspections enable row level security;
