'use client'

import { useState, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { PolarH10, type H10Status, type HRSample } from '@/lib/hr/polarH10'

// CameraStickman uses camera + Web Worker — SSR must be disabled
const CameraStickman = dynamic(() => import('@/components/pose/CameraStickman'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-black flex items-center justify-center">
      <p className="text-slate-400 text-sm">Starting camera…</p>
    </div>
  ),
})

const STATUS_LABEL: Record<H10Status, string> = {
  idle: 'Not connected',
  connected: 'Connected',
  disconnected: 'Disconnected',
  reconnecting: 'Reconnecting…',
}

const STATUS_COLOR: Record<H10Status, string> = {
  idle: 'text-slate-400',
  connected: 'text-green-400',
  disconnected: 'text-red-400',
  reconnecting: 'text-yellow-400',
}

export default function HardwareTestPage() {
  const [hrSamples, setHrSamples] = useState<HRSample[]>([])
  const [h10Status, setH10Status] = useState<H10Status>('idle')
  const [personCount, setPersonCount] = useState(0)
  const [workerStatus, setWorkerStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [h10Error, setH10Error] = useState<string | null>(null)
  const h10Ref = useRef<PolarH10 | null>(null)

  const latestHR = hrSamples.at(-1)?.hr_bpm ?? null

  const handleConnect = useCallback(async () => {
    setH10Error(null)
    const h10 = new PolarH10()
    h10Ref.current = h10
    h10.onStatus(setH10Status)
    h10.onHR((sample) => setHrSamples(prev => [...prev.slice(-299), sample]))
    try {
      await h10.connect()
    } catch (err) {
      setH10Error(String(err))
      h10Ref.current = null
    }
  }, [])

  const handleDisconnect = useCallback(() => {
    h10Ref.current?.disconnect()
    h10Ref.current = null
    setHrSamples([])
  }, [])

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <h1 className="text-base font-semibold">Hardware Test</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Pose:</span>
          {workerStatus === 'loading' && (
            <span className="text-xs text-yellow-400">Loading model…</span>
          )}
          {workerStatus === 'ready' && (
            <span className="text-xs text-green-400">Ready</span>
          )}
          {workerStatus === 'error' && (
            <span className="text-xs text-red-400">Error</span>
          )}
        </div>
      </div>

      {/* Camera + stickman — takes most of the screen */}
      <div className="relative flex-1 min-h-0">
        <CameraStickman
          className="w-full h-full"
          onPersonCount={setPersonCount}
          onWorkerStatus={setWorkerStatus}
        />

        {/* Person count badge */}
        <div className="absolute top-3 left-3 bg-black/60 rounded-lg px-3 py-1.5 flex items-center gap-2">
          <span className="text-xs text-slate-300">People in frame:</span>
          <span
            className={`text-sm font-bold ${
              personCount === 0 ? 'text-red-400' :
              personCount === 1 ? 'text-green-400' : 'text-orange-400'
            }`}
          >
            {personCount}
          </span>
        </div>
      </div>

      {/* HR + H10 controls panel */}
      <div className="flex-shrink-0 p-4 border-t border-slate-700 space-y-4">
        {/* HR display */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Heart Rate</p>
            <p className="text-4xl font-bold tabular-nums mt-0.5">
              {latestHR !== null ? (
                <>{latestHR} <span className="text-base font-normal text-slate-400">bpm</span></>
              ) : (
                <span className="text-slate-600">—</span>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400 uppercase tracking-wide">H10 Status</p>
            <p className={`text-sm font-medium mt-0.5 ${STATUS_COLOR[h10Status]}`}>
              {STATUS_LABEL[h10Status]}
            </p>
          </div>
        </div>

        {/* HR mini sparkline (last 30 samples) */}
        {hrSamples.length > 1 && (
          <div className="h-10">
            <svg viewBox={`0 0 ${Math.min(hrSamples.length, 30)} 40`} className="w-full h-full" preserveAspectRatio="none">
              {(() => {
                const recent = hrSamples.slice(-30)
                const minHR = Math.min(...recent.map(s => s.hr_bpm))
                const maxHR = Math.max(...recent.map(s => s.hr_bpm))
                const range = maxHR - minHR || 1
                const points = recent.map((s, i) => {
                  const x = i
                  const y = 40 - ((s.hr_bpm - minHR) / range) * 36 - 2
                  return `${x},${y}`
                }).join(' ')
                return <polyline points={points} fill="none" stroke="#22c55e" strokeWidth="1.5" />
              })()}
            </svg>
          </div>
        )}

        {/* Error message */}
        {h10Error && (
          <p className="text-xs text-red-400 bg-red-900/20 rounded p-2">{h10Error}</p>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleConnect}
            disabled={h10Status === 'connected' || h10Status === 'reconnecting'}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-500 active:bg-blue-700 transition-colors"
          >
            Connect H10
          </button>
          <button
            onClick={handleDisconnect}
            disabled={h10Status === 'idle'}
            className="flex-1 rounded-lg bg-slate-700 px-4 py-3 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-600 active:bg-slate-800 transition-colors"
          >
            Disconnect
          </button>
        </div>

        <p className="text-xs text-slate-500 text-center">
          Chrome on Android only — Web Bluetooth requires user gesture
        </p>
      </div>
    </div>
  )
}
