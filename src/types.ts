import type * as THREE from 'three';

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
  | 'scavenging';

export type LifeStage = 'juvenile' | 'adult' | 'elder';
export type Sex = 'M' | 'F';
export type DietType = 'grazer' | 'browser' | 'carnivore' | 'scavenger' | 'omnivore';

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
  maxWaterDepth: number; // Depth above which animal must swim or avoid
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

export interface AnimalRig {
  root: THREE.Group;
  body: THREE.Group;
  neckPivot: THREE.Group;
  headPivot: THREE.Group;
  legs: THREE.Group[]; // [FL, FR, BL, BR] or empty for birds
  tailPivot?: THREE.Group;
  earL?: THREE.Group;
  earR?: THREE.Group;
  trunk1?: THREE.Group;
  trunk2?: THREE.Group;
  trunk3?: THREE.Group;
  jawPivot?: THREE.Group;
  wingL?: THREE.Group;
  wingR?: THREE.Group;
  mane?: THREE.Object3D;
  tusks?: THREE.Object3D[];
  antlers?: THREE.Object3D;
}

export interface Animal {
  id: number;
  species: SpeciesId;
  name: string;
  sex: Sex;
  ageDays: number;
  maxAgeDays: number;
  stage: LifeStage;
  groupId: number;
  motherId: number | null;

  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  speed: number;
  isSwimming: boolean;

  hunger: number; // 0..100 (100 = full)
  thirst: number; // 0..100 (100 = hydrated)
  energy: number; // 0..100 (100 = rested)
  health: number; // 0..100

  state: AnimalState;
  statusText: string;
  stateTimer: number;
  decisionCooldown: number;
  reproCooldown: number;
  attackCooldown: number;
  callCooldown: number;
  yawnTimer: number;

  targetPos: THREE.Vector3 | null;
  targetAnimalId: number | null;
  targetCarcassId: number | null;
  targetTreeIdx: number | null;
  threatAnimalId: number | null;
  homeCenter: THREE.Vector3;

  // Animation blend helpers
  gaitPhase: number;
  restBlend: number;
  drinkBlend: number;
  browseBlend: number;
  stalkBlend: number;
  swimBlend: number;
  soarHeight: number;
  soarAngle: number;

  rig: AnimalRig;
  alive: boolean;
}

export interface Carcass {
  id: number;
  species: SpeciesId;
  pos: THREE.Vector3;
  meatRemaining: number;
  maxMeat: number;
  ageSeconds: number;
  mesh: THREE.Group;
}

export interface TreeNode {
  x: number;
  z: number;
  y: number;
  kind: 'acacia' | 'jungle' | 'palm' | 'bush';
  canopyHeight: number;
  shadeRadius: number;
  foliage: number; // 0..1 available food for giraffes/elephants
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
  pos: THREE.Vector3;
  importance: number; // 1..3
  createdAtReal: number;
}

export interface TimeState {
  day: number;
  timeOfDay: number; // 0..1 (0 = midnight, 0.25 = 06:00, 0.5 = 12:00, 0.75 = 18:00)
  hour: number;
  minute: number;
  phaseNameRu: string;
  temperature: number; // 0..1 heat index
}

export interface SeasonState {
  progress: number; // 0..1 across full wet-dry cycle
  wetness: number; // 0 = peak drought, 1 = peak wet season
  isDrySeason: boolean;
  isRaining: boolean;
  rainIntensity: number; // 0..1
  seasonNameRu: string;
  weatherTextRu: string;
}
