import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { sourceDigest, digest } from './provenance.mjs';

const root=fileURLToPath(new URL('.',import.meta.url));
const repository=resolve(root,'../../..');
const out=resolve(repository,'packages/renderer/src/assets/characters/priest');
const evidence=resolve(repository,'artifacts/priest');
const args=new Set(process.argv.slice(2));
const server=await createServer({configFile:false,root,server:{host:'127.0.0.1',port:0,hmr:args.has('--serve'),fs:{allow:[repository]}}});
await server.listen();
const url=server.resolvedUrls.local[0];
if(args.has('--serve')){
  console.log(`Priest studio: ${url}`);
} else {
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const page=await browser.newPage();page.on('pageerror',error=>console.error(error));
    await page.goto(`${url}?bake=1`);await page.waitForFunction(()=>Boolean(window.priestBaker));
    await mkdir(out,{recursive:true});await mkdir(evidence,{recursive:true});
    const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
    const cell=manifest.frame.width,anchor=manifest.frame.anchor;
    const previous=await readFile(resolve(out,'manifest.json'),'utf8').then(JSON.parse).catch(()=>null);
    const runtime=structuredClone(manifest);
    runtime.sourceHash=await sourceDigest();
    runtime.assets=previous?.assets??{};
    for(const [name,clip] of Object.entries(runtime.clips)) clip.frame=previous?.clips[name]?.frame??manifest.frame;
    const outputs=[];
    const rig=await page.evaluate(()=>window.exportPriestRig());
    outputs.push({path:resolve(out,'rig.glb'),data:Buffer.from(rig.binary,'base64')});
    outputs.push({path:resolve(out,'motion.json'),data:JSON.stringify(rig.motion)});
    console.log(`Rig: ${JSON.stringify(rig.stats)}`);
    runtime.rig=rig.stats;
    const portraitFrame=await page.evaluate(()=>window.priestBaker.draw('idle',0,0).canvas.toDataURL('image/png').split(',')[1]);
    const portrait=await sharp({create:{width:192,height:192,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:Buffer.from(portraitFrame,'base64'),left:16,top:32}]).png().toBuffer();
    outputs.push({path:resolve(out,'portrait.png'),data:portrait});
    for(const action of Object.keys(manifest.clips)){
      const result=await page.evaluate(action=>window.priestBaker.clip(action),action);
      const image=Buffer.from(result.png,'base64');
      const {data,info}=await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      let left=cell,top=cell,right=0,bottom=0;
      for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]){
        const fx=x%cell,fy=y%cell;left=Math.min(left,fx);top=Math.min(top,fy);right=Math.max(right,fx+1);bottom=Math.max(bottom,fy+1);
      }
      if(left<1||top<1||right>cell-1||bottom>cell-1)throw new Error(`${action}: source canvas clips the silhouette (${left},${top},${right},${bottom})`);
      // One union crop for the entire clip, symmetric about the authored X anchor. The world
      // pixel size and the recovered origin are invariant across actions; no per-frame fitting.
      left=Math.max(0,Math.min(left-2,cell-right-2));top=Math.max(0,top-2);bottom=Math.min(cell,bottom+2);
      const width=cell-2*left,height=bottom-top,frames=manifest.clips[action].frames;
      const columns=Math.min(frames,Math.floor(4096/width)),directionStride=Math.ceil(frames/columns)*columns;
      const tiles=[];
      for(let row=0;row<8;row++)for(let col=0;col<frames;col++)tiles.push({
        input:await sharp(image).extract({left:col*cell+left,top:row*cell+top,width,height}).png().toBuffer(),left:(col%columns)*width,top:(row*Math.ceil(frames/columns)+Math.floor(col/columns))*height,
      });
      const packed=await sharp({create:{width:width*columns,height:height*8*Math.ceil(frames/columns),channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(tiles).png().toBuffer();
      outputs.push({path:resolve(out,`${action}.png`),data:packed});
      runtime.clips[action].frame={width,height,anchor:{x:width/2,y:anchor.y-top},worldHeight:height*manifest.frame.worldHeight/cell,trimmed:true};
      runtime.clips[action].columns=columns;runtime.clips[action].directionStride=directionStride;
      await writeFile(resolve(evidence,`${action}-joints.json`),JSON.stringify(result.records));
      console.log(`${action}: ${manifest.clips[action].frames} × 8 frames`);
    }
    for(const output of outputs){await writeFile(output.path,output.data);runtime.assets[output.path.split(/[\\/]/).pop()]=digest(output.data);}
    await writeFile(resolve(out,'manifest.json'),`${JSON.stringify(runtime,null,2)}\n`);
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:60_000});
    await page.waitForFunction(()=>Boolean(window.priestStudioReady),null,{timeout:60_000});
    await page.screenshot({path:resolve(evidence,'studio.png'),fullPage:true});
    await import('./validate.mjs');
  } finally {await browser.close();await server.close();}
}
