-- Letter Writer: customer letters and quotes.
--
--  * Two new kinds of letter, 'sales_letter' and 'quote', for customers rather than staff. Managers and Staff may write
--    these (the routes check the role by kind of letter); letters about staff stay with Admins.
--  * A quote keeps its lines, VAT rates, validity date, terms and number in a `quote` column.
--  * Quote numbers come from one sequence for the whole company (Q1001, Q1002, ...), taken only by the server.
--  * A signer can be marked for sales documents, so Managers and Staff can use their signature picture on customer
--    letters and quotes; every other signer stays Admin-only.

alter table letters drop constraint if exists letters_type_check;
alter table letters add constraint letters_type_check check (letter_type in (
  'employment_confirmation', 'employment_reference', 'technician_introduction', 'work_assignment',
  'experience_confirmation', 'warning', 'general_business', 'custom', 'sales_letter', 'quote'
));

alter table letters add column if not exists quote jsonb not null default '{}'::jsonb;

alter table letter_templates drop constraint if exists letter_templates_type_check;
alter table letter_templates add constraint letter_templates_type_check check (letter_type in (
  'employment_confirmation', 'employment_reference', 'technician_introduction', 'work_assignment',
  'experience_confirmation', 'warning', 'general_business', 'custom', 'sales_letter', 'quote'
));

alter table letter_signers add column if not exists for_sales boolean not null default false;

create sequence if not exists quote_number_seq start 1001;

create or replace function next_quote_number() returns bigint
language sql
as $$ select nextval('quote_number_seq') $$;

-- Only the server (service role) may take a number.
revoke execute on function next_quote_number() from public, anon, authenticated;
grant execute on function next_quote_number() to service_role;
