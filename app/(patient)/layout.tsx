'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/lib/store/auth'

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  const setUser = useAuthStore((s) => s.setUser)

  useEffect(() => {
    const match = document.cookie.match(/(?:^|; )shf_session=([^;]*)/)
    if (!match) return
    try {
      const user = JSON.parse(atob(decodeURIComponent(match[1])))
      setUser(user)
    } catch {}
  }, [setUser])

  return <>{children}</>
}
