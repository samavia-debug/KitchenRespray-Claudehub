-- Lets a knowledge entry be owned by an external system (e.g. Connecteam
-- staff records), so a re-sync updates the same entry instead of creating
-- a duplicate. Manually written entries leave both columns null; Postgres
-- treats nulls as distinct in a unique constraint, so they never collide.

alter table knowledge_entries add column if not exists external_source text;
alter table knowledge_entries add column if not exists external_id text;

alter table knowledge_entries
  drop constraint if exists knowledge_entries_external_key;
alter table knowledge_entries
  add constraint knowledge_entries_external_key unique (external_source, external_id);
