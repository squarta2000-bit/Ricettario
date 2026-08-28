-- supabase/migrations/0001_recipes_schema.sql
create table recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_url text not null,
  source_type text not null check (source_type in ('web', 'youtube')),
  image_url text,
  complexity text,
  servings text,
  created_at timestamptz not null default now()
);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position int not null,
  raw_text text not null,
  quantity numeric,
  unit text,
  name text not null
);

create table steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  position int not null,
  instruction text not null,
  estimated_minutes numeric
);

create index ingredients_recipe_id_idx on ingredients(recipe_id);
create index steps_recipe_id_idx on steps(recipe_id);
create index recipes_owner_id_created_at_idx on recipes(owner_id, created_at desc);

alter table recipes enable row level security;
alter table ingredients enable row level security;
alter table steps enable row level security;

create policy "owner_full_access_recipes" on recipes
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "owner_full_access_ingredients" on ingredients
  for all using (
    auth.uid() = (select owner_id from recipes where recipes.id = ingredients.recipe_id)
  ) with check (
    auth.uid() = (select owner_id from recipes where recipes.id = ingredients.recipe_id)
  );

create policy "owner_full_access_steps" on steps
  for all using (
    auth.uid() = (select owner_id from recipes where recipes.id = steps.recipe_id)
  ) with check (
    auth.uid() = (select owner_id from recipes where recipes.id = steps.recipe_id)
  );
