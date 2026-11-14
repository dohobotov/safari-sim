import type { Animal } from '../types';

export class SpatialHash {
  private readonly cellSize: number;
  private buckets = new Map<number, Animal[]>();

  constructor(cellSize = 18) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cz: number): number {
    return ((cx + 512) << 12) ^ (cz + 512);
  }

  public clear(): void {
    this.buckets.clear();
  }

  public insert(animal: Animal): void {
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

  public query(x: number, z: number, radius: number): Animal[] {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize);
    const maxZ = Math.floor((z + radius) / this.cellSize);
    const r2 = radius * radius;
    const out: Animal[] = [];

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
