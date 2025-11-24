import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import GUI from 'lil-gui';
import Stats from 'stats.js';

const canvasContainer = document.getElementById('canvas-container');
const statusBirdCount = document.getElementById('bird-count');
const statusMode = document.getElementById('mode');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
canvasContainer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#0d1b2a', 0.0022);
scene.background = new THREE.Color('#0a1422');

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);
camera.position.set(-60, 60, 120);

const chaseCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2000);
let activeCamera = camera;

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.minDistance = 20;
orbit.maxDistance = 400;

const stats = new Stats();
stats.showPanel(0);
stats.dom.style.position = 'fixed';
stats.dom.style.right = '12px';
stats.dom.style.top = '12px';
stats.dom.style.zIndex = '12';
document.body.appendChild(stats.dom);

const clock = new THREE.Clock();

const params = {
  birdCount: 120,
  maxSpeed: 38,
  alignStrength: 0.14,
  cohesionStrength: 0.09,
  separationStrength: 0.4,
  perceptionRadius: 32,
  separationRadius: 10,
  terrainAvoid: 22,
  skyLift: 0.6,
  worldSize: 260,
  windStrength: 1.2,
  showWaterRipples: true,
};

const state = {
  paused: false,
  birdView: false,
  chaseIndex: 0,
};

const boids = [];
let birdMesh;

// Helpers
function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function easeNoise(x, y) {
  return Math.sin(x * 0.08) * Math.cos(y * 0.06) + Math.sin(x * 0.02 + y * 0.04);
}

// Environment
function createSky() {
  const skyGeo = new THREE.SphereGeometry(1200, 64, 32);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color('#102844') },
      bottomColor: { value: new THREE.Color('#0b1728') },
    },
    vertexShader: `varying vec3 vWorldPosition; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorldPosition = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `varying vec3 vWorldPosition; uniform vec3 topColor; uniform vec3 bottomColor; void main(){ float h = normalize(vWorldPosition).y * 0.5 + 0.5; gl_FragColor = vec4(mix(bottomColor, topColor, smoothstep(0.0,1.0,h)),1.0); }`,
  });
  const mesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(mesh);
}

function createSunlight() {
  const hemi = new THREE.HemisphereLight('#cde7ff', '#294058', 0.85);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight('#f2f5ff', 1.0);
  dir.position.set(-90, 160, 50);
  dir.castShadow = true;
  dir.shadow.bias = -0.0002;
  dir.shadow.mapSize.set(2048, 2048);
  const d = 160;
  dir.shadow.camera.left = -d;
  dir.shadow.camera.right = d;
  dir.shadow.camera.top = d;
  dir.shadow.camera.bottom = -d;
  scene.add(dir);
}

let groundMesh;
function createTerrain() {
  const size = params.worldSize * 2.2;
  const geo = new THREE.PlaneGeometry(size, size, 240, 240);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const h = easeNoise(x, y) * 5 + Math.sin((x + y) * 0.01) * 3;
    pos.setZ(i, h);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: '#2f5d41',
    roughness: 0.9,
    metalness: 0.05,
    flatShading: false,
  });

  groundMesh = new THREE.Mesh(geo, mat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

function createWater() {
  const geo = new THREE.CircleGeometry(90, 64);
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#5ab5e6',
    metalness: 0.2,
    roughness: 0.2,
    transmission: 0.6,
    thickness: 2,
    clearcoat: 0.6,
    reflectivity: 0.6,
  });
  const water = new THREE.Mesh(geo, mat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(40, 0.1, -20);
  water.receiveShadow = true;
  water.name = 'water';
  scene.add(water);
  return water;
}

function createRocks() {
  const rockGeo = new THREE.IcosahedronGeometry(2.8, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: '#9ca6b4', roughness: 0.8, metalness: 0.1 });
  for (let i = 0; i < 40; i++) {
    const mesh = new THREE.Mesh(rockGeo, rockMat);
    mesh.scale.setScalar(randomInRange(0.6, 1.6));
    mesh.position.set(randomInRange(-180, 180), 0, randomInRange(-180, 180));
    mesh.position.y = Math.max(0, groundHeightAt(mesh.position.x, mesh.position.z) - 0.5);
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function groundHeightAt(x, z) {
  return (easeNoise(x, z) * 5 + Math.sin((x + z) * 0.01) * 3);
}

function createTrees() {
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.8, 6, 6);
  const leafGeo = new THREE.ConeGeometry(3, 9, 8, 1, true);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#8b5a2b', roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#2f8f5b', roughness: 0.5 });

  for (let i = 0; i < 160; i++) {
    const base = new THREE.Object3D();
    const x = randomInRange(-params.worldSize, params.worldSize);
    const z = randomInRange(-params.worldSize, params.worldSize);
    const h = groundHeightAt(x, z);
    if (Math.hypot(x - 40, z + 20) < 50) continue; // keep pond clear

    base.position.set(x, h, z);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    trunk.position.y = 3;

    const leaves = new THREE.Mesh(leafGeo, leafMat);
    leaves.castShadow = true;
    leaves.position.y = 8.5;

    base.add(trunk);
    base.add(leaves);
    base.rotation.y = Math.random() * Math.PI * 2;
    const scale = randomInRange(0.8, 1.4);
    base.scale.setScalar(scale);
    scene.add(base);
  }
}

function createGrass() {
  const bladeGeo = new THREE.PlaneGeometry(0.4, 3, 1, 1);
  bladeGeo.translate(0, 1.5, 0);
  const bladeMat = new THREE.MeshStandardMaterial({ color: '#5abf6d', side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(bladeGeo, bladeMat, 1800);
  const dummy = new THREE.Object3D();
  let j = 0;
  while (j < inst.count) {
    const x = randomInRange(-params.worldSize, params.worldSize);
    const z = randomInRange(-params.worldSize, params.worldSize);
    if (Math.hypot(x - 40, z + 20) < 60) continue;
    const h = groundHeightAt(x, z);
    dummy.position.set(x, h + 0.1, z);
    dummy.rotation.y = Math.random() * Math.PI;
    dummy.scale.setScalar(randomInRange(0.6, 1.4));
    dummy.updateMatrix();
    inst.setMatrixAt(j, dummy.matrix);
    j++;
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = false;
  inst.receiveShadow = true;
  scene.add(inst);
}

// Birds
function createBirdGeometry() {
  const geo = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    0, 0, 0, // body
    -0.5, 0.2, -2.2, // left wing tip
    -0.2, 0, -1.0,

    0, 0, 0,
    0.5, 0.2, -2.2, // right wing tip
    0.2, 0, -1.0,

    0, 0, 0,
    -0.2, 0, -1.0,
    0.2, 0, -1.0,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.computeVertexNormals();
  return geo;
}

function initBirds() {
  boids.length = 0;
  if (birdMesh) {
    scene.remove(birdMesh);
    if (birdMesh.instanceColor) {
      if (typeof birdMesh.instanceColor.dispose === 'function') {
        birdMesh.instanceColor.dispose();
      }
      birdMesh.instanceColor.array = null;
      birdMesh.instanceColor = null;
    }
    birdMesh.dispose();
    if (birdMesh.geometry) birdMesh.geometry.dispose();
    if (birdMesh.material) {
      if (Array.isArray(birdMesh.material)) {
        birdMesh.material.forEach((mat) => mat?.dispose());
      } else {
        birdMesh.material.dispose();
      }
    }
    birdMesh = null;
  }

  const geo = createBirdGeometry();
  const colors = new THREE.Color();
  const material = new THREE.MeshStandardMaterial({
    color: '#dfe9ff',
    metalness: 0.2,
    roughness: 0.45,
    flatShading: true,
  });
  birdMesh = new THREE.InstancedMesh(geo, material, params.birdCount);
  birdMesh.castShadow = true;
  birdMesh.receiveShadow = false;
  birdMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(params.birdCount * 3), 3);

  for (let i = 0; i < params.birdCount; i++) {
    const position = new THREE.Vector3(
      randomInRange(-50, 50),
      randomInRange(16, 64),
      randomInRange(-50, 50)
    );
    const velocity = new THREE.Vector3(randomInRange(-8, 8), randomInRange(-2, 2), randomInRange(-8, 8));
    boids.push({ position, velocity, acceleration: new THREE.Vector3(), color: new THREE.Color() });
    const hue = 0.55 + Math.sin(i * 0.31) * 0.08;
    colors.setHSL(hue, 0.55, 0.65 + Math.random() * 0.1);
    birdMesh.instanceColor.setXYZ(i, colors.r, colors.g, colors.b);
  }
  birdMesh.instanceColor.needsUpdate = true;
  scene.add(birdMesh);
  statusBirdCount.textContent = `${params.birdCount} birds`; 
}

function applyBoidRules() {
  const alignVec = new THREE.Vector3();
  const cohesionVec = new THREE.Vector3();
  const separationVec = new THREE.Vector3();

  for (let i = 0; i < boids.length; i++) {
    const boid = boids[i];
    alignVec.set(0, 0, 0);
    cohesionVec.set(0, 0, 0);
    separationVec.set(0, 0, 0);
    let neighborCount = 0;

    for (let j = 0; j < boids.length; j++) {
      if (i === j) continue;
      const other = boids[j];
      const distance = boid.position.distanceTo(other.position);
      if (distance < params.perceptionRadius) {
        alignVec.add(other.velocity);
        cohesionVec.add(other.position);
        neighborCount++;
      }
      if (distance < params.separationRadius) {
        separationVec.subVectors(boid.position, other.position).divideScalar(Math.max(distance, 0.001));
      }
    }

    if (neighborCount > 0) {
      alignVec.divideScalar(neighborCount).normalize().multiplyScalar(params.maxSpeed);
      alignVec.sub(boid.velocity).multiplyScalar(params.alignStrength);

      cohesionVec.divideScalar(neighborCount).sub(boid.position).multiplyScalar(params.cohesionStrength);
    }
    separationVec.multiplyScalar(params.separationStrength);

    const terrainH = groundHeightAt(boid.position.x, boid.position.z) + 6;
    const avoidGround = Math.max(0, terrainH - boid.position.y);
    const avoidVec = new THREE.Vector3(0, avoidGround * params.terrainAvoid * 0.02 + params.skyLift, 0);

    const wind = new THREE.Vector3(
      Math.sin(clock.elapsedTime * 0.1 + boid.position.z * 0.01) * params.windStrength,
      0,
      Math.cos(clock.elapsedTime * 0.12 + boid.position.x * 0.01) * params.windStrength
    );

    boid.acceleration.set(0, 0, 0);
    boid.acceleration.add(alignVec);
    boid.acceleration.add(cohesionVec);
    boid.acceleration.add(separationVec);
    boid.acceleration.add(avoidVec);
    boid.acceleration.add(wind.multiplyScalar(0.02));
  }
}

function updateBoids(delta) {
  applyBoidRules();
  const dummy = new THREE.Object3D();

  for (let i = 0; i < boids.length; i++) {
    const boid = boids[i];
    boid.velocity.add(boid.acceleration.multiplyScalar(delta * 60));
    const speed = boid.velocity.length();
    if (speed > params.maxSpeed) boid.velocity.multiplyScalar(params.maxSpeed / speed);

    boid.position.add(boid.velocity.clone().multiplyScalar(delta));

    // bounds wrapping
    ['x', 'y', 'z'].forEach((axis) => {
      const half = params.worldSize * (axis === 'y' ? 0.6 : 1);
      if (boid.position[axis] > half) boid.position[axis] = -half;
      if (boid.position[axis] < -half) boid.position[axis] = half;
    });
    boid.position.y = Math.max(10, boid.position.y);

    dummy.position.copy(boid.position);
    const forward = boid.velocity.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, forward).normalize();
    const adjustedUp = new THREE.Vector3().crossVectors(forward, right);
    dummy.matrix.makeBasis(right, adjustedUp, forward.negate());
    dummy.matrix.setPosition(dummy.position);
    birdMesh.setMatrixAt(i, dummy.matrix);
  }
  birdMesh.instanceMatrix.needsUpdate = true;
}

function updateChaseCamera(delta) {
  const target = boids[state.chaseIndex % boids.length];
  if (!target) return;
  const forward = target.velocity.clone().normalize();
  const offset = forward.clone().multiplyScalar(-12).add(new THREE.Vector3(0, 4, 0));
  const desired = target.position.clone().add(offset);
  chaseCamera.position.lerp(desired, 1 - Math.exp(-delta * 5));
  const lookAt = target.position.clone().add(forward.multiplyScalar(8));
  chaseCamera.lookAt(lookAt);
}

// GUI
const gui = new GUI({ title: 'Flocking Controls' });
gui.add(params, 'birdCount', 50, 240, 1).name('Birds').onFinishChange(initBirds);
gui.add(params, 'maxSpeed', 10, 70, 1).name('Max speed');
gui.add(params, 'perceptionRadius', 10, 80, 1).name('Perception');
gui.add(params, 'separationRadius', 4, 30, 1).name('Separation radius');
gui.add(params, 'alignStrength', 0.05, 0.4, 0.01).name('Align strength');
gui.add(params, 'cohesionStrength', 0.02, 0.2, 0.01).name('Cohesion strength');
gui.add(params, 'separationStrength', 0.1, 1.0, 0.05).name('Separation strength');
gui.add(params, 'windStrength', 0, 3, 0.05).name('Wind sway');
const viewFolder = gui.addFolder('Views & modes');
viewFolder.add({ toggle() { switchToBirdView(!state.birdView); } }, 'toggle').name('Toggle bird view');
viewFolder.add({ next() { state.chaseIndex = (state.chaseIndex + 1) % boids.length; } }, 'next').name('Next bird');

// Interaction
function switchToBirdView(enabled) {
  state.birdView = enabled;
  activeCamera = enabled ? chaseCamera : camera;
  statusMode.textContent = enabled ? 'Bird view' : 'Orbit view';
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  [camera, chaseCamera].forEach((cam) => {
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();
  });
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    state.paused = !state.paused;
  }
  if (e.key.toLowerCase() === 'b') switchToBirdView(!state.birdView);
  if (e.key.toLowerCase() === 'o') switchToBirdView(false);
  if (e.key.toLowerCase() === 'n') state.chaseIndex = (state.chaseIndex + 1) % boids.length;
});

// Build scene
createSky();
createSunlight();
createTerrain();
const water = createWater();
createRocks();
createGrass();
createTrees();
initBirds();
switchToBirdView(false);

statusMode.textContent = 'Orbit view';

let rippleTime = 0;
function animate() {
  stats.begin();
  const delta = Math.min(0.05, clock.getDelta());
  if (!state.paused) {
    updateBoids(delta);
    if (state.birdView) updateChaseCamera(delta);
    rippleTime += delta;
    if (params.showWaterRipples && water.material) {
      water.material.opacity = 0.8 + Math.sin(rippleTime * 2) * 0.04;
      water.rotation.z = Math.sin(rippleTime * 0.2) * 0.08;
    }
  }
  orbit.update();
  renderer.render(scene, activeCamera);
  stats.end();
  requestAnimationFrame(animate);
}

animate();
