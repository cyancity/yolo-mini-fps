import * as THREE from 'three';
import { fsVert, depthLib } from './glsl.js';

// 半分辨率 GTAO（地平线积分），法线由深度重建。输出 rgb = 可见度，a = 线性深度。
const aoFrag = /* glsl */ `
${depthLib}
uniform vec2 uTexel;
uniform float uRadius;
uniform float uProjScale;
uniform float uAspect;
uniform float uFrame;
uniform float uPower;
varying vec2 vUv;
#define PI 3.14159265
#define HALF_PI 1.5707963
#define SLICES 3
#define STEPS 5

vec3 vp(vec2 uv) { return viewPos(uv, fetchDepth(uv)); }

void main() {
  float d = fetchDepth(vUv);
  if (d >= 0.99999) { gl_FragColor = vec4(1.0, 1.0, 1.0, 1e4); return; }
  vec3 P = viewPos(vUv, d);
  vec3 r = vp(vUv + vec2(uTexel.x, 0.0)), l = vp(vUv - vec2(uTexel.x, 0.0));
  vec3 u = vp(vUv + vec2(0.0, uTexel.y)), dn = vp(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(r.z - P.z) < abs(P.z - l.z) ? r - P : P - l;
  vec3 dy = abs(u.z - P.z) < abs(P.z - dn.z) ? u - P : P - dn;
  vec3 N = normalize(cross(dx, dy));
  vec3 V = normalize(-P);

  float n1 = ign(gl_FragCoord.xy + uFrame * 5.588238);
  float n2 = ign(gl_FragCoord.yx * 1.37 + uFrame * 3.71 + 17.0);

  // 贴脸的视图模型用更小的半径，避免把整把枪压黑
  float radius = uRadius * clamp(-P.z * 0.6, 0.12, 1.0);
  float rUv = clamp(radius * uProjScale / -P.z, uTexel.y * 4.0, 0.18);
  float fRange = 0.615 * radius, fFrom = radius * (1.0 - 0.615);
  float fMul = -1.0 / fRange, fAdd = fFrom / fRange + 1.0;

  float vis = 0.0;
  for (int s = 0; s < SLICES; s++) {
    float phi = (float(s) + n1) * PI / float(SLICES);
    vec2 om = vec2(cos(phi), sin(phi));
    vec3 dirV = vec3(om, 0.0);
    vec3 ortho = dirV - dot(dirV, V) * V;
    vec3 axis = normalize(cross(ortho, V));
    vec3 pN = N - axis * dot(N, axis);
    float pLen = length(pN);
    float sgn = sign(dot(ortho, pN));
    float cosN = clamp(dot(pN, V) / max(pLen, 1e-5), 0.0, 1.0);
    float n = sgn * acos(cosN);
    float low0 = cos(n + HALF_PI), low1 = cos(n - HALF_PI);
    float hc0 = low0, hc1 = low1;
    vec2 stepUv = om * vec2(1.0 / uAspect, 1.0) * rUv;
    for (int i = 0; i < STEPS; i++) {
      float t = (float(i) + n2) / float(STEPS);
      t = t * t + 0.02;
      vec2 o = stepUv * t;
      vec3 s0 = vp(vUv + o) - P;
      vec3 s1 = vp(vUv - o) - P;
      float d0 = length(s0), d1 = length(s1);
      float w0 = clamp(d0 * fMul + fAdd, 0.0, 1.0);
      float w1 = clamp(d1 * fMul + fAdd, 0.0, 1.0);
      hc0 = max(hc0, mix(low0, dot(s0 / max(d0, 1e-5), V), w0));
      hc1 = max(hc1, mix(low1, dot(s1 / max(d1, 1e-5), V), w1));
    }
    pLen = mix(pLen, 1.0, 0.05);
    float h0 = -acos(clamp(hc1, -1.0, 1.0));
    float h1 = acos(clamp(hc0, -1.0, 1.0));
    h0 = n + clamp(h0 - n, -HALF_PI, HALF_PI);
    h1 = n + clamp(h1 - n, -HALF_PI, HALF_PI);
    float i0 = (cosN + 2.0 * h0 * sin(n) - cos(2.0 * h0 - n)) * 0.25;
    float i1 = (cosN + 2.0 * h1 * sin(n) - cos(2.0 * h1 - n)) * 0.25;
    vis += pLen * (i0 + i1);
  }
  vis = pow(clamp(vis / float(SLICES), 0.0, 1.0), uPower);
  gl_FragColor = vec4(vec3(vis), -P.z);
}`;

// 3x3 深度加权模糊，AO 和体积雾共用（a 通道是线性深度）
const blurFrag = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uSpread;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tInput, vUv);
  vec3 acc = c.rgb;
  float wsum = 1.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      vec4 s = texture2D(tInput, vUv + vec2(float(i), float(j)) * uTexel * uSpread);
      float w = 1.0 / (1.0 + 80.0 * abs(s.a - c.a) / max(c.a, 0.05));
      acc += s.rgb * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4(acc / wsum, c.a);
}`;

export function makeAOMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: aoFrag,
    uniforms: {
      tDepth: { value: null },
      uInvProj: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2() },
      uRadius: { value: 0.9 },
      uProjScale: { value: 1 },
      uAspect: { value: 1 },
      uFrame: { value: 0 },
      uPower: { value: 1.6 },
    },
    depthTest: false,
    depthWrite: false,
  });
}

export function makeBlurMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: blurFrag,
    uniforms: {
      tInput: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uSpread: { value: 1 },
    },
    depthTest: false,
    depthWrite: false,
  });
}
