import * as THREE from 'three';
import type { Soundscape } from '../audio/Soundscape.js';
import {
  type RenderAnimal,
  animateAnimalRig,
  createAnimalRig,
} from '../entities/AnimalMeshFactory.js';
import {
  SPECIES_CONFIGS,
  SPECIES_ORDER,
  STAGE_ORDER,
  STATE_ORDER,
} from '../shared/SpeciesData.js';
import {
  getBiome,
  getBiomeNameRu,
  getWaterDepth,
} from '../shared/TerrainMath.js';
import type {
  AnimalMeta,
  AnimalTuple,
  CarcassTuple,
  SeasonState,
  ServerMessage,
  SpeciesId,
  TimeState,
  WorldEvent,
} from '../shared/types.js';
import type { Atmosphere } from '../world/Atmosphere.js';

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting';

function resolveWebSocketUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const override = params.get('ws');
  if (override && (override.startsWith('ws://') || override.startsWith('wss://'))) {
    return override;
  }

  const configured = import.meta.env.VITE_WS_URL;
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }

  // Local Vite dev server connects to local backend port 8080
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    const port = window.location.port === '5173' ? '8080' : window.location.port || '8080';
    return `ws://${window.location.hostname}:${port}`;
  }

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

function wrapAngleDelta(from: number, to: number): number {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export class WorldClient {
  public readonly animals: RenderAnimal[] = [];
  public readonly events: WorldEvent[] = [];

  public timeState: TimeState = {
    day: 1,
    timeOfDay: 0.28,
    hour: 6,
    minute: 43,
    phaseNameRu: 'Утро',
    temperature: 23,
  };

  public season: SeasonState = {
    progress: 0.4,
    wetness: 0.65,
    isDrySeason: false,
    isRaining: false,
    rainIntensity: 0,
    seasonNameRu: 'Сезон дождей',
    weatherTextRu: 'Ясно · Полноводная река',
  };

  public viewerCount = 1;
  public connectionStatus: ConnectionStatus = 'connecting';

  private readonly scene: THREE.Scene;
  private readonly atmosphere: Atmosphere;
  private readonly soundscape: Soundscape;

  private animalMap = new Map<number, RenderAnimal>();
  private metaMap = new Map<number, AnimalMeta>();
  private carcassMeshes = new Map<number, THREE.Group>();
  private particleTimers = new Map<number, number>();
  private prevWaterState = new Map<number, boolean>();
  private cameraTarget = new THREE.Vector3();

  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private readonly wsUrl: string;

  constructor(scene: THREE.Scene, atmosphere: Atmosphere, soundscape: Soundscape) {
    this.scene = scene;
    this.atmosphere = atmosphere;
    this.soundscape = soundscape;
    this.wsUrl = resolveWebSocketUrl();
    this.connect();
  }

  public setCameraTarget(target: THREE.Vector3): void {
    this.cameraTarget.copy(target);
  }

  public getAnimalById(id: number | null): RenderAnimal | null {
    if (id === null) return null;
    return this.animalMap.get(id) ?? null;
  }

  public getSpeciesCounts(): Record<SpeciesId, number> {
    const counts = {} as Record<SpeciesId, number>;
    for (const sp of SPECIES_ORDER) counts[sp] = 0;
    for (const a of this.animals) counts[a.species]++;
    return counts;
  }

  public getCurrentBiomeRu(a: RenderAnimal): string {
    return getBiomeNameRu(getBiome(a.pos.x, a.pos.z, this.season.wetness));
  }

  private connect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', () => {
      this.reconnectAttempt = 0;
      this.connectionStatus = 'live';
    });

    this.ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        this.handleServerMessage(msg);
      } catch {
        // Ignore malformed packets
      }
    });

    this.ws.addEventListener('close', () => {
      this.connectionStatus = 'reconnecting';
      this.scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      this.ws?.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const delay = Math.min(5000, 1200 * Math.pow(1.4, this.reconnectAttempt));
    this.reconnectAttempt++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleServerMessage(msg: ServerMessage): void {
    this.timeState = msg.t;
    this.season = msg.s;
    this.viewerCount = msg.v;

    if (msg.type === 'welcome') {
      this.clearWorldEntities();
      for (const m of msg.meta) {
        this.metaMap.set(m.id, m);
      }
      for (const tup of msg.a) {
        this.applyAnimalTuple(tup, true);
      }
      this.syncCarcasses(msg.c);
      this.events.length = 0;
      this.events.push(...msg.events);
      return;
    }

    // Incremental tick
    if (msg.added) {
      for (const m of msg.added) {
        this.metaMap.set(m.id, m);
      }
    }
    if (msg.removed) {
      for (const id of msg.removed) {
        this.removeAnimal(id);
      }
    }
    if (msg.statuses) {
      for (const [id, text] of msg.statuses) {
        const meta = this.metaMap.get(id);
        if (meta) meta.statusText = text;
        const a = this.animalMap.get(id);
        if (a) a.statusText = text;
      }
    }
    if (msg.events) {
      for (const ev of msg.events) {
        this.events.unshift(ev);
      }
      if (this.events.length > 24) this.events.length = 24;
    }

    for (const tup of msg.a) {
      this.applyAnimalTuple(tup, false);
    }
    this.syncCarcasses(msg.c);
  }

  private clearWorldEntities(): void {
    for (const a of this.animals) {
      this.scene.remove(a.rig.root);
    }
    this.animals.length = 0;
    this.animalMap.clear();
    this.metaMap.clear();
    this.particleTimers.clear();
    this.prevWaterState.clear();

    for (const grp of this.carcassMeshes.values()) {
      this.scene.remove(grp);
    }
    this.carcassMeshes.clear();
  }

  private removeAnimal(id: number): void {
    const existing = this.animalMap.get(id);
    if (existing) {
      this.scene.remove(existing.rig.root);
      const idx = this.animals.indexOf(existing);
      if (idx >= 0) this.animals.splice(idx, 1);
      this.animalMap.delete(id);
    }
    this.metaMap.delete(id);
    this.particleTimers.delete(id);
    this.prevWaterState.delete(id);
  }

  private applyAnimalTuple(tup: AnimalTuple, snapImmediately: boolean): void {
    const [
      id,
      x,
      y,
      z,
      yaw,
      speed,
      stateIdx,
      hunger,
      thirst,
      energy,
      health,
      ageDays,
      stageIdx,
      flags,
    ] = tup;

    const state = STATE_ORDER[stateIdx] ?? 'wandering';
    const stage = STAGE_ORDER[stageIdx] ?? 'adult';
    const isSwimming = (flags & 1) !== 0;
    const isYawning = (flags & 2) !== 0;

    let a = this.animalMap.get(id);
    if (!a) {
      const meta = this.metaMap.get(id);
      if (!meta) return;

      const rig = createAnimalRig(meta.species, meta.sex);
      rig.root.position.set(x, y, z);
      rig.root.rotation.y = yaw;
      rig.root.traverse((obj) => {
        obj.userData.animalId = id;
      });
      this.scene.add(rig.root);

      a = {
        id,
        species: meta.species,
        name: meta.name,
        sex: meta.sex,
        groupId: meta.groupId,
        maxAgeDays: meta.maxAgeDays,
        ageDays,
        stage,
        pos: { x, y, z },
        targetPos: { x, y, z },
        yaw,
        targetYaw: yaw,
        speed,
        isSwimming,
        isYawning,
        hunger,
        thirst,
        energy,
        health,
        state,
        statusText: meta.statusText,
        gaitPhase: (id * 0.9) % (Math.PI * 2),
        restBlend: state === 'resting' ? 1 : 0,
        drinkBlend: 0,
        browseBlend: 0,
        stalkBlend: 0,
        swimBlend: isSwimming ? 1 : 0,
        perchBlend: state === 'perching' ? 1 : 0,
        slopePitch: 0,
        slopeRoll: 0,
        rig,
      };
      this.animals.push(a);
      this.animalMap.set(id, a);
      this.prevWaterState.set(id, isSwimming);
      return;
    }

    const prevState = a.state;
    const prevYaw = isYawning && !a.isYawning;

    a.targetPos.x = x;
    a.targetPos.y = y;
    a.targetPos.z = z;
    a.targetYaw = yaw;
    a.speed = speed;
    a.state = state;
    a.hunger = hunger;
    a.thirst = thirst;
    a.energy = energy;
    a.health = health;
    a.ageDays = ageDays;
    a.stage = stage;
    a.isSwimming = isSwimming;
    a.isYawning = isYawning;

    if (snapImmediately) {
      a.pos.x = x;
      a.pos.y = y;
      a.pos.z = z;
      a.yaw = yaw;
      a.rig.root.position.set(x, y, z);
      a.rig.root.rotation.y = yaw;
    }

    // Trigger natural calls on dramatic transitions near camera
    if (prevState !== state && (state === 'defending' || state === 'chasing')) {
      this.soundscape.playAnimalCall(
        a.species,
        new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z),
        this.cameraTarget
      );
    } else if (prevYaw && a.species === 'hippo') {
      this.soundscape.playAnimalCall(
        a.species,
        new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z),
        this.cameraTarget
      );
    }
  }

  private syncCarcasses(tuples: CarcassTuple[]): void {
    const seen = new Set<number>();

    for (const c of tuples) {
      const [id, speciesIdx, x, y, z, yaw, meatRatio, isJuv] = c;
      seen.add(id);

      let meshGroup = this.carcassMeshes.get(id);
      if (!meshGroup) {
        meshGroup = new THREE.Group();
        const sp = SPECIES_ORDER[speciesIdx] ?? 'antelope';
        const rad = SPECIES_CONFIGS[sp].adultRadius * (isJuv ? 0.55 : 0.9);
        const meatMat = new THREE.MeshStandardMaterial({ color: 0x8f332c, roughness: 0.9, flatShading: true });
        const boneMat = new THREE.MeshStandardMaterial({ color: 0xe6decb, roughness: 0.85, flatShading: true });

        const body = new THREE.Mesh(new THREE.BoxGeometry(rad * 0.95, rad * 0.48, rad * 1.4), meatMat);
        body.position.y = rad * 0.24;
        body.castShadow = true;
        body.receiveShadow = true;
        meshGroup.add(body);

        for (let i = 0; i < 3; i++) {
          const rib = new THREE.Mesh(new THREE.BoxGeometry(rad * 1.05, 0.08, 0.08), boneMat);
          rib.position.set(0, rad * 0.42, (i - 1) * rad * 0.35);
          meshGroup.add(rib);
        }

        meshGroup.position.set(x, y, z);
        meshGroup.rotation.y = yaw;
        this.scene.add(meshGroup);
        this.carcassMeshes.set(id, meshGroup);
      }

      const scale = Math.max(0.32, meatRatio);
      meshGroup.scale.set(scale, scale, scale);
    }

    for (const [id, grp] of this.carcassMeshes.entries()) {
      if (!seen.has(id)) {
        this.scene.remove(grp);
        this.carcassMeshes.delete(id);
      }
    }
  }

  public update(realDt: number, realTime: number): void {
    const posLerp = 1 - Math.exp(-11.5 * realDt);
    const yawLerp = 1 - Math.exp(-10.5 * realDt);

    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i];

      // Smooth network snapshot interpolation (snap cleanly if teleport/far lag spike)
      const jumpSq =
        (a.targetPos.x - a.pos.x) ** 2 +
        (a.targetPos.y - a.pos.y) ** 2 +
        (a.targetPos.z - a.pos.z) ** 2;

      if (jumpSq > 144) {
        a.pos.x = a.targetPos.x;
        a.pos.y = a.targetPos.y;
        a.pos.z = a.targetPos.z;
        a.yaw = a.targetYaw;
      } else {
        a.pos.x += (a.targetPos.x - a.pos.x) * posLerp;
        a.pos.y += (a.targetPos.y - a.pos.y) * posLerp;
        a.pos.z += (a.targetPos.z - a.pos.z) * posLerp;
        a.yaw += wrapAngleDelta(a.yaw, a.targetYaw) * yawLerp;
      }

      a.rig.root.position.set(a.pos.x, a.pos.y, a.pos.z);
      a.rig.root.rotation.y = a.yaw;

      const waterDepth =
        a.species === 'vulture' ? 0 : getWaterDepth(a.pos.x, a.pos.z, this.season.wetness);

      animateAnimalRig(a, realDt, realTime, waterDepth);

      // Ambient footprints / water splash effects near camera
      const distCam = Math.hypot(a.pos.x - this.cameraTarget.x, a.pos.z - this.cameraTarget.z);
      if (distCam < 68 && a.species !== 'vulture') {
        const wasInWater = this.prevWaterState.get(a.id) ?? false;
        const inWaterNow = waterDepth > 0.14;
        if (!wasInWater && inWaterNow) {
          this.atmosphere.spawnSplash(a.pos.x, a.pos.y, a.pos.z, 5);
          this.soundscape.playSplash(new THREE.Vector3(a.pos.x, a.pos.y, a.pos.z), this.cameraTarget);
        }
        this.prevWaterState.set(a.id, inWaterNow);

        let pt = (this.particleTimers.get(a.id) ?? 0) - realDt;
        if (pt <= 0) {
          if (inWaterNow && a.speed > 0.9) {
            this.atmosphere.spawnSplash(a.pos.x, a.pos.y, a.pos.z, 2);
            pt = 0.24;
          } else if (this.season.isDrySeason && a.speed > 3.2 && !this.season.isRaining) {
            this.atmosphere.spawnDust(a.pos.x, a.pos.y, a.pos.z, 2);
            pt = 0.26;
          } else {
            pt = 0.18;
          }
        }
        this.particleTimers.set(a.id, pt);
      }
    }
  }
}
