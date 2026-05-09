import { NextRequest, NextResponse } from 'next/server'

function getSessionRole(request: NextRequest): string | null {
  const encoded = request.cookies.get('shf_session')?.value
  if (!encoded) return null
  try {
    const { role } = JSON.parse(atob(encoded))
    return typeof role === 'string' ? role : null
  } catch {
    return null
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/clinician')) {
    const role = getSessionRole(request)
    if (role !== 'clinician')
      return NextResponse.redirect(new URL('/login', request.url))
  }

  if (pathname.startsWith('/patient')) {
    const role = getSessionRole(request)
    if (role !== 'patient')
      return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico|manifest\\.json).*)'],
}
