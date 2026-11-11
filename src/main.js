import * as THREE from 'three';
import { createFoliage } from './foliage.js';
import { createGlass } from './glass.js';

const SCENE_SCALE = 0.25; // the plant is out of focus anyway; quarter res is enough
const MAX_TILT = 0.35;    // radians the pane can be turned (as seen by the light)
const DRAG_GAIN = 1.4;    // radians per viewport width dragged
const GEO_TILT = 0.3;     // visible geometric tilt, as a fraction of the light tilt

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x050805);

const foliage = createFoliage();
const glass = createGlass();
const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });

let image = null; // uploaded THREE.Texture, or null to show the plant
let plantDirty = true; // the plant is static: re-render it only after a resize

function resize() {
  const w = innerWidth, h = innerHeight;
  const dpr = renderer.getPixelRatio();
  renderer.setSize(w, h, false);
  target.setSize(Math.round(w * dpr * SCENE_SCALE), Math.round(h * dpr * SCENE_SCALE));
  foliage.resize(w / h);
  plantDirty = true;
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
  tiltAim.set(
    THREE.MathUtils.clamp(drag.aim.x + (e.clientY - drag.y) * k, -MAX_TILT, MAX_TILT),
    THREE.MathUtils.clamp(drag.aim.y + (e.clientX - drag.x) * k, -MAX_TILT, MAX_TILT),
  );
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
const _euler = new THREE.Euler();
const _rot = new THREE.Matrix4();

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
  // turns against the drag and the light follows the hand. The visible tilt
  // is small; the lighting sees the full angle, like a big pane far away.
  _euler.set(-tilt.x, -tilt.y, 0);
  glass.uniforms.uShade.value.setFromMatrix4(_rot.makeRotationFromEuler(_euler));
  glass.pane.rotation.set(-tilt.x * GEO_TILT, -tilt.y * GEO_TILT, 0);
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

  if (!image && plantDirty) {
    renderer.setRenderTarget(target);
    renderer.render(foliage.scene, foliage.camera);
    renderer.setRenderTarget(null);
    plantDirty = false;
  }
  glass.uniforms.tSource.value = image ?? target.texture;

  glass.uniforms.uTime.value = time;
  renderer.render(glass.scene, glass.camera);
});

addEventListener('resize', resize);
resize();
