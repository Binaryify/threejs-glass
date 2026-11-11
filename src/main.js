import * as THREE from 'three';
import { createFoliage } from './foliage.js';
import { createGlass } from './glass.js';

const SCENE_SCALE = 0.25; // the plant is out of focus anyway; quarter res is enough
const IDLE_MS = 2500;     // after this, the light drifts on its own
const MAX_TILT = 0.16;    // radians the pane leans while held
const PARALLAX = 0.06;    // how far the farthest leaves shift at full tilt

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x050805);

const foliage = createFoliage();
const glass = createGlass();
const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });

let image = null; // uploaded THREE.Texture, or null to show the plant

function resize() {
  const w = innerWidth, h = innerHeight;
  const dpr = renderer.getPixelRatio();
  renderer.setSize(w, h, false);
  target.setSize(Math.round(w * dpr * SCENE_SCALE), Math.round(h * dpr * SCENE_SCALE));
  foliage.resize(w / h);
  glass.resize(w, h, dpr);
  glass.uniforms.uCell.value = Math.max(16, Math.min(w, h) / 40);
  updateCoverFit();
}

// Map screen uv -> image uv so an uploaded photo covers the viewport.
function updateCoverFit() {
  const s = glass.uniforms.uUvScale.value;
  if (!image) return s.set(1, 1);
  const screenA = innerWidth / innerHeight;
  const imgA = image.image.width / image.image.height;
  s.set(Math.min(1, screenA / imgA), Math.min(1, imgA / screenA));
}

// ---- pointer ------------------------------------------------------------
const pointer = new THREE.Vector2(); // NDC, -1..1
let lastMove = -Infinity;
let holding = false;

function setPointer(e) {
  pointer.set((e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2);
  lastMove = performance.now();
}
canvas.addEventListener('pointermove', setPointer);
canvas.addEventListener('pointerdown', (e) => {
  setPointer(e);
  holding = true;
  canvas.setPointerCapture(e.pointerId);
});
const release = () => (holding = false);
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// ---- motion: light, press and tilt all ease toward their targets --------
const raycaster = new THREE.Raycaster();
const light = new THREE.Vector2(0.35, 0.7); // pane uv
const lightAim = light.clone();
const tilt = new THREE.Vector2(); // (rotation x, rotation y)
const tiltAim = new THREE.Vector2();
let press = 0;

const ease = (rate, dt) => 1 - Math.exp(-dt * rate);

function updateMotion(t, dt) {
  if (!holding && performance.now() - lastMove > IDLE_MS) {
    pointer.set(0.62 * Math.sin(t * 0.21), 0.55 * Math.sin(t * 0.33 + 1.2));
  }

  // press: quick to sink in, slower to recover
  press += ((holding ? 1 : 0) - press) * ease(holding ? 2.5 : 1.5, dt);

  // the pane leans away under the finger and springs flat on release
  tiltAim.set(-pointer.y, pointer.x).multiplyScalar(holding ? MAX_TILT : 0);
  tilt.lerp(tiltAim, ease(4, dt));
  glass.pane.rotation.set(tilt.x, tilt.y, 0);
  glass.pane.position.z = -0.04 * press;
  glass.pane.updateMatrixWorld();

  // the plant sits behind the glass, so it slides the other way
  foliage.setParallax((-tilt.y / MAX_TILT) * PARALLAX, (tilt.x / MAX_TILT) * PARALLAX);

  // the light lives on the pane: project the pointer onto the tilted surface
  raycaster.setFromCamera(pointer, glass.camera);
  const hit = raycaster.intersectObject(glass.pane)[0];
  if (hit) lightAim.copy(hit.uv);
  light.lerp(lightAim, ease(3, dt));

  const u = glass.uniforms;
  u.uLight.value.copy(light).multiply(u.uRes.value);
  u.uPress.value = press;
}

// ---- controls -----------------------------------------------------------
let paused = false;
const pauseBtn = document.getElementById('pause');
const fileInput = document.getElementById('file');

pauseBtn.onclick = () => {
  paused = !paused;
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
};
document.getElementById('pick').onclick = () => fileInput.click();
document.getElementById('reset').onclick = () => setImage(null);
fileInput.onchange = () => fileInput.files[0] && loadImage(fileInput.files[0]);
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file?.type.startsWith('image/')) loadImage(file);
});

function loadImage(file) {
  const url = URL.createObjectURL(file);
  new THREE.TextureLoader().load(url, (tex) => {
    URL.revokeObjectURL(url);
    setImage(tex);
  });
}

function setImage(tex) {
  image?.dispose();
  image = tex;
  updateCoverFit();
}

// ---- loop ---------------------------------------------------------------
const clock = new THREE.Clock();
let time = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!paused) time += dt;
  updateMotion(time, dt);

  if (image) {
    glass.uniforms.tSource.value = image;
  } else {
    foliage.update(time);
    renderer.setRenderTarget(target);
    renderer.render(foliage.scene, foliage.camera);
    renderer.setRenderTarget(null);
    glass.uniforms.tSource.value = target.texture;
  }

  glass.uniforms.uTime.value = time;
  renderer.render(glass.scene, glass.camera);
});

addEventListener('resize', resize);
resize();
