import * as THREE from 'three';
import { VM_DEPTH } from '../engine/glsl.js';

export const FX_MAX_LIGHTS = 12;

const VM = VM_DEPTH.toFixed(3);

// 特效层画在 TAA 之后，目标上没有深度缓冲：遮挡和软粒子都靠采样主场景的深度纹理。
// 第一人称武器的深度被压在 [0, VM_DEPTH)，先还原再线性化。
export const depthGLSL = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
float sceneViewZ() {
  float d = texture2D(tDepth, gl_FragCoord.xy / uResolution).r;
  d = d < ${VM} ? d / ${VM} : d;
  return uNear * uFar / (uFar - d * (uFar - uNear));
}`;

// 粒子自己算光照：关卡聚光灯 + 两盏瞬时点光（枪口、爆炸）。
// fwd 是前向散射的强度，逆着灯看过去（光穿过粒子射向镜头）时更亮。
export const lightGLSL = /* glsl */ `
#define FX_MAX_L ${FX_MAX_LIGHTS}
uniform int uLCount;
uniform vec3 uLPos[FX_MAX_L];
uniform vec3 uLDir[FX_MAX_L];
uniform vec3 uLCol[FX_MAX_L];
uniform vec3 uLCone[FX_MAX_L]; // cosOuter, cosInner, range
uniform vec3 uPPos[2];
uniform vec3 uPCol[2];
uniform vec3 uAmbient;
vec3 fxLight(vec3 p, vec3 toCam, float fwd) {
  vec3 sum = vec3(0.0);
  for (int j = 0; j < FX_MAX_L; j++) {
    if (j >= uLCount) break;
    vec3 L = p - uLPos[j];
    float d2 = dot(L, L);
    float range = uLCone[j].z;
    vec3 Ln = L * inversesqrt(max(d2, 1e-6));
    float spot = smoothstep(uLCone[j].x, uLCone[j].y, dot(Ln, uLDir[j]));
    float win = clamp(1.0 - d2 / (range * range), 0.0, 1.0);
    float ph = 1.0 + fwd * pow(clamp(dot(Ln, toCam) * 0.5 + 0.5, 0.0, 1.0), 6.0);
    sum += uLCol[j] * (spot * win * win * ph / (d2 + 0.5));
  }
  for (int j = 0; j < 2; j++) {
    vec3 L = p - uPPos[j];
    sum += uPCol[j] / (dot(L, L) + 0.3);
  }
  return sum;
}`;

// 烟雾弹的烟团对加色特效的遮挡。加色的光（曳光、火花、枪口焰、雨）不和烟一起排序，
// 所以把每团烟当成视空间里的一个高斯团（中心 + 标准差），解析地算镜头到这一点穿过多厚的烟，压暗它。
// uCloudK 是正穿中心一整条视线的光学厚度；横向按离中心的距离衰减，
// 纵向只积镜头到这一点的那一段（正态分布函数用 logistic 近似），所以烟前面的东西不受影响。
export const MAX_CLOUDS = 4;
export const cloudGLSL = /* glsl */ `
uniform vec4 uClouds[${MAX_CLOUDS}];
uniform float uCloudK[${MAX_CLOUDS}];
float cloudT(vec3 p) {
  float len = length(p);
  vec3 d = p / max(len, 1e-4);
  float tau = 0.0;
  for (int i = 0; i < ${MAX_CLOUDS}; i++) {
    if (uCloudK[i] <= 0.0) continue;
    vec4 s = uClouds[i];
    float inv = 1.0 / s.w;
    float b = dot(s.xyz, d);
    float d2 = max(dot(s.xyz, s.xyz) - b * b, 0.0);
    float along = 1.0 / (1.0 + exp(-1.702 * (len - b) * inv)) - 1.0 / (1.0 + exp(1.702 * b * inv));
    tau += uCloudK[i] * exp(-0.5 * d2 * inv * inv) * along;
  }
  return exp(-tau);
}`;

// 视空间里把线段 t→h 展成面向镜头的条带。corner.x: 0 尾 1 头，corner.y: ±1。
// 半宽不足 minPx 个像素时撑到 minPx，k 返回该按比例压低的亮度；
// 配合片元里的三角形横向轮廓，一像素半宽正好是无锯齿的细线。
export const ribbonGLSL = /* glsl */ `
vec3 ribbon(vec3 t, vec3 h, vec2 corner, float halfW, float minPx, out float k, out float cap) {
  vec3 p = mix(t, h, corner.x);
  vec3 axis = h - t;
  float len = length(axis);
  vec3 dir = len > 1e-5 ? axis / len : vec3(0.0, 1.0, 0.0);
  vec3 side = cross(dir, normalize(p));
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float px = 2.0 * max(-p.z, 0.05) / (projectionMatrix[1][1] * uResolution.y);
  float w = max(halfW, minPx * px);
  k = halfW / w;
  cap = w / (len + 2.0 * w);
  return p + side * (corner.y * w) + dir * ((corner.x * 2.0 - 1.0) * w);
}`;

// 条带用的单位四边形：x 沿长度 0..1，y 横向 -1..1
export function ribbonGeometry() {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.instanceCount = 0;
  return geo;
}

// three 的 addUpdateRange 每次新建一个对象；每帧上传的缓冲复用同一个范围对象
export function uploadRange(attr, range, count) {
  range.start = 0;
  range.count = count;
  const list = attr.updateRanges;
  list.length = 0;
  list.push(range);
  attr.needsUpdate = true;
}

// 环形缓冲里零星改动的实例：把脏区间并进同一个范围对象
export function markDirty(attr, range, index, stride) {
  const start = index * stride;
  const list = attr.updateRanges;
  if (list.length === 0) {
    range.start = start;
    range.count = stride;
    list.push(range);
  } else {
    const lo = Math.min(range.start, start);
    const hi = Math.max(range.start + range.count, start + stride);
    range.start = lo;
    range.count = hi - lo;
  }
  attr.needsUpdate = true;
}

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

// 特效着色器共用的 uniform：管线的深度纹理 + 灯光表
export class LightRig {
  constructor(pipeline) {
    const vecs = (n) => Array.from({ length: n }, () => new THREE.Vector3());
    const vecs4 = (n) => Array.from({ length: n }, () => new THREE.Vector4());
    let fxu = pipeline?.fxUniforms;
    if (!fxu) {
      // 没有管线（简易预览）时深度当成无穷远
      const far = new THREE.DataTexture(new Float32Array([1]), 1, 1, THREE.RedFormat, THREE.FloatType);
      far.needsUpdate = true;
      fxu = { tDepth: { value: far }, uResolution: { value: new THREE.Vector2(1280, 720) }, uNear: { value: 0.03 }, uFar: { value: 600 } };
    }
    this.uniforms = {
      tDepth: fxu.tDepth,
      uResolution: fxu.uResolution,
      uNear: fxu.uNear,
      uFar: fxu.uFar,
      uLCount: { value: 0 },
      uLPos: { value: vecs(FX_MAX_LIGHTS) },
      uLDir: { value: vecs(FX_MAX_LIGHTS) },
      uLCol: { value: vecs(FX_MAX_LIGHTS) },
      uLCone: { value: vecs(FX_MAX_LIGHTS) },
      uPPos: { value: vecs(2) },
      uPCol: { value: vecs(2) },
      uAmbient: { value: new THREE.Vector3(0.035, 0.05, 0.085) },
      uClouds: { value: vecs4(MAX_CLOUDS) },
      uCloudK: { value: new Float32Array(MAX_CLOUDS) },
    };
    this.list = [];
    this.score = new Float32Array(0);
  }

  // list: [{ light: SpotLight }]，也接受直接传灯的数组
  setLights(list) {
    this.list = (list || []).map((e) => (e && e.isLight ? e : e?.light)).filter(Boolean);
  }

  update(camera, muzzle, blast) {
    const u = this.uniforms, list = this.list;
    if (this.score.length < list.length) this.score = new Float32Array(list.length + 8);
    const score = this.score;
    let lit = 0;
    if (camera) _t.setFromMatrixPosition(camera.matrixWorld); else _t.set(0, 0, 0);
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (l.intensity <= 0 || !l.visible) { score[i] = -1; continue; }
      l.getWorldPosition(_p);
      score[i] = l.intensity / (_p.distanceToSquared(_t) + 25);
      lit++;
    }
    let n = 0;
    const want = Math.min(lit, FX_MAX_LIGHTS);
    while (n < want) {
      // 灯比槽位多时，按对镜头附近的贡献从大到小取
      let best = -1, bs = 0;
      for (let i = 0; i < list.length; i++) if (score[i] > bs) { bs = score[i]; best = i; }
      if (best < 0) break;
      score[best] = -1;
      const l = list[best];
      l.getWorldPosition(_p);
      u.uLPos.value[n].copy(_p);
      l.target.getWorldPosition(_t);
      u.uLDir.value[n].copy(_t).sub(_p).normalize();
      const k = l.intensity;
      u.uLCol.value[n].set(l.color.r * k, l.color.g * k, l.color.b * k);
      const range = l.distance > 0 ? l.distance : 60;
      u.uLCone.value[n].set(Math.cos(l.angle), Math.cos(l.angle * (1 - l.penumbra)) + 1e-4, range);
      n++;
    }
    u.uLCount.value = n;
    this.point(0, muzzle);
    this.point(1, blast);
  }

  point(i, light) {
    const u = this.uniforms;
    if (!light) { u.uPCol.value[i].set(0, 0, 0); return; }
    u.uPPos.value[i].copy(light.position);
    const k = light.intensity;
    u.uPCol.value[i].set(light.color.r * k, light.color.g * k, light.color.b * k);
  }
}
