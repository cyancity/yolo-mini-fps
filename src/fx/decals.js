import * as THREE from 'three';
import { patchMaterial, inject } from '../gfx/materials.js';
import { markDirty } from './common.js';

const LIFT = 0.003;
export const CRACK = 4; // 玻璃裂纹：不在图集里，片元着色器里现算

// 玻璃上的弹孔：中心小洞、一圈压碎的白霜、放射裂纹，和几段把它们连起来的弦向裂纹
const crackGLSL = /* glsl */ `
float fxHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
vec4 fxGlassCrack(vec2 q, float seed) {
  const float K = 11.0;
  const float SECTOR = 6.2831853 / K;
  float r = length(q);
  float u = (atan(q.y, q.x) / 6.2831853 + 0.5) * K;
  float k = floor(u), f = fract(u);
  float h1 = fxHash(k + seed * 31.0), h2 = fxHash(k * 1.7 + seed * 57.0 + 3.1);
  // 线宽不小于一个像素，远看不闪
  float lw = 0.014 + fwidth(r);
  float len = 0.4 + 0.58 * h2;
  float bend = 0.035 * sin(r * 17.0 + h1 * 40.0);
  float radial = (1.0 - smoothstep(0.0, lw, abs(r * ((f - 0.5 - (h1 - 0.5) * 0.6) * SECTOR + bend)))) * step(r, len);
  float c = r * cos((f - 0.5) * SECTOR);
  float r1 = 0.24 + 0.2 * fxHash(k * 2.3 + seed * 13.0), r2 = r1 + 0.18 + 0.2 * fxHash(k * 3.1 + seed * 7.0);
  float chord = (1.0 - smoothstep(0.0, lw, abs(c - r1))) * step(0.35, h2) + (1.0 - smoothstep(0.0, lw, abs(c - r2))) * step(0.55, h1) * step(r2, len);
  float frost = 1.0 - smoothstep(0.06, 0.2, r);
  float hole = 1.0 - smoothstep(0.035, 0.055, r);
  float a = max(max(max(radial, min(chord, 1.0)) * 0.85, frost * 0.9), hole);
  return vec4(mix(vec3(0.8, 0.88, 0.92), vec3(0.02), hole), a * (1.0 - smoothstep(0.9, 1.0, r)));
}`;

// 弹孔、刀痕、焦痕、玻璃裂纹：一个 InstancedMesh 画完，图集格由实例属性选。
// 放在主场景里受光、接阴影；环形复用，满了顶掉最旧的。
// 分两个环：前 cap 个给玩家打出来的，后 capLow 个给敌人的流弹，敌人扫射时不会把玩家刚打的弹孔顶掉。
export class Decals {
  constructor(scene, mats, cap = 192, capLow = 128) {
    this.cap = cap;
    this.capLow = capLow;
    this.total = 0;
    this.totalLow = 0;
    this.dir = new THREE.Vector3(); // 最近一次贴花的本地 X 轴（世界方向），刀痕用它定火花去向
    const n = cap + capLow;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.cell = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); // 图集格 xy（x = 2 是裂纹）、金属度、不透明度（可大于 1，把淡的焦痕压实）
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); // 染色 rgb、弹坑法线强度（裂纹：随机种子）
    this.cell.setUsage(THREE.DynamicDrawUsage);
    this.tint.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCell', this.cell);
    geo.setAttribute('aTint', this.tint);

    // 双面：玻璃上的裂纹从屋里屋外都看得见（墙上的弹孔背面本来就被墙挡着）
    const mat = new THREE.MeshStandardMaterial({
      map: mats.tex.bullet, transparent: true, depthWrite: false, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    patchMaterial(mat, 'fxdecal', (shader) => {
      const pars = /* glsl */ `
        varying vec4 vFxCell;
        varying vec4 vFxTint;
        varying vec2 vFxUv;
        varying vec3 vFxT;
        varying vec3 vFxB;`;
      shader.vertexShader = inject(`attribute vec4 aCell;\nattribute vec4 aTint;\n${pars}\n${shader.vertexShader}`,
        '#include <uv_vertex>', /* glsl */ `
        vMapUv = (uv + min(aCell.xy, 1.0)) * 0.5;
        vFxUv = uv;
        vFxCell = aCell;
        vFxTint = aTint;
        vFxT = normalize((modelViewMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vFxB = normalize((modelViewMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`);
      let f = `${pars}\n${crackGLSL}\n${shader.fragmentShader}`;
      // 图集里木头那格的木刺顶到了格子边，统一按半径收边，拉长的刀痕两端也靠它收尖
      f = inject(f, '#include <map_fragment>', /* glsl */ `
        vec2 fxq = (vFxUv - 0.5) * 2.0;
        float fxr = length(fxq);
        float fxCrack = step(1.5, vFxCell.x);
        diffuseColor.rgb *= vFxTint.rgb;
        diffuseColor.a = min(diffuseColor.a * vFxCell.w, 1.0) * smoothstep(1.0, 0.72, fxr);
        if (fxCrack > 0.5) {
          vec4 fxc = fxGlassCrack(fxq, vFxTint.a);
          diffuseColor = vec4(fxc.rgb * vFxTint.rgb, fxc.a * min(vFxCell.w, 1.0));
        }`);
      // 弹孔外圈翻出来的亮金属；裂纹的断面比较光
      f = inject(f, '#include <metalnessmap_fragment>', /* glsl */ `
        float fxBare = vFxCell.z * smoothstep(0.25, 0.6, dot(sampledDiffuseColor.rgb, vec3(0.3333))) * (1.0 - fxCrack);
        metalnessFactor = fxBare;
        roughnessFactor = mix(mix(roughnessFactor, 0.34, fxBare), 0.3, fxCrack);`);
      // 假弹坑：法线朝中心倾斜，侧光下一边亮一边暗
      f = inject(f, '#include <normal_fragment_maps>', /* glsl */ `
        {
          float slope = smoothstep(0.02, 0.14, fxr) * smoothstep(0.5, 0.22, fxr) * vFxTint.a * (1.0 - fxCrack);
          vec3 radial = (vFxT * fxq.x + vFxB * fxq.y) / max(fxr, 1e-3);
          normal = normalize(normal - radial * slope);
        }`);
      shader.fragmentShader = f;
    });

    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 两个环之间没用到的槽位也在绘制范围里：矩阵清零，它们就是退化三角形。
    // 清零之后要整块上传一次（full），在那之前不能只传零星改动的区间
    mesh.instanceMatrix.array.fill(0);
    this.full = true;
    mesh.instanceMatrix.onUpload(() => { this.full = false; });
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    scene.add(mesh);
    this.mesh = mesh;
    this.ranges = [{ start: 0, count: 0 }, { start: 0, count: 0 }, { start: 0, count: 0 }];
  }

  // cell: 0 金属 1 混凝土 2 木头 3 焦痕 4 玻璃裂纹（crater 传随机种子）。roll 在墙面上从水平方向量起。
  // low：记进敌人流弹那个环
  add(px, py, pz, nx, ny, nz, cell, sx, sy, roll, r, g, b, metal, opacity, crater, low = false) {
    const i = low ? this.cap + (this.totalLow++ % this.capLow) : this.total++ % this.cap;
    // 切线：墙面取水平方向（up × n），接近水平的面取世界 X 在面内的投影
    let tx, ty, tz;
    if (Math.abs(ny) < 0.9) { tx = nz; ty = 0; tz = -nx; }
    else { tx = 1 - nx * nx; ty = -nx * ny; tz = -nx * nz; }
    const tl = 1 / Math.hypot(tx, ty, tz);
    tx *= tl; ty *= tl; tz *= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const c = Math.cos(roll), s = Math.sin(roll);
    const e = this.mesh.instanceMatrix.array, o = i * 16;
    this.dir.set(tx * c + bx * s, ty * c + by * s, tz * c + bz * s);
    e[o] = this.dir.x * sx; e[o + 1] = this.dir.y * sx; e[o + 2] = this.dir.z * sx; e[o + 3] = 0;
    e[o + 4] = (bx * c - tx * s) * sy; e[o + 5] = (by * c - ty * s) * sy; e[o + 6] = (bz * c - tz * s) * sy; e[o + 7] = 0;
    e[o + 8] = nx; e[o + 9] = ny; e[o + 10] = nz; e[o + 11] = 0;
    e[o + 12] = px + nx * LIFT; e[o + 13] = py + ny * LIFT; e[o + 14] = pz + nz * LIFT; e[o + 15] = 1;
    const ca = this.cell.array, ta = this.tint.array, q = i * 4;
    ca[q] = cell === CRACK ? 2 : cell & 1; ca[q + 1] = cell === CRACK ? 0 : cell >> 1; ca[q + 2] = metal; ca[q + 3] = opacity;
    ta[q] = r; ta[q + 1] = g; ta[q + 2] = b; ta[q + 3] = crater;
    if (this.full) this.mesh.instanceMatrix.needsUpdate = true;
    else markDirty(this.mesh.instanceMatrix, this.ranges[0], i, 16);
    markDirty(this.cell, this.ranges[1], i, 4);
    markDirty(this.tint, this.ranges[2], i, 4);
    this.mesh.count = this.totalLow > 0 ? this.cap + Math.min(this.totalLow, this.capLow) : Math.min(this.total, this.cap);
  }

  clear() {
    this.total = 0;
    this.totalLow = 0;
    this.mesh.count = 0;
    const m = this.mesh.instanceMatrix;
    m.array.fill(0);
    m.clearUpdateRanges();
    m.needsUpdate = true;
    this.full = true;
  }
}
