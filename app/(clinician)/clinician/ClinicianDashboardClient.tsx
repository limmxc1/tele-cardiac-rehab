'use client'

import { useAuthStore } from '@/lib/store/auth'

export default function ClinicianDashboardClient() {
  const user = useAuthStore((s) => s.user)
  return (
    <p className="text-xl text-slate-700">
      Welcome, {user?.display_name ?? '…'}
    </p>
  )
}
