'use client'

import { useActionState, useEffect } from 'react'
import { loginAction, type LoginState } from '@/app/actions/auth'
import { useAuthStore } from '@/lib/store/auth'

export default function LoginPage() {
  const clearUser = useAuthStore((s) => s.clearUser)
  const [state, action, isPending] = useActionState<LoginState, FormData>(loginAction, null)

  useEffect(() => {
    clearUser()
  }, [clearUser])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-2 text-2xl font-bold text-slate-800">SHF Cardiac Rehab</h1>
        <p className="mb-8 text-sm text-slate-500">Enter your username to continue</p>

        <form action={action} className="flex flex-col gap-4">
          <input
            name="username"
            type="text"
            placeholder="Username"
            autoComplete="off"
            autoCapitalize="none"
            className="rounded-xl border border-slate-300 px-4 py-3 text-lg text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            required
          />

          {state?.error && (
            <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="rounded-xl bg-blue-600 py-3 text-lg font-semibold text-white disabled:opacity-50 hover:bg-blue-700 active:bg-blue-800"
          >
            {isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Not real authentication — username routing only
        </p>
      </div>
    </div>
  )
}
