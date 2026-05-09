-- Soft-delete column: deleted exercises are kept so historic prescriptions /
-- session_sets that reference them stay resolvable. List queries filter on
-- archived_at IS NULL.
alter table exercises
  add column archived_at timestamptz;

-- View orientation: which camera angle the patient must face. Used by the
-- session runtime to coach the patient before the start gesture is accepted.
alter table exercises
  add column view_orientation text not null default 'front'
    check (view_orientation in ('front', 'side'));
