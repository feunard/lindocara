import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { DESIGN, createPriest, poseAt } from './model.mjs';
import manifest from './manifest.json';

/** Only named articulation nodes ship. The offline contact proxy is never visible at runtime. */
export async function exportRig() {
  const rig=createPriest();
  rig.apply(poseAt('idle',0));
  const nodes=[];rig.root.traverse(node=>{if(node.name)nodes.push(node);});
  const bones=nodes.map(node=>{const bone=new THREE.Bone();bone.name=node.name;return bone;});
  const nearest=node=>{while(node&&!nodes.includes(node))node=node.parent;return node;};
  const inverse=new THREE.Matrix4(),position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();
  nodes.forEach((node,index)=>{
    const parent=nearest(node.parent), parentIndex=nodes.indexOf(parent);
    const matrix=node.matrixWorld.clone();if(parent)matrix.premultiply(inverse.copy(parent.matrixWorld).invert());
    matrix.decompose(position,quaternion,scale);bones[index].position.copy(position);bones[index].quaternion.copy(quaternion);bones[index].scale.copy(scale);
    if(parentIndex>=0)bones[parentIndex].add(bones[index]);
  });
  const skeleton=new THREE.Group();skeleton.name='DawnPriestArticulation';
  bones.filter(bone=>!bone.parent).forEach(bone=>skeleton.add(bone));skeleton.updateMatrixWorld(true);
  const binary=await new GLTFExporter().parseAsync(skeleton,{binary:true});
  const curves={};
  for(const [name,clip] of Object.entries(manifest.clips)){
    const frames=clip.loop?96:97,poses=[];
    for(let i=0;i<frames;i++){
      const pose=poseAt(name,i/(clip.loop?frames:frames-1));rig.apply(pose);
      pose.bodyY=rig.root.getObjectByName('body').position.y;poses.push(pose);
    }
    curves[name]={loop:clip.loop,durationMs:clip.durationMs,poses};
  }
  const bytes=new Uint8Array(binary);let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const result={binary:btoa(encoded),motion:{version:1,design:DESIGN,clips:curves},stats:{bones:bones.length,vertices:0,triangles:0,bytes:binary.byteLength}};
  rig.dispose();return result;
}
