import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { getJointAngle } from './angles'

type RepState = 'AT_START' | 'TRAVELING_TO_END' | 'AT_END' | 'TRAVELING_TO_START'

export interface RepEvent {
  startedAt: number
  completedAt: number
  peakAngleDegrees: number
  romDegrees: number
  hrBpmAtPeak: number | null
}

export interface RepConfig {
  primaryJoint: string
  primarySide: 'left' | 'right' | 'both'
  startAngleMin: number
  startAngleMax: number
  endAngleMin: number
  endAngleMax: number
  direction: 'flexion_first' | 'extension_first'
  secondaryJoint?: string
  secondaryStartMin?: number
  secondaryStartMax?: number
  secondaryEndMin?: number
  secondaryEndMax?: number
}

export class RepDetector {
  private state: RepState = 'AT_START'
  private repStartTs = 0
  private peakAngle: number | null = null
  private peakHr: number | null = null

  constructor(
    private readonly config: RepConfig,
    private readonly onRep: (event: RepEvent) => void,
  ) {}

  feed(landmarks: NormalizedLandmark[], currentHr: number | null, timestamp_ms: number): void {
    const primary = getJointAngle(landmarks, this.config.primaryJoint, this.config.primarySide)
    if (primary === null) return

    const inStart = primary >= this.config.startAngleMin && primary <= this.config.startAngleMax
    const inEnd   = primary >= this.config.endAngleMin   && primary <= this.config.endAngleMax
    const extending = this.config.direction === 'extension_first'

    switch (this.state) {
      case 'AT_START':
        if (!inStart) {
          this.state = 'TRAVELING_TO_END'
          this.repStartTs = timestamp_ms
          this.peakAngle = primary
          this.peakHr = currentHr
        }
        break

      case 'TRAVELING_TO_END':
        if (
          this.peakAngle === null ||
          (extending ? primary > this.peakAngle : primary < this.peakAngle)
        ) {
          this.peakAngle = primary
          this.peakHr = currentHr
        }
        if (inEnd) this.state = 'AT_END'
        break

      case 'AT_END':
        if (!inEnd) this.state = 'TRAVELING_TO_START'
        break

      case 'TRAVELING_TO_START':
        if (inStart) {
          const peak = this.peakAngle ?? primary
          this.onRep({
            startedAt: this.repStartTs,
            completedAt: timestamp_ms,
            peakAngleDegrees: peak,
            romDegrees: Math.abs(
              peak - (extending ? this.config.startAngleMin : this.config.startAngleMax),
            ),
            hrBpmAtPeak: this.peakHr,
          })
          this.state = 'AT_START'
          this.peakAngle = null
          this.peakHr = null
        }
        break
    }
  }

  reset(): void {
    this.state = 'AT_START'
    this.peakAngle = null
    this.peakHr = null
  }
}
