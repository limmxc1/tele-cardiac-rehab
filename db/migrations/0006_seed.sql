insert into users (username, role, display_name) values
  ('physio',   'clinician', 'Physiotherapist'),
  ('patient1', 'patient',   'Patient One'),
  ('patient2', 'patient',   'Patient Two'),
  ('patient3', 'patient',   'Patient Three')
on conflict (username) do nothing;
