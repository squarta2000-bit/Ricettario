-- supabase/migrations/0007_add_step_enriched_instruction.sql
-- Nullable, additive: null means "no enrichment available for this step" -
-- the state every existing row is in until backfilled, and the fallback
-- state after any enrichment failure (see enrichSteps.ts).
alter table steps add column enriched_instruction text;
