import sharp from 'sharp';
import {readFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const repository=fileURLToPath(new URL('../../../',import.meta.url));
const evidence=resolve(repository,'artifacts/priest');
const output=resolve(repository,'studio/pixel-art/priest-rig/review');
await mkdir(output,{recursive:true});
const label=(text,width=320,height=24)=>Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#17252d"/><text x="8" y="16" font-family="monospace" font-size="12" fill="#ecddbb">${text}</text></svg>`);
for(const [name,rows] of Object.entries({
  locomotion:[['run',12],['turn',6],['stop',5],['jump',10]],
  actions:[['cast-1',5],['cast-2',5],['cast-3',5],['cast-4',5],['cast-5',5],['death',9],['glide',6],['swim',6],['hurt',4]],
})){
  const tiles=[];let row=0;
  for(const [action,count] of rows){
    for(let i=0;i<count;i++){
      const col=i%6,r=row+Math.floor(i/6);
      const data=await sharp(resolve(evidence,`review-${action}-${i}.png`)).png().toBuffer();
      tiles.push({input:data,left:col*320,top:r*254+24});
      tiles.push({input:label(`${action} / ${i}`),left:col*320,top:r*254});
    }
    row+=Math.ceil(count/6);
  }
  await sharp({create:{width:1920,height:row*254,channels:4,background:'#17252d'}}).composite(tiles).png().toFile(resolve(output,`${name}.png`));
}
// Every delivered action, direction and key phase, reconstructed onto the same canvas and anchor.
const assets=resolve(repository,'packages/renderer/src/assets/characters/priest');
const manifest=JSON.parse(await readFile(resolve(assets,'manifest.json'),'utf8'));
for(const [page,actions] of [Object.keys(manifest.clips).slice(0,7),Object.keys(manifest.clips).slice(7)].entries()){
  const tiles=[];let row=0;
  for(const action of actions){
    const config=manifest.clips[action],f=config.frame;
    for(let dir=0;dir<8;dir++)for(let key=0;key<3;key++){
      const frame=Math.round((config.frames-1)*key/2);
      const pose=await sharp(resolve(assets,`${action}.png`)).extract({left:frame%config.columns*f.width,top:Math.floor((dir*config.directionStride+frame)/config.columns)*f.height,width:f.width,height:f.height}).toBuffer();
      const canvas=await sharp({create:{width:160,height:160,channels:4,background:'#344b45'}}).composite([{input:pose,left:80-f.anchor.x,top:116-f.anchor.y}]).png().toBuffer();
      tiles.push({input:canvas,left:dir*160,top:(row+key)*184+24});
      tiles.push({input:label(`${action} ${dir}/${frame}`,160),left:dir*160,top:(row+key)*184});
    }
    row+=3;
  }
  await sharp({create:{width:1280,height:row*184,channels:4,background:'#17252d'}}).composite(tiles).png().toFile(resolve(output,`coverage-${page}.png`));
}
console.log(`Review sheets: ${output}`);
