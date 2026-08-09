import type { AuthoredQuestMarker } from "@lindocara/engine/adventure-state.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { TerrainRamp } from "@lindocara/engine/hd2d/terrain-query.js";
import type { MerchantDefinition } from "@lindocara/engine/merchant.js";
import type { PeasantCampVisual, WorldEventSnapshot } from "@lindocara/engine/protocol.js";
import { meshStairs } from "@lindocara/hd2d/terrain/stairs.js";
import * as THREE from "three";
import type { SceneSample } from "../scene-sample.js";
import type { Hd2dScene } from "./scene.js";

interface TimedVisual {
  object: THREE.Object3D;
  startedAt: number;
  endsAt: number;
  update(progress: number): void;
}

interface LabelVisual {
  element: HTMLDivElement;
  point: THREE.Vector3;
  endsAt: number;
}

interface CampEntry {
  object: THREE.Object3D;
  endsAt: number;
}

export interface Hd2dEditorOverlay {
  cols: number;
  rows: number;
  showGrid: boolean;
  showCollisions: boolean;
  dim: boolean;
  colliders: readonly ColliderRect[];
  hover?: GroundVector | null;
  selection?: GroundVector | null;
  stairsPreview?: { ramp: TerrainRamp; valid: boolean; levelHeight: number } | null;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Line)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
  object.removeFromParent();
}

function transparentMaterial(
  color: THREE.ColorRepresentation,
  opacity = 0.9,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

function materialOpacity(object: THREE.Object3D, opacity: number): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.transparent = true;
      material.opacity = opacity;
    }
  });
}

function colorFromText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return new THREE.Color().setHSL(((hash >>> 0) % 360) / 360, 0.62, 0.58).getHex();
}

/** Dynamic presentation parented to the same scene graph as terrain and billboards. */
export class Hd2dVisualLayer {
  readonly #scene: Hd2dScene;
  readonly #canvas: HTMLCanvasElement;
  readonly #size: number;
  readonly #root = new THREE.Group();
  readonly #editorRoot = new THREE.Group();
  readonly #effects: TimedVisual[] = [];
  readonly #loot = new Map<string, THREE.Object3D>();
  readonly #projectiles = new Map<string, THREE.Object3D>();
  readonly #eventMarkers = new Map<string, THREE.Object3D>();
  readonly #camps = new Map<string, CampEntry>();
  readonly #questMarkers = new Map<string, THREE.Object3D>();
  readonly #hiddenQuestSites = new Map<string, number>();
  readonly #labels: LabelVisual[] = [];
  readonly #raycaster = new THREE.Raycaster();
  readonly #groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  readonly #rayPoint = new THREE.Vector3();
  #events: readonly WorldEventSnapshot[] = [];
  #questState: readonly AuthoredQuestMarker[] = [];
  #questVisualKey = "";
  #merchant: THREE.Object3D | null = null;
  #aim: THREE.Object3D | null = null;

  constructor(scene: Hd2dScene, canvas: HTMLCanvasElement, size: number) {
    this.#scene = scene;
    this.#canvas = canvas;
    this.#size = size;
    this.#root.name = "game-presentation";
    this.#editorRoot.name = "editor-overlay";
    this.#root.add(this.#editorRoot);
    scene.scene.add(this.#root);
  }

  #groundY(x: number, z: number, lift = 0.04): number {
    return (this.#scene.query.heightAt(x, z) ?? 0) + lift;
  }

  pulse(
    x: number,
    z: number,
    color: THREE.ColorRepresentation,
    radius = 1,
    durationMs = 480,
    startedAt = performance.now(),
  ): void {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 48), transparentMaterial(color));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, this.#groundY(x, z), z);
    this.#root.add(mesh);
    this.#effects.push({
      object: mesh,
      startedAt,
      endsAt: startedAt + Math.max(1, durationMs),
      update(progress) {
        const scale = radius * (0.18 + progress * 0.82);
        mesh.scale.setScalar(scale);
        materialOpacity(mesh, 1 - progress);
      },
    });
  }

  beam(
    from: GroundVector,
    to: GroundVector,
    width: number,
    color: THREE.ColorRepresentation,
    durationMs = 420,
    startedAt = performance.now(),
  ): void {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length <= 0.001) {
      this.pulse(from.x, from.z, color, width * 2, durationMs, startedAt);
      return;
    }
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.035, Math.max(0.03, width)),
      transparentMaterial(color, 0.75),
    );
    const x = (from.x + to.x) / 2;
    const z = (from.z + to.z) / 2;
    mesh.position.set(x, this.#groundY(x, z, 0.07), z);
    mesh.rotation.y = -Math.atan2(dz, dx);
    this.#root.add(mesh);
    this.#effects.push({
      object: mesh,
      startedAt,
      endsAt: startedAt + Math.max(1, durationMs),
      update(progress) {
        materialOpacity(mesh, 0.75 * (1 - progress));
      },
    });
  }

  orb(
    x: number,
    z: number,
    color: THREE.ColorRepresentation,
    radius: number,
    durationMs: number,
    startedAt = performance.now(),
  ): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.08, radius), 18, 12),
      transparentMaterial(color, 0.82),
    );
    mesh.position.set(x, this.#groundY(x, z, radius + 0.12), z);
    this.#root.add(mesh);
    this.#effects.push({
      object: mesh,
      startedAt,
      endsAt: startedAt + Math.max(1, durationMs),
      update(progress) {
        const breathe = 1 + Math.sin(progress * Math.PI * 6) * 0.16;
        mesh.scale.setScalar(breathe);
        materialOpacity(mesh, Math.min(0.82, (1 - progress) * 1.5));
      },
    });
  }

  setMerchant(merchant: MerchantDefinition | null): void {
    if (this.#merchant) disposeObject(this.#merchant);
    this.#merchant = null;
    if (!merchant) return;
    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.46, 0.09, 10, 32),
      transparentMaterial(0xf5c451),
    );
    marker.rotation.x = Math.PI / 2;
    marker.position.set(merchant.x, this.#groundY(merchant.x, merchant.y, 0.72), merchant.y);
    this.#root.add(marker);
    this.#merchant = marker;
  }

  showCamp(camp: PeasantCampVisual, endsAt: number): void {
    this.removeCamp(camp.id);
    const group = new THREE.Group();
    const tent = new THREE.Mesh(
      new THREE.ConeGeometry(0.62, 1.15, 4),
      new THREE.MeshStandardMaterial({ color: 0xc7894d, roughness: 0.9 }),
    );
    tent.rotation.y = Math.PI / 4;
    tent.position.y = 0.58;
    const range = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 48),
      transparentMaterial(0xf2c879, 0.38),
    );
    range.rotation.x = -Math.PI / 2;
    range.scale.setScalar(camp.radius);
    group.add(tent, range);
    group.position.set(camp.x, this.#groundY(camp.x, camp.z), camp.z);
    this.#root.add(group);
    this.#camps.set(camp.id, { object: group, endsAt });
  }

  removeCamp(id: string): void {
    const camp = this.#camps.get(id);
    if (!camp) return;
    disposeObject(camp.object);
    this.#camps.delete(id);
  }

  setAim(origin: GroundVector, direction: GroundVector, range: number): void {
    this.hideAim();
    const to = { x: origin.x + direction.x * range, z: origin.z + direction.z * range };
    const dx = to.x - origin.x;
    const dz = to.z - origin.z;
    const length = Math.max(0.01, Math.hypot(dx, dz));
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.025, 0.08),
      transparentMaterial(0xffd45c, 0.8),
    );
    const x = (origin.x + to.x) / 2;
    const z = (origin.z + to.z) / 2;
    mesh.position.set(x, this.#groundY(x, z, 0.08), z);
    mesh.rotation.y = -Math.atan2(dz, dx);
    this.#root.add(mesh);
    this.#aim = mesh;
  }

  hideAim(): void {
    if (!this.#aim) return;
    disposeObject(this.#aim);
    this.#aim = null;
  }

  setQuestMarkers(markers: readonly AuthoredQuestMarker[]): void {
    this.#questState = markers;
    this.#questVisualKey = "";
    this.#rebuildQuestMarkers();
  }

  hideQuestSite(id: string, durationMs: number): void {
    this.#hiddenQuestSites.set(id, performance.now() + Math.max(0, durationMs));
    this.#questVisualKey = "";
    const marker = this.#questMarkers.get(id);
    if (!marker) return;
    disposeObject(marker);
    this.#questMarkers.delete(id);
  }

  #rebuildQuestMarkers(): void {
    for (const marker of this.#questMarkers.values()) disposeObject(marker);
    this.#questMarkers.clear();
    const eventById = new Map(this.#events.map((event) => [event.id, event]));
    const colors = { available: 0xf2d14f, active: 0x62aaf7, ready: 0x5de28a } as const;
    for (const marker of this.#questState) {
      if ((this.#hiddenQuestSites.get(marker.eventId) ?? 0) > performance.now()) continue;
      const event = eventById.get(marker.eventId);
      if (!event) continue;
      const x = event.col + 0.5 - this.#size / 2;
      const z = event.row + 0.5 - this.#size / 2;
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22),
        transparentMaterial(colors[marker.kind]),
      );
      mesh.position.set(x, this.#groundY(x, z, 1.55), z);
      this.#root.add(mesh);
      this.#questMarkers.set(marker.eventId, mesh);
    }
  }

  sync(sample: SceneSample, now: number): void {
    this.#events = sample.events;
    this.#syncLoot(sample);
    this.#syncProjectiles(sample);
    this.#syncEventMarkers(sample.events);
    const eventById = new Map(sample.events.map((event) => [event.id, event]));
    const questVisualKey = this.#questState
      .map((marker) => {
        const event = eventById.get(marker.eventId);
        return `${marker.eventId}:${marker.kind}:${event?.col ?? ""}:${event?.row ?? ""}`;
      })
      .join("|");
    if (questVisualKey !== this.#questVisualKey) {
      this.#questVisualKey = questVisualKey;
      this.#rebuildQuestMarkers();
    }
    this.update(now);
  }

  #syncLoot(sample: SceneSample): void {
    const present = new Set<string>();
    for (const loot of sample.loot) {
      present.add(loot.id);
      let object = this.#loot.get(loot.id);
      if (!object) {
        object = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.18),
          new THREE.MeshStandardMaterial({
            color: colorFromText(loot.kind),
            emissive: colorFromText(loot.kind),
            emissiveIntensity: 0.22,
          }),
        );
        this.#root.add(object);
        this.#loot.set(loot.id, object);
      }
      object.position.set(loot.x, loot.y + 0.24, loot.z);
    }
    for (const [id, object] of this.#loot) {
      if (present.has(id)) continue;
      disposeObject(object);
      this.#loot.delete(id);
    }
  }

  #syncProjectiles(sample: SceneSample): void {
    const present = new Set<string>();
    for (const projectile of sample.projectiles) {
      present.add(projectile.id);
      let object = this.#projectiles.get(projectile.id);
      if (!object) {
        object = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(0.08, projectile.radius), 12, 8),
          transparentMaterial(colorFromText(projectile.color), 0.92),
        );
        this.#root.add(object);
        this.#projectiles.set(projectile.id, object);
      }
      object.position.set(projectile.x, projectile.y, projectile.z);
    }
    for (const [id, object] of this.#projectiles) {
      if (present.has(id)) continue;
      disposeObject(object);
      this.#projectiles.delete(id);
    }
  }

  #syncEventMarkers(events: readonly WorldEventSnapshot[]): void {
    const present = new Set<string>();
    for (const event of events) {
      const needsMarker =
        event.presentation !== "native" || event.graphicAssetId === null || !!event.harvest;
      if (!needsMarker) continue;
      present.add(event.id);
      let object = this.#eventMarkers.get(event.id);
      if (!object) {
        object = new THREE.Mesh(
          new THREE.TorusGeometry(0.25, 0.045, 8, 24),
          transparentMaterial(0x73d6b2, 0.6),
        );
        object.rotation.x = Math.PI / 2;
        this.#root.add(object);
        this.#eventMarkers.set(event.id, object);
      }
      const x = event.col + 0.5 - this.#size / 2;
      const z = event.row + 0.5 - this.#size / 2;
      object.position.set(x, this.#groundY(x, z, 0.06), z);
      object.visible =
        event.harvest?.state !== "depleted" || event.harvest.exhaustionBehavior !== "hide";
      materialOpacity(object, event.harvest?.state === "depleted" ? 0.2 : 0.6);
    }
    for (const [id, object] of this.#eventMarkers) {
      if (present.has(id)) continue;
      disposeObject(object);
      this.#eventMarkers.delete(id);
    }
  }

  showWorldEvent(
    text: string,
    tone: "info" | "good" | "bad",
    x: number,
    z: number,
    now = performance.now(),
  ): void {
    if (typeof document === "undefined") return;
    const element = document.createElement("div");
    element.textContent = text;
    element.dataset.tone = tone;
    Object.assign(element.style, {
      position: "fixed",
      zIndex: "40",
      pointerEvents: "none",
      transform: "translate(-50%, -100%)",
      color: tone === "bad" ? "#ff8b77" : tone === "good" ? "#8ff0ad" : "#f8e6b4",
      fontFamily: '"Alegreya Sans SC", sans-serif',
      fontWeight: "800",
      fontSize: "15px",
      textShadow: "0 2px 3px #142019, 0 0 8px #142019",
      whiteSpace: "nowrap",
    });
    document.body.append(element);
    this.#labels.push({
      element,
      point: new THREE.Vector3(x, this.#groundY(x, z, 1.4), z),
      endsAt: now + 1500,
    });
  }

  screenToWorld(clientX: number, clientY: number): GroundVector | null {
    const rect = this.#canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#scene.camera.updateMatrixWorld();
    this.#raycaster.setFromCamera(ndc, this.#scene.camera);
    if (!this.#raycaster.ray.intersectPlane(this.#groundPlane, this.#rayPoint)) return null;
    const half = this.#size / 2;
    if (
      this.#rayPoint.x < -half ||
      this.#rayPoint.x > half ||
      this.#rayPoint.z < -half ||
      this.#rayPoint.z > half
    ) {
      return null;
    }
    return { x: this.#rayPoint.x, z: this.#rayPoint.z };
  }

  setEditorOverlay(overlay: Hd2dEditorOverlay | null): void {
    for (const child of [...this.#editorRoot.children]) disposeObject(child);
    this.#editorRoot.clear();
    if (!overlay) return;

    const half = this.#size / 2;
    const lift = overlay.dim ? 0.085 : 0.06;
    if (overlay.showGrid) {
      const positions: number[] = [];
      const point = (x: number, z: number): void => {
        positions.push(x, this.#groundY(x, z, lift), z);
      };
      for (let col = 0; col <= overlay.cols; col += 1) {
        const x = col - half;
        for (let row = 0; row < overlay.rows; row += 1) {
          point(x, row - half);
          point(x, row + 1 - half);
        }
      }
      for (let row = 0; row <= overlay.rows; row += 1) {
        const z = row - half;
        for (let col = 0; col < overlay.cols; col += 1) {
          point(col - half, z);
          point(col + 1 - half, z);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        color: overlay.dim ? 0x9fc4c0 : 0xdce8cb,
        transparent: true,
        opacity: overlay.dim ? 0.5 : 0.3,
        depthWrite: false,
        toneMapped: false,
      });
      this.#editorRoot.add(new THREE.LineSegments(geometry, material));
    }

    if (overlay.showCollisions) {
      for (const collider of overlay.colliders) {
        const x = collider.x + collider.w / 2;
        const z = collider.z + collider.h / 2;
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(collider.w, collider.h),
          transparentMaterial(0xd84b3e, 0.38),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, this.#groundY(x, z, 0.1), z);
        this.#editorRoot.add(mesh);
      }
    }

    const addCursor = (point: GroundVector, color: number, scale: number): void => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.42 * scale, 0.5 * scale, 4),
        transparentMaterial(color, 0.92),
      );
      ring.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      ring.position.set(point.x, this.#groundY(point.x, point.z, 0.13), point.z);
      this.#editorRoot.add(ring);
    };
    if (overlay.hover) addCursor(overlay.hover, 0xffd66b, 1);
    if (overlay.selection) addCursor(overlay.selection, 0x57d6ff, 1.12);
    if (overlay.stairsPreview) {
      const preview = meshStairs([overlay.stairsPreview.ramp], {
        levelHeight: overlay.stairsPreview.levelHeight,
        color: overlay.stairsPreview.valid ? 0xffd66b : 0xe34d42,
        opacity: 0.58,
        lift: 0.03,
      });
      this.#editorRoot.add(preview.group);
    }
  }

  update(now: number): void {
    for (let index = this.#effects.length - 1; index >= 0; index -= 1) {
      const effect = this.#effects[index];
      if (!effect) continue;
      effect.object.visible = now >= effect.startedAt;
      if (now < effect.startedAt) continue;
      if (now >= effect.endsAt) {
        disposeObject(effect.object);
        this.#effects.splice(index, 1);
        continue;
      }
      effect.update(
        THREE.MathUtils.clamp((now - effect.startedAt) / (effect.endsAt - effect.startedAt), 0, 1),
      );
    }
    for (const [id, camp] of this.#camps) {
      if (now < camp.endsAt) continue;
      disposeObject(camp.object);
      this.#camps.delete(id);
    }
    for (const [id, until] of this.#hiddenQuestSites) {
      if (now < until) continue;
      this.#hiddenQuestSites.delete(id);
      this.#questVisualKey = "";
    }
    for (let index = this.#labels.length - 1; index >= 0; index -= 1) {
      const label = this.#labels[index];
      if (!label) continue;
      if (now >= label.endsAt) {
        label.element.remove();
        this.#labels.splice(index, 1);
        continue;
      }
      const projected = label.point.clone().project(this.#scene.camera);
      const rect = this.#canvas.getBoundingClientRect();
      label.element.style.left = `${rect.left + (projected.x * 0.5 + 0.5) * rect.width}px`;
      label.element.style.top = `${rect.top + (-projected.y * 0.5 + 0.5) * rect.height}px`;
      label.element.style.opacity = String(Math.min(1, (label.endsAt - now) / 350));
    }
  }

  diagnostics(): Record<string, number> {
    return {
      actorsSecondary: this.#loot.size + this.#projectiles.size,
      camps: this.#camps.size,
      effects: this.#effects.length,
      eventMarkers: this.#eventMarkers.size,
      labels: this.#labels.length,
      questMarkers: this.#questMarkers.size,
    };
  }

  dispose(): void {
    for (const label of this.#labels) label.element.remove();
    this.#labels.length = 0;
    disposeObject(this.#root);
    this.#effects.length = 0;
    this.#loot.clear();
    this.#projectiles.clear();
    this.#eventMarkers.clear();
    this.#camps.clear();
    this.#questMarkers.clear();
    this.#hiddenQuestSites.clear();
    this.#merchant = null;
    this.#aim = null;
  }
}
