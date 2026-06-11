import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'

useEffect(() => {
  async function test() {
    const { data, error } = await supabase
      .from('rooms')
      .insert([{ code: 'TEST', state: {} }])

    console.log('RESULTADO:', data)
    console.log('ERRO:', error)
  }

  test()
}, [])
