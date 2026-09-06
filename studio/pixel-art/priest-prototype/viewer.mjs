const root='/packages/renderer/src/assets/bonus/';
const manifest=await(await fetch(root+'priest-prototype/manifest.json')).json();
const motionReview=await(await fetch('./authoring-report.json')).json();
const get=id=>document.getElementById(id),canvas=get('canvas'),ctx=canvas.getContext('2d'),images=new Map();
await Promise.all([...new Set(Object.values(manifest.clips).map(c=>c.asset))].map(async asset=>{
  const image=new Image();image.src=root+asset;await image.decode();images.set(asset,image);
}));
const anticipation={'radiant-bolt':140,mend:240,blink:180,prayer:320,'divine-nova':400};
const memory=[...new Map(Object.values(manifest.clips).map(c=>[c.asset,c.decodedBytes])).values()].reduce((a,b)=>a+b,0);
for(const name of Object.keys(manifest.clips))get('clip').add(new Option(name,name));
let elapsed=0,distance=0,playing=true,selected=null;
get('clip').onchange=()=>{elapsed=0;selected=null;draw();};
get('pause').onclick=()=>{playing=!playing;get('pause').textContent=playing?'Pause':'Lecture';selected=null;};
get('frame').oninput=()=>{selected=Number(get('frame').value);playing=false;draw();};
function draw(){
  const name=get('clip').value,c=manifest.clips[name],count=c.transitionFrames??c.frames;
  const phase=name==='run'?distance/manifest.strideDistance%1:elapsed/c.durationMs%1;
  let local=Math.min(count-1,Math.floor(phase*count));
  if(anticipation[name]){
    const t=elapsed%c.durationMs,impact=anticipation[name];
    local=t<impact?Math.floor(t/impact*c.activeFrame):Math.min(count-1,c.activeFrame+Math.floor((t-impact)/(c.durationMs-impact)*(count-c.activeFrame)));
  }
  if(name==='start')local=count-1-local;
  const frame=selected??(c.phaseBuckets?Number(get('bank').value)*count:0)+local;
  get('frame').max=c.frames-1;get('frame').value=frame;
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;
  for(let direction=0;direction<8;direction++){
    const row=direction<5?direction:8-direction,mirror=direction>4;
    const x=direction%4*320+160,y=Math.floor(direction/4)*370;
    ctx.fillStyle='#d4d9d7';ctx.font='14px monospace';ctx.fillText(`${direction} · ${manifest.directions[row]}${mirror?' miroir':''}`,x-148,y+22);
    for(const [scale,anchorY] of [[.63,y+128],[1.35,y+342]]){
      ctx.fillStyle='#293d3f';ctx.fillRect(x-150,anchorY-125*scale,300,145*scale);
      ctx.strokeStyle='#607575';ctx.beginPath();ctx.moveTo(x-150,anchorY);ctx.lineTo(x+150,anchorY);ctx.stroke();
      if(name==='run'){
        const angle=direction*Math.PI/4;
        ctx.save();ctx.beginPath();ctx.rect(x-150,anchorY-120*scale,300,145*scale);ctx.clip();ctx.fillStyle='#9bad9b';
        for(let n=-5;n<=5;n++){
          const travel=n*.5-distance%2.5;
          ctx.fillRect(x+Math.sin(angle)*travel*manifest.pixelsPerTile*scale-1,anchorY+Math.cos(angle)*travel*manifest.pixelsPerTile*scale*.636-1,3,3);
        }ctx.restore();
      }
      const shift=mirror&&['run','stop','start','jump-run','land-run'].includes(name)?c.frames/2:0;
      const f=(frame+shift)%c.frames,idx=row*c.directionStride+f,im=images.get(c.asset),{width:w,height:h,anchor:a}=c.frame;
      const paint=index=>ctx.drawImage(im,index%c.columns*w,Math.floor(index/c.columns)*h,w,h,-a.x*scale,-a.y*scale,w*scale,h*scale);
      ctx.save();ctx.translate(x,anchorY);if(mirror)ctx.scale(-1,1);
      if(get('overlay').checked){ctx.globalAlpha=.25;paint(row*c.directionStride+(f+c.frames-1)%c.frames);ctx.globalAlpha=1;}
      paint(idx);
      if(get('motion').checked&&name==='run'){
        const keys=motionReview.registration[manifest.directions[row]].run;
        const tracks=keys.map(k=>k.landmarks),origin=manifest.sourceFrame.anchor;
        for(const [point,colour] of [['head','#f6e295'],['chest','#67e2ec'],['pelvis','#b6ef97']]){
          ctx.strokeStyle=colour;ctx.beginPath();
          let started=false;
          for(const track of [...tracks,tracks[0]])if(track[point]){
            const [px,py]=track[point],x=(px-origin.x)*scale,y=(py-origin.y)*scale;
            if(started)ctx.lineTo(x,y);else ctx.moveTo(x,y);started=true;
          }ctx.stroke();
          const current=keys.find(k=>k.frame===f)?.landmarks[point];
          if(current){ctx.fillStyle=colour;ctx.fillRect((current[0]-origin.x)*scale-2,(current[1]-origin.y)*scale-2,4,4);}
        }
      }
      if(get('overlay').checked){
        ctx.strokeStyle='#ffd580';ctx.beginPath();ctx.moveTo(-5,0);ctx.lineTo(5,0);ctx.moveTo(0,-5);ctx.lineTo(0,5);ctx.stroke();
        const socket=c.weaponSockets[row][f];ctx.strokeStyle='#ff7575';ctx.beginPath();ctx.arc((socket.x-manifest.sourceFrame.anchor.x)*scale,(socket.y-manifest.sourceFrame.anchor.y)*scale,4,0,Math.PI*2);ctx.stroke();
      }ctx.restore();
    }
  }
  get('stats').textContent=`${name} · frame ${frame}/${c.frames-1} · phase ${phase.toFixed(3)} · ${Number(get('speed').value).toFixed(3)} tiles/s\n${c.frame.width}×${c.frame.height} px/frame · ${(memory/1048576).toFixed(1)} MiB RGBA partagés · ${c.loop?'boucle':'relance du clip pour inspection'}`;
}
window.priestStudio={manifest,frame(name,frame){get('clip').value=name;selected=frame;playing=false;draw();},play(name){get('clip').value=name;elapsed=0;distance=0;selected=null;playing=true;}};
let previous=performance.now();function tick(now){const dt=Math.min(50,now-previous)*Number(get('rate').value);previous=now;if(playing){elapsed+=dt;distance+=Number(get('speed').value)*dt/1000;}draw();requestAnimationFrame(tick);}requestAnimationFrame(tick);
