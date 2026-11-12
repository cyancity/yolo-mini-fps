import * as THREE from 'three';
import { patchMaterial, inject } from '../gfx/materials.js';

// 每块靶子记住最近几处掉漆（环形覆盖最旧的）
export const CHIPS = 8;
// 漆色：固定靶荧光黄绿、移动靶荧光粉、起倒靶白。夜里在 50 m 外也要一眼认出来；
// 场里红箱、橙箱多，所以不用橙色
export const PAINT = { static: 0, mover: 1, popup: 2 };
const COLORS = [0xc8f230, 0xff3d96, 0xf0efe6];
// 荧光漆的“自发光”：夜里补一点亮度，白天被阳光盖过去
export const glow = { value: 0.22 };

// 每块靶子一行：第 0 格是状态（命中闪光、漆色），后面 CHIPS 格是掉漆点（局部 x、y、大小、随机种子）
export function createTargetData(count) {
  const W = CHIPS + 1;
  const data = new Float32Array(W * count * 4);
  const tex = new THREE.DataTexture(data, W, count, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, data, W };
}

const PARS = /* glsl */ `
uniform sampler2D uTData;
uniform vec3 uTCol[3];
uniform float uTGlow;
varying vec4 vTA;
varying vec2 vTB;
// 线宽不足一个像素时按比例淡掉，远处不闪
float tLine(float d, float w) {
  float fw = max(fwidth(d), 1e-5);
  return (1.0 - smoothstep(w * 0.5 - fw * 0.5, w * 0.5 + fw * 0.5, abs(d))) * clamp(w / (fw * 1.5), 0.0, 1.0);
}
float tDot(float d, float r) {
  float fw = max(fwidth(d), 1e-5);
  return (1.0 - smoothstep(r - fw * 0.5, r + fw * 0.5, d)) * clamp(r / (fw * 1.5), 0.0, 1.0);
}
float tRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}`;

const MAP = /* glsl */ `
  vec4 tw = texture2D(map, vMapUv);
  int tId = int(vTB.x + 0.5);
  vec4 tInfo = texelFetch(uTData, ivec2(0, tId), 0);
  float tPaint = vTA.w;
  vec2 tp = vTA.xy;
  // 支架：刷了深灰底漆的钢，边角有点锈
  vec3 tSteel = vec3(0.03, 0.033, 0.037) * (0.7 + 0.6 * tw.b);
  tSteel = mix(tSteel, vec3(0.06, 0.032, 0.018), smoothstep(0.86, 0.95, tw.r) * 0.45);
  vec3 tPc = uTCol[int(tInfo.y + 0.5)] * (0.9 + 0.2 * tw.b);
  tPc = mix(tPc, tPc * vec3(0.5, 0.47, 0.4), clamp((tw.g - 0.5) * 1.4, 0.0, 0.45));
  // 计分环：躯干上一圈圆角框、胸口一个小圈加中心点，头板上一个小圈加中心点。只画在正面
  vec2 tc = tp - vec2(0.0, 1.2), th = tp - vec2(0.0, 1.632);
  float tInk = tLine(tRound(tc, vec2(0.09, 0.13), 0.045), 0.009);
  tInk = max(tInk, tLine(length(tc) - 0.034, 0.007));
  tInk = max(tInk, tDot(length(tc), 0.008));
  tInk = max(tInk, tLine(length(th) - 0.046, 0.007));
  tInk = max(tInk, tDot(length(th), 0.007));
  tInk *= step(0.5, vTB.y) * tPaint;
  // 掉漆：中间一块露出亮钢，边上一圈压扁的铅，再往外是细的放射状铅灰溅痕
  float tChip = 0.0, tSmear = 0.0;
  for (int j = 1; j <= CHIPS; j++) {
    vec4 c = texelFetch(uTData, ivec2(j, tId), 0);
    if (c.z <= 0.0) continue;
    vec2 q = tp - c.xy;
    float r = length(q) / c.z;
    if (r > 2.4) continue;
    float a = atan(q.y, q.x);
    float rr = r / (0.8 + 0.2 * sin(a * 5.0 + c.w * 6.2832) * sin(a * 3.0 - c.w * 11.0));
    tChip = max(tChip, 1.0 - smoothstep(0.5, 0.6, rr));
    float rim = 1.0 - smoothstep(0.62, 0.9, rr);
    float halo = (1.0 - smoothstep(0.6, 1.4, rr)) * 0.5;
    float spray = pow(abs(sin(a * 11.0 + c.w * 23.0) * sin(a * 4.0 - c.w * 9.0)), 4.0) * (1.0 - smoothstep(0.7, 2.3, rr)) * 0.9;
    tSmear = max(tSmear, max(rim, halo + spray));
  }
  tChip *= tPaint;
  tSmear *= tPaint;
  vec3 tCol = mix(tSteel, tPc, tPaint);
  tCol = mix(tCol, vec3(0.018), tInk);
  tCol = mix(tCol, vec3(0.075, 0.078, 0.085), clamp(tSmear, 0.0, 1.0));
  // 露出来的钢面金属度压低一点：夜里环境暗，纯金属会发黑，读不出是刚打掉漆的亮面
  tCol = mix(tCol, vec3(0.5, 0.51, 0.53) * (0.85 + 0.3 * tw.b), tChip);
  diffuseColor.rgb *= tCol;
  float tRough = mix(mix(0.5, 0.68, tw.b), 0.58, tPaint);
  tRough = mix(tRough, 0.4, tChip);
  float tMetal = mix(0.3, 0.0, tPaint);
  tMetal = mix(tMetal, 0.35, tChip);
  vec3 tEmit = tPc * tPaint * (1.0 - max(tChip, clamp(tSmear, 0.0, 1.0))) * (1.0 - tInk) * uTGlow
    + vec3(1.0, 0.82, 0.55) * tInfo.x * tPaint * 0.9;`;

// 靶子共用一个材质：漆面、计分环、掉漆都在着色器里按局部坐标画，靶板倒下、摇晃时跟着走
export function targetMaterial(mats, dataTex) {
  const t = mats.tex;
  const m = new THREE.MeshStandardMaterial({ map: t.wearMask, normalMap: t.wearNormal, color: 0xffffff, roughness: 0.55, metalness: 0 });
  m.normalScale.set(0.45, 0.45);
  const colors = COLORS.map((c) => new THREE.Color(c));
  patchMaterial(m, 'targets', (shader) => {
    shader.uniforms.uTData = { value: dataTex };
    shader.uniforms.uTCol = { value: colors };
    shader.uniforms.uTGlow = glow;
    shader.vertexShader = inject(`attribute float aPaint;\nvarying vec4 vTA;\nvarying vec2 vTB;\n${shader.vertexShader}`, '#include <begin_vertex>', /* glsl */ `
      vTA = vec4(position, aPaint);
      #ifdef USE_INSTANCING
        vTB = vec2(float(gl_InstanceID), normal.z);
      #else
        vTB = vec2(0.0, normal.z);
      #endif`);
    let f = `#define CHIPS ${CHIPS}\n${PARS}\n${shader.fragmentShader}`;
    f = inject(f, '#include <map_fragment>', MAP, 'replace');
    f = inject(f, '#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;', 'replace');
    f = inject(f, '#include <metalnessmap_fragment>', 'float metalnessFactor = tMetal;', 'replace');
    f = inject(f, '#include <emissivemap_fragment>', 'totalEmissiveRadiance += tEmit;');
    shader.fragmentShader = f;
  });
  return m;
}
