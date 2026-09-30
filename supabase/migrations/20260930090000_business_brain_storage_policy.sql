-- The business-brain-documents Storage bucket was created via the
-- service-role Storage API (see the Documents tab work), but that only
-- creates the bucket itself — it does not grant any RLS policy on
-- storage.objects for actually uploading into it. Every upload attempt
-- fails with "new row violates row-level security policy" until one is
-- added explicitly; Supabase Storage denies by default, same as any
-- other RLS-protected table. Scoped to Admin only, matching the
-- Admin-only restriction already on knowledge_entries/knowledge_documents.
-- Public reads (the file_path links shown in the UI) go through the
-- bucket's own public-URL endpoint, not this RLS-checked path, so a
-- separate read policy isn't needed for that — this covers
-- upload/re-upload/delete, all of which need real auth.

drop policy if exists "admin_only_manage_business_brain_documents" on storage.objects;
create policy "admin_only_manage_business_brain_documents"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'business-brain-documents'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'Admin')
  )
  with check (
    bucket_id = 'business-brain-documents'
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'Admin')
  );
