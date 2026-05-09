// Helpers shared by the HR-monitoring patient page and clinician dashboard.
// Ported from cardiac-vsm-app/static/js/hr_supabase.js.

export type ZoneKind = 'below' | 'in' | 'above'
export type HrSample = [number, number | null] // [t_offset_sec, hr_bpm | null]

export const HR_MACHINES: Array<[string, string]> = [
  ['treadmill', 'Treadmill'],
  ['elliptical', 'Elliptical'],
  ['cycling', 'Cycling'],
  ['rowing', 'Rowing'],
  ['arm_cycle', 'Arm cycle'],
]

export const HR_PRECAUTIONS: Array<[string, string]> = [
  ['check_hypocount', 'Check hypocount (low blood sugar)'],
  ['low_bp', 'Watch for low blood pressure'],
  ['chest_pain_hx', 'Chest pain history'],
  ['dizziness', 'Watch for dizziness'],
  ['balance', 'Balance issues'],
]

export const HR_FALL_RISK_LEVELS: Array<[string, string]> = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
]

export const HR_DASHBOARD_MAX_PATIENTS = 8
export const HR_SESSION_MAX_HOURS = 2

export function classifyZone(
  hr: number | null | undefined,
  lower: number,
  upper: number,
): ZoneKind | null {
  if (hr == null) return null
  if (hr < lower) return 'below'
  if (hr > upper) return 'above'
  return 'in'
}

export function fmtClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// The Polar H10 advertises a name like "Polar H10 1234ABCD" — that's the
// patient-device link key used by both the patient page and the clinician
// patient-profile registration flow.
export function deviceIdFromBLE(bleDevice: BluetoothDevice | null | undefined): string {
  return bleDevice && bleDevice.name ? bleDevice.name.trim() : ''
}

// ---------- Persistent buffer of unflushed samples ----------
// IndexedDB store keyed by workout_id, value is the pending samples array.
// Survives transient network failures and brief tab freezes.
const IDB_NAME = 'hr_monitor'
const IDB_STORE = 'pending_samples'
const IDB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbTx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => T | Promise<T>,
): Promise<T | null> {
  let db: IDBDatabase
  try {
    db = await openDb()
  } catch {
    return null
  }
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode)
    const store = tx.objectStore(IDB_STORE)
    let resultPromise: T | Promise<T>
    try {
      resultPromise = fn(store)
    } catch (err) {
      reject(err as Error)
      return
    }
    tx.oncomplete = () => Promise.resolve(resultPromise).then(resolve)
    tx.onerror = () => reject(tx.error as Error)
    tx.onabort = () => reject(tx.error as Error)
  })
}

export async function idbPutPending(workoutId: string, samples: HrSample[]): Promise<void> {
  try {
    await idbTx('readwrite', (s) => {
      s.put(samples, workoutId)
    })
  } catch {
    // IDB unavailable / over quota — non-fatal
  }
}

export async function idbGetPending(workoutId: string): Promise<HrSample[]> {
  try {
    const result = await idbTx<HrSample[]>('readonly', (s) =>
      new Promise<HrSample[]>((res, rej) => {
        const r = s.get(workoutId)
        r.onsuccess = () => res((r.result as HrSample[]) || [])
        r.onerror = () => rej(r.error)
      }),
    )
    return result || []
  } catch {
    return []
  }
}

export async function idbClearPending(workoutId: string): Promise<void> {
  try {
    await idbTx('readwrite', (s) => {
      s.delete(workoutId)
    })
  } catch {
    // non-fatal
  }
}

// Draw a small sparkline of recent HR samples on a canvas.
// Target zone is shaded; null samples (no signal) are skipped.
export function drawSpark(
  canvas: HTMLCanvasElement,
  samples: HrSample[],
  lower: number,
  upper: number,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)
  if (!samples || samples.length < 2) return
  const ys = samples.map((s) => s[1]).filter((v): v is number => v != null)
  if (ys.length < 2) return
  const minY = Math.min(lower - 10, ...ys)
  const maxY = Math.max(upper + 10, ...ys)
  const range = Math.max(1, maxY - minY)
  const xs = samples.map((s) => s[0])
  const minX = xs[0]
  const maxX = xs[xs.length - 1]
  const xrange = Math.max(1, maxX - minX)

  // Target zone band
  const yLower = H - ((lower - minY) / range) * H
  const yUpper = H - ((upper - minY) / range) * H
  ctx.fillStyle = 'rgba(34,197,94,0.12)'
  ctx.fillRect(0, yUpper, W, yLower - yUpper)

  ctx.strokeStyle = '#0ea5e9'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  let started = false
  for (const [t, hr] of samples) {
    if (hr == null) continue
    const x = ((t - minX) / xrange) * W
    const y = H - ((hr - minY) / range) * H
    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
}
