'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/lib/store/auth'
import {
  markMissedAction,
  getMonthPrescriptionsAction,
  getPrescriptionItemsAction,
  type MonthPrescription,
  type PrescriptionItemDetail,
} from '@/app/actions/prescriptions'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const STATUS_DOT: Record<string, string> = {
  scheduled: 'bg-blue-500',
  in_progress: 'bg-yellow-400',
  completed: 'bg-green-500',
  missed: 'bg-red-400',
}

const STATUS_PILL: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  missed: 'bg-red-100 text-red-700',
}

function buildMonthGrid(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1)
  const totalDays = new Date(year, month + 1, 0).getDate()
  // Monday-first: JS getDay() is 0=Sun…6=Sat, so (day+6)%7 gives 0=Mon…6=Sun
  const startOffset = (firstDay.getDay() + 6) % 7
  const cells: (number | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

type TodoCard = {
  prescriptionId: string
  itemId: string
  setNum: number
  totalSets: number
  exerciseName: string
  repsTarget: number
  done: boolean
}

export default function CalendarClient() {
  const user = useAuthStore((s) => s.user)
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })

  const [year, setYear] = useState(() => parseInt(todayStr.slice(0, 4)))
  const [month, setMonth] = useState(() => parseInt(todayStr.slice(5, 7)) - 1)
  const [prescriptions, setPrescriptions] = useState<MonthPrescription[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedPresc, setSelectedPresc] = useState<MonthPrescription | null>(null)
  const [items, setItems] = useState<PrescriptionItemDetail[]>([])
  const [loadingItems, setLoadingItems] = useState(false)

  const missedMarkedRef = useRef(false)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    // Show the loading state and reset day-detail panel on month change.
    // This is a legitimate fetch-on-dependency-change effect; the lint rule
    // is overly strict for this pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setSelectedDate(null)
    setItems([])
    ;(async () => {
      if (!missedMarkedRef.current) {
        await markMissedAction(user.id)
        missedMarkedRef.current = true
      }
      const data = await getMonthPrescriptionsAction(user.id, year, month)
      if (cancelled) return
      setPrescriptions(data)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [user?.id, year, month])

  const prescMap = Object.fromEntries(prescriptions.map((p) => [p.scheduled_date, p]))

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11) }
    else setMonth((m) => m - 1)
  }

  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0) }
    else setMonth((m) => m + 1)
  }

  const handleDayClick = async (dayNum: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
    const presc = prescMap[dateStr] ?? null
    setSelectedDate(dateStr)
    setSelectedPresc(presc)
    setItems([])
    if (!presc) return
    setLoadingItems(true)
    const data = await getPrescriptionItemsAction(presc.id)
    setItems(data)
    setLoadingItems(false)
  }

  const todoCards: TodoCard[] = items.flatMap((item) =>
    Array.from({ length: item.num_sets }, (_, i) => ({
      prescriptionId: selectedPresc?.id ?? '',
      itemId: item.id,
      setNum: i + 1,
      totalSets: item.num_sets,
      exerciseName: item.exercise_name,
      repsTarget: item.reps_per_set,
      done: selectedPresc?.status === 'completed',
    }))
  )

  const cells = buildMonthGrid(year, month)

  if (!user) {
    return <p className="text-center text-slate-400 text-sm mt-8">Loading...</p>
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={prevMonth}
          className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-600 text-xl"
          aria-label="Previous month"
        >
          ‹
        </button>
        <h2 className="text-lg font-semibold text-slate-800">
          {MONTH_NAMES[month]} {year}
        </h2>
        <button
          onClick={nextMonth}
          className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-600 text-xl"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {/* Calendar grid */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {DAY_HEADERS.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-slate-400">
              {d}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400 text-sm">Loading...</div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              if (day === null) {
                return (
                  <div
                    key={`empty-${i}`}
                    className="border-r border-b border-slate-100 h-14"
                  />
                )
              }
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const presc = prescMap[dateStr]
              const isToday = dateStr === todayStr
              const isSelected = dateStr === selectedDate

              return (
                <button
                  key={dateStr}
                  onClick={() => handleDayClick(day)}
                  className={`border-r border-b border-slate-100 h-14 flex flex-col items-center justify-start pt-1.5 gap-1 transition-colors
                    ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                >
                  <span
                    className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full leading-none
                      ${isToday ? 'bg-blue-600 text-white' : 'text-slate-700'}`}
                  >
                    {day}
                  </span>
                  {presc && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[presc.status] ?? 'bg-slate-400'}`}
                    />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Status legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        {Object.entries(STATUS_DOT).map(([status, color]) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
            <span className="capitalize">{status.replace('_', ' ')}</span>
          </span>
        ))}
      </div>

      {/* Day detail panel */}
      {selectedDate && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 text-sm">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-SG', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </h3>
            {selectedPresc && (
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_PILL[selectedPresc.status] ?? 'bg-slate-100 text-slate-600'}`}
              >
                {selectedPresc.status.replace('_', ' ')}
              </span>
            )}
          </div>

          {!selectedPresc ? (
            <p className="px-4 py-8 text-center text-slate-400 text-sm">
              No session scheduled for this day.
            </p>
          ) : loadingItems ? (
            <p className="px-4 py-8 text-center text-slate-400 text-sm">Loading exercises...</p>
          ) : todoCards.length === 0 ? (
            <p className="px-4 py-8 text-center text-slate-400 text-sm">No exercises found.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {todoCards.map((card) => (
                <Link
                  key={`${card.itemId}-${card.setNum}`}
                  href={`/patient/session/${card.prescriptionId}/run?item=${card.itemId}&set=${card.setNum}`}
                  className="flex items-center gap-4 px-4 py-4 hover:bg-slate-50 transition-colors active:bg-slate-100"
                >
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0
                      ${card.done ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300'}`}
                  >
                    {card.done && <span className="text-xs font-bold">✓</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm truncate">
                      {card.exerciseName}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Set {card.setNum} of {card.totalSets} · {card.repsTarget} reps
                    </p>
                  </div>
                  <span className="text-slate-300 text-lg flex-shrink-0">›</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
