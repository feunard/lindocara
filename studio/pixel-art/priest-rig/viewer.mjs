import manifest from '../../../packages/renderer/src/assets/characters/priest/manifest.json';
const sources=import.meta.glob('../../../packages/renderer/src/assets/characters/priest/*.png',{eager:true,query:'?url',import:'default'});
const diagnostics=import.meta.glob('../../../artifacts/priest/*-joints.json',{eager:true,import:'default'});
if(new URLSearchParams(location.search).has('bake')) {
  await import('./bake-view.mjs');
} else {
const atlases={};
const cell=manifest.frame.width,anchor=manifest.frame.anchor;
await Promise.all(Object.entries(sources).map(async([path,url])=>{const img=new Image();img.src=url;await img.decode();atlases[path.split('/').pop().replace('.png','')]=img;}));
window.priestStudioReady=true;
const select=document.querySelector('#action'), meta=document.querySelector('#meta');
for(const name of Object.keys(manifest.clips)) select.add(new Option(name,name));
select.value='run';
const views=document.querySelector('#views');
const canvases=manifest.directions.map(name=>{const box=document.createElement('div'), c=document.createElement('canvas');c.width=c.height=cell;box.append(c,document.createTextNode(name));views.append(box);return c;});
const stage=document.querySelector('#stage'), ctx=stage.getContext('2d');
let elapsed=0,previous=performance.now(),paused=false,steps=0;
const pause=()=>{paused=!paused;document.querySelector('#pause').textContent=paused?'Play':'Pause';};
document.querySelector('#pause').onclick=pause;
document.querySelector('#step').onclick=()=>{paused=true;steps++;};
document.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();pause();}if(e.code==='ArrowRight'){paused=true;steps++;}});
select.onchange=()=>{elapsed=0;};
function tick(now){
  const action=select.value, config=manifest.clips[action],speed=Number(document.querySelector('#speed').value);
  if(!paused)elapsed+=Math.min(50,now-previous)*speed;previous=now;
  if(steps){elapsed+=config.durationMs/config.frames*steps;steps=0;}
  const phase=config.loop?(elapsed/config.durationMs)%1:Math.min(1,(elapsed%(config.durationMs+600))/config.durationMs);
  const frame=Math.min(config.frames-1,Math.floor(phase*(config.loop?config.frames:config.frames-1)));
  const packed=config.frame, offsetX=anchor.x-packed.anchor.x,offsetY=anchor.y-packed.anchor.y;
  const sampled=frame/(config.loop?config.frames:config.frames-1);
  document.querySelector('#speed-label').value=`${speed.toFixed(2)}×`;
  for(let i=0;i<8;i++){
    const c=canvases[i].getContext('2d');c.clearRect(0,0,cell,cell);c.drawImage(atlases[action],frame%config.columns*packed.width,Math.floor((i*config.directionStride+frame)/config.columns)*packed.height,packed.width,packed.height,offsetX,offsetY,packed.width,packed.height);
    const skeleton=document.querySelector('#skeleton').checked;
    if(skeleton)c.clearRect(0,0,cell,cell);
    if(document.querySelector('#overlay').checked||skeleton){
      c.fillStyle='#f16b59';c.fillRect(anchor.x-1,anchor.y-3,2,7);c.fillRect(anchor.x-4,anchor.y-1,8,2);
      const records=diagnostics[`../../../artifacts/priest/${action}-joints.json`]?.filter(r=>r.direction===i)??[];
      for(const side of [0,1]){c.beginPath();c.strokeStyle=side?'#ffe593':'#7ef1b2';c.lineWidth=.7;
        records.forEach((r,index)=>{const [x,y]=r.screen.feet[side];if(index)c.lineTo(x,y);else c.moveTo(x,y);});c.stroke();}
      const current=records[frame]?.screen;
      if(current)for(const [point,color] of [[current.pelvis,'#fa7961'],[current.head,'#c6a4ff'],...current.feet.map(p=>[p,'#7ef1b2'])]){c.fillStyle=color;c.beginPath();c.arc(...point,2,0,Math.PI*2);c.fill();}
      if(current?.chest){
        const line=(points,color)=>{c.strokeStyle=color;c.lineWidth=1.2;c.beginPath();points.forEach((p,index)=>index?c.lineTo(...p):c.moveTo(...p));c.stroke();};
        line([current.pelvis,current.chest,current.head],'#f5b678');
        line(current.shoulders,'#f5b678');line(current.hips,'#f5b678');
        for(const side of [0,1]){
          line([current.hips[side],current.knees[side],current.feet[side]],side?'#ffe593':'#7ef1b2');
          line([current.shoulders[side],current.elbows[side],current.hands[side]],side?'#ffe593':'#7ef1b2');
        }
      }
    }
    if(document.querySelector('#ghost').checked){c.globalAlpha=.18;
      for(const previous of [1,2]){const ghostFrame=config.loop?(frame-previous+config.frames)%config.frames:Math.max(0,frame-previous);
        c.drawImage(atlases[action],ghostFrame%config.columns*packed.width,Math.floor((i*config.directionStride+ghostFrame)/config.columns)*packed.height,packed.width,packed.height,offsetX,offsetY,packed.width,packed.height);}
      c.globalAlpha=1;
    }
  }
  ctx.clearRect(0,0,768,256);ctx.fillStyle='#344b45';ctx.fillRect(0,0,768,256);
  const travel=action==='run'?elapsed/1000*manifest.referenceSpeed*128/2.24:0;
  ctx.strokeStyle='#59715e';ctx.beginPath();for(let x=-128;x<896;x+=32){const at=x-travel%32;ctx.moveTo(at,160);ctx.lineTo(at,256);}ctx.moveTo(0,200);ctx.lineTo(768,200);ctx.stroke();
  for(let direction of [2]){ctx.drawImage(atlases[action],frame%config.columns*packed.width,Math.floor((direction*config.directionStride+frame)/config.columns)*packed.height,packed.width,packed.height,300+offsetX,200-anchor.y+offsetY,packed.width,packed.height);}
  meta.textContent=`${action} · frame ${frame+1}/${config.frames} · ${config.durationMs} ms · phase ${sampled.toFixed(3)}\n160 px fixed canvas · eight game directions · 1.72 tiles/stride · origin (80,116)`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
}
