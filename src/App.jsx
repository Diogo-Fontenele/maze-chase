async function testSupabase() {
  const code = 'TEST' + Math.floor(Math.random() * 1000)

  const state = {
    test: true,
    createdAt: Date.now()
  }

  console.log('CRIANDO SALA:', code)

  const { data, error } = await supabase
    .from('rooms')
    .insert([{ code, state }])

  console.log('INSERT RESULT:', { data, error })

  if (error) return

  const { data: fetchData, error: fetchError } = await supabase
    .from('rooms')
    .select('*')
    .eq('code', code)
    .maybeSingle()

  console.log('FETCH RESULT:', { fetchData, fetchError })
}
