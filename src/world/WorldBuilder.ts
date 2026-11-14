import * as THREE from 'three';
import type { LogProp, RockProp, TreeNode } from '../shared/types.js';
import {
  INNER_TERRAIN_SIZE,
  OUTER_TERRAIN_RADIUS,
  WATERING_HOLES,
  WORLD_HALF,
  fbm2D,
  getFordFactor,
  getRiverCenterX,
  getRiverHalfWidth,
  getTerrainHeight,
  getTrailFactor,
  getWaterLevel,
  smoothstep,
} from '../shared/TerrainMath.js';
import { generateWorldLayout } from '../shared/WorldLayout.js';

interface GrassInstanceData {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  isJungle: boolean;
  phase: number;
}

interface TerrainVertexMeta {
  x: number;
  z: number;
  h: number;
  cx: number;
  hw: number;
  ford: number;
  trail: number;
  noise: number;
  rockiness: number;
  isOuter: boolean;
}

export class WorldBuilder {
  public readonly group = new THREE.Group();
  public readonly trees: TreeNode[] = [];
  public readonly kopjes: THREE.Vector3[] = [];

  private terrainGeo!: THREE.PlaneGeometry;
  private terrainMat!: THREE.MeshStandardMaterial;
  private innerMeta: TerrainVertexMeta[] = [];

  private outerGeo!: THREE.BufferGeometry;
  private outerMat!: THREE.MeshStandardMaterial;
  private outerMeta: TerrainVertexMeta[] = [];

  private waterGeo!: THREE.PlaneGeometry;
  private waterMesh!: THREE.Mesh;
  private waterMat!: THREE.MeshStandardMaterial;
  private waterBasePos!: Float32Array;

  private foamMesh!: THREE.InstancedMesh;
  private foamMat!: THREE.MeshStandardMaterial;
  private foamData: { x: number; z: number; rotY: number; scale: number; phase: number }[] = [];

  private grassMesh!: THREE.InstancedMesh;
  private grassMat!: THREE.MeshStandardMaterial;
  private grassData: GrassInstanceData[] = [];
  private grassDummy = new THREE.Object3D();

  private foliageMaterials: {
    mat: THREE.MeshStandardMaterial;
    isJungle: boolean;
    baseColor: THREE.Color;
    dryColor: THREE.Color;
  }[] = [];
  private lastColorWetness = -1;

  constructor(scene: THREE.Scene) {
    const layout = generateWorldLayout();
    this.trees = layout.trees;
    for (const k of layout.kopjes) {
      this.kopjes.push(new THREE.Vector3(k.x, k.y, k.z));
    }

    this.buildTerrain();
    this.buildOuterMountainSkirt();
    this.buildWater();
    this.buildShorelineFoam();
    this.buildLilyPads();
    this.buildRocksAndKopjes(layout.rocks);
    this.buildLogs(layout.logs);
    this.buildFlora();
    this.buildWildflowersAndFerns();
    this.buildGrass();

    scene.add(this.group);
    this.updateSeasonVisuals(0.65, 0);
  }

  private buildVertexMeta(x: number, z: number, h: number, isOuter: boolean): TerrainVertexMeta {
    const cx = getRiverCenterX(z);
    const hw = getRiverHalfWidth(z);
    const ford = isOuter ? 0 : getFordFactor(x, z);
    const trail = isOuter ? 0 : getTrailFactor(x, z);
    const noise = fbm2D(x * 0.055 + 4.2, z * 0.055 - 7.1, 2);

    let kopjeFactor = 0;
    if (!isOuter) {
      for (const k of this.kopjes) {
        const d = Math.hypot(x - k.x, z - k.z);
        kopjeFactor = Math.max(kopjeFactor, 1 - smoothstep(4, 15.5, d));
      }
    }
    const edgeDist = Math.max(Math.abs(x), Math.abs(z));
    const rimRock = smoothstep(WORLD_HALF + 3, INNER_TERRAIN_SIZE * 0.52, edgeDist);
    const highRock = smoothstep(7.5, 22, h);
    const rockiness = Math.min(1, Math.max(highRock, kopjeFactor + rimRock * 0.65));

    return { x, z, h, cx, hw, ford, trail, noise, rockiness, isOuter };
  }

  private buildTerrain(): void {
    const segs = 160;
    this.terrainGeo = new THREE.PlaneGeometry(INNER_TERRAIN_SIZE, INNER_TERRAIN_SIZE, segs, segs);
    this.terrainGeo.rotateX(-Math.PI / 2);

    const pos = this.terrainGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    this.terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = getTerrainHeight(x, z);
      pos.setY(i, h);
      this.innerMeta.push(this.buildVertexMeta(x, z, h, false));
    }

    this.terrainGeo.computeVertexNormals();
    this.terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: true,
    });

    const terrainMesh = new THREE.Mesh(this.terrainGeo, this.terrainMat);
    terrainMesh.receiveShadow = true;
    this.group.add(terrainMesh);
  }

  private buildOuterMountainSkirt(): void {
    const innerHalf = INNER_TERRAIN_SIZE * 0.5; // 130
    const segsPerSide = 80; // matches every 2nd vertex of 160-seg plane (still airtight)
    const step = INNER_TERRAIN_SIZE / segsPerSide;

    const perimeter: { x: number; z: number }[] = [];
    for (let k = 0; k < segsPerSide; k++) perimeter.push({ x: -innerHalf + k * step, z: -innerHalf });
    for (let k = 0; k < segsPerSide; k++) perimeter.push({ x: innerHalf, z: -innerHalf + k * step });
    for (let k = 0; k < segsPerSide; k++) perimeter.push({ x: innerHalf - k * step, z: innerHalf });
    for (let k = 0; k < segsPerSide; k++) perimeter.push({ x: -innerHalf, z: innerHalf - k * step });

    const ringCount = 9;
    const ringScales = [1.0, 1.15, 1.35, 1.62, 1.95, 2.34, 2.75, 3.05, OUTER_TERRAIN_RADIUS / innerHalf];
    const perimLen = perimeter.length;

    const positions: number[] = [];
    const indices: number[] = [];

    for (let r = 0; r < ringCount; r++) {
      const t = r / (ringCount - 1);
      const scale = ringScales[r];
      const circleBlend = r === 0 ? 0 : smoothstep(0.15, 0.85, t);

      for (let i = 0; i < perimLen; i++) {
        const p = perimeter[i];
        const sx = p.x * scale;
        const sz = p.z * scale;
        const len = Math.hypot(p.x, p.z) || 1;
        const radius = innerHalf * scale * 1.16;
        const cx = (p.x / len) * radius;
        const cz = (p.z / len) * radius;

        const x = sx * (1 - circleBlend) + cx * circleBlend;
        const z = sz * (1 - circleBlend) + cz * circleBlend;
        const h = getTerrainHeight(x, z);
        positions.push(x, h, z);
        this.outerMeta.push(this.buildVertexMeta(x, z, h, true));
      }
    }

    for (let r = 0; r < ringCount - 1; r++) {
      const rowA = r * perimLen;
      const rowB = (r + 1) * perimLen;
      for (let i = 0; i < perimLen; i++) {
        const next = (i + 1) % perimLen;
        const a = rowA + i;
        const b = rowA + next;
        const c = rowB + i;
        const d = rowB + next;
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    this.outerGeo = new THREE.BufferGeometry();
    this.outerGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.outerGeo.setIndex(indices);
    this.outerGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(this.outerMeta.length * 3), 3)
    );
    this.outerGeo.computeVertexNormals();

    this.outerMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02,
      flatShading: true,
    });

    const outerMesh = new THREE.Mesh(this.outerGeo, this.outerMat);
    outerMesh.receiveShadow = true;
    this.group.add(outerMesh);
  }

  private buildWater(): void {
    // Keep water plane inside the natural valley rim so water never sticks out past terrain
    const waterSpan = 236;
    const segs = 96;
    this.waterGeo = new THREE.PlaneGeometry(waterSpan, waterSpan, segs, segs);
    this.waterGeo.rotateX(-Math.PI / 2);

    const pos = this.waterGeo.attributes.position as THREE.BufferAttribute;
    this.waterBasePos = new Float32Array(pos.array.length);
    this.waterBasePos.set(pos.array);

    const colors = new Float32Array(pos.count * 3);
    const cDeep = new THREE.Color(0x165f70);
    const cShallow = new THREE.Color(0x41a69e);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = getTerrainHeight(x, z);
      const shallowT = smoothstep(-2.1, -0.35, h);
      tmp.copy(cDeep).lerp(cShallow, shallowT);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    this.waterGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.waterMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      roughness: 0.14,
      metalness: 0.24,
      flatShading: true,
    });

    this.waterMesh = new THREE.Mesh(this.waterGeo, this.waterMat);
    this.waterMesh.receiveShadow = true;
    this.group.add(this.waterMesh);
  }

  private buildShorelineFoam(): void {
    const foamGeo = new THREE.PlaneGeometry(0.95, 0.24);
    foamGeo.rotateX(-Math.PI / 2);
    this.foamMat = new THREE.MeshStandardMaterial({
      color: 0xe6f7f7,
      transparent: true,
      opacity: 0.42,
      roughness: 0.5,
      depthWrite: false,
    });

    for (let i = 0; i < 88; i++) {
      const z = -98 + (i / 88) * 196;
      const cx = getRiverCenterX(z);
      const hw = getRiverHalfWidth(z);
      const side = i % 2 === 0 ? -1 : 1;
      const inFord = getFordFactor(cx, z) > 0.35;
      const x = inFord ? cx + ((i % 5) - 2) * 1.4 : cx + side * (hw - 0.55);
      this.foamData.push({
        x,
        z,
        rotY: Math.sin(z * 0.08) * 0.45 + (inFord ? 0.3 : Math.PI * 0.5),
        scale: inFord ? 1.5 + (i % 3) * 0.45 : 0.85 + (i % 4) * 0.2,
        phase: i * 0.65,
      });
    }

    this.foamMesh = new THREE.InstancedMesh(foamGeo, this.foamMat, this.foamData.length);
    this.group.add(this.foamMesh);
  }

  private buildLilyPads(): void {
    const padGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.04, 7, 1, false, 0, Math.PI * 1.82);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x3f8440,
      roughness: 0.78,
      flatShading: true,
    });
    const flowerGeo = new THREE.ConeGeometry(0.14, 0.22, 5);
    const flowerMat = new THREE.MeshStandardMaterial({
      color: 0xf7bfd4,
      roughness: 0.6,
      flatShading: true,
    });

    const pads: { x: number; z: number; s: number; rot: number; hasFlower: boolean }[] = [];
    let seed = 4242;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (const h of WATERING_HOLES) {
      for (let i = 0; i < 12; i++) {
        const ang = rand() * Math.PI * 2;
        const r = h.radius * (0.35 + rand() * 0.48);
        pads.push({
          x: h.x + Math.cos(ang) * r,
          z: h.z + Math.sin(ang) * r,
          s: 0.7 + rand() * 0.65,
          rot: rand() * Math.PI * 2,
          hasFlower: rand() < 0.35,
        });
      }
    }

    const padMesh = new THREE.InstancedMesh(padGeo, padMat, pads.length);
    const dummy = new THREE.Object3D();
    const flowerDummy = new THREE.Object3D();
    const flowerList: { x: number; z: number }[] = [];

    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      dummy.position.set(p.x, getWaterLevel(0.65) + 0.03, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      padMesh.setMatrixAt(i, dummy.matrix);
      if (p.hasFlower) flowerList.push({ x: p.x, z: p.z });
    }
    padMesh.instanceMatrix.needsUpdate = true;
    this.group.add(padMesh);

    if (flowerList.length > 0) {
      const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerList.length);
      for (let i = 0; i < flowerList.length; i++) {
        flowerDummy.position.set(flowerList[i].x, getWaterLevel(0.65) + 0.12, flowerList[i].z);
        flowerDummy.rotation.set(Math.PI, i * 0.7, 0);
        flowerDummy.updateMatrix();
        flowerMesh.setMatrixAt(i, flowerDummy.matrix);
      }
      flowerMesh.instanceMatrix.needsUpdate = true;
      this.group.add(flowerMesh);
    }
  }

  private buildRocksAndKopjes(rocks: RockProp[]): void {
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x7d766c,
      roughness: 0.9,
      flatShading: true,
    });
    const mossyMat = new THREE.MeshStandardMaterial({
      color: 0x626b55,
      roughness: 0.92,
      flatShading: true,
    });

    for (const r of rocks) {
      const isMossy = r.x > getRiverCenterX(r.z) && r.sy < 0.95;
      const m = new THREE.Mesh(rockGeo, isMossy ? mossyMat : rockMat);
      m.scale.set(r.sx, r.sy, r.sz);
      m.position.set(r.x, r.y + r.sy * 0.35, r.z);
      m.rotation.set(r.rotX, r.rotY, r.rotZ);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  private buildLogs(logs: LogProp[]): void {
    const logMat = new THREE.MeshStandardMaterial({
      color: 0x6a553e,
      roughness: 0.94,
      flatShading: true,
    });
    const mossMat = new THREE.MeshStandardMaterial({
      color: 0x456936,
      roughness: 0.9,
      flatShading: true,
    });

    for (const l of logs) {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(l.radius * 0.82, l.radius, l.length, 7), logMat);
      trunk.rotation.z = Math.PI * 0.5;
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      g.add(trunk);

      const stub = new THREE.Mesh(new THREE.CylinderGeometry(l.radius * 0.3, l.radius * 0.45, l.length * 0.34, 5), logMat);
      stub.position.set(l.length * 0.16, l.radius * 0.7, 0.12);
      stub.rotation.set(0.3, 0, -0.55);
      stub.castShadow = true;
      g.add(stub);

      const moss = new THREE.Mesh(new THREE.DodecahedronGeometry(l.radius * 0.7, 0), mossMat);
      moss.scale.set(1.6, 0.45, 0.9);
      moss.position.set(-l.length * 0.18, l.radius * 0.75, 0);
      g.add(moss);

      g.position.set(l.x, l.y + l.radius * 0.45, l.z);
      g.rotation.y = l.rotY;
      this.group.add(g);
    }
  }

  private buildFlora(): void {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c432d, roughness: 0.92, flatShading: true });
    const baobabBarkMat = new THREE.MeshStandardMaterial({ color: 0x7a6552, roughness: 0.94, flatShading: true });
    const snagWoodMat = new THREE.MeshStandardMaterial({ color: 0x9b9082, roughness: 0.95, flatShading: true });
    const jungleTrunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3827, roughness: 0.9, flatShading: true });

    const acaciaMat = new THREE.MeshStandardMaterial({ color: 0x5d7a36, roughness: 0.88, flatShading: true });
    this.foliageMaterials.push({
      mat: acaciaMat,
      isJungle: false,
      baseColor: new THREE.Color(0x557e34),
      dryColor: new THREE.Color(0x8e8340),
    });

    const baobabLeafMat = new THREE.MeshStandardMaterial({ color: 0x5e7d34, roughness: 0.88, flatShading: true });
    this.foliageMaterials.push({
      mat: baobabLeafMat,
      isJungle: false,
      baseColor: new THREE.Color(0x4f7d32),
      dryColor: new THREE.Color(0x9a8944),
    });

    const jungleLeafMat = new THREE.MeshStandardMaterial({ color: 0x266c36, roughness: 0.85, flatShading: true });
    this.foliageMaterials.push({
      mat: jungleLeafMat,
      isJungle: true,
      baseColor: new THREE.Color(0x216b35),
      dryColor: new THREE.Color(0x3a6f39),
    });

    const reedMat = new THREE.MeshStandardMaterial({ color: 0x4f7836, roughness: 0.88, flatShading: true });
    this.foliageMaterials.push({
      mat: reedMat,
      isJungle: true,
      baseColor: new THREE.Color(0x437c34),
      dryColor: new THREE.Color(0x9a8948),
    });

    const bushGeo = new THREE.DodecahedronGeometry(0.95, 0);

    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      if (t.kind === 'acacia') {
        const tree = this.createAcaciaTree(t.scale, trunkMat, acaciaMat);
        tree.position.set(t.x, t.y - 0.1, t.z);
        tree.rotation.y = t.rotY;
        this.group.add(tree);
      } else if (t.kind === 'baobab') {
        const tree = this.createBaobabTree(t.scale, baobabBarkMat, baobabLeafMat);
        tree.position.set(t.x, t.y - 0.12, t.z);
        tree.rotation.y = t.rotY;
        this.group.add(tree);
      } else if (t.kind === 'snag') {
        const tree = this.createSnagTree(t.scale, snagWoodMat);
        tree.position.set(t.x, t.y - 0.1, t.z);
        tree.rotation.y = t.rotY;
        this.group.add(tree);
      } else if (t.kind === 'palm') {
        const tree = this.createPalmTree(t.scale, jungleTrunkMat, jungleLeafMat);
        tree.position.set(t.x, t.y - 0.12, t.z);
        tree.rotation.y = t.rotY;
        this.group.add(tree);
      } else if (t.kind === 'jungle') {
        const tree = this.createJungleTree(t.scale, jungleTrunkMat, jungleLeafMat);
        tree.position.set(t.x, t.y - 0.12, t.z);
        tree.rotation.y = t.rotY;
        this.group.add(tree);
      } else if (t.kind === 'bush') {
        const g = new THREE.Group();
        const inJungle = t.x > getRiverCenterX(t.z);
        const clumps = 2 + (i % 2);
        for (let c = 0; c < clumps; c++) {
          const m = new THREE.Mesh(bushGeo, inJungle ? jungleLeafMat : acaciaMat);
          const s = 0.65 + ((i + c) % 4) * 0.16;
          m.scale.set(s * 1.2, s * 0.8, s * 1.15);
          m.position.set((((i + c) % 3) - 1) * 0.55, s * 0.45, (((i * 2 + c) % 3) - 1) * 0.55);
          m.castShadow = true;
          m.receiveShadow = true;
          g.add(m);
        }
        g.position.set(t.x, t.y - 0.1, t.z);
        this.group.add(g);
      }
    }

    // Riverbank Reeds & Bamboo clusters
    let seed = 8808;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const reedGeo = new THREE.CylinderGeometry(0.04, 0.07, 2.2, 4);
    for (let i = 0; i < 125; i++) {
      const z = -106 + rand() * 212;
      const cx = getRiverCenterX(z);
      const hw = getRiverHalfWidth(z);
      const side = rand() < 0.72 ? 1 : -1;
      const x = cx + side * (hw - 0.5 + rand() * 4.5);
      if (getFordFactor(x, z) > 0.4) continue;
      const y = getTerrainHeight(x, z);
      if (y < -0.55 || y > 1.25) continue;

      const cluster = new THREE.Group();
      const stalks = 4 + Math.floor(rand() * 4);
      for (let s = 0; s < stalks; s++) {
        const stalk = new THREE.Mesh(reedGeo, reedMat);
        const hScale = 0.7 + rand() * 0.65;
        stalk.scale.set(1, hScale, 1);
        stalk.position.set((rand() - 0.5) * 0.9, hScale * 0.95, (rand() - 0.5) * 0.9);
        stalk.rotation.set((rand() - 0.5) * 0.22, 0, (rand() - 0.5) * 0.22);
        cluster.add(stalk);
      }
      cluster.position.set(x, y - 0.1, z);
      this.group.add(cluster);
    }
  }

  private buildWildflowersAndFerns(): void {
    let seed = 5150;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    // Wildflowers (small colorful blossoms near meadows and watering holes)
    const flowerGeo = new THREE.DodecahedronGeometry(0.14, 0);
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, flatShading: true });
    const fCount = 340;
    const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, fCount);
    const dummy = new THREE.Object3D();
    const palette = [0xf6c445, 0xe87b5a, 0xd8a6f0, 0xfff0b5, 0x7cb9e8];
    const col = new THREE.Color();

    let placed = 0;
    let tries = 0;
    while (placed < fCount && tries < fCount * 5) {
      tries++;
      const x = -104 + rand() * 208;
      const z = -104 + rand() * 208;
      const y = getTerrainHeight(x, z);
      if (y < 0.25 || y > 4.2) continue;
      if (getTrailFactor(x, z) > 0.45) continue;

      dummy.position.set(x, y + 0.16, z);
      const s = 0.7 + rand() * 0.75;
      dummy.scale.set(s, s * 0.65, s);
      dummy.rotation.y = rand() * Math.PI * 2;
      dummy.updateMatrix();
      flowerMesh.setMatrixAt(placed, dummy.matrix);
      col.setHex(palette[placed % palette.length]);
      flowerMesh.setColorAt(placed, col);
      placed++;
    }
    flowerMesh.count = placed;
    flowerMesh.instanceMatrix.needsUpdate = true;
    if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
    this.group.add(flowerMesh);

    // Lush Tropical Ferns in jungle & riverbanks
    const fernGeo = new THREE.ConeGeometry(0.58, 0.28, 5);
    const fernMat = new THREE.MeshStandardMaterial({ color: 0x2e7b37, roughness: 0.88, flatShading: true });
    const fernCount = 220;
    const fernMesh = new THREE.InstancedMesh(fernGeo, fernMat, fernCount);

    let fPlaced = 0;
    let fTries = 0;
    while (fPlaced < fernCount && fTries < fernCount * 6) {
      fTries++;
      const z = -102 + rand() * 204;
      const cx = getRiverCenterX(z);
      const x = cx + 6 + rand() * 92;
      const y = getTerrainHeight(x, z);
      if (y < 0.2 || y > 4.5) continue;

      dummy.position.set(x, y + 0.14, z);
      const s = 0.8 + rand() * 0.85;
      dummy.scale.set(s, s * 0.7, s);
      dummy.rotation.set(Math.PI, rand() * Math.PI * 2, 0);
      dummy.updateMatrix();
      fernMesh.setMatrixAt(fPlaced, dummy.matrix);
      fPlaced++;
    }
    fernMesh.count = fPlaced;
    fernMesh.instanceMatrix.needsUpdate = true;
    this.group.add(fernMesh);
  }

  private createAcaciaTree(scale: number, trunkMat: THREE.Material, leafMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.46, 4.6, 6), trunkMat);
    trunk.position.y = 2.3;
    trunk.rotation.z = 0.05;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    g.add(trunk);

    const branchGeo = new THREE.CylinderGeometry(0.11, 0.2, 2.2, 5);
    const branchAngles = [0, 2.1, 4.2];
    branchAngles.forEach((ang, idx) => {
      const b = new THREE.Mesh(branchGeo, trunkMat);
      b.position.set(Math.cos(ang) * 0.7, 4.4, Math.sin(ang) * 0.7);
      b.rotation.z = Math.cos(ang) * -0.55;
      b.rotation.x = Math.sin(ang) * 0.55;
      b.castShadow = true;
      g.add(b);

      const crown = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 1.5, 0.75, 7), leafMat);
      crown.position.set(Math.cos(ang) * (1.2 + idx * 0.2), 5.3 + idx * 0.25, Math.sin(ang) * (1.2 + idx * 0.2));
      crown.castShadow = true;
      crown.receiveShadow = true;
      g.add(crown);
    });

    const topCrown = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 2.1, 0.85, 8), leafMat);
    topCrown.position.y = 5.75;
    topCrown.castShadow = true;
    topCrown.receiveShadow = true;
    g.add(topCrown);

    g.scale.setScalar(scale);
    return g;
  }

  private createBaobabTree(scale: number, barkMat: THREE.Material, leafMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();

    // Thick bottle-shaped ancient trunk + root buttresses
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.65, 5.2, 8), barkMat);
    trunk.position.y = 2.6;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    g.add(trunk);

    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + 0.4;
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.52, 2.0, 5), barkMat);
      root.position.set(Math.cos(ang) * 1.1, 0.9, Math.sin(ang) * 1.1);
      root.rotation.z = Math.cos(ang) * 0.35;
      root.rotation.x = Math.sin(ang) * -0.35;
      root.castShadow = true;
      g.add(root);
    }

    // Thick stubby upper limbs + high tufts of leaves
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.46, 2.5, 6), barkMat);
      limb.position.set(Math.cos(ang) * 1.25, 5.5, Math.sin(ang) * 1.25);
      limb.rotation.z = Math.cos(ang) * -0.68;
      limb.rotation.x = Math.sin(ang) * 0.68;
      limb.castShadow = true;
      g.add(limb);

      const tuft = new THREE.Mesh(new THREE.DodecahedronGeometry(1.45, 0), leafMat);
      tuft.scale.set(1.25, 0.65, 1.25);
      tuft.position.set(Math.cos(ang) * 2.1, 6.8 + (i % 2) * 0.4, Math.sin(ang) * 2.1);
      tuft.castShadow = true;
      tuft.receiveShadow = true;
      g.add(tuft);
    }

    const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(1.85, 0), leafMat);
    crown.scale.set(1.3, 0.72, 1.3);
    crown.position.y = 7.4;
    crown.castShadow = true;
    crown.receiveShadow = true;
    g.add(crown);

    g.scale.setScalar(scale);
    return g;
  }

  private createSnagTree(scale: number, woodMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.38, 6.2, 6), woodMat);
    trunk.position.y = 3.1;
    trunk.rotation.z = 0.04;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    g.add(trunk);

    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, 2.4, 5), woodMat);
    b1.position.set(0.75, 5.4, 0.1);
    b1.rotation.z = -0.82;
    b1.castShadow = true;
    g.add(b1);

    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, 2.1, 5), woodMat);
    b2.position.set(-0.68, 4.9, -0.15);
    b2.rotation.z = 0.88;
    b2.rotation.x = 0.25;
    b2.castShadow = true;
    g.add(b2);

    const perchLimb = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.8, 5), woodMat);
    perchLimb.position.set(0.35, 6.1, -0.35);
    perchLimb.rotation.set(0.7, 0, -0.75);
    perchLimb.castShadow = true;
    g.add(perchLimb);

    g.scale.setScalar(scale);
    return g;
  }

  private createJungleTree(scale: number, trunkMat: THREE.Material, leafMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 5.0, 6), trunkMat);
    trunk.position.y = 2.5;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    g.add(trunk);

    const canopyGeo = new THREE.DodecahedronGeometry(2.1, 0);
    const c1 = new THREE.Mesh(canopyGeo, leafMat);
    c1.scale.set(1.25, 0.95, 1.25);
    c1.position.set(0, 5.5, 0);
    c1.castShadow = true;
    c1.receiveShadow = true;
    g.add(c1);

    const c2 = new THREE.Mesh(canopyGeo, leafMat);
    c2.scale.set(0.95, 0.85, 0.95);
    c2.position.set(1.2, 4.7, 0.8);
    c2.castShadow = true;
    g.add(c2);

    const c3 = new THREE.Mesh(canopyGeo, leafMat);
    c3.scale.set(0.9, 0.8, 0.9);
    c3.position.set(-1.1, 4.9, -0.7);
    c3.castShadow = true;
    g.add(c3);

    g.scale.setScalar(scale);
    return g;
  }

  private createPalmTree(scale: number, trunkMat: THREE.Material, leafMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    let curY = 0;
    let curX = 0;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.18 - i * 0.02, 0.23 - i * 0.02, 1.5, 5), trunkMat);
      curY += 1.35;
      curX += i * 0.14;
      seg.position.set(curX, curY - 0.6, 0);
      seg.rotation.z = -0.07 * (i + 1);
      seg.castShadow = true;
      g.add(seg);
    }

    const frondGeo = new THREE.ConeGeometry(0.55, 2.8, 4);
    frondGeo.rotateX(Math.PI * 0.45);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.set(curX + 0.25, curY + 0.1, 0);
      pivot.rotation.y = ang;
      const frond = new THREE.Mesh(frondGeo, leafMat);
      frond.position.set(0, -0.15, 1.35);
      frond.castShadow = true;
      pivot.add(frond);
      g.add(pivot);
    }

    g.scale.setScalar(scale);
    return g;
  }

  private buildGrass(): void {
    const count = 3200;
    const verts: number[] = [];
    const blades = [
      { ang: 0, h: 0.56, tiltX: 0.14, w: 0.14 },
      { ang: 2.09, h: 0.48, tiltX: 0.18, w: 0.13 },
      { ang: 4.18, h: 0.5, tiltX: 0.16, w: 0.13 },
    ];
    for (const b of blades) {
      const ca = Math.cos(b.ang);
      const sa = Math.sin(b.ang);
      verts.push(-b.w * ca, 0, -b.w * sa, b.w * ca, 0, b.w * sa, -sa * b.tiltX, b.h, ca * b.tiltX);
    }
    const bladeGeo = new THREE.BufferGeometry();
    bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    bladeGeo.computeVertexNormals();

    this.grassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      side: THREE.DoubleSide,
      flatShading: true,
    });

    this.grassMesh = new THREE.InstancedMesh(bladeGeo, this.grassMat, count);
    this.grassMesh.receiveShadow = true;

    let seed = 9001;
    const rand = () => {
      seed = (seed * 48271) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    let placed = 0;
    let tries = 0;
    while (placed < count && tries < count * 5) {
      tries++;
      const x = -110 + rand() * 220;
      const z = -110 + rand() * 220;
      const y = getTerrainHeight(x, z);
      if (y < 0.24) continue;
      if (getTrailFactor(x, z) > 0.55) continue;
      if (this.kopjes.some((k) => Math.hypot(x - k.x, z - k.z) < 8.5)) continue;

      const cx = getRiverCenterX(z);
      const isJungle = x > cx;
      const scale = (isJungle ? 0.85 : 0.65) + rand() * 0.95;
      const rotY = rand() * Math.PI * 2;

      this.grassData.push({
        x,
        y: y - 0.05,
        z,
        scale,
        rotY,
        isJungle,
        phase: rand() * Math.PI * 2,
      });

      this.grassDummy.position.set(x, y - 0.05, z);
      this.grassDummy.rotation.set(0, rotY, 0);
      this.grassDummy.scale.set(1, scale, 1);
      this.grassDummy.updateMatrix();
      this.grassMesh.setMatrixAt(placed, this.grassDummy.matrix);
      this.grassMesh.setColorAt(placed, new THREE.Color(isJungle ? 0x2e7a3a : 0x999142));
      placed++;
    }
    this.grassMesh.count = placed;
    this.grassMesh.instanceMatrix.needsUpdate = true;
    if (this.grassMesh.instanceColor) this.grassMesh.instanceColor.needsUpdate = true;
    this.group.add(this.grassMesh);
  }

  private paintTerrainColors(
    metaList: TerrainVertexMeta[],
    colAttr: THREE.BufferAttribute,
    wetness: number,
    waterY: number
  ): void {
    const savDry = new THREE.Color(0xc59b4e);
    const savWet = new THREE.Color(0x6e8f3c);
    const savBase = savDry.clone().lerp(savWet, wetness);

    const junDry = new THREE.Color(0x4c7838);
    const junWet = new THREE.Color(0x286b32);
    const junBase = junDry.clone().lerp(junWet, wetness);

    const sandColor = new THREE.Color(0xcab27d);
    const mudColor = new THREE.Color(0x6f5a3e);
    const savTrailColor = new THREE.Color(0x9b7a48);
    const junTrailColor = new THREE.Color(0x5b4a33);
    const rockColor = new THREE.Color(0x7c766b);
    const mountainColor = new THREE.Color(0x88847e);
    const tmp = new THREE.Color();

    for (let i = 0; i < metaList.length; i++) {
      const m = metaList[i];
      const isJungle = m.x > m.cx;
      const biomeBlend = smoothstep(m.cx - m.hw * 0.6, m.cx + m.hw * 0.6, m.x);

      tmp.copy(savBase).lerp(junBase, biomeBlend);
      tmp.offsetHSL(0, 0, (m.noise - 0.5) * 0.06);

      if (!m.isOuter && m.trail > 0.04) {
        const tCol = isJungle ? junTrailColor : savTrailColor;
        tmp.lerp(tCol, m.trail * 0.68);
      }

      if (!m.isOuter) {
        const heightAboveWater = m.h - waterY;
        if (heightAboveWater < 0.78) {
          const bankT = 1 - smoothstep(-0.25, 0.78, heightAboveWater);
          const shoreColor = isJungle || m.ford < 0.35 ? mudColor : sandColor;
          tmp.lerp(shoreColor, bankT * 0.88);
        }
      }

      if (m.rockiness > 0.02) {
        const targetRock = m.h > 14 ? mountainColor : rockColor;
        tmp.lerp(targetRock, m.rockiness * 0.86);
      }

      colAttr.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    colAttr.needsUpdate = true;
  }

  public updateSeasonVisuals(wetness: number, rainIntensity: number): void {
    const waterY = getWaterLevel(wetness);
    this.waterMesh.position.y = waterY;

    if (Math.abs(wetness - this.lastColorWetness) > 0.012) {
      this.lastColorWetness = wetness;

      this.paintTerrainColors(
        this.innerMeta,
        this.terrainGeo.attributes.color as THREE.BufferAttribute,
        wetness,
        waterY
      );
      this.paintTerrainColors(
        this.outerMeta,
        this.outerGeo.attributes.color as THREE.BufferAttribute,
        wetness,
        waterY
      );

      for (const fm of this.foliageMaterials) {
        fm.mat.color.copy(fm.dryColor).lerp(fm.baseColor, wetness);
      }

      const gSavDry = new THREE.Color(0xb89643);
      const gSavWet = new THREE.Color(0x699539);
      const gJunDry = new THREE.Color(0x467e36);
      const gJunWet = new THREE.Color(0x287c37);
      const gSav = gSavDry.lerp(gSavWet, wetness);
      const gJun = gJunDry.lerp(gJunWet, wetness);
      const tmp = new THREE.Color();

      for (let i = 0; i < this.grassData.length; i++) {
        const gd = this.grassData[i];
        tmp.copy(gd.isJungle ? gJun : gSav);
        tmp.offsetHSL(0, 0, (gd.phase / (Math.PI * 2) - 0.5) * 0.07);
        this.grassMesh.setColorAt(i, tmp);
      }
      if (this.grassMesh.instanceColor) this.grassMesh.instanceColor.needsUpdate = true;
    }

    this.terrainMat.roughness = 0.92 - rainIntensity * 0.25;
    this.outerMat.roughness = 0.94 - rainIntensity * 0.15;
  }

  public animateEnvironment(realTime: number, windStrength: number, waterY: number): void {
    const pos = this.waterGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const bx = this.waterBasePos[i * 3];
      const bz = this.waterBasePos[i * 3 + 2];
      const wave =
        Math.sin(bx * 0.28 + realTime * 1.9) * 0.035 +
        Math.cos(bz * 0.22 - realTime * 1.4) * 0.03;
      pos.setY(i, wave);
    }
    pos.needsUpdate = true;

    // Animate shoreline foam ripples along banks and shallow fords
    const dummy = this.grassDummy;
    for (let i = 0; i < this.foamData.length; i++) {
      const f = this.foamData[i];
      const pulse = 0.85 + Math.sin(realTime * 2.4 + f.phase) * 0.25;
      dummy.position.set(f.x, waterY + 0.045, f.z);
      dummy.rotation.set(0, f.rotY, 0);
      dummy.scale.set(f.scale * pulse, 1, pulse);
      dummy.updateMatrix();
      this.foamMesh.setMatrixAt(i, dummy.matrix);
    }
    this.foamMesh.instanceMatrix.needsUpdate = true;

    // Gentle wind sway on grass tufts
    const swayAmp = 0.07 + windStrength * 0.1;
    for (let i = 0; i < this.grassData.length; i++) {
      const g = this.grassData[i];
      const sway = Math.sin(realTime * 2.1 + g.phase + g.x * 0.08) * swayAmp;
      this.grassDummy.position.set(g.x, g.y, g.z);
      this.grassDummy.rotation.set(sway, g.rotY, sway * 0.5);
      this.grassDummy.scale.set(1, g.scale, 1);
      this.grassDummy.updateMatrix();
      this.grassMesh.setMatrixAt(i, this.grassDummy.matrix);
    }
    this.grassMesh.instanceMatrix.needsUpdate = true;
  }
}
