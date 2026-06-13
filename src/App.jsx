import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'

// ─── Constants ────────────────────────────────────────────────────────────────
const MW=21, MH=21, LOOT_N=5
const MOVE_SPEED=0.07
const ROT_SPEED=0.045
const FOV=Math.PI/3
const NUM_RAYS=240
const SYNC_MS=120   // push to server every 120ms max

// ─── Characters ───────────────────────────────────────────────────────────────
const CHARACTERS={
  cop:[
    {id:'cap',   emoji:'👮', name:'Capitão Rex',  desc:'Veterano implacável',   color:'#00C9FF',speed:1.0, catchRange:0.9},
    {id:'agent', emoji:'🕵️',name:'Agente Silva', desc:'Mestre da infiltração', color:'#48CAE4',speed:1.2, catchRange:0.75},
    {id:'swat',  emoji:'🪖', name:'SWAT Bravo',   desc:'Força máxima',          color:'#0096C7',speed:0.85,catchRange:1.1},
    {id:'drone', emoji:'🤖', name:'Drone K9',     desc:'Tecnologia de ponta',   color:'#90E0EF',speed:1.3, catchRange:0.8},
  ],
  thief:[
    {id:'fox',   emoji:'🦊', name:'Raposa',   desc:'Ágil e sorrateira',    color:'#FF6B35',speed:1.2, lootRange:0.65},
    {id:'shadow',emoji:'🥷', name:'Shadow',   desc:'Mestre do disfarce',   color:'#F7931E',speed:1.1, lootRange:0.7},
    {id:'hacker',emoji:'👾', name:'Hacker',   desc:'Quebra qualquer cofre',color:'#FFD700',speed:0.9, lootRange:0.9},
    {id:'ghost', emoji:'👻', name:'Fantasma', desc:'Invisível nas sombras', color:'#FF4500',speed:1.0, lootRange:0.75},
  ],
}

// ─── Maze ─────────────────────────────────────────────────────────────────────
function buildMaze(w,h){
  const g=Array.from({length:h},()=>Array(w).fill(1))
  const v=Array.from({length:h},()=>Array(w).fill(false))
  const carve=(x,y)=>{
    v[y][x]=true;g[y][x]=0
    const d=[[0,-2],[0,2],[-2,0],[2,0]].sort(()=>Math.random()-.5)
    for(const[dx,dy]of d){
      const nx=x+dx,ny=y+dy
      if(nx>0&&ny>0&&nx<w-1&&ny<h-1&&!v[ny][nx]){g[y+dy/2][x+dx/2]=0;carve(nx,ny)}
    }
  }
  carve(1,1)
  for(let x=0;x<w;x++){g[0][x]=1;g[h-1][x]=1}
  for(let y=0;y<h;y++){g[y][0]=1;g[y][w-1]=1}
  return g
}
function seedLoot(maze){
  const free=[]
  for(let y=2;y<MH-2;y++) for(let x=2;x<MW-2;x++) if(maze[y][x]===0) free.push({x,y})
  return [...free].sort(()=>Math.random()-.5).slice(0,LOOT_N).map(p=>({...p,collected:false}))
}
function spawnPos(role,idx){
  if(role==='thief') return{x:1.5,y:1.5,angle:0}
  const pts=[{x:MW-1.5,y:1.5},{x:1.5,y:MH-1.5},{x:MW-1.5,y:MH-1.5},{x:MW/2,y:MH/2},{x:4,y:4},{x:MW-4,y:MH-4}]
  return{...pts[idx%pts.length],angle:Math.PI}
}
function emptyState(){
  const maze=buildMaze(MW,MH)
  return{phase:'lobby',maze,loot:seedLoot(maze),players:{},winner:null,chat:[]}
}
function genCode(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ'
  return Array.from({length:4},()=>c[Math.random()*c.length|0]).join('')
}
function isMobile(){
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)||window.innerWidth<768
}

// ─── Supabase ─────────────────────────────────────────────────────────────────
async function roomLoad(code){
  const{data,error}=await supabase.from('rooms').select('state').eq('code',code).single()
  if(error){if(error.code!=='PGRST116')console.error('[load]',error.message);return null}
  return data?.state||null
}
async function roomSave(code,state){
  const{error}=await supabase.from('rooms')
    .upsert({code,state,updated_at:new Date().toISOString()},{onConflict:'code'})
  if(error)throw new Error(`DB(${error.code}):${error.message}`)
}

// ─── Raycaster ────────────────────────────────────────────────────────────────
function raycast(ctx,W,H,maze,px,py,angle,players,loot,myId){
  // Sky / floor
  ctx.fillStyle='#0a0a1a'
  ctx.fillRect(0,0,W,H/2)
  ctx.fillStyle='#12100a'
  ctx.fillRect(0,H/2,W,H/2)

  const zBuf=new Float32Array(W)
  const cw=W/NUM_RAYS

  for(let c=0;c<NUM_RAYS;c++){
    const ra=angle-FOV/2+FOV*(c/NUM_RAYS)
    const dx=Math.cos(ra),dy=Math.sin(ra)
    let mx=Math.floor(px),my=Math.floor(py)
    const sx=dx>0?1:-1,sy=dy>0?1:-1
    const ddx=Math.abs(1/dx),ddy=Math.abs(1/dy)
    let sdx=dx>0?(mx+1-px)*ddx:(px-mx)*ddx
    let sdy=dy>0?(my+1-py)*ddy:(py-my)*ddy
    let side=0,dist=0.01
    for(let i=0;i<48;i++){
      if(sdx<sdy){sdx+=ddx;mx+=sx;side=0}
      else{sdy+=ddy;my+=sy;side=1}
      if(my>=0&&mx>=0&&my<maze.length&&mx<maze[0].length&&maze[my][mx]===1){
        dist=side===0?(mx-px+(1-sx)/2)/dx:(my-py+(1-sy)/2)/dy
        break
      }
    }
    dist=Math.max(0.1,dist)
    zBuf[c]=dist

    const wallH=Math.min(H*2,Math.floor(H/dist))
    const top=(H-wallH)/2
    const bright=Math.min(255,Math.floor(200/dist))
    const r=side?bright*0.5|0:bright*0.6|0
    const g=side?bright*0.35|0:bright*0.45|0
    const b=side?bright*0.7|0:bright*0.85|0
    ctx.fillStyle=`rgb(${r},${g},${b})`
    ctx.fillRect(c*cw,top,cw+1,wallH)
  }

  // Sprites: other players
  for(const p of Object.values(players)){
    if(p.id===myId||p.caught) continue
    drawBillboard(ctx,W,H,zBuf,px,py,angle,p.x,p.y,p.emoji||'👤',p.color||'#fff',32)
  }
  // Loot
  for(const l of loot){
    if(l.collected) continue
    drawBillboard(ctx,W,H,zBuf,px,py,angle,l.x+0.5,l.y+0.5,'💎','#ffd700',22)
  }
}

function drawBillboard(ctx,W,H,zBuf,px,py,angle,sx,sy,emoji,color,size){
  const dx=sx-px,dy=sy-py
  const dist=Math.sqrt(dx*dx+dy*dy)
  if(dist<0.2||dist>14) return
  let da=Math.atan2(dy,dx)-angle
  while(da>Math.PI) da-=Math.PI*2
  while(da<-Math.PI) da+=Math.PI*2
  if(Math.abs(da)>FOV*0.65) return
  const screenX=(0.5+da/FOV)*W
  const sprH=Math.min(H,H/dist)
  const top=(H-sprH)/2
  const cw=W/NUM_RAYS
  const col=Math.floor(screenX/cw)
  if(col<0||col>=NUM_RAYS||zBuf[col]<dist) return
  const fs=Math.max(10,Math.min(size,size/dist*1.5))
  ctx.globalAlpha=Math.min(1,1.5-dist/10)
  ctx.font=`${fs}px serif`
  ctx.textAlign='center'
  ctx.textBaseline='middle'
  ctx.fillText(emoji,screenX,top+sprH*0.45)
  ctx.globalAlpha=1
}

// ─── Character Selector ───────────────────────────────────────────────────────
function CharacterSelector({role,selected,onSelect}){
  const chars=CHARACTERS[role]||[]
  return(
    <div style={{width:'100%',background:'#0a1929',borderRadius:12,padding:12,border:'1px solid #1a3a55'}}>
      <p style={{color:'#7ac8e8',fontSize:11,textAlign:'center',marginBottom:10,letterSpacing:1}}>
        ESCOLHA SEU PERSONAGEM
      </p>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        {chars.map(c=>{
          const sel=selected===c.id
          return(
            <button key={c.id} onClick={()=>onSelect(c.id)} style={{
              background:sel?c.color+'18':'#060f1a',
              border:`2px solid ${sel?c.color:'#1a3a55'}`,
              borderRadius:10,padding:'10px 6px',cursor:'pointer',
              display:'flex',flexDirection:'column',alignItems:'center',gap:3,
              position:'relative',
            }}>
              {sel&&<div style={{position:'absolute',top:4,right:6,color:c.color,fontSize:10,fontWeight:900}}>✓</div>}
              <span style={{fontSize:26}}>{c.emoji}</span>
              <span style={{color:sel?c.color:'#ccc',fontSize:11,fontWeight:700,fontFamily:'inherit'}}>{c.name}</span>
              <span style={{color:'#556',fontSize:10,fontFamily:'inherit',textAlign:'center'}}>{c.desc}</span>
              <div style={{width:'100%',marginTop:4,display:'flex',gap:3}}>
                {[['VEL',c.speed/1.3],['ALC',(c.catchRange||c.lootRange||0.8)/1.1]].map(([lbl,val])=>(
                  <div key={lbl} style={{flex:1}}>
                    <div style={{color:'#334',fontSize:8,marginBottom:1}}>{lbl}</div>
                    <div style={{height:3,background:'#1a3a55',borderRadius:2,overflow:'hidden'}}>
                      <div style={{height:'100%',background:sel?c.color:'#2a4a65',
                        width:`${Math.min(100,val*100)}%`}}/>
                    </div>
                  </div>
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Single Joystick ──────────────────────────────────────────────────────────
// Renders ONE joystick bottom-right. x=rotate, y=move.
// Calls onJoy(dx,dy) every animation frame while touched.
function Joystick({onJoy}){
  const RAD=70
  const baseRef=useRef(null)
  const knobRef=useRef(null)
  const touchId=useRef(null)
  const origin=useRef({x:0,y:0})
  const val=useRef({x:0,y:0})

  useEffect(()=>{
    let raf
    const loop=()=>{
      const{x,y}=val.current
      if(Math.abs(x)>0.04||Math.abs(y)>0.04) onJoy(x,y)
      raf=requestAnimationFrame(loop)
    }
    raf=requestAnimationFrame(loop)
    return()=>cancelAnimationFrame(raf)
  },[onJoy])

  const onStart=e=>{
    e.preventDefault()
    if(touchId.current!==null) return
    const t=e.changedTouches[0]
    touchId.current=t.identifier
    const r=baseRef.current.getBoundingClientRect()
    origin.current={x:r.left+r.width/2,y:r.top+r.height/2}
    val.current={x:0,y:0}
  }
  const onMove=e=>{
    e.preventDefault()
    for(const t of e.changedTouches){
      if(t.identifier!==touchId.current) continue
      const dx=t.clientX-origin.current.x
      const dy=t.clientY-origin.current.y
      const mag=Math.sqrt(dx*dx+dy*dy)||1
      const clamp=Math.min(mag,RAD)
      val.current={x:(dx/mag)*(clamp/RAD),y:(dy/mag)*(clamp/RAD)}
      if(knobRef.current)
        knobRef.current.style.transform=`translate(${val.current.x*RAD}px,${val.current.y*RAD}px)`
    }
  }
  const onEnd=e=>{
    e.preventDefault()
    for(const t of e.changedTouches){
      if(t.identifier===touchId.current){
        touchId.current=null
        val.current={x:0,y:0}
        if(knobRef.current) knobRef.current.style.transform='translate(0,0)'
      }
    }
  }

  return(
    <div style={{
      position:'fixed',bottom:28,right:28,zIndex:200,
      width:RAD*2,height:RAD*2,borderRadius:'50%',
      background:'rgba(0,180,255,0.08)',
      border:'2px solid rgba(0,180,255,0.25)',
      display:'flex',alignItems:'center',justifyContent:'center',
      touchAction:'none',userSelect:'none',
    }}
      ref={baseRef}
      onTouchStart={onStart}
      onTouchMove={onMove}
      onTouchEnd={onEnd}
      onTouchCancel={onEnd}
    >
      {/* Guide lines */}
      <div style={{position:'absolute',top:'50%',left:8,right:8,height:1,background:'rgba(255,255,255,0.08)'}}/>
      <div style={{position:'absolute',left:'50%',top:8,bottom:8,width:1,background:'rgba(255,255,255,0.08)'}}/>
      {/* Knob */}
      <div ref={knobRef} style={{
        width:48,height:48,borderRadius:'50%',
        background:'rgba(0,200,255,0.25)',
        border:'2px solid rgba(0,200,255,0.6)',
        boxShadow:'0 0 16px rgba(0,200,255,0.35)',
        pointerEvents:'none',
        transition:'box-shadow 0.1s',
        willChange:'transform',
      }}/>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [pid]=useState(()=>{
    let id=localStorage.getItem('maze_pid')
    if(!id){id='p'+Math.random().toString(36).slice(2,9);localStorage.setItem('maze_pid',id)}
    return id
  })
  const mobile=isMobile()

  // ── screens & form ──────────────────────────────────────────────────────
  const [screen,setScreen]=useState('home')
  const [roomCode,setRoomCode]=useState('')
  const [joinInput,setJoinInput]=useState('')
  const [nameInput,setNameInput]=useState('')
  const [roleChoice,setRoleChoice]=useState('thief')
  const [charChoice,setCharChoice]=useState('fox')
  const [msg,setMsg]=useState('')
  const [chatInput,setChatInput]=useState('')
  const [loader,setLoader]=useState(null)
  const [online,setOnline]=useState(0)

  // ── game state lives in a ref for zero-latency movement ─────────────────
  const gsRef=useRef(null)
  const [gsDisplay,setGsDisplay]=useState(null) // for React render
  const setGs=useCallback(s=>{ gsRef.current=s; setGsDisplay(s) },[])

  const channelRef=useRef(null)
  const canvasRef=useRef(null)
  const rafRef=useRef(null)
  const keysRef=useRef({})
  const syncTimerRef=useRef(null)
  const codeRef=useRef('')   // always-fresh roomCode for callbacks

  useEffect(()=>{ codeRef.current=roomCode },[roomCode])

  // ── Presence counter ─────────────────────────────────────────────────────
  useEffect(()=>{
    const ch=supabase.channel('online',{config:{presence:{key:pid}}})
    ch.on('presence',{event:'sync'},()=>setOnline(Object.keys(ch.presenceState()).length))
    ch.subscribe(async s=>{if(s==='SUBSCRIBED') await ch.track({pid})})
    return()=>supabase.removeChannel(ch)
  },[pid])

  // ── Collision helper ─────────────────────────────────────────────────────
  const canWalk=(maze,x,y)=>{
    const pad=0.3
    for(const[ox,oy] of[[-pad,-pad],[pad,-pad],[-pad,pad],[pad,pad]]){
      const gx=Math.floor(x+ox),gy=Math.floor(y+oy)
      if(gy<0||gx<0||gy>=maze.length||gx>=maze[0].length||maze[gy][gx]===1) return false
    }
    return true
  }

  // ── Server sync (throttled) ───────────────────────────────────────────────
  const scheduleSync=useCallback(()=>{
    if(syncTimerRef.current) return
    syncTimerRef.current=setTimeout(async()=>{
      syncTimerRef.current=null
      const s=gsRef.current
      if(s) try{ await roomSave(codeRef.current,s) }catch(_){}
    },SYNC_MS)
  },[])

  // ── Core movement — runs purely on local state, never awaits ─────────────
  const applyMove=useCallback((fwd,rot)=>{
    const s=gsRef.current
    if(!s||s.phase!=='playing') return
    const me=s.players[pid]
    if(!me||me.caught) return

    const spd=(me.speed||1)*MOVE_SPEED
    const newAngle=me.angle+(rot*ROT_SPEED)
    const nx=me.x+Math.cos(newAngle)*fwd*spd
    const ny=me.y+Math.sin(newAngle)*fwd*spd

    const maze=s.maze
    const fnx=canWalk(maze,nx,me.y)?nx:me.x
    const fny=canWalk(maze,me.x,ny)?ny:me.y

    // Build new state without any spread of huge maze object
    const newPlayers={...s.players}
    newPlayers[pid]={...me,x:fnx,y:fny,angle:newAngle}

    // Loot collect
    let newLoot=s.loot
    if(me.role==='thief'){
      let changed=false
      newLoot=s.loot.map(l=>{
        if(l.collected) return l
        const dx=fnx-(l.x+0.5),dy=fny-(l.y+0.5)
        if(dx*dx+dy*dy<(me.lootRange||0.7)**2){
          newPlayers[pid]={...newPlayers[pid],loot:(newPlayers[pid].loot||0)+1}
          changed=true
          return{...l,collected:true}
        }
        return l
      })
    }

    // Catch
    if(me.role==='cop'){
      Object.keys(newPlayers).forEach(k=>{
        const p=newPlayers[k]
        if(p.role==='thief'&&!p.caught){
          const dx=fnx-p.x,dy=fny-p.y
          if(dx*dx+dy*dy<(me.catchRange||0.85)**2) newPlayers[k]={...p,caught:true}
        }
      })
    }

    let phase=s.phase,winner=s.winner
    const ths=Object.values(newPlayers).filter(p=>p.role==='thief')
    if(ths.every(p=>p.caught)){phase='gameover';winner='cops'}
    else if(newLoot.every(l=>l.collected)){phase='gameover';winner='thieves'}

    const ns={...s,players:newPlayers,loot:newLoot,phase,winner}
    gsRef.current=ns
    setGsDisplay({...ns})
    scheduleSync()

    if(phase==='gameover') setScreen('over')
  },[pid,scheduleSync])

  // ── Keyboard loop ────────────────────────────────────────────────────────
  useEffect(()=>{
    if(screen!=='game') return
    const onDown=e=>{ keysRef.current[e.key]=true; e.preventDefault() }
    const onUp=e=>{ keysRef.current[e.key]=false }
    window.addEventListener('keydown',onDown,{passive:false})
    window.addEventListener('keyup',onUp)

    const iv=setInterval(()=>{
      const k=keysRef.current
      let fwd=0,rot=0
      if(k['ArrowUp']||k['w']||k['W']) fwd=1
      if(k['ArrowDown']||k['s']||k['S']) fwd=-1
      if(k['ArrowLeft']||k['a']||k['A']) rot=-1
      if(k['ArrowRight']||k['d']||k['D']) rot=1
      if(fwd||rot) applyMove(fwd,rot)
    },33)

    return()=>{
      window.removeEventListener('keydown',onDown)
      window.removeEventListener('keyup',onUp)
      clearInterval(iv)
    }
  },[screen,applyMove])

  // ── Joystick handler ─────────────────────────────────────────────────────
  const handleJoy=useCallback((jx,jy)=>{
    // jy: -1=up/forward, +1=down/back  jx: -1=left, +1=right
    applyMove(-jy, jx)
  },[applyMove])

  // ── 3D Render loop ────────────────────────────────────────────────────────
  useEffect(()=>{
    if(screen!=='game') return
    const canvas=canvasRef.current
    if(!canvas) return
    const ctx=canvas.getContext('2d',{alpha:false})

    const render=()=>{
      const s=gsRef.current
      const me=s?.players?.[pid]
      if(!s||!me||!s.maze) { rafRef.current=requestAnimationFrame(render); return }

      const W=canvas.width,H=canvas.height
      raycast(ctx,W,H,s.maze,me.x,me.y,me.angle,s.players,s.loot,pid)
      rafRef.current=requestAnimationFrame(render)
    }
    rafRef.current=requestAnimationFrame(render)
    return()=>{ if(rafRef.current) cancelAnimationFrame(rafRef.current) }
  },[screen,pid])

  // ── Realtime subscribe ───────────────────────────────────────────────────
  const subscribe=useCallback((code)=>{
    if(channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current=supabase.channel('room-'+code)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'rooms',filter:`code=eq.${code}`},
        payload=>{
          const s=payload.new?.state
          if(!s) return
          // Merge: keep MY local position, take everything else from server
          const cur=gsRef.current
          if(cur?.players?.[pid]&&s.players?.[pid]){
            s.players[pid]={...s.players[pid],
              x:cur.players[pid].x,y:cur.players[pid].y,angle:cur.players[pid].angle}
          }
          gsRef.current=s
          setGsDisplay({...s})
          if(s.phase==='lobby') setScreen('lobby')
          else if(s.phase==='playing') setScreen('game')
          else if(s.phase==='gameover') setScreen('over')
        })
      .subscribe()
  },[pid])

  const unsubscribe=useCallback(()=>{
    if(channelRef.current){supabase.removeChannel(channelRef.current);channelRef.current=null}
  },[])

  // ── Room actions ─────────────────────────────────────────────────────────
  const load=useCallback(async(pct,label,fn)=>{
    setLoader({pct,label})
    try{ const r=await fn(); setLoader(null); return r }
    catch(e){ setLoader(null); throw e }
  },[])

  const createRoom=useCallback(async()=>{
    const code=genCode()
    const state=emptyState()
    setMsg('')
    try{
      setLoader({pct:40,label:'Gerando labirinto...'})
      await new Promise(r=>setTimeout(r,200))
      setLoader({pct:80,label:'Criando sala...'})
      await roomSave(code,state)
      setLoader({pct:100,label:'Pronto!'})
      await new Promise(r=>setTimeout(r,300))
      setLoader(null)
      setRoomCode(code);codeRef.current=code
      setGs(state)
      subscribe(code);setScreen('join')
    }catch(e){setLoader(null);setMsg('❌ '+e.message)}
  },[subscribe,setGs])

  const joinByCode=useCallback(async()=>{
    const code=joinInput.trim().toUpperCase()
    if(code.length!==4){setMsg('⚠️ Código tem 4 letras!');return}
    setMsg('')
    try{
      setLoader({pct:50,label:'Conectando...'})
      const s=await roomLoad(code)
      if(!s){setLoader(null);setMsg('❌ Sala "'+code+'" não encontrada.');return}
      setLoader({pct:100,label:'Entrou!'})
      await new Promise(r=>setTimeout(r,300))
      setLoader(null)
      setRoomCode(code);codeRef.current=code
      setGs(s);subscribe(code);setScreen('join')
    }catch(e){setLoader(null);setMsg('❌ '+e.message)}
  },[joinInput,subscribe,setGs])

  const enterRoom=useCallback(async()=>{
    const name=nameInput.trim()
    if(!name){setMsg('⚠️ Digite seu nome!');return}
    setMsg('')
    try{
      setLoader({pct:50,label:'Entrando...'})
      let s=await roomLoad(codeRef.current)
      if(!s){setLoader(null);setMsg('❌ Sala não encontrada.');return}
      if(s.phase!=='lobby'){setLoader(null);setMsg('❌ Partida em andamento!');return}
      if(s.players[pid]){setGs(s);setScreen('lobby');setLoader(null);return}
      const nt=Object.values(s.players).filter(p=>p.role==='thief').length
      if(roleChoice==='thief'&&nt>=4){setLoader(null);setMsg('⚠️ Máx 4 ladrões!');return}
      const ri=Object.values(s.players).filter(p=>p.role===roleChoice).length
      const charDef=CHARACTERS[roleChoice].find(c=>c.id===charChoice)||CHARACTERS[roleChoice][0]
      const pos=spawnPos(roleChoice,roleChoice==='thief'?nt:ri)
      s.players[pid]={id:pid,name,...pos,role:roleChoice,caught:false,loot:0,
        color:charDef.color,emoji:charDef.emoji,char:charDef.id,
        speed:charDef.speed,catchRange:charDef.catchRange,lootRange:charDef.lootRange}
      await roomSave(codeRef.current,s)
      setLoader(null);setGs(s);setMsg('');setScreen('lobby')
    }catch(e){setLoader(null);setMsg('❌ '+e.message)}
  },[nameInput,roleChoice,charChoice,pid,setGs])

  const changeRole=useCallback(async(nr)=>{
    try{
      let s=await roomLoad(codeRef.current)
      if(!s||!s.players[pid]||s.players[pid].role===nr) return
      const nt=Object.values(s.players).filter(p=>p.role==='thief').length
      if(nr==='thief'&&nt>=4){setMsg('⚠️ Máx 4 ladrões!');return}
      const ri=Object.values(s.players).filter(p=>p.role===nr&&p.id!==pid).length
      const ntNew=Object.values(s.players).filter(p=>p.role==='thief'&&p.id!==pid).length
      const charDef=CHARACTERS[nr][0]
      const pos=spawnPos(nr,nr==='thief'?ntNew:ri)
      s.players[pid]={...s.players[pid],role:nr,...pos,
        color:charDef.color,emoji:charDef.emoji,char:charDef.id,
        speed:charDef.speed,catchRange:charDef.catchRange,lootRange:charDef.lootRange}
      await roomSave(codeRef.current,s);setGs(s);setMsg('')
    }catch(e){setMsg('❌ '+e.message)}
  },[pid,setGs])

  const startGame=useCallback(async()=>{
    try{
      setLoader({pct:30,label:'Gerando labirinto 3D...'})
      const maze=buildMaze(MW,MH)
      const loot=seedLoot(maze)
      await new Promise(r=>setTimeout(r,300))
      setLoader({pct:70,label:'Posicionando jogadores...'})
      let s=await roomLoad(codeRef.current); if(!s) return
      const all=Object.values(s.players)
      if(!all.some(p=>p.role==='cop')){setLoader(null);setMsg('⚠️ Precisa de 1 policial!');return}
      if(!all.some(p=>p.role==='thief')){setLoader(null);setMsg('⚠️ Precisa de 1 ladrão!');return}
      s.maze=maze;s.loot=loot;s.winner=null
      let ci=0,ti=0
      Object.keys(s.players).forEach(k=>{
        const p=s.players[k]
        const pos=spawnPos(p.role,p.role==='thief'?ti++:ci++)
        s.players[k]={...p,...pos,caught:false,loot:0}
      })
      s.phase='playing'
      setLoader({pct:100,label:'Entrando!'})
      await roomSave(codeRef.current,s)
      await new Promise(r=>setTimeout(r,300))
      setLoader(null);setGs(s);setMsg('')
    }catch(e){setLoader(null);setMsg('❌ '+e.message)}
  },[setGs])

  const sendChat=useCallback(async()=>{
    if(!chatInput.trim()) return
    try{
      let s=await roomLoad(codeRef.current)
      const me=s?.players[pid]; if(!me) return
      if(!s.chat) s.chat=[]
      s.chat=[...s.chat.slice(-19),{name:me.name,role:me.role,msg:chatInput.trim()}]
      await roomSave(codeRef.current,s);setGs(s);setChatInput('')
    }catch(_){}
  },[chatInput,pid,setGs])

  const goHome=useCallback(()=>{
    unsubscribe()
    if(syncTimerRef.current){clearTimeout(syncTimerRef.current);syncTimerRef.current=null}
    setScreen('home');setGs(null)
    setRoomCode('');codeRef.current='';setJoinInput('');setMsg('')
  },[unsubscribe,setGs])

  // ── Canvas size ──────────────────────────────────────────────────────────
  useEffect(()=>{
    if(screen!=='game'||!canvasRef.current) return
    const set=()=>{
      canvasRef.current.width=window.innerWidth
      canvasRef.current.height=window.innerHeight
    }
    set()
    window.addEventListener('resize',set)
    return()=>window.removeEventListener('resize',set)
  },[screen])

  // ── Derived ──────────────────────────────────────────────────────────────
  const gs=gsDisplay
  const me=gs?.players?.[pid]
  const players=gs?Object.values(gs.players):[]
  const cops=players.filter(p=>p.role==='cop')
  const thieves=players.filter(p=>p.role==='thief')

  // ── Preloader ────────────────────────────────────────────────────────────
  const Loader=()=>loader?(
    <div style={{position:'fixed',inset:0,background:'rgba(2,8,14,0.95)',
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
      zIndex:9999,gap:16,fontFamily:"'Courier New',monospace"}}>
      <div style={{fontSize:48}}>🏛️</div>
      <p style={{color:'#7ac8e8',fontSize:14,letterSpacing:2}}>{loader.label}</p>
      <div style={{width:260,height:10,background:'#0a1929',borderRadius:8,overflow:'hidden'}}>
        <div style={{height:'100%',borderRadius:8,
          background:'linear-gradient(90deg,#0096c7,#00c9ff)',
          width:`${loader.pct}%`,transition:'width 0.3s',
          boxShadow:'0 0 10px #00c9ff88'}}/>
      </div>
      <p style={{color:'#00c9ff',fontWeight:900,fontSize:22}}>{loader.pct}%</p>
    </div>
  ):null

  // ════════════════════════════════════════════════════
  // HOME
  // ════════════════════════════════════════════════════
  if(screen==='home') return(
    <div style={S.root}>
      <Loader/>
      <div style={S.card}>
        <div style={{fontSize:52}}>🏛️</div>
        <h1 style={S.title}>MAZE CHASE</h1>
        <p style={S.sub}>3D · Primeira Pessoa · Online</p>
        <div style={{...S.sbar,...S.sok,width:'100%',textAlign:'center'}}>
          🌐 {online} jogador{online!==1?'es':''} online
        </div>
        <button style={S.btnP} onClick={createRoom}>✅ CRIAR NOVA SALA</button>
        <div style={S.divider}/>
        <div style={{display:'flex',gap:8,width:'100%'}}>
          <input style={{...S.inp,flex:1,textTransform:'uppercase',
            letterSpacing:6,fontSize:18,textAlign:'center'}}
            placeholder='CÓDIGO' maxLength={4} value={joinInput}
            onChange={e=>setJoinInput(e.target.value.toUpperCase())}
            onKeyDown={e=>e.key==='Enter'&&joinByCode()}/>
          <button style={{...S.btnP,width:'auto',padding:'0 16px',
            letterSpacing:0,fontSize:13}} onClick={joinByCode}>ENTRAR</button>
        </div>
        {msg&&<p style={S.msgT}>{msg}</p>}
        <div style={{width:'100%',background:'#0a1929',borderRadius:10,
          padding:12,border:'1px solid #1a3a55',fontSize:12,
          color:'#4a8aaa',lineHeight:1.7,fontFamily:"'Courier New',monospace"}}>
          <strong style={{color:'#7ac8e8'}}>🦹 Ladrão:</strong> Colete 5 💎 diamantes<br/>
          <strong style={{color:'#7ac8e8'}}>👮 Policial:</strong> Encurrale o ladrão
        </div>
      </div>
    </div>
  )

  // ════════════════════════════════════════════════════
  // JOIN
  // ════════════════════════════════════════════════════
  if(screen==='join') return(
    <div style={S.root}>
      <Loader/>
      <div style={S.card}>
        <h2 style={{...S.title,fontSize:20}}>🏛️ MAZE CHASE</h2>
        <div style={{...S.sbar,...S.sok,width:'100%',textAlign:'center'}}>
          🟢 Sala: <strong style={{letterSpacing:4}}>{roomCode}</strong>
        </div>
        <input style={S.inp} placeholder='Seu nome...' maxLength={16} value={nameInput}
          onChange={e=>setNameInput(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&enterRoom()}/>
        <div style={S.rolePicker}>
          <p style={{color:'#7ac8e8',fontSize:12,textAlign:'center',marginBottom:8}}>PAPEL:</p>
          <div style={{display:'flex',gap:8}}>
            {['thief','cop'].map(r=>(
              <button key={r} onClick={()=>{setRoleChoice(r);setCharChoice(CHARACTERS[r][0].id)}}
                style={{
                  flex:1,padding:'10px 4px',borderRadius:10,cursor:'pointer',
                  display:'flex',flexDirection:'column',alignItems:'center',gap:3,
                  fontFamily:'inherit',fontSize:13,fontWeight:700,
                  background:roleChoice===r?(r==='thief'?'#FF6B3520':'#00C9FF20'):'#060f1a',
                  border:`2px solid ${roleChoice===r?(r==='thief'?'#FF6B35':'#00C9FF'):'#1a3a55'}`,
                  color:roleChoice===r?(r==='thief'?'#FF6B35':'#00C9FF'):'#556',
                }}>
                <span style={{fontSize:26}}>{r==='thief'?'🦹':'👮'}</span>
                <span>{r==='thief'?'Ladrão':'Policial'}</span>
              </button>
            ))}
          </div>
        </div>
        <CharacterSelector role={roleChoice} selected={charChoice} onSelect={setCharChoice}/>
        {players.length>0&&(
          <div style={{width:'100%',textAlign:'center'}}>
            <p style={{color:'#4a8aaa',fontSize:11,marginBottom:4}}>Na sala:</p>
            {players.map(p=>(
              <span key={p.id} style={{...S.badge,background:p.color,color:'#000'}}>
                {p.emoji||'👤'} {p.name}
              </span>
            ))}
          </div>
        )}
        {msg&&<p style={S.msgT}>{msg}</p>}
        <button style={S.btnP} onClick={enterRoom}>CONFIRMAR ENTRADA</button>
        <button style={S.btnG} onClick={goHome}>← Voltar</button>
      </div>
    </div>
  )

  // ════════════════════════════════════════════════════
  // LOBBY
  // ════════════════════════════════════════════════════
  if(screen==='lobby') return(
    <div style={S.root}>
      <Loader/>
      <div style={{...S.card,width:Math.min(460,window.innerWidth-24)}}>
        <h2 style={{...S.title,fontSize:20}}>
          Sala <span style={{color:'#00c9ff',letterSpacing:4}}>{roomCode}</span>
        </h2>
        <p style={{color:'#4a8aaa',fontSize:11}}>
          Envie <strong style={{color:'#00c9ff'}}>{roomCode}</strong> para o outro jogador
        </p>
        <div style={{display:'flex',gap:10,width:'100%'}}>
          {[['cop','#00C9FF','👮 POLICIAIS',cops],['thief','#FF6B35','🦹 LADRÕES',thieves]].map(([role,color,label,list])=>(
            <div key={role} style={S.teamBox}>
              <p style={{color,fontWeight:700,fontSize:12,marginBottom:8}}>{label}</p>
              {list.length===0&&<p style={{color:'#333',fontSize:11}}>Aguardando...</p>}
              {list.map(p=>(
                <div key={p.id} style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                  <span style={{fontSize:20}}>{p.emoji||'👤'}</span>
                  <div>
                    <span style={{color:p.color,fontSize:12,fontWeight:700}}>{p.name}</span>
                    {p.id===pid&&<span style={{color:'#444',fontSize:10}}> (você)</span>}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        {me&&(
          <div style={S.myCtrl}>
            <p style={{color:'#7ac8e8',fontSize:11,marginBottom:6}}>
              Você: <strong style={{color:me.color}}>{me.emoji} {me.name}</strong>
            </p>
            <div style={{display:'flex',gap:8}}>
              {['thief','cop'].map(r=>(
                <button key={r} onClick={()=>changeRole(r)} style={{
                  flex:1,padding:'6px',borderRadius:8,cursor:'pointer',
                  fontFamily:'inherit',fontSize:12,fontWeight:700,
                  background:me.role===r?(r==='thief'?'#FF6B3520':'#00C9FF20'):'#060f1a',
                  border:`2px solid ${me.role===r?(r==='thief'?'#FF6B35':'#00C9FF'):'#1a3a55'}`,
                  color:me.role===r?(r==='thief'?'#FF6B35':'#00C9FF'):'#445',
                }}>{r==='thief'?'🦹 Ladrão':'👮 Policial'}</button>
              ))}
            </div>
          </div>
        )}
        {msg&&<p style={S.msgT}>{msg}</p>}
        <button style={S.btnP} onClick={startGame}>▶ INICIAR PARTIDA</button>
        <p style={{color:'#333',fontSize:11}}>Qualquer jogador pode iniciar.</p>
        <button style={S.btnG} onClick={goHome}>← Sair</button>
      </div>
    </div>
  )

  // ════════════════════════════════════════════════════
  // GAME — fullscreen 3D
  // ════════════════════════════════════════════════════
  if(screen==='game'&&me) return(
    <div style={{position:'fixed',inset:0,background:'#000',overflow:'hidden',
      fontFamily:"'Courier New',monospace"}}>
      <Loader/>

      {/* 3D canvas — fills screen */}
      <canvas ref={canvasRef} style={{display:'block',position:'absolute',inset:0,
        width:'100%',height:'100%'}}/>

      {/* Crosshair */}
      <div style={{position:'absolute',top:'50%',left:'50%',
        transform:'translate(-50%,-50%)',pointerEvents:'none'}}>
        <div style={{position:'absolute',top:-1,left:-10,right:-10,height:2,
          background:'rgba(255,255,255,0.5)'}}/>
        <div style={{position:'absolute',left:-1,top:-10,bottom:-10,width:2,
          background:'rgba(255,255,255,0.5)'}}/>
      </div>

      {/* Minimap */}
      <canvas style={{position:'absolute',top:8,left:8,
        border:'1px solid rgba(255,255,255,0.15)',borderRadius:4,opacity:0.85}}
        ref={mm=>{
          if(!mm||!gs?.maze) return
          const S=Math.min(110,window.innerWidth*0.22)
          mm.width=S;mm.height=S
          const sc=S/Math.max(MW,MH)
          const ctx=mm.getContext('2d')
          ctx.fillStyle='rgba(0,0,0,0.75)'
          ctx.fillRect(0,0,S,S)
          for(let y=0;y<MH;y++) for(let x=0;x<MW;x++){
            ctx.fillStyle=gs.maze[y][x]===1?'#1a3a55':'#0d2137'
            ctx.fillRect(x*sc,y*sc,sc,sc)
          }
          gs.loot.forEach(l=>{
            if(l.collected) return
            ctx.fillStyle='#ffd700'
            ctx.fillRect((l.x+0.35)*sc,(l.y+0.35)*sc,sc*0.3,sc*0.3)
          })
          Object.values(gs.players).forEach(p=>{
            if(p.caught) return
            ctx.fillStyle=p.color||'#fff'
            ctx.beginPath();ctx.arc(p.x*sc,p.y*sc,p.id===pid?3:2,0,Math.PI*2);ctx.fill()
            if(p.id===pid){
              ctx.strokeStyle='#fff';ctx.lineWidth=0.5
              ctx.beginPath();ctx.moveTo(p.x*sc,p.y*sc)
              ctx.lineTo((p.x+Math.cos(p.angle)*2)*sc,(p.y+Math.sin(p.angle)*2)*sc);ctx.stroke()
            }
          })
        }}/>

      {/* HUD top */}
      <div style={{position:'absolute',top:0,left:0,right:0,
        display:'flex',justifyContent:'space-between',alignItems:'center',
        padding:'8px 14px',
        background:'linear-gradient(to bottom,rgba(0,0,0,0.75),transparent)',
        pointerEvents:'none'}}>
        <span style={{color:me.color,fontWeight:700,fontSize:14}}>
          {me.emoji} {me.name}
        </span>
        <div style={{display:'flex',gap:12,alignItems:'center'}}>
          {me.role==='thief'&&(
            <span style={{color:'#ffd700',fontWeight:700,fontSize:15}}>
              💎 {me.loot||0}/{LOOT_N}
            </span>
          )}
          {me.caught&&(
            <span style={{background:'#f00',color:'#fff',padding:'2px 8px',
              borderRadius:6,fontSize:12,fontWeight:700}}>🔒 PRESO</span>
          )}
        </div>
      </div>

      {/* Chat */}
      <div style={{position:'absolute',bottom:mobile?180:12,left:10,width:190,pointerEvents:'auto'}}>
        <div style={{maxHeight:70,overflowY:'auto',background:'rgba(0,0,0,0.55)',
          borderRadius:6,padding:'4px 6px',marginBottom:4}}>
          {(gs.chat||[]).slice(-5).map((c,i)=>(
            <div key={i} style={{fontSize:10,marginBottom:1}}>
              <span style={{color:c.role==='thief'?'#FF6B35':'#00C9FF',fontWeight:700}}>{c.name}: </span>
              <span style={{color:'#ddd'}}>{c.msg}</span>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:3}}>
          <input style={{...S.inp,fontSize:11,padding:'3px 6px',flex:1,
            background:'rgba(6,15,26,0.85)'}}
            placeholder='Chat...' value={chatInput}
            onChange={e=>setChatInput(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&sendChat()}/>
          <button style={{...S.btnP,padding:'3px 8px',width:'auto',fontSize:11,
            letterSpacing:0}} onClick={sendChat}>➤</button>
        </div>
      </div>

      {/* Caught overlay */}
      {me.caught&&(
        <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.75)',
          display:'flex',flexDirection:'column',alignItems:'center',
          justifyContent:'center',pointerEvents:'none'}}>
          <div style={{fontSize:56}}>🔒</div>
          <p style={{color:'#f55',fontWeight:900,fontSize:22}}>VOCÊ FOI PRESO</p>
          <p style={{color:'#888',fontSize:13}}>Aguarde o fim da partida...</p>
        </div>
      )}

      {/* Single joystick — mobile only, bottom right */}
      {mobile&&<Joystick onJoy={handleJoy}/>}

      {/* Exit */}
      <button onClick={goHome} style={{
        position:'absolute',top:8,right:8,
        background:'rgba(0,0,0,0.55)',border:'1px solid rgba(255,255,255,0.15)',
        color:'#aaa',borderRadius:8,padding:'4px 12px',fontSize:12,cursor:'pointer'}}>
        ✕
      </button>
    </div>
  )

  // ════════════════════════════════════════════════════
  // GAME OVER
  // ════════════════════════════════════════════════════
  if(screen==='over'){
    const won=(gs?.winner==='cops'&&me?.role==='cop')||(gs?.winner==='thieves'&&me?.role==='thief')
    return(
      <div style={S.root}>
        <div style={S.card}>
          <div style={{fontSize:64}}>{gs?.winner==='cops'?'👮':'🦹'}</div>
          <h2 style={{...S.title,fontSize:22,
            color:gs?.winner==='cops'?'#00C9FF':'#FF6B35'}}>
            {gs?.winner==='cops'?'POLÍCIA VENCEU!':'LADRÕES ESCAPARAM!'}
          </h2>
          <p style={{fontSize:17,color:won?'#FFD700':'#888',margin:'4px 0 12px'}}>
            {won?'🏆 Você venceu!':'😔 Sua equipe perdeu.'}
          </p>
          {thieves.map(p=>(
            <p key={p.id} style={{color:p.color,fontSize:14,marginBottom:4}}>
              {p.emoji} {p.name}: {p.loot||0} 💎 — {p.caught?'PRESO 🔒':'Livre ✅'}
            </p>
          ))}
          <button style={{...S.btnP,marginTop:16}} onClick={goHome}>🔄 NOVA PARTIDA</button>
        </div>
      </div>
    )
  }

  return<div style={S.root}><p style={{color:'#aaa'}}>⏳ Carregando...</p></div>
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S={
  root:{minHeight:'100vh',background:'radial-gradient(ellipse at top,#071829,#020c14)',
    display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',
    fontFamily:"'Courier New',monospace",color:'#e0f0ff',padding:12,overscrollBehavior:'none'},
  card:{background:'#060f1a',border:'1px solid #0a2a3a',borderRadius:16,padding:24,
    width:Math.min(360,window.innerWidth-24),display:'flex',flexDirection:'column',
    alignItems:'center',gap:12,boxShadow:'0 0 60px #001a2a'},
  title:{fontSize:26,fontWeight:900,letterSpacing:4,color:'#e0f4ff',
    margin:'4px 0',textShadow:'0 0 20px #00aaff33'},
  sub:{color:'#4a8aaa',fontSize:13,margin:0},
  inp:{width:'100%',background:'#0a1929',border:'1px solid #1a3a55',borderRadius:8,
    color:'#e0f4ff',padding:'10px 14px',fontSize:15,outline:'none',
    fontFamily:'inherit',boxSizing:'border-box'},
  btnP:{width:'100%',padding:'12px 0',background:'linear-gradient(90deg,#0096c7,#00c9ff)',
    border:'none',borderRadius:8,color:'#001a2a',fontWeight:900,fontSize:14,
    letterSpacing:2,cursor:'pointer',fontFamily:'inherit'},
  btnG:{width:'100%',padding:'8px 0',background:'transparent',border:'1px solid #1a3a55',
    borderRadius:8,color:'#4a8aaa',fontSize:13,cursor:'pointer',fontFamily:'inherit'},
  msgT:{color:'#ffcc44',fontSize:13,margin:0,textAlign:'center'},
  badge:{display:'inline-block',borderRadius:20,padding:'3px 10px',
    fontSize:12,fontWeight:700,margin:'2px 3px'},
  sbar:{fontSize:12,padding:'5px 14px',borderRadius:20,border:'1px solid transparent'},
  sok:{background:'#003322',color:'#00cc88',borderColor:'#00cc8844'},
  rolePicker:{width:'100%',background:'#0a1929',borderRadius:10,padding:12,border:'1px solid #1a3a55'},
  teamBox:{flex:1,background:'#0a1929',borderRadius:10,padding:10},
  myCtrl:{width:'100%',background:'#0a1929',borderRadius:10,padding:10,border:'1px solid #1a3a55'},
  divider:{width:'100%',height:1,background:'#1a3a55',margin:'4px 0'},
}
