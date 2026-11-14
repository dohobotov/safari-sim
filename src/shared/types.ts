export type SpeciesId =
  | 'elephant'
  | 'lion'
  | 'tiger'
  | 'giraffe'
  | 'hippo'
  | 'zebra'
  | 'antelope'
  | 'deer'
  | 'boar'
  | 'vulture';

export type BiomeId = 'savanna' | 'river' | 'ford' | 'jungle' | 'waterhole';

export type AnimalState =
  | 'wandering'
  | 'grazing'
  | 'browsing'
  | 'seeking_water'
  | 'drinking'
  | 'cooling'
  | 'resting'
  | 'stalking'
  | 'chasing'
  | 'feeding'
  | 'fleeing'
  | 'defending'
  | 'following'
  | 'crossing'
  | 'courting'
  | 'soaring'
  | 'scavenging'
  | 'perching';

export type LifeStage = 'juvenile' | 'adult' | 'elder';
export type Sex = 'M' | 'F';
export type DietType = 'grazer' | 'browser' | 'carnivore' | 'scavenger' | 'omnivore';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SpeciesConfig {
  id: SpeciesId;
  nameRu: string;
  pluralRu: string;
  emoji: string;
  diet: DietType;
  isMainFive: boolean;
  homeBiome: 'savanna' | 'jungle' | 'river';
  walkSpeed: number;
  runSpeed: number;
  swimSpeed: number;
  maxWaterDepth: number;
  avoidsDeepWater: boolean;
  adultRadius: number;
  adultHeight: number;
  lifespanDays: number;
  maturityAgeRatio: number;
  visionRange: number;
  minCap: number;
  targetCount: number;
  maxCap: number;
  nocturnal: boolean;
  crepuscular: boolean;
  bioRu: string;
}

export interface TreeNode {
  x: number;
  z: number;
  y: number;
  kind: 'acacia' | 'baobab' | 'snag' | 'jungle' | 'palm' | 'bush';
  scale: number;
  rotY: number;
  canopyHeight: number;
  shadeRadius: number;
  trunkRadius: number;
  foliage: number;
}

export interface RockProp {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  radius: number;
}

export interface LogProp {
  x: number;
  y: number;
  z: number;
  length: number;
  radius: number;
  rotY: number;
}

export interface WorldCollider {
  x: number;
  z: number;
  radius: number;
  kind: 'tree' | 'rock' | 'bush' | 'log';
}

export interface WateringHole {
  x: number;
  z: number;
  radius: number;
  name: string;
}

export interface WorldEvent {
  id: number;
  text: string;
  icon: string;
  x: number;
  y: number;
  z: number;
  importance: number;
  createdAtMs: number;
}

export interface TimeState {
  day: number;
  timeOfDay: number;
  hour: number;
  minute: number;
  phaseNameRu: string;
  temperature: number;
}

export interface SeasonState {
  progress: number;
  wetness: number;
  isDrySeason: boolean;
  isRaining: boolean;
  rainIntensity: number;
  seasonNameRu: string;
  weatherTextRu: string;
}

export interface SimAnimal {
  id: number;
  species: SpeciesId;
  name: string;
  sex: Sex;
  ageDays: number;
  maxAgeDays: number;
  stage: LifeStage;
  groupId: number;
  motherId: number | null;

  pos: Vec3;
  yaw: number;
  speed: number;
  isSwimming: boolean;

  hunger: number;
  thirst: number;
  energy: number;
  health: number;

  state: AnimalState;
  statusText: string;
  stateTimer: number;
  decisionCooldown: number;
  reproCooldown: number;
  attackCooldown: number;
  callCooldown: number;
  yawnTimer: number;

  targetPos: Vec3 | null;
  targetAnimalId: number | null;
  targetCarcassId: number | null;
  targetTreeIdx: number | null;
  threatAnimalId: number | null;
  homeCenter: Vec3;

  soarHeight: number;
  soarAngle: number;
  alive: boolean;
}

export interface SimCarcass {
  id: number;
  species: SpeciesId;
  pos: Vec3;
  yaw: number;
  isJuvenile: boolean;
  meatRemaining: number;
  maxMeat: number;
  ageSeconds: number;
}

// --- Network Protocol Types ---

export interface AnimalMeta {
  id: number;
  species: SpeciesId;
  name: string;
  sex: Sex;
  groupId: number;
  maxAgeDays: number;
  statusText: string;
}

// Compact tuple:
// [id, x, y, z, yaw, speed, stateIdx, hunger, thirst, energy, health, ageDays, stageIdx, flags]
// flags bit0 = isSwimming, bit1 = isYawning
export type AnimalTuple = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

// [id, speciesIdx, x, y, z, yaw, meatRatio, isJuvenile(0|1)]
export type CarcassTuple = [number, number, number, number, number, number, number, number];

export interface ServerWelcomeMsg {
  type: 'welcome';
  t: TimeState;
  s: SeasonState;
  v: number;
  meta: AnimalMeta[];
  a: AnimalTuple[];
  c: CarcassTuple[];
  events: WorldEvent[];
}

export interface ServerTickMsg {
  type: 'tick';
  t: TimeState;
  s: SeasonState;
  v: number;
  a: AnimalTuple[];
  c: CarcassTuple[];
  added?: AnimalMeta[];
  removed?: number[];
  statuses?: [number, string][];
  events?: WorldEvent[];
}

export type ServerMessage = ServerWelcomeMsg | ServerTickMsg;
