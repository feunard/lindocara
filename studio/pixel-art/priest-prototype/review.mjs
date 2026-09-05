// Visual evidence at the shipped camera, speed, controller and raster renderer.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const out=path.join(repo,'artifacts/priest-prototype/runtime-review');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:5273/?preview=priest');
  await page.waitForFunction(()=>window.priestPreview,undefined,{timeout:60000});
  await page.evaluate(()=>{priestPreview.auto(false);priestPreview.heading(null);priestPreview.pause(true);priestPreview.step(.2);});
  await page.screenshot({path:path.join(out,'lineup.png')});
  await page.evaluate(()=>{priestPreview.heading(Math.PI/2);priestPreview.step(.6);});
  await page.screenshot({path:path.join(out,'run-side-lineup.png')});
  if(!process.argv.includes('--quick')) {
    const launches=await page.evaluate(()=>{
      priestPreview.references(false);
      const results=[];
      for(const delay of [0,100,200]) for(let direction=0;direction<8;direction++) for(const slot of [1,2]) {
        priestPreview.reset();priestPreview.heading(direction*Math.PI/4);priestPreview.step(.1);
        priestPreview.heading(null);priestPreview.step(.2);priestPreview.projectileDelay(delay);priestPreview.cast(slot);
        let first=null;
        for(let i=0;i<90;i++) {
          priestPreview.step(1/120);
          const state=priestPreview.read();
          const projectile=state.projectilePresentation.projectiles.find(p=>p.launch&&Math.abs(p.launch.startedAt-state.now)<.001);
          if(projectile) {
            const muzzle=state.projectilePresentation.muzzles.find(m=>m.id===state.action?.id)
              ??state.projectilePresentation.muzzles.find(m=>Math.hypot(m.position.x-projectile.x,m.position.y-projectile.y,m.position.z-projectile.z)<.000001);
            first={delay,direction,slot,now:state.now,projectile,muzzle};break;
          }
        }
        results.push(first??{delay,direction,slot,missing:true});priestPreview.step(2);
      }
      priestPreview.projectileDelay(0);
      return results;
    });
    for(const launch of launches) {
      assert.ok(!launch.missing,JSON.stringify(launch));
      assert.ok(launch.muzzle,'Missing muzzle '+JSON.stringify(launch));
      const p=launch.projectile,m=launch.muzzle.position;
      assert.ok(Math.hypot(p.x-m.x,p.y-m.y,p.z-m.z)<.000001,'Projectile missed staff ruby');
    }
    await writeFile(path.join(out,'weapon-launches.json'),JSON.stringify(launches,null,2)+'\n');
    console.log(`${launches.length} weapon launches matched the displayed ruby (8 directions, 0/100/200 ms delay).`);
  }
  if(!process.argv.includes('--quick')&&!process.argv.includes('--launches')) {
    const samples=[];
    await page.evaluate(()=>priestPreview.references(false));
    for(let direction=0;direction<8;direction++) {
      await page.evaluate(d=>{priestPreview.reset();priestPreview.heading(d*Math.PI/4);priestPreview.step(.7);},direction);
      for(let frame=0;frame<12;frame++) {
        await page.evaluate(()=>priestPreview.step(.04));
        await page.screenshot({path:path.join(out,`run-${direction}-${frame}.png`),clip:{x:480,y:300,width:340,height:290}});
      }
      await page.evaluate(()=>priestPreview.jump());
      for(let frame=0;frame<10;frame++) {
        await page.evaluate(()=>priestPreview.step(.075));
        samples.push({direction,frame,state:await page.evaluate(()=>priestPreview.read())});
        await page.screenshot({path:path.join(out,`jump-${direction}-${frame}.png`),clip:{x:480,y:300,width:340,height:290}});
      }
      await page.evaluate(()=>{priestPreview.heading(null);priestPreview.step(.3);});
      for(let slot=1;slot<=5;slot++) {
        await page.evaluate(s=>priestPreview.cast(s),slot);
        for(let frame=0;frame<8;frame++) {
          await page.evaluate(seconds=>priestPreview.step(seconds),[.045,.1,.08,.12,.14][slot-1]);
          await page.screenshot({path:path.join(out,`skill-${direction}-${slot}-${frame}.png`),clip:{x:480,y:300,width:340,height:290}});
        }
        await page.evaluate(()=>priestPreview.step(1));
      }
      await page.evaluate(()=>priestPreview.die());
      for(let frame=0;frame<10;frame++) {
        await page.evaluate(()=>priestPreview.step(.12));
        await page.screenshot({path:path.join(out,`death-${direction}-${frame}.png`),clip:{x:480,y:300,width:340,height:290}});
      }
      console.log(`Captured direction ${direction+1}/8`);
    }
    const extra=[];
    await page.evaluate(()=>{priestPreview.reset();priestPreview.heading(Math.PI/2);priestPreview.step(.5);priestPreview.hurt();priestPreview.step(.05);});
    extra.push({name:'hurt',state:await page.evaluate(()=>priestPreview.read())});
    await page.screenshot({path:path.join(out,'hurt.png')});
    await page.evaluate(()=>{priestPreview.water();priestPreview.step(.5);});
    extra.push({name:'swim',state:await page.evaluate(()=>priestPreview.read())});
    await page.screenshot({path:path.join(out,'swim.png')});
    await page.evaluate(()=>{priestPreview.reset();priestPreview.heading(Math.PI/2);priestPreview.step(.4);priestPreview.jump();priestPreview.step(.24);priestPreview.jump();priestPreview.step(.1);});
    extra.push({name:'glide',state:await page.evaluate(()=>priestPreview.read())});
    await page.screenshot({path:path.join(out,'glide.png')});
    await page.evaluate(()=>{priestPreview.reset();priestPreview.party(4);priestPreview.step(.8);});
    await page.screenshot({path:path.join(out,'four-priests.png')});
    await page.evaluate(()=>priestPreview.party(1));
    await writeFile(path.join(out,'samples.json'),JSON.stringify({errors,samples,extra},null,2)+'\n');
    const recording=await page.evaluate(async()=>{
      priestPreview.reset();priestPreview.heading(null);priestPreview.auto(true);priestPreview.pause(false);
      const stream=document.querySelector('#stage').captureStream(60), chunks=[];
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:4000000});
      recorder.ondataavailable=e=>chunks.push(e.data);
      const done=new Promise(resolve=>{recorder.onstop=resolve;});recorder.start();
      await new Promise(resolve=>setTimeout(resolve,12500));recorder.stop();await done;
      stream.getTracks().forEach(track=>track.stop());priestPreview.pause(true);
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    });
    await writeFile(path.join(out,'all-directions.webm'),Buffer.from(recording));
  }
  assert.deepEqual(errors,[],'Browser exceptions');
  console.log(`Screenshots ready for inspection: ${out}`);
} finally { await browser.close(); }
