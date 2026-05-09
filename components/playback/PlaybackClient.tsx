'use client'

import { useEffect, useRef, useState } from 'react'
import StickmanCanvas from './StickmanCanvas'
import SyncedScrubber from './SyncedScrubber'
import RepTable from './RepTable'
import NotesEditor from './NotesEditor'
import MetricsTimeline from './MetricsTimeline'
import type { PlaybackBundle } from '@/lib/playback/loader'

interface Props {
  bundle: PlaybackBundle
}

export default function PlaybackClient({ bundle }: Props) {
  const [currentTMs, setCurrentTMs] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isPlaying) return
    let cancelled = false

    const tick = (now: number) => {
      if (cancelled) return
      const last = lastTickRef.current ?? now
      const dtMs = (now - last) * speed
      lastTickRef.current = now
      setCurrentTMs((prev) => {
        const next = prev + dtMs
        if (next >= bundle.durationMs) {
          setIsPlaying(false)
          return bundle.durationMs
        }
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }

    lastTickRef.current = null
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [isPlaying, speed, bundle.durationMs])

  const togglePlay = () => {
    setIsPlaying((p) => {
      if (!p && currentTMs >= bundle.durationMs) setCurrentTMs(0)
      return !p
    })
  }

  const seek = (tMs: number) => {
    setCurrentTMs(Math.max(0, Math.min(bundle.durationMs, tMs)))
  }

  const liveCounts = (() => {
    let repsDone = 0
    let activeExercise: string | null = null
    let activeSet: number | null = null
    for (const r of bundle.reps) {
      if (r.startedTMs <= currentTMs) {
        repsDone++
        activeExercise = r.exerciseName
        activeSet = r.setNumber
      } else break
    }
    return { repsDone, activeExercise, activeSet }
  })()

  return (
    <div className="space-y-4">
      <SyncedScrubber
        currentTMs={currentTMs}
        durationMs={bundle.durationMs}
        isPlaying={isPlaying}
        speed={speed}
        pauses={bundle.pauses}
        onSeek={seek}
        onTogglePlay={togglePlay}
        onSpeedChange={setSpeed}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-900 shadow-sm">
          <div className="flex items-center justify-between px-4 py-2 text-xs text-slate-300">
            <span>Stickman replay</span>
            <span className="text-slate-500">Anatomical view</span>
          </div>
          <div className="aspect-[4/3] w-full">
            <StickmanCanvas poses={bundle.poses} currentTMs={currentTMs} />
          </div>
          <div className="flex items-center justify-between border-t border-slate-700 px-4 py-2 text-sm text-slate-200">
            <div>
              {liveCounts.activeExercise ? (
                <>
                  <span className="font-medium">{liveCounts.activeExercise}</span>
                  <span className="text-slate-400"> · Set {liveCounts.activeSet}</span>
                </>
              ) : (
                <span className="text-slate-400">Awaiting reps…</span>
              )}
            </div>
            <div className="tabular-nums">
              Reps: <span className="font-semibold">{liveCounts.repsDone}</span>
              <span className="text-slate-500"> / {bundle.reps.length}</span>
            </div>
          </div>
        </div>

        <MetricsTimeline
          bundle={bundle}
          currentTMs={currentTMs}
          durationMs={bundle.durationMs}
        />
      </div>

      <NotesEditor
        sessionId={bundle.sessionId}
        patientId={bundle.patientId}
        initial={bundle.clinicianNotes ?? ''}
      />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500 uppercase tracking-wide">
          Per-rep detail
        </h2>
        <RepTable reps={bundle.reps} currentTMs={currentTMs} onSeek={seek} />
      </section>
    </div>
  )
}
