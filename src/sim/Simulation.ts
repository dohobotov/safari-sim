import * as THREE from 'three';
import { Soundscape } from '../audio/Soundscape';
import { animateAnimalRig, createAnimalRig } from '../entities/AnimalMeshFactory';
import {
  SPECIES_CONFIGS,
  SPECIES_ORDER,
  getSpeciesTitleRu,
  pickAnimalName,
} from '../entities/SpeciesData';
import type {
  Animal,
  Carcass,
  SeasonState,
  Sex,
  SpeciesId,
  TimeState,
  TreeNode,
  WorldEvent,
} from '../types';
import { Atmosphere } from '../world/Atmosphere';
import {
  FORDS,
  WATERING_HOLES,
  WORLD_HALF,
  findNearestFordPoint,
  getBiome,
  getGrassDensity,
  getRiverCenterX,
  getRiverHalfWidth,
  getTerrainHeight,
  getWaterDepth,
  getWaterLevel,
} from '../world/TerrainMath';
import { SpatialHash } from './SpatialHash';

const DAY_REAL_SECONDS = 180; // 3 real minutes = 1 full day at 1x speed
const SEASON_CYCLE_DAYS = 4; // 12 real minutes per wet-dry cycle at 1x speed

export class Simulation {
  public readonly animals: Animal[] = [];
  public readonly carcasses: Carcass[] = [];
  public readonly events: WorldEvent[] = [];

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
  private migrationCheckTimer = 6;
  private foliageRegenTimer = 0;
  private prevWetSeasonFlag = true;

  private readonly spatial = new SpatialHash(20);
  private readonly animalRootGroup = new THREE.Group();
  private readonly carcassGroup = new THREE.Group();
  private readonly trees: TreeNode[];
  private readonly kopjes: THREE.Vector3[];
  private readonly atmosphere: Atmosphere;
  private readonly soundscape: Soundscape;

  private cameraTargetRef = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    trees: TreeNode[],
    kopjes: THREE.Vector3[],
    atmosphere: Atmosphere,
    soundscape: Soundscape
  ) {
    this.trees = trees;
    this.kopjes = kopjes;
    this.atmosphere = atmosphere;
    this.soundscape = soundscape;

    scene.add(this.animalRootGroup);
    scene.add(this.carcassGroup);

    this.populateInitialValley();
    this.updateTimeAndSeason(0);
  }

  public setCameraTarget(target: THREE.Vector3): void {
    this.cameraTargetRef.copy(target);
  }

  private populateInitialValley(): void {
    // 1. Elephants (7: 1 matriarch herd of 5 + 2 roaming bulls)
    this.spawnGroup('elephant', -64, -28, 5, 1, 2);
    this.spawnAnimal('elephant', -68, 38, 'M', 'adult', 2);
    this.spawnAnimal('elephant', -36, 62, 'M', 'adult', 3);

    // 2. Lions (8: 1 savanna pride near central kopje + 1 nomadic male)
    this.spawnAnimal('lion', -47, -9, 'M', 'adult', 10);
    for (let i = 0; i < 4; i++) {
      this.spawnAnimal('lion', -49 + (i - 1.5) * 3, -6 + (i % 2) * 3, 'F', 'adult', 10);
    }
    this.spawnAnimal('lion', -46, -11, 'F', 'juvenile', 10);
    this.spawnAnimal('lion', -50, -10, 'M', 'juvenile', 10);
    this.spawnAnimal('lion', -74, -58, 'M', 'adult', 11);

    // 3. Tigers (4: solitary territories across jungle side)
    this.spawnAnimal('tiger', 52, -60, 'M', 'adult', 20);
    this.spawnAnimal('tiger', 44, 6, 'F', 'adult', 21);
    this.spawnAnimal('tiger', 47, 11, 'M', 'juvenile', 21);
    this.spawnAnimal('tiger', 56, 64, 'M', 'adult', 22);

    // 4. Giraffes (8: 2 savanna towers)
    this.spawnGroup('giraffe', -56, -46, 4, 30, 1);
    this.spawnGroup('giraffe', -48, 44, 4, 31, 1);

    // 5. Hippos (10: 2 pods directly inside wide river lagoons)
    const hippoZ1 = -24;
    const hippoX1 = getRiverCenterX(hippoZ1);
    this.spawnGroup('hippo', hippoX1, hippoZ1, 5, 40, 1);

    const hippoZ2 = 38;
    const hippoX2 = getRiverCenterX(hippoZ2);
    this.spawnGroup('hippo', hippoX2, hippoZ2, 5, 41, 1);

    // 6. Zebras (19: 2 savanna herds)
    this.spawnGroup('zebra', -32, -38, 10, 50, 2);
    this.spawnGroup('zebra', -60, 32, 9, 51, 2);

    // 7. Antelopes (19: 3 savanna herds)
    this.spawnGroup('antelope', -38, 12, 7, 60, 1);
    this.spawnGroup('antelope', -76, -16, 6, 61, 1);
    this.spawnGroup('antelope', -34, -76, 6, 62, 1);

    // 8. Jungle Deer (12: 3 jungle groups)
    this.spawnGroup('deer', 36, -34, 4, 70, 1);
    this.spawnGroup('deer', 54, 30, 4, 71, 1);
    this.spawnGroup('deer', 32, 72, 4, 72, 1);

    // 9. Wild Boars (9: 3 sounders in jungle thickets)
    this.spawnGroup('boar', 68, -22, 3, 80, 1);
    this.spawnGroup('boar', 42, -74, 3, 81, 1);
    this.spawnGroup('boar', 64, 46, 3, 82, 1);

    // 10. Vultures (7: soaring overhead)
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
      'Рассвет над долиной: стада выходят на пастбища, хищники начинают обход',
      new THREE.Vector3(0, 0, 0),
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
      const dist = i === 0 ? 0 : 2.5 + Math.random() * 5.5;
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
  ): Animal {
    const cfg = SPECIES_CONFIGS[species];
    const id = this.nextAnimalId++;
    const name = pickAnimalName(species, sex, id);

    const rig = createAnimalRig(species, sex);
    rig.root.userData.animalId = id;
    rig.root.traverse((obj) => {
      obj.userData.animalId = id;
    });

    const ageDays =
      stage === 'juvenile'
        ? cfg.lifespanDays * (0.04 + Math.random() * 0.1)
        : cfg.lifespanDays * (0.28 + Math.random() * 0.42);

    const clampedX = Math.max(-WORLD_HALF + 2, Math.min(WORLD_HALF - 2, x));
    const clampedZ = Math.max(-WORLD_HALF + 2, Math.min(WORLD_HALF - 2, z));
    const y = getTerrainHeight(clampedX, clampedZ);
    const soarHeight = species === 'vulture' ? 18 + Math.random() * 12 : 0;

    const animal: Animal = {
      id,
      species,
      name,
      sex,
      ageDays,
      maxAgeDays: cfg.lifespanDays * (0.88 + Math.random() * 0.24),
      stage,
      groupId,
      motherId,

      pos: new THREE.Vector3(clampedX, species === 'vulture' ? y + soarHeight : y, clampedZ),
      vel: new THREE.Vector3(),
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
      homeCenter: new THREE.Vector3(clampedX, 0, clampedZ),

      gaitPhase: Math.random() * Math.PI * 2,
      restBlend: 0,
      drinkBlend: 0,
      browseBlend: 0,
      stalkBlend: 0,
      swimBlend: 0,
      soarHeight,
      soarAngle: Math.random() * Math.PI * 2,

      rig,
      alive: true,
    };

    rig.root.position.copy(animal.pos);
    rig.root.rotation.y = animal.yaw;
    this.animalRootGroup.add(rig.root);
    this.animals.push(animal);
    return animal;
  }

  public getAnimalById(id: number | null): Animal | null {
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

  public step(realDt: number, timeSpeed: number, realTime: number): void {
    const simRealDt = Math.min(0.1, realDt) * timeSpeed;
    if (simRealDt <= 0) {
      // Even when paused, gently update nothing or subtle idle? Let's freeze simulation cleanly on pause.
      return;
    }

    const simDaysDt = simRealDt / DAY_REAL_SECONDS;
    this.updateTimeAndSeason(simDaysDt, simRealDt);

    // Rebuild spatial grid
    this.spatial.clear();
    for (let i = 0; i < this.animals.length; i++) {
      if (this.animals[i].alive) this.spatial.insert(this.animals[i]);
    }

    // Regenerate tree foliage gradually (faster in wet season)
    this.foliageRegenTimer += simRealDt;
    if (this.foliageRegenTimer > 2.5) {
      const regen = (0.015 + this.season.wetness * 0.04) * (this.foliageRegenTimer / 2.5);
      for (let i = 0; i < this.trees.length; i++) {
        this.trees[i].foliage = Math.min(1, this.trees[i].foliage + regen);
      }
      this.foliageRegenTimer = 0;
    }

    // Update all animals
    const counts = this.getSpeciesCounts();
    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i];
      if (!a.alive) continue;
      this.updateAnimal(a, simRealDt, simDaysDt, realDt, realTime, counts);
    }

    // Update carcasses & clean expired
    this.updateCarcasses(simRealDt);

    // Check migration safeguard so ecosystem never empties
    this.migrationCheckTimer -= simRealDt;
    if (this.migrationCheckTimer <= 0) {
      this.migrationCheckTimer = 14;
      this.checkNaturalMigration(counts);
    }

    // Prune dead animal objects cleanly
    for (let i = this.animals.length - 1; i >= 0; i--) {
      if (!this.animals[i].alive) {
        this.animals.splice(i, 1);
      }
    }
  }

  private updateTimeAndSeason(simDaysDt: number, simRealDt = 0): void {
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

    // Temperature peaks ~14:00 (tod ~ 0.58), lowest ~04:00
    const sunCurve = Math.sin((tod - 0.32) * Math.PI * 2) * 0.5 + 0.5;
    const seasonHeatBoost = (1 - this.season.wetness) * 0.16;
    const rainCool = this.season.rainIntensity * 0.25;
    const temperature = Math.max(0.08, Math.min(1, sunCurve * 0.85 + seasonHeatBoost - rainCool));

    this.timeState = {
      day,
      timeOfDay: tod,
      hour,
      minute,
      phaseNameRu,
      temperature,
    };

    // Season cycle
    const progress = (this.totalSimDays / SEASON_CYCLE_DAYS) % 1;
    const wetness = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2);
    const isDrySeason = wetness < 0.48;

    if (isDrySeason && this.prevWetSeasonFlag) {
      this.prevWetSeasonFlag = false;
      this.pushEvent(
        '☀️',
        'Наступает сухой сезон: река мелеет и открываются широкие броды',
        new THREE.Vector3(getRiverCenterX(8), 0, 8),
        2
      );
    } else if (!isDrySeason && !this.prevWetSeasonFlag) {
      this.prevWetSeasonFlag = true;
      this.pushEvent(
        '🌧️',
        'Приходит сезон дождей: долина зеленеет, водопои наполняются водой',
        new THREE.Vector3(-60, 0, 15),
        2
      );
    }

    // Dynamic rainfall during wet / transitional seasons
    if (simRealDt > 0) {
      if (this.rainRemaining > 0) {
        this.rainRemaining -= simRealDt;
        this.season.rainIntensity = Math.min(1, this.season.rainIntensity + simRealDt * 0.25);
      } else {
        this.season.rainIntensity = Math.max(0, this.season.rainIntensity - simRealDt * 0.22);
        this.rainCooldown -= simRealDt * (0.4 + wetness * 1.1);
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
    let weatherTextRu = '';
    if (isRaining) {
      weatherTextRu = 'Тропический ливень';
    } else if (isDrySeason) {
      weatherTextRu = wetness < 0.25 ? 'Засуха · Броды открыты' : 'Жарко · Река мелеет';
    } else {
      weatherTextRu = 'Тепло · Полноводная река';
    }

    this.season.progress = progress;
    this.season.wetness = wetness;
    this.season.isDrySeason = isDrySeason;
    this.season.isRaining = isRaining;
    this.season.seasonNameRu = seasonNameRu;
    this.season.weatherTextRu = weatherTextRu;
  }

  private updateAnimal(
    a: Animal,
    simDt: number,
    simDaysDt: number,
    realDt: number,
    realTime: number,
    counts: Record<SpeciesId, number>
  ): void {
    const cfg = SPECIES_CONFIGS[a.species];

    // 1. Aging & Lifecycle
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
      this.killAnimal(a, 'от старости');
      return;
    }

    // 2. Physiology ticks
    const activeFactor =
      a.state === 'chasing' || a.state === 'fleeing' || a.state === 'defending'
        ? 2.2
        : a.state === 'resting'
          ? 0.45
          : 1.0;

    a.hunger = Math.max(0, a.hunger - simDt * 0.42 * activeFactor);
    const heatThirstMult = 0.75 + this.timeState.temperature * 0.9 + (1 - this.season.wetness) * 0.35;
    a.thirst = Math.max(0, a.thirst - simDt * 0.46 * heatThirstMult);

    if (a.state === 'resting') {
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
        this.killAnimal(a, a.thirst <= 2 ? 'от обезвоживания' : 'от голода');
        return;
      }
    }

    if (a.reproCooldown > 0) a.reproCooldown = Math.max(0, a.reproCooldown - simDaysDt);
    if (a.attackCooldown > 0) a.attackCooldown = Math.max(0, a.attackCooldown - simDt);
    if (a.yawnTimer > 0) a.yawnTimer = Math.max(0, a.yawnTimer - simDt);

    // Periodic ambient animal calls
    a.callCooldown -= simDt;
    if (a.callCooldown <= 0) {
      a.callCooldown = 14 + Math.random() * 26;
      if (
        (a.species === 'lion' && (this.timeState.hour < 7 || this.timeState.hour > 17)) ||
        (a.species === 'elephant' && a.state === 'defending') ||
        (a.species === 'hippo' && a.isSwimming) ||
        (a.species === 'tiger' && a.state === 'chasing')
      ) {
        this.soundscape.playAnimalCall(a.species, a.pos, this.cameraTargetRef);
      }
    }

    // 3. Decision making
    a.stateTimer -= simDt;
    a.decisionCooldown -= simDt;

    const neighbors = this.spatial.query(a.pos.x, a.pos.z, cfg.visionRange);

    if (a.decisionCooldown <= 0) {
      a.decisionCooldown =
        a.state === 'chasing' || a.state === 'fleeing' || a.state === 'defending' ? 0.25 : 0.75 + Math.random() * 0.45;
      this.decideBehavior(a, neighbors, counts);
    }

    // 4. Execute movement & state action
    this.executeState(a, simDt, neighbors, counts);

    // 5. Animate 3D mesh
    const waterDepth = a.species === 'vulture' ? 0 : getWaterDepth(a.pos.x, a.pos.z, this.season.wetness);
    animateAnimalRig(a, realDt, simDt, realTime, waterDepth);
  }

  private decideBehavior(
    a: Animal,
    neighbors: Animal[],
    counts: Record<SpeciesId, number>
  ): void {
    const cfg = SPECIES_CONFIGS[a.species];

    // Vultures have specialized aerial/scavenger logic
    if (a.species === 'vulture') {
      this.decideVultureBehavior(a, neighbors);
      return;
    }

    // 1. Check immediate predators / threats for herbivores & juveniles
    if (cfg.diet !== 'carnivore' || a.stage === 'juvenile') {
      const threat = this.findNearestThreat(a, neighbors);
      if (threat) {
        // Adult elephants & adult hippos & adult giraffes (if cornered) defend!
        const dist = a.pos.distanceTo(threat.pos);
        if (a.species === 'elephant' && a.stage !== 'juvenile') {
          const nearCalf = neighbors.some(
            (n) => n.species === 'elephant' && n.stage === 'juvenile' && n.pos.distanceTo(threat.pos) < 12
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

    // 2. Territorial defense for Hippos near water & Lions/Tigers
    if (a.species === 'hippo' && a.stage !== 'juvenile') {
      const intruder = neighbors.find(
        (n) =>
          (n.species === 'lion' || n.species === 'tiger') &&
          a.pos.distanceTo(n.pos) < 12 &&
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
          ((n.species === 'tiger' && a.pos.distanceTo(n.pos) < 16) ||
            (n.species === 'lion' && n.sex === 'M' && n.groupId !== a.groupId && a.pos.distanceTo(n.pos) < 16))
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
          a.pos.distanceTo(n.pos) < 17
      );
      if (rivalTiger) {
        this.enterDefend(a, rivalTiger, 'Прогоняет чужака со своей территории');
        return;
      }
    }

    // Keep ongoing critical actions until finished or timed out
    if (
      (a.state === 'drinking' && a.thirst < 92) ||
      (a.state === 'feeding' && a.hunger < 92 && this.getCarcass(a.targetCarcassId)) ||
      (a.state === 'grazing' && a.hunger < 82 && a.stateTimer > 0) ||
      (a.state === 'browsing' && a.hunger < 82 && a.stateTimer > 0) ||
      (a.state === 'courting' && a.stateTimer > 0)
    ) {
      return;
    }

    // 3. Juvenile follows mother or herd adult
    if (a.stage === 'juvenile') {
      const guardian = this.findGuardian(a, neighbors);
      if (guardian && a.pos.distanceTo(guardian.pos) > 5.5) {
        a.state = 'following';
        a.targetAnimalId = guardian.id;
        a.statusText = 'Держится рядом со взрослыми';
        a.stateTimer = 3;
        return;
      }
    }

    // 4. Urgent Thirst
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
      const riverPt = this.findNearestRiverPool(a.pos);
      a.state = 'cooling';
      a.targetPos = riverPt;
      a.statusText = 'Возвращается в речную лагуну';
      a.stateTimer = 14;
      return;
    }

    // 5. Hippo strict circadian rhythm: River by day, Grazing meadows by night!
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
        const grazePt = this.findBankGrazingSpot(a.pos);
        a.state = 'grazing';
        a.targetPos = grazePt;
        a.statusText = 'Выходит на ночной выпас';
        a.stateTimer = 11;
        return;
      }
    }

    // 6. Predator hunting & scavenging
    if (cfg.diet === 'carnivore') {
      const carcass = this.findNearestCarcass(a.pos, 42);
      if (carcass && a.hunger < 84) {
        a.state = 'feeding';
        a.targetCarcassId = carcass.id;
        a.targetPos = carcass.pos.clone();
        a.statusText = 'Питается добычей';
        a.stateTimer = 10;
        return;
      }

      // Join ongoing hunt or start new hunt
      const isPrimeHuntHour =
        this.timeState.hour < 8.5 || this.timeState.hour > 16.8 || a.hunger < 42;
      if (a.stage !== 'juvenile' && a.hunger < (isPrimeHuntHour ? 72 : 52) && a.energy > 28) {
        // Lions coordinate with pride mates
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
          const dist = a.pos.distanceTo(prey.pos);
          a.state = dist < 15 ? 'chasing' : 'stalking';
          a.targetAnimalId = prey.id;
          a.statusText = a.state === 'stalking' ? 'Крадётся к добыче' : 'Преследует добычу!';
          a.stateTimer = 11;
          return;
        }
      }
    }

    // 7. Midday heat resting / cooling
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
      a.statusText = a.species === 'lion' ? 'Спит в тени на скалах' : 'Отдыхает в тени от зноя';
      a.stateTimer = 10 + Math.random() * 6;
      return;
    }

    // Low energy resting at any time
    if (a.energy < 25) {
      a.state = 'resting';
      a.targetPos = this.findShadeSpot(a);
      a.statusText = 'Восстанавливает силы';
      a.stateTimer = 9;
      return;
    }

    // 8. Herbivore Hunger (Browsing tall trees vs Grazing grass)
    if (cfg.diet === 'browser' && a.hunger < 74) {
      const treeIdx = this.findNearestFoodTree(a.pos, a.species === 'giraffe');
      if (treeIdx !== null) {
        a.state = 'browsing';
        a.targetTreeIdx = treeIdx;
        const tree = this.trees[treeIdx];
        a.targetPos = new THREE.Vector3(tree.x, tree.y, tree.z);
        a.statusText =
          a.species === 'giraffe' ? 'Объедает крону акации' : 'Срывает ветви хоботом';
        a.stateTimer = 9;
        return;
      }
    }

    if ((cfg.diet === 'grazer' || cfg.diet === 'omnivore' || cfg.diet === 'browser') && a.hunger < 74) {
      a.state = 'grazing';
      a.targetPos = this.findGrazingSpot(a);
      a.statusText = 'Щиплет траву на пастбище';
      a.stateTimer = 9;
      return;
    }

    // 9. Reproduction / Courting when healthy & below cap
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
          a.pos.distanceTo(n.pos) < 18
      );
      if (mate) {
        a.state = 'courting';
        a.targetAnimalId = mate.id;
        a.statusText = 'Брачное ухаживание';
        a.stateTimer = 4.5;
        return;
      }
    }

    // 10. Occasional ford crossing / wandering in home biome
    if (a.stateTimer <= 0 || a.targetPos === null || a.pos.distanceTo(a.targetPos) < 3) {
      // Dry season ford migration chance for elephants, zebras, giraffes, tigers
      if (
        this.season.wetness < 0.48 &&
        (a.species === 'elephant' || a.species === 'zebra' || a.species === 'tiger') &&
        Math.random() < 0.08
      ) {
        const ford = FORDS[Math.floor(Math.random() * FORDS.length)];
        const sideShift = a.pos.x < getRiverCenterX(ford.z) ? 20 : -20;
        a.state = 'crossing';
        a.targetPos = new THREE.Vector3(getRiverCenterX(ford.z) + sideShift, 0, ford.z + (Math.random() - 0.5) * 6);
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

  private decideVultureBehavior(a: Animal, neighbors: Animal[]): void {
    // Keep ongoing drinking
    if (a.state === 'drinking' && a.thirst < 94) {
      return;
    }

    // Drink at shallow water edges when thirsty
    if (a.thirst < 42) {
      const waterPt = this.findNearestWaterTarget(a);
      if (waterPt) {
        a.state = 'seeking_water';
        a.targetPos = waterPt;
        a.targetCarcassId = null;
        a.statusText = 'Летит к водопою';
        a.stateTimer = 14;
        return;
      }
    }

    const carcass = this.findNearestCarcass(a.pos, 95);
    if (carcass) {
      const dangerousNear = neighbors.some(
        (n) =>
          (n.species === 'lion' || n.species === 'tiger') &&
          n.pos.distanceTo(carcass.pos) < 11
      );
      if (!dangerousNear && a.hunger < 88) {
        a.state = 'scavenging';
        a.targetCarcassId = carcass.id;
        a.targetPos = carcass.pos.clone();
        a.statusText = 'Кормится у добычи';
        a.stateTimer = 8;
        return;
      }
      a.state = 'soaring';
      a.targetCarcassId = carcass.id;
      a.targetPos = carcass.pos.clone();
      a.statusText = 'Кружит над добычей';
      a.stateTimer = 8;
      return;
    }

    a.state = 'soaring';
    a.targetCarcassId = null;
    if (!a.targetPos || a.stateTimer <= 0) {
      a.targetPos = new THREE.Vector3(
        (Math.random() - 0.5) * 120,
        0,
        (Math.random() - 0.5) * 120
      );
      a.stateTimer = 12;
    }
    a.statusText = 'Парит над долиной';
  }

  private executeState(
    a: Animal,
    simDt: number,
    neighbors: Animal[],
    counts: Record<SpeciesId, number>
  ): void {
    const cfg = SPECIES_CONFIGS[a.species];

    if (a.species === 'vulture') {
      if (a.state === 'seeking_water' && a.targetPos) {
        const distXZ = Math.hypot(a.pos.x - a.targetPos.x, a.pos.z - a.targetPos.z);
        const groundY = getTerrainHeight(a.pos.x, a.pos.z);
        if (distXZ > 2.2) {
          this.steerTowards(a, a.targetPos, cfg.runSpeed * 0.9, simDt, false);
          a.pos.y = THREE.MathUtils.lerp(a.pos.y, groundY + 2.2, Math.min(1, simDt * 2.5));
        } else {
          a.speed = 0;
          a.pos.y = Math.max(groundY, getWaterLevel(this.season.wetness) + 0.05);
          a.state = 'drinking';
          a.statusText = 'Пьёт воду у берега';
          a.stateTimer = 5;
        }
      } else if (a.state === 'drinking') {
        a.speed = 0;
        a.thirst = Math.min(100, a.thirst + simDt * 22);
        if (a.thirst >= 95) {
          a.state = 'soaring';
          a.statusText = 'Парит над долиной';
        }
      } else if (a.state === 'scavenging' && a.targetPos) {
        const distXZ = Math.hypot(a.pos.x - a.targetPos.x, a.pos.z - a.targetPos.z);
        const groundY = getTerrainHeight(a.pos.x, a.pos.z);
        if (distXZ > 2.2) {
          this.steerTowards(a, a.targetPos, cfg.runSpeed * 0.9, simDt, false);
          a.pos.y = THREE.MathUtils.lerp(a.pos.y, groundY + 1.5, Math.min(1, simDt * 2));
        } else {
          a.speed = 0;
          a.pos.y = groundY;
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
      } else {
        // Smooth circular soaring in sky
        a.soarAngle += simDt * 0.42;
        const center = a.targetPos ?? new THREE.Vector3(0, 0, 0);
        const orbitR = a.targetCarcassId ? 11 : 28;
        const tx = center.x + Math.cos(a.soarAngle) * orbitR;
        const tz = center.z + Math.sin(a.soarAngle) * orbitR;
        const targetPt = new THREE.Vector3(tx, 0, tz);
        this.steerTowards(a, targetPt, cfg.runSpeed, simDt, false);
        const targetAlt = getTerrainHeight(a.pos.x, a.pos.z) + (a.targetCarcassId ? 13 : a.soarHeight);
        a.pos.y = THREE.MathUtils.lerp(a.pos.y, targetAlt, Math.min(1, simDt * 1.8));
      }
      a.rig.root.position.copy(a.pos);
      a.rig.root.rotation.y = a.yaw;
      return;
    }

    switch (a.state) {
      case 'resting': {
        if (a.targetPos && a.pos.distanceTo(a.targetPos) > 2.2) {
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
        if (depth > 0.04 && depth < 0.48) {
          a.state = 'drinking';
          a.statusText = 'Пьёт воду';
          a.stateTimer = 6;
          a.speed = 0;
        } else if (dist < 1.8) {
          // Step slightly closer toward water center if dry shore
          a.state = 'drinking';
          a.statusText = 'Пьёт воду';
          a.stateTimer = 5.5;
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
          if (Math.random() < simDt * 0.45) {
            this.atmosphere.spawnSplash(a.pos.x, getWaterLevel(this.season.wetness), a.pos.z, 2);
          }
        }
        break;
      }

      case 'browsing': {
        if (!a.targetPos) break;
        const dist = Math.hypot(a.pos.x - a.targetPos.x, a.pos.z - a.targetPos.z);
        if (dist > 3.2) {
          this.steerTowards(a, a.targetPos, cfg.walkSpeed, simDt, true);
          a.statusText = 'Направляется к акациям';
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
        const dist = a.pos.distanceTo(guardian.pos);
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
        const dist = a.pos.distanceTo(prey.pos);
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
        const dist = a.pos.distanceTo(prey.pos);
        if (dist > 46) {
          a.state = 'wandering';
          a.targetAnimalId = null;
          break;
        }
        this.steerTowards(a, prey.pos, cfg.runSpeed, simDt, cfg.avoidsDeepWater);
        if (Math.random() < simDt * 4) {
          this.atmosphere.spawnDust(a.pos.x, a.pos.y, a.pos.z, 1);
        }

        const reach = cfg.adultRadius + SPECIES_CONFIGS[prey.species].adultRadius + 0.85;
        if (dist <= reach && a.attackCooldown <= 0) {
          a.attackCooldown = 1.2;
          const damage = a.species === 'tiger' ? 56 : 48;
          prey.health -= damage;
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
        let awayDir: THREE.Vector3;
        if (threat) {
          awayDir = a.pos.clone().sub(threat.pos).setY(0).normalize();
        } else {
          awayDir = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
        }
        const escapePt = a.pos.clone().addScaledVector(awayDir, 20);
        this.steerTowards(a, escapePt, cfg.runSpeed, simDt, cfg.avoidsDeepWater);
        if (Math.random() < simDt * 5) {
          this.atmosphere.spawnDust(a.pos.x, a.pos.y, a.pos.z, 1);
        }
        break;
      }

      case 'defending': {
        const threat = this.getAnimalById(a.threatAnimalId);
        if (!threat || a.pos.distanceTo(threat.pos) > 16 || a.stateTimer <= 0) {
          a.state = 'wandering';
          a.threatAnimalId = null;
          break;
        }
        const dist = a.pos.distanceTo(threat.pos);
        this.steerTowards(a, threat.pos, cfg.runSpeed * 0.92, simDt, false);
        if (Math.random() < simDt * 4) {
          this.atmosphere.spawnDust(a.pos.x, a.pos.y, a.pos.z, 1);
        }
        const reach = cfg.adultRadius + SPECIES_CONFIGS[threat.species].adultRadius + 1.1;
        if (dist <= reach && a.attackCooldown <= 0) {
          a.attackCooldown = 2.4;
          const kickDmg = a.species === 'elephant' ? 20 : a.species === 'hippo' ? 22 : 12;
          threat.health -= kickDmg;
          threat.state = 'fleeing';
          threat.threatAnimalId = a.id;
          threat.stateTimer = 6.5;
          threat.targetAnimalId = null;
          // Defender backs off after repelling the intruder
          a.state = 'wandering';
          a.threatAnimalId = null;
          if (threat.health <= 0) {
            this.killAnimal(threat, `в схватке (${SPECIES_CONFIGS[a.species].nameRu})`);
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
        const dist = a.pos.distanceTo(mate.pos);
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
          if (dist > 2.2) {
            // Herd cohesion gentle pull
            const herdPull = this.computeHerdSeparationAndCohesion(a, neighbors);
            const target = a.targetPos.clone().addScaledVector(herdPull, 4);
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

    a.rig.root.position.copy(a.pos);
    a.rig.root.rotation.y = a.yaw;
  }

  private steerTowards(
    a: Animal,
    target: THREE.Vector3,
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

    // Look ahead for deep water avoidance (lions & savanna herbivores stay out of deep water unless at a ford!)
    if (avoidDeepWater) {
      const lookDist = 3.5 + cfg.adultRadius;
      const probeX = a.pos.x + dx * lookDist;
      const probeZ = a.pos.z + dz * lookDist;
      const probeDepth = getWaterDepth(probeX, probeZ, this.season.wetness);
      if (probeDepth > cfg.maxWaterDepth) {
        // Redirect toward nearest shallow ford if trying to cross, else steer parallel along bank
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
          // Turn tangent around water obstacle toward goal direction
          const t1x = -dz;
          const t1z = dx;
          const dot1 = t1x * (target.x - a.pos.x) + t1z * (target.z - a.pos.z);
          const sign = dot1 >= 0 ? 1 : -1;
          dx = t1x * sign;
          dz = t1z * sign;
        }
      }
    }

    // Smooth yaw rotation
    const targetYaw = Math.atan2(dx, dz);
    let diff = targetYaw - a.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    a.yaw += diff * Math.min(1, simDt * 5.2);

    const depthHere = getWaterDepth(a.pos.x, a.pos.z, this.season.wetness);
    const wasSwimming = a.isSwimming;
    a.isSwimming = depthHere > cfg.maxWaterDepth * 0.68 || (a.species === 'hippo' && depthHere > 0.35);

    if (a.isSwimming && !wasSwimming) {
      this.atmosphere.spawnSplash(a.pos.x, getWaterLevel(this.season.wetness), a.pos.z, 5);
      this.soundscape.playSplash(a.pos, this.cameraTargetRef);
    }

    const actualSpeed = a.isSwimming
      ? Math.min(desiredSpeed, cfg.swimSpeed)
      : depthHere > 0.08
        ? desiredSpeed * 0.72
        : desiredSpeed;

    a.speed = actualSpeed;
    const nx = a.pos.x + Math.sin(a.yaw) * actualSpeed * simDt;
    const nz = a.pos.z + Math.cos(a.yaw) * actualSpeed * simDt;

    // Valley bounds clamp
    a.pos.x = Math.max(-WORLD_HALF + 2, Math.min(WORLD_HALF - 2, nx));
    a.pos.z = Math.max(-WORLD_HALF + 2, Math.min(WORLD_HALF - 2, nz));

    const groundY = getTerrainHeight(a.pos.x, a.pos.z);
    const waterY = getWaterLevel(this.season.wetness);
    if (a.isSwimming) {
      a.pos.y = Math.max(groundY, waterY - 0.35);
    } else {
      a.pos.y = groundY;
    }
  }

  private computeHerdSeparationAndCohesion(a: Animal, neighbors: Animal[]): THREE.Vector3 {
    const steer = new THREE.Vector3();
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

  private findNearestThreat(a: Animal, neighbors: Animal[]): Animal | null {
    const isJuvPredator =
      (a.species === 'lion' || a.species === 'tiger') && a.stage === 'juvenile';
    let best: Animal | null = null;
    let bestDist = Infinity;

    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      if (!n.alive || n.species === a.species) continue;

      const isPredator = n.species === 'lion' || n.species === 'tiger';
      const isChargingGiant =
        (n.species === 'elephant' || n.species === 'hippo') && n.state === 'defending';

      if (isJuvPredator && !isChargingGiant && n.species !== 'lion' && n.species !== 'tiger') {
        continue;
      }
      if (!isPredator && !isChargingGiant) continue;
      if (isPredator && n.stage === 'juvenile') continue;

      const dist = a.pos.distanceTo(n.pos);
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

  private findBestPrey(predator: Animal, neighbors: Animal[]): Animal | null {
    let best: Animal | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      if (!n.alive || n.species === predator.species) continue;
      if (n.species === 'vulture' || n.species === 'lion' || n.species === 'tiger') continue;

      const dist = predator.pos.distanceTo(n.pos);
      let score = 40 - dist;

      if (n.species === 'zebra' || n.species === 'antelope' || n.species === 'deer' || n.species === 'boar') {
        score += 32;
      } else if (n.species === 'giraffe') {
        if (predator.hunger > 38 && n.stage !== 'juvenile') continue;
        score += n.stage === 'juvenile' ? 14 : -8;
      } else if (n.species === 'elephant' || n.species === 'hippo') {
        // Never attack healthy adult elephants/hippos unless starving
        if (n.stage !== 'juvenile' && predator.hunger > 15) continue;
        // Check if adult elephant/hippo protector is right next to calf
        const guarded = neighbors.some(
          (g) => g.species === n.species && g.stage !== 'juvenile' && g.pos.distanceTo(n.pos) < 12
        );
        if (guarded && predator.hunger > 22) continue;
        score += 5;
      }

      if (n.stage === 'juvenile') score += 10;
      if (n.health < 65) score += 14;

      if (predator.species === 'lion') {
        const depth = getWaterDepth(n.pos.x, n.pos.z, this.season.wetness);
        if (depth > 0.48) score -= 50;
      }

      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return bestScore > 10 ? best : null;
  }

  private findGuardian(juv: Animal, neighbors: Animal[]): Animal | null {
    if (juv.motherId !== null) {
      const mom = this.getAnimalById(juv.motherId);
      if (mom) return mom;
    }
    let best: Animal | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      if (n.species === juv.species && n.stage !== 'juvenile' && n.groupId === juv.groupId) {
        const d = juv.pos.distanceTo(n.pos);
        if (d < bestDist) {
          bestDist = d;
          best = n;
        }
      }
    }
    return best;
  }

  private enterDefend(a: Animal, threat: Animal, text: string): void {
    const wasDefending = a.state === 'defending';
    a.state = 'defending';
    a.threatAnimalId = threat.id;
    a.statusText = text;
    a.stateTimer = 5.5;
    if (!wasDefending) {
      this.soundscape.playAnimalCall(a.species, a.pos, this.cameraTargetRef);
      if (SPECIES_CONFIGS[a.species].isMainFive && Math.random() < 0.55) {
        this.pushEvent(
          SPECIES_CONFIGS[a.species].emoji,
          `${getSpeciesTitleRu(a.species, a.sex)} ${a.name}: ${text.toLowerCase()}`,
          a.pos,
          2
        );
      }
    }
  }

  private handlePredatorKill(predator: Animal, prey: Animal): void {
    const pCfg = SPECIES_CONFIGS[predator.species];
    const vCfg = SPECIES_CONFIGS[prey.species];

    this.killAnimal(prey, `добыча (${pCfg.nameRu})`);
    predator.state = 'feeding';
    predator.targetAnimalId = null;
    predator.statusText = 'Питается добычей';
    predator.stateTimer = 14;

    const latestCarcass = this.carcasses[this.carcasses.length - 1];
    if (latestCarcass) {
      predator.targetCarcassId = latestCarcass.id;
      predator.targetPos = latestCarcass.pos.clone();
    }

    this.soundscape.playAnimalCall(predator.species, predator.pos, this.cameraTargetRef);
    const importance = vCfg.isMainFive ? 3 : 2;
    this.pushEvent(
      pCfg.emoji,
      `${getSpeciesTitleRu(predator.species, predator.sex)} ${predator.name} поймал добычу (${vCfg.nameRu.toLowerCase()})`,
      prey.pos,
      importance
    );
  }

  private killAnimal(a: Animal, _reason: string): void {
    if (!a.alive) return;
    a.alive = false;
    this.animalRootGroup.remove(a.rig.root);

    if (a.species !== 'vulture') {
      this.spawnCarcass(a);
    }
  }

  private spawnCarcass(a: Animal): void {
    const id = this.nextCarcassId++;
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

    const group = new THREE.Group();
    const scale = a.stage === 'juvenile' ? 0.55 : 0.95;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8 * scale, 0.35 * scale, 1.3 * scale),
      new THREE.MeshStandardMaterial({ color: 0x7d4c3b, roughness: 0.92, flatShading: true })
    );
    body.position.y = 0.16 * scale;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const pos = a.pos.clone();
    pos.y = getTerrainHeight(pos.x, pos.z);
    group.position.copy(pos);
    group.rotation.y = a.yaw;
    this.carcassGroup.add(group);

    this.carcasses.push({
      id,
      species: a.species,
      pos,
      meatRemaining: meat,
      maxMeat: meat,
      ageSeconds: 0,
      mesh: group,
    });
  }

  private updateCarcasses(simDt: number): void {
    for (let i = this.carcasses.length - 1; i >= 0; i--) {
      const c = this.carcasses[i];
      c.ageSeconds += simDt;
      c.meatRemaining = Math.max(0, c.meatRemaining - simDt * 0.25);

      const ratio = Math.max(0.25, c.meatRemaining / c.maxMeat);
      c.mesh.scale.set(1, ratio, 1);

      if (c.meatRemaining <= 0.1 || c.ageSeconds > 160) {
        this.carcassGroup.remove(c.mesh);
        this.carcasses.splice(i, 1);
      }
    }
  }

  private getCarcass(id: number | null): Carcass | null {
    if (id === null) return null;
    for (let i = 0; i < this.carcasses.length; i++) {
      if (this.carcasses[i].id === id) return this.carcasses[i];
    }
    return null;
  }

  private findNearestCarcass(pos: THREE.Vector3, maxDist: number): Carcass | null {
    let best: Carcass | null = null;
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

  private findNearestWaterTarget(a: Animal): THREE.Vector3 | null {
    const cx = getRiverCenterX(a.pos.z);
    const hw = getRiverHalfWidth(a.pos.z);
    const side = a.pos.x < cx ? -1 : 1;
    // Bank edge right in shallow water
    let best = new THREE.Vector3(cx + side * (hw - 0.8), 0, a.pos.z + (Math.random() - 0.5) * 8);
    let bestDist = a.pos.distanceTo(best);

    // Check savanna watering holes if on savanna side and holding water
    if (a.pos.x < cx) {
      for (const hole of WATERING_HOLES) {
        const holeCenterDepth = getWaterDepth(hole.x, hole.z, this.season.wetness);
        if (holeCenterDepth < 0.16) continue;
        const ang = Math.atan2(a.pos.z - hole.z, a.pos.x - hole.x);
        const edgeDist = hole.radius * (0.45 + this.season.wetness * 0.42);
        const pt = new THREE.Vector3(
          hole.x + Math.cos(ang) * edgeDist,
          0,
          hole.z + Math.sin(ang) * edgeDist
        );
        const d = a.pos.distanceTo(pt);
        if (d < bestDist) {
          bestDist = d;
          best = pt;
        }
      }
    }
    return best;
  }

  private findNearestRiverPool(pos: THREE.Vector3): THREE.Vector3 {
    const targetZ = Math.abs(pos.z + 24) < Math.abs(pos.z - 38) ? -24 : 38;
    const z = THREE.MathUtils.lerp(pos.z, targetZ, 0.35) + (Math.random() - 0.5) * 10;
    const cx = getRiverCenterX(z);
    return new THREE.Vector3(cx + (Math.random() - 0.5) * 8, 0, z);
  }

  private findCoolingShoreSpot(a: Animal): THREE.Vector3 {
    const z = THREE.MathUtils.clamp(a.pos.z + (Math.random() - 0.5) * 14, -95, 95);
    const cx = getRiverCenterX(z);
    const hw = getRiverHalfWidth(z);
    const side = a.pos.x < cx ? -1 : 1;
    return new THREE.Vector3(cx + side * (hw - 1.8), 0, z);
  }

  private findBankGrazingSpot(pos: THREE.Vector3): THREE.Vector3 {
    const z = THREE.MathUtils.clamp(pos.z + (Math.random() - 0.5) * 24, -98, 98);
    const cx = getRiverCenterX(z);
    const hw = getRiverHalfWidth(z);
    const side = pos.x < cx ? -1 : 1;
    return new THREE.Vector3(cx + side * (hw + 6 + Math.random() * 14), 0, z);
  }

  private findShadeSpot(a: Animal): THREE.Vector3 {
    // Lions love rocky kopjes or acacia shade
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
        return new THREE.Vector3(
          bestK.x + (Math.random() - 0.5) * 8,
          0,
          bestK.z + (Math.random() - 0.5) * 8
        );
      }
    }

    let bestTree: TreeNode | null = null;
    let bestD = Infinity;
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      if (t.kind === 'bush') continue;
      const d = Math.hypot(a.pos.x - t.x, a.pos.z - t.z);
      if (d < bestD) {
        bestD = d;
        bestTree = t;
      }
    }
    if (bestTree) {
      return new THREE.Vector3(
        bestTree.x + (Math.random() - 0.5) * 3.5,
        0,
        bestTree.z + (Math.random() - 0.5) * 3.5
      );
    }
    return a.pos.clone();
  }

  private findNearestFoodTree(pos: THREE.Vector3, preferAcacia: boolean): number | null {
    let bestIdx: number | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      if (t.kind === 'bush' || t.foliage < 0.25) continue;
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

  private findGrazingSpot(a: Animal): THREE.Vector3 {
    const cfg = SPECIES_CONFIGS[a.species];
    let best = a.pos.clone();
    let bestScore = -1;
    for (let i = 0; i < 6; i++) {
      const rx = THREE.MathUtils.clamp(a.pos.x + (Math.random() - 0.5) * 32, -WORLD_HALF + 8, WORLD_HALF - 8);
      const rz = THREE.MathUtils.clamp(a.pos.z + (Math.random() - 0.5) * 32, -WORLD_HALF + 8, WORLD_HALF - 8);
      const cx = getRiverCenterX(rz);
      if (cfg.homeBiome === 'savanna' && rx > cx - 6) continue;
      if (cfg.homeBiome === 'jungle' && rx < cx + 6) continue;
      if (getWaterDepth(rx, rz, this.season.wetness) > 0.05) continue;
      const density = getGrassDensity(rx, rz, this.season.wetness);
      if (density > bestScore) {
        bestScore = density;
        best = new THREE.Vector3(rx, 0, rz);
      }
    }
    return best;
  }

  private pickWanderPoint(a: Animal, neighbors: Animal[]): THREE.Vector3 {
    const cfg = SPECIES_CONFIGS[a.species];

    // Herd/pride leaders stay roughly in home biome
    if (a.species !== 'elephant' && a.species !== 'tiger') {
      const peer = neighbors.find((n) => n.species === a.species && n.groupId === a.groupId && n.id !== a.id);
      if (peer && a.pos.distanceTo(peer.pos) > 22) {
        return peer.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6));
      }
    }

    for (let i = 0; i < 8; i++) {
      const rx = THREE.MathUtils.clamp(a.pos.x + (Math.random() - 0.5) * 44, -WORLD_HALF + 10, WORLD_HALF - 10);
      const rz = THREE.MathUtils.clamp(a.pos.z + (Math.random() - 0.5) * 44, -WORLD_HALF + 10, WORLD_HALF - 10);
      const cx = getRiverCenterX(rz);
      if (cfg.homeBiome === 'savanna' && rx > cx - 10) continue;
      if (cfg.homeBiome === 'jungle' && rx < cx + 10) continue;
      if (cfg.avoidsDeepWater && getWaterDepth(rx, rz, this.season.wetness) > cfg.maxWaterDepth) continue;
      return new THREE.Vector3(rx, 0, rz);
    }
    return a.homeCenter.clone();
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
        return 'Парит в восходящих потоках';
    }
  }

  public getCurrentBiomeRu(a: Animal): string {
    const b = getBiome(a.pos.x, a.pos.z, this.season.wetness);
    switch (b) {
      case 'savanna':
        return 'Саванна';
      case 'jungle':
        return 'Джунгли';
      case 'river':
        return 'Река';
      case 'ford':
        return 'Брод';
      case 'waterhole':
        return 'Водопой';
    }
  }

  private pushEvent(icon: string, text: string, pos: THREE.Vector3, importance: number): void {
    this.events.unshift({
      id: this.nextEventId++,
      icon,
      text,
      pos: pos.clone(),
      importance,
      createdAtReal: performance.now(),
    });
    if (this.events.length > 24) this.events.length = 24;
  }
}
