export const MAX_CAMERA_SHAKE_OFFSET = 12;

/**
 * The hero's own landing (`apps/lab/src/boot.ts`'s `shake(CAMERA.shake.land * choc)`).
 *
 * The curve stays LINEAR in the rule's landing weight, exactly as the lab's was; only the unit
 * changed, because the lab displaced the camera in world units and this renderer offsets the
 * projection in pixels. `intensityPerForce` is set so the ratio the lab was tuned at survives the
 * conversion: a hard landing is worth about half a critter blast, and a gentle one is worth almost
 * nothing — which is the whole point of scaling by fall speed at all.
 */
export const HERO_LANDING_SHAKE = { intensityPerForce: 1.35, durationMs: 220 } as const;

/**
 * The critter blast (`flock.onExplode = () => shake(0.26)` in the lab).
 *
 * Unlike a landing this can go off across the field, so it keeps a real radius and is scaled down
 * with distance like every other world impact.
 */
export const SHEEP_EXPLOSION_SHAKE = {
  intensity: 4,
  durationMs: 240,
  maxDistanceTiles: 9,
} as const;

export interface CameraShakeImpulse {
  /** Authoritative action id; the renderer rejects duplicates before an impulse reaches this seam. */
  id: string;
  now: number;
  intensity: number;
  durationMs: number;
  /** World-space distance between the local player and the authoritative impact. */
  distance: number;
  maxDistance: number;
}

interface ActiveCameraShake {
  startedAt: number;
  endsAt: number;
  amplitude: number;
  phase: number;
}

function phaseFor(id: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) / 0xffff_ffff) * Math.PI * 2;
}

/**
 * The hero's landing as an impulse, or `null` when the rule reported no weight at all.
 *
 * `distance: 0` against a nominal radius: these are the local hero's own feet, and there is nothing
 * to attenuate. Every other caller of `trigger` reports a real world distance, because every other
 * caller is shaking for something that happened somewhere else.
 */
export function heroLandingImpulse(force: number, now: number): CameraShakeImpulse | null {
  if (!Number.isFinite(force) || force <= 0) return null;
  return {
    // The landing carries no authoritative id — it is a client-owned event, decided by the movement
    // rule this client runs — so the timestamp seeds the phase instead. Two landings a frame apart
    // therefore shake along different axes, which one shared id would not give.
    id: `hero-landing-${now}`,
    now,
    intensity: force * HERO_LANDING_SHAKE.intensityPerForce,
    durationMs: HERO_LANDING_SHAKE.durationMs,
    distance: 0,
    maxDistance: 1,
  };
}

/**
 * Local presentation-only camera impulses. Inputs are deterministic and distance-scaled; neither
 * collision nor damage ever reads this class. Concurrent impacts add together before one final
 * magnitude clamp, so a crowded fight feels stronger without making the camera uncontrollable.
 */
export class CameraShake {
  #active: ActiveCameraShake[] = [];

  trigger(impulse: CameraShakeImpulse): boolean {
    if (
      !Number.isFinite(impulse.now) ||
      !Number.isFinite(impulse.intensity) ||
      !Number.isFinite(impulse.durationMs) ||
      !Number.isFinite(impulse.distance) ||
      !Number.isFinite(impulse.maxDistance) ||
      impulse.intensity <= 0 ||
      impulse.durationMs <= 0 ||
      impulse.maxDistance <= 0 ||
      impulse.distance < 0 ||
      impulse.distance >= impulse.maxDistance
    ) {
      return false;
    }
    const proximity = 1 - impulse.distance / impulse.maxDistance;
    this.#active.push({
      startedAt: impulse.now,
      endsAt: impulse.now + impulse.durationMs,
      amplitude: impulse.intensity * proximity * proximity,
      phase: phaseFor(impulse.id),
    });
    return true;
  }

  offset(now: number): { x: number; y: number } {
    this.#active = this.#active.filter((impulse) => now < impulse.endsAt);
    let x = 0;
    let y = 0;
    for (const impulse of this.#active) {
      const duration = Math.max(1, impulse.endsAt - impulse.startedAt);
      const progress = Math.max(0, Math.min(1, (now - impulse.startedAt) / duration));
      const envelope = (1 - progress) ** 2;
      const oscillation = progress * Math.PI * 8;
      x += Math.sin(impulse.phase + oscillation) * impulse.amplitude * envelope;
      y += Math.cos(impulse.phase * 1.37 + oscillation * 1.13) * impulse.amplitude * envelope;
    }
    const magnitude = Math.hypot(x, y);
    if (magnitude <= MAX_CAMERA_SHAKE_OFFSET || magnitude === 0) return { x, y };
    const scale = MAX_CAMERA_SHAKE_OFFSET / magnitude;
    return { x: x * scale, y: y * scale };
  }

  clear(): void {
    this.#active = [];
  }
}
