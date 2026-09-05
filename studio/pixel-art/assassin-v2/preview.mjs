import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const mime = {'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png'};
const server = createServer(async (request,response) => {
  const url = new URL(request.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const allowed = ['/studio/pixel-art/assassin-v2/', '/studio/pixel-art/assassin-v2/sources/v1/', '/packages/renderer/src/assets/bonus/assassin-v2/'];
  const file = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
  if (!allowed.some((prefix) => pathname.startsWith(prefix)) || !file.startsWith(root+path.sep)) {response.writeHead(404).end();return;}
  try {
    const contents = await readFile(file);
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(contents);
  } catch {response.writeHead(404).end();}
});
server.listen(5329,'127.0.0.1',()=>console.log('Assassin animation studio: http://localhost:5329/studio/pixel-art/assassin-v2/'));
