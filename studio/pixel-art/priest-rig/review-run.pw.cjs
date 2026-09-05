// oxlint-disable-next-line no-unused-expressions -- playwright-cli evaluates this function expression.
async (page) => {
  await page.waitForFunction(()=>Boolean(window.priestPreview?.read()));
  await page.evaluate(() => { window.priestPreview.reset();window.priestPreview.auto(false);window.priestPreview.heading(0);window.priestPreview.rate(1);window.priestPreview.pause(false); });
  const result=await page.evaluate(async()=>{
    const frames=[],updates=[];let start=null,ungroundedFrames=0;
    return new Promise(resolve=>{
      function frame(at){start??=at;frames.push(at);window.priestPreview.heading(Math.floor((at-start)/1500)*Math.PI/4);const state=window.priestPreview.read();if(state?.rig)updates.push(state.rig.updateMs);if(state?.swimming||state?.airborne)ungroundedFrames++;
        if(at-start<12000)requestAnimationFrame(frame);else {window.priestPreview.pause(true);updates.sort((a,b)=>a-b);resolve({frames:frames.length,fps:(frames.length-1)*1000/(at-start),cpuMedianMs:updates[Math.floor(updates.length*.5)],cpuP95Ms:updates[Math.floor(updates.length*.95)],ungroundedFrames,state});}}
      requestAnimationFrame(frame);
    });
  });
  await page.screenshot({path:'artifacts/priest/game-run-checked.png'});
  return result;
}
