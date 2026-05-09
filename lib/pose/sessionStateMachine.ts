import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { RepDetector, type RepConfig, type RepEvent } from './repDetector'
import { TPoseDetector } from './tposeDetector'
import { OPoseDetector } from './oposeDetector'
import {
  startReadyCue, repCue, restCue, nextExerciseCue,
  pauseCue, resumeReadyCue, sessionCompleteCue,
  type PauseReason,
} from '../audio/cues'

export type { PauseReason, RepEvent }

/** Visibility threshold (0..1) for a landmark to count as "in frame". */
const VISIBILITY_THRESHOLD = 0.5
/** Sustained partial-body visibility that triggers an out_of_frame pause during ACTIVE. */
const PARTIAL_BODY_PAUSE_MS = 2_000

export function isFullyInFrame(landmarks: NormalizedLandmark[]): boolean {
  if (landmarks.length < 33) return false
  for (const lm of landmarks) {
    const v = lm.visibility
    if (v === undefined || v < VISIBILITY_THRESHOLD) return false
  }
  return true
}

export type SessionPhase =
  | 'IDLE' | 'READY' | 'ACTIVE' | 'PAUSED'
  | 'SET_COMPLETE' | 'RESTING' | 'SESSION_COMPLETE'

export interface SetEntry {
  prescriptionItemId: string
  exerciseId: string
  itemIndex: number
  setNumber: number    // 1-based
  totalSets: number
  exerciseName: string
  repConfig: RepConfig
  repsTarget: number
  restSeconds: number
  referenceGifUrl: string | null
  isLastSetOfItem: boolean
  isLastSet: boolean
  nextExerciseName: string | null
}

export type SetEndReason = 'reps_complete' | 't_pose' | 'abandoned'

export interface SessionEvents {
  onSetStart?: (e: { setIdx: number; set: SetEntry; ts_ms: number }) => void
  onSetEnd?: (e: {
    setIdx: number
    set: SetEntry
    ts_ms: number
    reason: SetEndReason
    repsCompleted: number
  }) => void
  onRepComplete?: (e: { setIdx: number; repNumber: number; rep: RepEvent }) => void
  onPauseStart?: (e: { reason: PauseReason; ts_ms: number }) => void
  onPauseEnd?: (e: { ts_ms: number }) => void
  onSessionEnd?: (e: { ts_ms: number }) => void
}

export interface SessionSnapshot {
  phase: SessionPhase
  set: SetEntry
  repsCompleted: number
  pauseReason: PauseReason | null
  tposeProgress: number
  restSecondsLeft: number
  hrBpm: number | null
  /** Legacy — always 0 now that the start gesture replaces the countdown. Kept so older callers don't break. */
  countdownSecondsLeft: number
  completedReps: RepEvent[]
  /** True while in READY iff the latest pose has all 33 landmarks visible. UI uses this to coach the user. */
  fullyInFrame: boolean
  /** 0..1 — O-pose hold progress during READY (start-of-set gesture). */
  oPoseProgress: number
}

export class SessionStateMachine {
  private phase: SessionPhase = 'IDLE'
  private setIdx: number
  private repsCompleted = 0
  private completedReps: RepEvent[] = []
  private pauseReason: PauseReason | null = null
  private tposeProgress = 0
  private restSecondsLeft = 0
  private destroyed = false

  private repDetector: RepDetector | null = null
  private tposeDetector: TPoseDetector
  private oposeDetector: OPoseDetector

  private latestHr: number | null = null
  private hrBreachStart: number | null = null
  private hrRecoveryStart: number | null = null
  private hrOkForResume = false

  private personCount = 1
  private outOfFrameStart: number | null = null
  private multiPersonStart: number | null = null
  /** Sustained partial-body visibility timer during ACTIVE. */
  private partialBodyStart: number | null = null

  // READY view state — surfaced in snapshots so the UI can coach the patient.
  private fullyInFrame = false
  private oPoseProgress = 0

  private restInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly sets: SetEntry[],
    startSetIdx: number,
    private readonly hrLimit: number,
    private readonly onChange: (snap: SessionSnapshot) => void,
    private readonly events: SessionEvents = {},
  ) {
    this.setIdx = startSetIdx
    this.tposeDetector = new TPoseDetector(() => this.onTPoseDetected())
    this.oposeDetector = new OPoseDetector(() => this.onOPoseDetected())
  }

  private get cur(): SetEntry { return this.sets[this.setIdx] }

  start(): void {
    if (this.phase !== 'IDLE') return
    this.enterReady()
    this.emit()
  }

  feedPose(landmarks: NormalizedLandmark[], timestamp_ms: number): void {
    const fully = isFullyInFrame(landmarks)
    this.fullyInFrame = fully

    if (this.phase === 'ACTIVE') {
      // Gate rep detection on a fully-visible body so partial frames don't
      // confuse the angle/state machine. Also pause the session if the body
      // stays partial for too long — clinician needs clean data only.
      if (fully) {
        this.partialBodyStart = null
        this.repDetector?.feed(landmarks, this.latestHr, timestamp_ms)
        this.tposeProgress = this.tposeDetector.feed(landmarks, timestamp_ms)
      } else {
        if (this.partialBodyStart === null) this.partialBodyStart = timestamp_ms
        else if (timestamp_ms - this.partialBodyStart >= PARTIAL_BODY_PAUSE_MS) {
          this.enterPaused('out_of_frame')
        }
      }
    } else if (this.phase === 'PAUSED' && this.pauseReason === 'hr_breach') {
      this.tposeProgress = this.tposeDetector.feed(landmarks, timestamp_ms)
    } else if (this.phase === 'PAUSED' && this.pauseReason === 'out_of_frame') {
      // Auto-resume once the body is fully visible again (single person already
      // implied by feedPose — multi-person resume is handled in setPersonCount).
      if (fully && this.personCount === 1) this.resumeFromPause()
    } else if (this.phase === 'READY') {
      // Start gesture: only count O-pose progress when the body is fully visible
      // (so we don't latch on partial poses). Reset on any partial frame.
      if (fully && this.personCount === 1) {
        this.oPoseProgress = this.oposeDetector.feed(landmarks, timestamp_ms)
      } else {
        this.oposeDetector.reset()
        this.oPoseProgress = 0
      }
    }
    this.emit()
  }

  feedHR(hr_bpm: number, timestamp_ms: number): void {
    // Always surface the raw value to the UI; clinicians can see the dropouts.
    this.latestHr = hr_bpm

    // …but only let the breach/recovery state machine react to physiologically
    // plausible readings. H10 emits 0 (and occasional spikes) during signal
    // loss; using those would either spuriously pause the session (false high)
    // or auto-resume from a real breach (false low).
    const plausible = hr_bpm >= 40 && hr_bpm <= 220
    if (!plausible) {
      this.emit()
      return
    }

    if (this.phase === 'ACTIVE') {
      if (hr_bpm > this.hrLimit) {
        if (this.hrBreachStart === null) this.hrBreachStart = timestamp_ms
        else if (timestamp_ms - this.hrBreachStart >= 20_000) {
          this.enterPaused('hr_breach')
        }
      } else {
        this.hrBreachStart = null
      }
    }

    if (this.phase === 'PAUSED' && this.pauseReason === 'hr_breach') {
      if (hr_bpm < this.hrLimit - 10) {
        if (this.hrRecoveryStart === null) this.hrRecoveryStart = timestamp_ms
        if (timestamp_ms - this.hrRecoveryStart >= 10_000) this.hrOkForResume = true
      } else {
        this.hrRecoveryStart = null
        this.hrOkForResume = false
      }
    }

    this.emit()
  }

  setPersonCount(count: number, timestamp_ms: number): void {
    this.personCount = count

    if (this.phase === 'ACTIVE') {
      if (count === 0) {
        if (this.outOfFrameStart === null) this.outOfFrameStart = timestamp_ms
        else if (timestamp_ms - this.outOfFrameStart >= 2_000) this.enterPaused('out_of_frame')
      } else {
        this.outOfFrameStart = null
      }

      if (count >= 2) {
        if (this.multiPersonStart === null) this.multiPersonStart = timestamp_ms
        else if (timestamp_ms - this.multiPersonStart >= 2_000) this.enterPaused('multiple_people')
      } else {
        this.multiPersonStart = null
      }
    }

    if (
      this.phase === 'PAUSED' &&
      (this.pauseReason === 'out_of_frame' || this.pauseReason === 'multiple_people') &&
      count === 1
    ) {
      this.resumeFromPause()
    }

    this.emit()
  }

  setH10Connected(connected: boolean): void {
    const wasConnected = this.personCount >= 0 // dummy — track via separate flag below
    void wasConnected
    if (!connected && this.phase === 'ACTIVE') {
      this.enterPaused('h10_disconnect')
    }
    if (connected && this.phase === 'PAUSED' && this.pauseReason === 'h10_disconnect') {
      this.resumeFromPause()
    }
    this.emit()
  }

  destroy(): void {
    this.destroyed = true
    this.clearRestTimer()
  }

  private enterReady(): void {
    this.phase = 'READY'
    this.repsCompleted = 0
    this.completedReps = []
    this.tposeProgress = 0
    this.tposeDetector.reset()
    this.oposeDetector.reset()
    this.oPoseProgress = 0
    this.partialBodyStart = null
    startReadyCue()
  }

  private onOPoseDetected(): void {
    if (this.phase !== 'READY') return
    this.enterActive()
    this.emit()
  }

  private enterActive(): void {
    const wasReady = this.phase === 'READY'
    this.phase = 'ACTIVE'
    this.hrBreachStart = null
    this.outOfFrameStart = null
    this.multiPersonStart = null
    this.partialBodyStart = null
    this.oPoseProgress = 0
    this.oposeDetector.reset()
    this.repDetector = new RepDetector(this.cur.repConfig, (ev) => this.onRepComplete(ev))
    this.tposeDetector.reset()
    // Only fire onSetStart when transitioning from READY (not from PAUSED → ACTIVE).
    if (wasReady) {
      this.events.onSetStart?.({ setIdx: this.setIdx, set: this.cur, ts_ms: performance.now() })
    }
  }

  private onRepComplete(ev: RepEvent): void {
    this.repsCompleted++
    this.completedReps = [...this.completedReps, ev]
    repCue()
    this.events.onRepComplete?.({ setIdx: this.setIdx, repNumber: this.repsCompleted, rep: ev })
    if (this.repsCompleted >= this.cur.repsTarget) {
      this.enterSetComplete('reps_complete')
    }
  }

  private onTPoseDetected(): void {
    if (this.phase === 'ACTIVE') {
      this.enterSetComplete('t_pose')
      this.emit()
    } else if (this.phase === 'PAUSED' && this.pauseReason === 'hr_breach' && this.hrOkForResume) {
      this.resumeFromPause()
      this.emit()
    }
  }

  private enterSetComplete(reason: SetEndReason): void {
    this.phase = 'SET_COMPLETE'
    this.repDetector = null
    const done = this.cur
    const completedAt = performance.now()
    this.events.onSetEnd?.({
      setIdx: this.setIdx,
      set: done,
      ts_ms: completedAt,
      reason,
      repsCompleted: this.repsCompleted,
    })

    if (done.isLastSet) {
      setTimeout(() => {
        if (this.destroyed) return
        this.phase = 'SESSION_COMPLETE'
        sessionCompleteCue()
        this.events.onSessionEnd?.({ ts_ms: performance.now() })
        this.emit()
      }, 2000)
      return
    }

    this.setIdx++

    if (done.isLastSetOfItem) {
      if (done.nextExerciseName) nextExerciseCue(done.nextExerciseName)
      setTimeout(() => {
        if (this.destroyed || this.phase !== 'SET_COMPLETE') return
        this.enterReady()
        this.emit()
      }, 5000)
    } else {
      restCue(done.restSeconds)
      this.restSecondsLeft = done.restSeconds
      this.phase = 'RESTING'
      this.startRestTimer()
    }
  }

  private startRestTimer(): void {
    this.clearRestTimer()
    this.restInterval = setInterval(() => {
      if (this.destroyed) { this.clearRestTimer(); return }
      this.restSecondsLeft = Math.max(0, this.restSecondsLeft - 1)
      if (this.restSecondsLeft === 0) {
        this.clearRestTimer()
        this.enterReady()
      }
      this.emit()
    }, 1000)
  }

  private clearRestTimer(): void {
    if (this.restInterval !== null) {
      clearInterval(this.restInterval)
      this.restInterval = null
    }
  }

  private enterPaused(reason: PauseReason): void {
    if (this.phase === 'PAUSED') return
    this.phase = 'PAUSED'
    this.pauseReason = reason
    this.repDetector = null
    this.clearRestTimer()
    pauseCue(reason)
    if (reason === 'hr_breach') resumeReadyCue()
    this.events.onPauseStart?.({ reason, ts_ms: performance.now() })
  }

  private resumeFromPause(): void {
    this.hrBreachStart = null
    this.hrRecoveryStart = null
    this.hrOkForResume = false
    this.outOfFrameStart = null
    this.multiPersonStart = null
    this.pauseReason = null
    this.tposeDetector.reset()
    this.events.onPauseEnd?.({ ts_ms: performance.now() })
    this.enterReady()
  }

  private emit(): void {
    if (this.destroyed) return
    this.onChange({
      phase: this.phase,
      set: this.cur,
      repsCompleted: this.repsCompleted,
      pauseReason: this.pauseReason,
      tposeProgress: this.tposeProgress,
      restSecondsLeft: this.restSecondsLeft,
      hrBpm: this.latestHr,
      countdownSecondsLeft: 0,
      completedReps: this.completedReps,
      fullyInFrame: this.fullyInFrame,
      oPoseProgress: this.oPoseProgress,
    })
  }
}
