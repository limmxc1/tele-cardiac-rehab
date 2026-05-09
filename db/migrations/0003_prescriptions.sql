create table prescriptions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references users(id),
  prescribed_by uuid not null references users(id),
  scheduled_date date not null,
  hr_upper_limit_bpm int not null,
  status text not null default 'scheduled' check (status in
    ('scheduled','in_progress','completed','missed')),
  created_at timestamptz not null default now()
);
create index on prescriptions(patient_id, scheduled_date);

create table prescription_items (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references prescriptions(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  sequence_order int not null,
  num_sets int not null,
  reps_per_set int not null,
  rest_seconds int not null default 30,
  override_start_angle_min numeric,
  override_start_angle_max numeric,
  override_end_angle_min numeric,
  override_end_angle_max numeric
);
