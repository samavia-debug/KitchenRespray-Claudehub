-- Trade Sales CRM (phase 6): AI assistance. The AI writes drafts and suggestions from facts the CRM supplies, so the
-- wording it may rely on for "who we are and what we offer" is kept here, written and approved by an Admin, rather
-- than left for the AI to make up. One row only. Same access model as the rest of the CRM: server routes only, RLS on
-- with no policy for logged-in users. Safe to re-run.
--
-- How much each person uses the AI is counted from crm_events (action = 'ai_request', counts only, never content).

create table if not exists crm_ai_settings (
  id              integer primary key default 1,
  -- Facts about Kitchen Respray that a draft may state (what we do, where, what makes us different).
  about_us        text,
  -- An approved example message. When set, drafts follow its structure and wording.
  intro_template  text,
  -- How messages should sound, e.g. "friendly and plain, no hard sell".
  tone            text,
  -- Things never to say or promise.
  avoid           text,
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  constraint crm_ai_settings_single_row check (id = 1)
);

alter table crm_ai_settings enable row level security;
