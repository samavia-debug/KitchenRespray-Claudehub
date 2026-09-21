-- Website Monitoring — full 60-site inventory import.
-- Additive only: inserts every site from the master domain list into
-- `websites`, grouped into categories per the spec's suggested website
-- groups (All Surface Respray / Kitchen Respray / Bathroom / Regional
-- Kitchen Sites / Association / Other Businesses). Existing rows (the
-- original 4-site validation seed in 20260919120000) are left untouched —
-- `on conflict (domain) do nothing` means this never overwrites data or
-- check history tied to a domain that's already being monitored.
--
-- IMPORTANT data-quality note (see ARCHITECTURE.md "Domain discrepancies"):
-- the master list supplied this domain as "allsurfacerepray.com", but that
-- domain does not resolve via DNS (verified against multiple lookups). The
-- correctly-spelled "allsurfacerespray.com" does resolve and already exists
-- as a row from the original seed migration, matching the business name
-- "All Surface Respray". This migration seeds the working domain instead of
-- the non-resolving one so the site isn't permanently shown "Offline" for a
-- typo — flagged here for Philip to confirm.

insert into websites (name, domain, category, priority)
values
  ('All Surface Respray', 'allsurfacerespray.com', 'All Surface Respray', 'high'),
  ('Kitchen Respray Ireland', 'kitchenrespray.ie', 'Kitchen Respray', 'medium'),
  ('iSpa Global', 'ispaglobal.org', 'Association', 'medium'),
  ('Bathroom Wrap', 'bathroomwrap.com', 'Bathroom', 'medium'),
  ('Kitchen Wrap Ireland', 'kitchenwrapireland.com', 'Kitchen Respray', 'medium'),
  ('Kitchen Respray', 'kitchenrespray.com', 'Kitchen Respray', 'high'),
  ('Bath Respray', 'bathrespray.com', 'Bathroom', 'medium'),
  ('Kitchen Facelift', 'kitchenfacelift.ie', 'Kitchen Respray', 'high'),
  ('Respray.ie', 'respray.ie', 'Kitchen Respray', 'medium'),
  ('Spray On Metals', 'sprayonmetals.com', 'Other Businesses', 'medium'),
  ('Bath Reglazing Ireland', 'bathreglazingireland.com', 'Bathroom', 'medium'),
  ('PVC Respray', 'pvcrespray.com', 'Other Businesses', 'medium'),
  ('All Surface Repair', 'allsurfacerepair.com', 'All Surface Respray', 'medium'),
  ('Resurface My Kitchen', 'resurfacemykitchen.com', 'Kitchen Respray', 'medium'),
  ('Kitchen Resurfacing Ireland', 'kitchenresurfacingireland.com', 'Kitchen Respray', 'medium'),
  ('Worktop Respray', 'worktoprespray.com', 'Kitchen Respray', 'medium'),
  ('Respray Photos', 'resprayphotos.com', 'Other Businesses', 'medium'),
  ('Furniture Respray', 'furniturerespray.com', 'Other Businesses', 'medium'),
  ('Kitchen Respray Ireland (.com)', 'kitchenresprayireland.com', 'Kitchen Respray', 'medium'),
  ('Nationwide Kitchen Respray', 'nationwidekitchenrespray.com', 'Kitchen Respray', 'medium'),
  ('Kitchen Respray Galway', 'kitchenrespraygalway.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Cork', 'kitchenrespraycork.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Dublin', 'kitchenrespraydublin.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Limerick', 'kitchenrespraylimerick.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Laois', 'kitchenrespraylaois.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Wexford', 'kitchenrespraywexford.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Offaly', 'kitchenresprayoffaly.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Kildare', 'kitchenrespraykildare.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Kilkenny', 'kitchenrespraykilkenny.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Louth', 'kitchenrespraylouth.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Meath', 'kitchenrespraymeath.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Waterford', 'kitchenrespraywaterford.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Cavan', 'kitchenrespraycavan.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Longford', 'kitchenrespraylongford.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Tipperary', 'kitchenrespraytipperary.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Wicklow', 'kitchenrespraywicklow.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Donegal', 'kitchenrespraydonegal.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Sligo', 'kitchenrespraysligo.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Leitrim', 'kitchenresprayleitrim.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Monaghan', 'kitchenrespraymonaghan.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Mayo', 'kitchenrespraymayo.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Roscommon', 'kitchenresprayroscommon.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Clare', 'kitchenresprayclare.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Carlow', 'kitchenrespraycarlow.com', 'Regional Kitchen Sites', 'medium'),
  ('Kitchen Respray Kerry', 'kitchenrespraykerry.com', 'Regional Kitchen Sites', 'medium'),
  ('All Surface Wrap', 'allsurfacewrap.com', 'All Surface Respray', 'medium'),
  ('All Surface Veneer', 'allsurfaceveneer.com', 'All Surface Respray', 'medium'),
  ('International Spray Painters Association', 'internationalspraypaintersassociation.org', 'Association', 'medium'),
  ('Kitchen Respray Ireland (.ie)', 'kitchenresprayireland.ie', 'Kitchen Respray', 'medium'),
  ('Respray My Kitchen', 'respraymykitchen.ie', 'Kitchen Respray', 'medium'),
  ('Bath Resurfacing Ireland', 'bathresurfacingireland.com', 'Bathroom', 'medium'),
  ('Bath Reglazing', 'bathreglazing.net', 'Bathroom', 'medium'),
  ('Re-Spray', 're-spray.com', 'Other Businesses', 'medium'),
  ('Epoxy Countertops Ireland', 'epoxycountertopsireland.com', 'Kitchen Respray', 'medium'),
  ('Lashes by Eva', 'lashesbyeva.com', 'Other Businesses', 'low'),
  ('Kitchen Respray Review', 'kitchenresprayreview.com', 'Kitchen Respray', 'medium'),
  ('Respray My Furniture', 'respraymyfurniture.com', 'Other Businesses', 'medium'),
  ('Restore My Leather', 'restoremyleather.com', 'Other Businesses', 'medium'),
  ('Peter White Tours', 'peterwhitetours.com', 'Other Businesses', 'low'),
  ('Best Price Kitchen Respray', 'bestpricekitchenrespray.com', 'Kitchen Respray', 'medium')
on conflict (domain) do nothing;
