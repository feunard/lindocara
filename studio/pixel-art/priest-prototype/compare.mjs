const root='/packages/renderer/src/assets/bonus/';
const params=new URLSearchParams(location.search),requested=params.get('priest');
const priestUrl=requested?.startsWith('/artifacts/priest-motion/')?requested:root+'priest-prototype/manifest.json';
const get=id=>document.getElementById(id),canvas=get('comparison'),ctx=canvas.getContext('2d');
const selected=params.has('direction')?Number(params.get('direction')):null;
const directions=selected!==null&&Number.isInteger(selected)&&selected>=0&&selected<8?[selected]:[0,1,2,3,4,5,6,7];
if(directions.length===1){canvas.width=400;canvas.height=440;}
// PLAYER_ACTIONS (engine/combat-actions.ts), presentation only.
const impacts={'radiant-bolt':140,mend:240,blink:180,prayer:320,'divine-nova':400,'dual-slash':105,'shadow-step':110,vanish:80,'poisoned-shiv':125,'shadow-dance':180};
async function load(url){
  const manifest=await(await fetch(url)).json(),images=new Map();
  await Promise.all([...new Set(Object.values(manifest.clips).map(c=>c.asset))].map(async asset=>{
    const image=new Image();image.src=url.slice(0,url.lastIndexOf('/')+1)+asset.split('/').at(-1);await image.decode();images.set(asset,image);
  }));
  return {manifest,images};
}
const [priest,rogue]=await Promise.all([load(priestUrl),load(root+'assassin-v2/manifest.json')]);
for(const [id,data] of [['priest',priest],['rogue',rogue]]){
  for(const name of Object.keys(data.manifest.clips))get(id).add(new Option(name,name));
  get(id).value='run';
}
let elapsed=0,playing=true,chosen=null;
get('priest').onchange=()=>{if(rogue.manifest.clips[get('priest').value])get('rogue').value=get('priest').value;elapsed=0;chosen=null;draw();};
get('rogue').onchange=()=>{elapsed=0;chosen=null;draw();};
get('pause').onclick=()=>{playing=!playing;chosen=null;get('pause').textContent=playing?'Pause':'Lecture';};
get('scrub').oninput=()=>{chosen=Number(get('scrub').value);playing=false;get('pause').textContent='Lecture';draw();};
function phaseOf(data,name){return elapsed/data.manifest.clips[name].durationMs%1;}
function frameOf(clip,name,phase){
  const count=clip.transitionFrames??clip.frames;
  let f=Math.min(count-1,Math.floor(phase*(clip.loop?count:count-1)));
  if(clip.activeFrame!==undefined&&impacts[name]){
    const t=phase*clip.durationMs,impact=impacts[name];
    f=t<impact?Math.floor(t/impact*clip.activeFrame):Math.min(count-1,clip.activeFrame+Math.floor((t-impact)/(clip.durationMs-impact)*(count-clip.activeFrame)));
  }
  return name==='start'?count-1-f:f;
}
function draw(){
  const pn=get('priest').value,rn=get('rogue').value;
  const pphase=chosen??phaseOf(priest,pn),rphase=chosen??(get('phase').checked?pphase:phaseOf(rogue,rn));
  get('scrub').value=pphase;
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;
  for(const [position,direction] of directions.entries()){
    const row=direction<=4?direction:8-direction,mirror=direction>4;
    const left=position%4*400,top=Math.floor(position/4)*440;
    ctx.fillStyle='#dfe8e1';ctx.font='14px monospace';ctx.fillText(`${direction} ${priest.manifest.directions[row]}${mirror?' miroir':''}`,left+12,top+20);
    for(const [data,name,phase,x,label] of [[priest,pn,pphase,left+103,'Prêtre'],[rogue,rn,rphase,left+297,'Assassin V2']]){
      ctx.font='12px monospace';ctx.fillStyle='#c3cdbc';ctx.fillText(label,x-35,top+42);
      const c=data.manifest.clips[name],count=c.transitionFrames??c.frames;
      let f=frameOf(c,name,phase);
      if(mirror&&['run','start','stop','jump-run','land-run'].includes(name))f=(f+c.frames/2)%c.frames;
      const bank=Math.floor(f/count);
      for(const [scale,anchorY] of [[.70,top+165],[1.4,top+390]]){
        ctx.save();ctx.beginPath();ctx.rect(x-94,anchorY-145*scale,188,173*scale);ctx.clip();
        ctx.fillStyle='#2b3f40';ctx.fillRect(x-94,anchorY-145*scale,188,173*scale);
        ctx.strokeStyle='#617575';ctx.beginPath();ctx.moveTo(x-94,anchorY);ctx.lineTo(x+94,anchorY);ctx.stroke();
        if(name==='run'){
          const travelled=(chosen??(get('phase').checked?elapsed/priest.manifest.clips.run.durationMs:elapsed/c.durationMs))*data.manifest.strideDistance;
          const angle=direction*Math.PI/4;
          ctx.fillStyle='#9bad9b';
          for(let n=-8;n<=8;n++){
            const distance=n*.5-travelled%2;
            ctx.fillRect(x+Math.sin(angle)*distance*c.pixelsPerTile*scale-1,anchorY+Math.cos(angle)*distance*c.pixelsPerTile*scale*.636-1,3,3);
          }
        }
        ctx.translate(x,anchorY);if(mirror)ctx.scale(-1,1);
        const spriteScale=scale*priest.manifest.pixelsPerTile/c.pixelsPerTile;
        const paint=index=>{
          const atlasIndex=row*c.directionStride+index,{width:w,height:h,anchor:a}=c.frame;
          ctx.drawImage(data.images.get(c.asset),atlasIndex%c.columns*w,Math.floor(atlasIndex/c.columns)*h,w,h,-a.x*spriteScale,-a.y*spriteScale,w*spriteScale,h*spriteScale);
        };
        if(get('onion').checked){ctx.globalAlpha=.22;paint(bank*count+(f%count+count-1)%count);ctx.globalAlpha=1;}
        paint(f);ctx.restore();
      }
    }
  }
  const duration=priest.manifest.clips[pn].durationMs,rduration=rogue.manifest.clips[rn].durationMs;
  get('stats').textContent=`Prêtre : ${pn}, ${duration.toFixed(1)} ms, phase ${pphase.toFixed(3)}. Assassin V2 : ${rn}, ${rduration.toFixed(1)} ms, phase ${rphase.toFixed(3)}.\n${get('phase').checked?'Cycles alignés pour comparer les poses.':'Chaque personnage est lu à sa propre cadence du jeu.'} Aucun changement des textures de l’Assassin.`;
}
window.priestComparison={priest:priest.manifest,rogue:rogue.manifest,pause(value){playing=!value;},step(ms){elapsed+=ms;draw();},phase(value){chosen=value;playing=false;draw();},clip(name){get('priest').value=name;if(rogue.manifest.clips[name])get('rogue').value=name;chosen=null;elapsed=0;draw();}};
let previous=performance.now();
function tick(now){if(playing){elapsed+=Math.min(50,now-previous)*Number(get('rate').value);chosen=null;}previous=now;draw();requestAnimationFrame(tick);}
requestAnimationFrame(tick);
