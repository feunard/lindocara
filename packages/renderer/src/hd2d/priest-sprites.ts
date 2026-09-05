import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";

import type { CharacterAnimationSample } from "../character-animation.js";
import type { PriestClip } from "../priest-art.js";
import type { ActorView } from "./billboards.js";
import {
  blendPriestPose,
  createPriestPoseApplicator,
  type Joint,
  type PriestPose,
} from "./priest-pose.js";

export interface PriestSpriteInput {
  id: string;
  inheritFrom?: string;
  clip: PriestClip;
  /** Continuous server-aligned action phase, or vertical-velocity phase in the air. */
  phase: number;
  animation?: CharacterAnimationSample;
  hp?: number;
  /** Authoritative cast direction can differ from travel direction (auto-aim / strafing). */
  aim?: { x: number; z: number };
}
interface MotionClip {
  loop: boolean;
  durationMs: number;
  poses: PriestPose[];
}
export interface MotionAsset {
  version: number;
  clips: Record<PriestClip, MotionClip>;
}
export interface PriestRigAsset {
  root: THREE.Group;
  motion: MotionAsset;
  dispose(): void;
}

export async function loadPriestRig(): Promise<PriestRigAsset> {
  const [gltf, response] = await Promise.all([
    new GLTFLoader().loadAsync(
      new URL("../assets/characters/priest/rig.glb", import.meta.url).href,
    ),
    fetch(new URL("../assets/characters/priest/motion.json", import.meta.url).href),
  ]);
  if (!response.ok) throw new Error(`Priest motion: HTTP ${response.status}`);
  const motion = (await response.json()) as MotionAsset;
  if (motion.version !== 1) throw new Error("Unsupported Priest motion asset");
  const ramp = new THREE.DataTexture(new Uint8Array([85, 145, 200, 255]), 4, 1, THREE.RedFormat);
  ramp.needsUpdate = true;
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  const material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
  gltf.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) {
      const previous = Array.isArray(node.material) ? node.material : [node.material];
      previous.forEach((value) => value.dispose());
      node.material = material;
      node.frustumCulled = false;
    }
  });
  return {
    root: gltf.scene,
    motion,
    dispose() {
      gltf.scene.traverse((node) => {
        if (node instanceof THREE.SkinnedMesh) {
          node.geometry.dispose();
          node.skeleton.dispose();
        }
      });
      material.dispose();
      ramp.dispose();
    },
  };
}

export function samplePriestPose(motion: MotionAsset, clip: PriestClip, phase: number): PriestPose {
  const config = motion.clips[clip],
    count = config.poses.length;
  const cursor = config.loop
    ? (((phase % 1) + 1) % 1) * count
    : THREE.MathUtils.clamp(phase, 0, 1) * (count - 1);
  const index = Math.floor(cursor),
    a = config.poses[index],
    b = config.poses[config.loop ? (index + 1) % count : Math.min(count - 1, index + 1)];
  if (!a || !b) throw new Error(`Incomplete Priest curve ${clip}`);
  return blendPriestPose(a, b, cursor - index);
}

const ease = (t: number): number => {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const angleDelta = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));
interface FootSupport {
  world: THREE.Vector2;
  contact: boolean;
  localY: number;
  settling: number;
  forcedSwing: boolean;
}

/** Small pose composition: 25 rigid-weight bones, leg/arm IK, no image morphing. */
export class PriestPosePlayer {
  readonly #motion: MotionAsset;
  #at: number | null = null;
  #x = 0;
  #z = 0;
  #heading = 0;
  #moveWeight = 0;
  #lastPose: PriestPose | null = null;
  #airborne = false;
  #landedAt = Number.NEGATIVE_INFINITY;
  #hurtAt = Number.NEGATIVE_INFINITY;
  #hp: number | undefined;
  #supports: [FootSupport, FootSupport] | null = null;
  #deathFrom: PriestPose | null = null;
  #deathHeading: number | null;
  #airFrom: PriestPose | null = null;
  #airAt = 0;
  #baseMode = "idle";

  constructor(
    motion: MotionAsset,
    deathFrom: PriestPose | null = null,
    deathHeading: number | null = null,
  ) {
    this.#motion = motion;
    this.#deathFrom = deathFrom;
    this.#deathHeading = deathHeading;
  }

  lastPose(): PriestPose | null {
    return this.#lastPose ? structuredClone(this.#lastPose) : null;
  }

  lastHeading(): number {
    return this.#heading;
  }

  sample(
    actor: ActorView,
    input: PriestSpriteInput,
    now: number,
  ): { pose: PriestPose; heading: number } {
    const dt = this.#at === null ? 0 : Math.max(0, Math.min(0.05, (now - this.#at) / 1000));
    const dx = actor.x - this.#x,
      dz = actor.z - this.#z;
    const discontinuous =
      this.#at === null || now - this.#at > 250 || now < this.#at || Math.hypot(dx, dz) > 0.8;
    const facing = input.aim ?? actor.directionalFacing ?? { x: 0, z: 1 };
    let heading = Math.atan2(facing.x, facing.z);
    if (input.clip === "death") {
      this.#deathHeading ??= this.#lastPose ? this.#heading : heading;
      heading = this.#deathHeading;
    } else this.#deathHeading = null;
    if (discontinuous) {
      this.#heading = heading;
      this.#supports = null;
      this.#lastPose = null;
    } else
      this.#heading += THREE.MathUtils.clamp(angleDelta(this.#heading, heading), -18 * dt, 18 * dt);
    const airborne = actor.airborne || actor.gliding || actor.swimming;
    const baseMode = actor.swimming
      ? "swim"
      : actor.gliding
        ? "glide"
        : actor.airborne
          ? actor.vy > 0
            ? "jump"
            : "fall"
          : "ground";
    if (this.#airborne && !airborne) this.#landedAt = now;
    if (this.#hp !== undefined && input.hp !== undefined && input.hp < this.#hp) this.#hurtAt = now;
    if (
      airborne !== this.#airborne ||
      (baseMode !== this.#baseMode &&
        (baseMode === "glide" ||
          this.#baseMode === "glide" ||
          baseMode === "swim" ||
          baseMode === "jump"))
    ) {
      this.#airFrom = this.#lastPose;
      this.#airAt = now;
      this.#supports = null;
    }
    this.#hp = input.hp;
    this.#baseMode = baseMode;
    const animation = input.animation,
      speed = animation?.speed ?? 0,
      moving = speed > 0.025;
    const stride = animation?.stridePhase ?? 0;
    this.#moveWeight = THREE.MathUtils.damp(this.#moveWeight, moving ? 1 : 0, 22, dt);
    const sample = (clip: PriestClip, phase: number) => samplePriestPose(this.#motion, clip, phase);
    const neutral = sample("idle", 0);
    let pose: PriestPose;
    if (input.clip === "death") {
      this.#deathFrom ??= this.#lastPose;
      pose = sample("death", input.phase);
      if (this.#deathFrom && input.phase < 0.22)
        pose = blendPriestPose(this.#deathFrom, pose, ease(input.phase / 0.22));
    } else {
      this.#deathFrom = null;
      if (actor.swimming) pose = sample("swim", now / this.#motion.clips.swim.durationMs);
      else if (actor.gliding) pose = sample("glide", now / this.#motion.clips.glide.durationMs);
      else if (actor.airborne)
        pose = sample(
          actor.vy > 0 ? "jump" : "fall",
          actor.vy > 0 ? 1 - actor.vy / 9 : -actor.vy / 9,
        );
      else
        pose = blendPriestPose(
          sample("idle", now / this.#motion.clips.idle.durationMs),
          sample("run", stride),
          this.#moveWeight,
        );
      // A caster may travel backwards or sideways while aiming. Rotate the stride around each
      // hip, not the feet's lateral separation, before the world-space contact solver runs.
      if (!airborne && moving && dt > 0 && !discontinuous) {
        const travel = Math.atan2(dx, dz) - this.#heading;
        for (const foot of pose.feet) {
          const forward = foot.position[2];
          foot.position[0] += forward * Math.sin(travel);
          foot.position[2] = forward * Math.cos(travel);
          foot.pitch *= Math.cos(travel);
        }
      }
      // Cast curves are additive above the pelvis: advancing legs keep their distance clock.
      // At both ends the authored curve is neutral, including hands, so recovery joins the gait.
      if (["radiant-bolt", "mend", "blink", "prayer", "divine-nova"].includes(input.clip)) {
        const cast = sample(input.clip, input.phase);
        for (const key of [
          "lean",
          "twist",
          "headTilt",
          "staffPitch",
          "staffRoll",
          "cloth",
          "glow",
        ] as const)
          pose[key] += cast[key] - neutral[key];
        pose.pelvis[1] += cast.pelvis[1] - neutral.pelvis[1];
        for (const side of [0, 1] as const)
          for (const axis of [0, 1, 2] as const)
            pose.hands[side][axis] += cast.hands[side][axis] - neutral.hands[side][axis];
        // The upper body leads a turn so a quick bolt points at the accepted target at release.
        // The root catches up continuously; planted feet remain at their world contacts.
        const turn = input.aim
          ? THREE.MathUtils.clamp(angleDelta(this.#heading, heading), -0.7, 0.7)
          : 0;
        pose.twist += turn;
        for (const hand of pose.hands) {
          const x = hand[0] - pose.pelvis[0],
            z = hand[2] - pose.pelvis[2];
          hand[0] = pose.pelvis[0] + x * Math.cos(turn) + z * Math.sin(turn);
          hand[2] = pose.pelvis[2] - x * Math.sin(turn) + z * Math.cos(turn);
        }
      }
      const landing = (now - this.#landedAt) / 180;
      if (!airborne && landing >= 0 && landing < 1) {
        const compression = 0.075 * Math.sin(Math.PI * landing);
        pose.pelvis[1] -= compression;
        pose.lean += compression * 0.8;
        pose.cloth -= compression * 0.4;
      }
      const hurt = (now - this.#hurtAt) / 200;
      if (hurt >= 0 && hurt < 1) {
        const recoil = Math.sin(Math.PI * hurt);
        pose.lean -= 0.09 * recoil;
        pose.headTilt -= 0.05 * recoil;
      }
      if (this.#airFrom && now - this.#airAt < 90)
        pose = blendPriestPose(this.#airFrom, pose, ease((now - this.#airAt) / 90));
      // Feet are world-space anchors during support, including camera turns and moving casts.
      // When input stops mid-swing, the lifted foot finishes one short step and settles.
      if (!airborne) {
        const sin = Math.sin(this.#heading),
          cos = Math.cos(this.#heading);
        const world = (joint: Joint) =>
          new THREE.Vector2(
            actor.x + joint[0] * cos + joint[2] * sin,
            actor.z - joint[0] * sin + joint[2] * cos,
          );
        this.#supports ??= [0, 1].map((index) => {
          const f = pose.feet[index === 0 ? 0 : 1];
          return {
            world: world(f.position),
            contact: f.contact,
            localY: f.position[1],
            settling: 0,
            forcedSwing: false,
          };
        }) as [FootSupport, FootSupport];
        for (const side of [0, 1] as const) {
          const foot = pose.feet[side],
            support = this.#supports[side],
            ideal = world(foot.position);
          if (moving) {
            const contact = sample("run", stride).feet[side].contact;
            if (!contact) support.forcedSwing = false;
            if (contact && !support.contact && !support.forcedSwing) {
              support.contact = true;
              support.localY = 0.07;
            } else if (!contact || support.forcedSwing) {
              support.contact = false;
              const step = ideal
                .clone()
                .sub(support.world)
                .multiplyScalar(1 - Math.exp(-dt / 0.018));
              if (step.length() > 9 * dt) step.setLength(9 * dt);
              support.world.add(step);
              support.localY = foot.position[1];
            }
            // A sudden reversal can exhaust a support leg before nominal toe-off. Release it into
            // a short lifted catch-up step instead of stretching it or dragging a planted sole.
            const hip = world([
              pose.pelvis[0] + (side === 0 ? -0.135 : 0.135),
              pose.pelvis[1] - 0.035,
              pose.pelvis[2],
            ]);
            const reach = Math.hypot(
              support.world.distanceTo(hip),
              pose.pelvis[1] - 0.035 - support.localY,
            );
            if (support.contact && reach > 0.625) {
              support.contact = false;
              support.forcedSwing = true;
              support.world.lerp(ideal, 1 - Math.exp(-dt / 0.06));
              support.localY = 0.12;
            }
            support.settling = 0;
          } else if (!support.contact) {
            support.settling += dt;
            const settle = ease(support.settling / 0.14);
            support.localY = THREE.MathUtils.lerp(support.localY, 0.07, settle);
            if (settle >= 1) {
              support.contact = true;
              support.localY = 0.07;
            }
          }
          const fx = support.world.x - actor.x,
            fz = support.world.y - actor.z;
          foot.position = [fx * cos - fz * sin, support.localY, fx * sin + fz * cos];
          foot.contact = support.contact;
          if (support.contact) foot.pitch = 0;
        }
      }
    }
    this.#airborne = airborne;
    this.#at = now;
    this.#x = actor.x;
    this.#z = actor.z;
    this.#lastPose = structuredClone(pose);
    return { pose, heading: this.#heading };
  }
}

interface SpriteEntry {
  root: THREE.Object3D;
  skin: THREE.SkinnedMesh;
  target: THREE.WebGLRenderTarget;
  apply: (pose: PriestPose) => void;
  player: PriestPosePlayer;
}

/** Reuses the game's WebGL context. One skin draw and one 160² pixel pass per visible Priest. */
export function createPriestSpriteSystem(renderer: THREE.WebGLRenderer, asset: PriestRigAsset) {
  const entries = new Map<string, SpriteEntry>(),
    scene = new THREE.Scene();
  let updateMs = 0;
  const size = 160,
    extent = 2.8,
    pitch = (38 * Math.PI) / 180;
  const camera = new THREE.OrthographicCamera(
    -extent / 2,
    extent / 2,
    extent / 2,
    -extent / 2,
    0.1,
    20,
  );
  const target = new THREE.Vector3(0, ((116 / size - 0.5) * extent) / Math.cos(pitch), 0);
  camera.position.copy(target).add(new THREE.Vector3(0, Math.sin(pitch) * 8, Math.cos(pitch) * 8));
  camera.lookAt(target);
  scene.add(new THREE.AmbientLight(0xffffff, 1.05));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-3, 6, 4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xbad4e3, 0.6);
  fill.position.set(4, 2, -3);
  scene.add(fill);
  const scratch = new THREE.WebGLRenderTarget(size * 2, size * 2, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  const pixelScene = new THREE.Scene(),
    pixelCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pixelMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { source: { value: scratch.texture } },
    vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}",
    fragmentShader: `uniform sampler2D source;varying vec2 vUv;
      vec4 pixel(vec2 uv){vec4 sum=vec4(0.);for(int y=0;y<2;y++)for(int x=0;x<2;x++){vec4 p=texture2D(source,uv+(vec2(float(x),float(y))-.5)/320.);sum+=vec4(p.rgb*p.a,p.a);}return sum.a>=2.?vec4(sum.rgb/max(sum.a,.001),1.):vec4(0.);}
      void main(){vec4 p=pixel(vUv);if(p.a<.5){float edge=pixel(vUv+vec2(1./160.,0.)).a+pixel(vUv-vec2(1./160.,0.)).a+pixel(vUv+vec2(0.,1./160.)).a+pixel(vUv-vec2(0.,1./160.)).a;if(edge>.5)p=vec4(.0144,.0194,.0369,1.);}gl_FragColor=p;}`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), pixelMaterial);
  pixelScene.add(quad);
  const disposeEntry = (entry: SpriteEntry) => {
    entry.root.removeFromParent();
    entry.skin.skeleton.dispose();
    entry.target.dispose();
  };
  return {
    sync(actors: readonly ActorView[], now: number, cameraYaw: number, cameraPitch = pitch): void {
      const started = performance.now();
      // Match the ground projection, not only the character height. Together with full billboard
      // compensation this preserves a support foot's screen position when the camera tilts.
      target.y = ((116 / size - 0.5) * extent) / Math.cos(cameraPitch);
      camera.position
        .copy(target)
        .add(new THREE.Vector3(0, Math.sin(cameraPitch) * 8, Math.cos(cameraPitch) * 8));
      camera.lookAt(target);
      const present = new Set<string>();
      const oldTarget = renderer.getRenderTarget(),
        oldColor = renderer.getClearColor(new THREE.Color()),
        oldAlpha = renderer.getClearAlpha(),
        oldAuto = renderer.autoClear;
      const oldTone = renderer.toneMapping,
        oldExposure = renderer.toneMappingExposure;
      const oldViewport = renderer.getViewport(new THREE.Vector4()),
        oldScissor = renderer.getScissor(new THREE.Vector4()),
        oldScissorTest = renderer.getScissorTest();
      try {
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1;
        renderer.autoClear = true;
        renderer.setClearColor(0, 0);
        renderer.setScissorTest(false);
        for (const actor of actors) {
          const input = actor.priestPose;
          if (!input) continue;
          present.add(input.id);
          let entry = entries.get(input.id);
          if (!entry) {
            const root = clone(asset.root);
            let skin: THREE.SkinnedMesh | null = null;
            root.traverse((node) => {
              if (node instanceof THREE.SkinnedMesh) skin = node;
            });
            if (!skin) throw new Error("Priest asset has no skin");
            const renderTarget = new THREE.WebGLRenderTarget(size, size, {
              minFilter: THREE.NearestFilter,
              magFilter: THREE.NearestFilter,
              depthBuffer: false,
            });
            const inherited = input.inheritFrom
              ? entries.get(input.inheritFrom)?.player
              : undefined;
            entry = {
              root,
              skin,
              target: renderTarget,
              apply: createPriestPoseApplicator(root),
              player: new PriestPosePlayer(
                asset.motion,
                inherited?.lastPose(),
                inherited?.lastHeading(),
              ),
            };
            entries.set(input.id, entry);
            scene.add(root);
          }
          const { pose, heading } = entry.player.sample(actor, input, now);
          entry.apply(pose);
          entry.root.rotation.y = heading - cameraYaw;
          entry.root.visible = true;
          renderer.setRenderTarget(scratch);
          renderer.render(scene, camera);
          renderer.setRenderTarget(entry.target);
          renderer.render(pixelScene, pixelCamera);
          entry.root.visible = false;
          actor.textureKey = `priest-rig:${input.id}`;
          actor.spriteTexture = entry.target.texture;
          actor.frames = 1;
          actor.frame = 0;
          actor.frameWidth = size;
          actor.frameHeight = size;
          actor.foot = (size - 116) / size;
          actor.renderHeight = extent;
          actor.directionRows = 1;
          actor.authoredPose = true;
          delete actor.directionalFacing;
        }
      } finally {
        renderer.setRenderTarget(oldTarget);
        renderer.setClearColor(oldColor, oldAlpha);
        renderer.autoClear = oldAuto;
        renderer.toneMapping = oldTone;
        renderer.toneMappingExposure = oldExposure;
        renderer.setViewport(oldViewport);
        renderer.setScissor(oldScissor);
        renderer.setScissorTest(oldScissorTest);
      }
      for (const [id, entry] of entries)
        if (!present.has(id)) {
          disposeEntry(entry);
          entries.delete(id);
        }
      updateMs = performance.now() - started;
    },
    stats() {
      return {
        actors: entries.size,
        draws: entries.size * 2,
        updateMs,
        renderTargetBytes: 320 * 320 * 8 + entries.size * 160 * 160 * 4,
      };
    },
    dispose(): void {
      entries.forEach(disposeEntry);
      entries.clear();
      scratch.dispose();
      quad.geometry.dispose();
      pixelMaterial.dispose();
    },
  };
}
