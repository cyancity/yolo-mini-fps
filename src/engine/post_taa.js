import * as THREE from 'three';
import { fsVert, depthLib, upsampleLib, VM_DEPTH } from './glsl.js';

// 场景色 × AO + 体积雾
const compositeFrag = /* glsl */ `
${depthLib}
${upsampleLib}
uniform sampler2D tScene;
uniform sampler2D tAO;
uniform sampler2D tFog;
uniform vec2 uHalfTexel;
uniform float uAOStrength;
uniform float uFogStrength;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  float d = fetchDepth(vUv);
  float z = -viewPos(vUv, min(d, 0.999995)).z;
  if (d < 0.99999) {
    float ao = depthUpsample(tAO, vUv, z, uHalfTexel).r;
    c *= mix(1.0, ao, uAOStrength);
  }
  c += depthUpsample(tFog, vUv, z, uHalfTexel).rgb * uFogStrength;
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}`;

// 时域抗锯齿：深度重投影 + YCoCg 方差裁剪。视图模型像素不做重投影。
const taaFrag = /* glsl */ `
#define VM_DEPTH ${VM_DEPTH.toFixed(3)}
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform vec2 uJitter;
uniform vec2 uTexel;
uniform float uBlend;
uniform float uReset;
varying vec2 vUv;

vec3 tmIn(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 tmOut(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-4); }
vec3 toYCoCg(vec3 c) {
  return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25)));
}
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }

// 9 次采样的 Catmull-Rom 滤波，做法出自 Matt Pettineo（TheRealMJP）的公开实现，MIT，见 THIRD_PARTY_NOTICES.md
vec3 historyCatmullRom(vec2 uv) {
  vec2 size = 1.0 / uTexel;
  vec2 pos = uv * size;
  vec2 p1 = floor(pos - 0.5) + 0.5;
  vec2 f = pos - p1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (p1 - 1.0) * uTexel;
  vec2 t3 = (p1 + 2.0) * uTexel;
  vec2 t12 = (p1 + w2 / w12) * uTexel;
  vec3 r = vec3(0.0);
  r += texture2D(tHistory, vec2(t0.x, t0.y)).rgb * w0.x * w0.y;
  r += texture2D(tHistory, vec2(t12.x, t0.y)).rgb * w12.x * w0.y;
  r += texture2D(tHistory, vec2(t3.x, t0.y)).rgb * w3.x * w0.y;
  r += texture2D(tHistory, vec2(t0.x, t12.y)).rgb * w0.x * w12.y;
  r += texture2D(tHistory, vec2(t12.x, t12.y)).rgb * w12.x * w12.y;
  r += texture2D(tHistory, vec2(t3.x, t12.y)).rgb * w3.x * w12.y;
  r += texture2D(tHistory, vec2(t0.x, t3.y)).rgb * w0.x * w3.y;
  r += texture2D(tHistory, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;
  r += texture2D(tHistory, vec2(t3.x, t3.y)).rgb * w3.x * w3.y;
  return max(r, 0.0);
}

void main() {
  vec3 curRaw = texture2D(tCurrent, vUv).rgb;
  if (uReset > 0.5) { gl_FragColor = vec4(curRaw, 1.0); return; }

  // 取 3x3 邻域里最近的深度做重投影，边缘更稳
  float dmin = texture2D(tDepth, vUv).r;
  vec2 off = vec2(0.0);
  for (int j = -1; j <= 1; j += 2) {
    for (int i = -1; i <= 1; i += 2) {
      vec2 o = vec2(float(i), float(j));
      float dd = texture2D(tDepth, vUv + o * uTexel).r;
      if (dd < dmin) { dmin = dd; off = o; }
    }
  }
  vec2 uvPrev = vUv;
  if (dmin >= VM_DEPTH) {
    vec2 ndc = (vUv + off * uTexel) * 2.0 - 1.0 - uJitter;
    vec4 w = uInvViewProj * vec4(ndc, dmin * 2.0 - 1.0, 1.0);
    w /= w.w;
    vec4 p = uPrevViewProj * w;
    uvPrev = vUv + (p.xy / p.w - ndc) * 0.5;
  }

  vec3 cur = toYCoCg(tmIn(curRaw));
  vec3 m1 = cur, m2 = cur * cur;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      vec3 c = toYCoCg(tmIn(texture2D(tCurrent, vUv + vec2(float(i), float(j)) * uTexel).rgb));
      m1 += c;
      m2 += c * c;
    }
  }
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));
  float motion = length((uvPrev - vUv) / uTexel);
  float gamma = mix(1.25, 0.9, clamp(motion / 12.0, 0.0, 1.0));
  vec3 lo = mean - gamma * sigma, hi = mean + gamma * sigma;

  vec3 hist = toYCoCg(tmIn(historyCatmullRom(uvPrev)));
  // 朝邻域均值裁剪（clip 而不是 clamp，保住色相）
  vec3 center = 0.5 * (hi + lo), ext = 0.5 * (hi - lo) + 1e-5;
  vec3 dv = hist - center;
  vec3 a = abs(dv / ext);
  float ma = max(a.x, max(a.y, a.z));
  if (ma > 1.0) hist = center + dv / ma;

  float blend = mix(uBlend, 0.25, clamp(motion / 24.0, 0.0, 1.0));
  if (uvPrev.x < 0.0 || uvPrev.x > 1.0 || uvPrev.y < 0.0 || uvPrev.y > 1.0) blend = 1.0;
  vec3 res = mix(hist, cur, blend);
  gl_FragColor = vec4(tmOut(fromYCoCg(res)), 1.0);
}`;

const copyFrag = /* glsl */ `
uniform sampler2D tInput;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tInput, vUv); }`;

const base = { vertexShader: fsVert, depthTest: false, depthWrite: false };

export function makeCompositeMaterial() {
  return new THREE.ShaderMaterial({
    ...base,
    fragmentShader: compositeFrag,
    uniforms: {
      tScene: { value: null },
      tAO: { value: null },
      tFog: { value: null },
      tDepth: { value: null },
      uInvProj: { value: new THREE.Matrix4() },
      uHalfTexel: { value: new THREE.Vector2() },
      uAOStrength: { value: 0.9 },
      uFogStrength: { value: 1 },
    },
  });
}

export function makeTAAMaterial() {
  return new THREE.ShaderMaterial({
    ...base,
    fragmentShader: taaFrag,
    uniforms: {
      tCurrent: { value: null },
      tHistory: { value: null },
      tDepth: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uJitter: { value: new THREE.Vector2() },
      uTexel: { value: new THREE.Vector2() },
      uBlend: { value: 0.1 },
      uReset: { value: 1 },
    },
  });
}

export function makeCopyMaterial() {
  return new THREE.ShaderMaterial({
    ...base,
    fragmentShader: copyFrag,
    uniforms: { tInput: { value: null } },
  });
}
