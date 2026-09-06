import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const allowed=['/studio/pixel-art/priest-prototype/','/studio/styles/lcpixel/','/packages/renderer/src/assets/bonus/priest-prototype/'];
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.md':'text/plain; charset=utf-8','.json':'application/json','.png':'image/png'};
createServer(async(request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  const file=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  if(!allowed.some(prefix=>pathname.startsWith(prefix))||!file.startsWith(root+path.sep)) {response.writeHead(404).end();return;}
  try {response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(await readFile(file));}
  catch {response.writeHead(404).end();}
}).listen(5330,'127.0.0.1',()=>console.log('Priest studio: http://localhost:5330/studio/pixel-art/priest-prototype/'));
