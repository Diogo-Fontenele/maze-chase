import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://wlglksboakpsibgykymx.supabase.co'
const SUPABASE_KEY = 'sb_publishable_hCJq1fKTJBmvy0AFaR7jyg_dExXymV7'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
