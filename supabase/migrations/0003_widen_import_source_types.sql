-- supabase/migrations/0003_widen_import_source_types.sql
alter table recipes alter column source_url drop not null;

alter table recipes drop constraint if exists recipes_source_type_check;
alter table recipes add constraint recipes_source_type_check
  check (source_type in ('web', 'youtube', 'photo', 'text'));
