-- Fleet: tax, DOE and insurance dates read from the "Documents" tab in Connecteam.
--
-- Connecteam keeps these documents per person (the driver), not per van, so each van is linked to a
-- Connecteam person by id. The sync fills the link in by first name where it is unambiguous; the Fleet
-- page lets an Admin pick the person where it is not.
--
-- tax/doe/insurance_from_connecteam record that the date shown came from Connecteam, so the page can say so.
-- dates_synced_at is when the dates were last read, which the Connecteam cron uses to decide when to run again.

alter table fleet_vans
  add column if not exists connecteam_user_id bigint,
  add column if not exists tax_from_connecteam boolean not null default false,
  add column if not exists doe_from_connecteam boolean not null default false,
  add column if not exists insurance_from_connecteam boolean not null default false,
  add column if not exists dates_synced_at timestamptz;
