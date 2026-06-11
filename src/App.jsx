// import { useState, useEffect, useCallback, useRef } from 'react'
// import { supabase } from './supabase'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

// 🔴 COLOCA AQUI OS SEUS DADOS
const supabaseUrl = 'https://wlglksboakpsibgykymx.supabase.co'
const supabaseKey = 'sb_publishable_hCJq1fKTJBmvy0AFaR7jyg_dExXymV7'

const supabase = createClient(supabaseUrl, supabaseKey)

export default function App() {
  const [debug, setDebug] = useState({
    connection: 'idle',
    room: 'idle',
    host: 'idle',
    log: []
  })

  async function runDebug() {

    const log = (msg) => {
      setDebug(prev => ({
        ...prev,
        log: [...prev.log, msg]
      }))
    }

    setDebug({
      connection: 'idle',
      room: 'idle',
      host: 'idle',
      log: []
    })

    log('🚀 Iniciando debug...')

    // 🔌 TESTE DE CONEXÃO
    setDebug(prev => ({ ...prev, connection: 'testing' }))

    const { data: ping, error: pingError } = await supabase
      .from('rooms')
      .select('code')
      .limit(1)

    if (pingError) {
      setDebug(prev => ({ ...prev, connection: 'error' }))
      log('❌ Erro conexão: ' + pingError.message)
      return
    }

    setDebug(prev => ({ ...prev, connection: 'ok' }))
    log('✅ Conectado ao Supabase')

    // 🏗️ CRIAR SALA
    setDebug(prev => ({ ...prev, room: 'creating' }))

    const code = 'DBG' + Math.floor(Math.random() * 10000)

    const state = {
      players: [],
      createdAt: Date.now()
    }

    const { error: insertError } = await supabase
      .from('rooms')
      .insert([{ code, state }])

    if (insertError) {
      setDebug(prev => ({ ...prev, room: 'error' }))
      log('❌ Erro ao criar sala: ' + insertError.message)
      return
    }

    setDebug(prev => ({ ...prev, room: 'ok' }))
    log('✅ Sala criada: ' + code)

    // 📥 BUSCAR SALA
    const { data: roomData, error: fetchError } = await supabase
      .from('rooms')
      .select('*')
      .eq('code', code)
      .maybeSingle()

    if (fetchError || !roomData) {
      log('❌ Erro ao buscar sala')
      return
    }

    log('📦 Sala recebida: ' + JSON.stringify(roomData))

    // 👤 CRIAR HOST
    setDebug(prev => ({ ...prev, host: 'creating' }))

    const updatedState = {
      ...roomData.state,
      players: [{ id: 'host', x: 1, y: 1 }]
    }

    const { error: updateError } = await supabase
      .from('rooms')
      .update({ state: updatedState })
      .eq('code', code)

    if (updateError) {
      setDebug(prev => ({ ...prev, host: 'error' }))
      log('❌ Erro ao criar host: ' + updateError.message)
      return
    }

    setDebug(prev => ({ ...prev, host: 'ok' }))
    log('👤 Host criado com sucesso')

    log('🏁 Debug finalizado')
  }

  return (
    <div style={{ padding: 20, background: '#111', color: '#0f0', minHeight: '100vh' }}>
      <h2>🧪 DEBUG SUPABASE</h2>

      <button onClick={runDebug} style={{ padding: 10, marginBottom: 20 }}>
        Rodar Debug
      </button>

      <p>🔌 Conexão: {debug.connection}</p>
      <p>🏗️ Sala: {debug.room}</p>
      <p>👤 Host: {debug.host}</p>

      <hr />

      <div style={{ maxHeight: 300, overflow: 'auto', background: '#000', padding: 10 }}>
        {debug.log.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  )
}
