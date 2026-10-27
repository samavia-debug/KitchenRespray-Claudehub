-- Letter Writer signers: the people who sign letters. A typed name and job title, and optionally a picture of
-- their signature, which a finalised letter places above the typed name.
--
-- A signature picture is sensitive, so the table is read and written only through server routes that check the
-- user is an Admin (service role): RLS is on with no policy for logged-in users, like the letters tables. The
-- picture is a small PNG or JPEG kept here as base64 text (the routes limit it to 300 KB), so it needs no storage
-- bucket. It is never included in a list of signers; it is fetched on its own.

create table if not exists letter_signers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  title         text,
  image_base64  text,
  image_type    text,
  image_width   integer,
  image_height  integer,
  is_default    boolean not null default false,
  active        boolean not null default true,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint letter_signers_image_type_check check (image_type is null or image_type in ('png', 'jpeg'))
);

-- At most one default signer.
create unique index if not exists letter_signers_one_default on letter_signers (is_default) where is_default;

alter table letter_signers enable row level security;
