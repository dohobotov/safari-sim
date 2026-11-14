import * as THREE from 'three';
import type { TreeNode } from '../types';
import {
  TERRAIN_SIZE,
  WATERING_HOLES,
  WORLD_HALF,
  fbm2D,
  getFordFactor,
  getRiverCenterX,
  getRiverHalfWidth,
  getTerrainHeight,
  getWaterLevel,
  smoothstep,
} from './TerrainMath';

interface GrassInstanceData {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  isJungle: boolean;
  phase: number;
}

export class WorldBuilder {
  public readonly group = new THREE.Group();
  public readonly trees: TreeNode[] = [];
  public readonly kopjes: THREE.Vector3[] = [
    new THREE.Vector3(-48, 0, -8),
    new THREE.Vector3(-82, 0, -55),
    new THREE.Vector3(-36, 0, 75),
  ];

  private terrainGeo!: THREE.PlaneGeometry;
  private terrainMesh!: THREE.Mesh;
  private terrainMat!: THREE.MeshStandardMaterial;
  private terrainVertexMeta: {
    x: number;
    z: number;
    h: number;
    cx: number;
    hw: number;
    ford: number;
    noise: number;
    rockiness: number;
  }[] = [];

  private waterGeo!: THREE.PlaneGeometry;
  private waterMesh!: THREE.Mesh;
  private waterMat!: THREE.MeshStandardMaterial;
  private waterBasePos!: Float32Array;

  private grassMesh!: THREE.InstancedMesh;
  private grassMat!: THREE.MeshStandardMaterial;
  private grassData: GrassInstanceData[] = [];
  private grassDummy = new THREE.Object3D();

  private foliageMaterials: { mat: THREE.MeshStandardMaterial; isJungle: boolean; baseColor: THREE.Color; dryColor: THREE.Color }[] = [];
  private lastColorWetness = -1;

  constructor(scene: THREE.Scene) {
    this.buildTerrain();
    this.buildWater();
    this.buildKopjes();
    this.buildFlora();
    this.buildGrass();
    scene.add(this.group);
    this.updateSeasonVisuals(0.65, 0);
  }

  private buildTerrain(): void {
    const segs = 148;
    this.terrainGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segs, segs);
    this.terrainGeo.rotateX(-Math.PI / 2);

    const pos = this.terrainGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    this.terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = getTerrainHeight(x, z);
      pos.setY(i, h);

      const cx = getRiverCenterX(z);
      const hw = getRiverHalfWidth(z);
      const ford = getFordFactor(x, z);
      const noise = fbm2D(x * 0.06 + 4.2, z * 0.06 - 7.1, 2);

      // Kopje & cliff rockiness
      let kopjeFactor = 0;
      for (const k of this.kopjes) {
        const d = Math.hypot(x - k.x, z - k.z);
        kopjeFactor = Math.max(kopjeFactor, 1 - smoothstep(4, 15, d));
      }
      const edgeDist = Math.max(Math.abs(x), Math.abs(z));
      const rimRock = smoothstep(WORLD_HALF + 2, TERRAIN_SIZE * 0.5, edgeDist);
      const rockiness = Math.min(1, kopjeFactor + rimRock);

      this.terrainVertexMeta.push({ x, z, h, cx, hw, ford, noise, rockiness });
    }

    this.terrainGeo.computeVertexNormals();
    this.terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: true,
    });

    this.terrainMesh = new THREE.Mesh(this.terrainGeo, this.terrainMat);
    this.terrainMesh.receiveShadow = true;
    this.group.add(this.terrainMesh);
  }

  private buildWater(): void {
    const segs = 96;
    this.waterGeo = new THREE.PlaneGeometry(TERRAIN_SIZE - 4, TERRAIN_SIZE - 4, segs, segs);
    this.waterGeo.rotateX(-Math.PI / 2);

    const pos = this.waterGeo.attributes.position as THREE.BufferAttribute;
    this.waterBasePos = new Float32Array(pos.array.length);
    this.waterBasePos.set(pos.array);

    const colors = new Float32Array(pos.count * 3);
    const cDeep = new THREE.Color(0x165e6f);
    const cShallow = new THREE.Color(0x3a9b96);
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
      opacity: 0.78,
      roughness: 0.16,
      metalness: 0.25,
      flatShading: true,
    });

    this.waterMesh = new THREE.Mesh(this.waterGeo, this.waterMat);
    this.waterMesh.receiveShadow = true;
    this.group.add(this.waterMesh);
  }

  private buildKopjes(): void {
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x7b756c,
      roughness: 0.9,
      flatShading: true,
    });

    for (const k of this.kopjes) {
      k.y = getTerrainHeight(k.x, k.z);
      const cluster = new THREE.Group();
      const count = 9;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + i * 0.7;
        const dist = i === 0 ? 0 : 1.6 + (i % 4) * 1.45;
        const rx = k.x + Math.cos(ang) * dist;
        const rz = k.z + Math.sin(ang) * dist;
        const ry = getTerrainHeight(rx, rz);

        const rock = new THREE.Mesh(rockGeo, rockMat);
        const sx = i === 0 ? 3.8 : 1.3 + ((i * 37) % 10) * 0.22;
        const sy = i === 0 ? 2.5 : 0.9 + ((i * 19) % 10) * 0.16;
        const sz = i === 0 ? 3.3 : 1.2 + ((i * 53) % 10) * 0.22;
        rock.scale.set(sx, sy, sz);
        rock.position.set(rx, ry + sy * 0.35, rz);
        rock.rotation.set((i % 3) * 0.25, ang, (i % 2) * 0.2);
        rock.castShadow = true;
        rock.receiveShadow = true;
        cluster.add(rock);
      }
      this.group.add(cluster);
    }

    // Scatter smaller riverbank stones near fords
    for (let i = 0; i < 24; i++) {
      const z = -90 + i * 7.8;
      const cx = getRiverCenterX(z);
      const hw = getRiverHalfWidth(z);
      const side = i % 2 === 0 ? -1 : 1;
      const rx = cx + side * (hw + 0.5 + (i % 3) * 1.1);
      const ry = getTerrainHeight(rx, z);
      const rock = new THREE.Mesh(rockGeo, rockMat);
      const s = 0.45 + (i % 4) * 0.24;
      rock.scale.set(s * 1.3, s * 0.75, s);
      rock.position.set(rx, ry + s * 0.25, z);
      rock.rotation.y = i * 1.1;
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.group.add(rock);
    }
  }

  private buildFlora(): void {
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x5c432d,
      roughness: 0.92,
      flatShading: true,
    });
    const jungleTrunkMat = new THREE.MeshStandardMaterial({
      color: 0x4b3827,
      roughness: 0.9,
      flatShading: true,
    });

    const acaciaMat = new THREE.MeshStandardMaterial({
      color: 0x5d7a36,
      roughness: 0.88,
      flatShading: true,
    });
    this.foliageMaterials.push({
      mat: acaciaMat,
      isJungle: false,
      baseColor: new THREE.Color(0x557e34),
      dryColor: new THREE.Color(0x8e8340),
    });

    const jungleLeafMat = new THREE.MeshStandardMaterial({
      color: 0x266c36,
      roughness: 0.85,
      flatShading: true,
    });
    this.foliageMaterials.push({
      mat: jungleLeafMat,
      isJungle: true,
      baseColor: new THREE.Color(0x216b35),
      dryColor: new THREE.Color(0x3a6f39),
    });

    const reedMat = new THREE.MeshStandardMaterial({
      color: 0x4f7836,
      roughness: 0.88,
      flatShading: true,
    });
    this.foliageMaterials.push({
      mat: reedMat,
      isJungle: true,
      baseColor: new THREE.Color(0x437c34),
      dryColor: new THREE.Color(0x9a8948),
    });

    // Deterministic pseudo-random generator
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const isNearWaterhole = (x: number, z: number) =>
      WATERING_HOLES.some((h) => Math.hypot(x - h.x, z - h.z) < h.radius + 2.5);

    const isNearKopje = (x: number, z: number) =>
      this.kopjes.some((k) => Math.hypot(x - k.x, z - k.z) < 9.5);

    // 1. Savanna Umbrella Acacias (approx 46 trees)
    let acaciaCount = 0;
    let attempts = 0;
    while (acaciaCount < 48 && attempts < 450) {
      attempts++;
      const x = -106 + rand() * 94;
      const z = -104 + rand() * 208;
      const cx = getRiverCenterX(z);
      const hw = getRiverHalfWidth(z);
      if (x > cx - hw - 4) continue;
      if (isNearWaterhole(x, z) || isNearKopje(x, z)) continue;
      const y = getTerrainHeight(x, z);
      if (y < 0.35) continue;

      // Keep minimum spacing
      if (this.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 9.5)) continue;

      const scale = 0.85 + rand() * 0.55;
      const tree = this.createAcaciaTree(scale, trunkMat, acaciaMat);
      tree.position.set(x, y - 0.1, z);
      tree.rotation.y = rand() * Math.PI * 2;
      this.group.add(tree);

      this.trees.push({
        x,
        z,
        y,
        kind: 'acacia',
        canopyHeight: 5.4 * scale,
        shadeRadius: 5.2 * scale,
        foliage: 1,
      });
      acaciaCount++;
    }

    // 2. Jungle Broadleaf Trees & Palms (approx 86 trees on x > river)
    let jungleCount = 0;
    attempts = 0;
    while (jungleCount < 88 && attempts < 650) {
      attempts++;
      const x = -5 + rand() * 112;
      const z = -105 + rand() * 210;
      const cx = getRiverCenterX(z);
      const hw = getRiverHalfWidth(z);
      if (x < cx + hw + 3.2) continue;
      const y = getTerrainHeight(x, z);
      if (y < 0.25) continue;

      if (this.trees.some((t) => Math.hypot(t.x - x, t.z - z) < 6.4)) continue;

      const scale = 0.85 + rand() * 0.65;
      const isPalm = rand() < 0.28 || x < cx + hw + 14;
      const tree = isPalm
        ? this.createPalmTree(scale, jungleTrunkMat, jungleLeafMat)
        : this.createJungleTree(scale, jungleTrunkMat, jungleLeafMat);

      tree.position.set(x, y - 0.12, z);
      tree.rotation.y = rand() * Math.PI * 2;
      this.group.add(tree);

      this.trees.push({
        x,
        z,
        y,
        kind: isPalm ? 'palm' : 'jungle',
        canopyHeight: 5.8 * scale,
        shadeRadius: 4.5 * scale,
        foliage: 1,
      });
      jungleCount++;
    }

    // 3. Bushes & Tiger Stalking Cover (both sides, denser in jungle)
    const bushGeo = new THREE.DodecahedronGeometry(0.95, 0);
    for (let i = 0; i < 85; i++) {
      const inJungle = i < 60;
      const z = -104 + rand() * 208;
      const cx = getRiverCenterX(z);
      const hw = getRiverHalfWidth(z);
      const x = inJungle ? cx + hw + 2 + rand() * 88 : -102 + rand() * (96 + cx);
      if (!inJungle && x > cx - hw - 3) continue;
      if (isNearWaterhole(x, z)) continue;
      const y = getTerrainHeight(x, z);
      if (y < 0.18) continue;

      const g = new THREE.Group();
      const clumps = 2 + Math.floor(rand() * 2);
      for (let c = 0; c < clumps; c++) {
        const m = new THREE.Mesh(bushGeo, inJungle ? jungleLeafMat : acaciaMat);
        const s = 0.65 + rand() * 0.65;
        m.scale.set(s * 1.2, s * 0.8, s * 1.15);
        m.position.set((rand() - 0.5) * 1.1, s * 0.45, (rand() - 0.5) * 1.1);
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
      }
      g.position.set(x, y - 0.1, z);
      this.group.add(g);

      this.trees.push({
        x,
        z,
        y,
        kind: 'bush',
        canopyHeight: 1.5,
        shadeRadius: 2.2,
        foliage: 1,
      });
    }

    // 4. Riverbank Reeds & Bamboo clusters (mainly along river edges & jungle shore)
    const reedGeo = new THREE.CylinderGeometry(0.04, 0.07, 2.1, 4);
    for (let i = 0; i < 110; i++) {
      const z = -106 + rand() * 212;
      const cx = getRiverCenterX(z);
      const hw = getRiverHalfWidth(z);
      const side = rand() < 0.72 ? 1 : -1;
      const x = cx + side * (hw - 0.5 + rand() * 4.5);
      if (getFordFactor(x, z) > 0.4) continue; // Keep shallow fords visually open
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

  private createAcaciaTree(
    scale: number,
    trunkMat: THREE.Material,
    leafMat: THREE.Material
  ): THREE.Group {
    const g = new THREE.Group();

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.42, 4.6, 6), trunkMat);
    trunk.position.y = 2.3;
    trunk.rotation.z = 0.06;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    g.add(trunk);

    // Forking upper branches
    const branchGeo = new THREE.CylinderGeometry(0.11, 0.2, 2.2, 5);
    const branchAngles = [0, 2.1, 4.2];
    branchAngles.forEach((ang, idx) => {
      const b = new THREE.Mesh(branchGeo, trunkMat);
      b.position.set(Math.cos(ang) * 0.7, 4.4, Math.sin(ang) * 0.7);
      b.rotation.z = Math.cos(ang) * -0.55;
      b.rotation.x = Math.sin(ang) * 0.55;
      b.castShadow = true;
      g.add(b);

      // Flat umbrella disc per branch + central crown
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 1.5, 0.75, 7), leafMat);
      crown.position.set(Math.cos(ang) * (1.2 + idx * 0.2), 5.3 + idx * 0.25, Math.sin(ang) * (1.2 + idx * 0.2));
      crown.castShadow = true;
      crown.receiveShadow = true;
      g.add(crown);
    });

    const topCrown = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 2.1, 0.85, 8), leafMat);
    topCrown.position.y = 5.75;
    topCrown.castShadow = true;
    topCrown.receiveShadow = true;
    g.add(topCrown);

    g.scale.setScalar(scale);
    return g;
  }

  private createJungleTree(
    scale: number,
    trunkMat: THREE.Material,
    leafMat: THREE.Material
  ): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.48, 5.0, 6), trunkMat);
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

  private createPalmTree(
    scale: number,
    trunkMat: THREE.Material,
    leafMat: THREE.Material
  ): THREE.Group {
    const g = new THREE.Group();
    // Curved segmented trunk
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
    const count = 1900;
    // Build a 3-blade organic fanned grass tuft geometry
    const verts: number[] = [];
    const blades = [
      { ang: 0, h: 0.54, tiltX: 0.14, w: 0.14 },
      { ang: 2.09, h: 0.46, tiltX: 0.18, w: 0.13 },
      { ang: 4.18, h: 0.48, tiltX: 0.16, w: 0.13 },
    ];
    for (const b of blades) {
      const ca = Math.cos(b.ang);
      const sa = Math.sin(b.ang);
      const lx = -b.w * ca;
      const lz = -b.w * sa;
      const rx = b.w * ca;
      const rz = b.w * sa;
      const tx = -sa * b.tiltX;
      const tz = ca * b.tiltX;
      verts.push(lx, 0, lz, rx, 0, rz, tx, b.h, tz);
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
      const x = -108 + rand() * 216;
      const z = -108 + rand() * 216;
      const y = getTerrainHeight(x, z);
      if (y < 0.22) continue;
      if (this.kopjes.some((k) => Math.hypot(x - k.x, z - k.z) < 8.5)) continue;

      const cx = getRiverCenterX(z);
      const isJungle = x > cx;
      const scale = (isJungle ? 0.85 : 0.65) + rand() * 0.9;
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

  public updateSeasonVisuals(wetness: number, rainIntensity: number): void {
    const waterY = getWaterLevel(wetness);
    this.waterMesh.position.y = waterY;

    // Only recolor terrain & grass when wetness shifts meaningfully (~1% change)
    if (Math.abs(wetness - this.lastColorWetness) > 0.012) {
      this.lastColorWetness = wetness;

      const savDry = new THREE.Color(0xc59b4e);
      const savWet = new THREE.Color(0x6e8f3c);
      const savBase = savDry.clone().lerp(savWet, wetness);

      const junDry = new THREE.Color(0x4c7838);
      const junWet = new THREE.Color(0x286b32);
      const junBase = junDry.clone().lerp(junWet, wetness);

      const sandColor = new THREE.Color(0xcab27d);
      const mudColor = new THREE.Color(0x6f5a3e);
      const rockColor = new THREE.Color(0x7c766b);
      const tmp = new THREE.Color();

      const colAttr = this.terrainGeo.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < this.terrainVertexMeta.length; i++) {
        const m = this.terrainVertexMeta[i];
        const isJungle = m.x > m.cx;
        const biomeBlend = smoothstep(m.cx - m.hw * 0.6, m.cx + m.hw * 0.6, m.x);

        tmp.copy(savBase).lerp(junBase, biomeBlend);
        // Subtle noise tint
        tmp.offsetHSL(0, 0, (m.noise - 0.5) * 0.06);

        // Wet shoreline & riverbed sand/mud
        const heightAboveWater = m.h - waterY;
        if (heightAboveWater < 0.75) {
          const bankT = 1 - smoothstep(-0.25, 0.75, heightAboveWater);
          const shoreColor = isJungle || m.ford < 0.35 ? mudColor : sandColor;
          tmp.lerp(shoreColor, bankT * 0.88);
        }

        if (m.rockiness > 0.02) {
          tmp.lerp(rockColor, m.rockiness * 0.85);
        }

        colAttr.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
      colAttr.needsUpdate = true;

      // Update tree foliage colors
      for (const fm of this.foliageMaterials) {
        fm.mat.color.copy(fm.dryColor).lerp(fm.baseColor, wetness);
      }

      // Update grass tuft colors
      const gSavDry = new THREE.Color(0xb89643);
      const gSavWet = new THREE.Color(0x699539);
      const gJunDry = new THREE.Color(0x467e36);
      const gJunWet = new THREE.Color(0x287c37);
      const gSav = gSavDry.lerp(gSavWet, wetness);
      const gJun = gJunDry.lerp(gJunWet, wetness);

      for (let i = 0; i < this.grassData.length; i++) {
        const gd = this.grassData[i];
        tmp.copy(gd.isJungle ? gJun : gSav);
        tmp.offsetHSL(0, 0, ((gd.phase / (Math.PI * 2)) - 0.5) * 0.07);
        this.grassMesh.setColorAt(i, tmp);
      }
      if (this.grassMesh.instanceColor) this.grassMesh.instanceColor.needsUpdate = true;
    }

    // Subtle wet ground sheen during rain
    this.terrainMat.roughness = 0.92 - rainIntensity * 0.25;
  }

  public animateEnvironment(realTime: number, windStrength: number): void {
    // Animate subtle river surface ripples
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

    // Gentle wind sway on grass tufts (update subset or fast loop)
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
