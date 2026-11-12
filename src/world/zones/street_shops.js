import * as THREE from 'three';
import { xf, box, cyl, cylBetween, corrugated } from '../../gfx/geo.js';
import { aabb, collider, decal, rb } from './street_kit.js';
import { TILE } from './street_mats.js';
import { tires } from './street_props.js';

// 门面上的部件：卷帘、汽修铺半开的大门、磨砂橱窗、玻璃门、铁门、招牌、霓虹、挑出的竖招牌、雨棚、空调外机、防盗笼。
// 门面朝 -X（街道），墙皮在 x = FACE，墙厚 0.4。z 方向 a..b 是洞口范围。
export const FACE = 42.0, BACK = 42.4, WALK = 0.15;
const G = { tile: TILE.galv }, P = { tile: TILE.paint };
const W = -Math.PI / 2; // 朝西

// 卷帘门（水平波纹），bottom 给了就是卷到一半
export function shutter(ctx, S, s, bottom = WALK) {
  const { batch, mats } = ctx;
  const len = s.b - s.a, paint = S[s.paint || 'grey'];
  batch.add(paint, corrugated(len, s.top - bottom, { pitch: 0.075, depth: 0.012, horizontal: true, tile: TILE.paint, ou: s.a / 5.2 }), xf(FACE + 0.08, bottom, s.a, 0, W, 0));
  batch.add(mats.steelDark, rb(0.06, 0.07, len, 0.01), xf(FACE + 0.07, bottom + 0.035, (s.a + s.b) / 2), G);
  for (const z of [s.a + 0.3, s.b - 0.3]) batch.add(mats.galv, rb(0.03, 0.05, 0.1, 0.006), xf(FACE + 0.035, bottom + 0.12, z), G);
  for (const z of [s.a + 0.04, s.b - 0.04]) batch.add(mats.steelDark, box(0.12, s.top - WALK, 0.08), xf(FACE + 0.06, (s.top + WALK) / 2, z), G);
  // 卷帘箱藏在过梁后面，外面只露一道压条
  aabb(ctx, S.frame, FACE - 0.05, FACE + 0.02, s.top, s.top + 0.1, s.a - 0.06, s.b + 0.06, { tile: TILE.paint, r: 0.01 });
  collider(ctx, FACE, FACE + 0.2, bottom, s.top, s.a, s.b, 'metal');
  if (bottom > WALK + 0.1) collider(ctx, FACE, BACK, 0, bottom, s.a, s.b, 'metal', true);
}

// 汽修铺：卷帘卷起一半，下面看得见亮灯的车间
export function workshop(ctx, S, s, glow) {
  const { batch, mats } = ctx;
  const open = 1.45, depth = 4.6, zc = (s.a + s.b) / 2, len = s.b - s.a;
  shutter(ctx, S, { ...s, paint: 'grey' }, open);
  const x1 = BACK + depth;
  batch.add(mats.concreteInDark, box(depth, 0.15, len + 0.4), xf(BACK + depth / 2, 0.075, zc), { tile: TILE.conc });
  for (const z of [s.a - 0.1, s.b + 0.1]) batch.add(mats.concreteInDark, box(depth, s.top + 0.5, 0.2), xf(BACK + depth / 2, (s.top + 0.5) / 2, z), { tile: TILE.conc });
  batch.add(mats.concreteInDark, box(0.2, s.top + 0.5, len + 0.4), xf(x1 + 0.1, (s.top + 0.5) / 2, zc), { tile: TILE.conc });
  batch.add(mats.concreteInDark, box(depth, 0.2, len + 0.4), xf(BACK + depth / 2, s.top + 0.6, zc), { tile: TILE.conc });
  batch.add(S.neon, glow.quad('garage', len, len * 0.4), xf(x1 - 0.01, 0.15 + len * 0.2, zc, 0, W, 0));
  batch.add(S.neon, glow.quad('garageFloor', depth, len), xf(BACK + depth / 2, 0.152, zc, -Math.PI / 2, 0, 0));
  for (const dz of [-1.2, 0.9]) batch.add(S.neon, glow.quad('panel', 1.4, 0.12), xf(BACK + 2.4, s.top + 0.49, zc + dz, Math.PI / 2, Math.PI / 2, 0));
  // 举升机立柱和一摞轮胎，在亮墙前面成剪影
  for (const dz of [-1.5, 1.5]) batch.add(S.blue, rb(0.25, 3.0, 0.25, 0.02), xf(BACK + 2.6, 1.6, zc + dz), P);
  batch.add(S.blue, rb(1.6, 0.12, 0.2, 0.02), xf(BACK + 2.2, 0.9, zc - 1.5), P);
  tires(ctx, { x: BACK + 1.2, y: WALK, z: zc + 1.3, n: 3 });
  collider(ctx, x1, x1 + 0.2, 0, s.top, s.a, s.b, 'concrete');
}

// 磨砂橱窗（亮着），下面一段窗台墙
export function frosted(ctx, S, s, glow) {
  const { batch, mats } = ctx;
  const len = s.b - s.a, zc = (s.a + s.b) / 2, y0 = 0.62;
  aabb(ctx, mats.concreteDark, FACE + 0.02, BACK - 0.1, WALK, y0, s.a, s.b, { tile: TILE.conc });
  batch.add(S.neon, glow.quad('frosted', len, s.top - y0), xf(FACE + 0.25, (y0 + s.top) / 2, zc, 0, W, 0));
  batch.add(mats.glass, box(0.012, s.top - y0, len), xf(FACE + 0.1, (y0 + s.top) / 2, zc));
  for (const y of [y0, s.top - 0.03]) batch.add(mats.galv, rb(0.08, 0.06, len, 0.008), xf(FACE + 0.1, y, zc), G);
  const n = Math.max(1, Math.round(len / 1.4));
  for (let i = 1; i < n; i++) batch.add(mats.galv, rb(0.08, s.top - y0, 0.05, 0.008), xf(FACE + 0.1, (y0 + s.top) / 2, s.a + (len * i) / n), G);
  collider(ctx, FACE, FACE + 0.2, WALK, s.top, s.a, s.b, 'glass');
}

// 亮灯的玻璃门 + 小雨篷
export function glassDoor(ctx, S, s, glow) {
  const { batch, mats } = ctx;
  const len = s.b - s.a, zc = (s.a + s.b) / 2, hgt = s.top - WALK;
  batch.add(S.neon, glow.quad('door', len, hgt), xf(FACE + 0.26, WALK + hgt / 2, zc, 0, W, 0));
  batch.add(mats.glass, box(0.012, hgt, len), xf(FACE + 0.12, WALK + hgt / 2, zc));
  for (const z of [s.a + 0.03, zc, s.b - 0.03]) batch.add(mats.galv, rb(0.06, hgt, 0.06, 0.008), xf(FACE + 0.12, WALK + hgt / 2, z), G);
  batch.add(mats.galv, rb(0.06, 0.08, len, 0.008), xf(FACE + 0.12, s.top - 0.04, zc), G);
  for (const s2 of [-1, 1]) batch.add(mats.galv, cyl(0.014, 0.014, 0.5, 8), xf(FACE + 0.06, 1.1, zc + s2 * 0.1), G);
  batch.add(mats.galv, rb(0.9, 0.06, len + 0.6, 0.01), xf(FACE - 0.45, s.top + 0.2, zc), G);
  batch.add(mats.glass, box(0.86, 0.01, len + 0.5), xf(FACE - 0.45, s.top + 0.24, zc));
  for (const s2 of [-1, 1]) batch.add(mats.galv, cylBetween(FACE, s.top + 0.62, zc + s2 * (len / 2 + 0.2), FACE - 0.85, s.top + 0.23, zc + s2 * (len / 2 + 0.2), 0.012, 6), null, G);
  collider(ctx, FACE, FACE + 0.2, WALK, s.top, s.a, s.b, 'glass');
}

// 通楼上的铁门，带门牌、门禁、小雨篷
export function steelDoor(ctx, S, s, no) {
  const { batch, mats } = ctx;
  const len = s.b - s.a, zc = (s.a + s.b) / 2, hgt = s.top - WALK;
  batch.add(S.frame, rb(0.06, hgt - 0.02, len - 0.04, 0.008), xf(FACE + 0.22, WALK + hgt / 2, zc), P);
  for (const y of [0.6, 1.5]) batch.add(S.frame, rb(0.03, 0.5, len - 0.3, 0.006), xf(FACE + 0.18, WALK + y, zc), P);
  batch.add(mats.galv, rb(0.05, 0.03, 0.14, 0.006), xf(FACE + 0.17, 1.15, s.b - 0.2), G);
  batch.add(mats.plasticBlack, rb(0.04, 0.26, 0.16, 0.01), xf(FACE - 0.02, 1.45, s.a - 0.22), { tile: TILE.plastic });
  batch.add(mats.concreteDark, rb(0.7, 0.1, len + 0.5, 0.01), xf(FACE - 0.35, s.top + 0.25, zc), { tile: TILE.conc });
  if (no) decal(ctx, no, 0.27, 0.18, FACE, s.top + 0.55, zc, 'w');
  collider(ctx, FACE, BACK, WALK, s.top, s.a, s.b, 'metal');
}

// 一楼的小窗：lit 亮灯（玻璃 + 屋里），否则是装了铁栅的暗窗
export function smallWindow(ctx, S, s, glow, lit) {
  const { batch, mats } = ctx;
  const len = s.b - s.a, zc = (s.a + s.b) / 2, hgt = s.top - s.y0, yc = (s.y0 + s.top) / 2;
  if (lit) batch.add(S.neon, glow.quad(s.room || 'room3', len, hgt), xf(BACK - 0.01, yc, zc, 0, W, 0));
  batch.add(lit ? mats.glass : mats.glassDark, box(0.012, hgt, len), xf(FACE + 0.2, yc, zc));
  if (!lit) for (let z = s.a + 0.12; z < s.b - 0.05; z += 0.13) batch.add(mats.steelDark, cyl(0.011, 0.011, hgt, 6), xf(FACE + 0.05, yc, z), G);
  batch.add(mats.concrete, rb(0.16, 0.06, len + 0.12, 0.01), xf(FACE - 0.05, s.y0 - 0.03, zc), { tile: TILE.conc });
  collider(ctx, FACE, FACE + 0.22, s.y0, s.top, s.a, s.b, 'glass');
}

// 招牌底板 + 图集文字（不亮）
export function boardSign(ctx, S, rect, a, b, y0, y1) {
  const len = b - a, zc = (a + b) / 2;
  aabb(ctx, S.frame, FACE - 0.16, FACE, y0, y1, a, b, { tile: TILE.paint, r: 0.015 });
  decal(ctx, rect, len - 0.1, y1 - y0 - 0.1, FACE - 0.16, (y0 + y1) / 2, zc, 'w');
}

// 灯箱 / 霓虹：黑底板 + 自发光面（mat 给 S.flicker 就会闪）
export function glowSign(ctx, S, glow, key, a, b, y0, y1, mat = null) {
  const len = b - a, zc = (a + b) / 2;
  aabb(ctx, ctx.mats.black, FACE - 0.14, FACE, y0, y1, a, b, { tile: 0, r: 0.012 });
  ctx.batch.add(mat || S.neon, glow.quad(key, len - 0.06, y1 - y0 - 0.06), xf(FACE - 0.145, (y0 + y1) / 2, zc, 0, W, 0));
}

// 垂直挑出的竖招牌：两面都亮
export function blade(ctx, S, glow, key, z, y0, h, d = 0.9, mat = null) {
  const { batch, mats } = ctx;
  const xc = FACE - 0.15 - d / 2, w = d;
  batch.add(mats.black, rb(w, h, 0.12, 0.02), xf(xc, y0 + h / 2, z));
  for (const s of [-1, 1]) batch.add(mat || S.neon, glow.quad(key, w - 0.06, h - 0.06), xf(xc, y0 + h / 2, z + s * 0.062, 0, s > 0 ? 0 : Math.PI, 0));
  for (const y of [y0 + 0.3, y0 + h - 0.3]) batch.add(mats.galv, rb(0.2, 0.05, 0.05, 0.006), xf(FACE - 0.08, y, z), G);
}

// 波纹板雨棚：从 top 往外挑 depth，带三角撑
export function awning(ctx, S, a, b, top, paint, depth = 1.15, drop = 0.42) {
  const { batch, mats } = ctx;
  const len = b - a, slope = Math.hypot(depth, drop), th = Math.atan2(drop, depth);
  const ex = new THREE.Vector3(0, 0, -1), ey = new THREE.Vector3(-Math.cos(th), -Math.sin(th), 0), ez = new THREE.Vector3().crossVectors(ex, ey);
  const m = new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(FACE, top, b);
  batch.add(paint, corrugated(len, slope, { pitch: 0.2, depth: 0.025, tile: TILE.paint, ou: a / 5.2 }), m);
  batch.add(paint, box(len, slope, 0.008), m.clone().multiply(xf(len / 2, slope / 2, -0.006)), P);
  batch.add(S.frame, rb(0.06, 0.16, len, 0.008), xf(FACE - depth, top - drop - 0.06, (a + b) / 2), P);
  const n = Math.max(2, Math.round(len / 2));
  for (let i = 0; i <= n; i++) {
    const z = a + 0.1 + (i * (len - 0.2)) / n;
    batch.add(mats.steelDark, cylBetween(FACE, top - 0.9, z, FACE - depth + 0.1, top - drop + 0.03, z, 0.016, 6), null, G);
  }
  collider(ctx, FACE - depth, FACE, top - drop - 0.12, top, a, b, 'metal');
}

// 空调外机：挂在窗下的角钢架上，管子钻进墙
export function acUnit(ctx, S, z, y) {
  const { batch, mats } = ctx;
  const x = FACE - 0.2;
  batch.add(S.grey, rb(0.3, 0.55, 0.8, 0.02), xf(x, y, z), P);
  batch.add(mats.plasticBlack, cyl(0.2, 0.2, 0.012, 18), xf(x - 0.152, y, z + 0.1, 0, 0, Math.PI / 2), { tile: TILE.plastic });
  for (const k of [-1, 0, 1]) batch.add(mats.galv, box(0.006, 0.4, 0.012), xf(x - 0.16, y, z + 0.1 + k * 0.1), G);
  for (const s of [-1, 1]) {
    batch.add(mats.steelDark, box(0.36, 0.03, 0.03), xf(x + 0.02, y - 0.29, z + s * 0.3), G);
    batch.add(mats.steelDark, cylBetween(FACE, y - 0.6, z + s * 0.3, x - 0.14, y - 0.3, z + s * 0.3, 0.012, 4), null, G);
  }
  batch.add(mats.reflective, cylBetween(x + 0.1, y + 0.1, z - 0.38, FACE + 0.05, y + 0.32, z - 0.45, 0.016, 6));
}

// 防盗笼：窗外一圈竖条钢筋，顶上一块小波纹板
export function cage(ctx, S, a, b, y0, y1) {
  const { batch, mats } = ctx;
  const d = 0.5, x = FACE - d;
  for (let z = a; z <= b + 1e-3; z += 0.13) batch.add(mats.galv, cyl(0.009, 0.009, y1 - y0, 5), xf(x, (y0 + y1) / 2, z), G);
  for (const y of [y0, y0 + 0.5, y1]) {
    batch.add(mats.galv, box(0.025, 0.025, b - a), xf(x, y, (a + b) / 2), G);
    for (const z of [a, b]) batch.add(mats.galv, box(d, 0.025, 0.025), xf(FACE - d / 2, y, z), G);
  }
  batch.add(S.blue, box(d + 0.15, 0.02, b - a + 0.2), xf(FACE - d / 2 - 0.05, y1 + 0.06, (a + b) / 2, 0, 0, 0.18), P);
  // 笼子里的花盆和挂着的毛巾
  batch.add(S.red, cyl(0.12, 0.09, 0.2, 10), xf(x + 0.15, y0 + 0.1, a + 0.4), P);
  batch.add(ctx.mats.tarp, box(0.02, 0.4, 0.35), xf(x + 0.05, y1 - 0.4, (a + b) / 2 + 0.2), { tile: 0.25 });
}
