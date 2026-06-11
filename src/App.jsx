import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

// 🔥 CONFIG
const supabase = createClient(
  'https://wlglksboakpsibgykymx.supabase.co',
  'sb_publishable_hCJq1fKTJBmvy0AFaR7jyg_dExXymV7'
)

// 🔧 utils
function genCode() {
  return 'DBG' + Math.floor(Math.random() * 10000)
}

export default function App() {
  const [log, setLog] = useState([])
  const [status, setStatus] = useState({
    connection: '...',
    room: '...',
    host: '...'
  })

  function addLog(msg) {
    console.log(msg)
    setLog(l => [...l, msg])
  }

  async function runDebug() {
    setLog([])
    setStatus({
      connection: '...',
      room: '...',
      host: '...'
    })

    addLog('🚀 Iniciando debug...')

    // 🔌 TESTE CONEXÃO
    try {
      const { error } = await supabase.from('rooms').select('*').limit(1)
      if (error) throw error

      setStatus(s => ({ ...s, connection: 'ok' }))
      addLog('✅ Conectado ao Supabase')
    } catch (err) {
      setStatus(s => ({ ...s, connection: 'erro' }))
      addLog('❌ Erro conexão: ' + err.message)
      return
    }

    // 🏗️ CRIAR SALA
    const code = genCode()

    const state = {
      players: {},
      loot: [],
      maze: [],
      createdAt: Date.now()
    }

    try {
      const { error } = await supabase.from('rooms').insert({
        code,
        state
      })

      if (error) throw error

      setStatus(s => ({ ...s, room: 'ok' }))
      addLog('✅ Sala criada: ' + code)
    } catch (err) {
      setStatus(s => ({ ...s, room: 'erro' }))
      addLog('❌ Erro ao criar sala: ' + err.message)
      return
    }

    // 📦 BUSCAR SALA
    let roomData = null

    try {
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', code)
        .maybeSingle()

      if (error) throw error

      roomData = data
      addLog('📦 Sala recebida: ' + JSON.stringify(data))
    } catch (err) {
      addLog('❌ Erro ao buscar sala: ' + err.message)
      return
    }

    // 👤 CRIAR HOST
    try {
      const safeState = {
        players: {},
        loot: [],
        maze: [],
        ...roomData?.state
      }

      safeState.players['host'] = {
        id: 'host',
        name: 'Host',
        x: 0,
        y: 0
      }

      const { error } = await supabase
        .from('rooms')
        .update({ state: safeState })
        .eq('code', code)

      if (error) throw error

      setStatus(s => ({ ...s, host: 'ok' }))
      addLog('👤 Host criado com sucesso')
    } catch (err) {
      setStatus(s => ({ ...s, host: 'erro' }))
      addLog('❌ Erro ao criar host: ' + err.message)
      return
    }

    addLog('🏁 Debug finalizado')
  }

  return (
    <div style={{ padding: 20, fontFamily: 'monospace' }}>
      <h2>🧪 DEBUG SUPABASE</h2>

      <button onClick={runDebug}>
        Rodar Debug
      </button>

      <div style={{ marginTop: 20 }}>
        <div>🔌 Conexão: {status.connection}</div>
        <div>🏗️ Sala: {status.room}</div>
        <div>👤 Host: {status.host}</div>
      </div>

      <pre style={{
        marginTop: 20,
        background: '#111',
        color: '#0f0',
        padding: 10,
        height: 300,
        overflow: 'auto'
      }}>
        {log.join('\n')}
      </pre>
    </div>
  )
}
