import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

// NOT real auth — anon key only, no RLS enforced in MVP
export const supabaseServer = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
