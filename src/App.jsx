import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'

// ─── Constants ────────────────────────────────────────────────────────────────
const MW = 21, MH = 21, CELL = 24, FOG = 8, LOOT_N = 6
const CC = ['#00C9FF','#48CAE4','#90E0EF','#0096C7','#00B4D8','#0077B6']
const TC = ['#FF6B35','#F7931E','#FFD700','#FF4500']
const EM = { cop:'👮', thief:'🦹' }

// ─── Maze ─────────────────────────────────────────────────────────────────────
function buildMaze(w, h) {
  const g = Array.from({length:h}, () => Array(w).fill(1))
  const v = Array.from({length:h}, () => Array(w).fill(false))
  const carve = (x, y) => {
    v[y][x] = true; g[y][x] = 0
    [[0,-2],[0,2],[-2,0],[2,0]].sort(() => Math.random()-.5).forEach(([dx,dy]) => {
      const nx=x+dx, ny=y+dy
      if (nx>0&&ny>0&&nx<w-1&&ny<h-1&&!v[ny][nx]) { g[y+dy/2][x+dx/2]=0; carve(nx,ny) }
    })
  }
  carve(1,1)
  for (let x=0;x<w;x++) { g[0][x]=1; g[h-1][x]=1 }
  for (let y=0;y<h;y++) { g[y][0]=1; g[y][w-1]=1 }
  return g
}
function seedLoot(maze) {
  const free = []
  for (let y=2;y<MH-2;y++) for (let x=2;x<MW-2;x++) if (maze[y][x]===0) free.push({x,y})
  return free.sort(()=>Math.random()-.5).slice(0,LOOT_N).map(p=>({...p,collected:false}))
}
function startPos(role, idx) {
  if (role==='thief') return [[1,1],[MW-2,1],[1,MH-2],[MW-2,MH-2]][idx%4]
  const cx=MW/2|0, cy=MH/2|0
  return [[cx,cy],[cx+2,cy],[cx-2,cy],[cx,cy+2],[cx,cy-2],[cx+2,cy+2]][idx%6]
}
function emptyState() {
  const maze = buildMaze(MW, MH)
  return { phase:'lobby', maze, loot:seedLoot(maze), players:{}, winner:null, chat:[] }
}
function passable(maze, x, y) { return x>=0&&y>=0&&x<MW&&y<MH&&maze[y][x]===0 }
function mDist(a, b) { return Math.abs(a.x-b.x)+Math.abs(a.y-b.y) }
function genCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  return Array.from({length:4}, () => c[Math.random()*c.length|0]).join('')
}

// ─── Supabase ─────────────────────────────────────────────────────────────────
async function roomLoad(code) {
  const { data, error } = await supabase
    .from('rooms').select('state').eq('code', code).single()
  if (error) {
    if (error.code !== 'PGRST116') console.error('[roomLoad]', error.code, error.message)
    return null
  }
  return data?.state || null
}
async function roomSave(code, state) {
  const { error } = await supabase
    .from('rooms')
    .upsert({ code, state, updated_at: new Date().toISOString() }, { onConflict: 'code' })
  if (error) {
    console.error('[roomSave]', error.code, error.message, error.hint)
    throw new Error('Supabase (' + error.code + '): ' + error.message)
  }
  return true
}

// ─── Preloader component ──────────────────────────────────────────────────────
function Preloader({ pct, label }) {
  return (
    <div style={{
      position:'fixed', inset:0,
      background:'rgba(2,12,20,0.92)',
      display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center',
      zIndex:9999, gap:20
    }}>
      <div style={{fontSize:48}}>🏛️</div>
      <p style={{color:'#7ac8e8', fontSize:15, letterSpacing:2}}>{label}</p>
      {/* Outer bar */}
      <div style={{
        width:260, height:14, background:'#0a1929',
        borderRadius:8, border:'1px solid #1a3a55', overflow:'hidden'
      }}>
        <div style={{
          height:'100%', borderRadius:8,
          background:'linear-gradient(90deg,#0096c7,#00c9ff)',
          width:`${pct}%`,
          transition:'width 0.3s ease',
          boxShadow:'0 0 10px #00c9ff88'
        }}/>
      </div>
      <p style={{color:'#00c9ff', fontWeight:900, fontSize:18}}>{pct}%</p>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [pid] = useState(() => {
    let id = localStorage.getItem('maze_pid')
    if (!id) { id='p'+Math.random().toString(36).slice(2,9); localStorage.setItem('maze_pid',id) }
    return id
  })

  const [screen, setScreen]       = useState('home')
  const [roomCode, setRoomCode]   = useState('')
  const [joinInput, setJoinInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [roleChoice, setRoleChoice] = useState('thief')
  const [gs, setGs]               = useState(null)
  const [joined, setJoined]       = useState(false)
  const [msg, setMsg]             = useState('')
  const [chatInput, setChatInput] = useState('')
  const [connOk, setConnOk]       = useState(null)   // null | true | false
  const [online, setOnline]       = useState(0)       // connected devices
  const [loader, setLoader]       = useState(null)    // null | { pct, label }

  const canvasRef  = useRef(null)
  const channelRef = useRef(null)
  const presRef    = useRef(null)   // presence channel
  const gsRef      = useRef(null)
  gsRef.current = gs

  // ── Animate preloader ──────────────────────────────────────────────────────
  const runLoader = useCallback((steps) => {
    return new Promise(resolve => {
      let i = 0
      const tick = () => {
        if (i >= steps.length) { setLoader(null); resolve(); return }
        setLoader(steps[i])
        i++
        setTimeout(tick, steps[i-1].ms || 400)
      }
      tick()
    })
  }, [])

  // ── Test connection ────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('rooms').select('code').limit(1)
      .then(({ error }) => setConnOk(!error))
      .catch(() => setConnOk(false))
  }, [])

  // ── Online presence (home screen counter) ─────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel('online-users', {
      config: { presence: { key: pid } }
    })
    ch.on('presence', { event:'sync' }, () => {
      setOnline(Object.keys(ch.presenceState()).length)
    })
    ch.subscribe(async status => {
      if (status === 'SUBSCRIBED') await ch.track({ pid, at: Date.now() })
    })
    presRef.current = ch
    return () => { supabase.removeChannel(ch) }
  }, [pid])

  // ── Draw maze ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== 'game' || !gs?.maze) return
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')
    const me = gs.players[pid]; if (!me) return
    const pl = Object.values(gs.players)
    canvas.width = MW*CELL; canvas.height = MH*CELL
    for (let y=0;y<MH;y++) for (let x=0;x<MW;x++) {
      const fog = !me.caught && Math.max(Math.abs(x-me.x),Math.abs(y-me.y))>FOG
      const cx=x*CELL, cy=y*CELL
      if (fog) { ctx.fillStyle='#030b12'; ctx.fillRect(cx,cy,CELL,CELL); continue }
      ctx.fillStyle = gs.maze[y][x]===1 ? '#0a1f36' : '#0d2540'
      ctx.fillRect(cx,cy,CELL,CELL)
      if (gs.maze[y][x]===1) { ctx.strokeStyle='#061525'; ctx.lineWidth=1; ctx.strokeRect(cx,cy,CELL,CELL) }
    }
    gs.loot.forEach(l => {
      if (l.collected) return
      if (!me.caught && Math.max(Math.abs(l.x-me.x),Math.abs(l.y-me.y))>FOG) return
      ctx.font=`${CELL-4}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle'
      ctx.fillText('💎', l.x*CELL+CELL/2, l.y*CELL+CELL/2)
    })
    pl.forEach(p => {
      if (p.caught) return
      if (!me.caught && Math.max(Math.abs(p.x-me.x),Math.abs(p.y-me.y))>FOG) return
      const px=p.x*CELL+CELL/2, py=p.y*CELL+CELL/2, r=CELL/2-2
      ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2)
      ctx.fillStyle=p.color+'28'; ctx.fill()
      ctx.strokeStyle=p.color; ctx.lineWidth=p.id===pid?3:2; ctx.stroke()
      ctx.font=`${CELL-6}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle'
      ctx.fillText(EM[p.role], px, py)
    })
  }, [gs, screen, pid])

  // ── Subscribe realtime ─────────────────────────────────────────────────────
  const subscribe = useCallback((code) => {
    if (channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current = supabase
      .channel('room-'+code)
      .on('postgres_changes', {
        event:'UPDATE', schema:'public', table:'rooms', filter:`code=eq.${code}`
      }, payload => {
        const s = payload.new?.state; if (!s) return
        setGs(s)
        if      (s.phase==='lobby')    setScreen('lobby')
        else if (s.phase==='playing')  setScreen('game')
        else if (s.phase==='gameover') setScreen('over')
      })
      .subscribe()
  }, [])

  const unsubscribe = useCallback(() => {
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current=null }
  }, [])

  // ── Create room ────────────────────────────────────────────────────────────
  const createRoom = useCallback(async () => {
    setMsg('')
    try {
      await runLoader([
        { pct:10, label:'Gerando labirinto...', ms:300 },
        { pct:35, label:'Posicionando joias...', ms:300 },
        { pct:60, label:'Criando sala no servidor...', ms:500 },
        { pct:85, label:'Configurando jogadores...', ms:300 },
        { pct:100, label:'Pronto!', ms:400 },
      ])
      const code  = genCode()
      const state = emptyState()
      await roomSave(code, state)
      setRoomCode(code); setGs(state); setJoined(false)
      subscribe(code); setScreen('join')
    } catch(e) {
      setLoader(null)
      setMsg('❌ Erro ao criar sala: ' + e.message + '\n\nVerifique se a chave do Supabase está correta no arquivo supabase.js')
    }
  }, [runLoader, subscribe])

  // ── Join by code ───────────────────────────────────────────────────────────
  const joinByCode = useCallback(async () => {
    const code = joinInput.trim().toUpperCase()
    if (code.length !== 4) { setMsg('⚠️ O código tem 4 letras!'); return }
    setMsg('')
    try {
      await runLoader([
        { pct:30, label:'Procurando sala '+code+'...', ms:400 },
        { pct:70, label:'Conectando...', ms:400 },
        { pct:100, label:'Entrando!', ms:300 },
      ])
      const s = await roomLoad(code)
      if (!s) { setLoader(null); setMsg('❌ Sala "'+code+'" não encontrada.'); return }
      setRoomCode(code); setGs(s); setJoined(false)
      subscribe(code); setScreen('join')
    } catch(e) {
      setLoader(null); setMsg('❌ Erro: '+e.message)
    }
  }, [joinInput, runLoader, subscribe])

  // ── Enter as player ────────────────────────────────────────────────────────
  const enterRoom = useCallback(async () => {
    const name = nameInput.trim()
    if (!name) { setMsg('⚠️ Digite seu nome!'); return }
    setMsg('')
    try {
      await runLoader([
        { pct:40, label:'Verificando sala...', ms:300 },
        { pct:80, label:'Registrando jogador...', ms:400 },
        { pct:100, label:'Entrando na sala!', ms:300 },
      ])
      let s = await roomLoad(roomCode)
      if (!s)                    { setLoader(null); setMsg('❌ Sala não encontrada.'); return }
      if (s.phase !== 'lobby')   { setLoader(null); setMsg('❌ Partida já em andamento!'); return }
      if (Object.keys(s.players).length >= 10) { setLoader(null); setMsg('❌ Sala cheia!'); return }
      if (s.players[pid]) { setGs(s); setJoined(true); setScreen('lobby'); return }
      const nt = Object.values(s.players).filter(p=>p.role==='thief').length
      if (roleChoice==='thief' && nt>=4) { setLoader(null); setMsg('⚠️ Já tem 4 ladrões!'); return }
      const ri = Object.values(s.players).filter(p=>p.role===roleChoice).length
      const [sx,sy] = startPos(roleChoice, ri)
      s.players[pid] = { id:pid, name, role:roleChoice, x:sx, y:sy, caught:false, loot:0,
        color: roleChoice==='thief' ? TC[nt%4] : CC[ri%6] }
      await roomSave(roomCode, s)
      setGs(s); setJoined(true); setMsg(''); setScreen('lobby')
    } catch(e) {
      setLoader(null); setMsg('❌ Erro: '+e.message)
    }
  }, [nameInput, roleChoice, roomCode, pid, runLoader])

  // ── Change role ────────────────────────────────────────────────────────────
  const changeRole = useCallback(async (nr) => {
    try {
      let s = await roomLoad(roomCode)
      if (!s || !s.players[pid]) return
      if (s.players[pid].role === nr) return
      const nt = Object.values(s.players).filter(p=>p.role==='thief').length
      if (nr==='thief' && nt>=4) { setMsg('⚠️ Máximo 4 ladrões!'); return }
      const ri = Object.values(s.players).filter(p=>p.role===nr&&p.id!==pid).length
      const ntNew = Object.values(s.players).filter(p=>p.role==='thief'&&p.id!==pid).length
      const [sx,sy] = startPos(nr, ri)
      s.players[pid] = { ...s.players[pid], role:nr, x:sx, y:sy,
        color: nr==='thief' ? TC[ntNew%4] : CC[ri%6] }
      await roomSave(roomCode, s)
      setGs(s); setMsg('')
    } catch(e) { setMsg('❌ Erro: '+e.message) }
  }, [roomCode, pid])

  // ── Start game ─────────────────────────────────────────────────────────────
  const startGame = useCallback(async () => {
    try {
      await runLoader([
        { pct:20, label:'Gerando novo labirinto...', ms:400 },
        { pct:50, label:'Espalhando joias...', ms:400 },
        { pct:80, label:'Posicionando jogadores...', ms:400 },
        { pct:100, label:'Começando!', ms:300 },
      ])
      let s = await roomLoad(roomCode)
      if (!s) { setLoader(null); return }
      const all = Object.values(s.players)
      if (!all.some(p=>p.role==='cop'))   { setLoader(null); setMsg('⚠️ Precisa de 1 policial!'); return }
      if (!all.some(p=>p.role==='thief')) { setLoader(null); setMsg('⚠️ Precisa de 1 ladrão!');  return }
      const maze = buildMaze(MW, MH)
      s.maze=maze; s.loot=seedLoot(maze); s.winner=null
      let ci=0, ti=0
      Object.keys(s.players).forEach(k => {
        const p=s.players[k], idx=p.role==='thief'?ti++:ci++
        const [sx,sy] = startPos(p.role, idx)
        s.players[k] = { ...p, x:sx, y:sy, caught:false, loot:0 }
      })
      s.phase = 'playing'
      await roomSave(roomCode, s)
      setGs(s); setMsg('')
    } catch(e) { setLoader(null); setMsg('❌ Erro ao iniciar: '+e.message) }
  }, [roomCode, runLoader])

  // ── Move ───────────────────────────────────────────────────────────────────
  const doMove = useCallback(async (dx, dy) => {
    if (!gsRef.current || gsRef.current.phase!=='playing') return
    try {
      let s = await roomLoad(roomCode)
      if (!s || s.phase!=='playing') return
      const me = s.players[pid]; if (!me || me.caught) return
      const nx=me.x+dx, ny=me.y+dy
      if (!passable(s.maze, nx, ny)) return
      s.players[pid].x=nx; s.players[pid].y=ny
      if (me.role==='thief') {
        s.loot = s.loot.map(l => {
          if (!l.collected && l.x===nx && l.y===ny) { s.players[pid].loot++; return {...l,collected:true} }
          return l
        })
      }
      if (me.role==='cop') {
        Object.keys(s.players).forEach(k => {
          const p=s.players[k]
          if (p.role==='thief'&&!p.caught&&mDist({x:nx,y:ny},p)<=1) s.players[k].caught=true
        })
      }
      const thieves = Object.values(s.players).filter(p=>p.role==='thief')
      if (thieves.every(p=>p.caught))        { s.phase='gameover'; s.winner='cops' }
      else if (s.loot.every(l=>l.collected)) { s.phase='gameover'; s.winner='thieves' }
      await roomSave(roomCode, s); setGs(s)
    } catch(_) {}
  }, [roomCode, pid])

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = {ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0],
                  w:[0,-1],s:[0,1],a:[-1,0],d:[1,0]}
    const fn = e => { if (map[e.key]&&screen==='game') { e.preventDefault(); doMove(...map[e.key]) } }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [doMove, screen])

  // ── Chat ───────────────────────────────────────────────────────────────────
  const sendChat = useCallback(async () => {
    if (!chatInput.trim()) return
    try {
      let s = await roomLoad(roomCode)
      const me = s?.players[pid]; if (!me) return
      if (!s.chat) s.chat=[]
      s.chat = [...s.chat.slice(-29), {name:me.name, role:me.role, msg:chatInput.trim()}]
      await roomSave(roomCode, s); setGs(s); setChatInput('')
    } catch(_) {}
  }, [chatInput, roomCode, pid])

  const goHome = useCallback(() => {
    unsubscribe(); setScreen('home'); setGs(null); setJoined(false)
    setRoomCode(''); setJoinInput(''); setMsg('')
  }, [unsubscribe])

  // ── Derived ────────────────────────────────────────────────────────────────
  const me      = gs?.players?.[pid]
  const players = gs ? Object.values(gs.players) : []
  const cops    = players.filter(p=>p.role==='cop')
  const thieves = players.filter(p=>p.role==='thief')

  // ══════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════
  return (
    <>
      {loader && <Preloader pct={loader.pct} label={loader.label} />}

      {/* HOME */}
      {screen==='home' && (
        <div style={S.root}>
          <div style={S.card}>
            <div style={{fontSize:52}}>🏛️</div>
            <h1 style={S.title}>MAZE CHASE</h1>
            <p style={S.sub}>Polícia vs Ladrão · Multiplayer Online</p>

            {/* Connection + online counter */}
            <div style={{width:'100%',display:'flex',gap:8}}>
              <div style={{...S.sbar, flex:1,
                ...(connOk===null ? S.swait : connOk ? S.sok : S.serr)}}>
                {connOk===null ? '⏳ Verificando...' : connOk ? '🟢 Servidor OK' : '❌ Sem conexão'}
              </div>
              <div style={{...S.sbar, ...S.sok, width:'auto', padding:'5px 14px', whiteSpace:'nowrap'}}>
                🌐 {online} online
              </div>
            </div>

            {connOk===false && (
              <div style={{...S.sbar,...S.serr,fontSize:11,lineHeight:1.5}}>
                Verifique a chave anon no arquivo <strong>supabase.js</strong>.<br/>
                Ela deve começar com <strong>eyJ...</strong><br/>
                Dashboard → Project Settings → API → anon/public
              </div>
            )}

            <button style={{...S.btnP, opacity:connOk?1:.4}}
              onClick={createRoom} disabled={!connOk}>
              ✅ CRIAR NOVA SALA
            </button>

            <div style={S.divider}/>

            <div style={{display:'flex',gap:8,width:'100%'}}>
              <input style={{...S.inp,flex:1,textTransform:'uppercase',
                letterSpacing:6,fontSize:18,textAlign:'center'}}
                placeholder='CÓDIGO' maxLength={4} value={joinInput}
                onChange={e=>setJoinInput(e.target.value.toUpperCase())}
                onKeyDown={e=>e.key==='Enter'&&joinByCode()} />
              <button style={{...S.btnP,width:'auto',padding:'0 16px',
                letterSpacing:0,fontSize:13}} onClick={joinByCode}>
                ENTRAR
              </button>
            </div>

            {msg && <p style={{...S.msgT,whiteSpace:'pre-wrap'}}>{msg}</p>}
          </div>
        </div>
      )}

      {/* JOIN */}
      {screen==='join' && (
        <div style={S.root}>
          <div style={S.card}>
            <div style={{fontSize:36}}>🏛️</div>
            <h2 style={{...S.title,fontSize:20}}>MAZE CHASE</h2>
            <div style={{...S.sbar,...S.sok}}>
              🟢 Sala: <strong style={{letterSpacing:4}}>{roomCode}</strong>
            </div>
            <input style={S.inp} placeholder='Seu nome...' maxLength={16} value={nameInput}
              onChange={e=>setNameInput(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&enterRoom()} />
            <div style={S.rolePicker}>
              <p style={{color:'#7ac8e8',fontSize:12,textAlign:'center',marginBottom:8}}>
                Escolha seu papel:
              </p>
              <div style={{display:'flex',gap:10}}>
                {['thief','cop'].map(r=>(
                  <button key={r} onClick={()=>setRoleChoice(r)} style={{
                    flex:1,padding:'10px 6px',borderRadius:10,cursor:'pointer',
                    display:'flex',flexDirection:'column',alignItems:'center',gap:3,
                    fontFamily:'inherit',fontSize:13,fontWeight:700,
                    background: roleChoice===r?(r==='thief'?'#FF6B3520':'#00C9FF20'):'#060f1a',
                    border:`2px solid ${roleChoice===r?(r==='thief'?'#FF6B35':'#00C9FF'):'#1a3a55'}`,
                    color: roleChoice===r?(r==='thief'?'#FF6B35':'#00C9FF'):'#556',
                  }}>
                    <span style={{fontSize:28}}>{EM[r]}</span>
                    <span>{r==='thief'?'Ladrão':'Policial'}</span>
                    {r==='thief'&&<span style={{fontSize:10,color:'#888'}}>máx 4</span>}
                  </button>
                ))}
              </div>
            </div>
            {players.length>0&&(
              <div style={{width:'100%',textAlign:'center'}}>
                <p style={{color:'#4a8aaa',fontSize:11,marginBottom:4}}>Já na sala:</p>
                {players.map(p=>(
                  <span key={p.id} style={{...S.badge,background:p.color,color:'#000'}}>
                    {EM[p.role]} {p.name}
                  </span>
                ))}
              </div>
            )}
            {msg&&<p style={S.msgT}>{msg}</p>}
            <button style={S.btnP} onClick={enterRoom}>CONFIRMAR ENTRADA</button>
            <button style={S.btnG} onClick={goHome}>← Voltar</button>
          </div>
        </div>
      )}

      {/* LOBBY */}
      {screen==='lobby' && (
        <div style={S.root}>
          <div style={{...S.card,width:480}}>
            <h2 style={{...S.title,fontSize:20}}>
              🏛️ Sala <span style={{color:'#00c9ff',letterSpacing:4}}>{roomCode}</span>
            </h2>
            <p style={{color:'#4a8aaa',fontSize:11}}>
              Compartilhe o código <strong style={{color:'#00c9ff',letterSpacing:3}}>{roomCode}</strong> com seu filho
            </p>
            <div style={{display:'flex',gap:12,width:'100%'}}>
              <div style={S.teamBox}>
                <p style={{color:'#00C9FF',fontWeight:700,fontSize:13,marginBottom:8}}>
                  👮 POLICIAIS ({cops.length})
                </p>
                {cops.length===0&&<p style={{color:'#333',fontSize:12}}>Aguardando...</p>}
                {cops.map(p=>(
                  <div key={p.id} style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                    <div style={{width:8,height:8,borderRadius:'50%',background:p.color}}/>
                    <span style={{color:p.color,fontSize:13}}>{p.name}</span>
                    {p.id===pid&&<span style={{color:'#444',fontSize:10}}>(você)</span>}
                  </div>
                ))}
              </div>
              <div style={S.teamBox}>
                <p style={{color:'#FF6B35',fontWeight:700,fontSize:13,marginBottom:8}}>
                  🦹 LADRÕES ({thieves.length}/4)
                </p>
                {thieves.length===0&&<p style={{color:'#333',fontSize:12}}>Aguardando...</p>}
                {thieves.map(p=>(
                  <div key={p.id} style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                    <div style={{width:8,height:8,borderRadius:'50%',background:p.color}}/>
                    <span style={{color:p.color,fontSize:13}}>{p.name}</span>
                    {p.id===pid&&<span style={{color:'#444',fontSize:10}}>(você)</span>}
                  </div>
                ))}
              </div>
            </div>
            {me&&(
              <div style={S.myCtrl}>
                <p style={{color:'#7ac8e8',fontSize:12,marginBottom:8}}>
                  Você: <strong style={{color:me.color}}>{EM[me.role]} {me.role==='thief'?'Ladrão':'Policial'}</strong>
                </p>
                <div style={{display:'flex',gap:8}}>
                  {['thief','cop'].map(r=>(
                    <button key={r} onClick={()=>changeRole(r)} style={{
                      flex:1,padding:'8px 4px',borderRadius:8,cursor:'pointer',
                      fontFamily:'inherit',fontSize:13,fontWeight:700,
                      background:me.role===r?(r==='thief'?'#FF6B3520':'#00C9FF20'):'#060f1a',
                      border:`2px solid ${me.role===r?(r==='thief'?'#FF6B35':'#00C9FF'):'#1a3a55'}`,
                      color:me.role===r?(r==='thief'?'#FF6B35':'#00C9FF'):'#445',
                    }}>
                      {EM[r]} {r==='thief'?'Ladrão':'Policial'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msg&&<p style={S.msgT}>{msg}</p>}
            <button style={S.btnP} onClick={startGame}>▶ INICIAR PARTIDA</button>
            <p style={{color:'#333',fontSize:11}}>Qualquer jogador pode iniciar.</p>
            <button style={S.btnG} onClick={goHome}>← Sair da Sala</button>
          </div>
        </div>
      )}

      {/* GAME */}
      {screen==='game' && me && (
        <div style={S.root} tabIndex={0}>
          <div style={S.hud}>
            <span style={{color:me.color,fontWeight:700}}>{EM[me.role]} {me.name}</span>
            {me.role==='thief'&&!me.caught&&<span style={S.chip}>💰 {me.loot}</span>}
            {me.caught&&<span style={{...S.chip,color:'#f55'}}>🔒 PRESO</span>}
            <span style={S.chip}>👮 {cops.length} | 🦹 {thieves.filter(p=>!p.caught).length}/{thieves.length}</span>
            <span style={S.chip}>💎 {gs.loot.filter(l=>!l.collected).length} restantes</span>
            <span style={{...S.chip,marginLeft:'auto'}}>🌐 {online} online</span>
          </div>
          <div style={{display:'flex',gap:12,alignItems:'flex-start',maxWidth:900,width:'100%'}}>
            <div style={{position:'relative',flexShrink:0}}>
              <canvas ref={canvasRef} style={{display:'block',border:'2px solid #0a2030',
                boxShadow:'0 0 30px #001a2a88'}}/>
              {me.caught&&(
                <div style={{position:'absolute',inset:0,background:'#000c',display:'flex',
                  flexDirection:'column',alignItems:'center',justifyContent:'center',
                  fontSize:32,color:'#f55',fontWeight:900,pointerEvents:'none'}}>
                  🔒<br/>PRESO<br/><span style={{fontSize:13,color:'#888'}}>Aguarde...</span>
                </div>
              )}
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:10,width:178}}>
              <div style={S.panel}>
                <p style={S.pt}>👥 Jogadores</p>
                {players.map(p=>(
                  <div key={p.id} style={{fontSize:12,color:p.color,marginBottom:3}}>
                    {EM[p.role]} {p.name}{p.id===pid?' ★':''}{p.caught?' 🔒':''}{p.role==='thief'?` 💰${p.loot}`:''}
                  </div>
                ))}
              </div>
              <div style={S.panel}>
                <p style={S.pt}>💎 Joias</p>
                {gs.loot.map((l,i)=><span key={i} style={{fontSize:15,opacity:l.collected?.2:1}}>💎</span>)}
              </div>
              <div style={S.panel}>
                <p style={S.pt}>🕹️ Mover</p>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,36px)',gap:3,margin:'4px auto',width:'fit-content'}}>
                  {[null,[0,-1],null,[-1,0],null,[1,0],null,[0,1],null].map((d,i)=>
                    d?<button key={i} style={S.db} onClick={()=>doMove(...d)}>
                        {i===1?'▲':i===3?'◄':i===5?'►':'▼'}
                      </button>
                     :<div key={i} style={{width:36,height:36}}/>
                  )}
                </div>
                <p style={{color:'#333',fontSize:10,textAlign:'center',marginTop:2}}>WASD / Setas</p>
              </div>
              <div style={{...S.panel,flex:1}}>
                <p style={S.pt}>💬 Chat</p>
                <div style={{height:80,overflowY:'auto',background:'#030b13',borderRadius:5,padding:5,marginBottom:5}}>
                  {(gs.chat||[]).map((c,i)=>(
                    <div key={i} style={{marginBottom:3}}>
                      <span style={{color:c.role==='thief'?TC[0]:CC[0],fontSize:10,fontWeight:700}}>{c.name}: </span>
                      <span style={{color:'#ccc',fontSize:11}}>{c.msg}</span>
                    </div>
                  ))}
                </div>
                <div style={{display:'flex',gap:4}}>
                  <input style={{...S.inp,fontSize:11,padding:'3px 7px',flex:1}}
                    placeholder='Msg...' value={chatInput}
                    onChange={e=>setChatInput(e.target.value)}
                    onKeyDown={e=>e.key==='Enter'&&sendChat()}/>
                  <button style={{...S.btnP,padding:'3px 10px',width:'auto',
                    fontSize:12,letterSpacing:0}} onClick={sendChat}>➤</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GAME OVER */}
      {screen==='over' && (
        <div style={S.root}>
          <div style={S.card}>
            <div style={{fontSize:64}}>{gs?.winner==='cops'?'👮':'🦹'}</div>
            <h2 style={{...S.title,color:gs?.winner==='cops'?'#00C9FF':'#FF6B35'}}>
              {gs?.winner==='cops'?'POLÍCIA VENCEU!':'LADRÕES ESCAPARAM!'}
            </h2>
            <p style={{fontSize:17,
              color:((gs?.winner==='cops'&&me?.role==='cop')||(gs?.winner==='thieves'&&me?.role==='thief'))?'#FFD700':'#888',
              margin:'4px 0 12px'}}>
              {((gs?.winner==='cops'&&me?.role==='cop')||(gs?.winner==='thieves'&&me?.role==='thief'))
                ?'🏆 Você venceu!':'😔 Sua equipe perdeu.'}
            </p>
            {thieves.map(p=>(
              <p key={p.id} style={{color:p.color,fontSize:13,marginBottom:3}}>
                🦹 {p.name}: {p.loot} joias — {p.caught?'PRESO 🔒':'Livre ✅'}
              </p>
            ))}
            <button style={{...S.btnP,marginTop:16}} onClick={goHome}>🔄 NOVA PARTIDA</button>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  root:{ minHeight:'100vh',background:'radial-gradient(ellipse at top,#071829,#020c14)',
    display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',
    fontFamily:"'Courier New',monospace",color:'#e0f0ff',padding:12 },
  card:{ background:'#060f1a',border:'1px solid #0a2a3a',borderRadius:16,padding:28,
    width:360,display:'flex',flexDirection:'column',alignItems:'center',gap:12,
    boxShadow:'0 0 60px #001a2a' },
  title:{ fontSize:26,fontWeight:900,letterSpacing:4,color:'#e0f4ff',
    margin:'4px 0',textShadow:'0 0 20px #00aaff33' },
  sub:{ color:'#4a8aaa',fontSize:13,margin:0 },
  inp:{ width:'100%',background:'#0a1929',border:'1px solid #1a3a55',borderRadius:8,
    color:'#e0f4ff',padding:'10px 14px',fontSize:15,outline:'none',
    fontFamily:'inherit',boxSizing:'border-box' },
  btnP:{ width:'100%',padding:'11px 0',
    background:'linear-gradient(90deg,#0096c7,#00c9ff)',
    border:'none',borderRadius:8,color:'#001a2a',fontWeight:900,
    fontSize:14,letterSpacing:2,cursor:'pointer',fontFamily:'inherit' },
  btnG:{ width:'100%',padding:'8px 0',background:'transparent',
    border:'1px solid #1a3a55',borderRadius:8,color:'#4a8aaa',
    fontSize:13,cursor:'pointer',fontFamily:'inherit' },
  msgT:{ color:'#ffcc44',fontSize:13,margin:0,textAlign:'center' },
  badge:{ display:'inline-block',borderRadius:20,padding:'3px 10px',
    fontSize:12,fontWeight:700,margin:'2px 3px' },
  sbar:{ fontSize:12,padding:'5px 14px',borderRadius:20,
    border:'1px solid transparent',textAlign:'center' },
  sok:{ background:'#003322',color:'#00cc88',borderColor:'#00cc8844' },
  serr:{ background:'#330011',color:'#ff6666',borderColor:'#ff666644' },
  swait:{ background:'#1a1a00',color:'#ccaa00',borderColor:'#ccaa0044' },
  rolePicker:{ width:'100%',background:'#0a1929',borderRadius:10,
    padding:12,border:'1px solid #1a3a55' },
  teamBox:{ flex:1,background:'#0a1929',borderRadius:10,padding:12 },
  myCtrl:{ width:'100%',background:'#0a1929',borderRadius:10,
    padding:12,border:'1px solid #1a3a55' },
  divider:{ width:'100%',height:1,background:'#1a3a55',margin:'4px 0' },
  hud:{ display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',
    background:'#060f1a',border:'1px solid #0a2a3a',borderRadius:10,
    padding:'7px 14px',marginBottom:10,fontSize:13,width:'100%',maxWidth:900 },
  chip:{ color:'#7ac8e8',fontSize:12 },
  panel:{ background:'#060f1a',border:'1px solid #0a2a3a',borderRadius:10,padding:10 },
  pt:{ color:'#4a8aaa',fontSize:11,marginBottom:6,letterSpacing:1 },
  db:{ width:36,height:36,background:'#0a1929',border:'1px solid #1a3a55',
    borderRadius:6,color:'#00c9ff',fontSize:14,cursor:'pointer',
    fontWeight:700,fontFamily:'inherit' },
}
