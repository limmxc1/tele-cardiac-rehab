import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { RepDetector, type RepConfig, type RepEvent } from './repDetector'
import { TPoseDetector } from './tposeDetector'
import {
  countdownCue, repCue, restCue, nextExerciseCue,
  pauseCue, resumeReadyCue, sessionCompleteCue,
  type PauseReason,
} from '../audio/cues'

export type { PauseReason, RepEvent }

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
  countdownSecondsLeft: number
  completedReps: RepEvent[]
}

export class SessionStateMachine {
  private phase: SessionPhase = 'IDLE'
  private setIdx: number
  private repsCompleted = 0
  private completedReps: RepEvent[] = []
  private pauseReason: PauseReason | null = null
  private tposeProgress = 0
  private restSecondsLeft = 0
  private countdownEndMs = 0
  private destroyed = false

  private repDetector: RepDetector | null = null
  private tposeDetector: TPoseDetector

  private latestHr: number | null = null
  private hrBreachStart: number | null = null
  private hrRecoveryStart: number | null = null
  private hrOkForResume = false

  private personCount = 1
  private outOfFrameStart: number | null = null
  private multiPersonStart: number | null = null

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
  }

  private get cur(): SetEntry { return this.sets[this.setIdx] }

  start(): void {
    if (this.phase !== 'IDLE') return
    this.enterReady()
    this.emit()
  }

  feedPose(landmarks: NormalizedLandmark[], timestamp_ms: number): void {
    if (this.phase === 'ACTIVE') {
      this.repDetector?.feed(landmarks, this.latestHr, timestamp_ms)
      this.tposeProgress = this.tposeDetector.feed(landmarks, timestamp_ms)
    } else if (this.phase === 'PAUSED' && this.pauseReason === 'hr_breach') {
      this.tposeProgress = this.tposeDetector.feed(landmarks, timestamp_ms)
    }
    this.emit()
  }

  feedHR(hr_bpm: number, timestamp_ms: number): void {
    this.latestHr = hr_bpm

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
    this.countdownEndMs = performance.now() + 3000
    countdownCue()
    setTimeout(() => {
      if (this.destroyed || this.phase !== 'READY') return
      this.enterActive()
      this.emit()
    }, 3000)
  }

  private enterActive(): void {
    const wasReady = this.phase === 'READY'
    this.phase = 'ACTIVE'
    this.hrBreachStart = null
    this.outOfFrameStart = null
    this.multiPersonStart = null
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
    const countdownSecondsLeft =
      this.phase === 'READY'
        ? Math.max(0, Math.ceil((this.countdownEndMs - performance.now()) / 1000))
        : 0
    this.onChange({
      phase: this.phase,
      set: this.cur,
      repsCompleted: this.repsCompleted,
      pauseReason: this.pauseReason,
      tposeProgress: this.tposeProgress,
      restSecondsLeft: this.restSecondsLeft,
      hrBpm: this.latestHr,
      countdownSecondsLeft,
      completedReps: this.completedReps,
    })
  }
}
