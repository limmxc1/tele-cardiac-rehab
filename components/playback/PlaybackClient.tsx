'use client'

import { useEffect, useRef, useState } from 'react'
import StickmanCanvas from './StickmanCanvas'
import SyncedScrubber from './SyncedScrubber'
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

  const exerciseLabel =
    bundle.sets.length === 0
      ? null
      : bundle.sets.map((s) => `${s.exerciseName} · Set ${s.setNumber}`).join(' / ')

  return (
    <div className="space-y-4">
      <SyncedScrubber
        currentTMs={currentTMs}
        durationMs={bundle.durationMs}
        isPlaying={isPlaying}
        speed={speed}
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
            <StickmanCanvas
              poses={bundle.poses}
              trackedJoints={bundle.trackedJoints}
              currentTMs={currentTMs}
            />
          </div>
          <div className="flex items-center justify-between border-t border-slate-700 px-4 py-2 text-sm text-slate-200">
            <div className="truncate">
              {exerciseLabel ?? <span className="text-slate-400">Recording</span>}
            </div>
            <div className="text-xs text-slate-400 capitalize">
              {bundle.trackedJoints.length === 0
                ? 'no joints tracked'
                : bundle.trackedJoints.map((t) => `${t.side} ${t.joint}`).join(', ')}
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
    </div>
  )
}
