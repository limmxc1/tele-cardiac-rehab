# Build History — Cardiac Telerehab MVP

Project: Web app for Phase 3/4 cardiac rehabilitation telehealth at Singapore Heart Foundation.
Patients exercise at home (Android tablet + Polar H10 chest strap); clinicians review sessions remotely.

---

## Phase 0 — Foundation `7d45065`

- `npx create-next-app@latest` with TypeScript, Tailwind, App Router
- Installed: `@supabase/supabase-js`, `dexie`, `zustand`, `zod`, `recharts`, `@mediapipe/tasks-vision`, `@types/web-bluetooth`
- Supabase project created in `ap-southeast-1` (Singapore): `bcykqaflsancmdiwrnak`
- Applied migrations 0001–0005 (users, exercises, prescriptions, sessions, timeseries)
- Generated TypeScript types → `lib/supabase/types.ts`
- Deployed to Vercel: `https://tele-cardiac-rehab.vercel.app`

**Key files:** `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/types.ts`, `db/migrations/`

---

## Phase 1 — Username routing `7070836`

- `/login` page: single text input routes by username (not real auth — MVP only)
- On submit: looks up `users` table, stores `{ id, role, display_name }` in Zustand + `localStorage`
- Next.js middleware enforces role separation: `/clinician/*` → role=clinician; `/patient/*` → role=patient; otherwise → `/login`
- Seeded test users: `physio` (clinician), `patient1/2/3` (patients)
- Logout in layouts

**Key files:** `app/(auth)/login/page.tsx`, `lib/store/auth.ts`, `middleware.ts`

---

## Phase 2 — Exercise library + demo mode `e649050`

- `/clinician/exercises` — list view (name, joint, date created)
- `/clinician/exercises/new` — creation form with:
  - Name, instructions text, GIF upload to Supabase Storage bucket `reference-gifs`
  - Joint/side dropdown; start + end angle range inputs
  - **Demo mode:** live camera opens MediaPipe PoseLandmarker; clinician performs reps; live histogram of joint angles with draggable sliders to set thresholds
  - Direction (flexion-first / extension-first) selector
  - "Save" writes to `exercises` table
- Joint-angle math: `lib/pose/angles.ts` — `angleAt(a, b, c)` using dot-product
- Landmark constants: `lib/pose/landmarks.ts` — 33-point indices + joint triplets

**Key files:** `lib/pose/angles.ts`, `lib/pose/landmarks.ts`, `app/(clinician)/clinician/exercises/`

---

## Phase 3 — Prescription builder `3ba9538`

- `/clinician/patients` — patient list from `users` table (role=patient)
- `/clinician/patients/[id]` — patient detail with session history table and "Prescribe" button
- `/clinician/prescribe/[patientId]` — prescription builder:
  - Set HR upper limit (bpm)
  - Pick days of week + number of weeks → generates list of dates
  - Build ordered exercise list: pick exercise, set sets/reps/rest, optional per-patient angle overrides
  - Preview calendar before save; "Save" writes one `prescriptions` row per date, clones `prescription_items` for each
- Server action: `app/actions/prescriptions.ts` — `createPrescriptionAction`

**Key files:** `app/(clinician)/clinician/prescribe/`, `app/(clinician)/clinician/patients/`, `app/actions/prescriptions.ts`

---

## Phase 4 — Patient calendar `fb8409a`

- `/patient/calendar` — monthly grid (Monday-first), today highlighted
- Each day shows status dot (scheduled/in_progress/completed/missed) for prescribed sessions
- Tap a day → slide-up panel with todo cards: one card per set of each exercise
- Each card shows exercise name, "Set N of M", rep target, check if done
- Tap card → navigates to `/patient/session/[prescriptionId]/run?item=<id>&set=<n>`
- On-load: marks any past `status=scheduled` prescriptions as `missed`

**Key files:** `app/(patient)/patient/calendar/`, `app/actions/prescriptions.ts` (`getMonthPrescriptionsAction`, `markMissedAction`)

---

## Phase 5 — Hardware integration `e780628`

- **`lib/hr/polarH10.ts`** — Web Bluetooth wrapper for Polar H10
  - BLE HR Service `0x180D`, characteristic `0x2A37`
  - Callback-based: `onHR({ timestamp_ms, hr_bpm })`, `onStatus(H10Status)`
  - Auto-reconnect with exponential backoff (up to 5 attempts, 2s base delay)
  - Flags byte parsed: bit 0 selects 8-bit vs 16-bit HR value
- **`lib/pose/poseWorker.ts`** — Web Worker hosting MediaPipe PoseLandmarker
  - CPU delegate (GPU requires WebGL, unavailable in workers)
  - `numPoses: 2` for multi-person detection
  - `INIT` → loads WASM + model from CDN; `FRAME` → receives `ImageBitmap` transferable, returns `NormalizedLandmark[][]`
  - WASM: `cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm`; model: `pose_landmarker_lite.task`
- **`components/pose/CameraStickman.tsx`** — React client component
  - Opens rear camera (`facingMode: environment`), extracts frames each RAF tick as `ImageBitmap` (zero-copy transfer)
  - `workerBusyRef` flag throttles frame sending to worker throughput
  - Draws stickman overlay on canvas from normalized landmarks; green for person 1, orange for person 2
- **`app/test/hardware/page.tsx`** — test harness at `/test/hardware`
  - Live camera + skeleton overlay; person count badge
  - H10 connect/disconnect controls; live HR display + 30-sample sparkline

**Key files:** `lib/hr/polarH10.ts`, `lib/pose/poseWorker.ts`, `components/pose/CameraStickman.tsx`, `app/test/hardware/page.tsx`

---

## Phase 6 — Session runtime `1e96cd4`

- **`lib/audio/cues.ts`** — TTS + beep helpers
  - `countdownCue()` → TTS "three, two, one, begin"
  - `repCue()` → 600Hz Web Audio beep (120ms)
  - `restCue(n)`, `nextExerciseCue(name)`, `pauseCue(reason)`, `resumeReadyCue()`, `sessionCompleteCue()`
  - Mute state persisted in `localStorage` key `audio_muted`
- **`lib/pose/repDetector.ts`** — 4-state rep counter per the plan spec
  - States: `AT_START → TRAVELING_TO_END → AT_END → TRAVELING_TO_START → AT_START`
  - Tracks peak angle (max if extension-first, min if flexion-first)
  - Emits `RepEvent { startedAt, completedAt, peakAngleDegrees, romDegrees, hrBpmAtPeak }`
- **`lib/pose/tposeDetector.ts`** — T-pose hold detector
  - Criteria: wrists at shoulder height (±12%), arms extended laterally (≥12% frame width beyond shoulder), elbow angles > 150°
  - Returns progress 0..1; fires `onDetected` callback after 1.5s continuous hold
- **`lib/pose/sessionStateMachine.ts`** — full session state machine
  - 7 phases: `IDLE → READY (3s countdown) → ACTIVE → PAUSED → SET_COMPLETE → RESTING → SESSION_COMPLETE`
  - Pause triggers: HR > limit for 20s sustained; H10 disconnect; person count 0 for 2s; person count ≥2 for 2s
  - Resume logic: hr_breach requires T-pose + HR < limit-10 for 10s; others auto-resume
  - Between sets (same exercise): RESTING countdown; between exercises: 5s SET_COMPLETE then READY
  - `destroy()` for cleanup; `destroyed` flag guards all async callbacks
- **`components/hr/HRRing.tsx`** — canvas ring with RAF animation
  - Green: HR < limit; Blue: HR < 60% of limit; Red blinking (500ms): HR > limit
- **`components/pose/CameraStickman.tsx`** — added `onPose` callback for raw `NormalizedLandmark[][]` + timestamp
- **`app/(patient)/patient/session/[prescriptionId]/run/page.tsx`** — server component
  - Loads prescription + items + exercises from Supabase
  - Applies per-patient angle overrides; builds flat `SetEntry[]` across all items × sets
  - Determines `startSetIdx` from `?item=<id>&set=<n>` URL params
- **`app/(patient)/patient/session/[prescriptionId]/run/SessionRunClient.tsx`** — full-screen session UI
  - Camera always in background; state-specific overlays on top
  - T-pose progress ring; mute toggle; optional H10 connect before start
  - Auto-navigates to `/patient/calendar` 3s after SESSION_COMPLETE

**Key files:** `lib/audio/cues.ts`, `lib/pose/repDetector.ts`, `lib/pose/tposeDetector.ts`, `lib/pose/sessionStateMachine.ts`, `components/hr/HRRing.tsx`, `app/(patient)/patient/session/*/run/`

---

## Phase 7 — Data persistence (IndexedDB → Supabase)

- **`lib/buffer/sessionBuffer.ts`** — Dexie database `shf-session-buffer` v1
  - Stores: `sessions`, `hrSamples`, `poseFrames` (keyed by `${sessionId}|${secondOffset}`), `sets`, `reps`, `pauses`
  - Pose downsampler: gates writes to a 100ms minimum interval per session (10fps target)
  - Pose frames append into 1-second JSONB buckets via read-modify-write transaction (matches `session_pose_frames.frames` schema: `[{ts_ms, lm:[[x,y,z]×33]}, ...]`)
  - HR samples written verbatim from H10 (timestamps already wall-clock)
  - Set/rep/pause records keyed by UUIDs minted client-side (Supabase PKs match)
  - Helpers: `startSession`, `recordHR`, `recordPoseFrame`, `recordSetStart/Complete`, `recordRep`, `recordPauseStart/End`, `markSessionComplete/Uploaded`, `getUnflushedSessions`, `loadSessionBundle`, `clearSession`
- **`lib/sync/uploader.ts`** — batch upload to Supabase
  - Insert order: `sessions` → `session_sets` → `session_reps` → `session_pauses` → `session_hr_samples` → `session_pose_frames` (FK-safe)
  - Batches: HR=500/req, pose=200/req, sets/reps/pauses=200/req
  - On clean completion: marks `prescriptions.status = 'completed'`
  - Exponential backoff: up to 5 attempts at 1s/2s/4s/8s/16s (capped 30s); on success, marks uploaded then clears local
  - `flushPending()` drains every locally completed-but-not-uploaded session
  - Typed via `Database['public']['Tables'][T]['Insert']`
- **`lib/pose/sessionStateMachine.ts`** — extended with discrete event callbacks
  - New `SessionEvents`: `onSetStart`, `onSetEnd`, `onRepComplete`, `onPauseStart`, `onPauseEnd`, `onSessionEnd`
  - `SetEntry` gained `exerciseId` so reps/sets can FK to `exercises`
  - `enterActive` only fires `onSetStart` when transitioning from READY (not on resume from PAUSED)
  - `enterSetComplete` carries the reason (`reps_complete`/`t_pose`/`abandoned`) into the event
- **`SessionRunClient.tsx`** — wires the state machine to the buffer
  - On Start: mints `sessionId` (`crypto.randomUUID()`), captures `Date.now()` + `performance.now()` baselines for perf→wall conversion, writes the session row, then starts the state machine
  - Mints UUIDs per set & per pause; FKs through to reps/pauses
  - Pose recorder gated to `phase === 'ACTIVE'` (no wasted writes during overlays)
  - On `SESSION_COMPLETE`: marks complete, uploads, then navigates back to calendar (with retry-message fallback if upload fails)
- **`components/patient/PendingUploadFlusher.tsx`** — orphan-flush helper
  - Mounted in `/patient/calendar`; on load, scans Dexie for unflushed completed sessions and uploads them via `flushPending()`
  - Shows a small bottom-right toast while uploading and on success/failure
- **`app/(patient)/patient/session/[prescriptionId]/run/page.tsx`** — server props
  - Now selects `patient_id` and `exercise_id`; passes them through to the client

**Key files:** `lib/buffer/sessionBuffer.ts`, `lib/sync/uploader.ts`, `components/patient/PendingUploadFlusher.tsx`, `lib/pose/sessionStateMachine.ts`, `app/(patient)/patient/session/[prescriptionId]/run/`

---

## Remaining phases

| Phase | Description |
|---|---|
| 8 | Clinician playback — stickman replay, HR trend chart, synced scrubber, per-rep table |
| 9 | Polish — frame visibility check, implausible HR handling, browser/permission error screens, session abandonment recovery |
