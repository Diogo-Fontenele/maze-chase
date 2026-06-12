import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'

// ─── Constants ────────────────────────────────────────────────────────────────
const MW=21, MH=21, LOOT_N=5
const CC=['#00C9FF','#48CAE4','#90E0EF','#0096C7','#00B4D8','#0077B6']
const TC=['#FF6B35','#F7931E','#FFD700','#FF4500']
const EM={cop:'👮',thief:'🦹'}

// ─── Characters ───────────────────────────────────────────────────────────────
const CHARACTERS = {
  cop: [
    { id:'cap',   emoji:'👮',  name:'Capitão Rex',  desc:'Veterano implacável',   color:'#00C9FF', speed:1.0,  catchRange:0.9  },
    { id:'agent', emoji:'🕵️', name:'Agente Silva', desc:'Mestre da infiltração', color:'#48CAE4', speed:1.15, catchRange:0.75 },
    { id:'swat',  emoji:'🪖',  name:'SWAT Bravo',   desc:'Força máxima',          color:'#0096C7', speed:0.85, catchRange:1.1  },
    { id:'drone', emoji:'🤖',  name:'Drone K9',     desc:'Tecnologia de ponta',   color:'#90E0EF', speed:1.2,  catchRange:0.8  },
  ],
  thief: [
    { id:'fox',    emoji:'🦊', name:'Raposa',   desc:'Ágil e sorrateira',    color:'#FF6B35', speed:1.2,  lootRange:0.65 },
    { id:'shadow', emoji:'🥷', name:'Shadow',   desc:'Mestre do disfarce',   color:'#F7931E', speed:1.1,  lootRange:0.7  },
    { id:'hacker', emoji:'👾', name:'Hacker',   desc:'Quebra qualquer cofre',color:'#FFD700', speed:0.9,  lootRange:0.9  },
    { id:'ghost',  emoji:'👻', name:'Fantasma', desc:'Invisível nas sombras', color:'#FF4500', speed:1.0,  lootRange:0.75 },
  ],
}
const CELL=1.0 // world units per cell
const MOVE_SPEED=0.055
const ROT_SPEED=0.038
const FOV=Math.PI/3
const NUM_RAYS=320

// ─── Maze ─────────────────────────────────────────────────────────────────────
function buildMaze(w,h){
  const g=Array.from({length:h},()=>Array(w).fill(1))
  const v=Array.from({length:h},()=>Array(w).fill(false))
  const dirs=[[0,-2],[0,2],[-2,0],[2,0]]
  const carve=(x,y)=>{
    v[y][x]=true;g[y][x]=0
    const sd=[...dirs].sort(()=>Math.random()-.5)
    for(const[dx,dy]of sd){
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
function startPos(role,idx){
  if(role==='thief') return{x:1.5,y:1.5,angle:0.5}
  const corners=[{x:MW-1.5,y:1.5},{x:1.5,y:MH-1.5},{x:MW-1.5,y:MH-1.5},
    {x:MW/2,y:MH/2},{x:4,y:4},{x:MW-4,y:MH-4}]
  return{...corners[idx%corners.length],angle:Math.PI}
}
function emptyState(){
  const maze=buildMaze(MW,MH)
  return{phase:'lobby',maze,loot:seedLoot(maze),players:{},winner:null,chat:[]}
}
function genCode(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ'
  return Array.from({length:4},()=>c[Math.random()*c.length|0]).join('')
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
  if(error) throw new Error(`DB(${error.code}):${error.message}`)
  return true
}

// ─── Detect mobile ─────────────────────────────────────────────────────────────
function isMobile(){
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)||window.innerWidth<600
}

// ═══════════════════════════════════════════════════════
//  RAYCASTER ENGINE
// ═══════════════════════════════════════════════════════
class Raycaster{
  constructor(canvas,maze){
    this.canvas=canvas
    this.ctx=canvas.getContext('2d')
    this.maze=maze
    this.W=canvas.width
    this.H=canvas.height
  }
  cast(px,py,angle){
    const{W,H,maze,ctx}=this
    ctx.fillStyle='#0a0a1a'
    ctx.fillRect(0,0,W,H)
    // Floor
    ctx.fillStyle='#1a1208'
    ctx.fillRect(0,H/2,W,H/2)
    const zBuf=new Float32Array(W)
    for(let col=0;col<NUM_RAYS;col++){
      const rayAngle=angle-FOV/2+FOV*(col/NUM_RAYS)
      const[dist,side,tx]=this._castRay(px,py,rayAngle,maze)
      const screenW=Math.floor(W/NUM_RAYS)
      const wallH=Math.min(H,Math.floor(H/dist))
      const top=Math.floor((H-wallH)/2)
      // Wall shading
      let shade=Math.floor(255/dist)*1.5
      shade=Math.min(255,Math.max(30,shade))
      const r=side===0?shade:shade*0.75|0
      const g=side===0?shade*0.6|0:shade*0.45|0
      const b=side===0?shade*0.9|0:shade*0.7|0
      ctx.fillStyle=`rgb(${r},${g},${b})`
      ctx.fillRect(col*(W/NUM_RAYS),top,screenW+1,wallH)
      zBuf[col]=dist
    }
    return zBuf
  }
  _castRay(px,py,angle,maze){
    const dx=Math.cos(angle),dy=Math.sin(angle)
    let mx=Math.floor(px),my=Math.floor(py)
    const stepX=dx>0?1:-1,stepY=dy>0?1:-1
    const ddx=Math.abs(1/dx),ddy=Math.abs(1/dy)
    let sdx=dx>0?(mx+1-px)*ddx:(px-mx)*ddx
    let sdy=dy>0?(my+1-py)*ddy:(py-my)*ddy
    let side=0,dist=0
    for(let i=0;i<64;i++){
      if(sdx<sdy){sdx+=ddx;mx+=stepX;side=0}
      else{sdy+=ddy;my+=stepY;side=1}
      if(my>=0&&mx>=0&&my<maze.length&&mx<maze[0].length&&maze[my][mx]===1){
        dist=side===0?(mx-px+(1-stepX)/2)/dx:(my-py+(1-stepY)/2)/dy
        return[Math.max(0.01,dist),side,0]
      }
    }
    return[64,0,0]
  }
  drawSprite(zBuf,px,py,angle,sx,sy,color,label){
    const{W,H,ctx}=this
    const dx=sx-px,dy=sy-py
    const spriteDist=Math.sqrt(dx*dx+dy*dy)
    if(spriteDist<0.2) return
    const spriteAngle=Math.atan2(dy,dx)
    let da=spriteAngle-angle
    while(da>Math.PI) da-=Math.PI*2
    while(da<-Math.PI) da+=Math.PI*2
    if(Math.abs(da)>FOV*0.75) return
    const screenX=Math.floor((0.5+da/FOV)*W)
    const spriteH=Math.min(H,Math.floor(H/spriteDist))
    const spriteW=spriteH
    const top=(H-spriteH)/2
    const startX=screenX-spriteW/2
    const step=W/NUM_RAYS
    for(let i=0;i<spriteW;i++){
      const col=Math.floor((startX+i)/step)
      if(col<0||col>=NUM_RAYS) continue
      if(zBuf[col]<spriteDist) continue
      const alpha=Math.max(0.2,1-spriteDist/8)
      ctx.globalAlpha=alpha
      ctx.fillStyle=color
      ctx.fillRect(startX+i,top+spriteH*0.15,1,spriteH*0.7)
    }
    ctx.globalAlpha=1
    if(spriteDist<4){
      ctx.font=`${Math.floor(16/spriteDist)}px monospace`
      ctx.textAlign='center'
      ctx.fillStyle='#fff'
      ctx.fillText(label,screenX,top-4)
    }
  }
  drawLoot(zBuf,px,py,angle,loot){
    const{W,H,ctx}=this
    for(const l of loot){
      if(l.collected) continue
      const sx=l.x+0.5,sy=l.y+0.5
      const dx=sx-px,dy=sy-py
      const dist=Math.sqrt(dx*dx+dy*dy)
      if(dist>12) continue
      const sAngle=Math.atan2(dy,dx)
      let da=sAngle-angle
      while(da>Math.PI) da-=Math.PI*2
      while(da<-Math.PI) da+=Math.PI*2
      if(Math.abs(da)>FOV*0.7) continue
      const screenX=Math.floor((0.5+da/FOV)*W)
      const sprH=Math.min(H*0.4,Math.floor(H*0.3/dist))
      const top=(H-sprH)/2+sprH*0.1
      const step=W/NUM_RAYS
      const col=Math.floor(screenX/step)
      if(col<0||col>=NUM_RAYS||zBuf[col]<dist) continue
      const t=Date.now()/500
      const bob=Math.sin(t+l.x)*4
      ctx.font=`${Math.max(12,Math.floor(28/dist))}px serif`
      ctx.textAlign='center'
      ctx.globalAlpha=Math.max(0.5,1-dist/10)
      ctx.fillText('💎',screenX,top+bob)
      ctx.globalAlpha=1
    }
  }
}

// ═══════════════════════════════════════════════════════
//  TOUCH JOYSTICK
// ═══════════════════════════════════════════════════════
function TouchControls({onMove,onRotate,onAction}){
  const leftRef=useRef(null)
  const rightRef=useRef(null)
  const leftTouch=useRef(null)
  const rightTouch=useRef(null)
  const leftBase=useRef({x:0,y:0})
  const rightBase=useRef({x:0,y:0})
  const leftVal=useRef({x:0,y:0})
  const rightVal=useRef({x:0,y:0})
  const animRef=useRef(null)

  useEffect(()=>{
    const loop=()=>{
      const lx=leftVal.current.x,ly=leftVal.current.y
      const rx=rightVal.current.x
      if(Math.abs(ly)>0.1||Math.abs(lx)>0.1){
        onMove(ly,lx)
      }
      if(Math.abs(rx)>0.1){
        onRotate(rx)
      }
      animRef.current=requestAnimationFrame(loop)
    }
    animRef.current=requestAnimationFrame(loop)
    return()=>cancelAnimationFrame(animRef.current)
  },[onMove,onRotate])

  const getJoy=(ref,base,val,id,e)=>{
    const r=ref.current.getBoundingClientRect()
    const cx=r.left+r.width/2, cy=r.top+r.height/2
    base.current={x:cx,y:cy}
    for(const t of e.changedTouches){
      if(t.identifier===id.current) return
    }
    id.current=e.changedTouches[0].identifier
    val.current={x:0,y:0}
  }
  const moveJoy=(base,val,id,e)=>{
    for(const t of e.changedTouches){
      if(t.identifier!==id.current) continue
      const dx=(t.clientX-base.current.x)/40
      const dy=(t.clientY-base.current.y)/40
      const mag=Math.sqrt(dx*dx+dy*dy)
      if(mag>1){val.current={x:dx/mag,y:dy/mag}}
      else{val.current={x:dx,y:dy}}
    }
  }
  const endJoy=(val,id,e)=>{
    for(const t of e.changedTouches){
      if(t.identifier===id.current){val.current={x:0,y:0};id.current=null;return}
    }
  }

  const lId=useRef(null), rId=useRef(null)

  const joyStyle={
    width:110,height:110,borderRadius:'50%',
    border:'2px solid rgba(255,255,255,0.2)',
    background:'rgba(255,255,255,0.06)',
    position:'relative',display:'flex',alignItems:'center',justifyContent:'center',
    touchAction:'none'
  }
  const knobStyle={
    width:44,height:44,borderRadius:'50%',
    background:'rgba(255,255,255,0.25)',
    border:'2px solid rgba(255,255,255,0.4)',
    pointerEvents:'none'
  }

  return(
    <div style={{
      position:'fixed',bottom:0,left:0,right:0,
      display:'flex',justifyContent:'space-between',alignItems:'flex-end',
      padding:'0 24px 32px',pointerEvents:'none',zIndex:100
    }}>
      {/* Left joystick - movement */}
      <div ref={leftRef} style={{...joyStyle,pointerEvents:'auto'}}
        onTouchStart={e=>{e.preventDefault();getJoy(leftRef,leftBase,leftVal,lId,e)}}
        onTouchMove={e=>{e.preventDefault();moveJoy(leftBase,leftVal,lId,e)}}
        onTouchEnd={e=>{e.preventDefault();endJoy(leftVal,lId,e)}}>
        <div style={knobStyle}/>
      </div>

      {/* Action button */}
      <button onTouchStart={e=>{e.preventDefault();onAction()}}
        style={{
          width:64,height:64,borderRadius:'50%',pointerEvents:'auto',
          background:'rgba(255,200,0,0.25)',border:'2px solid rgba(255,200,0,0.5)',
          color:'#ffd700',fontSize:26,cursor:'pointer',
          display:'flex',alignItems:'center',justifyContent:'center',
          marginBottom:24
        }}>⚡</button>

      {/* Right joystick - rotation */}
      <div ref={rightRef} style={{...joyStyle,pointerEvents:'auto'}}
        onTouchStart={e=>{e.preventDefault();getJoy(rightRef,rightBase,rightVal,rId,e)}}
        onTouchMove={e=>{e.preventDefault();moveJoy(rightBase,rightVal,rId,e)}}
        onTouchEnd={e=>{e.preventDefault();endJoy(rightVal,rId,e)}}>
        <div style={knobStyle}/>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
//  3D GAME CANVAS
// ═══════════════════════════════════════════════════════
function GameCanvas({gs,pid,onMove,roomCode}){
  const canvasRef=useRef(null)
  const rcRef=useRef(null)
  const frameRef=useRef(null)
  const mobile=isMobile()

  // Build raycaster once maze is ready
  useEffect(()=>{
    if(!gs?.maze||!canvasRef.current) return
    const canvas=canvasRef.current
    canvas.width=mobile?window.innerWidth:Math.min(window.innerWidth,720)
    canvas.height=mobile?window.innerHeight-180:400
    rcRef.current=new Raycaster(canvas,gs.maze)
  },[gs?.maze])

  // Render loop
  useEffect(()=>{
    if(!gs?.maze||!rcRef.current) return
    const render=()=>{
      const rc=rcRef.current
      const me=gs.players[pid]
      if(!me) return
      const zBuf=rc.cast(me.x,me.y,me.angle)
      // Draw other players as sprites
      const others=Object.values(gs.players).filter(p=>p.id!==pid&&!p.caught)
      for(const p of others){
        rc.drawSprite(zBuf,me.x,me.y,me.angle,p.x,p.y,
          p.color||( p.role==='cop'?'#00c9ff':'#ff6b35'),
          p.emoji||EM[p.role])
      }
      // Draw loot
      rc.drawLoot(zBuf,me.x,me.y,me.angle,gs.loot)
      frameRef.current=requestAnimationFrame(render)
    }
    frameRef.current=requestAnimationFrame(render)
    return()=>cancelAnimationFrame(frameRef.current)
  },[gs,pid])

  // Minimap
  const mmSize=120, mmScale=mmSize/Math.max(MW,MH)
  const me=gs?.players?.[pid]

  return(
    <div style={{position:'relative',width:'100%',maxWidth:mobile?'100vw':720}}>
      <canvas ref={canvasRef} style={{display:'block',width:'100%'}}/>
      {/* Minimap */}
      <canvas ref={c=>{
        if(!c||!gs?.maze) return
        c.width=mmSize;c.height=mmSize
        const ctx=c.getContext('2d')
        ctx.fillStyle='rgba(0,0,0,0.7)'
        ctx.fillRect(0,0,mmSize,mmSize)
        for(let y=0;y<MH;y++) for(let x=0;x<MW;x++){
          ctx.fillStyle=gs.maze[y][x]===1?'#1a3a55':'#0d2137'
          ctx.fillRect(x*mmScale,y*mmScale,mmScale,mmScale)
        }
        // Loot
        for(const l of gs.loot){
          if(l.collected) continue
          ctx.fillStyle='#ffd700'
          ctx.fillRect((l.x+0.3)*mmScale,(l.y+0.3)*mmScale,mmScale*0.4,mmScale*0.4)
        }
        // Players
        for(const p of Object.values(gs.players)){
          if(p.caught) continue
          ctx.fillStyle=p.role==='cop'?'#00c9ff':'#ff6b35'
          ctx.beginPath()
          ctx.arc(p.x*mmScale,p.y*mmScale,3,0,Math.PI*2)
          ctx.fill()
          if(p.id===pid){
            ctx.strokeStyle='#fff'
            ctx.lineWidth=0.5
            ctx.beginPath()
            ctx.moveTo(p.x*mmScale,p.y*mmScale)
            ctx.lineTo((p.x+Math.cos(p.angle)*2)*mmScale,(p.y+Math.sin(p.angle)*2)*mmScale)
            ctx.stroke()
          }
        }
      }} style={{
        position:'absolute',top:8,right:8,
        border:'1px solid rgba(255,255,255,0.2)',borderRadius:4,opacity:0.85
      }}/>
      {/* Crosshair */}
      <div style={{
        position:'absolute',top:'50%',left:'50%',
        transform:'translate(-50%,-50%)',
        width:16,height:16,pointerEvents:'none'
      }}>
        <div style={{position:'absolute',top:7,left:0,right:0,height:2,background:'rgba(255,255,255,0.6)'}}/>
        <div style={{position:'absolute',left:7,top:0,bottom:0,width:2,background:'rgba(255,255,255,0.6)'}}/>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════

// ─── Character Selector Component ────────────────────────────────────────────
function CharacterSelector({ role, selected, onSelect }) {
  const chars = CHARACTERS[role] || []
  return (
    <div style={{
      width: '100%',
      background: '#0a1929',
      borderRadius: 12,
      padding: 12,
      border: '1px solid #1a3a55',
    }}>
      <p style={{
        color: '#7ac8e8', fontSize: 12, textAlign: 'center',
        marginBottom: 10, letterSpacing: 1
      }}>
        ESCOLHA SEU PERSONAGEM
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {chars.map(c => {
          const isSelected = selected === c.id
          const accent = role === 'thief' ? '#FF6B35' : '#00C9FF'
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              style={{
                background: isSelected ? c.color + '18' : '#060f1a',
                border: `2px solid ${isSelected ? c.color : '#1a3a55'}`,
                borderRadius: 10,
                padding: '10px 8px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                transition: 'all 0.15s',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {isSelected && (
                <div style={{
                  position: 'absolute', top: 4, right: 6,
                  color: c.color, fontSize: 10, fontWeight: 900
                }}>✓</div>
              )}
              <span style={{ fontSize: 28 }}>{c.emoji}</span>
              <span style={{
                color: isSelected ? c.color : '#ccc',
                fontSize: 12, fontWeight: 700,
                fontFamily: "'Courier New', monospace"
              }}>{c.name}</span>
              <span style={{
                color: '#556', fontSize: 10,
                fontFamily: "'Courier New', monospace",
                textAlign: 'center', lineHeight: 1.3
              }}>{c.desc}</span>
              {/* Stats bar */}
              <div style={{ width: '100%', marginTop: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: '#445', fontSize: 9 }}>VEL</span>
                  <span style={{ color: '#445', fontSize: 9 }}>
                    {role === 'cop' ? 'ALCANCE' : 'COLETA'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {/* Speed bar */}
                  <div style={{
                    flex: 1, height: 4, background: '#1a3a55',
                    borderRadius: 2, overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      background: isSelected ? c.color : '#2a4a65',
                      width: `${Math.min(100, (c.speed / 1.3) * 100)}%`,
                      transition: 'width 0.3s',
                    }}/>
                  </div>
                  {/* Range bar */}
                  <div style={{
                    flex: 1, height: 4, background: '#1a3a55',
                    borderRadius: 2, overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      background: isSelected ? c.color : '#2a4a65',
                      width: `${Math.min(100, ((role === 'cop' ? c.catchRange : c.lootRange) / 1.2) * 100)}%`,
                      transition: 'width 0.3s',
                    }}/>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function App(){
  const [pid]=useState(()=>{
    let id=localStorage.getItem('maze_pid')
    if(!id){id='p'+Math.random().toString(36).slice(2,9);localStorage.setItem('maze_pid',id)}
    return id
  })
  const [screen,setScreen]=useState('home')
  const [roomCode,setRoomCode]=useState('')
  const [joinInput,setJoinInput]=useState('')
  const [nameInput,setNameInput]=useState('')
  const [roleChoice,setRoleChoice]=useState('thief')
  const [charChoice,setCharChoice]=useState('fox')
  const [gs,setGs]=useState(null)
  const [msg,setMsg]=useState('')
  const [chatInput,setChatInput]=useState('')
  const [loader,setLoader]=useState(null)
  const [online,setOnline]=useState(0)
  const channelRef=useRef(null)
  const gsRef=useRef(null)
  const keysRef=useRef({})
  const moveLoopRef=useRef(null)
  gsRef.current=gs
  const mobile=isMobile()

  // ── Online presence ──────────────────────────────────────────────────────
  useEffect(()=>{
    const ch=supabase.channel('online-lobby',{config:{presence:{key:pid}}})
    ch.on('presence',{event:'sync'},()=>setOnline(Object.keys(ch.presenceState()).length))
    ch.subscribe(async s=>{if(s==='SUBSCRIBED') await ch.track({pid})})
    return()=>supabase.removeChannel(ch)
  },[pid])

  // ── Keyboard input loop ──────────────────────────────────────────────────
  useEffect(()=>{
    if(screen!=='game') return
    const onDown=e=>{keysRef.current[e.key]=true}
    const onUp=e=>{keysRef.current[e.key]=false}
    window.addEventListener('keydown',onDown)
    window.addEventListener('keyup',onUp)

    moveLoopRef.current=setInterval(async()=>{
      const s=gsRef.current
      if(!s||s.phase!=='playing') return
      const me=s.players[pid]
      if(!me||me.caught) return
      const keys=keysRef.current
      let nx=me.x,ny=me.y,na=me.angle
      if(keys['ArrowLeft']||keys['a']||keys['A']) na-=ROT_SPEED
      if(keys['ArrowRight']||keys['d']||keys['D']) na+=ROT_SPEED
      if(keys['ArrowUp']||keys['w']||keys['W']){
        const spd=(me.speed||1)*MOVE_SPEED
        nx+=Math.cos(na)*spd
        ny+=Math.sin(na)*spd
      }
      if(keys['ArrowDown']||keys['s']||keys['S']){
        const spd2=(me.speed||1)*MOVE_SPEED
        nx-=Math.cos(na)*spd2
        ny-=Math.sin(na)*spd2
      }
      if(nx===me.x&&ny===me.y&&na===me.angle) return
      // Collision check
      const maze=s.maze
      const checkX=nx,checkY=me.y
      const checkX2=me.x,checkY2=ny
      const pad=0.25
      const walkable=(mx,my)=>maze[Math.floor(my)]&&maze[Math.floor(my)][Math.floor(mx)]===0&&
        maze[Math.floor(my)][Math.ceil(mx)-1]===0&&
        maze[Math.ceil(my)-1]&&maze[Math.ceil(my)-1][Math.floor(mx)]===0
      if(!walkable(checkX,me.y+pad)&&!walkable(checkX,me.y-pad)) nx=me.x
      if(!walkable(me.x+pad,checkY2)&&!walkable(me.x-pad,checkY2)) ny=me.y
      await movePlayer(nx,ny,na)
    },50)

    return()=>{
      window.removeEventListener('keydown',onDown)
      window.removeEventListener('keyup',onUp)
      clearInterval(moveLoopRef.current)
    }
  },[screen,pid])

  // ── Move player (shared with touch) ─────────────────────────────────────
  const movePlayer=useCallback(async(nx,ny,na)=>{
    const s=await roomLoad(roomCode)
    if(!s||s.phase!=='playing') return
    const me=s.players[pid]
    if(!me||me.caught) return
    s.players[pid]={...me,x:nx,y:ny,angle:na}

    // Collect loot
    if(me.role==='thief'){
      for(let i=0;i<s.loot.length;i++){
        const l=s.loot[i]
        if(!l.collected){
          const dx=nx-(l.x+0.5),dy=ny-(l.y+0.5)
          const lRange=me.lootRange||0.7
          if(Math.sqrt(dx*dx+dy*dy)<lRange){
            s.loot[i]={...l,collected:true}
            s.players[pid].loot=(s.players[pid].loot||0)+1
          }
        }
      }
    }

    // Catch thieves (cop)
    if(me.role==='cop'){
      for(const k of Object.keys(s.players)){
        const p=s.players[k]
        if(p.role==='thief'&&!p.caught){
          const dx=nx-p.x,dy=ny-p.y
          const cRange=me.catchRange||0.85
          if(Math.sqrt(dx*dx+dy*dy)<cRange) s.players[k]={...p,caught:true}
        }
      }
    }

    // Win conditions
    const thieves=Object.values(s.players).filter(p=>p.role==='thief')
    const collectedLoot=s.loot.filter(l=>l.collected).length
    if(thieves.every(p=>p.caught)){s.phase='gameover';s.winner='cops'}
    else if(collectedLoot>=LOOT_N){s.phase='gameover';s.winner='thieves'}

    await roomSave(roomCode,s)
    setGs({...s})
  },[roomCode,pid])

  // Touch move handler
  const handleTouchMove=useCallback((fy,fx)=>{
    const s=gsRef.current
    if(!s||s.phase!=='playing') return
    const me=s.players[pid]
    if(!me||me.caught) return
    const spd=(me.speed||1)*MOVE_SPEED*2
    const nx=me.x+Math.cos(me.angle)*(-fy)*spd
    const ny=me.y+Math.sin(me.angle)*(-fy)*spd
    const maze=s.maze
    const safe=(x,y)=>maze[Math.floor(y+0.25)]&&maze[Math.floor(y+0.25)][Math.floor(x+0.25)]===0
    const fx2=nx,fy2=me.y,fx3=me.x,fy3=ny
    const fnx=safe(fx2,fy2)?nx:me.x
    const fny=safe(fx3,fy3)?ny:me.y
    movePlayer(fnx,fny,me.angle)
  },[movePlayer,pid])

  const handleTouchRotate=useCallback((rx)=>{
    const s=gsRef.current
    if(!s) return
    const me=s.players[pid]
    if(!me) return
    movePlayer(me.x,me.y,me.angle+rx*ROT_SPEED*2)
  },[movePlayer,pid])

  // ── Subscribe realtime ───────────────────────────────────────────────────
  const subscribe=useCallback((code)=>{
    if(channelRef.current) supabase.removeChannel(channelRef.current)
    channelRef.current=supabase.channel('room-'+code)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'rooms',filter:`code=eq.${code}`},
        p=>{
          const s=p.new?.state; if(!s) return
          setGs(s)
          if(s.phase==='lobby') setScreen('lobby')
          else if(s.phase==='playing') setScreen('game')
          else if(s.phase==='gameover') setScreen('over')
        })
      .subscribe()
  },[])

  const unsubscribe=useCallback(()=>{
    if(channelRef.current){supabase.removeChannel(channelRef.current);channelRef.current=null}
  },[])

  // ── Create room ──────────────────────────────────────────────────────────
  const createRoom=useCallback(async()=>{
    const code=genCode()
    const state=emptyState()
    setMsg('')
    try{
      setLoader({pct:30,label:'Gerando labirinto...'})
      await new Promise(r=>setTimeout(r,200))
      setLoader({pct:70,label:'Criando sala...'})
      await roomSave(code,state)
      setLoader({pct:100,label:'Pronto!'})
      await new Promise(r=>setTimeout(r,300))
      setLoader(null)
      setRoomCode(code);setGs(state)
      subscribe(code);setScreen('join')
    }catch(e){setLoader(null);setMsg('❌ '+e.message)}
  },[subscribe])

  // ── Join by code ─────────────────────────────────────────────────────────
  const joinByCode=useCallback(async()=>{
    const code=joinInput.trim().toUpperCase()
    if(code.length!==4){setMsg('⚠️ Código tem 4 letras!');return}
    setMsg('')
    try{
      setLoader({pct:50,label:'Conectando...'})
      const s=await roomLoad(code)
      if(!s){setLoader(null);setMsg('❌ Sala "'+code+'" não encontrada.');return}
      setLoader({pct:100,label:'Entrando!'})
      await new Promise(r=>setTimeout(r,300))
      setLoader(null)
      setRoomCode(code);setGs(s)
      subscribe(code);setScreen('join')
    }catch(e){setLoader(null);setMsg('❌ '+e.message)}
  },[joinInput,subscribe])

  // ── Enter as player ──────────────────────────────────────────────────────
  const enterRoom=useCallback(async()=>{
    const name=nameInput.trim()
    if(!name){setMsg('⚠️ Digite seu nome!');return}
    setMsg('')
    try{
      setLoader({pct:50,label:'Entrando na sala...'})
      let s=await roomLoad(roomCode)
      if(!s){setLoader(null);setMsg('❌ Sala não encontrada.');return}
      if(s.phase!=='lobby'){setLoader(null);setMsg('❌ Partida em andamento!');return}
      if(s.players[pid]){setGs(s);setScreen('lobby');setLoader(null);return}
      const nt=Object.values(s.players).filter(p=>p.role==='thief').length
      if(roleChoice==='thief'&&nt>=4){setLoader(null);setMsg('⚠️ Máx 4 ladrões!');return}
      const ri=Object.values(s.players).filter(p=>p.role===roleChoice).length
      const pos=startPos(roleChoice,ri)
      const charDef=CHARACTERS[roleChoice].find(c=>c.id===charChoice)||CHARACTERS[roleChoice][0]
      s.players[pid]={
        id:pid, name, role:roleChoice, ...pos,
        caught:false, loot:0,
        color:charDef.color,
        char:charDef.id,
        emoji:charDef.emoji,
        speed:charDef.speed,
        catchRange:charDef.catchRange||0.85,
        lootRange:charDef.lootRange||0.7,
      }
      await roomSave(roomCode,s)
      setLoader({pct:100,label:'Entrou!'})
      await new Promise(r=>setTimeout(r,300))
      setLoader(null);setGs(s);setMsg('');setScreen('lobby')
    }catch(e){setLoader(null);setMsg('❌ '+e.message)}
  },[nameInput,roleChoice,roomCode,pid])

  // ── Change role ──────────────────────────────────────────────────────────
  const changeRole=useCallback(async(nr)=>{
    try{
      let s=await roomLoad(roomCode)
      if(!s||!s.players[pid]||s.players[pid].role===nr) return
      const nt=Object.values(s.players).filter(p=>p.role==='thief').length
      if(nr==='thief'&&nt>=4){setMsg('⚠️ Máx 4 ladrões!');return}
      const ri=Object.values(s.players).filter(p=>p.role===nr&&p.id!==pid).length
      const ntNew=Object.values(s.players).filter(p=>p.role==='thief'&&p.id!==pid).length
      const pos=startPos(nr,ri)
      s.players[pid]={...s.players[pid],role:nr,...pos,color:nr==='thief'?TC[ntNew%4]:CC[ri%6]}
      await roomSave(roomCode,s);setGs(s);setMsg('')
    }catch(e){setMsg('❌ '+e.message)}
  },[roomCode,pid])

  // ── Start game ───────────────────────────────────────────────────────────
  const startGame=useCallback(async()=>{
    try{
      setLoader({pct:30,label:'Gerando labirinto 3D...'})
      const maze=buildMaze(MW,MH)
      const loot=seedLoot(maze)
      await new Promise(r=>setTimeout(r,300))
      setLoader({pct:70,label:'Posicionando jogadores...'})
      let s=await roomLoad(roomCode); if(!s) return
      const all=Object.values(s.players)
      if(!all.some(p=>p.role==='cop')){setLoader(null);setMsg('⚠️ Precisa de 1 policial!');return}
      if(!all.some(p=>p.role==='thief')){setLoader(null);setMsg('⚠️ Precisa de 1 ladrão!');return}
      s.maze=maze;s.loot=loot;s.winner=null
      let ci=0,ti=0
      Object.keys(s.players).forEach(k=>{
        const p=s.players[k]
        const pos=startPos(p.role,p.role==='thief'?ti++:ci++)
        s.players[k]={...p,...pos,caught:false,loot:0}
      })
      s.phase='playing'
      setLoader({pct:100,label:'Entrando no labirinto!'})
      await roomSave(roomCode,s)
      await new Promise(r=>setTimeout(r,400))
      setLoader(null);setGs(s);setMsg('')
    }catch(e){setLoader(null);setMsg('❌ '+e.message)}
  },[roomCode])

  // ── Chat ─────────────────────────────────────────────────────────────────
  const sendChat=useCallback(async()=>{
    if(!chatInput.trim()) return
    try{
      let s=await roomLoad(roomCode)
      const me=s?.players[pid]; if(!me) return
      if(!s.chat) s.chat=[]
      s.chat=[...s.chat.slice(-19),{name:me.name,role:me.role,msg:chatInput.trim()}]
      await roomSave(roomCode,s);setGs(s);setChatInput('')
    }catch(_){}
  },[chatInput,roomCode,pid])

  const goHome=useCallback(()=>{
    unsubscribe();setScreen('home');setGs(null)
    setRoomCode('');setJoinInput('');setMsg('')
  },[unsubscribe])

  // ── Derived ──────────────────────────────────────────────────────────────
  const me=gs?.players?.[pid]
  const players=gs?Object.values(gs.players):[]
  const cops=players.filter(p=>p.role==='cop')
  const thieves=players.filter(p=>p.role==='thief')

  // ── Preloader ────────────────────────────────────────────────────────────
  const Loader=()=>loader?(
    <div style={{position:'fixed',inset:0,background:'rgba(2,8,14,0.95)',display:'flex',
      flexDirection:'column',alignItems:'center',justifyContent:'center',zIndex:9999,gap:16}}>
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
          <input style={{...S.inp,flex:1,textTransform:'uppercase',letterSpacing:6,
            fontSize:18,textAlign:'center'}}
            placeholder='CÓDIGO' maxLength={4} value={joinInput}
            onChange={e=>setJoinInput(e.target.value.toUpperCase())}
            onKeyDown={e=>e.key==='Enter'&&joinByCode()}/>
          <button style={{...S.btnP,width:'auto',padding:'0 16px',letterSpacing:0,fontSize:13}}
            onClick={joinByCode}>ENTRAR</button>
        </div>
        {msg&&<p style={S.msgT}>{msg}</p>}
        <div style={{width:'100%',background:'#0a1929',borderRadius:10,padding:12,
          border:'1px solid #1a3a55',fontSize:12,color:'#4a8aaa',lineHeight:1.6}}>
          <strong style={{color:'#7ac8e8'}}>🦹 Ladrão:</strong> Colete 5 💎 diamantes<br/>
          <strong style={{color:'#7ac8e8'}}>👮 Policial:</strong> Toque no ladrão para prender
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
        <div style={{fontSize:36}}>🏛️</div>
        <h2 style={{...S.title,fontSize:20}}>MAZE CHASE</h2>
        <div style={{...S.sbar,...S.sok,width:'100%',textAlign:'center'}}>
          🟢 Sala: <strong style={{letterSpacing:4}}>{roomCode}</strong>
        </div>
        <input style={S.inp} placeholder='Seu nome...' maxLength={16} value={nameInput}
          onChange={e=>setNameInput(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&enterRoom()}/>
        <div style={S.rolePicker}>
          <p style={{color:'#7ac8e8',fontSize:12,textAlign:'center',marginBottom:8}}>
            Escolha seu papel:
          </p>
          <div style={{display:'flex',gap:10}}>
            {['thief','cop'].map(r=>(
              <button key={r} onClick={()=>{setRoleChoice(r);setCharChoice(CHARACTERS[r][0].id)}} style={{
                flex:1,padding:'12px 6px',borderRadius:10,cursor:'pointer',
                display:'flex',flexDirection:'column',alignItems:'center',gap:4,
                fontFamily:'inherit',fontSize:14,fontWeight:700,
                background:roleChoice===r?(r==='thief'?'#FF6B3520':'#00C9FF20'):'#060f1a',
                border:`2px solid ${roleChoice===r?(r==='thief'?'#FF6B35':'#00C9FF'):'#1a3a55'}`,
                color:roleChoice===r?(r==='thief'?'#FF6B35':'#00C9FF'):'#556',
              }}>
                <span style={{fontSize:32}}>{EM[r]}</span>
                <span>{r==='thief'?'Ladrão':'Policial'}</span>
                <span style={{fontSize:10,color:'#888',fontWeight:400}}>
                  {r==='thief'?'Coleta 5 💎':'Prende ladrões'}
                </span>
              </button>
            ))}
          </div>
        </div>
        <CharacterSelector
          role={roleChoice}
          selected={charChoice}
          onSelect={setCharChoice}
        />
        {players.length>0&&(
          <div style={{width:'100%',textAlign:'center'}}>
            <p style={{color:'#4a8aaa',fontSize:11,marginBottom:4}}>Na sala:</p>
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
  )

  // ════════════════════════════════════════════════════
  // LOBBY
  // ════════════════════════════════════════════════════
  if(screen==='lobby') return(
    <div style={S.root}>
      <Loader/>
      <div style={{...S.card,width:Math.min(480,window.innerWidth-24)}}>
        <h2 style={{...S.title,fontSize:20}}>
          Sala <span style={{color:'#00c9ff',letterSpacing:4}}>{roomCode}</span>
        </h2>
        <p style={{color:'#4a8aaa',fontSize:11}}>
          Envie <strong style={{color:'#00c9ff'}}>{roomCode}</strong> para seu filho jogar junto
        </p>
        <div style={{display:'flex',gap:12,width:'100%'}}>
          <div style={S.teamBox}>
            <p style={{color:'#00C9FF',fontWeight:700,fontSize:13,marginBottom:8}}>👮 POLICIAIS</p>
            {cops.length===0&&<p style={{color:'#333',fontSize:12}}>Aguardando...</p>}
            {cops.map(p=>(
              <div key={p.id} style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                <span style={{fontSize:18}}>{p.emoji||EM[p.role]}</span>
                <div>
                  <span style={{color:p.color,fontSize:13,fontWeight:700}}>{p.name}</span>
                  {p.id===pid&&<span style={{color:'#444',fontSize:10}}> (você)</span>}
                  <br/><span style={{color:'#446',fontSize:10}}>{(CHARACTERS[p.role]||[]).find(c=>c.id===p.char)?.name||''}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={S.teamBox}>
            <p style={{color:'#FF6B35',fontWeight:700,fontSize:13,marginBottom:8}}>🦹 LADRÕES</p>
            {thieves.length===0&&<p style={{color:'#333',fontSize:12}}>Aguardando...</p>}
            {thieves.map(p=>(
              <div key={p.id} style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                <span style={{fontSize:18}}>{p.emoji||EM[p.role]}</span>
                <div>
                  <span style={{color:p.color,fontSize:13,fontWeight:700}}>{p.name}</span>
                  {p.id===pid&&<span style={{color:'#444',fontSize:10}}> (você)</span>}
                  <br/><span style={{color:'#446',fontSize:10}}>{(CHARACTERS[p.role]||[]).find(c=>c.id===p.char)?.name||''}</span>
                </div>
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
                }}>{EM[r]} {r==='thief'?'Ladrão':'Policial'}</button>
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
  // GAME (3D)
  // ════════════════════════════════════════════════════
  if(screen==='game'&&me) return(
    <div style={{position:'fixed',inset:0,background:'#000',overflow:'hidden'}}>
      <Loader/>

      {/* 3D View */}
      <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <GameCanvas gs={gs} pid={pid} onMove={movePlayer} roomCode={roomCode}/>
      </div>

      {/* HUD top */}
      <div style={{
        position:'absolute',top:0,left:0,right:0,
        display:'flex',justifyContent:'space-between',alignItems:'center',
        padding:'8px 16px',
        background:'linear-gradient(to bottom,rgba(0,0,0,0.8),transparent)',
        pointerEvents:'none'
      }}>
        <div style={{display:'flex',gap:12,alignItems:'center'}}>
          <span style={{color:me.color,fontWeight:700,fontSize:15}}>{me.emoji||EM[me.role]} {me.name}</span>
          {me.caught&&<span style={{background:'#f55',color:'#fff',borderRadius:8,
            padding:'2px 8px',fontSize:12,fontWeight:700}}>🔒 PRESO</span>}
        </div>
        <div style={{display:'flex',gap:16,alignItems:'center'}}>
          {me.role==='thief'&&(
            <span style={{color:'#ffd700',fontSize:14,fontWeight:700}}>
              💎 {me.loot||0}/{LOOT_N}
            </span>
          )}
          <span style={{color:'#7ac8e8',fontSize:13}}>
            👮{cops.length} 🦹{thieves.filter(p=>!p.caught).length}
          </span>
        </div>
      </div>

      {/* Chat overlay */}
      <div style={{
        position:'absolute',bottom:mobile?200:16,left:16,
        width:200,pointerEvents:'auto'
      }}>
        <div style={{
          maxHeight:80,overflowY:'auto',marginBottom:4,
          background:'rgba(0,0,0,0.5)',borderRadius:6,padding:4
        }}>
          {(gs.chat||[]).slice(-5).map((c,i)=>(
            <div key={i} style={{fontSize:11,marginBottom:2}}>
              <span style={{color:c.role==='thief'?TC[0]:CC[0],fontWeight:700}}>{c.name}: </span>
              <span style={{color:'#ddd'}}>{c.msg}</span>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:4}}>
          <input style={{...S.inp,fontSize:11,padding:'4px 8px',flex:1,
            background:'rgba(0,0,0,0.6)'}}
            placeholder='Chat...' value={chatInput}
            onChange={e=>setChatInput(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&sendChat()}/>
          <button style={{...S.btnP,padding:'4px 8px',width:'auto',
            fontSize:11,letterSpacing:0}} onClick={sendChat}>➤</button>
        </div>
      </div>

      {/* Caught overlay */}
      {me.caught&&(
        <div style={{position:'absolute',inset:0,
          display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
          background:'rgba(0,0,0,0.7)',pointerEvents:'none'}}>
          <div style={{fontSize:48}}>🔒</div>
          <p style={{color:'#f55',fontWeight:900,fontSize:24}}>VOCÊ FOI PRESO</p>
          <p style={{color:'#888',fontSize:14}}>Aguarde o fim da partida...</p>
        </div>
      )}

      {/* Touch controls */}
      {mobile&&(
        <TouchControls
          onMove={handleTouchMove}
          onRotate={handleTouchRotate}
          onAction={()=>{}}
        />
      )}

      {/* Exit button */}
      <button onClick={goHome} style={{
        position:'absolute',top:8,right:8,
        background:'rgba(0,0,0,0.5)',border:'1px solid rgba(255,255,255,0.2)',
        color:'#aaa',borderRadius:8,padding:'4px 10px',
        fontSize:12,cursor:'pointer'
      }}>✕ Sair</button>
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
          <h2 style={{...S.title,color:gs?.winner==='cops'?'#00C9FF':'#FF6B35',fontSize:22}}>
            {gs?.winner==='cops'?'POLÍCIA VENCEU!':'LADRÕES ESCAPARAM!'}
          </h2>
          <p style={{fontSize:17,color:won?'#FFD700':'#888',margin:'4px 0 12px'}}>
            {won?'🏆 Você venceu!':'😔 Sua equipe perdeu.'}
          </p>
          {thieves.map(p=>(
            <p key={p.id} style={{color:p.color,fontSize:14,marginBottom:4}}>
              🦹 {p.name}: {p.loot||0} diamantes — {p.caught?'PRESO 🔒':'Livre ✅'}
            </p>
          ))}
          <button style={{...S.btnP,marginTop:16}} onClick={goHome}>🔄 NOVA PARTIDA</button>
        </div>
      </div>
    )
  }

  return<div style={S.root}><p style={{color:'#aaa'}}>⏳ Carregando...</p></div>
}

const S={
  root:{minHeight:'100vh',background:'radial-gradient(ellipse at top,#071829,#020c14)',
    display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',
    fontFamily:"'Courier New',monospace",color:'#e0f0ff',padding:12},
  card:{background:'#060f1a',border:'1px solid #0a2a3a',borderRadius:16,padding:28,
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
  teamBox:{flex:1,background:'#0a1929',borderRadius:10,padding:12},
  myCtrl:{width:'100%',background:'#0a1929',borderRadius:10,padding:12,border:'1px solid #1a3a55'},
  divider:{width:'100%',height:1,background:'#1a3a55',margin:'4px 0'},
}
