// A 3D pane of "wired hammered glass" in front of any texture:
// procedural bump height field -> refraction + frost blur, embedded wire mesh,
// and a moving point light that produces milky scatter and specular glints.
// The source is sampled in screen space, so tilting the pane creates parallax.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D tSource;
  uniform vec2 uUvScale;   // cover-fit for arbitrary images
  uniform vec2 uRes;       // pane size in CSS px
  uniform vec2 uScreen;    // drawing buffer size in device px
  uniform vec2 uLight;     // light position on the pane in CSS px (y up)
  uniform float uPress;    // 0..1, how hard the pane is being held
  uniform float uTime;
  uniform float uCell;     // wire grid cell size in CSS px

  varying vec2 vUv;

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
    return texture2D(tSource, (uv - 0.5) * uUvScale + 0.5).rgb;
  }

  // 12-tap golden-angle disc blur = frosting.
  vec3 frosted(vec2 uv, float radiusPx) {
    vec3 acc = vec3(0.0);
    vec2 px = radiusPx / uRes;
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
    float minRes = min(uRes.x, uRes.y);
    vec3 n = glassNormal(p);

    // light: wide milky halo + sharp glints off every dimple
    vec2 toLight = uLight - p;
    float dist = length(toLight) / minRes;
    // holding spreads the fog across the pane
    float haze = exp(-dist * dist * mix(10.0, 3.0, uPress));
    vec3 L = normalize(vec3(toLight, 0.45 * minRes));
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, H), 0.0), 70.0);
    float relief = dot(n, L) - L.z;      // bump shading relative to flat glass

    // refraction + frost (frost grows inside the halo, like light scattering)
    vec2 uv = gl_FragCoord.xy / uScreen + n.xy * 16.0 / uRes;
    vec3 col = frosted(uv, 6.0 + (6.0 + 6.0 * uPress) * haze);

    col *= 1.0 + relief * (0.15 + 0.8 * haze);
    col = mix(col, vec3(0.84, 0.89, 0.83), haze * (0.7 + 0.15 * uPress));
    col += spec * (0.03 + 0.8 * haze) * vec3(1.0, 1.0, 0.96);

    // wire mesh, seen through the bumps so it wobbles slightly
    vec2 pw = p + n.xy * 0.9;
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
const OVERSCAN = 1.2; // pane is larger than the view so tilted edges stay hidden

export function createGlass() {
  const uniforms = {
    tSource: { value: null },
    uUvScale: { value: new THREE.Vector2(1, 1) },
    uRes: { value: new THREE.Vector2(1, 1) },
    uScreen: { value: new THREE.Vector2(1, 1) },
    uLight: { value: new THREE.Vector2(0, 0) },
    uPress: { value: 0 },
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
    // w, h: CSS px; dpr: device pixel ratio of the drawing buffer
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
