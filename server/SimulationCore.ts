import {
  SPECIES_CONFIGS,
  SPECIES_ORDER,
  STAGE_ORDER,
  STATE_ORDER,
  getSpeciesTitleRu,
  pickAnimalName,
} from '../src/shared/SpeciesData.js';
import {
  FORDS,
  WATERING_HOLES,
  WORLD_HALF,
  findNearestFordPoint,
  getGrassDensity,
  getRiverCenterX,
  getRiverHalfWidth,
  getTerrainHeight,
  getWaterDepth,
  getWaterLevel,
} from '../src/shared/TerrainMath.js';
import { generateWorldLayout } from '../src/shared/WorldLayout.js';
import type {
  AnimalMeta,
  AnimalTuple,
  CarcassTuple,
  SeasonState,
  ServerTickMsg,
  ServerWelcomeMsg,
  Sex,
  SimAnimal,
  SimCarcass,
  SpeciesId,
  TimeState,
  TreeNode,
  Vec3,
  WorldEvent,
} from '../src/shared/types.js';
import { SpatialHash, StaticColliderGrid } from './SpatialHash.js';

const DAY_REAL_SECONDS = 180;
const SEASON_CYCLE_DAYS = 4;

const SPECIES_IDX = new Map<SpeciesId, number>(SPECIES_ORDER.map((s, i) => [s, i]));
const STATE_IDX = new Map<string, number>(STATE_ORDER.map((s, i) => [s, i]));
const STAGE_IDX = new Map<string, number>(STAGE_ORDER.map((s, i) => [s, i]));

export interface PersistedWorld {
  totalSimDays: number;
  nextAnimalId: number;
  nextCarcassId: number;
  nextEventId: number;
  seasonProgress: number;
  rainCooldown: number;
  rainRemaining: number;
  animals: SimAnimal[];
  carcasses: SimCarcass[];
}

export class SimulationCore {
  public animals: SimAnimal[] = [];
  public carcasses: SimCarcass[] = [];
  public events: WorldEvent[] = [];

  public timeState: TimeState = {
    day: 1,
    timeOfDay: 6.4 / 24,
    hour: 6,
    minute: 24,
    phaseNameRu: 'Рассвет',
    temperature: 0.4,
  };

  public season: SeasonState = {
    progress: 0.18,
    wetness: 0.72,
    isDrySeason: false,
    isRaining: false,
    rainIntensity: 0,
    seasonNameRu: 'Сезон дождей',
    weatherTextRu: 'Ясно · Полноводная река',
  };

  private nextAnimalId = 1;
  private nextCarcassId = 1;
  private nextEventId = 1;
  private totalSimDays = 6.4 / 24;
  private rainCooldown = 45;
  private rainRemaining = 0;
  private migrationCheckTimer = 8;
  private foliageRegenTimer = 0;
  private prevWetSeasonFlag = true;

  private readonly trees: TreeNode[];
  private readonly kopjes: Vec3[];
  private readonly colliderGrid: StaticColliderGrid;
  private readonly spatial = new SpatialHash(20);

  // Per-tick delta tracking
  private pendingAdded: AnimalMeta[] = [];
  private pendingRemoved: number[] = [];
  private pendingEvents: WorldEvent[] = [];
  private lastBroadcastStatuses = new Map<number, string>();

  constructor(persisted?: PersistedWorld | null) {
    const layout = generateWorldLayout();
    this.trees = layout.trees;
    this.kopjes = layout.kopjes;
    this.colliderGrid = new StaticColliderGrid(layout.colliders);

    if (persisted && persisted.animals.length > 0) {
      this.totalSimDays = persisted.totalSimDays;
      this.nextAnimalId = persisted.nextAnimalId;
      this.nextCarcassId = persisted.nextCarcassId;
      this.nextEventId = persisted.nextEventId;
      this.rainCooldown = persisted.rainCooldown ?? 40;
      this.rainRemaining = persisted.rainRemaining ?? 0;
      this.animals = persisted.animals;
      this.carcasses = persisted.carcasses ?? [];
      this.updateTimeAndSeason(0, 0);
      this.prevWetSeasonFlag = !this.season.isDrySeason;
    } else {
      this.populateInitialValley();
      this.updateTimeAndSeason(0, 0);
    }

    for (const a of this.animals) {
      this.lastBroadcastStatuses.set(a.id, a.statusText);
    }
  }

  public exportSnapshotForDisk(): PersistedWorld {
    return {
      totalSimDays: this.totalSimDays,
      nextAnimalId: this.nextAnimalId,
      nextCarcassId: this.nextCarcassId,
      nextEventId: this.nextEventId,
      seasonProgress: this.season.progress,
      rainCooldown: this.rainCooldown,
      rainRemaining: this.rainRemaining,
      animals: this.animals,
      carcasses: this.carcasses,
    };
  }

  public buildWelcomeMsg(viewerCount: number): ServerWelcomeMsg {
    return {
      type: 'welcome',
      t: this.timeState,
      s: this.season,
      v: viewerCount,
      meta: this.animals.map((a) => this.toMeta(a)),
      a: this.animals.map((a) => this.toTuple(a)),
      c: this.carcasses.map((c) => this.toCarcassTuple(c)),
      events: this.events.slice(0, 6),
    };
  }

  public consumeTickMsg(viewerCount: number): ServerTickMsg {
    const statuses: [number, string][] = [];
    for (const a of this.animals) {
      if (this.lastBroadcastStatuses.get(a.id) !== a.statusText) {
        statuses.push([a.id, a.statusText]);
        this.lastBroadcastStatuses.set(a.id, a.statusText);
      }
    }

    const msg: ServerTickMsg = {
      type: 'tick',
      t: this.timeState,
      s: this.season,
      v: viewerCount,
      a: this.animals.map((a) => this.toTuple(a)),
      c: this.carcasses.map((c) => this.toCarcassTuple(c)),
    };

    if (this.pendingAdded.length > 0) msg.added = this.pendingAdded.splice(0);
    if (this.pendingRemoved.length > 0) msg.removed = this.pendingRemoved.splice(0);
    if (statuses.length > 0) msg.statuses = statuses;
    if (this.pendingEvents.length > 0) msg.events = this.pendingEvents.splice(0);

    return msg;
  }

  private toMeta(a: SimAnimal): AnimalMeta {
    return {
      id: a.id,
      species: a.species,
      name: a.name,
      sex: a.sex,
      groupId: a.groupId,
      maxAgeDays: Number(a.maxAgeDays.toFixed(1)),
      statusText: a.statusText,
    };
  }

  private toTuple(a: SimAnimal): AnimalTuple {
    const flags = (a.isSwimming ? 1 : 0) | (a.yawnTimer > 0 ? 2 : 0);
    return [
      a.id,
      Number(a.pos.x.toFixed(2)),
      Number(a.pos.y.toFixed(2)),
      Number(a.pos.z.toFixed(2)),
      Number(a.yaw.toFixed(3)),
      Number(a.speed.toFixed(2)),
      STATE_IDX.get(a.state) ?? 0,
      Math.round(a.hunger),
      Math.round(a.thirst),
      Math.round(a.energy),
      Math.round(a.health),
      Number(a.ageDays.toFixed(1)),
      STAGE_IDX.get(a.stage) ?? 1,
      flags,
    ];
  }

  private toCarcassTuple(c: SimCarcass): CarcassTuple {
    return [
      c.id,
      SPECIES_IDX.get(c.species) ?? 0,
      Number(c.pos.x.toFixed(2)),
      Number(c.pos.y.toFixed(2)),
      Number(c.pos.z.toFixed(2)),
      Number(c.yaw.toFixed(3)),
      Number((c.meatRemaining / c.maxMeat).toFixed(2)),
      c.isJuvenile ? 1 : 0,
    ];
  }

  private populateInitialValley(): void {
    this.spawnGroup('elephant', -64, -28, 5, 1, 2);
    this.spawnAnimal('elephant', -68, 38, 'M', 'adult', 2);
    this.spawnAnimal('elephant', -36, 62, 'M', 'adult', 3);

    this.spawnAnimal('lion', -47, -9, 'M', 'adult', 10);
    for (let i = 0; i < 4; i++) {
      this.spawnAnimal('lion', -49 + (i - 1.5) * 3, -6 + (i % 2) * 3, 'F', 'adult', 10);
    }
    this.spawnAnimal('lion', -46, -11, 'F', 'juvenile', 10);
    this.spawnAnimal('lion', -50, -10, 'M', 'juvenile', 10);
    this.spawnAnimal('lion', -74, -58, 'M', 'adult', 11);

    this.spawnAnimal('tiger', 52, -60, 'M', 'adult', 20);
    this.spawnAnimal('tiger', 44, 6, 'F', 'adult', 21);
    this.spawnAnimal('tiger', 47, 11, 'M', 'juvenile', 21);
    this.spawnAnimal('tiger', 56, 64, 'M', 'adult', 22);

    this.spawnGroup('giraffe', -56, -46, 4, 30, 1);
    this.spawnGroup('giraffe', -48, 44, 4, 31, 1);

    const hippoZ1 = -24;
    this.spawnGroup('hippo', getRiverCenterX(hippoZ1), hippoZ1, 5, 40, 1);
    const hippoZ2 = 38;
    this.spawnGroup('hippo', getRiverCenterX(hippoZ2), hippoZ2, 5, 41, 1);

    this.spawnGroup('zebra', -32, -38, 10, 50, 2);
    this.spawnGroup('zebra', -60, 32, 9, 51, 2);

    this.spawnGroup('antelope', -38, 12, 7, 60, 1);
    this.spawnGroup('antelope', -76, -16, 6, 61, 1);
    this.spawnGroup('antelope', -34, -76, 6, 62, 1);

    this.spawnGroup('deer', 36, -34, 4, 70, 1);
    this.spawnGroup('deer', 54, 30, 4, 71, 1);
    this.spawnGroup('deer', 32, 72, 4, 72, 1);

    this.spawnGroup('boar', 68, -22, 3, 80, 1);
    this.spawnGroup('boar', 42, -74, 3, 81, 1);
    this.spawnGroup('boar', 64, 46, 3, 82, 1);

    for (let i = 0; i < 7; i++) {
      this.spawnAnimal(
        'vulture',
        (Math.random() - 0.5) * 140,
        (Math.random() - 0.5) * 140,
        i % 2 === 0 ? 'M' : 'F',
        'adult',
        90
      );
    }

    this.pushEvent(
      '🌅',
      'Рассвет над долиной: единая экосистема оживает',
      { x: 0, y: 0, z: 0 },
      2
    );
  }

  private spawnGroup(
    species: SpeciesId,
    cx: number,
    cz: number,
    count: number,
    groupId: number,
    juveniles: number
  ): void {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const dist = i === 0 ? 0 : 2.8 + Math.random() * 5.2;
      const x = cx + Math.cos(ang) * dist;
      const z = cz + Math.sin(ang) * dist;
      const sex: Sex = i === 0 ? 'F' : Math.random() < 0.45 ? 'M' : 'F';
      const isJuv = i >= count - juveniles;
      this.spawnAnimal(species, x, z, sex, isJuv ? 'juvenile' : 'adult', groupId);
    }
  }

  public spawnAnimal(
    species: SpeciesId,
    x: number,
    z: number,
    sex: Sex,
    stage: 'juvenile' | 'adult',
    groupId: number,
    motherId: number | null = null
  ): SimAnimal {
    const cfg = SPECIES_CONFIGS[species];
    const id = this.nextAnimalId++;
    const name = pickAnimalName(species, sex, id);
    const ageDays =
      stage === 'juvenile'
        ? cfg.lifespanDays * (0.04 + Math.random() * 0.1)
        : cfg.lifespanDays * (0.28 + Math.random() * 0.42);

    const cx = Math.max(-WORLD_HALF + 3, Math.min(WORLD_HALF - 3, x));
    const cz = Math.max(-WORLD_HALF + 3, Math.min(WORLD_HALF - 3, z));
    const groundY = getTerrainHeight(cx, cz);
    const soarHeight = species === 'vulture' ? 22 + Math.random() * 11 : 0;

    const animal: SimAnimal = {
      id,
      species,
      name,
      sex,
      ageDays,
      maxAgeDays: cfg.lifespanDays * (0.88 + Math.random() * 0.24),
      stage,
      groupId,
      motherId,
      pos: { x: cx, y: species === 'vulture' ? Math.max(groundY, 0) + soarHeight : groundY, z: cz },
      yaw: Math.random() * Math.PI * 2,
      speed: 0,
      isSwimming: false,
      hunger: 68 + Math.random() * 26,
      thirst: 68 + Math.random() * 26,
      energy: 72 + Math.random() * 25,
      health: 95 + Math.random() * 5,
      state: species === 'vulture' ? 'soaring' : 'wandering',
      statusText: species === 'vulture' ? 'Парит в потоках воздуха' : 'Осматривает долину',
      stateTimer: 2 + Math.random() * 4,
      decisionCooldown: Math.random() * 0.8,
      reproCooldown: cfg.lifespanDays * 0.18 + Math.random() * 2,
      attackCooldown: 0,
      callCooldown: 6 + Math.random() * 14,
      yawnTimer: 0,
      targetPos: null,
      targetAnimalId: null,
      targetCarcassId: null,
      targetTreeIdx: null,
      threatAnimalId: null,
      homeCenter: { x: cx, y: 0, z: cz },
      soarHeight,
      soarAngle: Math.random() * Math.PI * 2,
      alive: true,
    };

    if (species !== 'vulture') {
      this.resolveStaticCollisions(animal);
      animal.pos.y = getTerrainHeight(animal.pos.x, animal.pos.z);
    }

    this.animals.push(animal);
    this.pendingAdded.push(this.toMeta(animal));
    this.lastBroadcastStatuses.set(animal.id, animal.statusText);
    return animal;
  }

  public getAnimalById(id: number | null): SimAnimal | null {
    if (id === null) return null;
    for (let i = 0; i < this.animals.length; i++) {
      if (this.animals[i].id === id && this.animals[i].alive) return this.animals[i];
    }
    return null;
  }

  public getSpeciesCounts(): Record<SpeciesId, number> {
    const counts = {} as Record<SpeciesId, number>;
    for (const sp of SPECIES_ORDER) counts[sp] = 0;
    for (const a of this.animals) {
      if (a.alive) counts[a.species]++;
    }
    return counts;
  }

  public step(simDt: number): void {
    const dt = Math.min(0.25, simDt);
    if (dt <= 0) return;

    const simDaysDt = dt / DAY_REAL_SECONDS;
    this.updateTimeAndSeason(simDaysDt, dt);

    this.spatial.clear();
    for (let i = 0; i < this.animals.length; i++) {
      if (this.animals[i].alive) this.spatial.insert(this.animals[i]);
    }

    this.foliageRegenTimer += dt;
    if (this.foliageRegenTimer > 2.5) {
      const regen = (0.015 + this.season.wetness * 0.04) * (this.foliageRegenTimer / 2.5);
      for (let i = 0; i < this.trees.length; i++) {
        if (this.trees[i].kind !== 'snag') {
          this.trees[i].foliage = Math.min(1, this.trees[i].foliage + regen);
        }
      }
      this.foliageRegenTimer = 0;
    }

    const counts = this.getSpeciesCounts();
    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i];
      if (!a.alive) continue;
      this.updateAnimal(a, dt, simDaysDt, counts);
    }

    this.updateCarcasses(dt);

    this.migrationCheckTimer -= dt;
    if (this.migrationCheckTimer <= 0) {
      this.migrationCheckTimer = 9;
      this.checkNaturalMigration(counts);
    }

    for (let i = this.animals.length - 1; i >= 0; i--) {
      if (!this.animals[i].alive) {
        this.animals.splice(i, 1);
      }
    }
  }

  private updateTimeAndSeason(simDaysDt: number, simDt: number): void {
    this.totalSimDays += simDaysDt;
    const day = Math.floor(this.totalSimDays) + 1;
    const tod = this.totalSimDays % 1;
    const exactHour = tod * 24;
    const hour = Math.floor(exactHour);
    const minute = Math.floor((exactHour - hour) * 60);

    let phaseNameRu = 'День';
    if (exactHour >= 5 && exactHour < 8) phaseNameRu = 'Рассвет';
    else if (exactHour >= 8 && exactHour < 11.5) phaseNameRu = 'Утро';
    else if (exactHour >= 11.5 && exactHour < 16) phaseNameRu = 'Полуденный зной';
    else if (exactHour >= 16 && exactHour < 18.5) phaseNameRu = 'Предзакатье';
    else if (exactHour >= 18.5 && exactHour < 20.8) phaseNameRu = 'Закат и сумерки';
    else phaseNameRu = 'Звёздная ночь';

    const sunCurve = Math.sin((tod - 0.32) * Math.PI * 2) * 0.5 + 0.5;
    const seasonHeatBoost = (1 - this.season.wetness) * 0.16;
    const rainCool = this.season.rainIntensity * 0.25;
    const temperature = Math.max(0.08, Math.min(1, sunCurve * 0.85 + seasonHeatBoost - rainCool));

    this.timeState = { day, timeOfDay: tod, hour, minute, phaseNameRu, temperature };

    const progress = (this.totalSimDays / SEASON_CYCLE_DAYS) % 1;
    const wetness = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2);
    const isDrySeason = wetness < 0.48;

    if (isDrySeason && this.prevWetSeasonFlag) {
      this.prevWetSeasonFlag = false;
      this.pushEvent(
        '☀️',
        'Наступает сухой сезон: река мелеет и открываются широкие броды',
        { x: getRiverCenterX(8), y: 0, z: 8 },
        2
      );
    } else if (!isDrySeason && !this.prevWetSeasonFlag) {
      this.prevWetSeasonFlag = true;
      this.pushEvent(
        '🌧️',
        'Приходит сезон дождей: долина зеленеет, водопои наполняются водой',
        { x: -60, y: 0, z: 15 },
        2
      );
    }

    if (simDt > 0) {
      if (this.rainRemaining > 0) {
        this.rainRemaining -= simDt;
        this.season.rainIntensity = Math.min(1, this.season.rainIntensity + simDt * 0.25);
      } else {
        this.season.rainIntensity = Math.max(0, this.season.rainIntensity - simDt * 0.22);
        this.rainCooldown -= simDt * (0.4 + wetness * 1.1);
        if (this.rainCooldown <= 0) {
          this.rainCooldown = 50 + Math.random() * 65;
          if (wetness > 0.38 && Math.random() < 0.25 + wetness * 0.65) {
            this.rainRemaining = 18 + Math.random() * 24;
          }
        }
      }
    }

    const isRaining = this.season.rainIntensity > 0.25;
    const seasonNameRu = isDrySeason ? 'Сухой сезон' : 'Сезон дождей';
    const weatherTextRu = isRaining
      ? 'Тропический ливень'
      : isDrySeason
        ? wetness < 0.25
          ? 'Засуха · Броды открыты'
          : 'Жарко · Река мелеет'
        : 'Тепло · Полноводная река';

    this.season = {
      progress,
      wetness,
      isDrySeason,
      isRaining,
      rainIntensity: this.season.rainIntensity,
      seasonNameRu,
      weatherTextRu,
    };
  }

  private updateAnimal(
    a: SimAnimal,
    simDt: number,
    simDaysDt: number,
    counts: Record<SpeciesId, number>
  ): void {
    const cfg = SPECIES_CONFIGS[a.species];

    a.ageDays += simDaysDt;
    if (a.stage === 'juvenile' && a.ageDays >= a.maxAgeDays * cfg.maturityAgeRatio) {
      a.stage = 'adult';
      a.motherId = null;
      if (cfg.isMainFive) {
        this.pushEvent(
          cfg.emoji,
          `${getSpeciesTitleRu(a.species, a.sex)} ${a.name} достигает взрослого возраста`,
          a.pos,
          1
        );
      }
    } else if (a.stage === 'adult' && a.ageDays >= a.maxAgeDays * 0.8) {
      a.stage = 'elder';
    }

    if (a.ageDays >= a.maxAgeDays) {
      this.killAnimal(a);
      return;
    }

    const activeFactor =
      a.state === 'chasing' || a.state === 'fleeing' || a.state === 'defending'
        ? 2.2
        : a.state === 'resting' || a.state === 'perching'
          ? 0.45
          : 1.0;

    a.hunger = Math.max(0, a.hunger - simDt * 0.4 * activeFactor);
    const heatThirstMult = 0.75 + this.timeState.temperature * 0.9 + (1 - this.season.wetness) * 0.35;
    a.thirst = Math.max(0, a.thirst - simDt * 0.44 * heatThirstMult);

    if (a.state === 'resting' || a.state === 'perching') {
      a.energy = Math.min(100, a.energy + simDt * 4.4);
    } else if (a.state === 'chasing' || a.state === 'fleeing') {
      a.energy = Math.max(0, a.energy - simDt * 3.8);
    } else {
      a.energy = Math.max(0, a.energy - simDt * 0.25);
    }

    if (a.hunger > 45 && a.thirst > 45) {
      a.health = Math.min(100, a.health + simDt * 0.65);
    } else if (a.hunger <= 2 || a.thirst <= 2) {
      a.health -= simDt * 1.4;
      if (a.health <= 0) {
        this.killAnimal(a);
        return;
      }
    }

    if (a.reproCooldown > 0) a.reproCooldown = Math.max(0, a.reproCooldown - simDaysDt);
    if (a.attackCooldown > 0) a.attackCooldown = Math.max(0, a.attackCooldown - simDt);
    if (a.yawnTimer > 0) a.yawnTimer = Math.max(0, a.yawnTimer - simDt);

    a.stateTimer -= simDt;
    a.decisionCooldown -= simDt;

    const neighbors = this.spatial.query(a.pos.x, a.pos.z, cfg.visionRange);

    if (a.decisionCooldown <= 0) {
      a.decisionCooldown =
        a.state === 'chasing' || a.state === 'fleeing' || a.state === 'defending'
          ? 0.25
          : 0.75 + Math.random() * 0.45;
      this.decideBehavior(a, neighbors, counts);
    }

    this.executeState(a, simDt, neighbors, counts);
  }

  private decideBehavior(
    a: SimAnimal,
    neighbors: SimAnimal[],
    counts: Record<SpeciesId, number>
  ): void {
    const cfg = SPECIES_CONFIGS[a.species];

    if (a.species === 'vulture') {
      this.decideVultureBehavior(a, neighbors);
      return;
    }

    if (cfg.diet !== 'carnivore' || a.stage === 'juvenile') {
      const threat = this.findNearestThreat(a, neighbors);
      if (threat) {
        const dist = dist3(a.pos, threat.pos);
        if (a.species === 'elephant' && a.stage !== 'juvenile') {
          const nearCalf = neighbors.some(
            (n) => n.species === 'elephant' && n.stage === 'juvenile' && dist3(n.pos, threat.pos) < 12
          );
          if (
            threat.state === 'chasing' ||
            threat.state === 'stalking' ||
            nearCalf ||
            dist < 8.5
          ) {
            this.enterDefend(a, threat, 'Защищает стадо и детёнышей!');
            return;
          }
        }
        if (a.species === 'hippo' && a.stage !== 'juvenile' && dist < 11) {
          this.enterDefend(a, threat, 'Яростно защищает берег!');
          return;
        }
        if (a.species === 'giraffe' && a.stage !== 'juvenile' && dist < 5.5) {
          this.enterDefend(a, threat, 'Отбивается мощным ударом!');
          return;
        }
        if (a.species !== 'elephant') {
          a.state = 'fleeing';
          a.threatAnimalId = threat.id;
          a.statusText = 'Спасается бегством!';
          a.stateTimer = 3.2;
          return;
        }
      }
    }

    if (a.species === 'hippo' && a.stage !== 'juvenile') {
      const intruder = neighbors.find(
        (n) =>
          (n.species === 'lion' || n.species === 'tiger') &&
          dist3(a.pos, n.pos) < 12 &&
          getWaterDepth(n.pos.x, n.pos.z, this.season.wetness) > 0.05
      );
      if (intruder) {
        this.enterDefend(a, intruder, 'Отгоняет хищника от воды!');
        return;
      }
      if (Math.random() < 0.045 && a.isSwimming) {
        a.yawnTimer = 1.6;
      }
    }

    if (a.species === 'lion' && a.sex === 'M' && a.stage !== 'juvenile') {
      const rival = neighbors.find(
        (n) =>
          (n.species === 'tiger' && dist3(a.pos, n.pos) < 15) ||
          (n.species === 'lion' && n.sex === 'M' && n.groupId !== a.groupId && dist3(a.pos, n.pos) < 15)
      );
      if (rival) {
        this.enterDefend(a, rival, 'Охраняет границы прайда!');
        return;
      }
    }

    if (a.species === 'tiger' && a.stage !== 'juvenile') {
      const rivalTiger = neighbors.find(
        (n) =>
          n.species === 'tiger' &&
          n.id !== a.id &&
          n.stage !== 'juvenile' &&
          n.sex === a.sex &&
          dist3(a.pos, n.pos) < 16
      );
      if (rivalTiger) {
        this.enterDefend(a, rivalTiger, 'Прогоняет чужака со своей территории');
        return;
      }
    }

    if (
      (a.state === 'drinking' && a.thirst < 92) ||
      (a.state === 'feeding' && a.hunger < 92 && this.getCarcass(a.targetCarcassId)) ||
      (a.state === 'grazing' && a.hunger < 82 && a.stateTimer > 0) ||
      (a.state === 'browsing' && a.hunger < 82 && a.stateTimer > 0) ||
      (a.state === 'courting' && a.stateTimer > 0)
    ) {
      return;
    }

    if (a.stage === 'juvenile') {
      const guardian = this.findGuardian(a, neighbors);
      if (guardian && dist3(a.pos, guardian.pos) > 5.5) {
        a.state = 'following';
        a.targetAnimalId = guardian.id;
        a.statusText = 'Держится рядом со взрослыми';
        a.stateTimer = 3;
        return;
      }
    }

    if (a.thirst < 50 && a.species !== 'hippo') {
      const waterPt = this.findNearestWaterTarget(a);
      if (waterPt) {
        a.state = 'seeking_water';
        a.targetPos = waterPt;
        a.statusText = 'Идёт к водопою';
        a.stateTimer = 14;
        return;
      }
    } else if (a.species === 'hippo' && a.thirst < 60) {
      a.thirst = Math.min(100, a.thirst + 10);
      a.state = 'cooling';
      a.targetPos = this.findNearestRiverPool(a.pos);
      a.statusText = 'Возвращается в речную лагуну';
      a.stateTimer = 14;
      return;
    }

    if (a.species === 'hippo') {
      const isNightTime = this.timeState.hour >= 18 || this.timeState.hour < 6;
      const depthHere = getWaterDepth(a.pos.x, a.pos.z, this.season.wetness);
      if (!isNightTime) {
        if (depthHere < 0.38 || a.state !== 'cooling') {
          a.state = 'cooling';
          a.targetPos = this.findNearestRiverPool(a.pos);
          a.statusText = 'Днюет в прохладной реке';
          a.stateTimer = 10;
        }
        return;
      } else if (a.hunger < 88) {
        a.state = 'grazing';
        a.targetPos = this.findBankGrazingSpot(a.pos);
        a.statusText = 'Выходит на ночной выпас';
        a.stateTimer = 11;
        return;
      }
    }

    if (cfg.diet === 'carnivore') {
      const carcass = this.findNearestCarcass(a.pos, 42);
      if (carcass && a.hunger < 84) {
        a.state = 'feeding';
        a.targetCarcassId = carcass.id;
        a.targetPos = { ...carcass.pos };
        a.statusText = 'Питается добычей';
        a.stateTimer = 10;
        return;
      }

      const isPrimeHuntHour =
        this.timeState.hour < 8.5 || this.timeState.hour > 16.8 || a.hunger < 42;
      if (a.stage !== 'juvenile' && a.hunger < (isPrimeHuntHour ? 72 : 52) && a.energy > 28) {
        if (a.species === 'lion') {
          const huntingMate = neighbors.find(
            (n) =>
              n.species === 'lion' &&
              n.groupId === a.groupId &&
              (n.state === 'stalking' || n.state === 'chasing') &&
              n.targetAnimalId !== null
          );
          if (huntingMate && huntingMate.targetAnimalId) {
            const prey = this.getAnimalById(huntingMate.targetAnimalId);
            if (prey) {
              a.state = huntingMate.state;
              a.targetAnimalId = prey.id;
              a.statusText = 'Помогает прайду в охоте';
              a.stateTimer = 10;
              return;
            }
          }
        }

        const prey = this.findBestPrey(a, neighbors);
        if (prey) {
          const dist = dist3(a.pos, prey.pos);
          a.state = dist < 15 ? 'chasing' : 'stalking';
          a.targetAnimalId = prey.id;
          a.statusText = a.state === 'stalking' ? 'Крадётся к добыче' : 'Преследует добычу!';
          a.stateTimer = 11;
          return;
        }
      }
    }

    if (
      this.timeState.temperature > 0.68 &&
      a.hunger > 42 &&
      a.thirst > 42 &&
      a.energy < 88 &&
      a.state !== 'cooling' &&
      a.state !== 'resting'
    ) {
      if ((a.species === 'elephant' || a.species === 'tiger') && Math.random() < 0.45) {
        a.state = 'cooling';
        a.targetPos = this.findCoolingShoreSpot(a);
        a.statusText =
          a.species === 'elephant' ? 'Освежается у воды в жару' : 'Остывает в речной прохладе';
        a.stateTimer = 10;
        return;
      }
      a.state = 'resting';
      a.targetPos = this.findShadeSpot(a);
      a.statusText = 'Идёт в тень отдохнуть';
      a.stateTimer = 10 + Math.random() * 6;
      return;
    }

    if (a.energy < 25) {
      a.state = 'resting';
      a.targetPos = this.findShadeSpot(a);
      a.statusText = 'Идёт в тень отдохнуть';
      a.stateTimer = 9;
      return;
    }

    if (cfg.diet === 'browser' && a.hunger < 74) {
      const treeIdx = this.findNearestFoodTree(a.pos, a.species === 'giraffe');
      if (treeIdx !== null) {
        a.state = 'browsing';
        a.targetTreeIdx = treeIdx;
        const tree = this.trees[treeIdx];
        a.targetPos = { x: tree.x, y: tree.y, z: tree.z };
        a.statusText = 'Направляется к кронам деревьев';
        a.stateTimer = 9;
        return;
      }
    }

    if ((cfg.diet === 'grazer' || cfg.diet === 'omnivore' || cfg.diet === 'browser') && a.hunger < 74) {
      a.state = 'grazing';
      a.targetPos = this.findGrazingSpot(a);
      a.statusText = 'Идёт на пастбище';
      a.stateTimer = 9;
      return;
    }

    if (
      a.stage === 'adult' &&
      a.reproCooldown <= 0 &&
      a.hunger > 64 &&
      a.thirst > 64 &&
      a.health > 80 &&
      counts[a.species] < cfg.maxCap
    ) {
      const mate = neighbors.find(
        (n) =>
          n.species === a.species &&
          n.stage === 'adult' &&
          n.sex !== a.sex &&
          n.reproCooldown <= 0 &&
          n.hunger > 60 &&
          n.state !== 'fleeing' &&
          n.state !== 'chasing' &&
          dist3(a.pos, n.pos) < 18
      );
      if (mate) {
        a.state = 'courting';
        a.targetAnimalId = mate.id;
        a.statusText = 'Брачное ухаживание';
        a.stateTimer = 4.5;
        return;
      }
    }

    if (
      a.stateTimer <= 0 ||
      a.targetPos === null ||
      Math.hypot(a.pos.x - a.targetPos.x, a.pos.z - a.targetPos.z) < 3
    ) {
      if (
        this.season.wetness < 0.48 &&
        (a.species === 'elephant' || a.species === 'zebra' || a.species === 'tiger') &&
        Math.random() < 0.08
      ) {
        const ford = FORDS[Math.floor(Math.random() * FORDS.length)];
        const sideShift = a.pos.x < getRiverCenterX(ford.z) ? 20 : -20;
        a.state = 'crossing';
        a.targetPos = {
          x: getRiverCenterX(ford.z) + sideShift,
          y: 0,
          z: ford.z + (Math.random() - 0.5) * 6,
        };
        a.statusText =
          a.species === 'tiger' ? 'Переплывает реку' : `Переходит ${ford.name.toLowerCase()}`;
        a.stateTimer = 16;
        return;
      }

      a.state = 'wandering';
      a.targetPos = this.pickWanderPoint(a, neighbors);
      a.statusText = this.getIdleStatusRu(a.species);
      a.stateTimer = 7 + Math.random() * 7;
    }
  }

  private decideVultureBehavior(a: SimAnimal, neighbors: SimAnimal[]): void {
    if ((a.state === 'drinking' && a.thirst < 94) || (a.state === 'perching' && a.stateTimer > 0)) {
      return;
    }

    // Drink ONLY from a dry bank shore spot!
    if (a.thirst < 42) {
      const shorePt = this.findDryShoreDrinkPoint(a);
      if (shorePt) {
        a.state = 'seeking_water';
        a.targetPos = shorePt;
        a.targetCarcassId = null;
        a.statusText = 'Летит к береговому водопою';
        a.stateTimer = 16;
        return;
      }
    }

    const carcass = this.findNearestCarcass(a.pos, 95);
    if (carcass) {
      const dangerousNear = neighbors.some(
        (n) => (n.species === 'lion' || n.species === 'tiger') && dist3(n.pos, carcass.pos) < 12
      );
      if (!dangerousNear && a.hunger < 88) {
        a.state = 'scavenging';
        a.targetCarcassId = carcass.id;
        a.targetPos = { ...carcass.pos };
        a.statusText = 'Кормится у добычи';
        a.stateTimer = 8;
        return;
      }
      a.state = 'soaring';
      a.targetCarcassId = carcass.id;
      a.targetPos = { ...carcass.pos };
      a.statusText = 'Высоко кружит над добычей';
      a.stateTimer = 8;
      return;
    }

    // Occasionally perch on top of a dry dead snag tree!
    if (a.energy < 58 || (a.hunger > 75 && Math.random() < 0.14)) {
      const snag = this.findNearestSnagTree(a.pos);
      if (snag) {
        a.state = 'perching';
        a.targetCarcassId = null;
        a.targetPos = { x: snag.x, y: snag.y + snag.canopyHeight, z: snag.z };
        a.statusText = 'Направляется на ветвь сухого дерева';
        a.stateTimer = 14 + Math.random() * 8;
        return;
      }
    }

    a.state = 'soaring';
    a.targetCarcassId = null;
    if (!a.targetPos || a.stateTimer <= 0) {
      a.targetPos = {
        x: (Math.random() - 0.5) * 110,
        y: 0,
        z: (Math.random() - 0.5) * 110,
      };
      a.stateTimer = 14;
    }
    a.statusText = 'Парит высоко над долиной';
  }

  private executeState(
    a: SimAnimal,
    simDt: number,
    neighbors: SimAnimal[],
    counts: Record<SpeciesId, number>
  ): void {
    const cfg = SPECIES_CONFIGS[a.species];

    if (a.species === 'vulture') {
      this.executeVulture(a, simDt, cfg.runSpeed);
      return;
    }

    switch (a.state) {
      case 'resting': {
        if (a.targetPos && Math.hypot(a.pos.x - a.targetPos.x, a.pos.z - a.targetPos.z) > 2.4) {
          this.steerTowards(a, a.targetPos, cfg.walkSpeed * 0.8, simDt, true);
          a.statusText = 'Идёт в тень отдохнуть';
        } else {
          a.speed = 0;
          a.statusText = a.species === 'lion' ? 'Отдыхает в тени скал' : 'Отдыхает в тени';
        }
        break;
      }

      case 'seeking_water': {
        if (!a.targetPos) break;
        const depth = getWaterDepth(a.pos.x, a.pos.z, this.season.wetness);
        const dist = Math.hypot(a.pos.x - a.targetPos.x, a.pos.z - a.targetPos.z);
        if ((depth > 0.04 && depth < 0.48) || dist < 1.8) {
          a.state = 'drinking';
          a.statusText = 'Пьёт воду';
          a.stateTimer = 6;
          a.speed = 0;
        } else {
          this.steerTowards(a, a.targetPos, cfg.walkSpeed * 1.05, simDt, true);
        }
        break;
      }

      case 'drinking': {
        a.speed = 0;
        a.thirst = Math.min(100, a.thirst + simDt * 16);
        if (a.thirst >= 96) {
          a.state = 'wandering';
          a.stateTimer = 2;
        }
        break;
      }

      case 'cooling': {
        if (!a.targetPos) break;
        const depth = getWaterDepth(a.pos.x, a.pos.z, this.season.wetness);
        const dist = Math.hypot(a.pos.x - a.targetPos.x, a.pos.z - a.targetPos.z);
        const wantDepth = a.species === 'hippo' ? 0.42 : 0.16;
        if (dist > 3.0 && depth < wantDepth) {
          this.steerTowards(a, a.targetPos, cfg.walkSpeed, simDt, false);
        } else {
          a.speed = 0;
          a.thirst = Math.min(100, a.thirst + simDt * 7);
          a.energy = Math.min(100, a.energy + simDt * 2.5);
        }
        break;
      }

      case 'browsing': {
        if (!a.targetPos) break;
        const dist = Math.hypot(a.pos.x - a.targetPos.x, a.pos.z - a.targetPos.z);
        const treeRadius =
          a.targetTreeIdx !== null && this.trees[a.targetTreeIdx]
            ? this.trees[a.targetTreeIdx].trunkRadius + cfg.adultRadius + 1.8
            : 3.4;
        if (dist > treeRadius) {
          this.steerTowards(a, a.targetPos, cfg.walkSpeed, simDt, true);
          a.statusText = 'Направляется к кронам деревьев';
        } else {
          a.speed = 0;
          a.statusText =
            a.species === 'giraffe' ? 'Объедает крону акации' : 'Срывает ветви хоботом';
          a.hunger = Math.min(100, a.hunger + simDt * 7.5);
          if (a.targetTreeIdx !== null && this.trees[a.targetTreeIdx]) {
            this.trees[a.targetTreeIdx].foliage = Math.max(
              0.08,
              this.trees[a.targetTreeIdx].foliage - simDt * 0.035
            );
          }
        }
        break;
      }

      case 'grazing': {
        if (a.targetPos && Math.hypot(a.pos.x - a.targetPos.x, a.pos.z - a.targetPos.z) > 2.6) {
          this.steerTowards(a, a.targetPos, cfg.walkSpeed * 0.9, simDt, true);
          a.statusText = 'Идёт на пастбище';
        } else {
          a.speed = 0;
          a.statusText = 'Щиплет траву на пастбище';
          const density = getGrassDensity(a.pos.x, a.pos.z, this.season.wetness);
          a.hunger = Math.min(100, a.hunger + simDt * (4.5 + density * 4.5));
        }
        break;
      }

      case 'following': {
        const guardian = this.getAnimalById(a.targetAnimalId);
        if (!guardian) {
          a.state = 'wandering';
          break;
        }
        const dist = dist3(a.pos, guardian.pos);
        if (dist > 4.2) {
          const spd = dist > 10 ? cfg.runSpeed * 0.8 : cfg.walkSpeed * 1.15;
          this.steerTowards(a, guardian.pos, spd, simDt, true);
        } else {
          a.speed = 0;
        }
        break;
      }

      case 'stalking': {
        const prey = this.getAnimalById(a.targetAnimalId);
        if (!prey) {
          a.state = 'wandering';
          break;
        }
        const dist = dist3(a.pos, prey.pos);
        if (dist < 14.5) {
          a.state = 'chasing';
          a.statusText = 'Стремительный бросок!';
          a.stateTimer = 8;
        } else {
          this.steerTowards(a, prey.pos, cfg.walkSpeed * 0.72, simDt, cfg.avoidsDeepWater);
        }
        break;
      }

      case 'chasing': {
        const prey = this.getAnimalById(a.targetAnimalId);
        if (!prey || a.energy < 8 || a.stateTimer <= 0) {
          a.state = 'wandering';
          a.targetAnimalId = null;
          a.statusText = 'Отказывается от погони';
          break;
        }
        const dist = dist3(a.pos, prey.pos);
        if (dist > 46) {
          a.state = 'wandering';
          a.targetAnimalId = null;
          break;
        }
        this.steerTowards(a, prey.pos, cfg.runSpeed, simDt, cfg.avoidsDeepWater);

        const reach = cfg.adultRadius + SPECIES_CONFIGS[prey.species].adultRadius + 0.85;
        if (dist <= reach && a.attackCooldown <= 0) {
          a.attackCooldown = 1.2;
          prey.health -= a.species === 'tiger' ? 56 : 48;
          prey.threatAnimalId = a.id;
          prey.state = 'fleeing';
          if (prey.health <= 0) {
            this.handlePredatorKill(a, prey);
          }
        }
        break;
      }

      case 'feeding': {
        const carcass = this.getCarcass(a.targetCarcassId);
        if (!carcass || carcass.meatRemaining <= 0) {
          a.state = 'wandering';
          a.targetCarcassId = null;
          break;
        }
        const dist = Math.hypot(a.pos.x - carcass.pos.x, a.pos.z - carcass.pos.z);
        if (dist > 2.2) {
          this.steerTowards(a, carcass.pos, cfg.walkSpeed * 1.1, simDt, cfg.avoidsDeepWater);
        } else {
          a.speed = 0;
          const bite = Math.min(carcass.meatRemaining, simDt * 5.2);
          carcass.meatRemaining -= bite;
          a.hunger = Math.min(100, a.hunger + bite * 4.5);
        }
        break;
      }

      case 'fleeing': {
        const threat = this.getAnimalById(a.threatAnimalId);
        let ax = Math.sin(a.yaw);
        let az = Math.cos(a.yaw);
        if (threat) {
          const dx = a.pos.x - threat.pos.x;
          const dz = a.pos.z - threat.pos.z;
          const len = Math.hypot(dx, dz) || 1;
          ax = dx / len;
          az = dz / len;
        }
        this.steerTowards(
          a,
          { x: a.pos.x + ax * 20, y: a.pos.y, z: a.pos.z + az * 20 },
          cfg.runSpeed,
          simDt,
          cfg.avoidsDeepWater
        );
        break;
      }

      case 'defending': {
        const threat = this.getAnimalById(a.threatAnimalId);
        if (!threat || dist3(a.pos, threat.pos) > 16 || a.stateTimer <= 0) {
          a.state = 'wandering';
          a.threatAnimalId = null;
          break;
        }
        const dist = dist3(a.pos, threat.pos);
        this.steerTowards(a, threat.pos, cfg.runSpeed * 0.92, simDt, false);
        const reach = cfg.adultRadius + SPECIES_CONFIGS[threat.species].adultRadius + 1.1;
        if (dist <= reach && a.attackCooldown <= 0) {
          a.attackCooldown = 2.4;
          const kickDmg = a.species === 'elephant' ? 20 : a.species === 'hippo' ? 22 : 12;
          threat.health -= kickDmg;
          threat.state = 'fleeing';
          threat.threatAnimalId = a.id;
          threat.stateTimer = 6.5;
          threat.targetAnimalId = null;
          a.state = 'wandering';
          a.threatAnimalId = null;
          if (threat.health <= 0) {
            this.killAnimal(threat);
          }
        }
        break;
      }

      case 'courting': {
        const mate = this.getAnimalById(a.targetAnimalId);
        if (!mate) {
          a.state = 'wandering';
          break;
        }
        const dist = dist3(a.pos, mate.pos);
        if (dist > 2.4) {
          this.steerTowards(a, mate.pos, cfg.walkSpeed * 0.9, simDt, true);
        } else {
          a.speed = 0;
          if (a.stateTimer <= 0.4 && a.sex === 'F' && counts[a.species] < cfg.maxCap) {
            const babySex: Sex = Math.random() < 0.5 ? 'M' : 'F';
            const baby = this.spawnAnimal(
              a.species,
              a.pos.x + (Math.random() - 0.5) * 2,
              a.pos.z + (Math.random() - 0.5) * 2,
              babySex,
              'juvenile',
              a.groupId,
              a.id
            );
            a.reproCooldown = cfg.lifespanDays * 0.28;
            mate.reproCooldown = cfg.lifespanDays * 0.25;
            a.state = 'wandering';
            mate.state = 'wandering';
            if (cfg.isMainFive) {
              this.pushEvent(
                cfg.emoji,
                `Пополнение! Родился детёныш вида ${cfg.nameRu.toLowerCase()} — ${baby.name}`,
                a.pos,
                3
              );
            }
          }
        }
        break;
      }

      case 'crossing':
      case 'wandering':
      default: {
        if (a.targetPos) {
          const dist = Math.hypot(a.pos.x - a.targetPos.x, a.pos.z - a.targetPos.z);
          if (dist > 2.4) {
            const herdPull = this.computeHerdSeparationAndCohesion(a, neighbors);
            const target = {
              x: a.targetPos.x + herdPull.x * 4,
              y: a.targetPos.y,
              z: a.targetPos.z + herdPull.z * 4,
            };
            this.steerTowards(
              a,
              target,
              cfg.walkSpeed,
              simDt,
              a.state === 'crossing' ? false : cfg.avoidsDeepWater
            );
          } else {
            a.speed = 0;
            a.state = 'wandering';
            a.stateTimer = 0;
          }
        }
        break;
      }
    }
  }

  private executeVulture(a: SimAnimal, simDt: number, flySpeed: number): void {
    const waterY = getWaterLevel(this.season.wetness);
    const groundY = getTerrainHeight(a.pos.x, a.pos.z);
    const floorY = Math.max(groundY, waterY);

    if (a.state === 'seeking_water' && a.targetPos) {
      const distXZ = Math.hypot(a.pos.x - a.targetPos.x, a.pos.z - a.targetPos.z);
      const targetGround = getTerrainHeight(a.targetPos.x, a.targetPos.z);
      if (distXZ > 1.8) {
        this.flyTowards(a, a.targetPos, flySpeed * 0.9, simDt);
        const glideAlt = Math.max(floorY + 2.5, targetGround + Math.min(18, distXZ * 0.45));
        a.pos.y += (glideAlt - a.pos.y) * Math.min(1, simDt * 2.2);
      } else {
        a.speed = 0;
        a.pos.y = Math.max(groundY, waterY + 0.08);
        a.state = 'drinking';
        a.statusText = 'Пьёт воду с берега';
        a.stateTimer = 5;
      }
      return;
    }

    if (a.state === 'drinking') {
      a.speed = 0;
      a.pos.y = Math.max(groundY, waterY + 0.08);
      a.thirst = Math.min(100, a.thirst + simDt * 22);
      if (a.thirst >= 95) {
        a.state = 'soaring';
        a.statusText = 'Парит высоко над долиной';
      }
      return;
    }

    if (a.state === 'perching' && a.targetPos) {
      const distXZ = Math.hypot(a.pos.x - a.targetPos.x, a.pos.z - a.targetPos.z);
      if (distXZ > 1.4) {
        this.flyTowards(a, a.targetPos, flySpeed * 0.85, simDt);
        const approachY = Math.max(floorY + 2, a.targetPos.y + Math.min(12, distXZ * 0.35));
        a.pos.y += (approachY - a.pos.y) * Math.min(1, simDt * 2.5);
      } else {
        a.speed = 0;
        a.pos.x = a.targetPos.x;
        a.pos.z = a.targetPos.z;
        a.pos.y = a.targetPos.y;
        a.statusText = 'Высматривает долину с сухого дерева';
      }
      return;
    }

    if (a.state === 'scavenging' && a.targetPos) {
      const distXZ = Math.hypot(a.pos.x - a.targetPos.x, a.pos.z - a.targetPos.z);
      if (distXZ > 2.2) {
        this.flyTowards(a, a.targetPos, flySpeed * 0.9, simDt);
        const landY = Math.max(floorY + 1.5, getTerrainHeight(a.targetPos.x, a.targetPos.z) + distXZ * 0.35);
        a.pos.y += (landY - a.pos.y) * Math.min(1, simDt * 2.2);
      } else {
        a.speed = 0;
        a.pos.y = Math.max(groundY, waterY + 0.15);
        const carcass = this.getCarcass(a.targetCarcassId);
        if (carcass && carcass.meatRemaining > 0) {
          const bite = Math.min(carcass.meatRemaining, simDt * 2.2);
          carcass.meatRemaining -= bite;
          a.hunger = Math.min(100, a.hunger + bite * 6);
          a.thirst = Math.min(100, a.thirst + bite * 3.5);
        } else {
          a.state = 'soaring';
        }
      }
      return;
    }

    // Smooth majestic thermal soaring: tangential speed strictly <= 75% of flySpeed!
    const center = a.targetPos ?? { x: 0, y: 0, z: 0 };
    const orbitR = a.targetCarcassId ? 15 : 32;
    const angularSpeed = (flySpeed * 0.72) / orbitR;
    a.soarAngle += simDt * angularSpeed;

    const tx = center.x + Math.cos(a.soarAngle) * orbitR;
    const tz = center.z + Math.sin(a.soarAngle) * orbitR;
    this.flyTowards(a, { x: tx, y: 0, z: tz }, flySpeed * 0.88, simDt);

    const desiredAlt = floorY + (a.targetCarcassId ? 18 : a.soarHeight);
    a.pos.y += (desiredAlt - a.pos.y) * Math.min(1, simDt * 2.4);
    a.pos.y = Math.max(floorY + 14, a.pos.y); // Never dip near ground or water while soaring!
  }

  private flyTowards(a: SimAnimal, target: Vec3, speed: number, simDt: number): void {
    const dx = target.x - a.pos.x;
    const dz = target.z - a.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) {
      a.speed = 0;
      return;
    }
    const targetYaw = Math.atan2(dx / len, dz / len);
    let diff = targetYaw - a.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    a.yaw += diff * Math.min(1, simDt * 3.2);
    a.speed = speed;
    a.pos.x = Math.max(-WORLD_HALF + 4, Math.min(WORLD_HALF - 4, a.pos.x + Math.sin(a.yaw) * speed * simDt));
    a.pos.z = Math.max(-WORLD_HALF + 4, Math.min(WORLD_HALF - 4, a.pos.z + Math.cos(a.yaw) * speed * simDt));
  }

  private steerTowards(
    a: SimAnimal,
    target: Vec3,
    desiredSpeed: number,
    simDt: number,
    avoidDeepWater: boolean
  ): void {
    const cfg = SPECIES_CONFIGS[a.species];
    let dx = target.x - a.pos.x;
    let dz = target.z - a.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) {
      a.speed = 0;
      return;
    }
    dx /= len;
    dz /= len;

    // 1. Deep water avoidance
    if (avoidDeepWater) {
      const lookDist = 3.5 + cfg.adultRadius;
      const probeX = a.pos.x + dx * lookDist;
      const probeZ = a.pos.z + dz * lookDist;
      if (getWaterDepth(probeX, probeZ, this.season.wetness) > cfg.maxWaterDepth) {
        const targetSide = target.x > getRiverCenterX(target.z) ? 1 : -1;
        const mySide = a.pos.x > getRiverCenterX(a.pos.z) ? 1 : -1;
        if (targetSide !== mySide && a.state !== 'fleeing') {
          const ford = findNearestFordPoint(a.pos.z);
          dx = ford.x - a.pos.x;
          dz = ford.z - a.pos.z;
          const fl = Math.hypot(dx, dz) || 1;
          dx /= fl;
          dz /= fl;
        } else {
          const t1x = -dz;
          const t1z = dx;
          const dot1 = t1x * (target.x - a.pos.x) + t1z * (target.z - a.pos.z);
          const sign = dot1 >= 0 ? 1 : -1;
          dx = t1x * sign;
          dz = t1z * sign;
        }
      }
    }

    // 2. Smooth obstacle avoidance around tree trunks, bushes & boulders
    const myR = cfg.adultRadius * (a.stage === 'juvenile' ? 0.55 : 0.92);
    const nearbyColliders = this.colliderGrid.query(a.pos.x, a.pos.z, myR + 5.5);
    let avoidX = 0;
    let avoidZ = 0;
    for (let i = 0; i < nearbyColliders.length; i++) {
      const c = nearbyColliders[i];
      const ox = c.x - a.pos.x;
      const oz = c.z - a.pos.z;
      const d = Math.hypot(ox, oz);
      const minClear = myR + c.radius + 1.4;
      if (d > 0.01 && d < minClear + 2.8) {
        const forwardDot = (ox * dx + oz * dz) / d;
        if (forwardDot > 0.1 || d < minClear) {
          const strength = (minClear + 2.8 - d) / (minClear + 2.8);
          avoidX -= (ox / d) * strength * 2.2;
          avoidZ -= (oz / d) * strength * 2.2;
        }
      }
    }
    if (avoidX !== 0 || avoidZ !== 0) {
      dx += avoidX;
      dz += avoidZ;
      const nl = Math.hypot(dx, dz) || 1;
      dx /= nl;
      dz /= nl;
    }

    const targetYaw = Math.atan2(dx, dz);
    let diff = targetYaw - a.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    a.yaw += diff * Math.min(1, simDt * 5.2);

    const depthHere = getWaterDepth(a.pos.x, a.pos.z, this.season.wetness);
    a.isSwimming =
      depthHere > cfg.maxWaterDepth * 0.68 || (a.species === 'hippo' && depthHere > 0.35);

    const actualSpeed = a.isSwimming
      ? Math.min(desiredSpeed, cfg.swimSpeed)
      : depthHere > 0.08
        ? desiredSpeed * 0.72
        : desiredSpeed;

    a.speed = actualSpeed;
    a.pos.x = Math.max(
      -WORLD_HALF + 2,
      Math.min(WORLD_HALF - 2, a.pos.x + Math.sin(a.yaw) * actualSpeed * simDt)
    );
    a.pos.z = Math.max(
      -WORLD_HALF + 2,
      Math.min(WORLD_HALF - 2, a.pos.z + Math.cos(a.yaw) * actualSpeed * simDt)
    );

    // 3. Hard circle-circle collision resolution (never clip into trees or boulders!)
    this.resolveStaticCollisions(a);

    const groundY = getTerrainHeight(a.pos.x, a.pos.z);
    const waterY = getWaterLevel(this.season.wetness);
    a.pos.y = a.isSwimming ? Math.max(groundY, waterY - 0.35) : groundY;
  }

  private resolveStaticCollisions(a: SimAnimal): void {
    const cfg = SPECIES_CONFIGS[a.species];
    const myR = cfg.adultRadius * (a.stage === 'juvenile' ? 0.55 : 0.88);
    const nearby = this.colliderGrid.query(a.pos.x, a.pos.z, myR + 4.5);

    for (let i = 0; i < nearby.length; i++) {
      const c = nearby[i];
      const dx = a.pos.x - c.x;
      const dz = a.pos.z - c.z;
      const dist = Math.hypot(dx, dz);
      const minD = myR + c.radius;
      if (dist < minD) {
        const push = minD - dist;
        const nx = dist > 0.001 ? dx / dist : 1;
        const nz = dist > 0.001 ? dz / dist : 0;
        a.pos.x += nx * push;
        a.pos.z += nz * push;
      }
    }
  }

  private computeHerdSeparationAndCohesion(a: SimAnimal, neighbors: SimAnimal[]): Vec3 {
    const steer = { x: 0, y: 0, z: 0 };
    const myR = SPECIES_CONFIGS[a.species].adultRadius;
    for (let i = 0; i < neighbors.length; i++) {
      const o = neighbors[i];
      if (o.id === a.id || o.species === 'vulture') continue;
      const dist = Math.hypot(a.pos.x - o.pos.x, a.pos.z - o.pos.z);
      const minSep = myR + SPECIES_CONFIGS[o.species].adultRadius + 1.2;
      if (dist > 0.01 && dist < minSep) {
        steer.x += ((a.pos.x - o.pos.x) / dist) * 1.4;
        steer.z += ((a.pos.z - o.pos.z) / dist) * 1.4;
      } else if (o.species === a.species && o.groupId === a.groupId && dist > 12 && dist < 30) {
        steer.x += ((o.pos.x - a.pos.x) / dist) * 0.25;
        steer.z += ((o.pos.z - a.pos.z) / dist) * 0.25;
      }
    }
    return steer;
  }

  private findNearestThreat(a: SimAnimal, neighbors: SimAnimal[]): SimAnimal | null {
    const isJuvPredator =
      (a.species === 'lion' || a.species === 'tiger') && a.stage === 'juvenile';
    let best: SimAnimal | null = null;
    let bestDist = Infinity;

    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      if (!n.alive || n.species === a.species) continue;
      const isPredator = n.species === 'lion' || n.species === 'tiger';
      const isChargingGiant =
        (n.species === 'elephant' || n.species === 'hippo') && n.state === 'defending';

      if (isJuvPredator && !isChargingGiant && !isPredator) continue;
      if (!isPredator && !isChargingGiant) continue;
      if (isPredator && n.stage === 'juvenile') continue;

      const dist = dist3(a.pos, n.pos);
      const alertRange =
        n.state === 'chasing' || n.state === 'defending'
          ? 24
          : n.state === 'stalking'
            ? 14
            : a.species === 'elephant' || a.species === 'hippo'
              ? 12
              : 15;

      if (dist < alertRange && dist < bestDist) {
        bestDist = dist;
        best = n;
      }
    }
    return best;
  }

  private findBestPrey(predator: SimAnimal, neighbors: SimAnimal[]): SimAnimal | null {
    let best: SimAnimal | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      if (!n.alive || n.species === predator.species) continue;
      if (n.species === 'vulture' || n.species === 'lion' || n.species === 'tiger') continue;

      const dist = dist3(predator.pos, n.pos);
      let score = 40 - dist;

      if (n.species === 'zebra' || n.species === 'antelope' || n.species === 'deer' || n.species === 'boar') {
        score += 32;
      } else if (n.species === 'giraffe') {
        if (predator.hunger > 38 && n.stage !== 'juvenile') continue;
        score += n.stage === 'juvenile' ? 14 : -8;
      } else if (n.species === 'elephant' || n.species === 'hippo') {
        if (n.stage !== 'juvenile' && predator.hunger > 15) continue;
        const guarded = neighbors.some(
          (g) => g.species === n.species && g.stage !== 'juvenile' && dist3(g.pos, n.pos) < 12
        );
        if (guarded && predator.hunger > 22) continue;
        score += 5;
      }

      if (n.stage === 'juvenile') score += 10;
      if (n.health < 65) score += 14;
      if (predator.species === 'lion' && getWaterDepth(n.pos.x, n.pos.z, this.season.wetness) > 0.48) {
        score -= 50;
      }

      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return bestScore > 10 ? best : null;
  }

  private findGuardian(juv: SimAnimal, neighbors: SimAnimal[]): SimAnimal | null {
    if (juv.motherId !== null) {
      const mom = this.getAnimalById(juv.motherId);
      if (mom) return mom;
    }
    let best: SimAnimal | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      if (n.species === juv.species && n.stage !== 'juvenile' && n.groupId === juv.groupId) {
        const d = dist3(juv.pos, n.pos);
        if (d < bestDist) {
          bestDist = d;
          best = n;
        }
      }
    }
    return best;
  }

  private enterDefend(a: SimAnimal, threat: SimAnimal, text: string): void {
    const wasDefending = a.state === 'defending';
    a.state = 'defending';
    a.threatAnimalId = threat.id;
    a.statusText = text;
    a.stateTimer = 5.5;
    if (!wasDefending && SPECIES_CONFIGS[a.species].isMainFive && Math.random() < 0.55) {
      this.pushEvent(
        SPECIES_CONFIGS[a.species].emoji,
        `${getSpeciesTitleRu(a.species, a.sex)} ${a.name}: ${text.toLowerCase()}`,
        a.pos,
        2
      );
    }
  }

  private handlePredatorKill(predator: SimAnimal, prey: SimAnimal): void {
    const pCfg = SPECIES_CONFIGS[predator.species];
    const vCfg = SPECIES_CONFIGS[prey.species];

    this.killAnimal(prey);
    predator.state = 'feeding';
    predator.targetAnimalId = null;
    predator.statusText = 'Питается добычей';
    predator.stateTimer = 14;

    const latestCarcass = this.carcasses[this.carcasses.length - 1];
    if (latestCarcass) {
      predator.targetCarcassId = latestCarcass.id;
      predator.targetPos = { ...latestCarcass.pos };
    }

    this.pushEvent(
      pCfg.emoji,
      `${getSpeciesTitleRu(predator.species, predator.sex)} ${predator.name} поймал добычу (${vCfg.nameRu.toLowerCase()})`,
      prey.pos,
      vCfg.isMainFive ? 3 : 2
    );
  }

  private killAnimal(a: SimAnimal): void {
    if (!a.alive) return;
    a.alive = false;
    this.pendingRemoved.push(a.id);
    this.lastBroadcastStatuses.delete(a.id);

    if (a.species !== 'vulture') {
      const meat =
        a.species === 'elephant'
          ? 95
          : a.species === 'hippo'
            ? 80
            : a.species === 'giraffe'
              ? 70
              : a.species === 'zebra'
                ? 42
                : 30;
      const y = getTerrainHeight(a.pos.x, a.pos.z);
      this.carcasses.push({
        id: this.nextCarcassId++,
        species: a.species,
        pos: { x: a.pos.x, y, z: a.pos.z },
        yaw: a.yaw,
        isJuvenile: a.stage === 'juvenile',
        meatRemaining: meat,
        maxMeat: meat,
        ageSeconds: 0,
      });
    }
  }

  private updateCarcasses(simDt: number): void {
    for (let i = this.carcasses.length - 1; i >= 0; i--) {
      const c = this.carcasses[i];
      c.ageSeconds += simDt;
      c.meatRemaining = Math.max(0, c.meatRemaining - simDt * 0.25);
      if (c.meatRemaining <= 0.1 || c.ageSeconds > 160) {
        this.carcasses.splice(i, 1);
      }
    }
  }

  private getCarcass(id: number | null): SimCarcass | null {
    if (id === null) return null;
    for (let i = 0; i < this.carcasses.length; i++) {
      if (this.carcasses[i].id === id) return this.carcasses[i];
    }
    return null;
  }

  private findNearestCarcass(pos: Vec3, maxDist: number): SimCarcass | null {
    let best: SimCarcass | null = null;
    let bestD = maxDist;
    for (let i = 0; i < this.carcasses.length; i++) {
      const c = this.carcasses[i];
      if (c.meatRemaining <= 2) continue;
      const d = Math.hypot(pos.x - c.pos.x, pos.z - c.pos.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private findNearestWaterTarget(a: SimAnimal): Vec3 | null {
    const cx = getRiverCenterX(a.pos.z);
    const hw = getRiverHalfWidth(a.pos.z);
    const side = a.pos.x < cx ? -1 : 1;
    let best: Vec3 = { x: cx + side * (hw - 0.8), y: 0, z: a.pos.z + (Math.random() - 0.5) * 8 };
    let bestDist = dist3(a.pos, best);

    if (a.pos.x < cx) {
      for (const hole of WATERING_HOLES) {
        if (getWaterDepth(hole.x, hole.z, this.season.wetness) < 0.16) continue;
        const ang = Math.atan2(a.pos.z - hole.z, a.pos.x - hole.x);
        const edgeDist = hole.radius * (0.45 + this.season.wetness * 0.42);
        const pt: Vec3 = {
          x: hole.x + Math.cos(ang) * edgeDist,
          y: 0,
          z: hole.z + Math.sin(ang) * edgeDist,
        };
        const d = dist3(a.pos, pt);
        if (d < bestDist) {
          bestDist = d;
          best = pt;
        }
      }
    }
    return best;
  }

  /** Dry bank shore spot strictly outside water for vultures! */
  private findDryShoreDrinkPoint(a: SimAnimal): Vec3 | null {
    const cx = getRiverCenterX(a.pos.z);
    const hw = getRiverHalfWidth(a.pos.z);
    const side = a.pos.x < cx ? -1 : 1;
    const z = Math.max(-96, Math.min(96, a.pos.z));
    // Step outward until depth === 0
    for (let offset = hw - 2; offset <= hw + 10; offset += 0.8) {
      const x = getRiverCenterX(z) + side * offset;
      if (getWaterDepth(x, z, this.season.wetness) <= 0.01) {
        return { x, y: getTerrainHeight(x, z), z };
      }
    }
    return { x: cx + side * (hw + 4), y: getTerrainHeight(cx + side * (hw + 4), z), z };
  }

  private findNearestSnagTree(pos: Vec3): TreeNode | null {
    let best: TreeNode | null = null;
    let bestD = Infinity;
    for (const t of this.trees) {
      if (t.kind !== 'snag') continue;
      const d = Math.hypot(pos.x - t.x, pos.z - t.z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private findNearestRiverPool(pos: Vec3): Vec3 {
    const targetZ = Math.abs(pos.z + 24) < Math.abs(pos.z - 38) ? -24 : 38;
    const z = pos.z + (targetZ - pos.z) * 0.35 + (Math.random() - 0.5) * 10;
    const cx = getRiverCenterX(z);
    return { x: cx + (Math.random() - 0.5) * 8, y: 0, z };
  }

  private findCoolingShoreSpot(a: SimAnimal): Vec3 {
    const z = Math.max(-95, Math.min(95, a.pos.z + (Math.random() - 0.5) * 14));
    const cx = getRiverCenterX(z);
    const hw = getRiverHalfWidth(z);
    const side = a.pos.x < cx ? -1 : 1;
    return { x: cx + side * (hw - 1.8), y: 0, z };
  }

  private findBankGrazingSpot(pos: Vec3): Vec3 {
    const z = Math.max(-98, Math.min(98, pos.z + (Math.random() - 0.5) * 24));
    const cx = getRiverCenterX(z);
    const hw = getRiverHalfWidth(z);
    const side = pos.x < cx ? -1 : 1;
    return { x: cx + side * (hw + 6 + Math.random() * 14), y: 0, z };
  }

  private findShadeSpot(a: SimAnimal): Vec3 {
    if (a.species === 'lion') {
      let bestK = this.kopjes[0];
      let bestD = Infinity;
      for (const k of this.kopjes) {
        const d = Math.hypot(a.pos.x - k.x, a.pos.z - k.z);
        if (d < bestD) {
          bestD = d;
          bestK = k;
        }
      }
      if (bestD < 48) {
        return {
          x: bestK.x + (Math.random() - 0.5) * 9,
          y: 0,
          z: bestK.z + (Math.random() - 0.5) * 9,
        };
      }
    }

    let bestTree: TreeNode | null = null;
    let bestD = Infinity;
    for (const t of this.trees) {
      if (t.kind === 'bush' || t.kind === 'snag') continue;
      const d = Math.hypot(a.pos.x - t.x, a.pos.z - t.z);
      if (d < bestD) {
        bestD = d;
        bestTree = t;
      }
    }
    if (bestTree) {
      const ang = Math.random() * Math.PI * 2;
      const r = bestTree.trunkRadius + 2.2;
      return { x: bestTree.x + Math.cos(ang) * r, y: 0, z: bestTree.z + Math.sin(ang) * r };
    }
    return { ...a.pos };
  }

  private findNearestFoodTree(pos: Vec3, preferAcacia: boolean): number | null {
    let bestIdx: number | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      if (t.kind === 'bush' || t.kind === 'snag' || t.foliage < 0.25) continue;
      if (preferAcacia && t.kind === 'palm') continue;
      const d = Math.hypot(pos.x - t.x, pos.z - t.z);
      if (d > 62) continue;
      const score = t.foliage * 25 - d + (preferAcacia && t.kind === 'acacia' ? 14 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  private findGrazingSpot(a: SimAnimal): Vec3 {
    const cfg = SPECIES_CONFIGS[a.species];
    let best = { ...a.pos };
    let bestScore = -1;
    for (let i = 0; i < 6; i++) {
      const rx = Math.max(-WORLD_HALF + 8, Math.min(WORLD_HALF - 8, a.pos.x + (Math.random() - 0.5) * 32));
      const rz = Math.max(-WORLD_HALF + 8, Math.min(WORLD_HALF - 8, a.pos.z + (Math.random() - 0.5) * 32));
      const cx = getRiverCenterX(rz);
      if (cfg.homeBiome === 'savanna' && rx > cx - 6) continue;
      if (cfg.homeBiome === 'jungle' && rx < cx + 6) continue;
      if (getWaterDepth(rx, rz, this.season.wetness) > 0.05) continue;
      const density = getGrassDensity(rx, rz, this.season.wetness);
      if (density > bestScore) {
        bestScore = density;
        best = { x: rx, y: 0, z: rz };
      }
    }
    return best;
  }

  private pickWanderPoint(a: SimAnimal, neighbors: SimAnimal[]): Vec3 {
    const cfg = SPECIES_CONFIGS[a.species];
    if (a.species !== 'elephant' && a.species !== 'tiger') {
      const peer = neighbors.find((n) => n.species === a.species && n.groupId === a.groupId && n.id !== a.id);
      if (peer && dist3(a.pos, peer.pos) > 22) {
        return {
          x: peer.pos.x + (Math.random() - 0.5) * 6,
          y: 0,
          z: peer.pos.z + (Math.random() - 0.5) * 6,
        };
      }
    }

    for (let i = 0; i < 8; i++) {
      const rx = Math.max(-WORLD_HALF + 10, Math.min(WORLD_HALF - 10, a.pos.x + (Math.random() - 0.5) * 44));
      const rz = Math.max(-WORLD_HALF + 10, Math.min(WORLD_HALF - 10, a.pos.z + (Math.random() - 0.5) * 44));
      const cx = getRiverCenterX(rz);
      if (cfg.homeBiome === 'savanna' && rx > cx - 10) continue;
      if (cfg.homeBiome === 'jungle' && rx < cx + 10) continue;
      if (cfg.avoidsDeepWater && getWaterDepth(rx, rz, this.season.wetness) > cfg.maxWaterDepth) continue;
      return { x: rx, y: 0, z: rz };
    }
    return { ...a.homeCenter };
  }

  private checkNaturalMigration(counts: Record<SpeciesId, number>): void {
    let spawned = 0;
    for (const sp of SPECIES_ORDER) {
      const cfg = SPECIES_CONFIGS[sp];
      if (counts[sp] < cfg.minCap) {
        const z = (Math.random() - 0.5) * 160;
        const cx = getRiverCenterX(z);
        const x =
          cfg.homeBiome === 'savanna'
            ? -WORLD_HALF + 8
            : cfg.homeBiome === 'jungle'
              ? WORLD_HALF - 8
              : cx;
        const sex: Sex = Math.random() < 0.5 ? 'M' : 'F';
        const migrant = this.spawnAnimal(sp, x, z, sex, 'adult', Math.floor(Math.random() * 5) + 100);
        if (cfg.isMainFive) {
          this.pushEvent(
            cfg.emoji,
            `Из соседней долины пришёл ${getSpeciesTitleRu(sp, sex).toLowerCase()} ${migrant.name}`,
            migrant.pos,
            2
          );
        }
        spawned++;
        if (spawned >= 2) break;
      }
    }
  }

  private getIdleStatusRu(species: SpeciesId): string {
    switch (species) {
      case 'elephant':
        return 'Неспешно шествует со стадом';
      case 'lion':
        return 'Патрулирует саванну';
      case 'tiger':
        return 'Бесшумно обходит джунгли';
      case 'giraffe':
        return 'Оглядывает равнину свысока';
      case 'hippo':
        return 'Погружён в речные воды';
      case 'zebra':
      case 'antelope':
        return 'Бредёт по золотой траве';
      case 'deer':
      case 'boar':
        return 'Бродит в тени подлеска';
      case 'vulture':
        return 'Парит высоко над долиной';
    }
  }

  private pushEvent(icon: string, text: string, pos: Vec3, importance: number): void {
    const ev: WorldEvent = {
      id: this.nextEventId++,
      icon,
      text,
      x: Number(pos.x.toFixed(1)),
      y: Number(pos.y.toFixed(1)),
      z: Number(pos.z.toFixed(1)),
      importance,
      createdAtMs: Date.now(),
    };
    this.events.unshift(ev);
    if (this.events.length > 24) this.events.length = 24;
    this.pendingEvents.push(ev);
  }
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
