-- Pivot away from automatic rep tracking. The exercise now just records which
-- joints the clinician wants to observe; rep state machine, angle thresholds,
-- direction, secondary joint, and view orientation are no longer used at
-- runtime. The columns stay on the table so historic exercises keep loading,
-- but new exercises can leave them null.

alter table exercises
  add column tracked_joints jsonb not null default '[]'::jsonb;

alter table exercises
  alter column start_angle_min drop not null,
  alter column start_angle_max drop not null,
  alter column end_angle_min drop not null,
  alter column end_angle_max drop not null,
  alter column direction drop not null;

-- session_sets used to enforce reps_target. Without auto-counting reps it's
-- now optional guidance text on the prescription, and a single set row per
-- recording is written purely to keep the FK chain (sets → reps → pose) intact.
alter table session_sets
  alter column reps_target drop not null;
