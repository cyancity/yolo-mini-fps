import * as THREE from 'three';
import { xf, box } from '../../gfx/geo.js';
import { wallX, wallZ } from '../build.js';
import { decalQuad, distress, mulberry32 } from '../labels.js';
import { ZONE, Y, WALL } from '../plan.js';

// 仓库分区各模块共用的尺寸、材质和小工具。坐标全部来自 plan.js。
const W = ZONE.warehouse;
export const HALL = { x0: W.x0, x1: W.bayX, y: Y.dock }; // 库区：月台标高
export const BAY = { x0: W.bayX, x1: W.x1, y: 0.04 }; // 车辆区：薄混凝土面层盖住湿沥青
export const ZN = W.z0, ZS = W.z1, ZC = (W.z0 + W.z1) / 2; // 北墙内皮、南墙内皮、中线
export const CEIL = W.ceil;
// 屋架：沿 x 每 6 米一榀，跨南北两墙；下弦底 7.85，上弦顶 8.67，檩条顶到 8.8 顶住屋面板
export const TRUSS_X = [-27, -21, -15, -9, -3, 3, 9, 15, 21, 27];
export const TRUSS = { y0: 7.85, y1: 8.67 };
export const DADO = 3.4; // 内墙下段是混凝土护墙板，叉车撞得起
export const floorY = (x) => (x < W.bayX ? HALL.y : BAY.y);

export const C = { tile: 3 }, P = { tile: 5.2 }, G = { tile: 1.2 }, WD = { tile: 0.9 };

// 自己的随机数：不动关卡共用的 rand，别的分区的随机序列才不会跟着这里变
export const rng = (seed) => mulberry32(seed);

// 只出几何体不登记碰撞的 ctx（墙里的装饰、够不着的高处）
const NOPHYS = { addBox: () => ({}), addCyl: () => ({}), solid: () => ({}) };
export const visual = (ctx) => ({ ...ctx, phys: NOPHYS });

// 纸箱码垛的贴图，幅面 1.2 m：3 × 4 个箱子错缝码放，带封箱带、面单和印刷色块
const CARTON = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  vec2 g = uv * vec2(3.0, 4.0);
  g.x += 0.5 * mod(floor(g.y), 2.0);
  vec2 id = mod(floor(g), vec2(3.0, 4.0)), f = fract(g);
  float r = h21(id + 7.0);
  float e = min(min(f.x, 1.0 - f.x) * 0.4, min(f.y, 1.0 - f.y) * 0.3);
  float seam = smoothstep(0.006, 0.002, e);
  float bevel = smoothstep(0.03, 0.0, e);
  gSalt = 1.0; float flute = fbm2(uv, vec2(260.0, 3.0), 2);
  gSalt = 2.0; float blot = fbm(uv, 9.0, 4);
  gSalt = 3.0; float fine = fbm(uv, 140.0, 2);
  vec3 col = mix(vec3(0.40, 0.27, 0.15), vec3(0.55, 0.40, 0.24), r);
  col *= 0.84 + 0.22 * blot + 0.08 * (flute - 0.5) + 0.05 * (fine - 0.5);
  float tape = step(abs(f.x - 0.5), 0.07) * step(0.6, f.y) * step(0.3, r);
  vec2 lp = f - vec2(0.28, 0.34);
  float label = step(0.55, h21(id + 11.0)) * step(abs(lp.x), 0.16) * step(abs(lp.y), 0.13);
  float bars = label * step(lp.y, -0.02) * step(-0.1, lp.y) * step(0.45, h21(vec2(floor((lp.x + 0.2) * 70.0), 3.0)));
  float lines = label * step(0.02, lp.y) * step(0.5, fract(lp.y * 22.0)) * step(lp.x, 0.08);
  float ink = step(0.72, r) * step(abs(f.y - 0.8), 0.045) * step(abs(f.x - 0.5), 0.28);
  col = mix(col, vec3(0.5, 0.42, 0.28), tape * 0.85);
  col = mix(col, vec3(0.13, 0.11, 0.09), ink * 0.85);
  col = mix(col, vec3(0.8, 0.8, 0.76), label);
  col = mix(col, vec3(0.06), max(bars, lines * 0.7));
  col *= 1.0 - 0.75 * seam - 0.12 * bevel;
  s.albedo = col;
  s.height = 0.5 + 0.1 * (flute - 0.5) - 0.5 * seam - 0.1 * bevel + 0.03 * label + 0.02 * tape;
  s.rough = mix(mix(0.9, 0.42, tape), 0.62, label);
  s.ao = 1.0 - 0.6 * seam;
  return s;
}`;

// 分区新增的材质都在这里建（预算 14 个），各模块共用同一批实例才能合批
export function whMats(mats) {
  const IN = { wet: false, indoor: 0.3 };
  const carton = mats.set('whCarton', CARTON, { size: 1024, normal: 0.008, seed: 41 });
  return {
    liner: mats.paint(0xa7aca9, { wear: 0.12, dirt: 0.45, rough: 0.55, ...IN }),
    rackBlue: mats.paint(0x1d4a80, { wear: 0.3, dirt: 0.4, rough: 0.45, ...IN }),
    rackOrange: mats.paint(0xd0561a, { wear: 0.35, dirt: 0.35, rough: 0.45, ...IN }),
    yellow: mats.paint(0xd0a215, { wear: 0.55, dirt: 0.5, rough: 0.5, ...IN }),
    red: mats.paint(0xa3170f, { wear: 0.25, dirt: 0.35, rough: 0.4, ...IN }),
    white: mats.paint(0xc6c8c2, { wear: 0.3, dirt: 0.65, rough: 0.45, ...IN }),
    carton: mats.one('wh|carton', () => mats.pbr(carton, IN)),
    film: mats.one('wh|film', () => mats.pbr(carton, { color: 0xe4e8ec, rough: 0.36, ...IN })),
    floor: mats.one('wh|floor', () => mats.pbr(mats.tex.concrete, { color: 0xb6b2a8, rough: 0.62, ...IN })),
    lamp: mats.emissive(0xfff1dc, 40),
    // 会闪的那盏灯单独一个发光材质，update 里改它的亮度（只改数值，不触发重编译）
    lampFlicker: mats.one('wh|lampFlicker', () => new THREE.MeshStandardMaterial({
      color: 0x050505, emissive: 0xfff1dc, emissiveIntensity: 40, roughness: 0.4,
    })),
  };
}

// 图集里的几块通用图样：纯色（取中间一块，免得边缘被 mip 混进透明）、黄黑斜纹、地面斜线
export const inset = (r, k = 0.3) => {
  const du = (r[2] - r[0]) * k, dv = (r[3] - r[1]) * k;
  return [r[0] + du, r[1] + dv, r[2] - du, r[3] - dv];
};
export function swatches(ctx, rand) {
  const A = ctx.atlas;
  const solid = (key, color) => inset(A.cached(`wh|${key}`, 32, 16, (c, w, h) => { c.fillStyle = color; c.fillRect(0, 0, w, h); }));
  return {
    yellow: solid('yellow', '#d4a51b'),
    white: solid('white', '#d9d8d0'),
    dark: solid('dark', 'rgba(20,20,20,0.55)'),
    hazard: A.cached('wh|hazard', 512, 64, (c, w, h) => {
      c.fillStyle = '#d4a51b'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#15161a';
      for (let x = -h; x < w + h; x += 64) {
        c.beginPath(); c.moveTo(x, h); c.lineTo(x + 32, h); c.lineTo(x + 32 + h, 0); c.lineTo(x + h, 0); c.closePath(); c.fill();
      }
      distress(c, w, h, rand, 0.7);
    }),
    // 地面禁停斜线：一格 1.2 m，铺的时候按格拼，斜线才不会被拉变形
    hatch: A.cached('wh|hatch', 256, 256, (c, w, h) => {
      c.strokeStyle = '#d4a51b'; c.lineWidth = 34;
      for (let x = -w; x < w * 2; x += 96) { c.beginPath(); c.moveTo(x, h + 20); c.lineTo(x + h + 40, -20); c.stroke(); }
      distress(c, w, h, rand, 1.2);
    }),
  };
}

// 贴花：中心在 (x, y, z)，yaw 0 时朝 +Z；pitch -90° 就平铺在地上（宽沿 x，深沿 z）
export function sticker(ctx, rect, x, y, z, w, h, yaw = 0, pitch = 0) {
  const g = decalQuad(w, h, rect);
  g.translate(-w / 2, -h / 2, 0);
  ctx.decals.add(ctx.atlas.material, g, xf(x, y, z, pitch, yaw, 0));
}
export const floorSticker = (ctx, rect, x, y, z, w, d, yaw = 0) => sticker(ctx, rect, x, y + 0.004, z, w, d, yaw, -Math.PI / 2);

// 地面画线：从 (ax, az) 到 (bx, bz)，宽 w
export function floorLine(ctx, rect, y, ax, az, bx, bz, w = 0.1) {
  const len = Math.hypot(bx - ax, bz - az);
  floorSticker(ctx, rect, (ax + bx) / 2, y, (az + bz) / 2, len, w, Math.atan2(-(bz - az), bx - ax));
}

// 地面禁停区：x0..x1 × z0..z1 用斜线格拼满，四边描线
export function keepClear(ctx, sw, y, x0, x1, z0, z1) {
  const nx = Math.max(1, Math.round((x1 - x0) / 1.2)), nz = Math.max(1, Math.round((z1 - z0) / 1.2));
  const cw = (x1 - x0) / nx, cd = (z1 - z0) / nz;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) floorSticker(ctx, sw.hatch, x0 + (i + 0.5) * cw, y, z0 + (k + 0.5) * cd, cw, cd);
  for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) floorLine(ctx, sw.yellow, y + 0.001, ax, az, bx, bz, 0.08);
}

// 按高度分段砌墙：每段两面各用各的材质（neg 在坐标小的一侧），洞口按段裁开再交给 build.js
export function bandWall(ctx, along, { at, u0, u1, holes = [], bands, t = WALL }) {
  for (const b of bands) {
    const hs = [];
    for (const h of holes) {
      const y0 = Math.max(h.y0 ?? -Infinity, b.y0), y1 = Math.min(h.y1 ?? Infinity, b.y1);
      if (y1 - y0 > 1e-3) hs.push({ a: h.a, b: h.b, y0, y1 });
    }
    const o = { y0: b.y0, y1: b.y1, t, holes: hs, surface: b.surface || 'concrete', tile: b.tile ?? 3, mat2: b.pos };
    if (along === 'x') wallX(ctx, b.neg, { ...o, z: at, x0: u0, x1: u1 });
    else wallZ(ctx, b.neg, { ...o, x: at, z0: u0, z1: u1 });
  }
}

// 门窗框：洞口 a..b × y0..y1 外面一圈方钢，深 d 穿过墙厚。along 'x' 表示墙沿 x 走
export function frame(ctx, mat, along, at, a, b, y0, y1, { w = 0.07, d = WALL + 0.05, sill = false } = {}) {
  const put = (len, h, u, y) => {
    if (along === 'x') ctx.batch.add(mat, box(len, h, d), xf(u, y, at), G);
    else ctx.batch.add(mat, box(d, h, len), xf(at, y, u), G);
  };
  put(b - a + w * 2, w, (a + b) / 2, y1 + w / 2);
  if (sill) put(b - a + w * 2, w, (a + b) / 2, y0 - w / 2);
  put(w, y1 - y0, a - w / 2, (y0 + y1) / 2);
  put(w, y1 - y0, b + w / 2, (y0 + y1) / 2);
}
