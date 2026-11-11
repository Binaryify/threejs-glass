import * as THREE from 'three';
import { createFoliage } from './foliage.js';
import { createGlass } from './glass.js';

const SCENE_SCALE = 0.5;  // half res keeps the in-focus leaves readable
const MAX_TILT = 0.4;     // radians the pane can be turned (about 23 degrees)
const DRAG_GAIN = 1.4;    // radians per viewport width dragged

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x050805);

const foliage = createFoliage();
const glass = createGlass();
const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });

function resize() {
  const w = innerWidth, h = innerHeight;
  const dpr = renderer.getPixelRatio();
  renderer.setSize(w, h, false);
  target.setSize(Math.round(w * dpr * SCENE_SCALE), Math.round(h * dpr * SCENE_SCALE));
  glass.resize(w, h, dpr);
  foliage.resize(glass.camera); // after glass.resize: it uses the camera aspect
  glass.uniforms.uCell.value = Math.max(16, Math.min(w, h) / 40);
}

// ---- drag to turn the whole pane --------------------------------------
// tilt follows the hand: +x = dragged down, +y = dragged right.
const tilt = new THREE.Vector2();
const tiltVel = new THREE.Vector2();
const tiltAim = new THREE.Vector2();
let drag = null; // { x, y, aim } at pointerdown

canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, aim: tiltAim.clone() };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const k = DRAG_GAIN / innerWidth;
  // limit the total turn (not each axis), so diagonal drags don't overshoot
  tiltAim.set(drag.aim.x + (e.clientY - drag.y) * k, drag.aim.y + (e.clientX - drag.x) * k)
    .clampLength(0, MAX_TILT);
});
const release = () => {
  drag = null;
  tiltAim.set(0, 0); // the pane swings back on its own
  canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// Damped spring: a heavy pane that follows the hand and settles with a sway.
const STIFFNESS = 40, DAMPING = 9;
const _force = new THREE.Vector2();

function updateMotion(t, dt) {
  // a faint idle breathing so the light is never perfectly still
  const idle = drag ? 0 : 1;
  const aimX = tiltAim.x + idle * 0.015 * Math.sin(t * 0.4);
  const aimY = tiltAim.y + idle * 0.02 * Math.sin(t * 0.27 + 1.0);

  _force.set(aimX - tilt.x, aimY - tilt.y).multiplyScalar(STIFFNESS)
    .addScaledVector(tiltVel, -DAMPING);
  tiltVel.addScaledVector(_force, dt);
  tilt.addScaledVector(tiltVel, dt);

  // A mirror turned to the left throws the reflection to the right, so the pane
  // turns against the drag and the light follows the hand.
  glass.pane.rotation.set(-tilt.x, -tilt.y, 0);
  foliage.group.rotation.copy(glass.pane.rotation); // one block with the glass
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
document.getElementById('reset').onclick = () => foliage.setImage(null);
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
    foliage.setImage(tex);
  });
}

// ---- loop ---------------------------------------------------------------
const clock = new THREE.Clock();
let time = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!paused) time += dt;
  updateMotion(time, dt);

  // the scene behind the glass turns with it, so it is drawn every frame
  renderer.setRenderTarget(target);
  renderer.render(foliage.scene, glass.camera);
  renderer.setRenderTarget(null);
  glass.uniforms.tSource.value = target.texture;

  glass.uniforms.uTime.value = time;
  renderer.render(glass.scene, glass.camera);
});

addEventListener('resize', resize);
resize();
