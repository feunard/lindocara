import type { CharacterAnimationSample, CharacterMotion } from "./character-animation.js";
import type { UnitSheet } from "./tiny-swords-art.js";

/** Common delivery contract for the offline raster animation pipeline. */
export interface RasterClip {
  frames: number;
  durationMs: number;
  loop: boolean;
  pixelsPerTile: number;
  frame: { width: number; height: number; anchor: { x: number; y: number } };
  directionRows: number;
  columns: number;
  directionStride: number;
  phaseBuckets?: number;
  transitionFrames?: number;
}

export interface RasterSocket {
  x: number;
  y: number;
}

/** A socket uses the same fixed source canvas, yaw and pitch compensation as the actor card. */
export function rasterSocketOffset(
  socket: RasterSocket,
  anchor: RasterSocket,
  pixelsPerTile: number,
  flipped: boolean,
  yaw: number,
  pitch: number,
  stretch: number,
): { x: number; y: number; z: number } {
  const x = ((socket.x - anchor.x) / pixelsPerTile) * (flipped ? -1 : 1);
  const y = ((anchor.y - socket.y) / pixelsPerTile) * (1 + (1 / Math.cos(pitch) - 1) * stretch);
  return { x: x * Math.cos(yaw), y, z: -x * Math.sin(yaw) };
}

export type RasterMotionClip =
  | Exclude<CharacterMotion, "attack">
  | "start"
  | "stop"
  | "jump-run"
  | "land-run";

export function rasterMotionClip(
  motion: Exclude<CharacterMotion, "attack">,
  clips: { stop: RasterClip; start: RasterClip },
  sample?: CharacterAnimationSample,
): RasterMotionClip {
  if (!sample) return motion;
  if (
    motion === "idle" &&
    sample.stopPhase !== undefined &&
    sample.elapsedMs < clips.stop.durationMs
  )
    return "stop";
  if (motion === "run" && sample.startedFromIdle && sample.elapsedMs < clips.start.durationMs)
    return "start";
  if (motion === "jump" && sample.takeoffPhase !== undefined) return "jump-run";
  if (motion === "land" && sample.speed > 0.025) return "land-run";
  return motion;
}

export function rasterSheet(source: string, name: string, clip: RasterClip): UnitSheet {
  return {
    source,
    frames: clip.frames,
    frameWidth: clip.frame.width,
    frameHeight: clip.frame.height,
    footOffset: clip.frame.height - clip.frame.anchor.y,
    renderHeight: clip.frame.height / clip.pixelsPerTile,
    directionRows: clip.directionRows,
    sheetColumns: clip.columns,
    directionStride: clip.directionStride,
    ...(["run", "jump-run", "land-run", "start", "stop"].includes(name)
      ? { mirroredPhaseOffset: 0.5 }
      : {}),
  };
}

/** A direction change keeps both the stride and the selected takeoff/landing bank. */
export function rasterFrame(
  name: string,
  clip: RasterClip,
  sample: CharacterAnimationSample,
): number | undefined {
  if (clip.phaseBuckets && clip.transitionFrames) {
    const phase =
      name === "stop"
        ? (sample.stopPhase ?? 0)
        : name === "jump-run"
          ? (sample.takeoffPhase ?? 0)
          : sample.stridePhase;
    const bank = Math.round(phase * clip.phaseBuckets) % clip.phaseBuckets;
    const progress =
      name === "jump-run" ? sample.phase : Math.min(1, sample.elapsedMs / clip.durationMs);
    let frame = Math.min(clip.transitionFrames - 1, Math.floor(progress * clip.transitionFrames));
    if (name === "start") frame = clip.transitionFrames - 1 - frame;
    return bank * clip.transitionFrames + frame;
  }
  if (sample.motion === "run" || sample.motion === "jump" || sample.motion === "fall")
    return Math.min(
      clip.frames - 1,
      Math.floor(sample.phase * (clip.loop ? clip.frames : clip.frames - 1)),
    );
  return undefined;
}
