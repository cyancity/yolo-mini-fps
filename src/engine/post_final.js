import * as THREE from 'three';
import { fsVert, VM_DEPTH } from './glsl.js';

const base = { vertexShader: fsVert, depthTest: false, depthWrite: false };

// 13 点降采样；第一级用 Karis 平均压住高亮闪点
const downFrag = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uKaris;
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 s(float x, float y) { return texture2D(tInput, vUv + vec2(x, y) * uTexel).rgb; }
void main() {
  vec3 a = s(-2.0, 2.0), b = s(0.0, 2.0), c = s(2.0, 2.0);
  vec3 d = s(-2.0, 0.0), e = s(0.0, 0.0), f = s(2.0, 0.0);
  vec3 g = s(-2.0, -2.0), h = s(0.0, -2.0), i = s(2.0, -2.0);
  vec3 j = s(-1.0, 1.0), k = s(1.0, 1.0), l = s(-1.0, -1.0), m = s(1.0, -1.0);
  vec3 col;
  if (uKaris > 0.5) {
    vec3 g0 = (j + k + l + m) * 0.25;
    vec3 g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25;
    vec3 g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
    float w0 = 0.5 / (1.0 + luma(g0));
    float w1 = 0.125 / (1.0 + luma(g1)), w2 = 0.125 / (1.0 + luma(g2));
    float w3 = 0.125 / (1.0 + luma(g3)), w4 = 0.125 / (1.0 + luma(g4));
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

const upFrag = /* glsl */ `
uniform sampler2D tInput;
uniform sampler2D tBase;
uniform vec2 uTexel;
uniform float uMix;
varying vec2 vUv;
vec3 s(float x, float y) { return texture2D(tInput, vUv + vec2(x, y) * uTexel).rgb; }
void main() {
  vec3 up = (s(-1.0, 1.0) + s(1.0, 1.0) + s(-1.0, -1.0) + s(1.0, -1.0)) * 0.0625
          + (s(0.0, 1.0) + s(0.0, -1.0) + s(-1.0, 0.0) + s(1.0, 0.0)) * 0.125
          + s(0.0, 0.0) * 0.25;
  gl_FragColor = vec4(mix(texture2D(tBase, vUv).rgb, up, uMix), 1.0);
}`;

// 输出阶段：色差、锐化、泛光、AgX 色调映射、分离色调、暗角、颗粒和抖动
const finalFrag = /* glsl */ `
#define VM_DEPTH ${VM_DEPTH.toFixed(3)}
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tDirt;
uniform sampler2D tDepth;  // 主场景的原始深度，只在喷气时读，用来认出第一人称武器
uniform vec2 uTexel;
uniform float uAspect;
uniform float uTime;
uniform float uExposure;
uniform float uBloom;
uniform float uDirt;
uniform float uCA;
uniform float uSharpen;
uniform float uVignette;
uniform float uGrain;
uniform float uDamage;
uniform float uDesat;
uniform float uFade;
uniform float uAds;
uniform float uDash;    // 喷气的程度 0..1
uniform vec2 uDashDir;  // 喷气相对视线的方向：x 向右，y 向前
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// Hash without Sine，Dave Hoskins，MIT，见 THIRD_PARTY_NOTICES.md
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// 1 = 世界，0 = 第一人称武器（深度压在 VM_DEPTH 以内）
float onWorld(vec2 uv) { return step(VM_DEPTH, texture2D(tDepth, uv).r); }

// AgX 的精简实现（Minimal AgX），Benjamin Wrensch，MIT；AgX 出自 Troy Sobotka。见 THIRD_PARTY_NOTICES.md
vec3 agxCurve(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c) {
  const mat3 inMat = mat3(
    0.842479062253094, 0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772, 0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outMat = mat3(
    1.19687900512017, -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
    -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float minEv = -12.47393, maxEv = 4.026069;
  c = inMat * max(c, 1e-10);
  c = clamp(log2(c), minEv, maxEv);
  c = agxCurve((c - minEv) / (maxEv - minEv));
  // 偏电影感的 look：提对比和饱和
  float l = luma(c);
  c = pow(max(c, 0.0), vec3(1.22));
  c = l + 1.28 * (c - l);
  return clamp(outMat * c, 0.0, 1.0);
}

void main() {
  vec2 cc = vUv - 0.5;
  float r2 = dot(cc, cc);
  // 喷气的模糊、速度线和加强的色差只给世界，武器像素 dash 为 0；uDash 为 0 时不读深度
  float dash = 0.0;
  if (uDash > 0.004) dash = uDash * onWorld(vUv);
  // 色差只留在画面边角（镜头边缘才分色）：中间一大块完全不偏，波纹板这类细密的竖条不会变成彩虹条纹
  float caK = uCA * smoothstep(0.12, 0.4, r2);
  vec2 ca = cc * r2 * caK, cr = ca, cb = -ca;
  if (dash > 0.0) {
    vec2 cd = cc * r2 * (caK + dash * 0.05);
    // 加强后的采样点落在武器上就退回原值，否则枪的颜色会在背景上拖出彩边
    if (onWorld(vUv + cd) > 0.5) cr = cd;
    if (onWorld(vUv - cd) > 0.5) cb = -cd;
  }
  vec3 c0 = texture2D(tColor, vUv).rgb;
  vec3 col = vec3(texture2D(tColor, vUv + cr).r, c0.g, texture2D(tColor, vUv + cb).b);

  // 喷气：顺着画面的光流拉一段模糊，中间留清楚。往前喷光流是径向的，往侧面喷是水平的
  vec2 q = cc * vec2(uAspect, 1.0);
  float sharp = uSharpen;
  if (dash > 0.0) {
    float edge = smoothstep(0.06, 0.55, length(q));
    vec2 bv = (uDashDir.y * cc - vec2(uDashDir.x * 0.35, 0.0)) * (0.12 * dash * edge);
    float jit = hash(gl_FragCoord.xy + fract(uTime) * 61.0);
    // 落在武器上的采样跳过、按实际采样数归一，枪的颜色不会抹进背景
    vec3 acc = col;
    float n = 1.0;
    for (int i = 1; i < 8; i++) {
      vec2 uv = vUv + bv * ((float(i) + jit) / 8.0 - 0.5);
      float w = onWorld(uv);
      acc += texture2D(tColor, uv).rgb * w;
      n += w;
    }
    col = acc / n;
    sharp *= 1.0 - edge * min(1.0, dash * 2.0);
  }

  // 在压缩域里做反锐化，高光边缘不会出硬晕
  vec3 nb = (texture2D(tColor, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tColor, vUv - vec2(uTexel.x, 0.0)).rgb
           + texture2D(tColor, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tColor, vUv - vec2(0.0, uTexel.y)).rgb) * 0.25;
  // 锐化量用没有色差偏移的中心和邻点算：拿带色差的 col 去减，彩边会被再放大一次
  vec3 ct = col / (1.0 + luma(col)), c0t = c0 / (1.0 + luma(c0)), bt = nb / (1.0 + luma(nb));
  ct = max(ct + (c0t - bt) * sharp, 0.0);
  col = ct / max(1.0 - luma(ct), 1e-3);

  vec3 bloom = texture2D(tBloom, vUv).rgb;
  col = mix(col, bloom, uBloom);
  col += bloom * texture2D(tDirt, vUv).rgb * uDirt;

  col = agx(col * uExposure);

  // 分离色调：暗部偏青，亮部偏暖
  float l = luma(col);
  col += vec3(-0.012, 0.004, 0.016) * (1.0 - smoothstep(0.0, 0.5, l));
  col += vec3(0.018, 0.006, -0.014) * smoothstep(0.45, 1.0, l);
  col = mix(col, vec3(luma(col)), uDesat);

  // 喷气的速度线：顺着光流的细亮线，只在外圈闪。往前喷从发散点放射，纯侧向是一排横线
  if (dash > 0.0) {
    float coord, along;
    if (abs(uDashDir.y) > 0.05) {
      vec2 d = q - vec2(uDashDir.x / uDashDir.y * 0.6, 0.0);
      coord = atan(d.y, d.x) * 60.0;
      along = length(d);
    } else {
      coord = q.y * 110.0;
      along = 0.3 + abs(q.x);
    }
    float id = floor(coord), tick = floor(uTime * 28.0);
    float h = hash(vec2(id, tick)), h2 = hash(vec2(id + 17.0, tick));
    float core = 1.0 - smoothstep(0.1, 0.5, abs(fract(coord) - 0.5));
    float len = smoothstep(0.22 + 0.5 * h2, 0.42 + 0.5 * h2, along);
    float ring = smoothstep(0.2, 0.62, length(q));
    col += vec3(0.72, 0.86, 1.0) * (step(0.86, h) * core * len * ring * dash * 0.15);
  }

  vec2 vc = cc * vec2(1.0, 1.0 / max(uAspect, 1.0) * 1.35);
  float vig = smoothstep(0.28, 0.95, length(vc) * 1.25);
  col *= 1.0 - vig * (uVignette + uAds * 0.35 + uDash * 0.3);
  col = mix(col, vec3(0.55, 0.02, 0.0) * (0.4 + l), clamp(uDamage * smoothstep(0.15, 0.75, length(cc) * 1.3), 0.0, 0.85));

  float g = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 913.0) - 0.5;
  col += g * uGrain * (1.0 - 0.6 * l);
  col += (hash(gl_FragCoord.xy * 1.7 + 11.0) + hash(gl_FragCoord.xy * 0.9 + 37.0) - 1.0) / 255.0;
  gl_FragColor = vec4(max(col, 0.0) * uFade, 1.0);
}`;

export function makeBloomDownMaterial() {
  return new THREE.ShaderMaterial({
    ...base,
    fragmentShader: downFrag,
    uniforms: { tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } },
  });
}

export function makeBloomUpMaterial() {
  return new THREE.ShaderMaterial({
    ...base,
    fragmentShader: upFrag,
    uniforms: {
      tInput: { value: null },
      tBase: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uMix: { value: 0.7 },
    },
  });
}

export function makeFinalMaterial() {
  return new THREE.ShaderMaterial({
    ...base,
    fragmentShader: finalFrag,
    uniforms: {
      tColor: { value: null },
      tBloom: { value: null },
      tDirt: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uAspect: { value: 1 },
      uTime: { value: 0 },
      uExposure: { value: 1 },
      uBloom: { value: 0.06 },
      uDirt: { value: 0 },
      uCA: { value: 0.0035 },
      uSharpen: { value: 0.35 },
      uVignette: { value: 0.32 },
      uGrain: { value: 0.035 },
      uDamage: { value: 0 },
      uDesat: { value: 0 },
      uFade: { value: 1 },
      uAds: { value: 0 },
      uDash: { value: 0 },
      uDashDir: { value: new THREE.Vector2(0, 1) },
    },
  });
}
