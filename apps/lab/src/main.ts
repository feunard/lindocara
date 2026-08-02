import { createHd2dContext } from "@lindocara/hd2d/context.js";
import { createPipeline } from "@lindocara/hd2d/pipeline.js";
import * as THREE from "three";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(22, 1, 0.5, 220);
camera.position.set(0, 6, 12);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshLambertMaterial()));

// Cube d'étape : jalon de la task 4, remplacé par la vraie scène en task 11. Le pipeline, lui,
// est définitif — c'est lui qu'on vérifie ici (bloom, étalonnage, tilt-shift).
const ctx = createHd2dContext();
const pipeline = createPipeline(canvas, scene, camera, ctx);

// `resize()` ne s'abonne plus lui-même : c'est l'appelant qui le fait, pour que `dispose()`
// puisse se désabonner proprement.
addEventListener("resize", pipeline.resize);

function frame() {
  requestAnimationFrame(frame);
  pipeline.render();
}
frame();

// Repère pour les scripts de capture.
(window as unknown as { __ready?: boolean }).__ready = true;
