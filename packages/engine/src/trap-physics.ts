/**
 * Server-authored trap impulses, expressed in the same tile/second units as hero movement.
 *
 * The launch speed is calibrated against the shared 30 units/s² hero gravity: at 60 Hz its apex
 * is about 2.7 units, i.e. three ordinary authored levels (3 × 0.9). The push keeps the normal
 * jump's vertical arc and turns the preset's author-facing power into horizontal take-off speed.
 */
export const TRAP_PUSH_VERTICAL_SPEED = 9;
export const TRAP_PUSH_HORIZONTAL_SPEED_PER_POWER = 2.5;
export const TRAP_LAUNCH_THREE_LEVEL_SPEED = 13;
