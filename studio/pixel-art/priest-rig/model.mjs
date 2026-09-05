import * as THREE from 'three';

// All lengths are world units. Every view and every action uses this one construction.
export const DESIGN = Object.freeze({
  stature: 1.52, hipHeight: 0.61, thigh: 0.315, shin: 0.315,
  stride: 1.72, stance: 0.4, cameraPitch: 38 * Math.PI / 180,
  canvas: 160, extent: 2.8, anchor: [80, 116],
});

const PALETTE = {
  ink: 0x202636, ivory: 0xe9dfba, linen: 0xbcb591, teal: 0x337d78,
  darkTeal: 0x214e55, gold: 0xc9974f, lightGold: 0xf2cd77,
  skin: 0xb77852, skinLight: 0xd29a70, hair: 0x59392e, hairLight: 0x815237,
  leather: 0x624331, leatherLight: 0x96704b, boot: 0x453a33, crystal: 0xffdc8a,
};

const v = (a) => new THREE.Vector3(...a);
const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const wave = (t) => Math.sin(t * Math.PI * 2);

/** Analytic two-bone IK. Neither the thigh nor shin ever changes length. */
export function kneeFor(hip, ankle, a = DESIGN.thigh, b = DESIGN.shin) {
  const end = v(ankle), start = v(hip), axis = end.clone().sub(start);
  const distance = Math.min(a + b - 0.00001, Math.max(0.00001, axis.length()));
  axis.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const bend = new THREE.Vector3(0, 0, 1).addScaledVector(axis, -axis.z).normalize();
  return start.addScaledVector(axis, along).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along))).toArray();
}

/** One foot remains stationary in world space throughout stance: z' = -stride. */
export function gaitFoot(phase, side) {
  const t = ((phase + (side > 0 ? 0.5 : 0)) % 1 + 1) % 1;
  const span = DESIGN.stride * DESIGN.stance;
  if (t < DESIGN.stance) return { position: [side * 0.16, 0.07, span / 2 - DESIGN.stride * t], contact: true, pitch: 0 };
  const swing = (t - DESIGN.stance) / (1 - DESIGN.stance);
  // Cubic Hermite keeps the endpoint velocity continuous with the preceding support phase.
  const d = -DESIGN.stride * (1 - DESIGN.stance);
  const h = swing * swing * (3 - 2 * swing);
  const z = mix(-span / 2, span / 2, h) + d * (2 * swing ** 3 - 3 * swing ** 2 + swing);
  return { position: [side * 0.16, 0.07 + 0.21 * Math.sin(Math.PI * swing) ** 2, z], contact: false,
    pitch: -0.35 * Math.sin(Math.PI * swing) };
}

export function neutralPose() {
  return {
    pelvis: [0, DESIGN.hipHeight, 0], lean: 0, twist: 0, roll: 0, headTilt: 0,
    feet: [{ position: [-0.16, 0.07, 0.015], contact: true, pitch: 0 }, { position: [0.16, 0.07, -0.015], contact: true, pitch: 0 }],
    hands: [[-0.39, 0.84, 0.20], [0.36, 0.70, 0.07]],
    staffPitch: 0.04, staffRoll: -0.05, cloth: 0, glow: 0, collapse: 0,
  };
}

export function poseAt(action, progress) {
  const p = neutralPose(), t = Math.max(0, Math.min(1, progress));
  if (action === 'idle') {
    p.pelvis[1] += 0.009 * wave(t);
    p.hands[0][1] += 0.006 * wave(t);
    p.hands[1][1] += 0.01 * wave(t);
    p.headTilt = 0.015 * wave(t); p.cloth = 0.014 * wave(t - 0.15);
  } else if (action === 'run') {
    p.feet = [gaitFoot(t, -1), gaitFoot(t, 1)];
    p.pelvis[1] = 0.575 + 0.027 * Math.cos(t * Math.PI * 4);
    p.pelvis[0] = -0.014 * wave(t); p.lean = 0.13;
    p.twist = 0.045 * wave(t); p.headTilt = -0.035;
    p.hands[0] = [-0.39, 0.86 + 0.016 * wave(t), 0.17 + 0.045 * wave(t)];
    p.hands[1] = [0.36, 0.76, 0.08 - 0.18 * wave(t)];
    p.staffPitch = -0.20 + 0.045 * wave(t - 0.12);
    p.cloth = 0.14 + 0.07 * wave(t - 0.13);
  } else if (action === 'jump') {
    p.pelvis[1] -= 0.055 * (1 - smooth(t / 0.25));
    p.lean = -0.04 * smooth(t);
    p.feet[0].position = [-0.16, 0.07 + 0.18 * smooth(t), -0.09 * smooth(t)];
    p.feet[1].position = [0.16, 0.07 + 0.11 * smooth(t), 0.10 * smooth(t)];
    p.hands[1] = [0.38, 0.74 + 0.17 * smooth(t), 0.09];
    p.staffPitch = -0.12 * smooth(t); p.cloth = 0.08 * smooth(t);
    p.feet.forEach(f => { f.contact = false; });
  } else if (action === 'fall') {
    const s = smooth(t);
    p.feet[0].position = [-0.16, mix(0.25, 0.08, s), mix(-0.09, 0.08, s)];
    p.feet[1].position = [0.16, mix(0.18, 0.07, s), mix(0.10, -0.08, s)];
    p.hands[1] = [0.38, mix(0.91, 0.85, s), 0.09];
    p.staffPitch = -0.12; p.lean = mix(-0.04, 0.10, s); p.cloth = mix(0.08, 0.25, s);
    p.feet.forEach(f => { f.contact = false; });
  } else if (action === 'land') {
    const compression = Math.sin(Math.PI * smooth(t));
    p.pelvis[1] -= 0.11 * compression; p.lean = 0.10 * (1 - smooth(t)) + 0.08 * compression;
    p.feet[0].position[2] = 0.08 * (1 - smooth(t)); p.feet[1].position[2] = -0.08 * (1 - smooth(t));
    p.hands[1][1] += 0.15 * (1 - smooth(t));
    p.staffPitch = -0.12 * (1 - smooth(t)); p.cloth = 0.25 * (1 - smooth(t)) - 0.05 * compression;
  } else if (action === 'swim') {
    p.lean = 0.16; p.pelvis[1] += 0.016 * wave(t);
    p.hands[1] = [0.36 + 0.08 * Math.cos(t * Math.PI * 2), 0.74, 0.16 + 0.17 * wave(t)];
    p.feet.forEach((f, i) => { f.position[2] += 0.12 * wave(t + i * 0.5); f.contact = false; });
    p.staffPitch = -0.32; p.cloth = 0.16;
  } else if (action === 'glide') {
    p.hands = [[-0.36, 1.03, 0.15], [0.33, 1.20, 0.10]];
    p.feet[0].position = [-0.16, 0.16, -0.11]; p.feet[1].position = [0.16, 0.12, 0.08];
    p.staffPitch = 0.70; p.cloth = 0.16 + 0.02 * wave(t);
    p.feet.forEach(f => { f.contact = false; });
  } else if (action === 'hurt') {
    const recoil = Math.sin(Math.PI * smooth(t));
    p.lean = -0.14 * recoil; p.headTilt = -0.08 * recoil;
    p.pelvis[1] -= 0.03 * recoil; p.hands[1][2] += 0.08 * recoil;
    p.staffPitch -= 0.12 * recoil;
  } else if (action === 'death') {
    // Buckle first, then rotate the entire linked body into its settled side pose.
    const buckle = smooth(t / 0.38), fall = smooth((t - 0.24) / 0.52);
    p.pelvis[1] -= 0.25 * buckle;
    p.lean = 0.24 * buckle; p.headTilt = 0.18 * buckle;
    p.hands[1] = [0.36, mix(0.70, 0.62, buckle), mix(0.07, 0.28, buckle)];
    p.staffRoll = -0.05 - 0.40 * buckle; p.staffPitch = 0.04 - 0.20 * buckle;
    p.collapse = fall; p.cloth = 0.12 * buckle * (1 - fall);
    p.feet.forEach(f => { f.contact = t < 0.36; });
  } else {
    // The manifest places release at t = 0.4. Server timestamps, not clip FPS, select it.
    const charge = smooth(t / 0.3), release = smooth((t - 0.25) / 0.15), recover = smooth((t - 0.56) / 0.44);
    const active = 1 - recover, reach = charge * active;
    p.glow = Math.sin(Math.PI * Math.min(1, t / 0.75)) ** 2;
    if (action === 'radiant-bolt') {
      p.hands[1] = [0.33, 0.70 + 0.22 * reach, 0.07 - 0.11 * reach + 0.42 * release * active];
      p.twist = -0.13 * reach + 0.18 * release * active;
      p.lean = -0.06 * reach + 0.14 * release * active;
      p.staffPitch = 0.04 + 0.12 * reach;
    } else if (action === 'mend') {
      p.hands[1] = [0.36 - 0.26 * reach, 0.70 + 0.25 * reach, 0.07 + 0.27 * reach];
      p.headTilt = 0.08 * reach; p.staffPitch = 0.04 - 0.08 * reach;
    } else if (action === 'blink') {
      p.pelvis[1] -= 0.10 * reach;
      p.hands[1] = [0.36 - 0.27 * reach, 0.70 + 0.20 * reach, 0.07 + 0.22 * reach];
      p.staffPitch = 0.04 - 0.30 * reach; p.cloth = 0.15 * reach;
    } else if (action === 'prayer') {
      p.hands[1] = [0.36 + 0.04 * reach, 0.70 + 0.43 * reach, 0.07 + 0.16 * reach];
      p.hands[0][1] += 0.16 * reach; p.headTilt = -0.10 * reach;
      p.staffPitch = 0.04 - 0.07 * reach;
    } else if (action === 'divine-nova') {
      p.pelvis[1] -= 0.10 * charge * (1 - release) * active;
      p.hands[1] = [0.36 + 0.04 * reach, 0.70 + 0.47 * reach, 0.07 + 0.12 * reach];
      p.hands[0][1] += 0.23 * reach; p.headTilt = -0.12 * reach;
      p.lean = -0.10 * reach; p.cloth = 0.16 * release * active;
    }
  }
  return p;
}

export function createPriest() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  body.name='body';
  const ramp = new THREE.DataTexture(new Uint8Array([85, 145, 200, 255]), 4, 1, THREE.RedFormat);
  ramp.needsUpdate = true; ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  const materials = Object.fromEntries(Object.entries(PALETTE).map(([name, color]) => [name, new THREE.MeshToonMaterial({ color, gradientMap: ramp })]));
  const outline = new THREE.MeshBasicMaterial({ color: PALETTE.ink, side: THREE.BackSide });
  const resources = new Set(), joints = {};
  function mesh(parent, geometry, material, position = [0, 0, 0], scale = [1, 1, 1], border = 0.024) {
    resources.add(geometry);
    const object = new THREE.Mesh(geometry, materials[material]);
    object.position.set(...position); object.scale.set(...scale); parent.add(object);
    if (border) {
      const edge = new THREE.Mesh(geometry, outline); edge.scale.setScalar(1 + border); object.add(edge);
    }
    return object;
  }
  const sphere = (parent, material, pos, scale, border) => mesh(parent, new THREE.SphereGeometry(1, 16, 12), material, pos, scale, border);
  const box = (parent, material, pos, scale, border) => mesh(parent, new THREE.BoxGeometry(1, 1, 1), material, pos, scale, border);
  const cylinder = (parent, material, pos, top, bottom, height, segments = 12) => mesh(parent, new THREE.CylinderGeometry(top, bottom, height, segments), material, pos);
  function link(material, thickness, a, b, parent = body) {
    const object = cylinder(parent, material, [0, 0, 0], thickness, thickness * 0.92, 1);
    function set(from, to) {
      const delta = v(to).sub(v(from)); object.position.copy(v(from).add(v(to)).multiplyScalar(0.5));
      object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
      object.scale.y = delta.length();
    }
    set(a, b); return { object, set };
  }
  const torso = new THREE.Group(); torso.name='torso'; body.add(torso);
  cylinder(torso, 'ivory', [0, 0.15, 0], 0.22, 0.27, 0.40).scale.z = 0.67;
  sphere(torso, 'ivory', [0, 0.30, 0], [0.28, 0.16, 0.17]);
  cylinder(torso, 'leather', [0, -0.015, 0], 0.275, 0.275, 0.085).scale.z = 0.65;
  box(torso, 'gold', [0, -0.015, 0.19], [0.09, 0.072, 0.038]);
  box(torso, 'boot', [0, -0.015, 0.214], [0.045, 0.032, 0.01], 0);
  // Four tunic leaves are anchored at the belt. They overlap at rest and separate during strides.
  const panels = [];
  for (const side of [-1, 1]) for (const back of [-1, 1]) {
    const group = new THREE.Group(); group.position.set(side * 0.125, -0.045, back * 0.06); torso.add(group);
    const cloth = cylinder(group, 'ivory', [0, -0.13, back * 0.017], 0.134, 0.17, 0.29, 8); cloth.scale.z = 0.48;
    const trim = cylinder(group, 'gold', [0, -0.26, back * 0.017], 0.171, 0.174, 0.025, 8); trim.scale.z = 0.48;
    panels.push({ group, side, back });
    group.name=`panel${panels.length-1}`;
  }
  // A short mantle leaves the arms and their silhouettes readable from all eight cameras.
  const mantle = cylinder(torso, 'teal', [0, 0.325, -0.018], 0.145, 0.335, 0.19, 16); mantle.scale.z = 0.67;
  const collar = cylinder(torso, 'gold', [0, 0.423, 0], 0.152, 0.166, 0.025); collar.scale.z = 0.82;
  const mantleHem = cylinder(torso, 'gold', [0, 0.226, -0.018], 0.336, 0.34, 0.025, 16); mantleHem.scale.z = 0.67;
  const cape = new THREE.Group(); cape.position.set(0, 0.27, -0.17); torso.add(cape);
  cape.name='cape';
  const capeShape = new THREE.Shape();
  capeShape.moveTo(-0.18, 0.05); capeShape.lineTo(0.18,0.05); capeShape.lineTo(0.28,-0.29);
  capeShape.lineTo(0.13,-0.33); capeShape.lineTo(0,-0.31); capeShape.lineTo(-0.13,-0.33); capeShape.lineTo(-0.28,-0.29); capeShape.closePath();
  mesh(cape, new THREE.ExtrudeGeometry(capeShape, {depth:0.035, bevelEnabled:true, bevelSize:0.009, bevelThickness:0.006, bevelSegments:1, steps:1}), 'teal', [0,0,-0.065]);
  for (const side of [-1,1]) {
    link('gold',0.012,[side*0.18,0.04,-0.072],[side*0.275,-0.285,-0.072],cape);
    link('gold',0.012,[side*0.275,-0.285,-0.072],[side*0.13,-0.325,-0.072],cape);
    link('darkTeal',0.008,[side*0.10,-0.02,-0.075],[side*0.15,-0.27,-0.075],cape);
  }
  const backSun = mesh(cape,new THREE.TorusGeometry(0.052,0.009,5,14,Math.PI),'gold',[0,-0.17,-0.077]);
  backSun.rotation.y=Math.PI;
  for(const x of [-1,0,1]) box(cape,'gold',[x*0.036,-0.09-Math.abs(x)*0.015,-0.077],[0.012,0.038,0.01],0);
  const stole = new THREE.Group(); torso.add(stole);
  box(stole, 'gold', [0, 0.14, 0.191], [0.092, 0.37, 0.027]);
  box(stole, 'lightGold', [0, 0.16, 0.207], [0.045, 0.30, 0.014], 0);
  const tabard = box(stole, 'gold', [0, -0.15, 0.188], [0.095, 0.26, 0.03]); tabard.rotation.x = -0.06;
  // Sanctuary sun: three rays above a simple arch, legible as a few pixels at gameplay scale.
  sphere(torso, 'lightGold', [0, 0.28, 0.224], [0.06, 0.06, 0.018]);
  sphere(torso, 'teal', [0, 0.28, 0.245], [0.027, 0.027, 0.012], 0);
  for (const x of [-1, 0, 1]) {
    const ray = box(torso, 'gold', [x * 0.049, 0.35 - Math.abs(x) * 0.018, 0.215], [0.019, 0.044, 0.025], 0);
    ray.rotation.z = -x * 0.45;
  }
  const book = new THREE.Group(); book.position.set(0.28, -0.07, -0.01); book.rotation.z = -0.12; torso.add(book);
  box(book, 'darkTeal', [0, -0.015, 0], [0.16, 0.21, 0.1]);
  box(book, 'linen', [0.015, -0.015, 0], [0.136, 0.181, 0.075], 0);
  box(book, 'teal', [0, -0.015, 0.047], [0.16, 0.21, 0.015]);
  box(book, 'gold', [0.032, -0.015, 0.06], [0.025, 0.12, 0.025]);

  const head = new THREE.Group(); head.position.set(0, 0.63, 0.015); torso.add(head);
  head.name='head';
  sphere(head, 'skin', [0, -0.045, 0], [0.225, 0.228, 0.203]);
  sphere(head, 'skinLight', [0, -0.063, 0.073], [0.188, 0.174, 0.15], 0);
  sphere(head, 'skin', [0, -0.073, 0.209], [0.045, 0.046, 0.045]);
  for (const side of [-1, 1]) {
    sphere(head, 'skin', [side * 0.221, -0.06, -0.015], [0.052, 0.069, 0.046]);
    sphere(head, 'ivory', [side * 0.078, -0.038, 0.207], [0.043, 0.048, 0.018], 0.01);
    sphere(head, 'ink', [side * 0.077, -0.039, 0.225], [0.024, 0.035, 0.012], 0);
    sphere(head, 'ivory', [side * 0.077 - 0.007, -0.028, 0.235], [0.009, 0.011, 0.006], 0);
    const brow = box(head, 'hair', [side * 0.077, 0.022, 0.209], [0.084, 0.02, 0.028], 0); brow.rotation.z = side * 0.09;
  }
  const mouth = box(head, 'hair', [0, -0.152, 0.194], [0.063, 0.014, 0.015], 0); mouth.rotation.z = -0.045;
  mesh(head, new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), 'hair', [0, 0.015, -0.019], [0.238, 0.218, 0.215]);
  for (let i = 0; i < 5; i++) {
    const lock = sphere(head, i % 2 ? 'hairLight' : 'hair', [-0.16 + i * 0.07, 0.102 + Math.sin(i) * 0.018, 0.142], [0.075, 0.115, 0.076]);
    lock.rotation.z = -0.58; lock.rotation.x = 0.20;
  }
  for (const side of [-1, 1]) sphere(head, 'hair', [side * 0.205, -0.003, -0.06], [0.053, 0.128, 0.128]);
  const band = mesh(head, new THREE.TorusGeometry(0.216, 0.022, 6, 24), 'ivory', [0, 0.035, 0]); band.rotation.x = Math.PI / 2; band.scale.y = 0.87;
  sphere(head, 'gold', [0, 0.044, 0.211], [0.045, 0.045, 0.021]);
  const browGem = mesh(head, new THREE.OctahedronGeometry(0.025), 'crystal', [0, 0.045, 0.235]); browGem.scale.y = 1.3;

  const legs = [-1, 1].map(side => {
    const thigh = link('linen', 0.087, [0, 0, 0], [0, 1, 0]);
    const shin = link('darkTeal', 0.072, [0, 0, 0], [0, 1, 0]);
    const knee = sphere(body, 'darkTeal', [0, 0, 0], [0.079, 0.079, 0.079]);
    const foot = new THREE.Group(); body.add(foot);
    sphere(foot, 'boot', [0, 0.002, 0.04], [0.096, 0.075, 0.157]);
    box(foot, 'ink', [0, -0.046, 0.043], [0.177, 0.038, 0.262]);
    const cuff = cylinder(foot, 'leather', [0, 0.085, -0.027], 0.085, 0.079, 0.13); cuff.scale.z = 0.9;
    box(foot, 'gold', [0, 0.096, 0.053], [0.07, 0.025, 0.022]);
    for(const [name,object] of Object.entries({thigh:thigh.object,shin:shin.object,knee,foot}))object.name=`${name}${side}`;
    return { side, thigh, shin, knee, foot };
  });

  const arms = [-1, 1].map(side => {
    const upper = link('ivory', 0.097, [0, 0, 0], [0, 1, 0], torso);
    const lower = link('ivory', 0.090, [0, 0, 0], [0, 1, 0], torso);
    const elbow = sphere(torso, 'ivory', [0, 0, 0], [0.096, 0.096, 0.096]);
    const hand = new THREE.Group(); torso.add(hand);
    sphere(hand, 'skinLight', [0, 0, 0], [0.064, 0.072, 0.068]);
    sphere(hand, 'skin', [side * 0.045, 0.006, 0.027], [0.03, 0.038, 0.039]);
    const cuff = cylinder(hand, 'gold', [0, 0.072, -0.007], 0.087, 0.087, 0.037); cuff.rotation.x = 0.2;
    for(const [name,object] of Object.entries({upper:upper.object,lower:lower.object,elbow,hand}))object.name=`${name}${side}`;
    return { side, upper, lower, elbow, hand };
  });
  const staff = new THREE.Group(); arms[0].hand.add(staff);
  staff.name='staff';
  cylinder(staff, 'leatherLight', [0, 0.13, 0.015], 0.024, 0.027, 1.22, 8);
  cylinder(staff, 'gold', [0, -0.44, 0.015], 0.029, 0.023, 0.085, 8);
  for (const y of [0.53, 0.60]) cylinder(staff, 'gold', [0, y, 0.015], 0.035, 0.035, 0.04, 8);
  const arch = mesh(staff, new THREE.TorusGeometry(0.116, 0.026, 6, 18, Math.PI * 1.68), 'gold', [0, 0.72, 0.015]);
  arch.rotation.z = -Math.PI * 0.34;
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI / 4;
    const ray = mesh(staff, new THREE.ConeGeometry(0.027, 0.074, 4), 'lightGold', [Math.cos(angle) * 0.153, 0.72 + Math.sin(angle) * 0.153, 0.015]);
    ray.rotation.z = angle - Math.PI / 2;
  }
  link('gold', 0.009, [0, 0.80, 0.015], [0, 0.72, 0.015], staff);
  const crystal = mesh(staff, new THREE.OctahedronGeometry(0.065), 'crystal', [0, 0.686, 0.015]); crystal.scale.y = 1.45;

  function apply(p, direction = 0) {
    root.rotation.y = direction;
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0);
    torso.position.set(...p.pelvis); torso.rotation.set(p.lean, p.twist, p.roll);
    head.rotation.x = p.headTilt;
    cape.rotation.x = -p.cloth;
    for (const panel of panels) {
      const f = p.feet[panel.side < 0 ? 0 : 1];
      panel.group.rotation.x = -f.position[2] * 0.65 + p.cloth * (panel.back < 0 ? -0.6 : 0.15);
    }
    for (let i = 0; i < 2; i++) {
      const leg = legs[i], f = p.feet[i], hip = [p.pelvis[0] + leg.side * 0.135, p.pelvis[1] - 0.035, p.pelvis[2]];
      const knee = kneeFor(hip, f.position);
      leg.thigh.set(hip, knee); leg.shin.set(knee, f.position); leg.knee.position.set(...knee);
      leg.foot.position.set(...f.position); leg.foot.rotation.x = f.pitch;
      const arm = arms[i], target = v(p.hands[i]).sub(torso.position).applyQuaternion(torso.quaternion.clone().invert());
      const shoulder = [arm.side * 0.265, 0.28, 0];
      // The elbow hangs below the shoulder. Clamp reach without lengthening either bone.
      const armAxis = target.clone().sub(v(shoulder)), armDistance = Math.min(0.45999, armAxis.length());
      if (armAxis.length() > 0.45999) target.copy(v(shoulder)).add(armAxis.clone().setLength(0.45999));
      armAxis.normalize();
      const pole = new THREE.Vector3(arm.side * 0.25, -1, -0.2);
      pole.addScaledVector(armAxis, -pole.dot(armAxis)).normalize();
      const elbow = v(shoulder).addScaledVector(armAxis, armDistance / 2).addScaledVector(pole, Math.sqrt(Math.max(0, 0.23 ** 2 - (armDistance / 2) ** 2))).toArray();
      arm.upper.set(shoulder, elbow); arm.lower.set(elbow, target.toArray()); arm.elbow.position.set(...elbow);
      arm.hand.position.copy(target);
    }
    staff.rotation.set(p.staffPitch, 0, p.staffRoll);
    materials.crystal.emissive.setHex(PALETTE.crystal); materials.crystal.emissiveIntensity = p.glow * 0.2;
    if (p.collapse) {
      body.rotation.z = -Math.PI / 2 * p.collapse;
      // As the body falls to its right, the shoulder becomes its final stable contact.
      body.position.y = 0.06 * p.collapse;
      body.position.x = -0.28 * p.collapse;
      root.updateMatrixWorld(true);
      body.position.y += Math.max(0, -new THREE.Box3().setFromObject(body).min.y);
    }
    root.updateMatrixWorld(true);
    joints.pelvis = torso.getWorldPosition(new THREE.Vector3()).toArray();
    joints.head = head.getWorldPosition(new THREE.Vector3()).toArray();
    joints.feet = legs.map(leg => leg.foot.getWorldPosition(new THREE.Vector3()).toArray());
    joints.knees = legs.map(leg => leg.knee.getWorldPosition(new THREE.Vector3()).toArray());
    joints.hips = legs.map(leg => body.localToWorld(new THREE.Vector3(p.pelvis[0]+leg.side*0.135,p.pelvis[1]-0.035,p.pelvis[2])).toArray());
    joints.bounds = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3()).toArray();
    return joints;
  }
  apply(neutralPose());
  return { root, apply, joints, dispose() {
    resources.forEach(g => g.dispose()); Object.values(materials).forEach(m => m.dispose()); outline.dispose(); ramp.dispose();
  } };
}
