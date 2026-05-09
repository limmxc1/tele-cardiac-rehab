-- HR samples at ~1Hz from H10
create table session_hr_samples (
  session_id uuid not null references sessions(id) on delete cascade,
  timestamp_ms bigint not null,
  hr_bpm int not null,
  primary key (session_id, timestamp_ms)
);

-- Pose frames downsampled to 10fps, packed by second to reduce row count
create table session_pose_frames (
  session_id uuid not null references sessions(id) on delete cascade,
  second_offset int not null,
  frames jsonb not null,            -- [{ts_ms, lm:[[x,y,z]×33]}, ...]
  primary key (session_id, second_offset)
);
