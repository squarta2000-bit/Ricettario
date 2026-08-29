-- supabase/migrations/0004_find_confirmed_user_by_email.sql
-- Lets the service role look up a confirmed user by email without exposing
-- the auth schema through PostgREST. Used by the passwordless "log in with
-- just your email" flow to check an account exists before minting a session.
create or replace function public.find_confirmed_user_id_by_email(lookup_email text)
returns uuid
language sql
security definer
set search_path = auth, public
stable
as $$
  select id from auth.users where email = lookup_email and email_confirmed_at is not null limit 1;
$$;

revoke all on function public.find_confirmed_user_id_by_email(text) from public;
revoke all on function public.find_confirmed_user_id_by_email(text) from anon;
revoke all on function public.find_confirmed_user_id_by_email(text) from authenticated;
grant execute on function public.find_confirmed_user_id_by_email(text) to service_role;
