import * as THREE from 'three';
import type { RenderAnimal } from '../entities/AnimalMeshFactory.js';
import { SPECIES_CONFIGS } from '../shared/SpeciesData.js';
import { getTerrainHeight } from '../shared/TerrainMath.js';

const CAMERA_CLAMP = 94;

export class CameraController {
  public readonly target = new THREE.Vector3(-12, 1.5, -6);
  public followedAnimalId: number | null = null;
  public autoDirector = false;

  private yaw = 0.65;
  private pitch = 0.44;
  private distance = 44;

  private desiredTarget = new THREE.Vector3(-12, 1.5, -6);
  private desiredYaw = 0.65;
  private desiredPitch = 0.44;
  private desiredDistance = 44;

  private directorTimer = 0;
  private lastDirectorId: number | null = null;
  private keys = new Set<string>();

  private isDraggingOrbit = false;
  private isDraggingPan = false;
  private dragMoved = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private onFollowChanged?: (animal: RenderAnimal | null) => void;
  private onDirectorChanged?: (active: boolean) => void;

  constructor(
    camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    callbacks?: {
      onFollowChanged?: (animal: RenderAnimal | null) => void;
      onDirectorChanged?: (active: boolean) => void;
    }
  ) {
    this.camera = camera;
    this.dom = dom;
    this.onFollowChanged = callbacks?.onFollowChanged;
    this.onDirectorChanged = callbacks?.onDirectorChanged;
    this.bindInput();
    this.applyCameraPosition();
  }

  public wasDrag(): boolean {
    return this.dragMoved;
  }

  public setAutoDirector(active: boolean, animals: RenderAnimal[] = []): void {
    this.autoDirector = active;
    if (active) {
      this.directorTimer = 0;
      if (animals.length > 0) this.pickDirectorSubject(animals);
    }
    this.onDirectorChanged?.(this.autoDirector);
  }

  public followAnimal(animal: RenderAnimal | null): void {
    if (!animal) {
      this.followedAnimalId = null;
      this.onFollowChanged?.(null);
      return;
    }
    this.followedAnimalId = animal.id;
    const cfg = SPECIES_CONFIGS[animal.species];
    this.desiredDistance = THREE.MathUtils.clamp(cfg.adultRadius * 11 + 5, 11, 26);
    this.desiredPitch = 0.34;
    this.onFollowChanged?.(animal);
  }

  public jumpToPoint(pos: THREE.Vector3): void {
    this.followedAnimalId = null;
    this.onFollowChanged?.(null);
    this.desiredTarget.set(pos.x, getTerrainHeight(pos.x, pos.z) + 1.4, pos.z);
    this.clampDesiredTarget();
    this.desiredDistance = Math.min(this.desiredDistance, 28);
  }

  private bindInput(): void {
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());

    this.dom.addEventListener('pointerdown', (e) => {
      this.dragMoved = false;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      if (e.button === 0) {
        this.isDraggingOrbit = true;
      } else if (e.button === 2 || e.button === 1) {
        this.isDraggingPan = true;
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isDraggingOrbit && !this.isDraggingPan) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        this.dragMoved = true;
        if (this.autoDirector) {
          this.setAutoDirector(false);
        }
      }

      if (this.isDraggingOrbit) {
        this.desiredYaw -= dx * 0.0065;
        this.desiredPitch = THREE.MathUtils.clamp(
          this.desiredPitch + dy * 0.0055,
          0.12,
          1.25
        );
      } else if (this.isDraggingPan) {
        this.panByScreenDelta(dx, dy);
      }
    });

    window.addEventListener('pointerup', () => {
      this.isDraggingOrbit = false;
      this.isDraggingPan = false;
    });

    this.dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.12 : 0.89;
        this.desiredDistance = THREE.MathUtils.clamp(this.desiredDistance * factor, 7, 88);
      },
      { passive: false }
    );

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.isDraggingOrbit = false;
      this.isDraggingPan = false;
    });
  }

  private panByScreenDelta(dx: number, dy: number): void {
    if (this.followedAnimalId !== null) {
      this.followedAnimalId = null;
      this.onFollowChanged?.(null);
    }
    const scale = this.distance * 0.0018;
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    this.desiredTarget.x -= (rightX * dx - forwardX * dy) * scale;
    this.desiredTarget.z -= (rightZ * dx - forwardZ * dy) * scale;
    this.clampDesiredTarget();
  }

  private clampDesiredTarget(): void {
    this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, -CAMERA_CLAMP, CAMERA_CLAMP);
    this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, -CAMERA_CLAMP, CAMERA_CLAMP);
    const groundY = getTerrainHeight(this.desiredTarget.x, this.desiredTarget.z);
    this.desiredTarget.y = Math.max(0.2, groundY + 1.4);
  }

  public update(realDt: number, animals: RenderAnimal[]): void {
    const moveFwd =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const moveSide =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);

    if (moveFwd !== 0 || moveSide !== 0) {
      if (this.followedAnimalId !== null) {
        this.followedAnimalId = null;
        this.onFollowChanged?.(null);
      }
      if (this.autoDirector) {
        this.setAutoDirector(false);
      }
      const panSpeed = (20 + this.distance * 0.55) * realDt;
      const forwardX = -Math.sin(this.yaw);
      const forwardZ = -Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);

      this.desiredTarget.x += (forwardX * moveFwd + rightX * moveSide) * panSpeed;
      this.desiredTarget.z += (forwardZ * moveFwd + rightZ * moveSide) * panSpeed;
      this.clampDesiredTarget();
    }

    if (this.autoDirector && animals.length > 0) {
      this.directorTimer -= realDt;
      if (this.directorTimer <= 0) {
        this.directorTimer = 18 + Math.random() * 7;
        this.pickDirectorSubject(animals);
      }
      this.desiredYaw += realDt * 0.055;
    }

    if (this.followedAnimalId !== null) {
      const targetAnimal = animals.find((a) => a.id === this.followedAnimalId) ?? null;
      if (targetAnimal) {
        const cfg = SPECIES_CONFIGS[targetAnimal.species];
        this.desiredTarget.set(
          targetAnimal.pos.x,
          targetAnimal.pos.y + cfg.adultHeight * 0.52,
          targetAnimal.pos.z
        );
      } else {
        this.followedAnimalId = null;
        this.onFollowChanged?.(null);
      }
    }

    const dampT = 1 - Math.exp(-7.5 * realDt);
    this.target.lerp(this.desiredTarget, dampT);
    this.yaw += (this.desiredYaw - this.yaw) * dampT;
    this.pitch += (this.desiredPitch - this.pitch) * dampT;
    this.distance += (this.desiredDistance - this.distance) * dampT;

    this.applyCameraPosition();
  }

  private pickDirectorSubject(animals: RenderAnimal[]): void {
    let best: RenderAnimal | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < animals.length; i++) {
      const a = animals[i];
      const cfg = SPECIES_CONFIGS[a.species];
      let score = cfg.isMainFive ? 18 : 4;
      if (a.state === 'chasing' || a.state === 'defending') score += 45;
      else if (a.state === 'stalking' || a.state === 'courting') score += 32;
      else if (a.state === 'crossing' || a.isSwimming) score += 26;
      else if (a.state === 'drinking' || a.state === 'browsing') score += 16;
      else if (a.state === 'feeding') score += 14;
      else if (a.state === 'perching') score += 12;
      if (a.id === this.lastDirectorId) score -= 35;
      score += Math.random() * 10;

      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }

    if (best) {
      this.lastDirectorId = best.id;
      this.followAnimal(best);
      this.desiredYaw = best.yaw + 2.35;
      this.desiredPitch = 0.28 + Math.random() * 0.14;
      this.desiredDistance = THREE.MathUtils.clamp(
        SPECIES_CONFIGS[best.species].adultRadius * 12 + 7,
        13,
        24
      );
    }
  }

  private applyCameraPosition(): void {
    const horizDist = Math.cos(this.pitch) * this.distance;
    const cx = this.target.x + Math.sin(this.yaw) * horizDist;
    const cz = this.target.z + Math.cos(this.yaw) * horizDist;
    const rawY = this.target.y + Math.sin(this.pitch) * this.distance;
    const minGround = getTerrainHeight(cx, cz) + 1.8;
    const cy = Math.max(minGround, rawY);

    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.target);
  }
}
