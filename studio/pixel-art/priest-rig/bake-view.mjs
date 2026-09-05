import * as THREE from 'three';
import manifest from './manifest.json';
import { DESIGN, createPriest, poseAt } from './model.mjs';
import { exportRig } from './export-rig.mjs';

export function createBaker() {
  const size = DESIGN.canvas;
  const scene = new THREE.Scene();
  const rig = createPriest(); scene.add(rig.root);
  const camera = new THREE.OrthographicCamera(-DESIGN.extent/2, DESIGN.extent/2, DESIGN.extent/2, -DESIGN.extent/2, 0.1, 20);
  const target = new THREE.Vector3(0, (DESIGN.anchor[1] / size - 0.5) * DESIGN.extent / Math.cos(DESIGN.cameraPitch), 0);
  camera.position.copy(target).add(new THREE.Vector3(0, Math.sin(DESIGN.cameraPitch)*8, Math.cos(DESIGN.cameraPitch)*8)); camera.lookAt(target);
  scene.add(new THREE.AmbientLight(0xffffff, 1.05));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0); sun.position.set(-3, 6, 4); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xbad4e3, 0.6); fill.position.set(4, 2, -3); scene.add(fill);
  const renderer = new THREE.WebGLRenderer({alpha:true, antialias:false, preserveDrawingBuffer:true});
  renderer.setSize(size * 2, size * 2); renderer.setPixelRatio(1); renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const buffer = document.createElement('canvas'); buffer.width = buffer.height = size*2;
  const ctx = buffer.getContext('2d', {willReadFrequently:true});
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const output = canvas.getContext('2d');
  function draw(action, phase, direction=0) {
    const joints = structuredClone(rig.apply(poseAt(action, phase), direction * Math.PI / 4));
    renderer.render(scene, camera); ctx.clearRect(0,0,size*2,size*2); ctx.drawImage(renderer.domElement,0,0);
    const pixels = ctx.getImageData(0,0,size*2,size*2).data, reduced = new Uint8ClampedArray(size*size*4);
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
      let a=0,r=0,g=0,b=0;
      for(let dy=0;dy<2;dy++) for(let dx=0;dx<2;dx++) {
        const index = ((y*2+dy)*size*2+x*2+dx)*4, alpha=pixels[index+3]/255;
        a+=alpha;r+=pixels[index]*alpha;g+=pixels[index+1]*alpha;b+=pixels[index+2]*alpha;
      }
      const i=(y*size+x)*4;
      if(a>=2) { reduced[i]=Math.round(r/a/4)*4;reduced[i+1]=Math.round(g/a/4)*4;reduced[i+2]=Math.round(b/a/4)*4;reduced[i+3]=255; }
    }
    // A single global silhouette edge. Never crop, re-centre or scale a frame.
    const edged = new Uint8ClampedArray(reduced);
    for(let y=1;y<size-1;y++) for(let x=1;x<size-1;x++) {
      const i=(y*size+x)*4;
      if(!reduced[i+3] && [i-4,i+4,i-size*4,i+size*4].some(j=>reduced[j+3])) {
        edged[i]=32;edged[i+1]=38;edged[i+2]=54;edged[i+3]=255;
      }
    }
    output.putImageData(new ImageData(edged,size,size),0,0);
    const project = p => { const n = new THREE.Vector3(...p).project(camera); return [(n.x+1)*size/2,(1-n.y)*size/2]; };
    return { canvas, joints, screen: { feet:joints.feet.map(project), pelvis:project(joints.pelvis), head:project(joints.head) } };
  }
  function clip(action) {
    const config=manifest.clips[action], atlas=document.createElement('canvas');
    atlas.width=size*config.frames;atlas.height=size*manifest.directions.length;
    const context=atlas.getContext('2d'), records=[];
    for(let direction=0;direction<8;direction++) for(let frame=0;frame<config.frames;frame++) {
      const phase=frame/(config.loop?config.frames:config.frames-1), result=draw(action,phase,direction);
      context.drawImage(result.canvas,frame*size,direction*size);
      records.push({direction,frame,phase,joints:result.joints,screen:result.screen});
    }
    return {png:atlas.toDataURL('image/png').split(',')[1],records};
  }
  return {draw,clip,dispose(){rig.dispose();renderer.dispose();}};
}

window.priestBaker = createBaker();
window.priestManifest = manifest;
window.exportPriestRig = exportRig;
