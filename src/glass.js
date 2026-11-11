// A 3D pane of "wired hammered glass" in front of any texture:
// procedural bump height field -> refraction + frost blur, embedded wire mesh,
// and a fixed light whose reflection produces milky scatter and glints.
// Turning the pane moves that reflection. The source is a render of the 3D
// scene behind the glass, which turns with the pane as one block.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying mat3 vFrame;    // pane tangent, bitangent, normal in world space
  void main() {
    vUv = uv;
    mat3 m = mat3(modelMatrix);
    vFrame = mat3(normalize(m[0]), normalize(m[1]), normalize(m[2]));
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D tSource;
  uniform vec2 uRes;       // pane size in CSS px
  uniform vec2 uScreen;    // drawing buffer size in device px
  uniform float uOverscan; // pane size / viewport size (pane px -> screen uv)
  uniform vec3 uLightPos;  // fixed light in world space, in front of the pane
  uniform float uTime;
  uniform float uCell;     // wire grid cell size in CSS px

  varying vec2 vUv;
  varying vec3 vWorld;
  varying mat3 vFrame;

  // ---- noise ------------------------------------------------------------
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
  }
  float gnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(dot(hash2(i), f), dot(hash2(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
               mix(dot(hash2(i + vec2(0, 1)), f - vec2(0, 1)), dot(hash2(i + 1.0), f - 1.0), u.x), u.y);
  }

  // Hammered glass: fine dimples on top of a slow wavy undulation.
  float height(vec2 p) {
    return gnoise(p / 6.0) * 0.55
         + gnoise(p / 2.7 + 17.0) * 0.22
         + gnoise(p / 40.0 + 5.0) * 2.2;
  }
  vec3 glassNormal(vec2 p) {
    const float e = 0.75;
    float dx = height(p + vec2(e, 0)) - height(p - vec2(e, 0));
    float dy = height(p + vec2(0, e)) - height(p - vec2(0, e));
    return normalize(vec3(-dx, -dy, 2.0 * e * 0.3));
  }

  vec3 source(vec2 uv) {
    return texture2D(tSource, uv).rgb;
  }

  // 12-tap golden-angle disc blur = frosting.
  vec3 frosted(vec2 uv, float radiusPx) {
    vec3 acc = vec3(0.0);
    vec2 px = radiusPx / uRes * uOverscan;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / 12.0);
      float a = fi * 2.39996;
      acc += source(uv + vec2(cos(a), sin(a)) * r * px);
    }
    return acc / 12.0;
  }

  void main() {
    vec2 p = vUv * uRes;                 // CSS px on the pane
    vec3 nb = glassNormal(p);            // bump normal, pane space

    // Lighting is in world space, so turning the pane sweeps the reflection
    // of the fixed light across the glass (at twice the angle).
    vec3 Nm = vFrame[2];
    vec3 N = normalize(vFrame * nb);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uLightPos - vWorld);
    vec3 H = normalize(L + V);

    float nh = max(dot(Nm, H), 0.0);
    float haze = pow(nh, 70.0) * 0.8 + pow(nh, 16.0) * 0.3;   // milky scatter
    float glow = pow(nh, 16.0);
    float spec = pow(max(dot(N, H), 0.0), 150.0) * (0.02 + 1.1 * pow(nh, 40.0));
    float relief = dot(N, L) - dot(Nm, L);                     // bump shading

    // refraction + frost (frost grows where the light scatters)
    // The source is the 3D scene behind the glass as seen on screen; it
    // turns with the pane, so glass and plant move as one block with depth.
    vec2 uv = gl_FragCoord.xy / uScreen + nb.xy * 16.0 / uRes * uOverscan;
    vec3 col = frosted(uv, 3.0 + 10.0 * haze);

    col *= 1.0 + relief * (0.1 + 1.2 * glow);
    col = mix(col, vec3(0.84, 0.89, 0.83), clamp(haze, 0.0, 1.0) * 0.78);
    col += spec * vec3(1.0, 1.0, 0.96);

    // wire mesh, seen through the bumps so it wobbles slightly
    vec2 pw = p + nb.xy * 0.9;
    vec2 g = abs(fract(pw / uCell + 0.5) - 0.5) * uCell;
    float d = min(g.x, g.y);
    float wire = 1.0 - smoothstep(0.25, 1.05, d);
    float edge = (1.0 - smoothstep(1.0, 2.0, d)) - wire;  // thin shadow beside the wire
    vec3 wireCol = col * 1.5 + vec3(0.1, 0.13, 0.1) + haze * 0.25;
    col *= 1.0 - edge * 0.18;
    col = mix(col, wireCol, wire * 0.75);
    col += wire * spec * haze * 0.6;

    // vignette + grain
    vec2 q = vUv - 0.5;
    col *= 1.0 - dot(q, q) * 0.55;
    col += (fract(sin(dot(p + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.025;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const FOV = 35;
// The pane is larger than the view so its edges stay hidden when it tilts.
// 1.75 covers a 0.4 rad turn on both axes at once.
const OVERSCAN = 1.75;

export function createGlass() {
  const uniforms = {
    tSource: { value: null },
    uScreen: { value: new THREE.Vector2(1, 1) },
    uOverscan: { value: OVERSCAN },
    uRes: { value: new THREE.Vector2(1, 1) },
    // upper-left, slightly behind the viewer: its reflection starts top-left
    uLightPos: { value: new THREE.Vector3(-0.5, 0.5, 1.0) },
    uTime: { value: 0 },
    uCell: { value: 24 },
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.z = 1;
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader }),
  );
  scene.add(pane);

  return {
    scene,
    camera,
    pane,
    uniforms,
    // w, h: viewport in CSS px; dpr: device pixel ratio of the drawing buffer
    resize(w, h, dpr) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const visH = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * camera.position.z;
      pane.scale.set(visH * camera.aspect * OVERSCAN, visH * OVERSCAN, 1);
      uniforms.uRes.value.set(w * OVERSCAN, h * OVERSCAN);
      uniforms.uScreen.value.set(w * dpr, h * dpr);
    },
  };
}
