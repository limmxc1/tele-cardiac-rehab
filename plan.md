# Cardiac Telerehab MVP — Build Plan

> **Hand-off document for Claude Code.**
> Build phase-by-phase. Each phase is independently testable. **Stop at the end of each phase and request review before proceeding to the next.** Do not skip ahead.

---

## 1. Project context

A web app for Phase 3/4 cardiac rehabilitation telehealth at Singapore Heart Foundation. Clinicians prescribe exercise routines for elderly cardiac patients. Patients perform exercises at home using an Android tablet (camera + Web Bluetooth) with a Polar H10 chest strap. Sessions are stored as joint landmark time-series (no raw video) so clinicians can replay sessions with synchronized stickman animation, HR trend, and per-rep angle data.

### Critical constraints

- **All MediaPipe inference runs client-side.** Raw video never leaves the device. Only joint landmarks + HR samples are uploaded.
- **Chrome on Android only.** Web Bluetooth requirement. iOS is not supported.
- **Patient UX is the priority.** Elderly users with limited tech comfort. Large hit targets, audio cues, minimal taps.
- **Singapore data residency.** Use Supabase region `ap-southeast-1`.
- **No production auth in MVP.** Username-based routing only — pilot phase.

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router) as PWA | Deploy to Vercel |
| Language | TypeScript everywhere | strict mode |
| DB / backend | Supabase (Postgres only) | No Realtime, no Auth in MVP |
| Pose detection | `@mediapipe/tasks-vision` PoseLandmarker | GPU delegate, runs in Web Worker |
| Heart rate | Web Bluetooth API → Polar H10 | BLE Heart Rate Service `0x180D`, characteristic `0x2A37` |
| Local buffer | IndexedDB via `dexie` | Survives page reload, H10 drops |
| Charts | `recharts` | HR trend line on playback |
| State | `zustand` | Lightweight session state |
| Styling | Tailwind CSS | |
| Validation | `zod` | All Supabase reads/writes |
| Audio cues | Web Speech API (TTS) + Web Audio API (beeps) | Built-in, no library |

---

## 3. Out of scope (do not build)

These were explicitly deferred and are listed so requests don't appear from nowhere later:

- Live realtime monitoring (only async playback in MVP)
- Two-way audio/video between clinician and patient
- Real-time form correction during exercise
- Pre-session screening, RPE/Borg input
- Production auth (username routing only)
- Multi-language support (English only)
- Web Bluetooth pairing tutorial (handled in-person)
- Wrong-exercise detection
- iOS support
- PDPA compliance hardening (deferred — pilot is internal)

---

## 4. Repository structure

```
/app
  /(auth)/login/page.tsx            # username-only routing
  /(clinician)
    /patients/page.tsx              # patient list
    /patients/[id]/page.tsx         # patient detail + session list
    /patients/[id]/sessions/[sid]/playback/page.tsx
    /exercises/page.tsx             # exercise library
    /exercises/new/page.tsx         # demo mode for thresholds
    /prescribe/[patientId]/page.tsx # weekly routine builder
  /(patient)
    /calendar/page.tsx              # monthly calendar of prescriptions
    /session/[prescriptionId]/run/page.tsx  # active session runtime

/components
  /clinician/*
  /patient/*
  /playback/StickmanCanvas.tsx
  /playback/HRTimeline.tsx
  /playback/SyncedScrubber.tsx
  /pose/CameraStickman.tsx          # live patient view with overlay
  /hr/HRRing.tsx                    # color-coded HR display

/lib
  /supabase/client.ts
  /supabase/types.ts                # generated from schema
  /pose/poseWorker.ts               # MediaPipe in Web Worker
  /pose/landmarks.ts                # 33-landmark constants
  /pose/angles.ts                   # joint-angle math (3-point calculation)
  /pose/repDetector.ts              # state-machine rep counter
  /pose/tposeDetector.ts            # T-pose hold detection (1.5s)
  /pose/personCount.ts              # detect 0/1/2+ people
  /hr/polarH10.ts                   # Web Bluetooth wrapper
  /audio/cues.ts                    # TTS + beep helpers
  /buffer/sessionBuffer.ts          # IndexedDB write/flush logic
  /sync/uploader.ts                 # batch upload to Supabase

/db
  /migrations/                      # Supabase SQL migrations, numbered

/public
  /reference-gifs/                  # uploaded exercise demo gifs
```

---

## 5. Database schema

Run these as numbered Supabase migrations under `/db/migrations/`.

```sql
-- 0001_users.sql
create table users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  role text not null check (role in ('clinician','patient')),
  display_name text not null,
  created_at timestamptz not null default now()
);

-- 0002_exercises.sql
create table exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  instructions_text text,
  reference_gif_url text,           -- supabase storage path
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
  -- nullable secondary joint constraint
  secondary_joint text check (secondary_joint in
    ('knee','hip','shoulder','elbow','ankle')),
  secondary_start_min numeric,
  secondary_start_max numeric,
  secondary_end_min numeric,
  secondary_end_max numeric,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- 0003_prescriptions.sql
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
  -- per-patient threshold overrides; null = use exercise defaults
  override_start_angle_min numeric,
  override_start_angle_max numeric,
  override_end_angle_min numeric,
  override_end_angle_max numeric
);

-- 0004_sessions.sql
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

-- 0005_timeseries.sql
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
```

---

## 6. Build phases

### Phase 0 — Foundation

**Goal:** repo scaffolding, Supabase project, schema applied, deploys to Vercel.

- `npx create-next-app@latest` with TypeScript + Tailwind + App Router
- Install: `@supabase/supabase-js`, `dexie`, `zustand`, `zod`, `recharts`, `@mediapipe/tasks-vision`
- Configure Supabase client at `/lib/supabase/client.ts`, env vars in `.env.local`
- Create Supabase project in `ap-southeast-1`; apply migrations 0001–0005
- Generate types with `supabase gen types typescript` → `/lib/supabase/types.ts`
- Deploy to Vercel, verify it loads on Android Chrome

**Acceptance:** App loads at production URL on Android Chrome. `select 1 from users` works against Supabase.

---

### Phase 1 — Username routing

**Goal:** crude pre-auth that routes by username. Not real auth — flag this clearly in code comments.

- `/login` page: single text input "username"
- On submit: lookup `users` by username, store `{ id, role, display_name }` in Zustand + `localStorage`
- Middleware redirects: `/clinician/*` requires role=clinician; `/patient/*` requires role=patient; otherwise → `/login`
- Seed test users via SQL: `physio` (clinician), `patient1`, `patient2`, `patient3` (patients)
- Logout button somewhere unobtrusive

**Acceptance:** Logging in as `physio` lands on clinician dashboard. Logging in as `patient1` lands on patient calendar. Each cannot access the other.

---

### Phase 2 — Exercise library + demo mode

**Goal:** Clinicians create exercises with rep-detection thresholds via live joint-angle histogram.

- `/clinician/exercises` — list view (name, primary joint, created date)
- `/clinician/exercises/new` — creation form:
  1. Name, instructions text, GIF upload (Supabase storage bucket `reference-gifs`)
  2. Primary joint dropdown (knee/hip/shoulder/elbow/ankle), side (left/right/both)
  3. **Demo mode:** clinician taps "Start demo," camera opens with MediaPipe Pose Landmarker running. They perform 5–10 reps. UI shows:
     - Live skeleton overlay
     - Live numeric primary joint angle (large, top of screen)
     - Live histogram of primary joint angles over the demo period
     - Two draggable sliders on the histogram for `start_angle` range and `end_angle` range
  4. "Save" persists to `exercises` table
- Joint-angle math: see § 7.1
- Direction (flexion-first vs extension-first) inferred from first few reps but editable

**Acceptance:** Clinician can create a sit-to-stand exercise: live histogram shows a clear bimodal distribution (knee around ~85° seated and ~170° standing), they drag sliders to set thresholds, save. Exercise appears in the library. Reference GIF plays on detail page.

---

### Phase 3 — Prescription builder + weekly recurrence

**Goal:** clinician assigns a routine to a patient as a weekly recurring schedule.

- `/clinician/patients` — list of patients
- `/clinician/patients/[id]` — patient detail with "Prescribe" button + session history table
- `/clinician/prescribe/[patientId]`:
  1. Set HR upper limit (bpm)
  2. Pick days of week (Mon/Wed/Fri checkboxes)
  3. Pick number of weeks (e.g., 4)
  4. Build ordered list of `prescription_items`: pick exercise, set sets, reps, rest seconds (default 30); optional per-patient threshold overrides for that exercise
  5. "Save" writes one `prescriptions` row per scheduled date with the same `prescription_items` cloned for each
- Show a preview of the calendar before save

**Acceptance:** Prescribe a Mon/Wed/Fri × 4 weeks routine to `patient1`. 12 prescription rows are created with correct dates. patient1's calendar shows them.

---

### Phase 4 — Patient calendar view

**Goal:** patient sees their daily prescriptions and taps in to start.

- `/patient/calendar` — monthly grid view, today highlighted
- Each day shows: number of exercises prescribed, status (scheduled/in_progress/completed/missed)
- Tap a day → list of prescription_items as todo cards (each card = one set of one exercise, since "each exercise set is its own todo task")
- Each card shows: exercise name, "Set 2 of 3," rep target, ✓ if done
- Tap card → `/patient/session/[prescriptionId]/run?item=X&set=Y`
- Daily cron / on-load check: any prescription with `scheduled_date < today` and `status='scheduled'` → mark `missed`

**Acceptance:** patient1 logs in, sees today's exercises, taps a card, lands on the runtime route with correct params.

---

### Phase 5 — Hardware integration (Polar H10 + Camera + MediaPipe)

**Goal:** isolated, testable wrappers for each hardware input. No exercise logic yet.

- `/lib/hr/polarH10.ts`:
  - `connectH10()`: requests Web Bluetooth device with `services: [0x180D]`
  - Subscribes to characteristic `0x2A37` notifications
  - Parses BLE HR data (first byte = flags, second byte = HR if 8-bit)
  - Emits `{ timestamp_ms, hr_bpm }` events; reconnect handler
- `/lib/pose/poseWorker.ts`: Web Worker hosting MediaPipe PoseLandmarker
  - `numPoses: 2` so we can detect "more than one person"
  - GPU delegate, model: `pose_landmarker_lite.task` (smallest, fast on tablets)
  - Receives video frames from main thread, posts back landmarks at ~30fps
- `/components/pose/CameraStickman.tsx`: opens rear camera, draws video on hidden canvas, sends frames to worker, draws stickman overlay on visible canvas
- Test page `/test/hardware`: shows live HR + live skeleton + person count

**Acceptance:** Open `/test/hardware` on Android tablet. H10 connects and shows live HR. Camera shows live skeleton overlay. Walk out of frame → person count → 0. Have someone walk in → 2.

---

### Phase 6 — Session runtime (state machine)

**Goal:** the patient screen during an active session. Implement the full state machine.

#### Layout (full-screen, landscape preferred)

```
┌───────────────────────────────────────────────────┐
│  [HR ring: 142]            Sit to Stand           │
│  green/blue/red             Set 2 of 3            │
│                                                   │
│       LIVE CAMERA WITH STICKMAN OVERLAY           │
│                                                   │
│                                                   │
│         ┌─────┐                  ┌──────────┐    │
│         │ 3/10│                  │ ref GIF  │    │
│         └─────┘                  └──────────┘    │
└───────────────────────────────────────────────────┘
```

#### State machine

Implement at `/lib/pose/sessionStateMachine.ts`:

```
IDLE → READY (3s countdown w/ TTS "3, 2, 1, begin")
READY → ACTIVE
ACTIVE:
  reps_done == target          → SET_COMPLETE
  T-pose held 1.5s             → SET_COMPLETE (ended_reason='t_pose')
  HR > limit for 20s sustained → PAUSED(hr_breach)
  H10 disconnect               → PAUSED(h10_disconnect)
  person_count == 0            → PAUSED(out_of_frame)
  person_count >= 2            → PAUSED(multiple_people)
PAUSED:
  hr_breach: T-pose AND HR < (limit-10) sustained 10s  → ACTIVE
  h10_disconnect: H10 reconnect                        → ACTIVE (auto)
  out_of_frame: person_count == 1                      → ACTIVE (auto)
  multiple_people: person_count == 1                   → ACTIVE (auto)
SET_COMPLETE:
  more sets in current item    → RESTING (countdown rest_seconds)
  more items remain            → next item, 5s grace then READY
  no more items                → SESSION_COMPLETE
RESTING → READY (next set)
SESSION_COMPLETE → summary screen → /patient/calendar
```

#### Core algorithms

- **Rep detector** (`/lib/pose/repDetector.ts`): see § 7.2
- **T-pose detector** (`/lib/pose/tposeDetector.ts`): see § 7.3
- **HR ring** (`/components/hr/HRRing.tsx`): green if `hr_bpm < hr_upper_limit - 10`, blue if `hr_bpm < hr_lower_target` (use `hr_upper_limit * 0.6` as proxy for now), blinking red+white if `hr_bpm > hr_upper_limit`

#### Audio cues

`/lib/audio/cues.ts` exports:
- `countdownCue()` → TTS "three, two, one, begin"
- `repCue()` → short Web Audio beep (200Hz, 100ms)
- `restCue(seconds)` → TTS "rest, X seconds"
- `nextExerciseCue(name)` → TTS "next exercise: NAME"
- `pauseCue(reason)` → TTS reason-specific message
- `resumeReadyCue()` → TTS "show T-pose when ready"
- `sessionCompleteCue()` → TTS "session complete, well done"

Mute toggle in top corner; preference persisted in `localStorage`.

**Acceptance:** Run a full session end-to-end. Reps count correctly. HR breach triggers pause and TTS. T-pose ends a set early. H10 disconnect pauses, reconnect auto-resumes. All four pause causes work. Session-complete summary appears.

---

### Phase 7 — Data persistence (IndexedDB → Supabase)

**Goal:** every event during a session is buffered locally and uploaded reliably on completion.

- `/lib/buffer/sessionBuffer.ts`: Dexie database with stores `hr_samples`, `pose_frames`, `reps`, `pauses`, `sets`. Append-only during session.
- Pose frames: downsample to 10fps, pack into 1-second JSONB chunks before write.
- HR samples: write as received (~1Hz).
- On `SET_COMPLETE`: write `session_set` + child `session_reps` rows to local store.
- On `SESSION_COMPLETE`: upload everything to Supabase in batched inserts, then mark prescription `completed`. On success, clear local store.
- Resume logic: on app load, if local store has unflushed session data → upload first, then proceed.
- Failure handling: if upload fails, retry with exponential backoff. Local store persists across app restarts.

**Acceptance:** Complete a session offline. Re-enable network. Data uploads. Verify in Supabase dashboard that all timeseries + summary rows are present and timestamps align.

---

### Phase 8 — Clinician playback

**Goal:** clinician opens a completed session and plays it back with synced stickman + HR + rep counter.

- `/clinician/patients/[id]` shows session history table (date, exercises, total reps, max HR, status, "Review" button)
- `/clinician/patients/[id]/sessions/[sid]/playback`:
  - Top: synced timeline scrubber with pause-event markers (gray bars labeled with reason on hover)
  - Left: stickman canvas — replay landmarks at original 10fps from `session_pose_frames`
  - Right: HR trend line chart (recharts) with current-time cursor
  - Bottom: rep counter advancing with playback time
  - Controls: play, pause, speed (0.5x / 1x / 2x)
  - **Anatomical view (not mirrored)** — patient's right hand appears on the viewer's left
  - Clinician notes textarea, "Save notes" button

- Per-rep table below playback: rep #, time, peak angle, ROM, HR at peak

**Acceptance:** Open a completed session. Hit play. Stickman, HR cursor, and rep counter all advance together. Scrub forward — all three jump in sync. Pause markers visible on timeline. Notes save and persist.

---

### Phase 9 — Polish + edge cases

- "Person not fully in frame" check before set starts (require all 33 landmarks visibility > threshold for 2s)
- HR=0 / implausible values: show as-is on patient screen, do not trigger HR breach logic until valid signal returns (≥40 bpm and ≤220 bpm)
- "No camera permission" / "No Bluetooth permission" friendly error screens with retry
- "Browser not supported" check (UA sniff for Chrome on Android) — banner if not
- Session abandonment: if patient closes tab mid-session, on next load offer "resume previous session?"
- 3D-printed-tripod height calibration helper: optional initial frame check showing target body coverage area

---

## 7. Key algorithms

### 7.1 Joint angle from three landmarks

Given three MediaPipe landmarks (e.g., hip, knee, ankle), the joint angle at the middle point:

```ts
function angleAt(a: Vec3, b: Vec3, c: Vec3): number {
  const ab = { x: a.x-b.x, y: a.y-b.y, z: a.z-b.z };
  const cb = { x: c.x-b.x, y: c.y-b.y, z: c.z-b.z };
  const dot = ab.x*cb.x + ab.y*cb.y + ab.z*cb.z;
  const magAB = Math.hypot(ab.x, ab.y, ab.z);
  const magCB = Math.hypot(cb.x, cb.y, cb.z);
  const cos = dot / (magAB * magCB);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}
```

Joint definitions:
- knee = (hip, knee, ankle)
- hip = (shoulder, hip, knee)
- elbow = (shoulder, elbow, wrist)
- shoulder = (hip, shoulder, elbow)
- ankle = (knee, ankle, foot_index)

### 7.2 Rep detection state machine

For each frame:

```
state: 'AT_START' | 'TRAVELING_TO_END' | 'AT_END' | 'TRAVELING_TO_START'
on each angle reading:
  AT_START + angle in start_range → stay
  AT_START + angle leaves start_range toward end → TRAVELING_TO_END (capture rep_start_ts)
  TRAVELING_TO_END + angle in end_range → AT_END (capture peak_angle, peak_hr)
  AT_END + angle leaves end_range back toward start → TRAVELING_TO_START
  TRAVELING_TO_START + angle in start_range → AT_START + emit REP_COMPLETE event
```

A REP_COMPLETE event captures: `started_at, completed_at, peak_angle, rom = peak_angle - start_angle, hr_bpm_at_peak`.

If a secondary joint constraint exists, both primary and secondary must be in their respective ranges for state transitions to fire.

### 7.3 T-pose detection

```
T-pose criteria (must all hold for ≥1.5s consecutive):
  - left wrist roughly at left shoulder height (|y_wrist - y_shoulder| < threshold)
  - right wrist roughly at right shoulder height
  - left wrist x is well to the left of left shoulder (arms extended)
  - right wrist x is well to the right of right shoulder
  - elbow angles > 150° on both sides (arms straight)
```

Use normalized landmark coordinates (0..1). Display "ending in 1.5s..." countdown ring on screen so patient sees it registered.

### 7.4 Person count

PoseLandmarker with `numPoses: 2` returns 0, 1, or 2 detected poses. Use `>= 2` for "multiple people" pause trigger. Use `== 0` for "out of frame" — but require this to hold for 2s continuously to avoid flicker on detection drops.

---

## 8. Open decisions deferred

If you hit one of these, ask Cheval before assuming:

- **Storage bucket policies** for `reference-gifs` (currently public for MVP; revisit before pilot)
- **HR lower target** for the "blue" zone — currently using `0.6 × hr_upper_limit` as a placeholder
- **Frame downsampling rate** if storage gets ugly on real sessions — start at 10fps, may drop to 5fps
- **Demo mode reps minimum** — how many reps must clinician demo before sliders activate (default 5)
- **Tripod calibration helper** — defer to Phase 9 unless real-world testing shows framing problems earlier

---

## 9. Reference links

- Web Bluetooth Heart Rate spec: https://www.bluetooth.com/specifications/specs/heart-rate-service/
- MediaPipe PoseLandmarker (web): https://developers.google.com/mediapipe/solutions/vision/pose_landmarker/web_js
- Polar H10 BLE notes: standard GATT HR Service `0x180D` — no proprietary SDK needed
- Supabase JS client: https://supabase.com/docs/reference/javascript
- Claude Code docs: https://docs.claude.com/en/docs/claude-code/overview

---

## 10. Phase completion checklist

- [ ] Phase 0 — Foundation
- [ ] Phase 1 — Username routing
- [ ] Phase 2 — Exercise library + demo mode
- [ ] Phase 3 — Prescription builder
- [ ] Phase 4 — Patient calendar
- [ ] Phase 5 — Hardware integration
- [ ] Phase 6 — Session runtime
- [ ] Phase 7 — Data persistence
- [ ] Phase 8 — Clinician playback
- [ ] Phase 9 — Polish

**Stop after each phase. Commit. Demo to Cheval. Wait for go-ahead.**