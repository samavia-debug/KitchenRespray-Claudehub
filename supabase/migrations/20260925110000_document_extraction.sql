-- Document content extraction: lets an uploaded document's actual text
-- become part of what Ask the Brain can answer from, instead of just a
-- linked file. extracted_content/extraction_status live on
-- knowledge_documents itself (the full text, for reference); a linked
-- knowledge_entries row (entry_type='document') holds a bounded excerpt
-- that actually goes into the Brain's prompt, status='review' since
-- auto-extracted text isn't verified fact until a human checks it.

alter table knowledge_documents add column if not exists extracted_content text;
alter table knowledge_documents add column if not exists extraction_status text not null default 'pending'
  check (extraction_status in ('pending', 'done', 'failed', 'unsupported'));
alter table knowledge_documents add column if not exists knowledge_entry_id uuid references knowledge_entries(id) on delete set null;

comment on column knowledge_documents.extraction_status is 'pending = not yet attempted, done = text extracted and linked to a knowledge_entries row, failed = extraction errored, unsupported = file type not supported for extraction (e.g. images).';
