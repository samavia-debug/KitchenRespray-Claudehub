-- Trade Sales CRM: the fixed WhatsApp wording used by the send queue. Two messages (the first one and the follow-up),
-- each with blanks the queue fills in for every company. Written by an Admin. One row only. Same access model as the
-- rest of the CRM: server routes only, RLS on with no policy for logged-in users. Each statement stands alone and the
-- script is safe to re-run.

create table if not exists crm_whatsapp_settings (
  id             integer primary key default 1,
  first_message  text,
  follow_up      text,
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  constraint crm_whatsapp_settings_single_row check (id = 1)
);

alter table crm_whatsapp_settings enable row level security;
