import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { DESIGN, createPriest, poseAt } from './model.mjs';
import manifest from './manifest.json';

/** One rigid-weight skeleton, one material, one draw. Sources stay in the studio. */
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
  const geometries=[];
  rig.root.traverse(node=>{
    if(!node.isMesh)return;
    const boneIndex=nodes.indexOf(nearest(node)),geometry=node.geometry.index?node.geometry.toNonIndexed():node.geometry.clone();
    geometry.applyMatrix4(node.matrixWorld);geometry.deleteAttribute('uv');
    const count=geometry.attributes.position.count,colors=new Float32Array(count*3),indices=new Uint16Array(count*4),weights=new Float32Array(count*4);
    const material=node.material;
    for(let i=0;i<count;i++){colors.set(material.color.toArray(),i*3);indices[i*4]=boneIndex;weights[i*4]=1;}
    if(material.side===THREE.BackSide){
      // Convert the ink shell's back faces into ordinary front faces in the same draw call.
      for(let i=0;i<count;i+=3)for(const name of ['position','normal']){
        const attribute=geometry.getAttribute(name);const a=new THREE.Vector3().fromBufferAttribute(attribute,i);
        const b=new THREE.Vector3().fromBufferAttribute(attribute,i+2);attribute.setXYZ(i,b.x,b.y,b.z);attribute.setXYZ(i+2,a.x,a.y,a.z);
      }
      const normals=geometry.getAttribute('normal');for(let i=0;i<count;i++)normals.setXYZ(i,-normals.getX(i),-normals.getY(i),-normals.getZ(i));
    }
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.setAttribute('skinIndex',new THREE.BufferAttribute(indices,4));geometry.setAttribute('skinWeight',new THREE.BufferAttribute(weights,4));geometries.push(geometry);
  });
  const geometry=mergeGeometries(geometries),material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});
  const skin=new THREE.SkinnedMesh(geometry,material);skin.name='DawnPriest';
  bones.filter(bone=>!bone.parent).forEach(bone=>skin.add(bone));skin.updateMatrixWorld(true);skin.bind(new THREE.Skeleton(bones));
  const binary=await new GLTFExporter().parseAsync(skin,{binary:true});
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
  const result={binary:btoa(encoded),motion:{version:1,design:DESIGN,clips:curves},stats:{bones:bones.length,vertices:geometry.attributes.position.count,triangles:geometry.attributes.position.count/3,bytes:binary.byteLength}};
  rig.dispose();geometry.dispose();geometries.forEach(g=>g.dispose());material.dispose();skin.skeleton.dispose();return result;
}
