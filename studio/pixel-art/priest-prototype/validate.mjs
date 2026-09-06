import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const folder=path.join(repo,'packages/renderer/src/assets/bonus/priest-prototype');
const manifest=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));
const names=['idle','run','jump','jump-run','fall','land','land-run','start','stop','hurt','swim','glide','radiant-bolt','mend','blink','prayer','divine-nova','death'];
assert.equal(manifest.body,'priest');
assert.equal(manifest.style,'LCPixel');
assert.equal(manifest.version,2);
assert.equal(manifest.headRegistration,undefined,'Rectangular head replacement must not return');
assert(manifest.palette.length<=64&&manifest.palette.length>0,'LCPixel palette budget');
const palette=new Set(manifest.palette.map(rgb=>rgb.join(',')));
assert.deepEqual(Object.keys(manifest.clips).sort(),names.sort(),'Incomplete animation state graph');
assert.deepEqual(manifest.directions,['front','front-quarter','side','back-quarter','back']);
assert.deepEqual(manifest.sourceFrame,{width:256,height:256,anchor:{x:128,y:190}});
assert.equal(manifest.pixelsPerTile,192/2.34);
assert.equal(manifest.clips.run.durationMs,manifest.strideDistance/manifest.referenceSpeed*1000);
const digest=data=>createHash('sha256').update(data).digest('hex');
for(const [name,hash] of Object.entries(manifest.sourceSha256)){
  assert(!name.includes('priest-rig')&&!name.includes('characters/priest'),'Old Priest dependency');
  const buffer=await readFile(path.join(repo,name));
  assert.equal(digest(name.endsWith('.png')?buffer:buffer.toString('utf8').replace(/\r\n/g,'\n')),hash,`Unbaked source: ${name}`);
}
const textures=new Map(),cells=new Map();
for(const [name,c] of Object.entries(manifest.clips)){
  assert(c.frames>0&&Number.isInteger(c.frames)&&c.durationMs>0,`${name}: duration/count`);
  assert.equal(c.directionRows,5,`${name}: directions`);
  assert.equal(c.directionStride,c.frames,`${name}: missing frames`);
  assert.equal(c.frame.anchor.x,c.frame.width/2,`${name}: centered anchor`);
  assert.equal(c.pixelsPerTile,manifest.pixelsPerTile,`${name}: scale drift`);
  assert(/^priest-prototype\/[a-z-]+\.png$/.test(c.asset),`${name}: old or unexpected path`);
  if(c.phaseBuckets)assert.equal(c.frames,c.phaseBuckets*c.transitionFrames,`${name}: transition bank`);
  if(c.activeFrame!==undefined)assert(c.activeFrame>0&&c.activeFrame<c.frames-1,`${name}: anticipation and recovery`);
  let texture=textures.get(c.asset);
  if(!texture){
    const buffer=await readFile(path.join(folder,path.basename(c.asset)));
    const {data,info}=await sharp(buffer).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    texture={buffer,data,info};textures.set(c.asset,texture);
    const colours=new Set();
    for(let p=3;p<data.length;p+=4){
      assert(data[p]===0||data[p]===255,`${name}: soft alpha`);
      if(data[p])colours.add(`${data[p-3]},${data[p-2]},${data[p-1]}`);
    }
    for(const rgb of colours)assert(palette.has(rgb),`${name}: colour outside the locked LCPixel palette`);
  }
  const {buffer,data,info}=texture;
  assert.equal(digest(buffer),c.sha256,`${name}: atlas hash`);
  assert.equal(buffer.length,c.bytes);assert.equal(data.length,c.decodedBytes);
  assert.equal(info.width,c.columns*c.frame.width);
  assert.equal(info.height,c.frames/c.columns*5*c.frame.height);
  assert(info.width<=4096&&info.height<=4096,`${name}: GPU texture limit`);
  const {width:w,height:h,anchor:a}=c.frame,ox=128-a.x,oy=190-a.y;
  assert(ox>=0&&oy>=0&&ox+w<=256&&oy+h<=256,`${name}: source reconstruction`);
  const rows=[];
  for(let r=0;r<5;r++){
    const row=[];
    for(let f=0;f<c.frames;f++){
      const idx=r*c.directionStride+f,sx=idx%c.columns*w,sy=Math.floor(idx/c.columns)*h;
      const frame=Buffer.alloc(256*256*4);let visible=0;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const source=((sy+y)*info.width+sx+x)*4,dest=((oy+y)*256+ox+x)*4;
        if(data[source+3]){visible++;data.copy(frame,dest,source,source+4);}
      }
      assert(visible>300,`${name}/${r}/${f}: missing/empty frame`);
      const socket=c.weaponSockets[r]?.[f];
      assert(socket&&Number.isFinite(socket.x)&&Number.isFinite(socket.y),`${name}/${r}/${f}: socket`);
      assert(socket.x>0&&socket.x<256&&socket.y>0&&socket.y<256,`${name}: socket outside canvas`);
      if(['radiant-bolt','mend'].includes(name)&&f===c.activeFrame){
        assert(socket.y<145,`${name}/${r}: projectile incorrectly emitted at the feet`);
        let orb=false;
        for(let y=Math.floor(socket.y)-6;y<=Math.ceil(socket.y)+6;y++)for(let x=Math.floor(socket.x)-6;x<=Math.ceil(socket.x)+6;x++){
          const p=(y*256+x)*4;const red=frame[p],green=frame[p+1],blue=frame[p+2];
          if(red>165&&green>110&&red-blue>85&&green>blue*1.45&&frame[p+3])orb=true;
        }
        assert(orb,`${name}/${r}: release socket must touch the visible gold staff orb`);
      }
      row.push(frame);
    }
    rows.push(row);
  }
  cells.set(name,rows);
}
const frame=(name,row,f)=>cells.get(name)[row][f];
function difference(a,b){let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;}
const seamReport=[];
for(let r=0;r<5;r++){
  const direction=manifest.directions[r];
  const motion=manifest.motionTracks[direction];
  assert.equal(motion.length,36,`${direction}: whole-body motion track coverage`);
  const chest=motion.map(p=>p.upperMotion[1]);
  assert(Math.max(...chest)-Math.min(...chest)>2,`${direction}: chest motion frozen`);
  for(let f=0;f<36;f++){
    const a=motion[f],b=motion[(f+1)%36];
    assert(a.upperMotion.every(Number.isFinite)&&a.pelvis.every(Number.isFinite),`${direction}: invalid movement`);
    assert(Math.abs(a.upperMotion[0]-b.upperMotion[0])<.035,`${direction}: abrupt chest rotation`);
    assert(Math.hypot(a.upperMotion[1]-b.upperMotion[1],a.upperMotion[2]-b.upperMotion[2])<2,`${direction}: upper body jump`);
  }
  for(const name of ['idle','run','swim','glide']){
    const row=cells.get(name)[r],seam=difference(row.at(-1),row[0]);
    const largest=Math.max(...row.slice(1).map((f,i)=>difference(f,row[i])));
    assert(seam<=largest*1.35+.02,`${name}/${direction}: loop discontinuity`);
    seamReport.push({name,direction,seam,largestStep:largest});
  }
  assert.deepEqual(frame('jump',r,11),frame('fall',r,0),'Jump/apex continuity');
  assert.deepEqual(frame('fall',r,11),frame('land',r,0),'Fall/land continuity');
  assert.deepEqual(frame('land',r,11),frame('idle',r,0),'Landing/rest continuity');
  for(let b=0;b<8;b++){
    assert.deepEqual(frame('jump-run',r,b*8+7),frame('fall',r,0),'Moving takeoff/apex continuity');
    assert.deepEqual(frame('land-run',r,b*5),frame('fall',r,11),'Moving landing continuity');
    assert.deepEqual(frame('stop',r,b*4+3),frame('idle',r,0),'Stop/rest continuity');
  }
  assert.deepEqual(frame('death',r,39),frame('death',r,38),'Corpse must stay still');
  for(const kind of ['run','cast']){
    const reg=manifest.registration[direction][kind];
    for(const pose of reg){
      assert.equal(pose.scale,reg[0].scale,`${kind}: per-frame body resizing`);
      assert(pose.scale>.15&&pose.scale<.5,`${kind}/${direction}: invalid source registration`);
      assert.equal(pose.torsoScale,undefined,`${kind}: separate torso stretching`);
      assert.equal(pose.legScale,undefined,`${kind}: separate leg stretching`);
    }
  }
}
const expected=new Set(['manifest.json','portrait.png',...Object.values(manifest.clips).map(c=>path.basename(c.asset))]);
assert.deepEqual((await readdir(folder)).sort(),[...expected].sort(),'Unexpected runtime assets');
for(const legacy of ['packages/renderer/src/assets/characters/priest','packages/renderer/src/hd2d/priest-sprites.ts','studio/pixel-art/priest-rig','packages/renderer/src/assets/bonus/assassin']){
  await assert.rejects(access(path.join(repo,legacy)),`${legacy} still exists`);
}
const bytes=[...textures.values()].reduce((sum,t)=>sum+t.data.length,0);
assert(bytes<=176*1048576,'Priest atlas budget exceeded');
console.log(`Priest LCPixel: 8 directions, ${names.length} clips, whole-body motion, fixed palette, continuous air/ground endpoints, gold weapon release sockets, ${(bytes/1048576).toFixed(1)} MiB shared RGBA.`);
console.log(`Loop seams checked: ${seamReport.length}. Visual inspection remains required; image metrics do not certify biomechanics.`);
