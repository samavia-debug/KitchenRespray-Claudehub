-- Trade Sales CRM: territories. A company's county is now one of the twelve Leinster counties, "Outside Leinster", or
-- empty, so the CRM can show every county side by side and offers can differ by county.
--
-- Existing records are tidied first: "Co. Carlow", "carlow" and "Dublin 6W" become Carlow and Dublin, other Irish
-- counties become "Outside Leinster", and anything that cannot be read as a county is cleared. Nothing is lost: the
-- original wording of every value that changed is kept on the company under extra -> 'County as entered'.
--
-- The reading rules are the same as normalizeCounty() in lib/crm/territories.ts, which has a test table that this
-- migration was checked against. Safe to re-run: a second run finds nothing left to change.

drop table if exists crm_county_fix;

-- as_written: the county as typed, lower-case, without accents or punctuation. cleaned: the same without "Co." / "County".
create temporary table crm_county_fix as
select id, original, as_written, btrim(regexp_replace(as_written, '^(county|co) | (county|co)$', '', 'g')) as cleaned, null::text as fixed
from (
  select
    id,
    county as original,
    btrim(regexp_replace(regexp_replace(translate(lower(county), 'áéíóúàèìòùâêîôû', 'aeiouaeiouaeiou'), '[.,]', ' ', 'g'), '\s+', ' ', 'g')) as as_written
  from crm_companies
  where county is not null
    and county not in ('Carlow', 'Dublin', 'Kildare', 'Kilkenny', 'Laois', 'Longford', 'Louth', 'Meath', 'Offaly', 'Westmeath', 'Wexford', 'Wicklow', 'Outside Leinster')
) typed;

update crm_county_fix set fixed = case
  -- Names that are a county in their own right, before "County" is taken off ("Queens County").
  when as_written = 'queens county' or cleaned = 'laoighis' or cleaned = 'leix' then 'Laois'
  when as_written = 'kings county' then 'Offaly'
  when cleaned in ('carlow', 'dublin', 'kildare', 'kilkenny', 'laois', 'longford', 'louth', 'meath', 'offaly', 'westmeath', 'wexford', 'wicklow') then initcap(cleaned)
  when cleaned = 'west meath' then 'Westmeath'
  when cleaned in ('south dublin', 'fingal', 'dublin city', 'dlr')
    or cleaned ~ '^(dublin ?(0?[1-9]|1[0-9]|2[0-4]|6w)|d(0?[1-9]|1[0-9]|2[0-4]|6w))$'
    or cleaned ~ '^dun laoghaire( ?-? ?rathdown)?$' then 'Dublin'
  when cleaned in ('cavan', 'clare', 'cork', 'donegal', 'galway', 'kerry', 'leitrim', 'limerick', 'mayo', 'monaghan', 'roscommon', 'sligo', 'tipperary', 'waterford',
                   'antrim', 'armagh', 'down', 'fermanagh', 'derry', 'londonderry', 'tyrone', 'northern ireland', 'outside leinster') then 'Outside Leinster'
  else null
end;

update crm_companies c
set county = f.fixed,
    extra = case when btrim(f.original) = '' then c.extra else c.extra || jsonb_build_object('County as entered', f.original) end
from crm_county_fix f
where c.id = f.id;

drop table if exists crm_county_fix;

alter table crm_companies drop constraint if exists crm_companies_county_valid;
alter table crm_companies add constraint crm_companies_county_valid
  check (county is null or county in ('Carlow', 'Dublin', 'Kildare', 'Kilkenny', 'Laois', 'Longford', 'Louth', 'Meath', 'Offaly', 'Westmeath', 'Wexford', 'Wicklow', 'Outside Leinster'));

create index if not exists crm_companies_county_idx on crm_companies (county) where archived_at is null;
