'use client'

import { useEffect, useState } from 'react'
import { flushPending } from '@/lib/sync/uploader'

type FlushState =
  | { kind: 'idle' }
  | { kind: 'flushing'; count: number }
  | { kind: 'done'; uploaded: number; failed: number }

/**
 * Mount on patient screens so any locally-buffered completed sessions are
 * uploaded as soon as the patient regains connectivity / re-opens the app.
 * Runs once per page mount.
 */
export default function PendingUploadFlusher() {
  const [state, setState] = useState<FlushState>({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Defer briefly so it doesn't block first paint.
      await new Promise((r) => setTimeout(r, 250))
      if (cancelled) return

      const { getUnflushedSessions } = await import('@/lib/buffer/sessionBuffer')
      const pending = await getUnflushedSessions()
      if (cancelled || pending.length === 0) return

      setState({ kind: 'flushing', count: pending.length })
      const results = await flushPending()
      if (cancelled) return
      const uploaded = results.filter((r) => r.ok).length
      const failed = results.length - uploaded
      setState({ kind: 'done', uploaded, failed })
      if (failed === 0) setTimeout(() => setState({ kind: 'idle' }), 4000)
    })()
    return () => { cancelled = true }
  }, [])

  if (state.kind === 'idle') return null

  return (
    <div className="fixed bottom-4 right-4 z-30 max-w-xs rounded-xl bg-slate-900/90 backdrop-blur px-4 py-3 text-sm text-white shadow-lg">
      {state.kind === 'flushing' && (
        <p>Uploading {state.count} pending session{state.count > 1 ? 's' : ''}…</p>
      )}
      {state.kind === 'done' && state.failed === 0 && (
        <p className="text-green-300">Uploaded {state.uploaded} pending session{state.uploaded > 1 ? 's' : ''}.</p>
      )}
      {state.kind === 'done' && state.failed > 0 && (
        <p className="text-amber-300">
          {state.uploaded > 0 && `Uploaded ${state.uploaded}. `}
          {state.failed} session{state.failed > 1 ? 's' : ''} still pending — will retry.
        </p>
      )}
    </div>
  )
}
