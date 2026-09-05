-- Adds 'tiktok' as a source_type for TikTok video URL imports. Caption
-- fetched via TikTok's public, unauthenticated oEmbed endpoint - no
-- developer app or App Review needed, unlike Instagram/Facebook. See
-- docs/superpowers/specs/2026-09-05-tiktok-import-design.md.
alter table recipes drop constraint if exists recipes_source_type_check;
alter table recipes add constraint recipes_source_type_check
  check (source_type in ('web', 'youtube', 'photo', 'text', 'video', 'instagram', 'facebook', 'tiktok'));
