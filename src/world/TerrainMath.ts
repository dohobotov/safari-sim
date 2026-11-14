import type { BiomeId, SpeciesId, WateringHole } from '../types';

export const WORLD_HALF = 115;
export const TERRAIN_SIZE = 260;

export interface FordZone {
  z: number;
  halfLength: number;
  name: string;
}

export const FORDS: FordZone[] = [
  { z: -56, halfLength: 10, name: 'Северный брод' },
  { z: 8, halfLength: 11, name: 'Центральный брод' },
  { z: 66, halfLength: 10, name: 'Южный брод' },
];

export const WATERING_HOLES: WateringHole[] = [
  { x: -64, z: -46, radius: 11.5, name: 'Северный водопой' },
  { x: -74, z: 22, radius: 13.0, name: 'Оазис акаций' },
  { x: -50, z: 72, radius: 10.5, name: 'Южная низина' },
];

function hash2D(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

export function valueNoise2D(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash2D(ix, iz);
  const b = hash2D(ix + 1, iz);
  const c = hash2D(ix, iz + 1);
  const d = hash2D(ix + 1, iz + 1);

  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm2D(x: number, z: number, octaves = 4): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += amp * valueNoise2D(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return value / norm;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Analytical meandering centerline of the great river separating Savanna (x < 0) and Jungle (x > 0). */
export function getRiverCenterX(z: number): number {
  return Math.sin(z * 0.032) * 14 + Math.cos(z * 0.015 + 0.8) * 6;
}

/** Half-width of the river channel; narrows slightly at shallow fords and widens into hippo lagoons between them. */
export function getRiverHalfWidth(z: number): number {
  let width = 14.5 + Math.sin(z * 0.055 + 1.2) * 3.2;
  // Widen lagoons where hippos congregate
  const lagoon1 = Math.exp(-Math.pow((z + 24) / 14, 2)) * 5.2;
  const lagoon2 = Math.exp(-Math.pow((z - 38) / 14, 2)) * 5.5;
  width += lagoon1 + lagoon2;

  // Slightly pinch channel at fords
  for (const ford of FORDS) {
    const f = Math.exp(-Math.pow((z - ford.z) / ford.halfLength, 2));
    width -= f * 2.2;
  }
  return width;
}

/** Returns 0..1 indicating how close (x, z) is to a shallow river ford. */
export function getFordFactor(x: number, z: number): number {
  const cx = getRiverCenterX(z);
  const hw = getRiverHalfWidth(z);
  if (Math.abs(x - cx) > hw + 4) return 0;

  let best = 0;
  for (const ford of FORDS) {
    const fz = Math.exp(-Math.pow((z - ford.z) / (ford.halfLength * 0.72), 2));
    if (fz > best) best = fz;
  }
  return best;
}

/** Seasonal global water surface height (-0.42 peak drought to +0.28 wet season). */
export function getWaterLevel(wetness: number): number {
  return -0.42 + wetness * 0.7;
}

/** Continuous terrain height at any world coordinate. */
export function getTerrainHeight(x: number, z: number): number {
  const n1 = fbm2D(x * 0.018 + 11.3, z * 0.018 - 4.7, 4);
  const n2 = fbm2D(x * 0.055 - 3.1, z * 0.055 + 8.9, 3);

  const cx = getRiverCenterX(z);
  const dx = x - cx;
  const hw = getRiverHalfWidth(z);

  // Base undulating elevation: slightly higher rolling hills further from river
  const bankDist = Math.max(0, Math.abs(dx) - hw);
  let h = 0.75 + smoothstep(0, 32, bankDist) * 1.45;
  h += (n1 - 0.48) * 3.4 + (n2 - 0.5) * 0.85;

  // Jungle side (x > cx) slightly more undulating & elevated deep inside
  if (dx > hw) {
    h += smoothstep(hw, hw + 55, dx) * 1.65;
  }

  // Savanna rocky kopje rises
  const kopje1 = Math.exp(-((x + 48) ** 2 + (z + 8) ** 2) / 145) * 3.4;
  const kopje2 = Math.exp(-((x + 82) ** 2 + (z - 55) ** 2) / 190) * 3.9;
  const kopje3 = Math.exp(-((x + 36) ** 2 + (z + 75) ** 2) / 130) * 2.7;
  h += kopje1 + kopje2 + kopje3;

  // Carve river channel smoothly
  const riverT = 1 - smoothstep(hw * 0.45, hw * 1.32, Math.abs(dx));
  if (riverT > 0.001) {
    const ford = getFordFactor(x, z);
    // Deep river bed ~ -2.35, ford bed ~ -0.58
    const bedDepth = -2.35 + ford * 1.77 + (n2 - 0.5) * 0.25;
    h = h * (1 - riverT) + bedDepth * riverT;
  }

  // Carve savanna watering hole depressions
  for (const hole of WATERING_HOLES) {
    const dist = Math.hypot(x - hole.x, z - hole.z);
    if (dist < hole.radius * 1.45) {
      const t = 1 - smoothstep(hole.radius * 0.3, hole.radius * 1.45, dist);
      const basinDepth = -0.78 + (n2 - 0.5) * 0.14;
      h = h * (1 - t) + basinDepth * t;
    }
  }

  // Natural valley rim gently rising beyond WORLD_HALF
  const edgeDist = Math.max(Math.abs(x), Math.abs(z));
  if (edgeDist > WORLD_HALF - 4) {
    const rim = smoothstep(WORLD_HALF - 4, TERRAIN_SIZE * 0.5, edgeDist);
    h += rim * 12.5;
  }

  return h;
}

/** Positive water depth at (x, z), or 0 on dry land. */
export function getWaterDepth(x: number, z: number, wetness: number): number {
  const cx = getRiverCenterX(z);
  const hw = getRiverHalfWidth(z);
  const inRiverZone = Math.abs(x - cx) < hw * 1.35;

  let inHoleZone = false;
  if (!inRiverZone && x < cx) {
    for (const hole of WATERING_HOLES) {
      if (Math.hypot(x - hole.x, z - hole.z) < hole.radius * 1.4) {
        inHoleZone = true;
        break;
      }
    }
  }

  if (!inRiverZone && !inHoleZone) return 0;
  const depth = getWaterLevel(wetness) - getTerrainHeight(x, z);
  return depth > 0.02 ? depth : 0;
}

export function getBiome(x: number, z: number, wetness: number): BiomeId {
  const cx = getRiverCenterX(z);
  const hw = getRiverHalfWidth(z);
  const depth = getWaterDepth(x, z, wetness);

  if (Math.abs(x - cx) < hw * 1.18) {
    if (getFordFactor(x, z) > 0.48) return 'ford';
    if (depth > 0.06) return 'river';
  }

  for (const hole of WATERING_HOLES) {
    if (Math.hypot(x - hole.x, z - hole.z) < hole.radius * 1.15 && depth > 0.03) {
      return 'waterhole';
    }
  }

  return x < cx ? 'savanna' : 'jungle';
}

export function getBiomeNameRu(biome: BiomeId): string {
  switch (biome) {
    case 'savanna':
      return 'Саванна';
    case 'jungle':
      return 'Джунгли';
    case 'river':
      return 'Река';
    case 'ford':
      return 'Мелководный брод';
    case 'waterhole':
      return 'Водопой';
  }
}

export function isWaterSafeFor(
  species: SpeciesId,
  x: number,
  z: number,
  wetness: number,
  maxDepth: number
): boolean {
  if (species === 'vulture') return true;
  const depth = getWaterDepth(x, z, wetness);
  return depth <= maxDepth;
}

export function findNearestFordPoint(z: number): { x: number; z: number } {
  let bestFord = FORDS[0];
  let bestDist = Infinity;
  for (const ford of FORDS) {
    const d = Math.abs(z - ford.z);
    if (d < bestDist) {
      bestDist = d;
      bestFord = ford;
    }
  }
  return { x: getRiverCenterX(bestFord.z), z: bestFord.z };
}

export function getGrassDensity(x: number, z: number, wetness: number): number {
  const h = getTerrainHeight(x, z);
  if (h < getWaterLevel(wetness) + 0.08) return 0;
  const n = fbm2D(x * 0.045 + 3.7, z * 0.045 - 2.1, 3);
  const cx = getRiverCenterX(z);
  const riverMoisture = Math.exp(-Math.pow((Math.abs(x - cx) - getRiverHalfWidth(z)) / 24, 2)) * 0.35;
  return Math.max(0.05, Math.min(1, n * (0.55 + wetness * 0.45) + riverMoisture));
}
