-- supabase/migrations/0006_widen_import_source_types_reels.sql
-- Adds source types for Instagram/Facebook Reel import: 'video' (manual
-- upload path, frame-sampled client-side) and 'instagram'/'facebook' (URL
-- path, caption fetched via Meta's oEmbed API). See
-- docs/superpowers/specs/2026-09-01-instagram-facebook-import-design.md.
alter table recipes drop constraint if exists recipes_source_type_check;
alter table recipes add constraint recipes_source_type_check
  check (source_type in ('web', 'youtube', 'photo', 'text', 'video', 'instagram', 'facebook'));
