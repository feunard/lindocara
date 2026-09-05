import * as THREE from "three";

import art from "../assets/characters/priest/painted.json";
import type { PriestPose } from "./priest-pose.js";

type PartName = "head" | "torso" | "arm" | "thigh" | "boot" | "staff";
interface Strip {
  key: string;
  part: PartName;
  points: THREE.Vector3[];
  coordinates: number[];
  width: number;
  depth: number;
  flip?: boolean;
}

/** The skeleton drives placement; the pixels are authored illustrations, never shaded solids. */
export function createPaintedPriest(root: THREE.Object3D, texture: THREE.Texture) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(768 * 3),
    uvs = new Float32Array(768 * 2);
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    uniforms: { painting: { value: texture } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}",
    fragmentShader:
      "uniform sampler2D painting;varying vec2 vUv;void main(){vec4 p=texture2D(painting,vUv);if(p.a<.5)discard;gl_FragColor=p;}",
  });
  const mesh = new THREE.Mesh(geometry, material);
  const partRanges = new Map<string, { start: number; count: number }>();
  mesh.frustumCulled = false;
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((node) => {
    if (node.name) bones.set(node.name, node);
  });
  const node = (name: string): THREE.Object3D => {
    const result = bones.get(name);
    if (!result) throw new Error(`Painted Priest missing joint ${name}`);
    return result;
  };
  const point = (name: string, x = 0, y = 0, z = 0): THREE.Vector3 =>
    node(name).localToWorld(new THREE.Vector3(x, y, z));

  return {
    mesh,
    partRanges,
    update(camera: THREE.OrthographicCamera, heading: number, pose: PriestPose): void {
      root.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      const angle = Math.atan2(Math.sin(heading), Math.cos(heading));
      const orientation = Math.min(4, Math.abs(angle) / (Math.PI / 4));
      const direction = Math.round(orientation);
      const view = art.parts[direction];
      const front = art.parts[0];
      if (!view || !front) throw new Error("Painted Priest has no directional art");
      const a = art.parts[Math.floor(orientation)],
        b = art.parts[Math.min(4, Math.floor(orientation) + 1)];
      if (!a || !b) throw new Error("Painted Priest orientation is incomplete");
      const aspect = (part: PartName): number =>
        THREE.MathUtils.lerp(a[part].aspect, b[part].aspect, orientation % 1);
      const mirror = angle < 0;
      const strips: Strip[] = [];
      const add = (
        part: PartName,
        points: THREE.Vector3[],
        coordinates: number[],
        width: number,
        bias = 0,
        flip = mirror,
        key: string = part,
      ): void => {
        const depth =
          points.reduce((sum, p) => sum + p.clone().applyMatrix4(camera.matrixWorldInverse).z, 0) /
          points.length;
        strips.push({ key, part, points, coordinates, width, depth: depth + bias, flip });
      };
      const extent = camera.right - camera.left;
      // A drawing already contains the camera's perspective. Rotate its local vertical with the
      // body without rotating the painted surface edge-on during an ordinary heading change.
      const card = (
        part: PartName,
        centre: THREE.Vector3,
        up: THREE.Vector3,
        height: number,
        width: number,
        bias = 0,
      ): void => {
        const axis = up.clone().project(camera).sub(centre.clone().project(camera));
        axis.z = 0;
        if (axis.lengthSq() < 0.000001) axis.set(0, 1, 0);
        else axis.normalize();
        const c = centre.clone().project(camera);
        const top = c.clone().addScaledVector(axis, height / extent);
        const bottom = c.clone().addScaledVector(axis, -height / extent);
        const coordinates = part === "torso" ? [0, 0.3, 0.55, 0.75, 1] : [0, 1];
        add(
          part,
          coordinates.map((t) => top.clone().lerp(bottom, t).unproject(camera)),
          coordinates,
          width,
          bias,
        );
      };
      for (const side of [-1, 1]) {
        const hip = point(`thigh${side}`, 0, -0.5),
          knee = point(`knee${side}`),
          ankle = point(`foot${side}`);
        add("thigh", [hip, knee], [0.08, 0.96], 0.22);
        // The sole is attached to the foot, not the shin; a support stays fixed as the knee bends.
        const sole = point(`foot${side}`, 0, -0.065, 0.035);
        add(
          "boot",
          [knee, ankle, sole],
          [0.07, 0.77, 1],
          0.2 + 0.07 * Math.abs(Math.sin(angle)),
          0.01,
          mirror,
          `boot${side}`,
        );
        const shoulder = point("torso", side * 0.265, 0.28, 0.14 * Math.sin(pose.spineBend)),
          elbow = point(`elbow${side}`),
          hand = point(`hand${side}`);
        const extension = hand.clone().sub(elbow).normalize().multiplyScalar(0.065).add(hand);
        add("arm", [shoulder, elbow, hand, extension], [0.1, 0.53, 0.87, 1], 0.19, 0.015);
      }
      const torsoCentre = point("torso", 0, 0.13, 0.01);
      const torsoWidth = (0.7 * aspect("torso")) / front.torso.aspect;
      card("torso", torsoCentre, point("torso", 0, 0.8, 0.01), 0.7, torsoWidth, 0.04);
      const headCentre = point("head", 0, -0.015, 0.025);
      card(
        "head",
        headCentre,
        point("head", 0, 0.7, 0.025),
        0.56,
        (0.53 * aspect("head")) / front.head.aspect,
        0.12,
      );
      add(
        "staff",
        [point("staff", 0, 0.9, 0.035), point("staff", 0, -0.49, 0.035)],
        [0, 1],
        (0.34 * aspect("staff")) / front.staff.aspect,
        0.025,
      );

      const clothOffsets = [0, 2].map((index) => {
        const panel = node(`panel${index}`),
          parent = panel.parent;
        if (!parent) throw new Error("Priest tunic panel has no belt anchor");
        const rest = parent.localToWorld(
          panel.position.clone().add(new THREE.Vector3(0, -0.29, 0)),
        );
        return point(`panel${index}`, 0, -0.29).project(camera).sub(rest.project(camera));
      });
      if (Math.cos(angle) < 0) clothOffsets.reverse();

      strips.sort((a, b) => a.depth - b.depth);
      let cursor = 0;
      partRanges.clear();
      for (const strip of strips) {
        const start = cursor;
        const rect = view[strip.part];
        const points = strip.points.map((p) => p.clone().project(camera));
        const edges = points.map((p, index) => {
          const prev = points[Math.max(0, index - 1)],
            next = points[Math.min(points.length - 1, index + 1)];
          if (!prev || !next) throw new Error("Painted Priest strip needs endpoints");
          const axis = next.clone().sub(prev);
          axis.z = 0;
          if (axis.lengthSq() < 0.000001) axis.set(0, -1, 0);
          else axis.normalize();
          const across = new THREE.Vector3(-axis.y, axis.x, 0).multiplyScalar(strip.width / extent);
          return [p.clone().sub(across), p.clone().add(across)];
        });
        const vertex = (row: number, edge: number): void => {
          const left = edges[row]?.[0],
            right = edges[row]?.[1],
            v = strip.coordinates[row];
          if (!left || !right || v === undefined)
            throw new Error("Painted Priest vertex is missing");
          const p = left.clone().lerp(right, edge);
          if (strip.part === "torso" && v > 0.55) {
            const l = clothOffsets[0],
              r = clothOffsets[1];
            if (l && r) p.addScaledVector(l.clone().lerp(r, edge), (v - 0.55) / 0.45);
          }
          if (strip.part === "torso") {
            // A shallow painted surface follows the opposing chest/hip rotations. Features on
            // the front shift with the volume; the entire shirt is no longer one rigid card.
            const upper = THREE.MathUtils.smoothstep(0.72 - v, 0, 0.3);
            const twist = THREE.MathUtils.lerp(pose.hipTwist, pose.twist, upper);
            const x = (edge - 0.5) * strip.width;
            const z =
              0.16 * Math.sqrt(Math.max(0, 1 - (edge * 2 - 1) ** 2)) * Math.sign(Math.cos(angle));
            const dx = x * Math.cos(twist) + z * Math.sin(twist) - x;
            const dz =
              z * Math.cos(twist) -
              x * Math.sin(twist) -
              z +
              0.35 * Math.sin(pose.spineBend) * upper * upper;
            p.add(point("body", dx, 0, dz).project(camera).sub(point("body").project(camera)));
          }
          positions.set([p.x, p.y, 0], cursor * 3);
          const u = strip.flip ? 1 - edge : edge;
          uvs.set(
            [
              (rect.x + 0.5 + u * (rect.width - 1)) / art.width,
              1 - (rect.y + 0.5 + v * (rect.height - 1)) / art.height,
            ],
            cursor * 2,
          );
          cursor++;
        };
        const columns = strip.part === "torso" ? 4 : 1;
        for (let i = 0; i < points.length - 1; i++)
          for (let column = 0; column < columns; column++) {
            const l = column / columns,
              r = (column + 1) / columns;
            vertex(i, l);
            vertex(i + 1, l);
            vertex(i, r);
            vertex(i, r);
            vertex(i + 1, l);
            vertex(i + 1, r);
          }
        partRanges.set(strip.key, { start, count: cursor - start });
      }
      geometry.setDrawRange(0, cursor);
      geometry.getAttribute("position").needsUpdate = true;
      geometry.getAttribute("uv").needsUpdate = true;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
}
