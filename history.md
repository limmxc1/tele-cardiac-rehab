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
