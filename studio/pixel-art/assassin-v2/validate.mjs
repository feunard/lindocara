import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const assets=path.join(repo,'packages/renderer/src/assets/bonus');
const folder=path.join(assets,'assassin-v2');
const manifest=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));
assert.equal(manifest.body,'assassin_v2');
assert.deepEqual(manifest.directions,['front','front-quarter','side','back-quarter','back']);
assert.equal(manifest.strideDistance,2.4);
const digest=(buffer)=>createHash('sha256').update(buffer).digest('hex');
for(const [name,expected] of Object.entries(manifest.sourceSha256)) {
  const buffer=await readFile(path.join(repo,name));
  const data=name.endsWith('.png')?buffer:buffer.toString('utf8').replace(/\r\n/g,'\n');
  assert.equal(digest(data),expected,`Source changed without a bake: ${name}`);
}
const textures=new Map();
for(const [name,clip] of Object.entries(manifest.clips)) {
  assert(clip.frames>0 && Number.isInteger(clip.frames),`${name}: frames`);
  assert(clip.durationMs>0,`${name}: duration`);
  assert.equal(clip.directionRows,5,`${name}: views`);
  assert.equal(clip.frame.anchor.x,clip.frame.width/2,`${name}: centered X anchor`);
  assert(clip.frame.anchor.y>0 && clip.pixelsPerTile>0,`${name}: anchor and scale`);
  if(clip.phaseBuckets) assert.equal(clip.frames,clip.phaseBuckets*clip.transitionFrames,`${name}: phase banks`);
  if('activeFrame' in clip) assert(clip.activeFrame>=0&&clip.activeFrame<clip.frames,`${name}: contact`);
  assert(/^(assassin|assassin-v2)\/[a-z-]+\.png$/.test(clip.asset),`${name}: asset path`);
  let texture=textures.get(clip.asset);
  if(!texture) {
    const buffer=await readFile(path.join(assets,clip.asset));
    const {data,info}=await sharp(buffer).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    texture={data,info,buffer};textures.set(clip.asset,texture);
  }
  const {data,info,buffer}=texture;
  assert.equal(digest(buffer),clip.sha256,`${name}: atlas hash`);
  assert.equal(buffer.length,clip.bytes,`${name}: encoded bytes`);
  assert.equal(data.length,clip.decodedBytes,`${name}: decoded bytes`);
  assert.equal(info.width,clip.columns*clip.frame.width,`${name}: width`);
  assert.equal(info.height,Math.ceil(clip.directionStride/clip.columns)*5*clip.frame.height,`${name}: height`);
  assert(info.width<=4096&&info.height<=4096,`${name}: texture exceeds 4096`);
  assert(clip.directionStride>=clip.frames,`${name}: missing frames`);
  for(let i=3;i<data.length;i+=4) assert(data[i]===0||data[i]===255,`${name}: nonbinary alpha`);
}
function cell(name,row,frame) {
  const clip=manifest.clips[name],texture=textures.get(clip.asset);
  const {width:w,height:h,anchor}=clip.frame,idx=row*clip.directionStride+frame;
  const sx=idx%clip.columns*w,sy=Math.floor(idx/clip.columns)*h;
  const out=Buffer.alloc(192*192*4),ox=96-anchor.x,oy=136-anchor.y;
  assert(ox>=0&&oy>=0&&ox+w<=192&&oy+h<=192,`${name}: fixed canvas reconstruction`);
  let visible=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const s=((sy+y)*texture.info.width+sx+x)*4,d=((oy+y)*192+ox+x)*4;
    if(texture.data[s+3]) {texture.data.copy(out,d,s,s+4);visible++;}
  }
  assert(visible>20,`${name}/${row}/${frame}: empty frame`);
  return out;
}
const original=await sharp(path.join(assets,'assassin/run.png')).ensureAlpha().raw().toBuffer();
const registration=manifest.headRegistration;
assert.equal(registration.direction,'front');
assert.equal(registration.sourceAsset,'assassin/run.png');
assert.equal(registration.sourceFrame,0);
const headMask=new Uint8Array(192*192);
for(const [y,left,right] of registration.maskRows) {
  assert(y>=25&&y<=89&&left>=60&&right<=136,'Head correction must stay above the chest');
  headMask.fill(1,y*192+left,y*192+right);
}
// Compare the complete native hood/face rectangle after undoing only its rigid
// translation. Unlike a centroid check, this catches changing eyes, seams and width.
for(const name of ['run','jump-run','fall','land-run','swim','glide']) {
  const offsets=registration.offsetsY[name];
  assert.equal(offsets.length,manifest.clips[name].frames,`${name}: head registration`);
  for(let f=0;f<offsets.length;f++) {
    const frame=cell(name,0,f),dy=offsets[f];
    assert(Number.isInteger(dy)&&dy>=-3&&dy<=2,`${name}: rigid head travel`);
    for(let y=30;y<79;y++)for(let x=70;x<123;x++) {
      const src=(y*1920+x)*4,dst=((y+dy)*192+x)*4;
      for(let c=0;c<4;c++)assert.equal(frame[dst+c],original[src+3]?original[src+c]:0,`${name}/${f}: hood/eyes changed at ${x},${y}`);
    }
  }
}
const bob=registration.offsetsY.run;
for(let i=0;i<bob.length;i++)assert(Math.abs(bob[(i+1)%bob.length]-bob[i])<=1,'Head moves more than one source pixel, including the loop seam');
for(let r=0;r<5;r++) {
  for(let k=0;k<10;k++) {
    const expected=Buffer.alloc(192*192*4);
    for(let y=0;y<192;y++) for(let x=0;x<192;x++) {
      const s=((r*192+y)*1920+k*192+x)*4,d=(y*192+x)*4;
      if(original[s+3])original.copy(expected,d,s,s+4);
    }
    const actual=cell('run',r,manifest.clips.run.sourceFrames[k]);
    if(r===0) {
      for(let p=0;p<headMask.length;p++)if(headMask[p]) {
        expected.fill(0,p*4,p*4+4);actual.fill(0,p*4,p*4+4);
      }
    }
    assert.deepEqual(actual,expected,`V1 run body anatomy changed: ${r}/${k}`);
  }
  assert.deepEqual(cell('jump',r,11),cell('fall',r,0),'Jump/apex seam');
  assert.deepEqual(cell('fall',r,11),cell('land',r,0),'Fall/landing seam');
  for(let b=0;b<8;b++) {
    assert.deepEqual(cell('jump-run',r,b*8+7),cell('fall',r,0),'Running jump/apex seam');
    assert.deepEqual(cell('land-run',r,b*5),cell('fall',r,11),'Running landing seam');
  }
}
const contacts={'dual-slash':4,'shadow-step':6,vanish:6,'poisoned-shiv':6,'shadow-dance':4};
for(const [name,contact] of Object.entries(contacts)) {
  assert.equal(manifest.clips[name].asset,`assassin/${name}.png`);
  assert.equal(manifest.clips[name].frames,10);
  assert.equal(manifest.clips[name].activeFrame,contact);
}
assert.equal(digest(await readFile(path.join(folder,'idle.png'))),'2d5b5ef7dac003677199220666acbd50652d18f30ae4f93766816bbb55bb7ffd','Approved idle must remain unchanged');
const runtime=new Set(['manifest.json','portrait.png',...Object.values(manifest.clips).filter(c=>c.asset.startsWith('assassin-v2/')).map(c=>path.basename(c.asset))]);
assert.deepEqual((await readdir(folder)).sort(),[...runtime].sort(),'Unused/rejected runtime assets remain');
const bytes=[...textures].filter(([name])=>name.startsWith('assassin-v2/')).reduce((n,[,t])=>n+t.data.length,0);
assert(bytes<=80*1048576,'New atlas memory exceeds the 80 MiB budget');
console.log(`Assassin V2: 8 directions, ${Object.keys(manifest.clips).length} clips, stable front hood/eyes, V1 skills and idle intact; ${(bytes/1048576).toFixed(1)} MiB additional RGBA.`);
