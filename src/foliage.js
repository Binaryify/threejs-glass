// Procedural "plant behind the glass": a soft gradient backdrop plus
// instanced leaves that sway in the wind. Rendered off-screen and then
// refracted by the glass pass, so it never needs to look sharp.
import * as THREE from 'three';

const LEAF_COUNT = 460;

function leafGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.42, 0.18, 0.36, 0.72, 0, 1);
  s.bezierCurveTo(-0.36, 0.72, -0.42, 0.18, 0, 0);
  return new THREE.ShapeGeometry(s, 10);
}

// Shared by both materials: (x, y) shift applied to the farthest layer.
const parallax = { value: new THREE.Vector2() };

const backdropMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uParallax: parallax },
  depthWrite: false,
  vertexShader: /* glsl */ `
    uniform vec2 uParallax;
    varying vec2 vUv;
    void main() {
      vUv = uv - uParallax * 0.5;
      gl_Position = vec4(position.xy, 0.999, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    varying vec2 vUv;
    float blob(vec2 c, float r) { return smoothstep(r, 0.0, length(vUv - c)); }
    void main() {
      // pale, milky top-left -> deep green bottom-right
      float t = clamp(vUv.x * 0.9 + (1.0 - vUv.y) * 0.6 - 0.25, 0.0, 1.0);
      vec3 col = mix(vec3(0.30, 0.42, 0.24), vec3(0.02, 0.09, 0.03), t);
      // a few large out-of-focus light patches
      float w = sin(uTime * 0.3) * 0.02;
      col += vec3(0.20, 0.30, 0.10) * blob(vec2(0.78 + w, 0.80), 0.25);
      col += vec3(0.12, 0.22, 0.06) * blob(vec2(0.35, 0.25 - w), 0.30);
      col += vec3(0.10, 0.16, 0.05) * blob(vec2(0.95, 0.30), 0.22);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

const leafMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uParallax: parallax },
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    attribute float aSeed;
    attribute vec3 aColor;
    uniform float uTime;
    uniform vec2 uParallax;
    varying vec2 vLeaf;
    varying vec3 vColor;
    void main() {
      vec3 p = position;
      // flutter around the stem (local origin)
      float a = sin(uTime * (0.7 + aSeed * 0.8) + aSeed * 40.0) * 0.14
              + sin(uTime * 2.1 + aSeed * 13.0) * 0.05;
      float c = cos(a), s = sin(a);
      p.xy = mat2(c, s, -s, c) * p.xy;
      vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
      // whole-plant wind sway
      wp.x += sin(uTime * 0.55 + wp.y * 1.7) * 0.015;
      wp.y += cos(uTime * 0.45 + wp.x * 1.3) * 0.008;
      // far leaves (small z) drift more than near ones -> depth
      wp.xy += uParallax * (1.0 - wp.z * 1.4);
      vLeaf = position.xy;
      vColor = aColor;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vLeaf;
    varying vec3 vColor;
    void main() {
      float rib = 1.0 - 0.25 * smoothstep(0.035, 0.0, abs(vLeaf.x));
      float shade = 0.7 + 0.45 * vLeaf.y - abs(vLeaf.x) * 0.5;
      gl_FragColor = vec4(vColor * shade * rib, 1.0);
    }
  `,
});

// Seeded RNG so the plant looks the same every load.
function rng(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function gauss(rand) {
  return (rand() + rand() + rand() - 1.5) / 1.5;
}

function buildLeaves() {
  const rand = rng(7);
  const mesh = new THREE.InstancedMesh(leafGeometry(), leafMaterial, LEAF_COUNT);
  const seeds = new Float32Array(LEAF_COUNT);
  const colors = new Float32Array(LEAF_COUNT * 3);

  // Clusters biased toward the right and bottom, like a plant pressed to a window.
  // Coordinates are in "unit aspect" space: x in [-1, 1] scaled by aspect later.
  const clusters = [
    [0.55, 0.55], [0.85, 0.15], [0.35, -0.2], [0.75, -0.55],
    [0.05, -0.65], [-0.45, -0.75], [0.95, 0.75], [0.2, 0.25], [-0.2, -0.3],
    [-0.75, -0.2], [-0.6, 0.5], [-0.1, 0.7],
  ];

  const layout = []; // [x, y, z, size, angle] per leaf, x in unit space
  const dark = new THREE.Color(0.06, 0.2, 0.05);
  const bright = new THREE.Color(0.42, 0.62, 0.18);
  const yellow = new THREE.Color(0.62, 0.62, 0.2);
  const c = new THREE.Color();

  for (let i = 0; i < LEAF_COUNT; i++) {
    const [cx, cy] = clusters[i % clusters.length];
    const depth = rand(); // 0 = far, 1 = near
    layout.push([
      cx + gauss(rand) * 0.35,
      cy + gauss(rand) * 0.3,
      depth * 0.5,
      0.07 + rand() * 0.07 + depth * 0.05,
      rand() * Math.PI * 2,
    ]);

    seeds[i] = rand();
    c.copy(dark).lerp(bright, 0.25 + depth * 0.75 * rand());
    if (rand() < 0.08) c.lerp(yellow, 0.6);
    colors.set([c.r, c.g, c.b], i * 3);
  }

  mesh.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
  mesh.frustumCulled = false;
  return { mesh, layout };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _axis = new THREE.Vector3(0, 0, 1);

// Spread leaf positions across the viewport width without distorting leaves.
function placeLeaves({ mesh, layout }, aspect) {
  layout.forEach(([x, y, z, size, angle], i) => {
    _pos.set(x * aspect, y, z);
    _scl.set(size, size, 1);
    _q.setFromAxisAngle(_axis, angle);
    mesh.setMatrixAt(i, _m.compose(_pos, _q, _scl));
  });
  mesh.instanceMatrix.needsUpdate = true;
}

export function createFoliage() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backdropMaterial));
  const leaves = buildLeaves();
  scene.add(leaves.mesh);

  return {
    scene,
    camera,
    resize(aspect) {
      // keep leaves round on any aspect; spread the plant across the width
      camera.left = -aspect;
      camera.right = aspect;
      camera.updateProjectionMatrix();
      placeLeaves(leaves, aspect);
    },
    setParallax(x, y) {
      parallax.value.set(x, y);
    },
    update(time) {
      backdropMaterial.uniforms.uTime.value = time;
      leafMaterial.uniforms.uTime.value = time;
    },
  };
}
