import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { DESIGN, createPriest, gaitFoot, poseAt } from './model.mjs';
import { sourceDigest, digest } from './provenance.mjs';

const root=fileURLToPath(new URL('.',import.meta.url)), repo=resolve(root,'../../..');
const out=resolve(repo,'packages/renderer/src/assets/characters/priest');
const source=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
const manifest=JSON.parse(await readFile(resolve(out,'manifest.json'),'utf8'));
assert.equal(manifest.sourceHash,await sourceDigest(),'Priest sources changed; run yarn priest:build');
for(const [name,hash] of Object.entries(manifest.assets))assert.equal(digest(await readFile(resolve(out,name))),hash,`${name}: modified output; regenerate from source`);
const motion=JSON.parse(await readFile(resolve(out,'motion.json'),'utf8'));
assert.deepEqual(Object.keys(motion.clips),Object.keys(source.clips));
assert.equal(manifest.rig.bones,25);assert.ok(manifest.rig.triangles<30000);
for(const oldPath of ['packages/renderer/src/assets/bonus/priest','studio/pixel-art/refs/priest']){
  const remaining=await readdir(resolve(repo,oldPath)).catch(()=>[]);
  assert.equal(remaining.length,0,`Prototype assets remain in ${oldPath}`);
}
assert.deepEqual(manifest.directions,source.directions);
assert.equal(manifest.directions.length,8);
assert.deepEqual(Object.keys(manifest.clips),Object.keys(source.clips));
assert.equal(manifest.strideDistance,DESIGN.stride);
const files=(await readdir(out)).filter(name=>name.endsWith('.png')).sort();
assert.deepEqual(files,[...Object.keys(source.clips).map(name=>`${name}.png`),'portrait.png'].sort());
const report={clips:[],frames:0,rgbaBytes:0,maxBoneError:0,maxContactDrift:0};
const rig=createPriest();
const norm=(a,b)=>Math.hypot(...a.map((value,index)=>value-b[index]));
for(const [name,clip] of Object.entries(manifest.clips)){
  for(const [key,value] of Object.entries(source.clips[name]))assert.deepEqual(clip[key],value,`${name}.${key}`);
  const frame=clip.frame;
  assert.equal(frame.anchor.x,frame.width/2,`${name}: horizontal crop lost the root`);
  assert.ok(Math.abs(frame.worldHeight/frame.height-source.frame.worldHeight/source.frame.height)<1e-12,`${name}: scale drift`);
  const {data,info}=await sharp(resolve(out,`${name}.png`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,frame.width*clip.columns);assert.equal(info.height,frame.height*8*clip.directionStride/clip.columns);
  assert.ok(info.width<=4096&&info.height<=4096,`${name}: oversized texture`);
  report.rgbaBytes+=data.length;report.frames+=clip.frames*8;
  for(let direction=0;direction<8;direction++){
    const masks=[],areas=[];
    for(let f=0;f<clip.frames;f++){
      let area=0;const mask=[];
      for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){
        const index=((Math.floor((direction*clip.directionStride+f)/clip.columns)*frame.height+y)*info.width+(f%clip.columns)*frame.width+x)*4,a=data[index+3];
        assert.ok(a===0||a===255,`${name}: soft alpha`);mask.push(a);
        if(a){area++;assert.ok(x>0&&y>0&&x<frame.width-1&&y<frame.height-1,`${name}: atlas bleed`);}
      }
      assert.ok(area>500,`${name}/${direction}/${f}: missing body`);masks.push(mask);areas.push(area);
    }
    if(name==='run')assert.ok(Math.max(...areas)/Math.min(...areas)<1.4,`${name}/${direction}: silhouette pulses`);
    const difference=(a,b)=>a.reduce((total,value,index)=>total+(value!==b[index]?1:0),0);
    if(clip.loop){
      const differences=masks.slice(1).map((mask,index)=>difference(mask,masks[index]));
      const seam=difference(masks.at(-1),masks[0]);
      assert.ok(seam<=Math.max(...differences)*1.3+2,`${name}/${direction}: loop seam exceeds adjacent motion`);
    }
  }
  for(let f=0;f<=64;f++){
    const joints=rig.apply(poseAt(name,f/64));
    for(let leg=0;leg<2;leg++){
      const error=Math.max(Math.abs(norm(joints.hips[leg],joints.knees[leg])-DESIGN.thigh),Math.abs(norm(joints.knees[leg],joints.feet[leg])-DESIGN.shin));
      report.maxBoneError=Math.max(report.maxBoneError,error);
      assert.ok(error<0.002,`${name}/${f}: changing leg length (${error})`);
    }
  }
  report.clips.push({name,frames:clip.frames,directions:8,width:info.width,height:info.height});
}
for(const side of [-1,1]){
  let contact=null;
  for(let sample=0;sample<=1000;sample++){
    const phase=sample/1000,foot=gaitFoot(phase,side);
    if(!foot.contact){contact=null;continue;}
    const worldZ=foot.position[2]+phase*DESIGN.stride;
    if(contact!==null){const drift=Math.abs(worldZ-contact);report.maxContactDrift=Math.max(report.maxContactDrift,drift);assert.ok(drift<1e-9,'support foot slides');}
    contact=worldZ;
  }
}
rig.dispose();
assert.ok(report.rgbaBytes<128*1024*1024,'Priest exceeds its 128 MiB decoded texture budget');
const evidence=resolve(repo,'artifacts/priest');await mkdir(evidence,{recursive:true});
await writeFile(resolve(evidence,'validation.json'),`${JSON.stringify(report,null,2)}\n`);
console.log(`${report.frames} frames validated; ${(report.rgbaBytes/1024/1024).toFixed(1)} MiB RGBA; maximum bone error ${report.maxBoneError.toExponential(2)}, support drift ${report.maxContactDrift.toExponential(2)} tiles.`);
