import * as THREE from "three";

export type Joint = [number, number, number];
export interface PriestFoot {
  position: Joint;
  contact: boolean;
  pitch: number;
}
export interface PriestPose {
  pelvis: Joint;
  lean: number;
  twist: number;
  roll: number;
  headTilt: number;
  feet: [PriestFoot, PriestFoot];
  hands: [Joint, Joint];
  staffPitch: number;
  staffRoll: number;
  cloth: number;
  glow: number;
  collapse: number;
  bodyY: number;
}

const mix = (a: number, b: number, t: number): number =>
  a === b ? a : THREE.MathUtils.lerp(a, b, t);
export function blendPriestPose(a: PriestPose, b: PriestPose, t: number): PriestPose {
  const joint = (x: Joint, y: Joint): Joint => [
    mix(x[0], y[0], t),
    mix(x[1], y[1], t),
    mix(x[2], y[2], t),
  ];
  const foot = (x: PriestFoot, y: PriestFoot): PriestFoot => ({
    position: joint(x.position, y.position),
    contact: t < 0.5 ? x.contact : y.contact,
    pitch: mix(x.pitch, y.pitch, t),
  });
  return {
    pelvis: joint(a.pelvis, b.pelvis),
    lean: mix(a.lean, b.lean, t),
    twist: mix(a.twist, b.twist, t),
    roll: mix(a.roll, b.roll, t),
    headTilt: mix(a.headTilt, b.headTilt, t),
    feet: [foot(a.feet[0], b.feet[0]), foot(a.feet[1], b.feet[1])],
    hands: [joint(a.hands[0], b.hands[0]), joint(a.hands[1], b.hands[1])],
    staffPitch: mix(a.staffPitch, b.staffPitch, t),
    staffRoll: mix(a.staffRoll, b.staffRoll, t),
    cloth: mix(a.cloth, b.cloth, t),
    glow: mix(a.glow, b.glow, t),
    collapse: mix(a.collapse, b.collapse, t),
    bodyY: mix(a.bodyY, b.bodyY, t),
  };
}

/** Exact two-bone IK, shared by every pose. An unreachable target is clamped at the caller. */
function bendJoint(
  start: THREE.Vector3,
  end: THREE.Vector3,
  length: number,
  pole: THREE.Vector3,
): THREE.Vector3 {
  const delta = end.clone().sub(start),
    distance = Math.min(length * 2 - 0.00001, Math.max(0.00001, delta.length()));
  delta.normalize();
  pole.addScaledVector(delta, -pole.dot(delta)).normalize();
  return start
    .clone()
    .addScaledVector(delta, distance / 2)
    .addScaledVector(pole, Math.sqrt(Math.max(0, length * length - (distance * distance) / 4)));
}

export function createPriestPoseApplicator(root: THREE.Object3D): (pose: PriestPose) => void {
  const bone = (name: string): THREE.Object3D => {
    const value = root.getObjectByName(name);
    if (!value) throw new Error(`Priest rig missing ${name}`);
    return value;
  };
  const body = bone("body"),
    torso = bone("torso"),
    head = bone("head"),
    cape = bone("cape"),
    staff = bone("staff");
  const panels = [0, 1, 2, 3].map((index) => bone(`panel${index}`));
  const limbs = ([-1, 1] as const).map((side) => ({
    side,
    thigh: bone(`thigh${side}`),
    shin: bone(`shin${side}`),
    knee: bone(`knee${side}`),
    foot: bone(`foot${side}`),
    upper: bone(`upper${side}`),
    lower: bone(`lower${side}`),
    elbow: bone(`elbow${side}`),
    hand: bone(`hand${side}`),
  }));
  const vertical = new THREE.Vector3(0, 1, 0);
  const link = (node: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void => {
    const delta = to.clone().sub(from);
    node.position.copy(from).add(to).multiplyScalar(0.5);
    node.quaternion.setFromUnitVectors(vertical, delta.clone().normalize());
    node.scale.y = delta.length();
  };
  return (pose) => {
    body.rotation.set(0, 0, (-Math.PI / 2) * pose.collapse);
    body.position.set(-0.28 * pose.collapse, pose.bodyY, 0);
    torso.position.set(...pose.pelvis);
    torso.rotation.set(pose.lean, pose.twist, pose.roll);
    head.rotation.x = pose.headTilt;
    cape.rotation.x = -pose.cloth;
    panels.forEach((panel, index) => {
      const foot = pose.feet[index < 2 ? 0 : 1];
      panel.rotation.x = -foot.position[2] * 0.65 + pose.cloth * (index % 2 === 0 ? -0.6 : 0.15);
    });
    limbs.forEach((limb, index) => {
      const foot = pose.feet[index === 0 ? 0 : 1],
        hip = new THREE.Vector3(
          pose.pelvis[0] + limb.side * 0.135,
          pose.pelvis[1] - 0.035,
          pose.pelvis[2],
        );
      const ankle = new THREE.Vector3(...foot.position),
        legDelta = ankle.clone().sub(hip);
      if (legDelta.length() > 0.62999) ankle.copy(hip).add(legDelta.setLength(0.62999));
      const knee = bendJoint(hip, ankle, 0.315, new THREE.Vector3(0, 0, 1));
      link(limb.thigh, hip, knee);
      link(limb.shin, knee, ankle);
      limb.knee.position.copy(knee);
      limb.foot.position.copy(ankle);
      limb.foot.rotation.x = foot.pitch;
      const shoulder = new THREE.Vector3(limb.side * 0.265, 0.28, 0);
      const target = new THREE.Vector3(...pose.hands[index === 0 ? 0 : 1])
        .sub(torso.position)
        .applyQuaternion(torso.quaternion.clone().invert());
      const armDelta = target.clone().sub(shoulder);
      if (armDelta.length() > 0.45999) target.copy(shoulder).add(armDelta.setLength(0.45999));
      const elbow = bendJoint(
        shoulder,
        target,
        0.23,
        new THREE.Vector3(limb.side * 0.25, -1, -0.2),
      );
      link(limb.upper, shoulder, elbow);
      link(limb.lower, elbow, target);
      limb.elbow.position.copy(elbow);
      limb.hand.position.copy(target);
    });
    staff.rotation.set(pose.staffPitch, 0, pose.staffRoll);
    root.updateMatrixWorld(true);
  };
}
