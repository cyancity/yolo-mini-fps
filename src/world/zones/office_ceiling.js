import { xf, box, cyl, cylBetween } from '../../gfx/geo.js';
import { IN } from './office_layout.js';

// 吊顶：600 方块的矿棉板 + 龙骨，嵌 LED 灯板和送风口；有几块板掉了，露出上面的风管和电线。
// 大堂是平吊顶加筒灯。吊顶有碰撞（子弹打得到），上面的风管只是看的。
const CELL = 0.6;
// 矿棉板一张图一块：UV 原点对齐龙骨网格
const BOARD = { tile: CELL, ou: -IN.x0 / CELL, ov: -IN.z0 / CELL };

// 矩形减去若干小洞，切成不重叠的矩形块
function cut(r, holes) {
  const xs = [...new Set([r.x0, r.x1, ...holes.flatMap((h) => [h.x0, h.x1])])].filter((v) => v >= r.x0 && v <= r.x1).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1], mid = (a + b) / 2;
    if (b - a < 1e-3) continue;
    let z = r.z0;
    for (const h of holes.filter((q) => q.x0 <= mid && q.x1 >= mid && q.z1 > r.z0 && q.z0 < r.z1).sort((p, q) => p.z0 - q.z0)) {
      if (h.z0 > z) out.push([a, b, z, h.z0]);
      z = Math.max(z, h.z1);
    }
    if (z < r.z1) out.push([a, b, z, r.z1]);
  }
  return out;
}

const gx = (i) => IN.x0 + i * CELL, gz = (j) => IN.z0 + j * CELL;
// 亮着的灯板和筒灯：{ x, z, y（吊顶高度）, w（权重） }。室内补光按它算灯板密度表（world/indoor.js），office.js 每次建楼前清空
export const PANELS = [];
// 第 (i, j) 格的范围
export const tileAt = (i, j) => ({ x0: gx(i), x1: gx(i + 1), z0: gz(j), z1: gz(j + 1) });

// rooms：[{ x0, x1, z0, z1, kind: 'grid' | 'plain', panels: [[i, j, state]] }]，state：0 亮，1 关，2 闪
// holes：掉了板的格子 [[i, j]]；ducts：[{ a: [x, z], b: [x, z], r }] 圆风管，[{ box: [x0, x1, z0, z1] }] 方风管
export function buildCeiling(ctx, M, kit, { y, rooms, holes = [], ducts = [], downlights = [] }) {
  const { mats, batch } = ctx;
  const T = 0.02, holeRects = holes.map(([i, j]) => tileAt(i, j));
  for (const r of rooms) {
    const plain = r.kind === 'plain';
    for (const [a, b, c, d] of cut(r, holeRects)) {
      batch.add(plain ? M.ceilingPlain : M.ceiling, box(b - a, T, d - c), xf((a + b) / 2, y + T / 2, (c + d) / 2), plain ? { tile: 3 } : BOARD);
    }
    kit.col((r.x0 + r.x1) / 2, y + 0.03, (r.z0 + r.z1) / 2, (r.x1 - r.x0) / 2, 0.03, (r.z1 - r.z0) / 2, 'concrete');
    if (plain) {
      // 平吊顶：四周一圈凹槽
      kit.box(M.furn, r.x1 - r.x0 - 0.3, 0.008, 0.02, (r.x0 + r.x1) / 2, y - 0.004, r.z0 + 0.15);
      kit.box(M.furn, r.x1 - r.x0 - 0.3, 0.008, 0.02, (r.x0 + r.x1) / 2, y - 0.004, r.z1 - 0.15);
      continue;
    }
    // 龙骨：沿 x 每 0.6 一根，沿 z 每 1.2 一根
    for (let j = Math.ceil((r.z0 - IN.z0) / CELL + 1e-3); gz(j) < r.z1 - 1e-3; j++) kit.box(M.tbar, r.x1 - r.x0, 0.012, 0.024, (r.x0 + r.x1) / 2, y - 0.006, gz(j));
    for (let i = Math.ceil((r.x0 - IN.x0) / (2 * CELL) + 1e-3); gx(2 * i) < r.x1 - 1e-3; i++) kit.box(M.tbar, 0.024, 0.012, r.z1 - r.z0, gx(2 * i), y - 0.006, (r.z0 + r.z1) / 2);
    for (const [i, j, state] of r.panels || []) {
      const t = tileAt(i, j), cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
      if (state !== 1) PANELS.push({ x: cx, z: cz, y, w: 1 });
      kit.box(mats.galvIn, 0.6, 0.01, 0.6, cx, y - 0.005, cz, { tile: 1.2 });
      if (state === 1) batch.add(M.ceiling, box(0.54, 0.01, 0.54), xf(cx, y - 0.008, cz), BOARD);
      else kit.box(state === 2 ? M.panelBad : M.panel, 0.54, 0.01, 0.54, cx, y - 0.008, cz);
    }
  }
  // 掉下来挂在龙骨上的一块板
  for (const [i, j] of holes.slice(0, 1)) {
    const t = tileAt(i, j);
    batch.add(M.ceiling, box(0.59, 0.018, 0.59), xf(t.x0 + 0.02, y - 0.24, (t.z0 + t.z1) / 2, 0, 0, 1.0), BOARD);
  }
  // 洞口里垂下来的线缆
  for (const [i, j] of holes) {
    const t = tileAt(i, j), cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
    batch.add(M.plastic, cylBetween(cx - 0.1, y + 0.3, cz, cx + 0.05, y - 0.35, cz + 0.12, 0.008, 5));
    batch.add(M.plastic, cylBetween(cx + 0.15, y + 0.3, cz - 0.1, cx + 0.12, y - 0.15, cz - 0.05, 0.006, 5));
  }
  // 吊顶上面的风管
  for (const d of ducts) {
    if (d.box) {
      const [x0, x1, z0, z1] = d.box, h = d.h ?? 0.35;
      kit.box(mats.galvIn, x1 - x0, h, z1 - z0, (x0 + x1) / 2, y + 0.12 + h / 2, (z0 + z1) / 2, { tile: 1.2 });
      const along = x1 - x0 > z1 - z0;
      for (let s = along ? x0 : z0; s < (along ? x1 : z1); s += 1.2) {
        if (along) kit.box(mats.galvIn, 0.04, h + 0.02, z1 - z0 + 0.02, s, y + 0.12 + h / 2, (z0 + z1) / 2, { tile: 1.2 });
        else kit.box(mats.galvIn, x1 - x0 + 0.02, h + 0.02, 0.04, (x0 + x1) / 2, y + 0.12 + h / 2, s, { tile: 1.2 });
      }
    } else {
      const r = d.r ?? 0.15, [ax, az] = d.a, [bx, bz] = d.b, yy = y + 0.12 + r;
      batch.add(mats.galvIn, cylBetween(ax, yy, az, bx, yy, bz, r, 14), null, { tile: 1.2 });
      const n = Math.round(Math.hypot(bx - ax, bz - az) / 0.12);
      for (let k = 1; k < n; k++) {
        const t = k / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        batch.add(mats.galvIn, cylBetween(px - (bx - ax) * 0.004, yy, pz - (bz - az) * 0.004, px + (bx - ax) * 0.004, yy, pz + (bz - az) * 0.004, r + 0.008, 14), null, { tile: 1.2 });
      }
    }
  }
  // 筒灯
  for (const [x, z] of downlights) {
    PANELS.push({ x, z, y, w: 0.5 });
    batch.add(mats.steelIn, cyl(0.1, 0.1, 0.012, 18), xf(x, y - 0.006, z), { tile: 1.2 });
    batch.add(M.panel, cyl(0.075, 0.075, 0.01, 18), xf(x, y - 0.012, z));
  }
}

// 某个房间里规则排布的灯板：每 every 格一块，离墙至少 inset
export function panelGrid(r, every = [4, 4], offset = [2, 1], { off = [], bad = [] } = {}) {
  const out = [];
  let n = 0;
  for (let i = Math.ceil((r.x0 - IN.x0) / CELL); gx(i + 1) <= r.x1 + 1e-3; i++) {
    for (let j = Math.ceil((r.z0 - IN.z0) / CELL); gz(j + 1) <= r.z1 + 1e-3; j++) {
      if (i % every[0] !== offset[0] || j % every[1] !== offset[1]) continue;
      if (gx(i) < r.x0 + 0.4 || gx(i + 1) > r.x1 - 0.4 || gz(j) < r.z0 + 0.4 || gz(j + 1) > r.z1 - 0.4) continue;
      out.push([i, j, off.includes(n) ? 1 : bad.includes(n) ? 2 : 0]);
      n++;
    }
  }
  return out;
}

// 世界坐标落在哪一格
export const cellOf = (x, z) => [Math.floor((x - IN.x0) / CELL), Math.floor((z - IN.z0) / CELL)];
