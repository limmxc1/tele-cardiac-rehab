import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { OPoseDetector } from './oposeDetector'
import { TPoseDetector } from './tposeDetector'
import { startReadyCue, sessionCompleteCue } from '../audio/cues'

/**
 * Visibility threshold (0..1) every one of the 33 landmarks must clear before
 * we accept the start gesture. Recording itself does NOT pause if the body
 * temporarily exits the frame — gaps are simply gaps in the timeline.
 */
const VISIBILITY_THRESHOLD = 0.5

/** True iff every landmark has visibility ≥ VISIBILITY_THRESHOLD. */
export function isFullyInFrame(landmarks: NormalizedLandmark[]): boolean {
  if (landmarks.length < 33) return false
  for (let i = 0; i < 33; i++) {
    const v = landmarks[i]?.visibility
    if (v === undefined || v < VISIBILITY_THRESHOLD) return false
  }
  return true
}

export type SessionPhase = 'IDLE' | 'READY' | 'RECORDING' | 'COMPLETE'

/** A "joint of interest" the clinician asked to track on this exercise. */
export interface TrackedJoint {
  joint: 'knee' | 'hip' | 'shoulder' | 'elbow' | 'ankle'
  side: 'left' | 'right'
}

export interface ExerciseEntry {
  prescriptionItemId: string
  exerciseId: string
  exerciseName: string
  trackedJoints: TrackedJoint[]
  /** Free-text guidance e.g. "3 sets × 10 reps · rest 30 s". Display-only. */
  guidance: string
  referenceGifUrl: string | null
  instructionsText: string | null
  /** Position of this exercise within the prescription (0-based). */
  itemIndex: number
}

export interface SessionEvents {
  onRecordingStart?: (e: { ts_ms: number }) => void
  onRecordingEnd?: (e: { ts_ms: number; reason: 't_pose' | 'abandoned' }) => void
  onSessionEnd?: (e: { ts_ms: number }) => void
}

export interface SessionSnapshot {
  phase: SessionPhase
  exercise: ExerciseEntry
  /** True while in READY iff every landmark in the latest pose is visible. */
  fullyInFrame: boolean
  /** Progress 0..1 on the O-pose hold. Resets to 0 if the pose is broken. */
  oposeProgress: number
  /** Progress 0..1 on the T-pose hold during RECORDING. */
  tposeProgress: number
  hrBpm: number | null
}

/**
 * Single-recording session state machine.
 *
 *   IDLE  → start()  → READY
 *   READY (all 33 landmarks visible AND O-pose held 1.5 s) → RECORDING
 *   RECORDING (T-pose held 1.5 s) → COMPLETE
 *   RECORDING + endRecordingEarly() → COMPLETE
 *
 * No automatic pauses. If the body leaves the frame mid-recording the
 * timeline simply has a gap.
 */
export class SessionStateMachine {
  private phase: SessionPhase = 'IDLE'
  private destroyed = false
  private fullyInFrame = false
  private oposeProgress = 0
  private tposeProgress = 0
  private latestHr: number | null = null

  private readonly oposeDetector: OPoseDetector
  private readonly tposeDetector: TPoseDetector

  constructor(
    private readonly exercise: ExerciseEntry,
    private readonly onChange: (snap: SessionSnapshot) => void,
    private readonly events: SessionEvents = {},
  ) {
    this.oposeDetector = new OPoseDetector(() => this.onOPoseDetected())
    this.tposeDetector = new TPoseDetector(() => this.onTPoseDetected())
  }

  start(): void {
    if (this.phase !== 'IDLE') return
    this.phase = 'READY'
    this.oposeDetector.reset()
    this.tposeDetector.reset()
    this.oposeProgress = 0
    this.tposeProgress = 0
    startReadyCue()
    this.emit()
  }

  feedPose(landmarks: NormalizedLandmark[], timestamp_ms: number): void {
    this.fullyInFrame = isFullyInFrame(landmarks)

    if (this.phase === 'READY') {
      // Only feed the O-pose detector once the whole body is visible.
      // A wrist-only glimpse shouldn't accrue progress.
      if (this.fullyInFrame) {
        this.oposeProgress = this.oposeDetector.feed(landmarks, timestamp_ms)
      } else {
        this.oposeDetector.reset()
        this.oposeProgress = 0
      }
    } else if (this.phase === 'RECORDING') {
      this.tposeProgress = this.tposeDetector.feed(landmarks, timestamp_ms)
    }

    this.emit()
  }

  feedHR(hr_bpm: number): void {
    this.latestHr = hr_bpm
    this.emit()
  }

  /** End an in-progress recording immediately (e.g. user tapped "End"). */
  endRecordingEarly(): void {
    if (this.phase !== 'RECORDING') return
    this.endRecording('abandoned')
  }

  destroy(): void {
    this.destroyed = true
  }

  private onOPoseDetected(): void {
    if (this.phase !== 'READY') return
    this.phase = 'RECORDING'
    this.oposeProgress = 0
    this.tposeProgress = 0
    this.tposeDetector.reset()
    this.events.onRecordingStart?.({ ts_ms: performance.now() })
    this.emit()
  }

  private onTPoseDetected(): void {
    if (this.phase !== 'RECORDING') return
    this.endRecording('t_pose')
  }

  private endRecording(reason: 't_pose' | 'abandoned'): void {
    if (this.phase === 'COMPLETE') return
    this.phase = 'COMPLETE'
    this.tposeProgress = 0
    const ts = performance.now()
    this.events.onRecordingEnd?.({ ts_ms: ts, reason })
    sessionCompleteCue()
    this.events.onSessionEnd?.({ ts_ms: ts })
    this.emit()
  }

  private emit(): void {
    if (this.destroyed) return
    this.onChange({
      phase: this.phase,
      exercise: this.exercise,
      fullyInFrame: this.fullyInFrame,
      oposeProgress: this.oposeProgress,
      tposeProgress: this.tposeProgress,
      hrBpm: this.latestHr,
    })
  }
}
