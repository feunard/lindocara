import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function sourceDigest(){
  const hash=createHash('sha256');
  for(const name of ['model.mjs','manifest.json','export-rig.mjs','bake-view.mjs','bake.mjs']){
    hash.update(name);hash.update((await readFile(new URL(name,import.meta.url),'utf8')).replaceAll('\r\n','\n'));
  }
  return hash.digest('hex');
}
export const digest=data=>createHash('sha256').update(data).digest('hex');
