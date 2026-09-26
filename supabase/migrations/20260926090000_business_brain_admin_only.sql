-- Business Brain restricted to Admin only (was Admin/Manager, and reads
-- were open to any authenticated role). The module can hold sensitive
-- strategic/company info (pricing, decisions, company memory) the team
-- decided shouldn't be visible to Managers, not just hidden from the nav —
-- enforced here at RLS so it's a real boundary, not just a UI gate.

drop policy if exists "authenticated_read_knowledge_entries" on knowledge_entries;
drop policy if exists "admin_manager_write_knowledge_entries" on knowledge_entries;

create policy "admin_only_knowledge_entries" on knowledge_entries
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'Admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'Admin'));

drop policy if exists "authenticated_read_knowledge_documents" on knowledge_documents;
drop policy if exists "admin_manager_write_knowledge_documents" on knowledge_documents;

create policy "admin_only_knowledge_documents" on knowledge_documents
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'Admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'Admin'));
