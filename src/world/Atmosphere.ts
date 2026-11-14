import * as THREE from 'three';
import type { SeasonState, TimeState } from '../types';
import { getRiverCenterX, getTerrainHeight } from './TerrainMath';

interface TransientParticle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
  size: number;
  kind: 'dust' | 'splash';
}

export class Atmosphere {
  public readonly sunLight: THREE.DirectionalLight;
  public readonly moonLight: THREE.DirectionalLight;
  public readonly hemiLight: THREE.HemisphereLight;
  public readonly fog: THREE.FogExp2;

  private skyMat!: THREE.ShaderMaterial;
  private starsPoints!: THREE.Points;
  private starsMat!: THREE.PointsMaterial;

  private fireflyPoints!: THREE.Points;
  private fireflyMat!: THREE.PointsMaterial;
  private fireflyBase: Float32Array = new Float32Array(0);

  private rainPoints!: THREE.Points;
  private rainMat!: THREE.PointsMaterial;
  private rainPos!: Float32Array;

  private dustMesh!: THREE.InstancedMesh;
  private splashMesh!: THREE.InstancedMesh;
  private particles: TransientParticle[] = [];
  private particleDummy = new THREE.Object3D();

  private readonly shadowSpan = 90;

  constructor(scene: THREE.Scene) {
    // Fog
    this.fog = new THREE.FogExp2(0xd8c39b, 0.0046);
    scene.fog = this.fog;

    // Sky Dome
    const skyGeo = new THREE.SphereGeometry(280, 32, 20);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x4b89c8) },
        horizonColor: { value: new THREE.Color(0xe6c79c) },
        sunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
        sunColor: { value: new THREE.Color(0xfff1c9) },
        sunIntensity: { value: 1.0 },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 sunDir;
        uniform vec3 sunColor;
        uniform float sunIntensity;
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = clamp(dir.y * 1.15, 0.0, 1.0);
          vec3 col = mix(horizonColor, topColor, pow(h, 0.58));
          float sunAmt = max(dot(dir, sunDir), 0.0);
          col += sunColor * pow(sunAmt, 24.0) * 0.45 * sunIntensity;
          col += sunColor * smoothstep(0.9965, 0.9992, sunAmt) * 1.25 * sunIntensity;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const skyMesh = new THREE.Mesh(skyGeo, this.skyMat);
    scene.add(skyMesh);

    // Lights
    this.hemiLight = new THREE.HemisphereLight(0xcbe2ff, 0x876f4b, 0.75);
    scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff2d6, 1.8);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 280;
    this.sunLight.shadow.camera.left = -this.shadowSpan;
    this.sunLight.shadow.camera.right = this.shadowSpan;
    this.sunLight.shadow.camera.top = this.shadowSpan;
    this.sunLight.shadow.camera.bottom = -this.shadowSpan;
    this.sunLight.shadow.bias = -0.0007;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.moonLight = new THREE.DirectionalLight(0x88aadd, 0.0);
    this.moonLight.position.set(-60, 80, -40);
    scene.add(this.moonLight);

    this.buildStars(scene);
    this.buildFireflies(scene);
    this.buildRain(scene);
    this.buildParticlePools(scene);
  }

  private buildStars(scene: THREE.Scene): void {
    const count = 420;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(0.12 + Math.random() * 0.88);
      const r = 240;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starsMat = new THREE.PointsMaterial({
      color: 0xf4f7ff,
      size: 1.5,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
    });
    this.starsPoints = new THREE.Points(geo, this.starsMat);
    scene.add(this.starsPoints);
  }

  private buildFireflies(scene: THREE.Scene): void {
    const count = 130;
    this.fireflyBase = new Float32Array(count * 3);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const z = -98 + Math.random() * 196;
      const cx = getRiverCenterX(z);
      // Concentrate along jungle edge and river reeds
      const x = cx + 6 + Math.random() * 82;
      const y = getTerrainHeight(x, z) + 0.9 + Math.random() * 2.6;
      this.fireflyBase[i * 3] = x;
      this.fireflyBase[i * 3 + 1] = y;
      this.fireflyBase[i * 3 + 2] = z;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.fireflyMat = new THREE.PointsMaterial({
      color: 0xd9ff73,
      size: 0.42,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.fireflyPoints = new THREE.Points(geo, this.fireflyMat);
    scene.add(this.fireflyPoints);
  }

  private buildRain(scene: THREE.Scene): void {
    const count = 1200;
    this.rainPos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.rainPos[i * 3] = (Math.random() - 0.5) * 140;
      this.rainPos[i * 3 + 1] = Math.random() * 48;
      this.rainPos[i * 3 + 2] = (Math.random() - 0.5) * 140;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainMat = new THREE.PointsMaterial({
      color: 0xc2dcf2,
      size: 0.25,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.rainPoints = new THREE.Points(geo, this.rainMat);
    scene.add(this.rainPoints);
  }

  private buildParticlePools(scene: THREE.Scene): void {
    const maxCount = 120;
    for (let i = 0; i < maxCount; i++) {
      this.particles.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 1,
        size: 0.3,
        kind: i < 60 ? 'dust' : 'splash',
      });
    }

    const dustGeo = new THREE.IcosahedronGeometry(0.45, 0);
    const dustMat = new THREE.MeshStandardMaterial({
      color: 0xd3ba89,
      transparent: true,
      opacity: 0.52,
      roughness: 1,
      flatShading: true,
      depthWrite: false,
    });
    this.dustMesh = new THREE.InstancedMesh(dustGeo, dustMat, 60);
    this.dustMesh.count = 0;
    scene.add(this.dustMesh);

    const splashGeo = new THREE.IcosahedronGeometry(0.24, 0);
    const splashMat = new THREE.MeshStandardMaterial({
      color: 0xbfe9f5,
      transparent: true,
      opacity: 0.75,
      roughness: 0.2,
      flatShading: true,
      depthWrite: false,
    });
    this.splashMesh = new THREE.InstancedMesh(splashGeo, splashMat, 60);
    this.splashMesh.count = 0;
    scene.add(this.splashMesh);
  }

  public spawnDust(x: number, y: number, z: number, count = 2): void {
    let spawned = 0;
    for (let i = 0; i < 60 && spawned < count; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.age = 0;
        p.maxAge = 0.65 + Math.random() * 0.45;
        p.size = 0.45 + Math.random() * 0.55;
        p.pos.set(x + (Math.random() - 0.5) * 0.8, y + 0.18, z + (Math.random() - 0.5) * 0.8);
        p.vel.set((Math.random() - 0.5) * 1.1, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.1);
        spawned++;
      }
    }
  }

  public spawnSplash(x: number, y: number, z: number, count = 4): void {
    let spawned = 0;
    for (let i = 60; i < 120 && spawned < count; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.age = 0;
        p.maxAge = 0.45 + Math.random() * 0.35;
        p.size = 0.5 + Math.random() * 0.55;
        p.pos.set(x + (Math.random() - 0.5) * 0.6, y + 0.08, z + (Math.random() - 0.5) * 0.6);
        p.vel.set((Math.random() - 0.5) * 2.4, 1.8 + Math.random() * 1.9, (Math.random() - 0.5) * 2.4);
        spawned++;
      }
    }
  }

  public update(
    timeState: TimeState,
    season: SeasonState,
    cameraTarget: THREE.Vector3,
    realDt: number,
    realTime: number
  ): void {
    // 0 = midnight, 0.25 = 06:00 sunrise, 0.5 = noon, 0.75 = 18:00 sunset
    const angle = (timeState.timeOfDay - 0.25) * Math.PI * 2;
    const sunY = Math.sin(angle);
    const sunX = Math.cos(angle);
    const sunDir = new THREE.Vector3(sunX * 0.92, sunY, 0.36).normalize();

    // Anchor shadow frustum near camera target snapped to grid to eliminate shimmer
    const snap = 4;
    const tx = Math.round(cameraTarget.x / snap) * snap;
    const tz = Math.round(cameraTarget.z / snap) * snap;
    this.sunLight.target.position.set(tx, 0, tz);
    this.sunLight.position.set(
      tx + sunDir.x * 115,
      Math.max(12, sunDir.y * 115),
      tz + sunDir.z * 115
    );

    const dayFactor = Math.max(0, Math.min(1, (sunY + 0.14) / 0.42));
    const twilight = Math.max(0, 1 - Math.abs(sunY) / 0.28) * (sunY > -0.18 ? 1 : 0);
    const rainDim = 1 - season.rainIntensity * 0.48;

    // Sky & fog colors
    const cDayTop = new THREE.Color(0x3a82c9);
    const cDayHor = new THREE.Color(0xe3cba3);
    const cDawnTop = new THREE.Color(0x52467c);
    const cDawnHor = new THREE.Color(0xf08c54);
    const cNightTop = new THREE.Color(0x070d1c);
    const cNightHor = new THREE.Color(0x162238);
    const cRainFog = new THREE.Color(0x6d7d88);

    const topCol = cNightTop.clone().lerp(cDayTop, dayFactor).lerp(cDawnTop, twilight * 0.75);
    const horCol = cNightHor.clone().lerp(cDayHor, dayFactor).lerp(cDawnHor, twilight * 0.85);

    if (season.rainIntensity > 0.01) {
      topCol.lerp(cRainFog, season.rainIntensity * 0.65);
      horCol.lerp(cRainFog, season.rainIntensity * 0.72);
    }

    (this.skyMat.uniforms.topColor.value as THREE.Color).copy(topCol);
    (this.skyMat.uniforms.horizonColor.value as THREE.Color).copy(horCol);
    (this.skyMat.uniforms.sunDir.value as THREE.Vector3).copy(sunDir);
    (this.skyMat.uniforms.sunColor.value as THREE.Color)
      .set(0xfff1c9)
      .lerp(new THREE.Color(0xff9248), twilight * 0.85);
    this.skyMat.uniforms.sunIntensity.value = Math.max(0, sunY + 0.12) * rainDim;

    this.fog.color.copy(horCol);
    this.fog.density = 0.0042 + season.rainIntensity * 0.0045 + (1 - dayFactor) * 0.0012;

    // Sun & Moon intensities
    this.sunLight.intensity = Math.max(0, sunY + 0.05) * 1.95 * rainDim;
    this.sunLight.color
      .set(0xfff4dd)
      .lerp(new THREE.Color(0xff9a52), twilight * 0.78);

    const nightFactor = Math.max(0, Math.min(1, (-sunY - 0.02) / 0.28));
    this.moonLight.intensity = nightFactor * 0.45 * (1 - season.rainIntensity * 0.6);

    const hemiDaySky = new THREE.Color(0xbcd8ff);
    const hemiNightSky = new THREE.Color(0x283e66);
    const hemiDayGround = new THREE.Color(0x8a7046);
    const hemiNightGround = new THREE.Color(0x161f24);

    this.hemiLight.color.copy(hemiNightSky).lerp(hemiDaySky, dayFactor);
    this.hemiLight.groundColor.copy(hemiNightGround).lerp(hemiDayGround, dayFactor);
    this.hemiLight.intensity = (0.34 + dayFactor * 0.56) * (1 - season.rainIntensity * 0.22);

    // Stars & fireflies (only appear after sunset / before sunrise)
    this.starsMat.opacity = nightFactor * 0.88 * (1 - season.rainIntensity);
    this.fireflyMat.opacity = nightFactor * 0.78 * (1 - season.rainIntensity * 0.8);

    if (this.fireflyMat.opacity > 0.02) {
      const fAttr = this.fireflyPoints.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < fAttr.count; i++) {
        const bx = this.fireflyBase[i * 3];
        const by = this.fireflyBase[i * 3 + 1];
        const bz = this.fireflyBase[i * 3 + 2];
        fAttr.setXYZ(
          i,
          bx + Math.sin(realTime * 0.9 + i) * 1.1,
          by + Math.sin(realTime * 1.5 + i * 1.7) * 0.45,
          bz + Math.cos(realTime * 0.8 + i * 0.6) * 1.1
        );
      }
      fAttr.needsUpdate = true;
    }

    // Rain particles follow camera target
    this.rainMat.opacity = season.rainIntensity * 0.62;
    this.rainPoints.visible = season.rainIntensity > 0.02;
    if (this.rainPoints.visible) {
      this.rainPoints.position.set(cameraTarget.x, 0, cameraTarget.z);
      const rAttr = this.rainPoints.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < rAttr.count; i++) {
        let ry = this.rainPos[i * 3 + 1] - realDt * 42;
        let rx = this.rainPos[i * 3] - realDt * 4.5;
        if (ry < 0) {
          ry = 44 + Math.random() * 6;
          rx = (Math.random() - 0.5) * 140;
        }
        this.rainPos[i * 3] = rx;
        this.rainPos[i * 3 + 1] = ry;
      }
      rAttr.needsUpdate = true;
    }

    // Update transient dust & splash particle pools
    let dustActive = 0;
    let splashActive = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.age += realDt;
      if (p.age >= p.maxAge) {
        p.active = false;
        continue;
      }
      p.pos.addScaledVector(p.vel, realDt);
      if (p.kind === 'splash') {
        p.vel.y -= 7.2 * realDt;
      } else {
        p.vel.multiplyScalar(0.95);
      }

      const lifeT = p.age / p.maxAge;
      const scale =
        p.kind === 'dust'
          ? p.size * (0.6 + lifeT * 1.1) * (1 - lifeT * 0.85)
          : p.size * (1 - lifeT * 0.7);

      this.particleDummy.position.copy(p.pos);
      this.particleDummy.scale.setScalar(Math.max(0.01, scale));
      this.particleDummy.rotation.set(lifeT * 2, lifeT, 0);
      this.particleDummy.updateMatrix();

      if (p.kind === 'dust') {
        this.dustMesh.setMatrixAt(dustActive++, this.particleDummy.matrix);
      } else {
        this.splashMesh.setMatrixAt(splashActive++, this.particleDummy.matrix);
      }
    }
    this.dustMesh.count = dustActive;
    this.dustMesh.instanceMatrix.needsUpdate = true;
    this.splashMesh.count = splashActive;
    this.splashMesh.instanceMatrix.needsUpdate = true;
  }
}
