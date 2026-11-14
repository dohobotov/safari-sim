import * as THREE from 'three';
import { Soundscape } from './audio/Soundscape.js';
import { CameraController } from './camera/CameraController.js';
import { WorldClient } from './net/WorldClient.js';
import { SPECIES_CONFIGS } from './shared/SpeciesData.js';
import { getWaterLevel } from './shared/TerrainMath.js';
import './style.css';
import { HUD } from './ui/HUD.js';
import { Atmosphere } from './world/Atmosphere.js';
import { WorldBuilder } from './world/WorldBuilder.js';

const canvas = document.getElementById('safari-canvas') as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.5,
  1400
);

const world = new WorldBuilder(scene);
const atmosphere = new Atmosphere(scene);
const soundscape = new Soundscape();
const worldClient = new WorldClient(scene, atmosphere, soundscape);

const selectRing = new THREE.Mesh(
  new THREE.RingGeometry(0.95, 1.18, 28),
  new THREE.MeshBasicMaterial({
    color: 0xf3b552,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  })
);
selectRing.rotation.x = -Math.PI / 2;
selectRing.visible = false;
scene.add(selectRing);

const cameraController = new CameraController(camera, canvas, {
  onDirectorChanged: (active) => hud.setDirectorActive(active),
});

const hud = new HUD({
  onToggleDirector: () => {
    cameraController.setAutoDirector(!cameraController.autoDirector, worldClient.animals);
  },
  onToggleAudio: () => {
    const enabled = soundscape.toggle();
    hud.setAudioActive(enabled);
  },
  onCloseInspector: () => {
    cameraController.followAnimal(null);
  },
  onEventClick: (pos) => {
    cameraController.setAutoDirector(false);
    cameraController.jumpToPoint(pos);
  },
  onSpeciesPick: (species) => {
    const candidates = worldClient.animals.filter((a) => a.species === species);
    if (candidates.length > 0) {
      const idx = Math.floor(Math.random() * candidates.length);
      cameraController.setAutoDirector(false);
      cameraController.followAnimal(candidates[idx]);
    }
  },
});

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || cameraController.wasDrag()) return;
  const rect = canvas.getBoundingClientRect();
  pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointerNDC, camera);
  const roots = worldClient.animals.map((a) => a.rig.root);
  const hits = raycaster.intersectObjects(roots, true);

  if (hits.length > 0) {
    const id = hits[0].object.userData.animalId as number | undefined;
    const hitAnimal = worldClient.getAnimalById(id ?? null);
    if (hitAnimal) {
      cameraController.setAutoDirector(false);
      cameraController.followAnimal(hitAnimal);
      return;
    }
  }
  cameraController.followAnimal(null);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let prevTime = performance.now();
let hudThrottle = 0;

function animate(now: number): void {
  requestAnimationFrame(animate);
  const realDt = Math.min(0.08, (now - prevTime) / 1000);
  prevTime = now;
  const realTimeSec = now / 1000;

  worldClient.setCameraTarget(cameraController.target);
  worldClient.update(realDt, realTimeSec);

  cameraController.update(realDt, worldClient.animals);

  const followedNow = worldClient.getAnimalById(cameraController.followedAnimalId);
  if (followedNow) {
    const r =
      SPECIES_CONFIGS[followedNow.species].adultRadius *
      (followedNow.stage === 'juvenile' ? 0.65 : 1.15);
    const pulse = 1 + Math.sin(realTimeSec * 4) * 0.06;
    selectRing.visible = true;
    selectRing.position.set(followedNow.pos.x, followedNow.pos.y + 0.14, followedNow.pos.z);
    selectRing.scale.setScalar(r * pulse);
  } else {
    selectRing.visible = false;
  }

  world.updateSeasonVisuals(worldClient.season.wetness, worldClient.season.rainIntensity);
  const windStrength = worldClient.season.isRaining ? 0.85 : 0.28;
  const waterY = getWaterLevel(worldClient.season.wetness);
  world.animateEnvironment(realTimeSec, windStrength, waterY);

  atmosphere.update(
    worldClient.timeState,
    worldClient.season,
    cameraController.target,
    camera.position,
    realDt,
    realTimeSec
  );

  soundscape.update(
    realDt,
    worldClient.timeState,
    worldClient.season,
    camera.position,
    cameraController.target
  );

  renderer.render(scene, camera);

  hudThrottle += realDt;
  if (hudThrottle >= 0.14) {
    hudThrottle = 0;
    const followed = worldClient.getAnimalById(cameraController.followedAnimalId);
    const biomeRu = followed ? worldClient.getCurrentBiomeRu(followed) : '';
    hud.update(
      worldClient.timeState,
      worldClient.season,
      worldClient.getSpeciesCounts(),
      followed,
      biomeRu,
      worldClient.events,
      worldClient.viewerCount,
      worldClient.connectionStatus
    );
  }
}

requestAnimationFrame(animate);
