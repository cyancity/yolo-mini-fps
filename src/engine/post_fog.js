import * as THREE from 'three';
import { fsVert, depthLib } from './glsl.js';

export const FOG_MAX_LIGHTS = 12;
export const FOG_SHADOWED = 4;
// 体积雾一步至少走多长（米）：近处的视线按它少走几步，见着色器里的 uStepLen
export const FOG_STEP_LEN = 1;

// 半分辨率体积光：沿视线步进，累加各聚光灯的单次散射。前 FOG_SHADOWED 盏灯读取
// three 的阴影贴图，于是集装箱和无人机会在雾里切出光柱。输出 rgb = 内散射，a = 线性深度。
// 白天和下午再加一项阳光（uSunOn）：读平行光的阴影贴图，薄雾里就有被箱子切开的光束；夜里这一项整个跳过。
const fogFrag = /* glsl */ `
${depthLib}
#define MAX_L ${FOG_MAX_LIGHTS}
#define STEPS 22
#define MIN_STEPS 8
uniform float uStepLen;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uFrame;
uniform float uDensity;
uniform float uMaxDist;
uniform float uTime;
uniform int uLCount;
uniform vec3 uLPos[MAX_L];
uniform vec3 uLDir[MAX_L];
uniform vec3 uLCol[MAX_L];
uniform vec3 uLCone[MAX_L]; // cosOuter, cosInner, range
uniform float uLShadow[MAX_L];
uniform mat4 uShadowMat[${FOG_SHADOWED}];
uniform highp sampler2DShadow tShadow0;
uniform highp sampler2DShadow tShadow1;
uniform highp sampler2DShadow tShadow2;
uniform highp sampler2DShadow tShadow3;
uniform float uSunOn;
uniform vec3 uSunDir;   // 指向太阳
uniform vec3 uSunCol;   // 阳光在雾里的散射强度（颜色 × 强度 × 系数）
uniform mat4 uSunShadowMat;
uniform highp sampler2DShadow tShadowSun;
varying vec2 vUv;

float sunShadowAt(vec3 p) {
  vec4 sc = uSunShadowMat * vec4(p, 1.0);
  sc.xyz /= sc.w;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  return textureLod(tShadowSun, vec3(sc.xy, sc.z - 0.0012), 0.0);
}

float shadowAt(int j, vec3 p) {
  vec4 sc = uShadowMat[j] * vec4(p, 1.0);
  sc.xyz /= sc.w;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
  vec3 c = vec3(sc.xy, sc.z - 0.0006);
  if (j == 0) return textureLod(tShadow0, c, 0.0);
  if (j == 1) return textureLod(tShadow1, c, 0.0);
  if (j == 2) return textureLod(tShadow2, c, 0.0);
  return textureLod(tShadow3, c, 0.0);
}

// 三维值噪声的 hash，Inigo Quilez，MIT，见 THIRD_PARTY_NOTICES.md
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
                 mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
                 mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void main() {
  float d = min(fetchDepth(vUv), 0.999995);
  vec3 Pv = viewPos(vUv, d);
  float viewDist = length(Pv);
  vec3 dirW = normalize((uCamWorld * vec4(Pv / viewDist, 0.0)).xyz);
  float maxDist = min(viewDist, uMaxDist);
  // 步数跟着这条视线在雾里走多长：每步不短于 uStepLen 米，最少 MIN_STEPS 步、最多 STEPS 步（uStepLen = 0 时固定 STEPS 步）。
  // 原来近处的墙和地面也走满 STEPS 步，一步只有十几厘米，比远处密了好几倍
  float n = uStepLen > 0.0 ? clamp(ceil(maxDist / uStepLen), float(MIN_STEPS), float(STEPS)) : float(STEPS);
  float stepLen = maxDist / n;
  float jitter = ign(gl_FragCoord.xy + uFrame * 5.588238);
  // 阳光的相位只跟视线方向有关，循环外算一次（和聚光灯同一条 Henyey-Greenstein）
  vec3 sunIn = uSunCol * (0.0555 / pow(1.3025 - 1.1 * dot(dirW, uSunDir), 1.5));
  vec3 acc = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    if (float(i) >= n) break;
    float t = (float(i) + jitter) * stepLen;
    vec3 p = uCamPos + dirW * t;
    float wisps = 0.55 + 0.9 * noise3(p * 0.33 + vec3(uTime * 0.22, -uTime * 0.05, uTime * 0.13));
    float dens = uDensity * wisps * exp(-max(p.y, 0.0) * 0.045);
    vec3 sum = vec3(0.0);
    if (uSunOn > 0.5) sum = sunIn * sunShadowAt(p);
    for (int j = 0; j < MAX_L; j++) {
      if (j >= uLCount) break;
      vec3 L = p - uLPos[j];
      float dist2 = dot(L, L);
      float range = uLCone[j].z;
      if (dist2 > range * range) continue;
      float dist = sqrt(dist2);
      vec3 Ln = L / max(dist, 1e-4);
      float spot = smoothstep(uLCone[j].x, uLCone[j].y, dot(Ln, uLDir[j]));
      if (spot <= 0.0) continue;
      float win = 1.0 - dist2 / (range * range);
      float att = spot * win * win / (dist2 + 0.35);
      if (uLShadow[j] > 0.5 && j < ${FOG_SHADOWED}) att *= shadowAt(j, p);
      // Henyey-Greenstein，g = 0.55：逆光看灯时更亮
      float ct = dot(Ln, -dirW);
      float phase = 0.0555 / pow(1.3025 - 1.1 * ct, 1.5);
      sum += uLCol[j] * att * phase;
    }
    acc += sum * dens * stepLen;
  }
  gl_FragColor = vec4(acc, -Pv.z);
}`;

export function makeFogMaterial() {
  const arr = (n, f) => Array.from({ length: n }, f);
  return new THREE.ShaderMaterial({
    vertexShader: fsVert,
    fragmentShader: fogFrag,
    uniforms: {
      tDepth: { value: null },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uFrame: { value: 0 },
      uTime: { value: 0 },
      uDensity: { value: 0.012 },
      uMaxDist: { value: 80 },
      uStepLen: { value: FOG_STEP_LEN },
      uLCount: { value: 0 },
      uLPos: { value: arr(FOG_MAX_LIGHTS, () => new THREE.Vector3()) },
      uLDir: { value: arr(FOG_MAX_LIGHTS, () => new THREE.Vector3(0, -1, 0)) },
      uLCol: { value: arr(FOG_MAX_LIGHTS, () => new THREE.Vector3()) },
      uLCone: { value: arr(FOG_MAX_LIGHTS, () => new THREE.Vector3(0, 1, 1)) },
      uLShadow: { value: new Array(FOG_MAX_LIGHTS).fill(0) },
      uShadowMat: { value: arr(FOG_SHADOWED, () => new THREE.Matrix4()) },
      tShadow0: { value: null },
      tShadow1: { value: null },
      tShadow2: { value: null },
      tShadow3: { value: null },
      uSunOn: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Vector3() },
      uSunShadowMat: { value: new THREE.Matrix4() },
      tShadowSun: { value: null },
    },
    depthTest: false,
    depthWrite: false,
  });
}

// 时段用：让雾里出阳光。light 是那盏带阴影的平行光，strength 是散射系数（0 = 关，夜里就是 0）；
// cutoff 以下的聚光灯不进雾（白天室外的灯调到很暗，光柱看不见，不值得占槽位）
export function setFogSun(material, light, strength = 0, cutoff = 1e-3) {
  material.userData.sun = strength > 0 ? { light, strength } : null;
  material.userData.cutoff = cutoff;
}

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _c = new THREE.Vector3();
const order = [];
const byRank = (a, b) => a.rank - b.rank;

// lights: [{ light: SpotLight, strength }]。灯比槽位多：带阴影的先占阴影槽，其余按离相机远近取，
// 取满 FOG_MAX_LIGHTS 盏为止；亮度为 0 的（待命的无人机灯）不占位。
// 亮度按 强度 × 颜色 算：时段是在颜色上调暗人造灯的
export function updateFogLights(material, lights, camera) {
  const u = material.uniforms;
  const cutoff = material.userData.cutoff ?? 1e-3;
  const sun = material.userData.sun, sunMap = sun ? sun.light.shadow.map : null;
  if (sunMap) {
    const l = sun.light, k = l.intensity * sun.strength;
    u.uSunOn.value = 1;
    u.uSunDir.value.copy(l.position).sub(l.target.position).normalize();
    u.uSunCol.value.set(l.color.r * k, l.color.g * k, l.color.b * k);
    u.uSunShadowMat.value.copy(l.shadow.matrix);
    u.tShadowSun.value = sunMap.depthTexture;
  } else {
    u.uSunOn.value = 0;
  }
  _c.setFromMatrixPosition(camera.matrixWorld);
  order.length = 0;
  let shadowed = 0;
  for (const entry of lights) {
    const { light, strength = 1 } = entry;
    const c = light.color;
    if (light.intensity * strength * Math.max(c.r, c.g, c.b) <= cutoff) continue;
    if (light.castShadow && light.shadow.map && shadowed < FOG_SHADOWED) entry.rank = -1e9 + shadowed++;
    else {
      const d = light.getWorldPosition(_p).distanceTo(_c);
      // 相机在灯的照射范围内的排前面
      entry.rank = Math.max(0, d - (light.distance || 60)) * 1000 + d;
    }
    order.push(entry);
  }
  order.sort(byRank);
  let n = 0;
  let shadowSlot = 0;
  for (const entry of order) {
    if (n >= FOG_MAX_LIGHTS) break;
    const { light, strength = 1 } = entry;
    light.getWorldPosition(_p);
    light.target.getWorldPosition(_t);
    u.uLPos.value[n].copy(_p);
    u.uLDir.value[n].copy(_t).sub(_p).normalize();
    const k = light.intensity * strength;
    u.uLCol.value[n].set(light.color.r * k, light.color.g * k, light.color.b * k);
    const range = light.distance > 0 ? light.distance : 60;
    u.uLCone.value[n].set(Math.cos(light.angle), Math.cos(light.angle * (1 - light.penumbra)) + 1e-4, range);
    const map = light.castShadow && light.shadow.map ? light.shadow.map.depthTexture : null;
    if (map && shadowSlot < FOG_SHADOWED && n === shadowSlot) {
      u.uLShadow.value[n] = 1;
      u.uShadowMat.value[shadowSlot].copy(light.shadow.matrix);
      u['tShadow' + shadowSlot].value = map;
      shadowSlot++;
    } else {
      u.uLShadow.value[n] = 0;
    }
    n++;
  }
  u.uLCount.value = n;
}
