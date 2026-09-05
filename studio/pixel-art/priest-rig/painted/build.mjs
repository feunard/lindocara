import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const output = fileURLToPath(new URL('../../../../packages/renderer/src/assets/characters/priest/', import.meta.url));
const views = ['front', 'front-right', 'right', 'back-right', 'back'];
const names = ['head', 'torso', 'arm', 'thigh', 'boot', 'staff'];
// Measured shoulder, elbow and fist centres on each source. Unbend the source drawing before
// letting the rig bend it: retaining the illustrated arm's bend would apply it a second time.
const arms = [
  [[1243,115],[1248,272],[1250,414]], [[1216,118],[1248,275],[1295,412]],
  [[1218,120],[1215,270],[1221,405]], [[1217,110],[1220,260],[1300,397]],
  [[1245,113],[1244,278],[1242,404]],
];
function straightenArm(bytes, info, box, direction) {
  const anchors=arms[direction], target=[0,.10,.53,.87,1];
  const ys=[box.top, ...anchors.map(p=>p[1]), box.top+box.height-1];
  const xs=[anchors[0][0], ...anchors.map(p=>p[0]), anchors[2][0]];
  const data=Buffer.alloc(box.width*box.height*4);
  for(let y=0;y<box.height;y++){
    const v=y/(box.height-1);let segment=0;
    while(segment<3&&v>target[segment+1])segment++;
    const t=(v-target[segment])/(target[segment+1]-target[segment]);
    const sy=Math.round(ys[segment]+(ys[segment+1]-ys[segment])*t);
    const cx=xs[segment]+(xs[segment+1]-xs[segment])*t;
    for(let x=0;x<box.width;x++){
      const sx=Math.round(cx+x-box.width/2);
      if(sx<box.left||sx>=box.left+box.width||sy<box.top||sy>=box.top+box.height)continue;
      bytes.copy(data,(y*box.width+x)*4,(sy*info.width+sx)*4,(sy*info.width+sx)*4+4);
    }
  }
  return sharp(data,{raw:{width:box.width,height:box.height,channels:4}}).trim({threshold:1});
}
const size = 256;
export async function buildPainting() {
const layers = [], parts = [];
for (const [direction, view] of views.entries()) {
  const source = await readFile(`${root}/${view}-source.png`);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // The sources deliberately contain no magenta costume pixels. Remove the key and its mixed
  // edge pixels before scaling, so magenta cannot contaminate the final pixel-art outline.
  for (let i = 0; i < data.length; i += 4) {
    const spill = Math.max(0, Math.min(data[i], data[i + 2]) - data[i + 1] - 20);
    const alpha = Math.max(0, 1 - spill / 180);
    if (alpha < 0.45) data[i + 3] = 0;
    else {
      data[i] = Math.max(0, data[i] - spill);
      data[i + 2] = Math.max(0, data[i + 2] - spill);
      data[i + 3] = 255;
    }
  }
  const image = sharp(data, { raw: info });
  const row = {};
  for (const [index, name] of names.entries()) {
    const cell = { left: index % 3 * 512, top: index < 3 ? 0 : 512, width: 512, height: 512 };
    if (name === 'arm') cell.height = 460;
    // The staff deliberately spans above the nominal row to keep the entire long shaft readable.
    if (name === 'staff') { cell.top = 460; cell.height = 564; }
    const rgba = await image.clone().extract(cell).raw().toBuffer();
    let left = cell.width, top = cell.height, right = 0, bottom = 0;
    for (let y = 0; y < cell.height; y++) for (let x = 0; x < cell.width; x++) {
      if (!rgba[(y * cell.width + x) * 4 + 3]) continue;
      left = Math.min(left, x); right = Math.max(right, x + 1);
      top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
    }
    if (left >= right) throw new Error(`Empty painted part: ${view}/${name}`);
    let width = right - left, height = bottom - top;
    const box={left:cell.left+left,top:cell.top+top,width,height};
    let piece=image.clone().extract(box);
    if(name==='arm'){
      const normalized=await straightenArm(data,info,box,direction).png().toBuffer();
      piece=sharp(normalized);const m=await piece.metadata();width=m.width;height=m.height;
    }
    const fit = Math.min(240 / width, 240 / height);
    const w = Math.round(width * fit), h = Math.round(height * fit);
    const tile = await piece.resize(w, h).png().toBuffer();
    const x = index * size + Math.floor((size - w) / 2), y = direction * size + Math.floor((size - h) / 2);
    layers.push({ input: tile, left: x, top: y });
    row[name] = { x, y, width: w, height: h, aspect: width / height,
      source: { x: box.left, y: box.top, width: box.width, height: box.height } };
  }
  parts.push(row);
}
await sharp({ create: { width: size * 6, height: size * 5, channels: 4, background: '#00000000' } })
  .composite(layers).png().toFile(`${output}/painted.png`);
await writeFile(`${output}/painted.json`, JSON.stringify({ version: 1, width: size * 6, height: size * 5, views, parts }, null, 2) + '\n');
console.log('Painted Priest: 5 views × 6 articulated parts, 1536 × 1280 texture');
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) await buildPainting();
