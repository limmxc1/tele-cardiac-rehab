'use client'

import { useState } from 'react'

const DISMISS_KEY = 'shf_browser_warning_dismissed'

type Issue = 'bluetooth' | 'camera' | 'os'

function detectIssues(): Issue[] {
  const issues: Issue[] = []
  if (typeof navigator === 'undefined') return issues
  if (!('bluetooth' in navigator)) issues.push('bluetooth')
  if (!navigator.mediaDevices?.getUserMedia) issues.push('camera')
  // Lightweight UA sniff. iOS Safari and desktop Safari fail Bluetooth check
  // anyway; this catches the Chrome-on-iOS case where Bluetooth pretends to
  // exist but doesn't actually work.
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window)
  if (isIOS) issues.push('os')
  return issues
}

export default function BrowserSupportBanner() {
  // Lazy initializers run on the client; on the server they short-circuit and
  // we render nothing (matching the eventual SSR HTML).
  const [issues] = useState<Issue[]>(() =>
    typeof window === 'undefined' ? [] : detectIssues(),
  )
  const [dismissed, setDismissed] = useState<boolean>(() =>
    typeof window === 'undefined' ? true : localStorage.getItem(DISMISS_KEY) === '1',
  )

  if (dismissed || issues.length === 0) return null

  const messages: Record<Issue, string> = {
    bluetooth: 'Web Bluetooth is unavailable — heart rate monitoring will not work',
    camera: 'Camera access is unavailable — pose tracking will not work',
    os: 'iOS is not supported — please use Chrome on Android',
  }

  const onDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 text-base">⚠</span>
        <div className="flex-1">
          <p className="font-medium">This browser may not be fully supported.</p>
          <ul className="mt-1 list-disc pl-5 text-xs leading-relaxed">
            {issues.map((i) => (
              <li key={i}>{messages[i]}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs">For the best experience, use Chrome on Android.</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
