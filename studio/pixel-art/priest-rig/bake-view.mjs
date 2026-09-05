import * as THREE from 'three';
import manifest from './manifest.json';
import { DESIGN, createPriest, poseAt } from './model.mjs';
import { exportRig } from './export-rig.mjs';
import { createPaintedPriest } from '../../../packages/renderer/src/hd2d/priest-painted.ts';

const painting = await new THREE.TextureLoader().loadAsync(new URL('../../../packages/renderer/src/assets/characters/priest/painted.png', import.meta.url).href);
painting.colorSpace = THREE.SRGBColorSpace;
painting.minFilter = painting.magFilter = THREE.LinearFilter;
painting.generateMipmaps = false;

export function createBaker() {
  const size = DESIGN.canvas;
  const scene = new THREE.Scene();
  const rig = createPriest(); scene.add(rig.root);
  rig.root.traverse(node => { if (node.isMesh) node.visible = false; });
  const painted = createPaintedPriest(rig.root, painting); scene.add(painted.mesh);
  const camera = new THREE.OrthographicCamera(-DESIGN.extent/2, DESIGN.extent/2, DESIGN.extent/2, -DESIGN.extent/2, 0.1, 20);
  const target = new THREE.Vector3(0, (DESIGN.anchor[1] / size - 0.5) * DESIGN.extent / Math.cos(DESIGN.cameraPitch), 0);
  camera.position.copy(target).add(new THREE.Vector3(0, Math.sin(DESIGN.cameraPitch)*8, Math.cos(DESIGN.cameraPitch)*8)); camera.lookAt(target);
  const renderer = new THREE.WebGLRenderer({alpha:true, antialias:false, preserveDrawingBuffer:true});
  renderer.setSize(size * 2, size * 2); renderer.setPixelRatio(1); renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const buffer = document.createElement('canvas'); buffer.width = buffer.height = size*2;
  const ctx = buffer.getContext('2d', {willReadFrequently:true});
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const output = canvas.getContext('2d');
  function draw(action, phase, direction=0) {
    const pose=poseAt(action,phase);
    const joints = structuredClone(rig.apply(pose, direction * Math.PI / 4));
    painted.update(camera, direction * Math.PI / 4, pose);
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
    // The illustration owns its contour. Adding a second outline thickens small hands and feet.
    output.putImageData(new ImageData(reduced,size,size),0,0);
    const project = p => { const n = new THREE.Vector3(...p).project(camera); return [(n.x+1)*size/2,(1-n.y)*size/2]; };
    const position=(name,x=0,y=0,z=0)=>rig.root.getObjectByName(name).localToWorld(new THREE.Vector3(x,y,z)).toArray();
    return { canvas, joints, screen: {
      feet:joints.feet.map(project), knees:joints.knees.map(project), hips:joints.hips.map(project),
      pelvis:project(joints.pelvis), chest:project(position('torso',0,.30)),
      head:[(painted.landmarks.head.x+1)*size/2,(1-painted.landmarks.head.y)*size/2],
      neck:[(painted.landmarks.neck.x+1)*size/2,(1-painted.landmarks.neck.y)*size/2],
      shoulders:[-1,1].map(side=>project(position('torso',side*.265,.28,.14*Math.sin(pose.spineBend)))),
      elbows:[-1,1].map(side=>project(position(`elbow${side}`))), hands:[-1,1].map(side=>project(position(`hand${side}`))),
    } };
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
  return {draw,clip,dispose(){painted.dispose();rig.dispose();renderer.dispose();}};
}

window.priestBaker = createBaker();
window.priestManifest = manifest;
window.exportPriestRig = exportRig;
