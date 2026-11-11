// What sits behind the glass: a backdrop plane plus leaves at different
// depths, all in one group that turns with the pane (pivot = the glass).
// Leaves farther from the glass shift more when it turns (parallax) and are
// more out of focus (soft edges), which gives the depth-of-field look.
// An uploaded image replaces the plant on the backdrop.
import * as THREE from 'three';

const LEAF_COUNT = 460;
const NEAR_Z = -0.05;    // closest leaves, just behind the glass
const FAR_Z = -0.5;      // farthest leaves
const BACKDROP_Z = -0.6;
const BACKDROP_COVER = 2.2;  // backdrop size vs. the view at its depth, so a turned block stays covered

const backdropMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tImage: { value: null },
    uUseImage: { value: 0 },
    uUvScale: { value: new THREE.Vector2(1, 1) }, // cover-fit for the image
  },
  depthWrite: false,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tImage;
    uniform float uUseImage;
    uniform vec2 uUvScale;
    varying vec2 vUv;
    float blob(vec2 c, float r) { return smoothstep(r, 0.0, length(vUv - c)); }
    void main() {
      if (uUseImage > 0.5) {
        gl_FragColor = vec4(texture2D(tImage, (vUv - 0.5) * uUvScale + 0.5).rgb, 1.0);
        return;
      }
      // pale, milky top-left -> deep green bottom-right
      float t = clamp(vUv.x * 0.9 + (1.0 - vUv.y) * 0.6 - 0.25, 0.0, 1.0);
      vec3 col = mix(vec3(0.30, 0.42, 0.24), vec3(0.02, 0.09, 0.03), t);
      // a few large out-of-focus light patches
      col += vec3(0.20, 0.30, 0.10) * blob(vec2(0.70, 0.70), 0.2);
      col += vec3(0.12, 0.22, 0.06) * blob(vec2(0.40, 0.32), 0.22);
      col += vec3(0.10, 0.16, 0.05) * blob(vec2(0.80, 0.38), 0.16);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

// Leaves are drawn on a padded quad as a soft shape, so each one can be
// blurred by its own amount (aBlur, in leaf lengths).
const leafMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    attribute vec3 aColor;
    attribute float aBlur;
    varying vec2 vLeaf;
    varying vec3 vColor;
    varying float vBlur;
    void main() {
      vLeaf = position.xy;
      vColor = aColor;
      vBlur = aBlur;
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vLeaf;
    varying vec3 vColor;
    varying float vBlur;
    void main() {
      // leaf: base at y = 0, tip at y = 1, widest just below the middle
      float y = clamp(vLeaf.y, 0.0, 1.0);
      float halfWidth = 0.4 * pow(sin(3.14159 * y), 0.8) * (1.0 - 0.25 * y);
      float d = max(abs(vLeaf.x) - halfWidth, max(-vLeaf.y, vLeaf.y - 1.0));
      float alpha = 1.0 - smoothstep(-vBlur, vBlur, d);
      if (alpha < 0.003) discard;
      float rib = 1.0 - 0.25 * smoothstep(0.035, 0.0, abs(vLeaf.x)) * (1.0 - vBlur * 3.0);
      float shade = 0.7 + 0.45 * y - abs(vLeaf.x) * 0.5;
      gl_FragColor = vec4(vColor * shade * rib, alpha);
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

// Padded leaf quad (room for the blur), origin at the leaf base.
function leafGeometry() {
  const g = new THREE.PlaneGeometry(1.8, 2.0);
  g.translate(0, 0.5, 0);
  return g;
}

function buildLeaves() {
  const rand = rng(7);
  // Clusters biased toward the right and bottom, like a plant pressed to a window.
  // x is in units of the view half-height times aspect, y in view half-heights.
  const clusters = [
    [0.55, 0.55], [0.85, 0.15], [0.35, -0.2], [0.75, -0.55],
    [0.05, -0.65], [-0.45, -0.75], [0.95, 0.75], [0.2, 0.25], [-0.2, -0.3],
    [-0.75, -0.2], [-0.6, 0.5], [-0.1, 0.7],
  ];
  const dark = new THREE.Color(0.06, 0.2, 0.05);
  const bright = new THREE.Color(0.42, 0.62, 0.18);
  const yellow = new THREE.Color(0.62, 0.62, 0.2);
  const c = new THREE.Color();

  const leaves = [];
  for (let i = 0; i < LEAF_COUNT; i++) {
    const [cx, cy] = clusters[i % clusters.length];
    const near = rand(); // 0 = far, 1 = close to the glass
    const leaf = {
      x: cx + gauss(rand) * 0.35,
      y: cy + gauss(rand) * 0.3,
      z: FAR_Z + (NEAR_Z - FAR_Z) * near,
      size: 0.07 + rand() * 0.07 + near * 0.05,
      angle: rand() * Math.PI * 2,
      blur: 0.03 + Math.pow(1 - near, 1.5) * 0.45, // in focus at the glass
    };
    rand();
    c.copy(dark).lerp(bright, 0.25 + near * 0.75 * rand());
    if (rand() < 0.08) c.lerp(yellow, 0.6);
    leaf.color = c.toArray();
    leaves.push(leaf);
  }
  // transparent quads: draw far to near
  leaves.sort((a, b) => a.z - b.z);

  const mesh = new THREE.InstancedMesh(leafGeometry(), leafMaterial, LEAF_COUNT);
  mesh.geometry.setAttribute('aColor',
    new THREE.InstancedBufferAttribute(new Float32Array(leaves.flatMap((l) => l.color)), 3));
  mesh.geometry.setAttribute('aBlur',
    new THREE.InstancedBufferAttribute(new Float32Array(leaves.map((l) => l.blur)), 1));
  mesh.frustumCulled = false;
  return { mesh, leaves };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _axis = new THREE.Vector3(0, 0, 1);

// Place leaves so that, at rest, they land on the same spots of the view
// whatever their depth: positions and sizes scale with distance to the camera.
function placeLeaves({ mesh, leaves }, aspect, halfH, cameraZ) {
  leaves.forEach(({ x, y, z, size, angle }, i) => {
    const k = halfH * (cameraZ - z) / cameraZ;
    _pos.set(x * k * aspect, y * k, z);
    _scl.set(size * k, size * k, 1);
    _q.setFromAxisAngle(_axis, angle);
    mesh.setMatrixAt(i, _m.compose(_pos, _q, _scl));
  });
  mesh.instanceMatrix.needsUpdate = true;
}

export function createFoliage() {
  const scene = new THREE.Scene();
  const group = new THREE.Group(); // turns with the glass
  scene.add(group);

  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backdropMaterial);
  backdrop.position.z = BACKDROP_Z;
  backdrop.renderOrder = -1;
  group.add(backdrop);

  const plant = buildLeaves();
  group.add(plant.mesh);

  let aspect = 1;
  let image = null;

  function updateCoverFit() {
    const s = backdropMaterial.uniforms.uUvScale.value;
    if (!image) return s.set(1, 1);
    const imgA = image.image.width / image.image.height;
    s.set(Math.min(1, aspect / imgA), Math.min(1, imgA / aspect));
  }

  return {
    scene,
    group,
    // camera: the perspective camera that looks through the glass
    resize(camera) {
      aspect = camera.aspect;
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
      placeLeaves(plant, aspect, halfH, camera.position.z);
      const h = 2 * halfH * ((camera.position.z - BACKDROP_Z) / camera.position.z) * BACKDROP_COVER;
      backdrop.scale.set(h * aspect, h, 1);
      updateCoverFit();
    },
    // texture or null to show the plant again
    setImage(tex) {
      image?.dispose();
      image = tex;
      plant.mesh.visible = !tex;
      backdropMaterial.uniforms.tImage.value = tex;
      backdropMaterial.uniforms.uUseImage.value = tex ? 1 : 0;
      updateCoverFit();
    },
  };
}
