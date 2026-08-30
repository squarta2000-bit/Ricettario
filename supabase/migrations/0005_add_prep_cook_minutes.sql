-- supabase/migrations/0005_add_prep_cook_minutes.sql
-- Separate preparation/cooking durations, distinct from the per-step
-- estimated_minutes used by the cooking-mode timer. Both nullable: most
-- sources only state one, or neither.
alter table recipes add column prep_minutes numeric;
alter table recipes add column cook_minutes numeric;
