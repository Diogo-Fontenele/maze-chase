import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://wlglksboakpsibgykymx.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsZ2xrc2JvYWtwc2liZ3lreW14Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTEyNDM3MSwiZXhwIjoyMDk2NzAwMzcxfQ.UvQm9t2lf5vxUG0JKRvzc-Irxuh7j8Kq6Wy8aWjMHRk'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
