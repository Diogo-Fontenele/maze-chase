import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://wlglksboakpsibgykymx.supabase.co'
const supabaseKey = 'sb_publishable_hCJq1fKTJBmvy0AFaR7jyg_dExXymV7'

export const supabase = createClient(supabaseUrl, supabaseKey)
