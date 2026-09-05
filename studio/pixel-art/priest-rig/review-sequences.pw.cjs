// oxlint-disable-next-line no-unused-expressions -- playwright-cli evaluates this function expression.
async (page) => {
  await page.waitForFunction(()=>Boolean(window.priestPreview?.read()));
  await page.evaluate(()=>{const p=window.priestPreview;p.reset();p.party(1);p.auto(false);p.heading(Math.PI/2);p.pause(true);p.rate(1);p.step(.5);});
  const shots=[];
  const shot=async(name,seconds)=>{
    await page.evaluate(seconds=>window.priestPreview.step(seconds),seconds);
    await page.screenshot({path:`artifacts/priest/${name}.png`,clip:{x:480,y:235,width:320,height:230}});
    shots.push({name,state:await page.evaluate(()=>window.priestPreview.read())});
  };
  for(let i=0;i<12;i++)await shot(`review-run-${i}`,1.72/3.65625/10);
  await page.evaluate(()=>window.priestPreview.heading(-Math.PI/2));
  for(let i=0;i<6;i++)await shot(`review-turn-${i}`,1/30);
  await page.evaluate(()=>{window.priestPreview.heading(null);window.priestPreview.auto(false);});
  for(let i=0;i<5;i++)await shot(`review-stop-${i}`,1/30);
  await page.evaluate(()=>{window.priestPreview.reset();window.priestPreview.heading(0);window.priestPreview.jump();});
  for(let i=0;i<10;i++)await shot(`review-jump-${i}`,.08);
  await page.evaluate(()=>{window.priestPreview.reset();window.priestPreview.heading(null);window.priestPreview.step(.2);window.priestPreview.die();});
  for(let i=0;i<9;i++)await shot(`review-death-${i}`,i===8?1:.14);
  for(let slot=1;slot<=5;slot++){
    await page.evaluate(slot=>{const p=window.priestPreview;p.reset();p.heading(Math.PI/2);p.step(.4);p.cast(slot,slot===3?300:0,{x:-1,z:0});},slot);
    for(let i=0;i<5;i++)await shot(`review-cast-${slot}-${i}`,slot===1?.07:.18);
  }
  await page.evaluate(()=>{const p=window.priestPreview;p.reset();p.heading(0);p.jump();p.step(.15);p.jump();});
  for(let i=0;i<6;i++)await shot(`review-glide-${i}`,.16);
  await page.evaluate(()=>window.priestPreview.water());
  for(let i=0;i<6;i++)await shot(`review-swim-${i}`,.16);
  await page.evaluate(()=>{window.priestPreview.reset();window.priestPreview.hurt();});
  for(let i=0;i<4;i++)await shot(`review-hurt-${i}`,.05);
  return shots;
}
