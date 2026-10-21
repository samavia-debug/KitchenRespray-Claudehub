-- Trade Sales CRM: WhatsApp is the main way the team contacts prospects, so a WhatsApp message and a WhatsApp
-- follow-up are now activity types of their own. Each statement stands alone, so it also runs in tools that run one
-- statement at a time. Safe to re-run.

alter table crm_activities drop constraint if exists crm_activities_type_check;

alter table crm_activities add constraint crm_activities_type_check check (type in (
  'Initial research', 'Telephone call', 'WhatsApp message', 'Email sent', 'Promotional material sent',
  'WhatsApp follow-up', 'Follow-up email', 'Follow-up call', 'Meeting', 'Site visit',
  'Quote requested', 'Quote sent', 'Other'
));
