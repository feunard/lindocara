// Repeatable inspection through the real game controller and renderer. Requires yarn dev.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const out=path.join(repo,'artifacts/assassin-v2/runtime-review');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:5273/?preview=assassin');
  await page.waitForFunction(()=>window.assassinPreview);
  await page.evaluate(()=>{assassinPreview.auto(false);assassinPreview.pause(true);assassinPreview.references(false);});
  const snapshots=[];
  for(let direction=0;direction<8;direction++) {
    await page.evaluate(d=>{assassinPreview.reset();assassinPreview.heading(d*Math.PI/4);assassinPreview.step(.65);},direction);
    await page.screenshot({path:path.join(out,`run-${direction}.png`)});
    await page.evaluate(()=>assassinPreview.jump());
    for(let frame=0;frame<10;frame++) {
      await page.evaluate(()=>assassinPreview.step(.075));
      snapshots.push({direction,frame,state:await page.evaluate(()=>assassinPreview.read())});
      await page.screenshot({path:path.join(out,`jump-${direction}-${frame}.png`)});
    }
    console.log(`Captured run and jump, direction ${direction+1}/8`);
  }
  await page.evaluate(()=>{assassinPreview.reset();assassinPreview.heading(null);assassinPreview.references(true);assassinPreview.step(1);});
  for(let slot=1;slot<=5;slot++) {
    await page.evaluate(s=>assassinPreview.cast(s),slot);
    const duration=await page.evaluate(()=>{assassinPreview.step(.001);const action=assassinPreview.read().action;return action.recoveryEndsAt-action.startedAt;});
    for(let i=0;i<6;i++) {
      await page.evaluate(seconds=>assassinPreview.step(seconds),(duration+35)/6000);
      await page.screenshot({path:path.join(out,`skill-${slot}-${i}.png`)});
    }
    await page.evaluate(()=>assassinPreview.step(3.5));
  }
  const capture=await page.evaluate(async()=>{
    assassinPreview.reset();assassinPreview.references(false);assassinPreview.heading(null);assassinPreview.auto(true);assassinPreview.pause(false);
    const canvas=document.querySelector('#stage');
    const stream=canvas.captureStream(60),chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:4000000});
    recorder.ondataavailable=e=>chunks.push(e.data);
    const done=new Promise(resolve=>{recorder.onstop=resolve;});
    recorder.start();
    await new Promise(resolve=>setTimeout(resolve,12500));
    recorder.stop();await done;stream.getTracks().forEach(track=>track.stop());
    assassinPreview.pause(true);
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  await writeFile(path.join(out,'all-directions.webm'),Buffer.from(capture));
  const front=await page.evaluate(async()=>{
    assassinPreview.auto(false);assassinPreview.reset();assassinPreview.references(false);assassinPreview.heading(0);assassinPreview.pause(false);
    const stream=document.querySelector('#stage').captureStream(60),chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:4000000});
    recorder.ondataavailable=e=>chunks.push(e.data);const done=new Promise(resolve=>{recorder.onstop=resolve;});recorder.start();
    await new Promise(resolve=>setTimeout(resolve,2000));assassinPreview.jump();
    await new Promise(resolve=>setTimeout(resolve,800));assassinPreview.heading(null);
    await new Promise(resolve=>setTimeout(resolve,500));recorder.stop();await done;
    stream.getTracks().forEach(track=>track.stop());assassinPreview.pause(true);
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  await writeFile(path.join(out,'front-run-jump.webm'),Buffer.from(front));
  await writeFile(path.join(out,'samples.json'),JSON.stringify({errors,snapshots},null,2)+'\n');
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(`Captured 8 directions, run/jump/fall/land and all 5 V1 skills for visual review: ${out}`);
} finally {await browser.close();}
