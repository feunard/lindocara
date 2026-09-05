const root = '/packages/renderer/src/assets/bonus/assassin-v2/';
const manifest = await (await fetch(root + 'manifest.json')).json();
const get = (id) => document.getElementById(id);
const canvas = get('canvas'), ctx = canvas.getContext('2d');
const images = new Map();
async function image(url) {
  if (images.has(url)) return images.get(url);
  const im = new Image(); im.src = url; await im.decode(); images.set(url, im); return im;
}
const assetRoot = '/packages/renderer/src/assets/bonus/';
await Promise.all(Object.values(manifest.clips).map((clip) => image(assetRoot + clip.asset)));
const oldNames = ['idle','run','dual-slash','shadow-step','vanish','poisoned-shiv','shadow-dance','death'];
// Same release instants as PLAYER_ACTIONS. The in-engine preview uses that table directly.
const anticipation = {'dual-slash':105,'shadow-step':110,vanish:80,'poisoned-shiv':125,'shadow-dance':180};
const memory = [...new Map(Object.values(manifest.clips).filter(c=>c.asset.startsWith('assassin-v2/')).map(c=>[c.asset,c.decodedBytes])).values()].reduce((a,b)=>a+b,0);
await Promise.all(oldNames.map((name) => image('/studio/pixel-art/assassin-v2/sources/v1/' + name + '.png')));
for (const name of Object.keys(manifest.clips)) get('clip').add(new Option(name, name));
let elapsed = 0, distance = 0, playing = true, selectedFrame = null;
get('clip').onchange = () => { elapsed = 0; selectedFrame = null; draw(); };
get('pause').onclick = () => { playing = !playing; get('pause').textContent = playing ? 'Pause' : 'Lecture'; selectedFrame = null; };
get('frame').oninput = () => { selectedFrame = Number(get('frame').value); playing = false; draw(); };
function draw() {
  const name = get('clip').value, clip = manifest.clips[name];
  const phase = name === 'run' ? distance / manifest.strideDistance % 1 : elapsed / clip.durationMs % 1;
  const bank = Number(get('bank').value);
  const count = clip.transitionFrames ?? clip.frames;
  let localFrame = Math.min(count - 1, Math.floor(phase * count));
  if(anticipation[name]) {
    const at=elapsed%clip.durationMs,impact=anticipation[name],contact=clip.activeFrame;
    localFrame=at<impact ? Math.floor(at/impact*contact) : Math.min(count-1,contact+Math.floor((at-impact)/(clip.durationMs-impact)*(count-contact)));
  }
  if(name === 'start') localFrame = count-1-localFrame;
  const frame = selectedFrame ?? ((clip.phaseBuckets ? bank*count : 0) + localFrame);
  get('frame').max = clip.frames - 1; get('frame').value = frame;
  ctx.clearRect(0,0,canvas.width,canvas.height); ctx.imageSmoothingEnabled = false;
  for (let direction = 0; direction < 8; direction++) {
    const row = direction < 5 ? direction : 8 - direction, mirror = direction > 4;
    const x = (direction % 4) * 320 + 160, y = Math.floor(direction / 4) * 350 + 90;
    ctx.fillStyle = '#d4d9d7'; ctx.font='14px monospace'; ctx.fillText(`${direction} · ${manifest.directions[row]}${mirror?' miroir':''}`, x-135, y-60);
    for (const [label,anchorY,isOld] of [['Prototype 1',y+100,true],['Prototype 2',y+255,false]]) {
      const scale = .95 * (isOld ? 1 : (192/2.34)/clip.pixelsPerTile);
      ctx.fillStyle = '#263b3c'; ctx.fillRect(x-148,anchorY-120,296,144);
      ctx.strokeStyle = '#506262'; ctx.beginPath(); ctx.moveTo(x-145,anchorY);ctx.lineTo(x+145,anchorY);ctx.stroke();
      if(name === 'run') {
        const angle=direction*Math.PI/4, pixels=192/2.34*.95;
        ctx.save();ctx.beginPath();ctx.rect(x-147,anchorY-120,294,143);ctx.clip();
        ctx.fillStyle='#637577';
        for(let n=-5;n<=5;n++) {
          const d=n*.5-distance%2.5;
          const gx=x+Math.sin(angle)*d*pixels,gy=anchorY+Math.cos(angle)*d*pixels*.636;
          ctx.fillRect(gx-1,gy-1,3,3);
        }
        ctx.restore();
      }
      ctx.fillStyle='#bdc8c4';ctx.fillText(label,x-142,anchorY-103);
      let im, fw, fh, ax, ay, idx, cols;
      if (isOld) {
        const oldName=oldNames.includes(name)?name:'idle';
        im=images.get('/studio/pixel-art/assassin-v2/sources/v1/'+oldName+'.png');fw=fh=192;ax=96;ay=136;cols=10;
        const oldDuration = name==='run'?625:name==='idle'?3333:clip.durationMs;
        idx=row*10+Math.floor(elapsed/oldDuration*10)%10;
        if(anticipation[name]) idx=row*10+(selectedFrame??localFrame);
      } else {
        im=images.get(assetRoot+clip.asset);fw=clip.frame.width;fh=clip.frame.height;ax=clip.frame.anchor.x;ay=clip.frame.anchor.y;cols=clip.columns;
        const offset=mirror && ['run','stop','start','jump-run','land-run'].includes(name) ? clip.frames/2 : 0;
        idx=row*clip.directionStride+(frame+offset)%clip.frames;
      }
      ctx.save();ctx.translate(x,anchorY);if(mirror)ctx.scale(-1,1);
      if(!isOld && get('overlay').checked){
        const prev=row*clip.directionStride+(idx-row*clip.directionStride+clip.frames-1)%clip.frames;
        ctx.globalAlpha=.25;ctx.drawImage(im,prev%cols*fw,Math.floor(prev/cols)*fh,fw,fh,-ax*scale,-ay*scale,fw*scale,fh*scale);ctx.globalAlpha=1;
      }
      ctx.drawImage(im,idx%cols*fw,Math.floor(idx/cols)*fh,fw,fh,-ax*scale,-ay*scale,fw*scale,fh*scale);
      if(get('overlay').checked){ctx.strokeStyle='#ffd580';ctx.beginPath();ctx.moveTo(-5,0);ctx.lineTo(5,0);ctx.moveTo(0,-5);ctx.lineTo(0,5);ctx.stroke();}
      ctx.restore();
    }
  }
  get('stats').textContent = `${name} · frame ${frame}/${clip.frames-1} · phase ${phase.toFixed(3)} · ${get('speed').value} tiles/s · ${clip.loop?'boucle':'clip relancé pour inspection'}\n${clip.frame.width}×${clip.frame.height} px/frame · ${(memory/1048576).toFixed(1)} MiB RGBA supplémentaires · aucun calcul d’interpolation en jeu`;
}
window.assassinStudio = { frame(name, frame) {get('clip').value=name;selectedFrame=frame;playing=false;draw();}, play(name) {get('clip').value=name;elapsed=0;distance=0;selectedFrame=null;playing=true;}, manifest };
let previous=performance.now();function tick(now){const dt=Math.min(50,now-previous)*Number(get('rate').value);previous=now;if(playing){elapsed+=dt;distance+=Number(get('speed').value)*dt/1000;}draw();requestAnimationFrame(tick);}requestAnimationFrame(tick);
