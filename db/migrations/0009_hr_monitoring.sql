-- Live BLE HR-monitoring feature, ported from the cardiac-vsm-app reference.
-- Independent of the exercise/prescription flow: clinicians register patients
-- by Polar H10 device name, and the patient phone page identifies them by
-- pairing the strap (no auth). hr_workouts stores live HR streams.

create table hr_patients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  device_name text not null unique,
  hr_lower int not null check (hr_lower between 30 and 220),
  hr_upper int not null check (hr_upper between 30 and 220),
  fall_risk text not null default 'low' check (fall_risk in ('low','medium','high')),
  precautions jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  check (hr_lower < hr_upper)
);

create index on hr_patients(device_name);

create table hr_workouts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references hr_patients(id) on delete cascade,
  machine text not null,
  status text not null default 'active' check (status in ('active','ended','aborted')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  hr_lower int not null,
  hr_upper int not null,
  -- Live snapshot fields (cheap to update at 1Hz, separate from the samples blob).
  current_hr int,
  current_hr_at timestamptz,
  -- Aggregates maintained client-side and pushed on each scalar tick.
  hr_min int,
  hr_max int,
  hr_sum bigint not null default 0,
  hr_count int not null default 0,
  -- Time-series of [t_offset_sec, hr_or_null]. Appended in batches via the RPC.
  samples jsonb not null default '[]'::jsonb
);

create index on hr_workouts(patient_id, started_at desc);
create index on hr_workouts(status, started_at desc);

-- Append-only RPC. Atomically extends the samples array so concurrent flushes
-- from a single client (or a brief-tab-freeze + resume) can't lose rows.
create or replace function hr_append_samples(workout_id uuid, delta jsonb)
returns void
language plpgsql
as $$
begin
  update hr_workouts
    set samples = coalesce(samples, '[]'::jsonb) || delta
    where id = workout_id;
end;
$$;

-- Realtime: clinician dashboard subscribes to hr_workouts via postgres_changes.
alter publication supabase_realtime add table hr_workouts;
