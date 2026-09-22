-- Business decision: monitor only 26 of the original 61 sites going
-- forward. Already applied directly against production via
-- scripts/delete-descoped-sites.mjs (same statement) — this migration
-- exists so a fresh database setup (apply all migrations in order) lands
-- on the same 26 sites instead of the original 61, and so the decision is
-- captured in version control rather than only having happened once,
-- untracked, against one database.
--
-- Cascades (on delete cascade) to also remove every health check,
-- incident, link check, SEO check, and Google connection ever recorded
-- for these 35 domains. That data is genuinely gone, not archived —
-- confirmed with the user before this ran.

delete from websites
where domain in (
  'bathroomwrap.com',
  'kitchenwrapireland.com',
  'sprayonmetals.com',
  'bathreglazingireland.com',
  'allsurfacerepair.com',
  'resurfacemykitchen.com',
  'kitchenresurfacingireland.com',
  'kitchenrespraygalway.com',
  'kitchenrespraycork.com',
  'kitchenrespraylimerick.com',
  'kitchenrespraywaterford.com',
  'kitchenrespraycavan.com',
  'kitchenrespraytipperary.com',
  'kitchenrespraydonegal.com',
  'kitchenrespraysligo.com',
  'kitchenresprayleitrim.com',
  'kitchenrespraymonaghan.com',
  'kitchenrespraymayo.com',
  'kitchenresprayroscommon.com',
  'kitchenresprayclare.com',
  'kitchenrespraykerry.com',
  'allsurfaceveneer.com',
  'internationalspraypaintersassociation.org',
  'kitchenresprayireland.ie',
  'respraymykitchen.ie',
  'bathresurfacingireland.com',
  'bathreglazing.net',
  're-spray.com',
  'epoxycountertopsireland.com',
  'lashesbyeva.com',
  'kitchenresprayreview.com',
  'respraymyfurniture.com',
  'restoremyleather.com',
  'peterwhitetours.com',
  'tradesprayireland.com'
);
