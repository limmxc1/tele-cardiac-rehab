create table exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  instructions_text text,
  reference_gif_url text,
  primary_joint text not null check (primary_joint in
    ('knee','hip','shoulder','elbow','ankle')),
  primary_side text not null default 'both' check (primary_side in
    ('left','right','both')),
  start_angle_min numeric not null,
  start_angle_max numeric not null,
  end_angle_min numeric not null,
  end_angle_max numeric not null,
  direction text not null check (direction in
    ('flexion_first','extension_first')),
  secondary_joint text check (secondary_joint in
    ('knee','hip','shoulder','elbow','ankle')),
  secondary_start_min numeric,
  secondary_start_max numeric,
  secondary_end_min numeric,
  secondary_end_max numeric,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
