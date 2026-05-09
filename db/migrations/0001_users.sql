create table users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  role text not null check (role in ('clinician','patient')),
  display_name text not null,
  created_at timestamptz not null default now()
);
