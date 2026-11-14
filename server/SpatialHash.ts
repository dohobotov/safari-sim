import type { SimAnimal, WorldCollider } from '../src/shared/types.js';

export class SpatialHash {
  private readonly cellSize: number;
  private buckets = new Map<number, SimAnimal[]>();

  constructor(cellSize = 20) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cz: number): number {
    return ((cx + 512) << 12) ^ (cz + 512);
  }

  public clear(): void {
    this.buckets.clear();
  }

  public insert(animal: SimAnimal): void {
    const cx = Math.floor(animal.pos.x / this.cellSize);
    const cz = Math.floor(animal.pos.z / this.cellSize);
    const k = this.key(cx, cz);
    let list = this.buckets.get(k);
    if (!list) {
      list = [];
      this.buckets.set(k, list);
    }
    list.push(animal);
  }

  public query(x: number, z: number, radius: number): SimAnimal[] {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize);
    const maxZ = Math.floor((z + radius) / this.cellSize);
    const r2 = radius * radius;
    const out: SimAnimal[] = [];

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const list = this.buckets.get(this.key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          if (!a.alive) continue;
          const dx = a.pos.x - x;
          const dz = a.pos.z - z;
          if (dx * dx + dz * dz <= r2) {
            out.push(a);
          }
        }
      }
    }
    return out;
  }
}

export class StaticColliderGrid {
  private readonly cellSize = 12;
  private buckets = new Map<number, WorldCollider[]>();

  constructor(colliders: WorldCollider[]) {
    for (const c of colliders) {
      const cx = Math.floor(c.x / this.cellSize);
      const cz = Math.floor(c.z / this.cellSize);
      const k = ((cx + 512) << 12) ^ (cz + 512);
      let list = this.buckets.get(k);
      if (!list) {
        list = [];
        this.buckets.set(k, list);
      }
      list.push(c);
    }
  }

  public query(x: number, z: number, radius: number): WorldCollider[] {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize);
    const maxZ = Math.floor((z + radius) / this.cellSize);
    const out: WorldCollider[] = [];
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const k = ((cx + 512) << 12) ^ (cz + 512);
        const list = this.buckets.get(k);
        if (list) {
          for (let i = 0; i < list.length; i++) out.push(list[i]);
        }
      }
    }
    return out;
  }
}
