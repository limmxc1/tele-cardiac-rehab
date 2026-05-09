'use client'

import { useMemo } from 'react'
import type { PlaybackPause } from '@/lib/playback/loader'

const PAUSE_REASON_LABEL: Record<string, string> = {
  hr_breach: 'HR breach',
  h10_disconnect: 'H10 disconnect',
  out_of_frame: 'Out of frame',
  multiple_people: 'Multiple people',
}

function fmtMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface Props {
  currentTMs: number
  durationMs: number
  isPlaying: boolean
  speed: number
  pauses: PlaybackPause[]
  onSeek: (tMs: number) => void
  onTogglePlay: () => void
  onSpeedChange: (s: number) => void
}

export default function SyncedScrubber({
  currentTMs,
  durationMs,
  isPlaying,
  speed,
  pauses,
  onSeek,
  onTogglePlay,
  onSpeedChange,
}: Props) {
  const markers = useMemo(() => {
    if (durationMs <= 0) return []
    return pauses
      .filter((p) => p.pausedTMs >= 0)
      .map((p) => {
        const start = (p.pausedTMs / durationMs) * 100
        const end = ((p.resumedTMs ?? p.pausedTMs + 1500) / durationMs) * 100
        return {
          id: p.id,
          left: Math.max(0, Math.min(100, start)),
          width: Math.max(0.5, Math.min(100, end) - Math.max(0, start)),
          label: `${PAUSE_REASON_LABEL[p.reason] ?? p.reason} @ ${fmtMs(p.pausedTMs)}`,
        }
      })
  }, [pauses, durationMs])

  const pct = durationMs > 0 ? (currentTMs / durationMs) * 100 : 0

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onTogglePlay}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow hover:bg-blue-700"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2" y="2" width="3" height="10" rx="1" />
              <rect x="9" y="2" width="3" height="10" rx="1" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M3 2l9 5-9 5V2z" />
            </svg>
          )}
        </button>
        <div className="flex-1 text-sm tabular-nums text-slate-600">
          {fmtMs(currentTMs)} <span className="text-slate-300">/</span> {fmtMs(durationMs)}
        </div>
        <div className="flex items-center gap-1 text-xs">
          {[0.5, 1, 2].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeedChange(s)}
              className={`rounded-md px-2 py-1 font-medium ${
                speed === s
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-8">
        {/* Pause markers (rendered behind the slider track) */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2">
          {markers.map((m) => (
            <div
              key={m.id}
              className="absolute h-full rounded-sm bg-slate-300/80 hover:bg-slate-400"
              style={{ left: `${m.left}%`, width: `${m.width}%` }}
              title={m.label}
            />
          ))}
        </div>
        {/* Filled progress */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-sm bg-slate-100">
          <div
            className="h-full rounded-sm bg-blue-500/40"
            style={{ width: `${pct}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(1, durationMs)}
          step={50}
          value={Math.min(currentTMs, durationMs)}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="playback-scrubber relative z-10 h-8 w-full cursor-pointer appearance-none bg-transparent"
        />
      </div>
      {markers.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          Gray bars = pauses ({markers.length}). Hover for reason.
        </p>
      )}
      <style>{`
        .playback-scrubber::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 9999px;
          background: #2563eb;
          border: 2px solid #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          cursor: pointer;
        }
        .playback-scrubber::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 9999px;
          background: #2563eb;
          border: 2px solid #fff;
          cursor: pointer;
        }
        .playback-scrubber::-webkit-slider-runnable-track {
          background: transparent;
          height: 8px;
        }
        .playback-scrubber::-moz-range-track {
          background: transparent;
          height: 8px;
        }
      `}</style>
    </div>
  )
}
