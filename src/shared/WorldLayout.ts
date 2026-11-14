import type { LogProp, RockProp, TreeNode, Vec3, WorldCollider } from './types.js';
import {
  WATERING_HOLES,
  getFordFactor,
  getRiverCenterX,
  getRiverHalfWidth,
  getTerrainHeight,
  getTrailFactor,
} from './TerrainMath.js';

export interface WorldLayout {
  trees: TreeNode[];
  rocks: RockProp[];
  logs: LogProp[];
  kopjes: Vec3[];
  colliders: WorldCollider[];
}

export function generateWorldLayout(): WorldLayout {
  const trees: TreeNode[] = [];
  const rocks: RockProp[] = [];
  const logs: LogProp[] = [];
  const colliders: WorldCollider[] = [];

  const kopjes: Vec3[] = [
    { x: -48, y: getTerrainHeight(-48, -8), z: -8 },
    { x: -82, y: getTerrainHeight(-82, -55), z: -55 },
    { x: -36, y: getTerrainHeight(-36, 75), z: 75 },
  ];

  // Deterministic RNG so server and every client have identical colliders & trees
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // 1. Kopje rock clusters + riverbank stones
  for (const k of kopjes) {
    const count = 10;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + i * 0.7;
      const dist = i === 0 ? 0 : 1.7 + (i % 4) * 1.45;
      const rx = k.x + Math.cos(ang) * dist;
      const rz = k.z + Math.sin(ang) * dist;
      const ry = getTerrainHeight(rx, rz);
      const sx = i === 0 ? 3.8 : 1.3 + ((i * 37) % 10) * 0.22;
      const sy = i === 0 ? 2.5 : 0.9 + ((i * 19) % 10) * 0.16;
      const sz = i === 0 ? 3.3 : 1.2 + ((i * 53) % 10) * 0.22;
      const radius = Math.max(sx, sz) * 0.85;

      rocks.push({
        x: rx,
        y: ry + sy * 0.34,
        z: rz,
        sx,
        sy,
        sz,
        rotX: (i % 3) * 0.25,
        rotY: ang,
        rotZ: (i % 2) * 0.2,
        radius,
      });
      colliders.push({ x: rx, z: rz, radius, kind: 'rock' });
    }
  }

  // Scattered savanna & jungle boulders + riverbank rocks
  for (let i = 0; i < 34; i++) {
    const z = -95 + i * 5.8;
    const cx = getRiverCenterX(z);
    const hw = getRiverHalfWidth(z);
    const side = i % 2 === 0 ? -1 : 1;
    const rx = cx + side * (hw + 0.8 + (i % 3) * 1.25);
    const ry = getTerrainHeight(rx, z);
    const s = 0.55 + (i % 4) * 0.25;
    const sx = s * 1.35;
    const sz = s * 1.05;
    rocks.push({
      x: rx,
      y: ry + s * 0.25,
      z,
      sx,
      sy: s * 0.75,
      sz,
      rotX: 0.1 * (i % 3),
      rotY: i * 1.1,
      rotZ: 0,
      radius: sx * 0.78,
    });
    colliders.push({ x: rx, z, radius: sx * 0.78, kind: 'rock' });
  }

  const isNearWaterhole = (x: number, z: number) =>
    WATERING_HOLES.some((h) => Math.hypot(x - h.x, z - h.z) < h.radius + 3.2);
  const isNearKopje = (x: number, z: number) =>
    kopjes.some((k) => Math.hypot(x - k.x, z - k.z) < 9.5);
  const isNearCollider = (x: number, z: number, pad: number) =>
    colliders.some((c) => Math.hypot(c.x - x, c.z - z) < c.radius + pad);

  // 2. Iconic Baobabs on Savanna (8 ancient trees)
  let baobabCount = 0;
  let attempts = 0;
  while (baobabCount < 8 && attempts < 250) {
    attempts++;
    const x = -102 + rand() * 84;
    const z = -98 + rand() * 196;
    const cx = getRiverCenterX(z);
    const hw = getRiverHalfWidth(z);
    if (x > cx - hw - 10) continue;
    if (isNearWaterhole(x, z) || isNearKopje(x, z) || getTrailFactor(x, z) > 0.35) continue;
    const y = getTerrainHeight(x, z);
    if (y < 0.6) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 16)) continue;

    const scale = 0.95 + rand() * 0.38;
    const trunkRadius = 1.45 * scale;
    trees.push({
      x,
      z,
      y,
      kind: 'baobab',
      scale,
      rotY: rand() * Math.PI * 2,
      canopyHeight: 7.4 * scale,
      shadeRadius: 6.4 * scale,
      trunkRadius,
      foliage: 1,
    });
    colliders.push({ x, z, radius: trunkRadius, kind: 'tree' });
    baobabCount++;
  }

  // 3. Dead Snag Trees (8 trees near savanna & riverbank — vulture perches!)
  let snagCount = 0;
  attempts = 0;
  while (snagCount < 8 && attempts < 250) {
    attempts++;
    const z = -95 + rand() * 190;
    const cx = getRiverCenterX(z);
    const hw = getRiverHalfWidth(z);
    const x = cx - hw - 6 - rand() * 58;
    if (isNearWaterhole(x, z) || isNearKopje(x, z)) continue;
    const y = getTerrainHeight(x, z);
    if (y < 0.5) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 11)) continue;

    const scale = 0.9 + rand() * 0.35;
    const trunkRadius = 0.52 * scale;
    trees.push({
      x,
      z,
      y,
      kind: 'snag',
      scale,
      rotY: rand() * Math.PI * 2,
      canopyHeight: 5.5 * scale,
      shadeRadius: 2.2,
      trunkRadius,
      foliage: 0,
    });
    colliders.push({ x, z, radius: trunkRadius, kind: 'tree' });
    snagCount++;
  }

  // 4. Savanna Umbrella Acacias (48 trees)
  let acaciaCount = 0;
  attempts = 0;
  while (acaciaCount < 48 && attempts < 550) {
    attempts++;
    const x = -106 + rand() * 94;
    const z = -104 + rand() * 208;
    const cx = getRiverCenterX(z);
    const hw = getRiverHalfWidth(z);
    if (x > cx - hw - 4.5) continue;
    if (isNearWaterhole(x, z) || isNearKopje(x, z) || getTrailFactor(x, z) > 0.45) continue;
    const y = getTerrainHeight(x, z);
    if (y < 0.38) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 9.5)) continue;

    const scale = 0.85 + rand() * 0.55;
    const trunkRadius = 0.62 * scale;
    trees.push({
      x,
      z,
      y,
      kind: 'acacia',
      scale,
      rotY: rand() * Math.PI * 2,
      canopyHeight: 5.5 * scale,
      shadeRadius: 5.2 * scale,
      trunkRadius,
      foliage: 1,
    });
    colliders.push({ x, z, radius: trunkRadius, kind: 'tree' });
    acaciaCount++;
  }

  // 5. Jungle Broadleaf & Palm Trees (92 trees on x > river)
  let jungleCount = 0;
  attempts = 0;
  while (jungleCount < 92 && attempts < 750) {
    attempts++;
    const x = -5 + rand() * 112;
    const z = -105 + rand() * 210;
    const cx = getRiverCenterX(z);
    const hw = getRiverHalfWidth(z);
    if (x < cx + hw + 3.5) continue;
    if (getTrailFactor(x, z) > 0.45) continue;
    const y = getTerrainHeight(x, z);
    if (y < 0.3) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 6.4)) continue;

    const scale = 0.85 + rand() * 0.65;
    const isPalm = rand() < 0.3 || x < cx + hw + 14;
    const trunkRadius = (isPalm ? 0.45 : 0.68) * scale;
    trees.push({
      x,
      z,
      y,
      kind: isPalm ? 'palm' : 'jungle',
      scale,
      rotY: rand() * Math.PI * 2,
      canopyHeight: 5.8 * scale,
      shadeRadius: 4.5 * scale,
      trunkRadius,
      foliage: 1,
    });
    colliders.push({ x, z, radius: trunkRadius, kind: 'tree' });
    jungleCount++;
  }

  // 6. Bushes & Shrubs (90 shrubs with soft colliders)
  for (let i = 0; i < 90; i++) {
    const inJungle = i < 62;
    const z = -104 + rand() * 208;
    const cx = getRiverCenterX(z);
    const hw = getRiverHalfWidth(z);
    const x = inJungle ? cx + hw + 2.5 + rand() * 86 : -102 + rand() * (95 + cx);
    if (!inJungle && x > cx - hw - 3.5) continue;
    if (isNearWaterhole(x, z) || getTrailFactor(x, z) > 0.45 || isNearCollider(x, z, 1.5)) continue;
    const y = getTerrainHeight(x, z);
    if (y < 0.2) continue;

    const scale = 0.75 + rand() * 0.55;
    trees.push({
      x,
      z,
      y,
      kind: 'bush',
      scale,
      rotY: rand() * Math.PI * 2,
      canopyHeight: 1.5 * scale,
      shadeRadius: 2.2 * scale,
      trunkRadius: 0.95 * scale,
      foliage: 1,
    });
    colliders.push({ x, z, radius: 0.9 * scale, kind: 'bush' });
  }

  // 7. Fallen Driftwood Logs along riverbanks & jungle floor
  for (let i = 0; i < 14; i++) {
    const z = -92 + rand() * 184;
    const cx = getRiverCenterX(z);
    const hw = getRiverHalfWidth(z);
    if (getFordFactor(cx, z) > 0.35) continue;
    const side = rand() < 0.65 ? 1 : -1;
    const x = cx + side * (hw + 1.5 + rand() * 18);
    if (isNearCollider(x, z, 2.2)) continue;
    const y = getTerrainHeight(x, z);
    if (y < 0.15) continue;

    const length = 2.6 + rand() * 2.2;
    const radius = 0.28 + rand() * 0.14;
    logs.push({
      x,
      y: y + radius * 0.6,
      z,
      length,
      radius,
      rotY: rand() * Math.PI,
    });
    colliders.push({ x, z, radius: length * 0.35, kind: 'log' });
  }

  return { trees, rocks, logs, kopjes, colliders };
}
