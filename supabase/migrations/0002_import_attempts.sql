create table import_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index import_attempts_owner_id_created_at_idx on import_attempts(owner_id, created_at desc);

alter table import_attempts enable row level security;

create policy "owner_full_access_import_attempts" on import_attempts
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
