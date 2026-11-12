import * as THREE from 'three';
import { xf, box, cyl, cylBetween, corrugated, scaleUV } from '../../gfx/geo.js';
import { wallX, wallZ } from '../build.js';
import { WALLS, PORTAL, ZONE } from '../plan.js';
import { aabb, collider, rb } from './street_kit.js';
import { TILE } from './street_mats.js';

// 街道分区的围墙和大门：堆场东墙（东门）、卸货场东墙（滑动门 + 门卫室 + 道闸）、北墙、南端封闭的大门。
const H = 4.5, T = 0.4;
const G = { tile: TILE.galv };

// 墙顶压顶和朝外的刺丝支架。along 'z' 的墙 out 是 +1/-1（朝 +X / -X），along 'x' 的墙 out 朝 ±Z
function coping(ctx, along, at, u0, u1, out) {
  const { mats } = ctx;
  const len = u1 - u0;
  if (along === 'z') aabb(ctx, mats.concreteDark, at - 0.27, at + 0.27, H, H + 0.12, u0, u1, { tile: TILE.conc });
  else aabb(ctx, mats.concreteDark, u0, u1, H, H + 0.12, at - 0.27, at + 0.27, { tile: TILE.conc });
  const n = Math.max(1, Math.round(len / 2.8));
  const P = (u, k, dy) => (along === 'z' ? [at + out * k, H + 0.12 + dy, u] : [u, H + 0.12 + dy, at + out * k]);
  for (let i = 0; i <= n; i++) {
    const u = u0 + 0.1 + (i / n) * (len - 0.2);
    ctx.batch.add(mats.steelDark, cylBetween(...P(u, 0.05, 0), ...P(u, 0.42, 0.42), 0.018, 6), null, G);
  }
  for (const k of [0.16, 0.29, 0.42]) {
    const a = P(u0 + 0.1, k, k), b = P(u1 - 0.1, k, k);
    ctx.batch.add(mats.galv, cylBetween(...a, ...b, 0.0045, 4), null, G);
  }
}

// 方管门柱
function gatePost(ctx, S, x, z, h = 4.9) {
  aabb(ctx, S.frame, x - 0.18, x + 0.18, 0, h, z - 0.18, z + 0.18, { tile: TILE.paint, r: 0.02, surface: 'metal' });
  aabb(ctx, S.frame, x - 0.22, x + 0.22, h, h + 0.05, z - 0.22, z + 0.22, { tile: TILE.paint, r: 0.01 });
}

// 平开或推拉门扇的框（沿 z 放），中间填铁丝网或波纹板
function leafZ(ctx, S, x, z0, z1, y0, y1, fill) {
  const { batch, mats } = ctx;
  const len = z1 - z0, zm = (z0 + z1) / 2;
  for (const y of [y0 + 0.04, y1 - 0.04, (y0 + y1) / 2]) batch.add(S.frame, rb(0.07, 0.07, len, 0.008), xf(x, y, zm), { tile: TILE.paint });
  const nv = Math.max(2, Math.round(len / 1.6));
  for (let i = 0; i <= nv; i++) batch.add(S.frame, rb(0.07, y1 - y0, 0.07, 0.008), xf(x, (y0 + y1) / 2, z0 + (len * i) / nv), { tile: TILE.paint });
  batch.add(mats.galv, cylBetween(x, y0 + 0.1, z0 + 0.1, x, y1 - 0.1, z1 - 0.1, 0.014, 6), null, G);
  if (fill === 'mesh') {
    const g = scaleUV(new THREE.PlaneGeometry(len, y1 - y0 - 0.08), len / 0.48, (y1 - y0) / 0.48);
    batch.add(mats.chainlink, g, xf(x, (y0 + y1) / 2, zm, 0, Math.PI / 2, 0));
  } else {
    for (const s of [-1, 1]) {
      const g = corrugated(len - 0.06, y1 - y0 - 0.1, { pitch: 0.2, depth: 0.025, tile: TILE.paint, ou: z0 / 5.2 });
      batch.add(fill, g, xf(x + s * 0.02, y0 + 0.05, zm + s * (len / 2 - 0.03), 0, s * Math.PI / 2, 0));
    }
  }
  for (const z of [z0 + 0.5, z1 - 0.5]) batch.add(mats.rubber, cyl(0.07, 0.07, 0.05, 12), xf(x, 0.08, z, 0, 0, Math.PI / 2));
}

// 堆场东墙：z -20..20.9，东门开口 z 0..6，门扇推到南边贴着墙外放
function yardEast(ctx, S) {
  const { mats, batch } = ctx;
  const x = WALLS.yardEast.x, g = PORTAL.yardGate, ga = g.z - g.w / 2, gb = g.z + g.w / 2;
  const face = x + T / 2;
  wallZ(ctx, mats.concrete, { x, z0: -20, z1: 20.9, y1: H, t: T, holes: [{ a: ga, b: gb }], mat2: S.renderGrey, tile: TILE.render });
  // 勒脚、壁柱
  for (const [a, b] of [[-20, ga - 0.36], [gb + 0.36, 20.9]]) {
    aabb(ctx, mats.concreteDark, face, face + 0.05, 0, 0.55, a, b, { tile: TILE.conc });
    coping(ctx, 'z', x, a, b, 1);
  }
  for (const z of [-17.2, -13.6, -10, -6.4, -2.8, 14.2, 17.6]) {
    aabb(ctx, mats.concrete, face, face + 0.14, 0, H + 0.04, z - 0.22, z + 0.22, { tile: TILE.conc, surface: 'concrete' });
  }
  // 门柱和门柱上的小投光灯（灯本身不亮，只是灯具）
  gatePost(ctx, S, x, ga - 0.18);
  gatePost(ctx, S, x, gb + 0.18);
  for (const z of [ga - 0.18, gb + 0.18]) {
    const fm = xf(x + 0.42, 4.62, z, 0, 0, -0.5);
    batch.add(S.frame, rb(0.3, 0.18, 0.26, 0.02), fm, { tile: TILE.paint });
    batch.add(mats.emissive(0xffe2b8, 30), box(0.02, 0.13, 0.2), fm.clone().multiply(xf(0.152, 0, 0)));
    batch.add(mats.steelDark, cylBetween(x + 0.18, 4.75, z, x + 0.36, 4.68, z, 0.02, 6), null, G);
  }
  // 推到一边的门扇（铁丝网），地上有导轨，南端有导向柱
  const lx = face + 0.15;
  leafZ(ctx, S, lx, gb + 0.45, gb + 6.65, 0.12, 3.3, 'mesh');
  batch.add(mats.galv, box(0.06, 0.03, gb + 7 - ga + 0.3), xf(lx, 0.015, (ga - 0.3 + gb + 7) / 2), G);
  batch.add(S.frame, rb(0.12, 3.6, 0.12, 0.01), xf(lx, 1.8, gb + 6.82), { tile: TILE.paint });
  collider(ctx, face, lx + 0.17, 0, 3.4, gb + 0.36, gb + 6.9, 'metal', true);
}

// 卸货场东墙：z -48..-32.9，大门 z -43..-37，两扇推拉门各推到一侧墙后
function courtEast(ctx, S) {
  const { mats } = ctx;
  const x = WALLS.courtEast.x, g = PORTAL.courtGate, ga = g.z - g.w / 2, gb = g.z + g.w / 2;
  // 北端从北墙内皮起砌，转角不和北墙重叠（重叠的面会闪）
  wallZ(ctx, mats.concrete, { x, z0: ZONE.street.z0, z1: -32.9, y1: H, t: T, holes: [{ a: ga, b: gb }], mat2: S.renderGrey, tile: TILE.render });
  coping(ctx, 'z', x, -47.6, ga - 0.36, 1);
  coping(ctx, 'z', x, gb + 0.36, -32.9, 1);
  aabb(ctx, mats.concreteDark, x + T / 2, x + T / 2 + 0.05, 0, 0.55, gb + 0.36, -32.9, { tile: TILE.conc });
  gatePost(ctx, S, x, ga - 0.18);
  gatePost(ctx, S, x, gb + 0.18);
  const lx = x - T / 2 - 0.16;
  leafZ(ctx, S, lx, ga - 3.3, ga - 0.1, 0.08, 2.9, S.grey);
  leafZ(ctx, S, lx, gb + 0.1, gb + 3.2, 0.08, 2.9, S.grey);
  collider(ctx, lx - 0.1, x - T / 2, 0, 2.95, ga - 3.3, ga - 0.1, 'metal');
  collider(ctx, lx - 0.1, x - T / 2, 0, 2.95, gb + 0.1, gb + 3.2, 'metal');
  ctx.batch.add(mats.galv, box(0.06, 0.03, gb - ga + 6.6), xf(lx, 0.015, g.z), G);
}

// 门卫室：贴着卸货场东墙和北墙的街道一侧，窗朝南（大门）和朝东（街道）
function booth(ctx, S, glow) {
  const { mats, batch } = ctx;
  const x0 = WALLS.courtEast.x + T / 2, x1 = x0 + 2.4, z0 = ZONE.street.z0, z1 = z0 + 2.6;
  const P = { tile: TILE.paint }, R = { tile: TILE.render };
  aabb(ctx, mats.concreteDark, x0, x1 + 0.05, 0, 0.25, z0, z1 + 0.05, { tile: TILE.conc });
  // 窗下墙、门、窗上横带
  aabb(ctx, S.renderOchre, x0, x1 - 0.75, 0.25, 1.0, z1 - 0.08, z1, R);
  aabb(ctx, S.renderOchre, x1 - 0.08, x1, 0.25, 1.0, z0, z1, R);
  aabb(ctx, S.renderOchre, x0, x1, 2.3, 2.62, z1 - 0.08, z1, R);
  aabb(ctx, S.renderOchre, x1 - 0.08, x1, 2.3, 2.62, z0, z1, R);
  batch.add(S.grey, rb(0.72, 2.0, 0.05, 0.01), xf(x1 - 0.4, 1.27, z1 - 0.03), P);
  batch.add(mats.glass, box(0.4, 0.5, 0.01), xf(x1 - 0.4, 1.75, z1 - 0.003));
  batch.add(mats.galv, rb(0.03, 0.14, 0.05, 0.006), xf(x1 - 0.7, 1.15, z1 + 0.01), G);
  // 窗框和玻璃
  for (const [ax, az, bx, bz] of [[x0 + 0.05, z1 - 0.04, x1 - 0.8, z1 - 0.04], [x1 - 0.04, z0 + 0.05, x1 - 0.04, z1 - 0.05]]) {
    const len = Math.hypot(bx - ax, bz - az), cx = (ax + bx) / 2, cz = (az + bz) / 2, ry = az === bz ? 0 : Math.PI / 2;
    batch.add(mats.glass, box(len, 1.3, 0.012), xf(cx, 1.65, cz, 0, ry, 0));
    for (const y of [1.0, 2.3]) batch.add(S.frame, rb(len, 0.05, 0.1, 0.01), xf(cx, y, cz, 0, ry, 0), P);
    for (const t of [0, 0.5, 1]) batch.add(S.frame, rb(0.05, 1.3, 0.1, 0.01), xf(ax + (bx - ax) * t, 1.65, az + (bz - az) * t), P);
  }
  batch.add(S.frame, rb(0.1, 2.62, 0.1, 0.01), xf(x1 - 0.05, 1.31, z1 - 0.05), P);
  // 屋顶挑檐
  batch.add(S.frame, rb(2.75, 0.2, 2.95, 0.02), xf(x0 + 1.3, 2.72, z0 + 1.42), P);
  batch.add(mats.concreteDark, box(2.6, 0.04, 2.8), xf(x0 + 1.28, 2.84, z0 + 1.4), { tile: TILE.conc });
  // 屋里：桌子、监控屏、顶灯
  batch.add(mats.woodIn, box(1.5, 0.05, 0.6), xf(x0 + 0.9, 0.95, z1 - 0.4), { tile: TILE.wood });
  batch.add(mats.plasticBlack, rb(0.5, 0.34, 0.06, 0.01), xf(x0 + 0.7, 1.2, z1 - 0.62, -0.1, 0, 0), { tile: TILE.plastic });
  batch.add(S.neon, glow.quad('screen', 0.44, 0.28), xf(x0 + 0.48, 1.06, z1 - 0.585, -0.1, 0, 0));
  batch.add(S.neon, glow.quad('panel', 0.9, 0.3), xf(x0 + 1.2, 2.29, z0 + 1.2, Math.PI / 2, 0, 0));
  collider(ctx, x0, x1, 0, 2.85, z0, z1, 'metal');
  // 道闸：立柱在门卫室南边贴墙，杆子抬起
  aabb(ctx, S.yellow, x0, x0 + 0.4, 0, 1.05, z1, z1 + 0.4, { tile: TILE.paint, r: 0.02, surface: 'metal' });
  const px = x0 + 0.2, py = 0.95, pz = z1 + 0.2, a = THREE.MathUtils.degToRad(84);
  const dy = Math.sin(a), dz = Math.cos(a), seg = 10, L = 5.6;
  for (let i = 0; i < seg; i++) {
    const t0 = 0.25 + (i * L) / seg, t1 = 0.25 + ((i + 1) * L) / seg;
    batch.add(i % 2 ? S.carWhite : S.red, cylBetween(px + 0.26, py + dy * t0, pz + dz * t0, px + 0.26, py + dy * t1, pz + dz * t1, 0.045, 8), null, P);
  }
  batch.add(S.frame, rb(0.12, 0.3, 0.3, 0.02), xf(px + 0.26, py, pz), P);
}

// 北墙：卸货场一段（x 8.4..30.4）加街道北端一段（带一扇关着的邻厂大门）
function north(ctx, S) {
  const { mats, batch } = ctx;
  const z = WALLS.courtNorth.z, inner = z + T / 2, gx0 = 33.6, gx1 = 38.4;
  wallX(ctx, mats.concreteDark, { z, x0: 8.4, x1: 42.4, y1: H, t: T, holes: [{ a: gx0, b: gx1 }], mat2: mats.concrete, tile: TILE.conc });
  coping(ctx, 'x', z, 8.4, gx0 - 0.2, -1);
  coping(ctx, 'x', z, gx1 + 0.2, 42.4, -1);
  for (const x of [12.2, 16.2, 22.6, 26.6]) aabb(ctx, mats.concrete, x - 0.22, x + 0.22, 0, H + 0.04, inner, inner + 0.14, { tile: TILE.conc, surface: 'concrete' });
  for (const x of [gx0 - 0.2, gx1 + 0.2]) {
    aabb(ctx, S.frame, x - 0.2, x + 0.2, 0, 3.8, z - 0.2, z + 0.2, { tile: TILE.paint, r: 0.02, surface: 'metal' });
  }
  // 关着的推拉门：波纹钢板 + 方管框，门上挂锁链
  const gl = gx1 - gx0, gm = (gx0 + gx1) / 2;
  batch.add(S.blue, corrugated(gl, 3.2, { pitch: 0.24, depth: 0.03, tile: TILE.paint }), xf(gx0, 0.08, inner - 0.12));
  batch.add(S.blue, corrugated(gl, 3.2, { pitch: 0.24, depth: 0.03, tile: TILE.paint }), xf(gx1, 0.08, inner - 0.3, 0, Math.PI, 0));
  for (const y of [0.1, 1.7, 3.28]) batch.add(S.frame, rb(gl, 0.08, 0.1, 0.01), xf(gm, y, inner - 0.08), { tile: TILE.paint });
  for (let i = 0; i <= 4; i++) batch.add(S.frame, rb(0.08, 3.2, 0.1, 0.01), xf(gx0 + (gl * i) / 4, 1.68, inner - 0.08), { tile: TILE.paint });
  collider(ctx, gx0, gx1, 0, 3.35, z - 0.2, inner, 'metal');
  for (let i = 0; i < 6; i++) {
    const t = new THREE.TorusGeometry(0.05, 0.012, 6, 10);
    batch.add(mats.steelDark, t, xf(gx0 + gl * 0.5 - 0.15 + i * 0.06, 1.3 - Math.abs(i - 2.5) * 0.03, inner - 0.02, 0, i % 2 ? Math.PI / 2 : 0, 0), G);
  }
  batch.add(mats.steelDark, rb(0.09, 0.11, 0.04, 0.01), xf(gm + 0.02, 1.13, inner), G);
}

// 南端：两扇锁着的栅栏门 + 人行道上的一小段墙，门外是延伸出去的街（远景）
function south(ctx, S) {
  const { mats, batch } = ctx;
  const z = WALLS.streetSouth.z, x0 = ZONE.street.x0, gx0 = x0 + 0.8, gx1 = 38.8;
  aabb(ctx, mats.concrete, x0, gx0, 0, 3.0, z - 0.25, z + 0.25, { tile: TILE.conc, r: 0.02, surface: 'concrete' });
  aabb(ctx, mats.concrete, gx1, gx1 + 0.6, 0, 3.0, z - 0.25, z + 0.25, { tile: TILE.conc, r: 0.02, surface: 'concrete' });
  aabb(ctx, S.renderGrey, gx1 + 0.6, 42.0, 0.15, 2.6, z - 0.2, z + 0.2, { tile: TILE.render, surface: 'concrete' });
  for (const x of [x0, gx1]) aabb(ctx, mats.concreteDark, x - 0.05, x + (x === x0 ? 0.85 : 0.65), 3.0, 3.12, z - 0.3, z + 0.3, { tile: TILE.conc });
  // 栅栏门：尖头竖条 + 两道横梁
  const gl = gx1 - gx0, n = Math.round(gl / 0.15);
  for (let i = 0; i < n; i++) {
    const x = gx0 + 0.075 + (i * gl) / n;
    batch.add(S.frame, box(0.06, 2.4, 0.025), xf(x, 1.25, z), { tile: TILE.paint });
    batch.add(S.frame, cyl(0, 0.045, 0.14, 3), xf(x, 2.52, z), { tile: TILE.paint });
  }
  for (const y of [0.35, 2.15]) for (const [a, b] of [[gx0, gx0 + gl / 2], [gx0 + gl / 2, gx1]]) {
    batch.add(S.frame, rb(b - a - 0.04, 0.07, 0.07, 0.008), xf((a + b) / 2, y, z - 0.04), { tile: TILE.paint });
  }
  const mid = gx0 + gl / 2;
  for (const s of [-1, 1]) batch.add(S.frame, rb(0.08, 2.45, 0.08, 0.008), xf(mid + s * 0.05, 1.25, z - 0.04), { tile: TILE.paint });
  for (let i = 0; i < 7; i++) {
    batch.add(mats.steelDark, new THREE.TorusGeometry(0.05, 0.012, 6, 10), xf(mid - 0.18 + i * 0.06, 1.22 - Math.abs(i - 3) * 0.035, z - 0.1, 0, i % 2 ? Math.PI / 2 : 0, 0), G);
  }
  batch.add(mats.steelDark, rb(0.09, 0.11, 0.04, 0.01), xf(mid, 1.02, z - 0.12), G);
  collider(ctx, gx0, gx1, 0, 2.6, z - 0.12, z + 0.12, 'metal', true);
}

export function buildWalls(ctx, S, glow) {
  yardEast(ctx, S);
  courtEast(ctx, S);
  booth(ctx, S, glow);
  north(ctx, S);
  south(ctx, S);
}
