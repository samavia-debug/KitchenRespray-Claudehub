-- A booking can now be copied into more than one Connecteam schedule (the Showroom
-- Appointment schedule and, optionally, the main Schedule), so a link is per
-- booking AND per schedule instead of per booking only. Existing rows are all for
-- the Showroom Appointment schedule and stay valid.

alter table booking_shift_links drop constraint if exists booking_shift_links_pkey;
alter table booking_shift_links add primary key (booking_id, scheduler_id);
