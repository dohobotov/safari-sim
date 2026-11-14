import * as THREE from 'three';
import type { AnimalState, LifeStage, Sex, SpeciesId, Vec3 } from '../shared/types.js';
import { getTerrainSlopeNormal } from '../shared/TerrainMath.js';

export interface AnimalRig {
  root: THREE.Group;
  body: THREE.Group;
  neckPivot: THREE.Group;
  headPivot: THREE.Group;
  legs: THREE.Group[];
  tailPivot?: THREE.Group;
  earL?: THREE.Group;
  earR?: THREE.Group;
  trunk1?: THREE.Group;
  trunk2?: THREE.Group;
  trunk3?: THREE.Group;
  wingL?: THREE.Group;
  wingR?: THREE.Group;
  jawPivot?: THREE.Group;
  mane?: THREE.Object3D;
  antlers?: THREE.Object3D;
  tusks?: THREE.Object3D[];
}

export interface RenderAnimal {
  id: number;
  species: SpeciesId;
  name: string;
  sex: Sex;
  groupId: number;
  maxAgeDays: number;
  ageDays: number;
  stage: LifeStage;

  pos: Vec3;
  targetPos: Vec3;
  yaw: number;
  targetYaw: number;
  speed: number;
  isSwimming: boolean;
  isYawning: boolean;

  hunger: number;
  thirst: number;
  energy: number;
  health: number;
  state: AnimalState;
  statusText: string;

  gaitPhase: number;
  restBlend: number;
  drinkBlend: number;
  browseBlend: number;
  stalkBlend: number;
  swimBlend: number;
  perchBlend: number;
  slopePitch: number;
  slopeRoll: number;

  rig: AnimalRig;
}

const MAT_CACHE = new Map<string, THREE.MeshStandardMaterial>();

function mat(hex: number, roughness = 0.82): THREE.MeshStandardMaterial {
  const key = `${hex}_${roughness}`;
  let m = MAT_CACHE.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: hex,
      roughness,
      metalness: 0.04,
      flatShading: true,
    });
    MAT_CACHE.set(key, m);
  }
  return m;
}

function box(
  w: number,
  h: number,
  d: number,
  color: number,
  x = 0,
  y = 0,
  z = 0
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeLeg(
  w: number,
  len: number,
  d: number,
  color: number,
  x: number,
  y: number,
  z: number,
  hoofColor?: number
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const limb = box(w, len, d, color, 0, -len * 0.5, 0);
  pivot.add(limb);
  // Subtle knee joint ridge
  pivot.add(box(w * 1.07, len * 0.14, d * 1.07, color, 0, -len * 0.45, 0.01));
  if (hoofColor !== undefined) {
    const hoof = box(w * 1.1, len * 0.16, d * 1.1, hoofColor, 0, -len * 0.92, 0);
    pivot.add(hoof);
  }
  return pivot;
}

function addEyes(head: THREE.Group, xOff: number, yOff: number, zOff: number, size = 0.07): void {
  const eyeMat = mat(0x141414, 0.2);
  const eyeGeo = new THREE.BoxGeometry(size, size, size);
  const eL = new THREE.Mesh(eyeGeo, eyeMat);
  eL.position.set(-xOff, yOff, zOff);
  const eR = new THREE.Mesh(eyeGeo, eyeMat);
  eR.position.set(xOff, yOff, zOff);
  head.add(eL, eR);
}

export function createAnimalRig(species: SpeciesId, sex: Sex): AnimalRig {
  switch (species) {
    case 'elephant':
      return buildElephant(sex);
    case 'lion':
      return buildLion(sex);
    case 'tiger':
      return buildTiger();
    case 'giraffe':
      return buildGiraffe();
    case 'hippo':
      return buildHippo();
    case 'zebra':
      return buildZebra();
    case 'antelope':
      return buildAntelope(sex);
    case 'deer':
      return buildDeer(sex);
    case 'boar':
      return buildBoar();
    case 'vulture':
      return buildVulture();
  }
}

function buildElephant(sex: Sex): AnimalRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.45;
  root.add(body);

  const skin = 0x7c8288;
  const darkSkin = 0x62676d;
  const nailCol = 0xdad5c7;

  const torso = box(1.56, 1.46, 2.38, skin, 0, 0.2, -0.05);
  const shoulderHump = box(1.36, 0.34, 1.05, skin, 0, 0.92, 0.42);
  const belly = box(1.38, 0.42, 2.02, darkSkin, 0, -0.42, -0.05);
  body.add(torso, shoulderHump, belly);

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.45, 1.06);
  body.add(neckPivot);

  const headPivot = new THREE.Group();
  neckPivot.add(headPivot);

  const head = box(1.12, 1.08, 1.04, skin, 0, 0.12, 0.38);
  const crown = box(0.92, 0.36, 0.84, skin, 0, 0.7, 0.32);
  headPivot.add(head, crown);
  addEyes(headPivot, 0.56, 0.22, 0.58, 0.09);

  // Flapping ribbed ears
  const earL = new THREE.Group();
  earL.position.set(-0.56, 0.2, 0.28);
  earL.add(box(0.11, 1.08, 0.9, darkSkin, -0.36, -0.08, -0.15));
  earL.add(box(0.06, 0.84, 0.7, skin, -0.34, -0.04, -0.12));
  const earR = new THREE.Group();
  earR.position.set(0.56, 0.2, 0.28);
  earR.add(box(0.11, 1.08, 0.9, darkSkin, 0.36, -0.08, -0.15));
  earR.add(box(0.06, 0.84, 0.7, skin, 0.34, -0.04, -0.12));
  headPivot.add(earL, earR);

  // Articulated 3-segment trunk
  const trunk1 = new THREE.Group();
  trunk1.position.set(0, -0.15, 0.86);
  trunk1.add(box(0.32, 0.65, 0.32, skin, 0, -0.32, 0.06));
  headPivot.add(trunk1);

  const trunk2 = new THREE.Group();
  trunk2.position.set(0, -0.62, 0.06);
  trunk2.add(box(0.24, 0.58, 0.24, skin, 0, -0.28, 0.02));
  trunk1.add(trunk2);

  const trunk3 = new THREE.Group();
  trunk3.position.set(0, -0.56, 0.02);
  trunk3.add(box(0.17, 0.48, 0.18, darkSkin, 0, -0.22, 0.02));
  trunk2.add(trunk3);

  // Gently curving upward ivory tusks
  const tusks: THREE.Object3D[] = [];
  const tuskLen = sex === 'M' ? 1.04 : 0.76;
  for (const side of [-1, 1]) {
    const tPivot = new THREE.Group();
    tPivot.position.set(side * 0.33, -0.28, 0.84);
    tPivot.rotation.x = Math.PI * 0.36;
    tPivot.rotation.z = side * -0.14;
    const baseTusk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.085, tuskLen * 0.55, 5),
      mat(0xf5eedb, 0.35)
    );
    baseTusk.position.y = tuskLen * 0.26;
    baseTusk.castShadow = true;
    const tipTusk = new THREE.Mesh(
      new THREE.ConeGeometry(0.065, tuskLen * 0.55, 5),
      mat(0xfaf4e4, 0.32)
    );
    tipTusk.position.set(0, tuskLen * 0.68, 0.08);
    tipTusk.rotation.x = -0.35;
    tipTusk.castShadow = true;
    tPivot.add(baseTusk, tipTusk);
    headPivot.add(tPivot);
    tusks.push(tPivot);
  }

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.35, -1.2);
  tailPivot.add(box(0.09, 0.95, 0.09, darkSkin, 0, -0.45, -0.05));
  tailPivot.add(box(0.14, 0.22, 0.14, 0x2f2d2b, 0, -0.95, -0.06));
  body.add(tailPivot);

  const legs = [
    makeLeg(0.42, 1.38, 0.44, skin, -0.48, -0.18, 0.72, darkSkin),
    makeLeg(0.42, 1.38, 0.44, skin, 0.48, -0.18, 0.72, darkSkin),
    makeLeg(0.42, 1.38, 0.44, skin, -0.48, -0.18, -0.78, darkSkin),
    makeLeg(0.42, 1.38, 0.44, skin, 0.48, -0.18, -0.78, darkSkin),
  ];
  legs.forEach((l) => {
    l.add(box(0.12, 0.1, 0.08, nailCol, 0, -1.28, 0.21));
    body.add(l);
  });

  return {
    root,
    body,
    neckPivot,
    headPivot,
    legs,
    tailPivot,
    earL,
    earR,
    trunk1,
    trunk2,
    trunk3,
    tusks,
  };
}

function buildLion(sex: Sex): AnimalRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.78;
  root.add(body);

  const fur = 0xd6a14a;
  const belly = 0xe8c98a;
  const maneColor = 0x673a18;
  const maneDark = 0x4b2910;

  body.add(box(0.7, 0.64, 1.5, fur, 0, 0.09, 0));
  body.add(box(0.76, 0.68, 0.56, fur, 0, 0.14, 0.44)); // Muscular forequarters
  body.add(box(0.56, 0.18, 1.25, belly, 0, -0.2, 0));

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.2, 0.66);
  body.add(neckPivot);

  const headPivot = new THREE.Group();
  neckPivot.add(headPivot);

  let maneObj: THREE.Object3D | undefined;
  if (sex === 'M') {
    const maneGroup = new THREE.Group();
    const maneMain = new THREE.Mesh(new THREE.DodecahedronGeometry(0.47, 0), mat(maneColor, 0.92));
    maneMain.scale.set(1.06, 1.14, 0.94);
    maneMain.position.set(0, 0.16, 0.13);
    maneMain.castShadow = true;

    const chestRuff = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36, 0), mat(maneDark, 0.92));
    chestRuff.scale.set(0.95, 1.15, 0.85);
    chestRuff.position.set(0, -0.14, 0.12);
    chestRuff.castShadow = true;

    maneGroup.add(maneMain, chestRuff);
    headPivot.add(maneGroup);
    maneObj = maneGroup;
  }

  headPivot.add(box(0.48, 0.44, 0.52, fur, 0, 0.16, 0.24));
  headPivot.add(box(0.3, 0.22, 0.26, belly, 0, 0.04, 0.5));
  headPivot.add(box(0.12, 0.08, 0.08, 0x2b1b12, 0, 0.1, 0.62));
  headPivot.add(box(0.11, 0.13, 0.08, fur, -0.2, 0.41, 0.14));
  headPivot.add(box(0.11, 0.13, 0.08, fur, 0.2, 0.41, 0.14));
  headPivot.add(box(0.08, 0.09, 0.04, maneDark, -0.2, 0.42, 0.09));
  headPivot.add(box(0.08, 0.09, 0.04, maneDark, 0.2, 0.42, 0.09));
  addEyes(headPivot, 0.24, 0.22, 0.42, 0.055);

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.22, -0.74);
  tailPivot.add(box(0.08, 0.08, 0.82, fur, 0, -0.08, -0.38));
  tailPivot.add(box(0.14, 0.14, 0.2, maneDark, 0, -0.12, -0.84));
  body.add(tailPivot);

  const legs = [
    makeLeg(0.2, 0.72, 0.21, fur, -0.25, -0.08, 0.48),
    makeLeg(0.2, 0.72, 0.21, fur, 0.25, -0.08, 0.48),
    makeLeg(0.2, 0.72, 0.22, fur, -0.24, -0.08, -0.52),
    makeLeg(0.2, 0.72, 0.22, fur, 0.24, -0.08, -0.52),
  ];
  legs.forEach((l) => body.add(l));

  return { root, body, neckPivot, headPivot, legs, tailPivot, mane: maneObj };
}

function buildTiger(): AnimalRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.78;
  root.add(body);

  const orange = 0xe07124;
  const white = 0xf4ead9;
  const stripe = 0x1d1917;

  body.add(box(0.7, 0.62, 1.56, orange, 0, 0.08, 0));
  body.add(box(0.76, 0.66, 0.55, orange, 0, 0.12, 0.46)); // Muscular chest
  body.add(box(0.58, 0.18, 1.34, white, 0, -0.2, 0));

  const stripeZ = [-0.54, -0.3, -0.06, 0.18, 0.42, 0.6];
  for (const z of stripeZ) {
    body.add(box(0.75, 0.46, 0.075, stripe, 0, 0.18, z));
  }

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.2, 0.7);
  body.add(neckPivot);

  const headPivot = new THREE.Group();
  neckPivot.add(headPivot);

  headPivot.add(box(0.52, 0.45, 0.52, orange, 0, 0.15, 0.24));
  headPivot.add(box(0.64, 0.22, 0.22, white, 0, 0.05, 0.22));
  headPivot.add(box(0.3, 0.2, 0.24, white, 0, 0.04, 0.5));
  headPivot.add(box(0.14, 0.08, 0.08, 0x2a1815, 0, 0.11, 0.61));
  headPivot.add(box(0.38, 0.06, 0.07, stripe, 0, 0.39, 0.26));
  headPivot.add(box(0.28, 0.05, 0.06, stripe, 0, 0.39, 0.38));
  headPivot.add(box(0.11, 0.13, 0.08, stripe, -0.2, 0.4, 0.12));
  headPivot.add(box(0.11, 0.13, 0.08, stripe, 0.2, 0.4, 0.12));
  headPivot.add(box(0.06, 0.07, 0.04, white, -0.2, 0.41, 0.07));
  headPivot.add(box(0.06, 0.07, 0.04, white, 0.2, 0.41, 0.07));
  addEyes(headPivot, 0.26, 0.22, 0.42, 0.055);

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.22, -0.76);
  tailPivot.add(box(0.085, 0.085, 0.9, orange, 0, -0.08, -0.4));
  tailPivot.add(box(0.095, 0.095, 0.1, stripe, 0, -0.09, -0.35));
  tailPivot.add(box(0.095, 0.095, 0.1, stripe, 0, -0.1, -0.58));
  tailPivot.add(box(0.095, 0.095, 0.12, stripe, 0, -0.11, -0.82));
  body.add(tailPivot);

  const legs = [
    makeLeg(0.2, 0.72, 0.21, orange, -0.25, -0.08, 0.5, white),
    makeLeg(0.2, 0.72, 0.21, orange, 0.25, -0.08, 0.5, white),
    makeLeg(0.21, 0.72, 0.22, orange, -0.25, -0.08, -0.54, white),
    makeLeg(0.21, 0.72, 0.22, orange, 0.25, -0.08, -0.54, white),
  ];
  for (const l of legs) {
    l.add(box(0.22, 0.08, 0.23, stripe, 0, -0.25, 0));
    l.add(box(0.22, 0.07, 0.23, stripe, 0, -0.45, 0));
    body.add(l);
  }

  return { root, body, neckPivot, headPivot, legs, tailPivot };
}

function buildGiraffe(): AnimalRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.92;
  root.add(body);

  const cream = 0xebb965;
  const spot = 0x80461b;
  const hoof = 0x3b2a1d;

  const torso = box(0.84, 0.92, 1.56, cream, 0, 0.14, 0);
  torso.rotation.x = -0.12;
  body.add(torso);

  const spotCoords: [number, number, number][] = [
    [-0.43, 0.22, 0.35],
    [0.43, 0.16, 0.2],
    [-0.43, 0.08, -0.28],
    [0.43, 0.24, -0.34],
    [-0.43, 0.28, -0.02],
    [0.43, 0.26, -0.06],
    [0, 0.62, 0.12],
  ];
  for (const [sx, sy, sz] of spotCoords) {
    body.add(box(0.06, 0.26, 0.28, spot, sx, sy, sz));
  }

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.42, 0.62);
  body.add(neckPivot);

  neckPivot.add(box(0.32, 2.28, 0.36, cream, 0, 1.08, 0.12));
  neckPivot.add(box(0.35, 0.28, 0.28, spot, 0, 0.55, 0.14));
  neckPivot.add(box(0.35, 0.26, 0.26, spot, 0, 1.1, 0.14));
  neckPivot.add(box(0.35, 0.26, 0.26, spot, 0, 1.65, 0.14));
  neckPivot.add(box(0.08, 2.05, 0.1, spot, 0, 1.1, -0.08));

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 2.22, 0.15);
  neckPivot.add(headPivot);

  headPivot.add(box(0.3, 0.32, 0.66, cream, 0, 0.06, 0.22));
  headPivot.add(box(0.06, 0.25, 0.06, spot, -0.09, 0.3, 0.02));
  headPivot.add(box(0.06, 0.25, 0.06, spot, 0.09, 0.3, 0.02));
  headPivot.add(box(0.08, 0.06, 0.08, 0x3b2314, -0.09, 0.43, 0.02));
  headPivot.add(box(0.08, 0.06, 0.08, 0x3b2314, 0.09, 0.43, 0.02));
  headPivot.add(box(0.16, 0.08, 0.12, cream, -0.2, 0.18, 0.0));
  headPivot.add(box(0.16, 0.08, 0.12, cream, 0.2, 0.18, 0.0));
  addEyes(headPivot, 0.16, 0.12, 0.24, 0.05);

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.12, -0.78);
  tailPivot.add(box(0.07, 0.72, 0.07, cream, 0, -0.35, -0.04));
  tailPivot.add(box(0.11, 0.2, 0.11, spot, 0, -0.74, -0.05));
  body.add(tailPivot);

  const legs = [
    makeLeg(0.18, 1.88, 0.18, cream, -0.28, -0.08, 0.56, hoof),
    makeLeg(0.18, 1.88, 0.18, cream, 0.28, -0.08, 0.56, hoof),
    makeLeg(0.18, 1.72, 0.19, cream, -0.28, -0.2, -0.58, hoof),
    makeLeg(0.18, 1.72, 0.19, cream, 0.28, -0.2, -0.58, hoof),
  ];
  legs.forEach((l) => body.add(l));

  return { root, body, neckPivot, headPivot, legs, tailPivot };
}

function buildHippo(): AnimalRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.68;
  root.add(body);

  const skin = 0x6f616a;
  const belly = 0x99797e;

  body.add(box(1.34, 1.06, 2.08, skin, 0, 0.15, 0));
  body.add(box(1.4, 0.45, 0.65, skin, 0, 0.2, 0.45));
  body.add(box(1.18, 0.25, 1.82, belly, 0, -0.3, 0));

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.16, 0.95);
  body.add(neckPivot);

  const headPivot = new THREE.Group();
  neckPivot.add(headPivot);

  headPivot.add(box(0.95, 0.62, 0.78, skin, 0, 0.18, 0.34));
  headPivot.add(box(0.86, 0.34, 0.56, belly, 0, 0.08, 0.78));
  headPivot.add(box(0.14, 0.12, 0.14, skin, -0.22, 0.28, 0.92));
  headPivot.add(box(0.14, 0.12, 0.14, skin, 0.22, 0.28, 0.92));
  headPivot.add(box(0.14, 0.16, 0.1, belly, -0.32, 0.54, 0.22));
  headPivot.add(box(0.14, 0.16, 0.1, belly, 0.32, 0.54, 0.22));
  headPivot.add(box(0.16, 0.14, 0.16, skin, -0.35, 0.49, 0.48));
  headPivot.add(box(0.16, 0.14, 0.16, skin, 0.35, 0.49, 0.48));
  addEyes(headPivot, 0.42, 0.48, 0.52, 0.07);

  const jawPivot = new THREE.Group();
  jawPivot.position.set(0, -0.05, 0.44);
  jawPivot.add(box(0.76, 0.2, 0.64, belly, 0, -0.08, 0.28));
  jawPivot.add(box(0.08, 0.2, 0.08, 0xf6f0dc, -0.26, 0.06, 0.48));
  jawPivot.add(box(0.08, 0.2, 0.08, 0xf6f0dc, 0.26, 0.06, 0.48));
  headPivot.add(jawPivot);

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.2, -1.02);
  tailPivot.add(box(0.1, 0.32, 0.08, skin, 0, -0.15, -0.05));
  body.add(tailPivot);

  const legs = [
    makeLeg(0.32, 0.62, 0.32, skin, -0.42, -0.14, 0.64),
    makeLeg(0.32, 0.62, 0.32, skin, 0.42, -0.14, 0.64),
    makeLeg(0.32, 0.62, 0.32, skin, -0.42, -0.14, -0.66),
    makeLeg(0.32, 0.62, 0.32, skin, 0.42, -0.14, -0.66),
  ];
  legs.forEach((l) => body.add(l));

  return { root, body, neckPivot, headPivot, legs, tailPivot, jawPivot };
}

function buildZebra(): AnimalRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.88;
  root.add(body);

  const white = 0xf0eee8;
  const black = 0x1d1d20;

  body.add(box(0.58, 0.62, 1.32, white, 0, 0.08, 0));
  for (const z of [-0.45, -0.22, 0.02, 0.25, 0.46]) {
    body.add(box(0.6, 0.5, 0.075, black, 0, 0.14, z));
  }

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.26, 0.56);
  body.add(neckPivot);

  neckPivot.add(box(0.28, 0.56, 0.3, white, 0, 0.26, 0.06));
  neckPivot.add(box(0.3, 0.09, 0.31, black, 0, 0.24, 0.06));
  neckPivot.add(box(0.3, 0.09, 0.31, black, 0, 0.42, 0.06));
  neckPivot.add(box(0.08, 0.5, 0.1, black, 0, 0.3, -0.1));

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.54, 0.08);
  neckPivot.add(headPivot);

  headPivot.add(box(0.26, 0.26, 0.56, white, 0, 0.04, 0.2));
  headPivot.add(box(0.27, 0.22, 0.18, black, 0, 0.03, 0.42));
  headPivot.add(box(0.08, 0.14, 0.08, white, -0.09, 0.22, -0.02));
  headPivot.add(box(0.08, 0.14, 0.08, white, 0.09, 0.22, -0.02));
  addEyes(headPivot, 0.14, 0.08, 0.22, 0.045);

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.22, -0.66);
  tailPivot.add(box(0.07, 0.52, 0.07, black, 0, -0.26, -0.04));
  body.add(tailPivot);

  const legs = [
    makeLeg(0.14, 0.82, 0.15, white, -0.2, -0.08, 0.48, black),
    makeLeg(0.14, 0.82, 0.15, white, 0.2, -0.08, 0.48, black),
    makeLeg(0.15, 0.82, 0.16, white, -0.2, -0.08, -0.48, black),
    makeLeg(0.15, 0.82, 0.16, white, 0.2, -0.08, -0.48, black),
  ];
  legs.forEach((l) => body.add(l));

  return { root, body, neckPivot, headPivot, legs, tailPivot };
}

function buildAntelope(sex: Sex): AnimalRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.82;
  root.add(body);

  const tan = 0xc99252;
  const cream = 0xf4ead5;
  const horn = 0x3b2d23;

  body.add(box(0.44, 0.48, 1.12, tan, 0, 0.06, 0));
  body.add(box(0.38, 0.16, 0.92, cream, 0, -0.14, 0));
  body.add(box(0.36, 0.34, 0.12, cream, 0, 0.05, -0.54));

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.22, 0.46);
  body.add(neckPivot);
  neckPivot.add(box(0.2, 0.52, 0.22, tan, 0, 0.24, 0.05));

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.5, 0.06);
  neckPivot.add(headPivot);
  headPivot.add(box(0.21, 0.22, 0.46, tan, 0, 0.04, 0.16));
  addEyes(headPivot, 0.11, 0.08, 0.18, 0.04);

  if (sex === 'M') {
    for (const side of [-1, 1]) {
      const h = box(0.045, 0.44, 0.045, horn, side * 0.07, 0.32, 0.0);
      h.rotation.x = -0.35;
      h.rotation.z = side * -0.15;
      headPivot.add(h);
    }
  }

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.16, -0.56);
  tailPivot.add(box(0.06, 0.26, 0.06, cream, 0, -0.12, -0.04));
  body.add(tailPivot);

  const legs = [
    makeLeg(0.11, 0.78, 0.11, tan, -0.15, -0.06, 0.42, horn),
    makeLeg(0.11, 0.78, 0.11, tan, 0.15, -0.06, 0.42, horn),
    makeLeg(0.12, 0.78, 0.12, tan, -0.15, -0.06, -0.42, horn),
    makeLeg(0.12, 0.78, 0.12, tan, 0.15, -0.06, -0.42, horn),
  ];
  legs.forEach((l) => body.add(l));

  return { root, body, neckPivot, headPivot, legs, tailPivot };
}

function buildDeer(sex: Sex): AnimalRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.84;
  root.add(body);

  const russet = 0x9c5b34;
  const spot = 0xebd9be;
  const antlerCol = 0xd8cab2;

  body.add(box(0.46, 0.5, 1.14, russet, 0, 0.06, 0));
  body.add(box(0.38, 0.15, 0.9, spot, 0, -0.16, 0));
  body.add(box(0.49, 0.1, 0.1, spot, 0, 0.14, 0.16));
  body.add(box(0.49, 0.1, 0.1, spot, 0, 0.1, -0.2));

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.22, 0.48);
  body.add(neckPivot);
  neckPivot.add(box(0.21, 0.5, 0.23, russet, 0, 0.24, 0.04));

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.48, 0.06);
  neckPivot.add(headPivot);
  headPivot.add(box(0.22, 0.22, 0.46, russet, 0, 0.04, 0.16));
  headPivot.add(box(0.08, 0.15, 0.06, russet, -0.11, 0.16, 0.0));
  headPivot.add(box(0.08, 0.15, 0.06, russet, 0.11, 0.16, 0.0));
  addEyes(headPivot, 0.11, 0.08, 0.18, 0.04);

  let antlersObj: THREE.Object3D | undefined;
  if (sex === 'M') {
    const ant = new THREE.Group();
    for (const side of [-1, 1]) {
      const main = box(0.04, 0.44, 0.04, antlerCol, side * 0.08, 0.3, 0.02);
      main.rotation.z = side * -0.3;
      main.rotation.x = -0.18;
      const fork = box(0.035, 0.22, 0.035, antlerCol, side * 0.16, 0.38, 0.08);
      fork.rotation.z = side * 0.25;
      ant.add(main, fork);
    }
    headPivot.add(ant);
    antlersObj = ant;
  }

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.16, -0.56);
  tailPivot.add(box(0.07, 0.22, 0.07, spot, 0, -0.1, -0.04));
  body.add(tailPivot);

  const legs = [
    makeLeg(0.11, 0.78, 0.11, russet, -0.16, -0.06, 0.42, 0x3b2a1e),
    makeLeg(0.11, 0.78, 0.11, russet, 0.16, -0.06, 0.42, 0x3b2a1e),
    makeLeg(0.12, 0.78, 0.12, russet, -0.16, -0.06, -0.42, 0x3b2a1e),
    makeLeg(0.12, 0.78, 0.12, russet, 0.16, -0.06, -0.42, 0x3b2a1e),
  ];
  legs.forEach((l) => body.add(l));

  return { root, body, neckPivot, headPivot, legs, tailPivot, antlers: antlersObj };
}

function buildBoar(): AnimalRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.52;
  root.add(body);

  const dark = 0x45352c;
  const ridge = 0x2c201a;

  body.add(box(0.58, 0.56, 1.08, dark, 0, 0.08, 0));
  body.add(box(0.14, 0.16, 0.96, ridge, 0, 0.39, 0.04));

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.06, 0.5);
  body.add(neckPivot);

  const headPivot = new THREE.Group();
  neckPivot.add(headPivot);
  headPivot.add(box(0.42, 0.38, 0.46, dark, 0, 0.05, 0.18));
  headPivot.add(box(0.24, 0.18, 0.18, 0x70514a, 0, -0.04, 0.42));
  headPivot.add(box(0.05, 0.16, 0.05, 0xf4ecd6, -0.15, 0.04, 0.38));
  headPivot.add(box(0.05, 0.16, 0.05, 0xf4ecd6, 0.15, 0.04, 0.38));
  addEyes(headPivot, 0.21, 0.12, 0.24, 0.045);

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.16, -0.54);
  tailPivot.add(box(0.05, 0.2, 0.05, ridge, 0, -0.1, -0.04));
  body.add(tailPivot);

  const legs = [
    makeLeg(0.14, 0.44, 0.14, dark, -0.19, -0.1, 0.36),
    makeLeg(0.14, 0.44, 0.14, dark, 0.19, -0.1, 0.36),
    makeLeg(0.15, 0.44, 0.15, dark, -0.19, -0.1, -0.38),
    makeLeg(0.15, 0.44, 0.15, dark, 0.19, -0.1, -0.38),
  ];
  legs.forEach((l) => body.add(l));

  return { root, body, neckPivot, headPivot, legs, tailPivot };
}

function buildVulture(): AnimalRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.38;
  root.add(body);

  const feather = 0x2c2521;
  const primaryTip = 0x4b423b;
  const ruff = 0xdfd5c5;
  const neckCol = 0xa36459;

  body.add(box(0.36, 0.32, 0.66, feather, 0, 0, 0));
  body.add(box(0.34, 0.24, 0.26, ruff, 0, 0.09, 0.22));

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 0.13, 0.32);
  body.add(neckPivot);

  const headPivot = new THREE.Group();
  neckPivot.add(headPivot);
  headPivot.add(box(0.15, 0.18, 0.24, neckCol, 0, 0.12, 0.08));
  headPivot.add(box(0.08, 0.09, 0.2, 0xd8c382, 0, 0.1, 0.25));
  headPivot.add(box(0.06, 0.08, 0.07, 0x26211e, 0, 0.07, 0.35)); // Curved dark hook
  addEyes(headPivot, 0.08, 0.15, 0.14, 0.035);

  const wingL = new THREE.Group();
  wingL.position.set(-0.18, 0.12, 0.04);
  wingL.add(box(0.95, 0.06, 0.46, feather, -0.48, 0, -0.04));
  // Splayed primary flight feathers at wingtips
  for (let f = 0; f < 3; f++) {
    wingL.add(box(0.34, 0.04, 0.1, primaryTip, -1.04, 0, 0.08 - f * 0.14));
  }

  const wingR = new THREE.Group();
  wingR.position.set(0.18, 0.12, 0.04);
  wingR.add(box(0.95, 0.06, 0.46, feather, 0.48, 0, -0.04));
  for (let f = 0; f < 3; f++) {
    wingR.add(box(0.34, 0.04, 0.1, primaryTip, 1.04, 0, 0.08 - f * 0.14));
  }

  body.add(wingL, wingR);

  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0, -0.34);
  tailPivot.add(box(0.3, 0.06, 0.38, feather, 0, 0, -0.18));
  body.add(tailPivot);

  const legs = [
    makeLeg(0.06, 0.28, 0.06, 0x9b8667, -0.1, -0.1, 0.02),
    makeLeg(0.06, 0.28, 0.06, 0x9b8667, 0.1, -0.1, 0.02),
  ];
  legs.forEach((l) => body.add(l));

  return { root, body, neckPivot, headPivot, legs, tailPivot, wingL, wingR };
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function animateAnimalRig(
  animal: RenderAnimal,
  realDt: number,
  realTime: number,
  waterDepth: number
): void {
  const rig = animal.rig;

  const ageRatio = Math.min(1, animal.ageDays / (animal.maxAgeDays * 0.24));
  const stageScale = animal.stage === 'juvenile' ? 0.48 + ageRatio * 0.46 : 1.0;
  const sexScale =
    animal.sex === 'M' && (animal.species === 'lion' || animal.species === 'elephant') ? 1.07 : 1.0;
  rig.root.scale.setScalar(stageScale * sexScale);

  if (rig.mane) rig.mane.visible = animal.stage !== 'juvenile';
  if (rig.antlers) rig.antlers.visible = animal.stage !== 'juvenile';
  if (rig.tusks) {
    const showTusks = animal.ageDays > animal.maxAgeDays * 0.1;
    rig.tusks.forEach((t) => (t.visible = showTusks));
  }

  const isArrived = animal.speed < 0.55;
  const isResting = animal.state === 'resting' && isArrived;
  const isDrinking =
    (animal.state === 'drinking' || animal.state === 'grazing' || animal.state === 'feeding') &&
    isArrived;
  const isBrowsing = animal.state === 'browsing' && isArrived;
  const isStalking = animal.state === 'stalking';
  const isPerching = animal.state === 'perching';
  const isSwimming = animal.isSwimming || (animal.species === 'hippo' && waterDepth > 0.35);

  animal.restBlend = damp(animal.restBlend, isResting ? 1 : 0, 5, realDt);
  animal.drinkBlend = damp(animal.drinkBlend, isDrinking ? 1 : 0, 5, realDt);
  animal.browseBlend = damp(animal.browseBlend, isBrowsing ? 1 : 0, 5, realDt);
  animal.stalkBlend = damp(animal.stalkBlend, isStalking ? 1 : 0, 6, realDt);
  animal.swimBlend = damp(animal.swimBlend, isSwimming ? 1 : 0, 5, realDt);
  animal.perchBlend = damp(animal.perchBlend, isPerching ? 1 : 0, 6, realDt);

  const speed = animal.speed;
  animal.gaitPhase += realDt * (speed * 2.2 + 0.6);

  // Vulture flight vs perching vs scavenging vs bank drinking
  if (animal.species === 'vulture') {
    const onGround = animal.state === 'scavenging' || animal.state === 'drinking';
    const parked = onGround || isPerching;
    if (rig.wingL && rig.wingR) {
      if (!parked) {
        // Thermal soaring with smooth intermittent wingbeats and subtle dihedral bank
        const beatCycle = Math.sin(realTime * 0.75 + animal.id * 1.3);
        const flap = beatCycle > 0.45 ? Math.sin(realTime * 6.5 + animal.id) * 0.34 : 0.14;
        rig.wingL.rotation.z = flap;
        rig.wingR.rotation.z = -flap;
        rig.body.rotation.x = 0;
        rig.body.rotation.z = Math.sin(realTime * 0.55 + animal.id) * 0.16;
        rig.body.position.y = 0.4 + Math.sin(realTime * 1.8 + animal.id) * 0.09;
        rig.neckPivot.rotation.x = 0.15;
        rig.headPivot.rotation.y = Math.sin(realTime * 0.9 + animal.id) * 0.2;
        for (const l of rig.legs) l.rotation.x = -0.8;
      } else if (isPerching) {
        rig.wingL.rotation.z = 1.24;
        rig.wingR.rotation.z = -1.24;
        rig.body.rotation.x = -0.25;
        rig.body.rotation.z = 0;
        rig.body.position.y = 0.34 + Math.sin(realTime * 1.4 + animal.id) * 0.02;
        rig.neckPivot.rotation.x = 0.22;
        rig.headPivot.rotation.y = Math.sin(realTime * 1.1 + animal.id * 2) * 0.48;
        for (const l of rig.legs) l.rotation.x = 0.2;
      } else {
        rig.wingL.rotation.z = 1.15;
        rig.wingR.rotation.z = -1.15;
        rig.body.rotation.x = 0;
        rig.body.rotation.z = 0;
        rig.body.position.y = 0.3 + Math.abs(Math.sin(realTime * 6 + animal.id)) * 0.06;
        rig.neckPivot.rotation.x = 0.45 + Math.sin(realTime * 7 + animal.id) * 0.32;
        rig.headPivot.rotation.y = 0;
        for (const l of rig.legs) l.rotation.x = 0;
      }
    }
    return;
  }

  // Smooth terrain slope alignment for quadrupeds on dry land
  let targetPitch = 0;
  let targetRoll = 0;
  if (!isSwimming && waterDepth < 0.25) {
    const n = getTerrainSlopeNormal(animal.pos.x, animal.pos.z);
    const fx = Math.sin(animal.yaw);
    const fz = Math.cos(animal.yaw);
    const rx = Math.cos(animal.yaw);
    const rz = -Math.sin(animal.yaw);
    // Project surface slope onto body pitch & roll (clamped for stable posture)
    const forwardSlope = fx * n.nx + fz * n.nz;
    const rightSlope = rx * n.nx + rz * n.nz;
    targetPitch = Math.max(-0.28, Math.min(0.28, -forwardSlope * 0.72));
    targetRoll = Math.max(-0.22, Math.min(0.22, rightSlope * 0.55));
  }
  animal.slopePitch = damp(animal.slopePitch, targetPitch, 6, realDt);
  animal.slopeRoll = damp(animal.slopeRoll, targetRoll, 6, realDt);

  const baseBodyY = getBaseBodyY(animal.species);
  const restDrop = baseBodyY * 0.52 * animal.restBlend;
  const stalkDrop = baseBodyY * 0.24 * animal.stalkBlend;
  const submerge =
    animal.species === 'hippo'
      ? Math.min(0.75, waterDepth * 0.68) * animal.swimBlend
      : Math.min(0.45, waterDepth * 0.42) * animal.swimBlend;

  const strideAmp = Math.min(0.68, speed * 0.12) * (1 - animal.restBlend);
  const bounce =
    speed > 0.25 && !isResting
      ? Math.abs(Math.sin(animal.gaitPhase)) * Math.min(0.14, speed * 0.022)
      : Math.sin(realTime * 1.5 + animal.id) * 0.018;

  rig.body.position.y = baseBodyY - restDrop - stalkDrop - submerge + bounce;
  rig.body.rotation.x =
    animal.slopePitch +
    (animal.state === 'chasing' ? -0.06 : 0) +
    (animal.state === 'cooling' && animal.species === 'hippo' ? 0.04 : 0);
  rig.body.rotation.z = animal.slopeRoll;

  if (rig.legs.length === 4) {
    const fl = Math.sin(animal.gaitPhase) * strideAmp;
    const fr = Math.sin(animal.gaitPhase + (speed > 5 ? 0.6 : Math.PI)) * strideAmp;
    const bl = Math.sin(animal.gaitPhase + Math.PI) * strideAmp;
    const br = Math.sin(animal.gaitPhase + (speed > 5 ? Math.PI + 0.6 : 0)) * strideAmp;

    const restFold = animal.restBlend * 1.1;
    const giraffeSplay = animal.species === 'giraffe' ? animal.drinkBlend * 0.35 : 0;

    rig.legs[0].rotation.x = fl - restFold * 0.85;
    rig.legs[1].rotation.x = fr - restFold * 0.85;
    rig.legs[2].rotation.x = bl + restFold * 0.85;
    rig.legs[3].rotation.x = br + restFold * 0.85;

    rig.legs[0].rotation.z = giraffeSplay;
    rig.legs[1].rotation.z = -giraffeSplay;
  }

  if (rig.tailPivot) {
    rig.tailPivot.rotation.z = Math.sin(realTime * 3.1 + animal.id) * 0.22;
    rig.tailPivot.rotation.x = animal.state === 'chasing' ? 0.25 : 0;
  }

  if (animal.species === 'giraffe') {
    const idleSway = Math.sin(realTime * 1.2 + animal.id) * 0.05;
    rig.neckPivot.rotation.x =
      0.1 + animal.drinkBlend * 1.38 - animal.browseBlend * 0.26 + animal.restBlend * 0.32 + idleSway;
    rig.headPivot.rotation.x = -animal.drinkBlend * 0.55 + animal.browseBlend * 0.25;
  } else {
    const chewBob = animal.drinkBlend > 0.35 ? Math.sin(realTime * 5.5 + animal.id) * 0.12 : 0;
    rig.neckPivot.rotation.x =
      animal.drinkBlend * 0.68 +
      animal.stalkBlend * 0.28 +
      animal.restBlend * 0.22 +
      chewBob;
    rig.headPivot.rotation.x = -animal.drinkBlend * 0.15 + Math.sin(realTime * 1.4 + animal.id) * 0.04;
    rig.headPivot.rotation.y =
      animal.state === 'wandering' || animal.state === 'resting'
        ? Math.sin(realTime * 0.8 + animal.id * 2) * 0.14
        : 0;
  }

  if (animal.species === 'elephant') {
    const alertFlare = animal.state === 'defending' ? 0.72 : 0.18;
    const earFlap = alertFlare + Math.sin(realTime * 2.5 + animal.id) * 0.14;
    if (rig.earL) rig.earL.rotation.y = -earFlap;
    if (rig.earR) rig.earR.rotation.y = earFlap;

    const trunkRaise =
      animal.state === 'defending'
        ? -1.35
        : animal.browseBlend * -0.95 + animal.drinkBlend * 0.38;
    const trunkWave = Math.sin(realTime * 2.3 + animal.id) * 0.18;
    if (rig.trunk1) rig.trunk1.rotation.x = trunkRaise + trunkWave;
    if (rig.trunk2) rig.trunk2.rotation.x = trunkWave * 1.3 - animal.browseBlend * 0.25;
    if (rig.trunk3) rig.trunk3.rotation.x = -0.35 + trunkWave * 1.6;
  }

  if (animal.species === 'hippo' && rig.jawPivot) {
    const targetJaw = animal.isYawning || animal.state === 'defending' ? 0.78 : 0.03;
    rig.jawPivot.rotation.x = damp(rig.jawPivot.rotation.x, targetJaw, 7, realDt);
  }
}

function getBaseBodyY(species: SpeciesId): number {
  switch (species) {
    case 'elephant':
      return 1.45;
    case 'giraffe':
      return 1.92;
    case 'zebra':
      return 0.88;
    case 'antelope':
      return 0.82;
    case 'deer':
      return 0.84;
    case 'lion':
    case 'tiger':
      return 0.78;
    case 'hippo':
      return 0.68;
    case 'boar':
      return 0.52;
    case 'vulture':
      return 0.38;
  }
}
