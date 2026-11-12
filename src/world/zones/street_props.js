import * as THREE from 'three';
import { xf, box, cyl, cylBetween, lathe, scaleUV } from '../../gfx/geo.js';
import { decalQuad } from '../labels.js';
import { aabb, collider, decal, rb } from './street_kit.js';
import { TILE } from './street_mats.js';
import { roundSign, warnSign } from './street_decals.js';

// 街道家具：公交候车亭、垃圾桶、配电箱、消防栓、建筑垃圾斗、水马、交通标志、花池。
const G = { tile: TILE.galv }, P = { tile: TILE.paint }, K = { tile: TILE.plastic };
const at = (o) => xf(o.x, o.y || 0, o.z, 0, o.yaw || 0, 0);

// 公交候车亭：背板玻璃朝人行道，北端是亮着的广告灯箱，木条长凳
export function shelter(ctx, S, glow, { x0, x1, z0, z1, y = 0.15 }) {
  const { batch, mats } = ctx;
  const back = x1 - 0.06, zc = (z0 + z1) / 2, len = z1 - z0;
  for (const z of [z0 + 0.08, zc, z1 - 0.08]) batch.add(mats.galv, rb(0.09, 2.45, 0.09, 0.01), xf(back, y + 1.225, z), G);
  batch.add(S.frame, rb(x1 - x0 + 0.2, 0.12, len + 0.2, 0.02), xf((x0 + x1) / 2 - 0.05, y + 2.5, zc), P);
  batch.add(mats.glass, box(x1 - x0, 0.012, len), xf((x0 + x1) / 2 - 0.05, y + 2.57, zc));
  batch.add(mats.glass, box(0.012, 1.95, len - 0.2), xf(back, y + 1.2, zc));
  for (const yy of [y + 0.2, y + 2.2]) batch.add(mats.galv, rb(0.05, 0.05, len - 0.1, 0.008), xf(back, yy, zc), G);
  collider(ctx, back - 0.06, back + 0.06, 0, y + 2.25, z0, z1, 'glass');
  // 广告灯箱
  batch.add(S.frame, rb(x1 - x0 - 0.1, 2.05, 0.16, 0.02), xf((x0 + x1) / 2, y + 1.15, z0 + 0.08), P);
  for (const s of [-1, 1]) batch.add(S.neon, glow.quad('ad', x1 - x0 - 0.3, 1.85), xf((x0 + x1) / 2, y + 1.15, z0 + 0.08 + s * 0.082, 0, s > 0 ? 0 : Math.PI, 0));
  collider(ctx, x0, x1, 0, y + 2.2, z0, z0 + 0.16, 'metal');
  // 长凳
  for (let i = 0; i < 4; i++) batch.add(mats.woodDark, rb(0.08, 0.035, len - 1.4, 0.01), xf(back - 0.15 - i * 0.09, y + 0.46, zc + 0.3), { tile: TILE.wood });
  for (const dz of [-0.7, 1.3]) batch.add(mats.steelDark, box(0.36, 0.44, 0.05), xf(back - 0.27, y + 0.22, zc + dz), G);
  collider(ctx, back - 0.45, back - 0.06, y, y + 0.48, zc + 0.3 - (len - 1.4) / 2, zc + 0.3 + (len - 1.4) / 2, 'wood');
  // 站牌
  const sx = x0 + 0.1, sz = z1 + 0.25;
  batch.add(mats.galv, cyl(0.04, 0.04, 2.9, 10), xf(sx, y + 1.45, sz), G);
  const rect = ctx.atlas.cached('street|busStop', 160, 256, (c, w, h) => {
    c.fillStyle = '#e8ece8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1b6b3a'; c.fillRect(0, 0, w, 70);
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = '800 46px "Microsoft YaHei UI", sans-serif'; c.fillText('37 路', w / 2, 52);
    c.fillStyle = '#1a1a1a'; c.font = '700 28px "Microsoft YaHei UI", sans-serif'; c.fillText('港前路站', w / 2, 112);
    c.font = '500 18px "Microsoft YaHei UI", sans-serif';
    ['货运东门', '港前路', '渔具市场', '北堤'].forEach((s, i) => c.fillText(`${i ? '↓' : '●'} ${s}`, w / 2, 150 + i * 26));
  });
  batch.add(S.frame, rb(0.05, 0.75, 0.48, 0.01), xf(sx, y + 2.4, sz), P);
  decal(ctx, rect, 0.44, 0.7, sx - 0.026, y + 2.4, sz, 'w');
}

// 带轮垃圾桶（240 升），big 是四轮的 660 升大桶
export function bin(ctx, S, o) {
  const { batch, mats } = ctx;
  const m = at(o), big = o.big, w = big ? 1.26 : 0.58, d = big ? 0.78 : 0.72, h = big ? 1.2 : 1.0;
  const mat = o.mat || S.plasticGreen;
  batch.add(mat, rb(w * 0.94, h - 0.12, d * 0.9, 0.04), m.clone().multiply(xf(0, 0.06 + (h - 0.12) / 2, 0)), K);
  batch.add(mat, rb(w, 0.05, d, 0.02), m.clone().multiply(xf(0, h - 0.06, 0)), K);
  batch.add(mat, rb(w + 0.02, 0.06, d + 0.04, 0.02, 2), m.clone().multiply(xf(0, h, 0.01, o.open ? -0.5 : 0, 0, 0)), K);
  batch.add(mats.plasticBlack, cylBetween(-w * 0.4, h - 0.1, -d / 2 - 0.04, w * 0.4, h - 0.1, -d / 2 - 0.04, 0.018, 6), m, K);
  const wx = big ? [-0.5, 0.5] : [-0.24, 0.24], wz = big ? [-0.28, 0.28] : [-d / 2 + 0.05];
  for (const x of wx) for (const z of wz) batch.add(mats.rubber, cyl(0.09, 0.09, 0.05, 12), m.clone().multiply(xf(x, 0.09, z, 0, 0, Math.PI / 2)));
  ctx.phys.solid(m, 0, h / 2, 0, w / 2, h / 2, d / 2, 'metal');
}

// 路边配电箱
export function cabinet(ctx, S, o) {
  const { batch, mats } = ctx;
  const m = at(o);
  batch.add(mats.concrete, rb(0.72, 0.2, 1.25, 0.02), m.clone().multiply(xf(0, 0.1, 0)), { tile: TILE.conc });
  batch.add(S.box, rb(0.6, 1.4, 1.1, 0.02), m.clone().multiply(xf(0, 0.9, 0)), P);
  batch.add(S.box, rb(0.68, 0.06, 1.18, 0.02), m.clone().multiply(xf(0, 1.62, 0)), P);
  for (const s of [-1, 1]) {
    batch.add(mats.black, box(0.006, 1.2, 0.01), m.clone().multiply(xf(-0.302, 0.9, s * 0.01)));
    batch.add(mats.galv, rb(0.03, 0.12, 0.04, 0.006), m.clone().multiply(xf(-0.31, 0.95, s * 0.12)), G);
    for (let i = 0; i < 5; i++) batch.add(mats.black, box(0.006, 0.015, 0.3), m.clone().multiply(xf(-0.302, 1.3 + i * 0.04, s * 0.3)));
  }
  const warn = ctx.atlas.cached('street|bolt', 128, 160, (c, w, h) => {
    c.fillStyle = '#e8b520'; c.beginPath(); c.moveTo(w / 2, 6); c.lineTo(w - 6, 110); c.lineTo(6, 110); c.closePath(); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.moveTo(70, 34); c.lineTo(52, 70); c.lineTo(66, 70); c.lineTo(56, 100); c.lineTo(80, 60); c.lineTo(66, 60); c.closePath(); c.fill();
    c.font = '700 26px "Microsoft YaHei UI", sans-serif'; c.textAlign = 'center'; c.fillText('有电危险', w / 2, 146);
  });
  const g = decalQuad(0.22, 0.28, warn);
  g.translate(-0.11, -0.14, 0);
  ctx.decals.add(ctx.atlas.material, g, m.clone().multiply(xf(-0.306, 1.15, 0.3, 0, -Math.PI / 2, 0)));
  ctx.phys.solid(m, 0, 0.82, 0, 0.36, 0.82, 0.62, 'metal');
}

// 消防栓（红色铸铁）
export function hydrant(ctx, S, o) {
  const m = at(o);
  const prof = [[0.1, 0], [0.1, 0.05], [0.085, 0.07], [0.085, 0.55], [0.1, 0.57], [0.1, 0.6], [0.07, 0.62], [0.05, 0.7], [0.02, 0.74], [0, 0.74]];
  ctx.batch.add(S.red, scaleUV(lathe(prof, 16), 0.2, 0.2), m, P);
  for (const s of [-1, 1]) ctx.batch.add(S.red, cyl(0.04, 0.04, 0.14, 10), m.clone().multiply(xf(s * 0.12, 0.42, 0, 0, 0, Math.PI / 2)), P);
  ctx.batch.add(S.red, cyl(0.05, 0.05, 0.12, 10), m.clone().multiply(xf(0, 0.4, 0.12, Math.PI / 2, 0, 0)), P);
}

// 建筑垃圾斗：梯形斗身，两端斜板，顶边加强
export function skip(ctx, S, o) {
  const { batch, mats } = ctx;
  const m = at(o), L = 3.6, W = 1.7, H = 1.15, paint = S.yellow;
  for (const s of [-1, 1]) batch.add(paint, box(0.05, H, L - 0.5), m.clone().multiply(xf(s * (W / 2 - 0.025), H / 2 + 0.08, 0)), P);
  for (const s of [-1, 1]) {
    const ang = s * 0.42, zz = s * (L / 2 - 0.25);
    batch.add(paint, box(W, H / Math.cos(0.42), 0.05), m.clone().multiply(xf(0, H / 2 + 0.08, zz, ang, 0, 0)), P);
    batch.add(mats.steelDark, box(0.08, 0.3, 0.3), m.clone().multiply(xf(s * (W / 2 + 0.04), H - 0.1, s * 0.9)), G);
  }
  batch.add(paint, box(W - 0.1, 0.05, L - 1.4), m.clone().multiply(xf(0, 0.1, 0)), P);
  for (const s of [-1, 1]) batch.add(mats.steelDark, rb(0.1, 0.1, L - 0.4, 0.01), m.clone().multiply(xf(s * (W / 2), H + 0.05, 0)), G);
  for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) batch.add(mats.steelDark, box(0.04, H - 0.1, 0.08), m.clone().multiply(xf(s * (W / 2 + 0.02), H / 2 + 0.1, i * 0.55)), G);
  for (const s of [-0.6, 0.6]) batch.add(mats.steelDark, box(0.15, 0.1, L - 0.8), m.clone().multiply(xf(s, 0.05, 0)), G);
  // 斗里的碎砖、木板、编织袋
  batch.add(mats.concreteDark, box(W - 0.2, 0.5, L - 1.2), m.clone().multiply(xf(0, 0.35, 0, 0.04, 0, 0.03)), { tile: TILE.conc });
  for (let i = 0; i < 5; i++) batch.add(mats.woodDark, box(0.1, 0.03, 1.4), m.clone().multiply(xf(-0.5 + i * 0.25, 0.7 + i * 0.03, (ctx.rand() - 0.5) * 0.6, 0.2, ctx.rand(), 0.1)), { tile: TILE.wood });
  batch.add(mats.sandbag, rb(0.5, 0.25, 0.35, 0.08), m.clone().multiply(xf(0.3, 0.7, -0.6, 0, 0.4, 0)), { tile: 0.25 });
  ctx.phys.solid(m, 0, (H + 0.15) / 2, 0, W / 2 + 0.05, (H + 0.15) / 2, L / 2, 'metal');
}

// 水马（注水塑料隔离墩），红白相间
export function waterBarrier(ctx, S, o, i = 0) {
  const { batch, mats } = ctx;
  const m = at(o), mat = i % 2 ? mats.reflective : mats.plasticOrange;
  batch.add(mat, rb(1.0, 0.18, 0.46, 0.05), m.clone().multiply(xf(0, 0.09, 0)), K);
  batch.add(mat, rb(0.9, 0.62, 0.3, 0.06), m.clone().multiply(xf(0, 0.45, 0)), K);
  batch.add(mat, cyl(0.07, 0.07, 0.05, 10), m.clone().multiply(xf(0.3, 0.78, 0)), K);
  ctx.phys.solid(m, 0, 0.4, 0, 0.5, 0.4, 0.23, 'rubber');
}

// 一摞旧轮胎。props.tireStack 总是落在 y 0，摆在人行道或车间地坪上会陷进去，这里带上 y
export function tires(ctx, o) {
  const n = o.n || 3, y = o.y || 0;
  for (let i = 0; i < n; i++) {
    const g = new THREE.TorusGeometry(0.3, 0.115, 10, 22);
    ctx.batch.add(ctx.mats.rubber, scaleUV(g, 6, 2), xf(o.x + (ctx.rand() - 0.5) * 0.06, y + 0.115 + i * 0.225, o.z + (ctx.rand() - 0.5) * 0.06, Math.PI / 2, 0, 0));
  }
  ctx.phys.addCyl(o.x, o.z, 0.42, 0, y + n * 0.225 + 0.01, 'rubber');
}

// 路障上的黄闪灯
export function blinker(ctx, S, glow, x, y, z) {
  ctx.batch.add(ctx.mats.plasticBlack, rb(0.2, 0.22, 0.06, 0.02), xf(x, y + 0.11, z), K);
  for (const s of [-1, 1]) ctx.batch.add(S.blink, glow.quad('amber', 0.15, 0.15), xf(x, y + 0.12, z + s * 0.032, 0, s > 0 ? 0 : Math.PI, 0));
}

// 杆子上的交通标志：kind 见 street_decals.roundSign；face 是牌面朝向
export function signPost(ctx, S, x, z, kind, face, y = 0.15, h = 2.5) {
  const { batch, mats } = ctx;
  batch.add(mats.galv, cyl(0.035, 0.035, h, 10), xf(x, y + h / 2, z), G);
  const ry = { w: -Math.PI / 2, e: Math.PI / 2, n: Math.PI, s: 0 }[face];
  batch.add(mats.galv, cyl(0.31, 0.31, 0.015, 24), xf(x, y + h - 0.1, z, Math.PI / 2, ry, 0), G);
  const g = decalQuad(0.6, 0.6, roundSign(ctx, kind));
  g.translate(-0.3, -0.3, 0.012);
  ctx.decals.add(ctx.atlas.material, g, xf(x, y + h - 0.1, z, 0, ry, 0));
}

// 立在地上的人字警示牌
export function aFrame(ctx, S, o, cn, en) {
  const { batch, mats } = ctx;
  const m = at(o), rect = warnSign(ctx, `af${cn}`, cn, en, { w: 256, h: 160 });
  for (const s of [-1, 1]) {
    const fm = m.clone().multiply(xf(0, 0.55, s * 0.18, -0.3, s > 0 ? 0 : Math.PI, 0));
    batch.add(S.frame, rb(0.82, 1.1, 0.03, 0.01), fm, P);
    const g = decalQuad(0.74, 0.46, rect);
    g.translate(-0.37, 0, 0.017);
    ctx.decals.add(ctx.atlas.material, g, fm.clone().multiply(xf(0, -0.05, 0)));
  }
  batch.add(mats.steelDark, box(0.8, 0.03, 0.03), m.clone().multiply(xf(0, 0.5, 0)), G);
  ctx.phys.solid(m, 0, 0.55, 0, 0.42, 0.55, 0.36, 'metal').playerOnly = true;
}

// 混凝土花池，里面几根枯枝
export function planter(ctx, S, o) {
  const { batch, mats } = ctx;
  const m = at(o), w = o.w || 1.2, d = o.d || 0.5;
  batch.add(mats.concrete, rb(w, 0.55, d, 0.03), m.clone().multiply(xf(0, 0.275, 0)), { tile: TILE.conc });
  batch.add(mats.black, box(w - 0.12, 0.02, d - 0.12), m.clone().multiply(xf(0, 0.52, 0)));
  for (let i = 0; i < 5; i++) {
    const px = (ctx.rand() - 0.5) * (w - 0.3), pz = (ctx.rand() - 0.5) * (d - 0.2);
    batch.add(mats.woodDark, cylBetween(px, 0.5, pz, px + (ctx.rand() - 0.5) * 0.5, 1.0 + ctx.rand() * 0.6, pz + (ctx.rand() - 0.5) * 0.3, 0.012, 4), m, { tile: TILE.wood });
  }
  ctx.phys.solid(m, 0, 0.275, 0, w / 2, 0.275, d / 2, 'concrete');
}

