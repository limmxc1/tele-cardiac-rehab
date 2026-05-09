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

## Phase 7.1 — Persistence hardening (audit fixes)

Audit of Phase 7 found several blockers; fixed in a follow-up patch:

- **Idempotent uploads** — every `uploader.ts` insert switched to `.upsert` with explicit `onConflict` keys (`id` for sessions/sets/reps/pauses, `session_id,timestamp_ms` for HR, `session_id,second_offset` for pose). A failed mid-upload retry now converges instead of duplicate-PK-throwing on rows the previous attempt already wrote.
- **Client-minted rep IDs** — `BufferedRep.repId` is now a client UUID stored as the primary key in both Dexie and Supabase, so retries can't multiply rep rows. Bumped Dexie schema to v2.
- **Pause→resume phantom-set fix** — on resume, the state machine fires `enterReady → enterActive` which re-emits `onSetStart`; `SessionRunClient` now reuses the existing `setId` for that `setIdx` instead of minting a new one (no more orphaned half-completed set rows).
- **HR/pose timestamp domain alignment** — pose `frames[].ts_ms` now stores epoch ms (same domain as `session_hr_samples.timestamp_ms` and `sessions.started_at`). The outer `second_offset` still encodes session-relative seconds for cheap chunking. Joining HR + pose is now a direct timestamp comparison.
- **Resume + leak fix** — `markStaleInProgressAbandoned` (called by `PendingUploadFlusher` on calendar load) promotes any `in_progress` session older than 1 hour to `abandoned` so `flushPending` picks it up. `handleStart` calls `abandonStaleSessionsFor(patient, prescription)` so a fresh session start retires whatever the previous tab/crash left behind. `beforeunload` / `pagehide` listeners mark the active session abandoned on tab close.
- **Concurrent-flush race** — added a per-`sessionId` in-memory mutex in `uploader.ts` so the post-completion path and the calendar flusher can't double-upload the same session.
- **Pose row ordering + bundle-wide HR dedup** — pose batches now sorted by `secondOffset`, HR dedup runs across the entire bundle (not per-batch).

**Key files:** `lib/buffer/sessionBuffer.ts`, `lib/sync/uploader.ts`, `components/patient/PendingUploadFlusher.tsx`, `app/(patient)/patient/session/[prescriptionId]/run/SessionRunClient.tsx`

---

## Phase 8 — Clinician playback

Synchronized session replay for clinicians: stickman, HR trend, scrubber, per-rep table, notes.

- **Session history table** — `app/(clinician)/clinician/patients/[id]/page.tsx` replaces the placeholder with a real table (date, exercises, total reps, max HR, status, "Review →" link). Aggregates fetched in two parallel queries against `session_sets` (reps + exercise names) and `session_hr_samples` (max HR), then merged in JS keyed by `session_id`.
- **Playback bundle loader** — `lib/playback/loader.ts` fetches the session row + sets/reps/pauses/HR/pose-frames in five parallel queries, normalizes every timestamp to **ms-since-session-start**, flattens packed pose frames (`{ts_ms, lm[33×3]}`) into a single sorted array, and hands the client a single immutable `PlaybackBundle`. Duration falls back to the latest of `last_pose / last_hr / last_rep` when `completed_at` is null.
- **StickmanCanvas** (`components/playback/StickmanCanvas.tsx`) — DPR-aware canvas that binary-searches the pose array for the current playback time, lerps landmarks between adjacent frames, and projects normalized coords into a 4:3 letterboxed view. **Anatomical (not mirrored)**: patient's right hand appears on viewer's left.
- **HRTimeline** (`components/playback/HRTimeline.tsx`) — recharts line chart with HR-upper-limit reference line and a vertical cursor at `currentTMs`. X axis ticks formatted as `m:ss`.
- **SyncedScrubber** (`components/playback/SyncedScrubber.tsx`) — play/pause, 0.5×/1×/2× speed buttons, and a range scrubber with pause-event markers (gray bars) overlaid on the track; markers' titles describe the pause reason on hover. Custom thumb styling via inline `<style>`.
- **PlaybackClient** (`components/playback/PlaybackClient.tsx`) — the orchestrator. Single `currentTMs` state driven off `requestAnimationFrame` (multiplied by speed); auto-stops at `durationMs`. Computes `repsDone` and the active exercise/set label by scanning reps in playback order. Lays out scrubber on top, stickman + HR side-by-side, then notes editor and per-rep table.
- **RepTable** (`components/playback/RepTable.tsx`) — clickable rows that seek the playback to that rep's `startedTMs`; the active rep's row is highlighted blue. Shows set #, exercise, rep #, time, peak°, ROM°, HR @ peak.
- **Clinician notes** — `NotesEditor.tsx` + `app/actions/sessionNotes.ts` server action that updates `sessions.clinician_notes` and revalidates the playback path.
- **Page** — `app/(clinician)/clinician/patients/[id]/sessions/[sid]/playback/page.tsx` validates the session belongs to the patient (checks `bundle.patientId === id`, `notFound()` otherwise), then renders the client.

**Key files:** `lib/playback/loader.ts`, `components/playback/{StickmanCanvas,HRTimeline,SyncedScrubber,RepTable,NotesEditor,PlaybackClient}.tsx`, `app/actions/sessionNotes.ts`, `app/(clinician)/clinician/patients/[id]/page.tsx`, `app/(clinician)/clinician/patients/[id]/sessions/[sid]/playback/page.tsx`

---

## Phase 9 — Polish + edge cases

Hardening the runtime against real-world failure modes: bad HR signal, missing browser features, denied permissions, dropped sessions, and patients who haven't framed up yet.

- **Implausible HR filtering** — `feedHR` still surfaces every raw bpm to the UI (so clinicians see the dropouts), but the breach/recovery state machine only reacts to readings in [40, 220]. H10's signal-loss zeros and momentary spikes would otherwise either spuriously pause the session or auto-resume from a real breach.
- **Browser support banner** — `components/patient/BrowserSupportBanner.tsx` mounted in the patient layout. Lazy-init checks for Web Bluetooth, MediaDevices.getUserMedia, and iOS UA on the client; renders an amber dismissable banner if anything is missing. Dismissal is persisted in localStorage.
- **Camera permission error UI** — `CameraStickman` now classifies getUserMedia rejection (`denied` / `unavailable` / `unknown`) and bubbles it up via `onCameraError`. `SessionRunClient` shows a full-screen blocker with a friendly message and Retry button; Retry tears down and remounts the camera by bumping a `cameraRetryKey` used as the component's `key`.
- **Bluetooth permission feedback** — H10 connect failures are translated to friendly messages (`SecurityError` / `NotAllowedError` / "not supported") and rendered under the Connect button. `NotFoundError` (user dismissed the chooser) is silent — that's not really an error.
- **Resume previous session** — On run-page mount we call `findResumableSession(patientId, prescriptionId)`. If a buffered `in_progress` session exists, the IDLE overlay swaps to a "Resume previous session?" panel with Resume / Discard. **Resume** keeps the existing `sessionId` and ORIGINAL `startedAt` (so pose-frame `second_offset` chunking stays continuous with the buffered data), but resets the `clockBaseWall` / `clockBasePerf` pair to "now" so `toWall()` keeps producing real wall-clock timestamps. **Discard** calls `abandonStaleSessionsFor` so the buffered data uploads on the next flush, then drops the offer.
- **Clock-baseline split** — `sessionStartWallRef`/`sessionStartPerfRef` were doing two jobs (perf↔wall conversion AND second_offset baseline). Split into `clockBaseWallRef`+`clockBasePerfRef` (conversion, reset on resume) and `sessionStartedAtWallRef` (chunking baseline, never moved).
- **Pre-set in-frame visibility check** — `SessionStateMachine` now gates READY → ACTIVE on TWO conditions: 3-second countdown finished AND all 33 landmarks `visibility ≥ 0.5` for 2 continuous seconds. New `inFrameProgress` field on the snapshot. The READY overlay shows a "Step fully into the frame" amber coaching message and progress bar once the countdown hits zero but visibility hasn't sustained yet.
- **Tripod calibration helper** (deferred, per plan §8) — the in-frame visibility check above provides equivalent feedback during pre-roll. A dedicated overlay would be added only if real-world testing reveals framing problems the visibility check doesn't catch.

**Key files:** `lib/pose/sessionStateMachine.ts`, `app/(patient)/patient/session/[prescriptionId]/run/SessionRunClient.tsx`, `components/pose/CameraStickman.tsx`, `components/patient/BrowserSupportBanner.tsx`, `app/(patient)/layout.tsx`

---

## Patch — Dexie primary-key migration

Phase 7.1 tried to change the `reps` store PK from `++id` to `repId` in a single Dexie version step. Dexie throws `DatabaseClosedError("Not yet support for changing primary key")` at runtime, so any browser that already had the v1 schema couldn't open the DB at all. Fix: split into v2 (`reps: null` deletes the store) and v3 (recreates with the new PK). Sessions/sets/HR/pose/pause data carries over; only any v1 reps that hadn't yet uploaded are lost. Other tables are untouched.

---

## Patch — Patient run-page 2-column layout

The full-screen camera was visually overwhelming for elderly patients on a tablet. Restructured `SessionRunClient`:

- **Top bar** (compact strip): exercise name + "Set X of Y" left, H10 status + mute right.
- **Left column (50%)**: live camera with skeleton overlay (`CameraStickman` unchanged).
- **Right column (50%)**: stacked panels — large reps counter (`{repsCompleted} / {repsTarget}`), HR ring (size 140), and a clean stickman figure (`components/patient/LiveStickman.tsx`). Reference GIF (when present) tucks at the bottom-right of the column. T-pose ring overlays the stickman corner during ACTIVE.
- **Live stickman component**: dedicated canvas rendered from the latest landmarks via an rAF loop reading from a ref (`latestLmRef`). Avoids 30fps React re-renders. Same skeleton geometry as the camera overlay but on a dark panel without the video underneath.
- **Pose dispatch**: `handlePose` writes to `latestLmRef.current` so the panel is fed without prop changes.
- **State overlays** (IDLE / READY / PAUSED / SET_COMPLETE / RESTING / SESSION_COMPLETE) and the camera-error blocker remain full-viewport `absolute inset-0` modals on top of the columns.

**Key files:** `app/(patient)/patient/session/[prescriptionId]/run/SessionRunClient.tsx`, `components/patient/LiveStickman.tsx`

---

## Patch — Playback HR readout, lower pose FPS, live joint angles, secondary joint focus

Three connected enhancements:

### 1. HR display in clinician playback
The `HRTimeline` already drew a Recharts line, but the cursor's HR value wasn't legible at a glance. Added a header inside the panel showing `HR @ mm:ss` and the current bpm at the scrubber position (red when above the prescription's upper limit), plus a sample-count chip. Auto-scaling Y-min so flat low-HR sessions don't render as a hairline at the bottom edge. The "no HR data" placeholder now hints at H10 pairing as the likely cause.

### 2. Lower pose FPS to halve storage
`POSE_TARGET_INTERVAL_MS` in `lib/buffer/sessionBuffer.ts` raised from 100ms → 200ms (10fps → 5fps). Stickman replay and scrubbing remain smooth (canvas redraws at scrub rAF cadence regardless of source fps; landmark interpolation already handles gaps). Direct halving of pose row volume in IndexedDB and `session_pose_frames`.

### 3. Live primary + secondary joint angles during scrubbing
- **Loader**: `loadPlaybackBundle` now joins `exercises` for each `session_set` and includes `primaryJoint`, `primarySide`, `secondaryJoint`, and the four start/end angle thresholds in `PlaybackSet`. Secondary side reuses primary side (we don't store a separate column).
- **StickmanCanvas**: extracted `resolveFrame(poses, currentTMs)` so both the canvas drawing path and external code share the same lerped landmarks frame at the current scrub position. Avoids drift between visual stickman and computed angle.
- **JointAngleReadout** (new): receives the resolved frame + the active set's joint config and renders large primary/secondary angle values with start/end-zone classification. Computes both angles from the same interpolated frame so they update live as the user drags the scrubber.
- **PlaybackClient**: picks the active `PlaybackSet` based on `startedTMs <= currentTMs` and feeds the readout. Lays out as a right-column stack: HR panel on top, joint readout below, stickman in the left column.

### 4. Secondary joint focus in exercise creation
DB columns (`secondary_joint`, `secondary_start_min/max`, `secondary_end_min/max`) were already in `0002_exercises.sql` but unused by the form. Added an "Enable" toggle in `NewExerciseClient` that reveals a joint dropdown (side reuses the primary side per `lib/pose/repDetector.ts` semantics) and four threshold sliders for start/end zones. The demo overlay's HUD now shows both angles side-by-side when secondary is enabled, so the clinician can verify both joints reach their target zones before saving. `ExercisePayload` and `createExerciseAction` extended with the five nullable secondary fields; null = "primary only" (existing behavior).

**Key files:** `lib/buffer/sessionBuffer.ts`, `lib/playback/loader.ts`, `components/playback/StickmanCanvas.tsx`, `components/playback/HRTimeline.tsx`, `components/playback/JointAngleReadout.tsx`, `components/playback/PlaybackClient.tsx`, `app/(clinician)/clinician/exercises/new/NewExerciseClient.tsx`, `app/actions/exercises.ts`

---

## Patch — O-pose start gesture, partial-body pause, recording gate

Three connected changes that ensure only clean data lands in storage and the patient explicitly signals readiness before each set:

### 1. O-pose start gesture (replaces the 3-second auto-countdown)
- New `lib/pose/oposeDetector.ts`: detects "arms above head, hands meeting" — both wrists ≥5% above shoulders, at/above the nose, and within 12% normalized distance of each other. 1.5s sustained hold fires `onDetected()`.
- `SessionStateMachine` instantiates an `OPoseDetector` alongside the T-pose one. READY→ACTIVE is now gated on the O-pose firing (no auto-start). The countdown timer + `IN_FRAME_REQUIRED_MS` + `inFrameSinceMs` field have all been removed.
- `enterReady()` no longer schedules a `setTimeout`. It just resets state and speaks the new `startReadyCue` ("Make a circle above your head with both hands to start"), replacing the old "three, two, one, begin" countdown.
- The state machine snapshot exposes `oPoseProgress` (0..1) for the UI ring and `fullyInFrame` so the overlay can suppress the gesture coaching until the body is in frame. `countdownSecondsLeft` is kept (always 0) for back-compat with any older consumer.

### 2. Partial-body pause during ACTIVE
- `feedPose()` checks `isFullyInFrame(landmarks)` (helper exported now) on every frame. If a frame is partial (any of the 33 landmarks below the 0.5 visibility threshold), `partialBodyStart` begins; after 2 sustained seconds the session auto-pauses with `pauseReason: 'out_of_frame'`. Auto-resumes when the body becomes fully visible again with exactly one person in frame.
- Multi-person pause path (`setPersonCount` ≥ 2) was already in place from Phase 7.4.
- Pause overlay copy updated: `out_of_frame` now reads "Body Not Fully Visible — Recording paused — step into the frame so all of you is visible" so it covers both "you walked off-camera" and "your knees are below the bottom edge".
- The audio cue line for `out_of_frame` was updated to match.

### 3. Recording gate — no partial frames written
- `handlePose` in `SessionRunClient` only calls `recordPoseFrame` when phase is ACTIVE **and** `poses.length === 1` **and** `isFullyInFrame(first)`. The state machine already pauses on these conditions but the 2-second debounce window could leak partial frames; this defense-in-depth check guarantees the buffer / Supabase only sees fully-visible single-person frames. (HR samples are unaffected — H10 data is independent of camera state.)

### 4. UI overlay
- READY overlay rewritten: card now reads "Make an 'O' above your head to start" with sub-instruction, plus a blue progress ring (`OPoseRing`) that fills as the gesture is held. If the body isn't fully visible yet, the ring is replaced by an amber "Step fully into the frame" hint so the patient fixes their framing first.
- IDLE start-screen hint updated to mention the O-pose gesture in addition to the T-pose end-of-set gesture.

**Key files:** `lib/pose/oposeDetector.ts` (new), `lib/pose/sessionStateMachine.ts`, `lib/audio/cues.ts`, `app/(patient)/patient/session/[prescriptionId]/run/SessionRunClient.tsx`

---

## Patch — T-pose ends workout, squats fix, end-workout button, exercise delete, view orientation, 4-trend playback

A bundle of patient-feedback fixes plus a clinician-side enhancement.

### 1. T-pose ends the entire workout (was: ends current set)
`SessionStateMachine.onTPoseDetected` no longer routes to `enterSetComplete('t_pose')`. The new `endSession(reason)` private helper closes the in-progress set with `ended_reason='t_pose'`, transitions through `SET_COMPLETE` for 1.5s (so the buffer picks up `onSetEnd`), then jumps to `SESSION_COMPLETE` and fires `onSessionEnd`. Remaining sets are skipped. The behavior was changed at user request — patients use T-pose to terminate the workout entirely, not just one set.

### 2. Squats not detected — joint-aware visibility gate
`isFullyInFrame` was checking all 33 landmarks at visibility ≥ 0.5, which routinely failed for squat-style movements that hide feet/face from a tablet camera. New behavior:
- `isFullyInFrame` now only checks the body landmarks needed for joint math (11–16, 23–28, 31–32). Face (0–10), fingers (17–22), and heels (29–30) are ignored.
- `isRepJointVisible(landmarks, repConfig)` — new helper. Checks only the specific triplet(s) for the configured primary (and optional secondary) joint at a relaxed 0.3 visibility threshold.
- `feedPose` ACTIVE path now feeds the rep detector whenever the joint is visible, regardless of full-body visibility. Partial-body pause still triggers, but only when the relevant joint is occluded.
- Squat reps register even when the patient's head dips out of frame at the bottom of the squat.

### 3. End Workout button (mid-session manual stop)
- New `endSessionEarly(reason)` public method on `SessionStateMachine`. Default reason `'abandoned'`. Fires the same `onSetEnd → onSessionEnd` sequence so the buffer flushes consistently.
- Top bar in `SessionRunClient` shows a red "End workout" button while `phase` is anything except `IDLE` or `SESSION_COMPLETE`. Tapping it opens a confirmation overlay; confirming calls `smRef.current.endSessionEarly('abandoned')`. The existing post-completion upload path then runs.

### 4. Soft delete exercises
- Migration `0007_exercise_archive_view.sql`: adds `archived_at timestamptz` column to `exercises`. FK references from `prescription_items`/`session_sets` keep working — past playback resolves; the row just stops appearing in pickers.
- `archiveExerciseAction(id)` in `app/actions/exercises.ts` sets `archived_at = now()` and revalidates `/clinician/exercises`.
- Exercise list (`/clinician/exercises`) and prescription builder (`/clinician/prescribe/[patientId]`) now filter `.is('archived_at', null)`.
- Per-row `DeleteExerciseButton` (client component) handles the inline two-step confirm UX.

### 5. View orientation per exercise
Same migration adds `view_orientation text not null default 'front' check (view_orientation in ('front', 'side'))`. Patient must be in the requested orientation before the start gesture is accepted.

- `lib/pose/orientationDetector.ts` (new): `detectOrientation(landmarks)` classifies front vs side from shoulder/hip x-spread (front: ≥ 10% horizontal spread; side: ≤ 6% — i.e. shoulders stacked in x). `OrientationGate` requires a 1-second sustained hold before reporting progress = 1.
- `SetEntry` gained `viewOrientation: 'front' | 'side'`. The state machine instantiates a fresh `OrientationGate` per set in `enterReady()`.
- READY overlay is now three-stage: in-frame → orientation → O-pose. UI shows a per-stage instruction ("Stand sideways to the camera" / "Face the camera") and an amber progress bar while the orientation hold accrues.
- Snapshot exposes `orientationProgress` (0..1) and `orientationOk` (bool).
- Exercise creation form (`NewExerciseClient.tsx`) has a two-button orientation picker. Persisted via `view_orientation` on `ExercisePayload`.
- The exercises list shows orientation in a "View" column.

### 6. Playback right column — 4 stacked line-graph trends
Replaces the old `HRTimeline` + `JointAngleReadout` panels with `MetricsTimeline.tsx`, which stacks four mini line charts that share a time axis and a synchronized scrubber cursor:
1. **HR** (bpm) — keeps the upper-limit reference dash; reading goes red when the cursor sample exceeds the limit.
2. **Primary joint angle** (°) — derived per-frame from `bundle.poses` using whichever set's joint is active at that timestamp. Y-axis auto-scales to the actual data range with cushion (handles joints with bidirectional motion — e.g. arm raises swing both above and below shoulder height — without flat-lining).
3. **Secondary joint angle** (°) — same approach; renders only when the active set has a secondary joint configured.
4. **Reps** — step-after line (count vs time) drawn from rep `startedTMs`. Y-axis caps at total reps in the bundle.

Primary chart adds light blue/red `ReferenceArea` bands for start/end zones of the active set so clinicians can see how angle traces relate to the prescribed thresholds. The old `JointAngleReadout` and `HRTimeline` components are no longer wired into the page (kept on disk for now in case we want to bring them back; can be deleted later).

**Key files:** `lib/pose/sessionStateMachine.ts`, `lib/pose/orientationDetector.ts` (new), `app/(patient)/patient/session/[prescriptionId]/run/SessionRunClient.tsx`, `app/(patient)/patient/session/[prescriptionId]/run/page.tsx`, `app/actions/exercises.ts`, `app/(clinician)/clinician/exercises/page.tsx`, `app/(clinician)/clinician/exercises/DeleteExerciseButton.tsx` (new), `app/(clinician)/clinician/exercises/new/NewExerciseClient.tsx`, `app/(clinician)/clinician/prescribe/[patientId]/page.tsx`, `db/migrations/0007_exercise_archive_view.sql` (new), `lib/supabase/types.ts`, `components/playback/MetricsTimeline.tsx` (new), `components/playback/PlaybackClient.tsx`

---

## Patch — Exercise delete cascades to prescriptions, per-session delete

Two clinician-facing cleanup affordances:

### 1. Exercise delete now removes the exercise from every patient
`archiveExerciseAction` previously only flipped `archived_at`, so existing prescriptions kept showing the deleted exercise on the patient calendar. New behavior:
1. Look up `session_sets.prescription_item_id` rows pointing at the exercise — these item ids are "protected" (we can't delete them without breaking session FKs that drive playback).
2. Hard-delete every other `prescription_items` row referencing the exercise.
3. For each prescription that lost an item, if it has zero remaining items AND no `sessions` row points at it, delete the prescription too (avoids leaving empty placeholders on the patient calendar).
4. Then set `archived_at` on the exercise itself.

Result: deleting an exercise immediately scrubs it from every patient's upcoming calendar, while historic playback (sessions that already ran) remains fully resolvable. Revalidates `/clinician/exercises` and `/clinician/patients`.

### 2. Per-session delete from patient detail
- New `deleteSessionAction({ sessionId, patientId })` in `app/actions/sessionNotes.ts`. Deletes the `sessions` row; ON DELETE CASCADE on `session_sets`/`session_reps`/`session_pauses`/`session_hr_samples`/`session_pose_frames` purges all derived time-series rows. Scoped by `patient_id` as a guard.
- New client component `app/(clinician)/clinician/patients/[id]/DeleteSessionButton.tsx` — same two-step confirm pattern as the exercise delete button.
- Patient detail session-history table now renders the button next to the existing "Review →" link.

**Key files:** `app/actions/exercises.ts`, `app/actions/sessionNotes.ts`, `app/(clinician)/clinician/patients/[id]/page.tsx`, `app/(clinician)/clinician/patients/[id]/DeleteSessionButton.tsx` (new)

---

## Patch — Delete scheduled prescriptions

Counterpart to "+ Prescribe Routine": clinicians can now drop a scheduled day off a patient's calendar without a re-prescribe round-trip.

- New `deletePrescriptionAction({ prescriptionId, patientId })` in `app/actions/prescriptions.ts`. Refuses to delete if any `sessions` row references the prescription (an FK without ON DELETE CASCADE — and we want session history preserved as its own decision). On success, ON DELETE CASCADE on `prescription_items.prescription_id` purges the items automatically.
- New `DeletePrescriptionButton.tsx` (same two-step confirm pattern as the exercise/session delete buttons). Wired into a new right-aligned column on the patient detail "Prescription History" table.
- If the prescription has session history, the action returns a friendly error explaining the user should delete the session first; the button surfaces that text inline.

**Key files:** `app/actions/prescriptions.ts`, `app/(clinician)/clinician/patients/[id]/page.tsx`, `app/(clinician)/clinician/patients/[id]/DeletePrescriptionButton.tsx` (new)
