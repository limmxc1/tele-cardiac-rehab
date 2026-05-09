create table sessions (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references prescriptions(id),
  patient_id uuid not null references users(id),
  started_at timestamptz not null,
  completed_at timestamptz,
  status text not null default 'in_progress' check (status in
    ('in_progress','completed','abandoned')),
  clinician_notes text
);

create table session_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  prescription_item_id uuid not null references prescription_items(id),
  exercise_id uuid not null references exercises(id),
  set_number int not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  reps_completed int not null default 0,
  reps_target int not null,
  ended_reason text check (ended_reason in
    ('reps_complete','t_pose','abandoned'))
);

create table session_reps (
  id uuid primary key default gen_random_uuid(),
  session_set_id uuid not null references session_sets(id) on delete cascade,
  rep_number int not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  peak_angle_degrees numeric,
  rom_achieved_degrees numeric,
  hr_bpm_at_peak int
);

create table session_pauses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  paused_at timestamptz not null,
  resumed_at timestamptz,
  reason text not null check (reason in
    ('hr_breach','h10_disconnect','out_of_frame','multiple_people'))
);
