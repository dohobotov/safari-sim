import * as THREE from 'three';
import { Soundscape } from './audio/Soundscape';
import { CameraController } from './camera/CameraController';
import { Simulation } from './sim/Simulation';
import { SPECIES_CONFIGS } from './entities/SpeciesData';
import './style.css';
import { HUD } from './ui/HUD';
import { Atmosphere } from './world/Atmosphere';
import { WorldBuilder } from './world/WorldBuilder';

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
  450
);

const world = new WorldBuilder(scene);
const atmosphere = new Atmosphere(scene);
const soundscape = new Soundscape();
const simulation = new Simulation(scene, world.trees, world.kopjes, atmosphere, soundscape);

// Subtle glowing ring on the ground under the currently followed animal
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

let timeSpeed = 1;
let lastNonZeroSpeed = 1;

const cameraController = new CameraController(camera, canvas, {
  onDirectorChanged: (active) => hud.setDirectorActive(active),
});

const hud = new HUD({
  onSpeedChange: (spd) => {
    timeSpeed = spd;
    if (spd > 0) lastNonZeroSpeed = spd;
  },
  onToggleDirector: () => {
    cameraController.setAutoDirector(!cameraController.autoDirector, simulation.animals);
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
    const candidates = simulation.animals.filter((a) => a.alive && a.species === species);
    if (candidates.length > 0) {
      const idx = Math.floor(Math.random() * candidates.length);
      cameraController.setAutoDirector(false);
      cameraController.followAnimal(candidates[idx]);
    }
  },
});

// Spacebar Pause / Resume toggle
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    timeSpeed = timeSpeed === 0 ? lastNonZeroSpeed : 0;
    hud.setActiveSpeed(timeSpeed);
  }
});

// Raycasting to select any 3D animal on click
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || cameraController.wasDrag()) return;
  const rect = canvas.getBoundingClientRect();
  pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointerNDC, camera);
  const roots = simulation.animals.map((a) => a.rig.root);
  const hits = raycaster.intersectObjects(roots, true);

  if (hits.length > 0) {
    const id = hits[0].object.userData.animalId as number | undefined;
    const hitAnimal = simulation.getAnimalById(id ?? null);
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

// Render & Simulation Loop
let prevTime = performance.now();
let hudThrottle = 0;

function animate(now: number): void {
  requestAnimationFrame(animate);
  const realDt = Math.min(0.08, (now - prevTime) / 1000);
  prevTime = now;
  const realTimeSec = now / 1000;

  simulation.setCameraTarget(cameraController.target);
  simulation.step(realDt, timeSpeed, realTimeSec);

  cameraController.update(realDt, simulation.animals);

  const followedNow = simulation.getAnimalById(cameraController.followedAnimalId);
  if (followedNow) {
    const r = SPECIES_CONFIGS[followedNow.species].adultRadius * (followedNow.stage === 'juvenile' ? 0.65 : 1.15);
    const pulse = 1 + Math.sin(realTimeSec * 4) * 0.06;
    selectRing.visible = true;
    selectRing.position.set(followedNow.pos.x, followedNow.pos.y + 0.14, followedNow.pos.z);
    selectRing.scale.setScalar(r * pulse);
  } else {
    selectRing.visible = false;
  }

  world.updateSeasonVisuals(simulation.season.wetness, simulation.season.rainIntensity);
  const windStrength = simulation.season.isRaining ? 0.85 : 0.28;
  world.animateEnvironment(realTimeSec, windStrength);

  atmosphere.update(
    simulation.timeState,
    simulation.season,
    cameraController.target,
    realDt,
    realTimeSec
  );

  soundscape.update(
    realDt,
    simulation.timeState,
    simulation.season,
    camera.position,
    cameraController.target
  );

  renderer.render(scene, camera);

  hudThrottle += realDt;
  if (hudThrottle >= 0.14) {
    hudThrottle = 0;
    const followed = simulation.getAnimalById(cameraController.followedAnimalId);
    const biomeRu = followed ? simulation.getCurrentBiomeRu(followed) : '';
    hud.update(
      simulation.timeState,
      simulation.season,
      simulation.getSpeciesCounts(),
      followed,
      biomeRu,
      simulation.events
    );
  }
}

requestAnimationFrame(animate);
