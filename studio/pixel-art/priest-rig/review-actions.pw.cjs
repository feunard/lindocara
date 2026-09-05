// oxlint-disable-next-line no-unused-expressions -- playwright-cli evaluates this function expression.
async (page) => {
  await page.waitForFunction(()=>Boolean(window.priestPreview?.read()));
  await page.evaluate(()=>{window.priestPreview.reset();window.priestPreview.auto(false);window.priestPreview.heading(Math.PI/2);window.priestPreview.rate(1);window.priestPreview.pause(false);});
  const waitGame=async ms=>page.evaluate(ms=>new Promise(resolve=>{window.priestPreview.pause(false);const start=window.priestPreview.read().now;function tick(){if(window.priestPreview.read().now-start>=ms){window.priestPreview.pause(true);resolve();}else requestAnimationFrame(tick);}requestAnimationFrame(tick);}),ms);
  const samples=[];
  for(const slot of [1,2,3,4,5]){
    await page.evaluate(slot=>{window.priestPreview.reset();window.priestPreview.cast(slot,slot===3?500:0);},slot);
    await waitGame(slot===1?150:slot===5?400:240);
    await page.screenshot({path:`artifacts/priest/game-skill-${slot}.png`});
    samples.push(await page.evaluate(()=>window.priestPreview.read()));
    await waitGame(1100);
  }
  await page.evaluate(()=>{window.priestPreview.reset();window.priestPreview.heading(0);window.priestPreview.jump();});await waitGame(250);
  await page.screenshot({path:'artifacts/priest/game-jump.png'});await waitGame(700);
  await page.evaluate(()=>{window.priestPreview.heading(null);window.priestPreview.auto(false);window.priestPreview.die();});
  for(const [index,ms] of [[0,80],[1,150],[2,150],[3,150],[4,200],[5,300]]){await waitGame(ms);await page.screenshot({path:`artifacts/priest/game-death-${index}.png`});}
  return samples;
}
