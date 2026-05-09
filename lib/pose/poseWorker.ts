// Web Worker: hosts MediaPipe PoseLandmarker so pose inference runs off the main thread.
// Communicates via postMessage — see InMsg/OutMsg types below.
// Uses CPU delegate (GPU delegate requires WebGL in the main thread, not available in workers).

import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

// Minimal interface for the worker's own postMessage + addEventListener.
// (DedicatedWorkerGlobalScope lives in lib.webworker, not included in this tsconfig.)
interface WorkerCtx {
  addEventListener(type: 'message', handler: (e: MessageEvent) => void): void
  postMessage(data: unknown): void
}
const ctx = self as unknown as WorkerCtx

export type WorkerInMsg =
  | { type: 'INIT'; wasmUrl: string; modelUrl: string }
  | { type: 'FRAME'; bitmap: ImageBitmap; timestamp_ms: number }

export type WorkerOutMsg =
  | { type: 'READY' }
  | { type: 'RESULT'; poses: NormalizedLandmark[][]; timestamp_ms: number }
  | { type: 'ERROR'; message: string }

let landmarker: PoseLandmarker | null = null

ctx.addEventListener('message', async (e: MessageEvent<WorkerInMsg>) => {
  const msg = e.data

  if (msg.type === 'INIT') {
    try {
      const vision = await FilesetResolver.forVisionTasks(msg.wasmUrl)
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: msg.modelUrl,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numPoses: 2,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
      ctx.postMessage({ type: 'READY' } satisfies WorkerOutMsg)
    } catch (err) {
      ctx.postMessage({ type: 'ERROR', message: String(err) } satisfies WorkerOutMsg)
    }
    return
  }

  if (msg.type === 'FRAME') {
    if (!landmarker) {
      msg.bitmap.close()
      return
    }
    try {
      const result = landmarker.detectForVideo(msg.bitmap, msg.timestamp_ms)
      msg.bitmap.close()
      ctx.postMessage({
        type: 'RESULT',
        poses: result.landmarks,
        timestamp_ms: msg.timestamp_ms,
      } satisfies WorkerOutMsg)
    } catch {
      msg.bitmap.close()
    }
  }
})
