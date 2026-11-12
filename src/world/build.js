import { xf, box, cylBetween, extrude } from '../gfx/geo.js';

// 建筑构件：墙、楼板、楼梯、坡道、栏杆。一次调用同时出几何体（进 batch）和碰撞体（进 phys），
// 门洞、楼梯口按参数挖出来，各分区都用它，门洞才对得上、碰撞才不会漏。
// ctx 就是关卡的 { batch, mats, phys, ... }。

const STEP_RISE = 0.19;

// 墙面矩形（u 方向 u0..u1，竖向 y0..y1）减去洞口后剩下的矩形块：[u0, u1, y0, y1]
function wallPieces(u0, u1, y0, y1, holes) {
  const out = [];
  let cursor = u0;
  for (const h of [...holes].sort((p, q) => p.a - q.a)) {
    const a = Math.max(u0, h.a), b = Math.min(u1, h.b);
    if (b <= a) continue;
    if (a > cursor) out.push([cursor, a, y0, y1]);
    const hy0 = h.y0 ?? y0, hy1 = h.y1 ?? y1;
    if (hy0 > y0) out.push([a, b, y0, hy0]);
    if (hy1 < y1) out.push([a, b, hy1, y1]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < u1) out.push([cursor, u1, y0, y1]);
  return out;
}

// along：'x' 墙沿 X 走（厚度在 Z 上），'z' 墙沿 Z 走。at 是墙中心线的另一个坐标。
// holes: [{ a, b, y0, y1, pane, frame }]，a..b 是洞口沿墙方向的范围；y0 / y1 省略表示通到墙底 / 墙顶。
//   pane：给材质就在洞里装一块玻璃（挡人也挡子弹，surface 'glass'）；frame：给材质就加一圈窗框或门框。
// mat2：给了就把墙分成两层皮，mat 在坐标小的一侧（-Z 或 -X），mat2 在另一侧，用来做外墙皮和内墙面。
function wall(ctx, mat, along, o) {
  const { at, u0, u1, y0 = 0, y1, t = 0.4, holes = [], surface = 'concrete', tile = 3, mat2 = null, collide = true } = o;
  const { batch, phys } = ctx;
  const put = (m, len, h, thick, u, y, off) => {
    if (along === 'x') batch.add(m, box(len, h, thick), xf(u, y, at + off), { tile });
    else batch.add(m, box(thick, h, len), xf(at + off, y, u), { tile });
  };
  for (const [a, b, p, q] of wallPieces(u0, u1, y0, y1, holes)) {
    const len = b - a, h = q - p, u = (a + b) / 2, y = (p + q) / 2;
    if (len < 1e-3 || h < 1e-3) continue;
    if (mat2) { put(mat, len, h, t / 2, u, y, -t / 4); put(mat2, len, h, t / 2, u, y, t / 4); }
    else put(mat, len, h, t, u, y, 0);
    if (!collide) continue;
    if (along === 'x') phys.addBox(u, y, at, len / 2, h / 2, t / 2, 0, surface);
    else phys.addBox(at, y, u, t / 2, h / 2, len / 2, 0, surface);
  }
  for (const h of holes) {
    const hy0 = h.y0 ?? y0, hy1 = h.y1 ?? y1, len = h.b - h.a, u = (h.a + h.b) / 2, y = (hy0 + hy1) / 2, hh = hy1 - hy0;
    if (h.pane) {
      put(h.pane, len, hh, 0.02, u, y, 0);
      if (along === 'x') phys.addBox(u, y, at, len / 2, hh / 2, 0.02, 0, 'glass');
      else phys.addBox(at, y, u, 0.02, hh / 2, len / 2, 0, 'glass');
    }
    if (h.frame) {
      const f = 0.06, d = t + 0.04;
      put(h.frame, len + f * 2, f, d, u, hy1 + f / 2, 0);
      if (hy0 > y0 + 1e-3) put(h.frame, len + f * 2, f, d, u, hy0 - f / 2, 0);
      put(h.frame, f, hh, d, h.a - f / 2, y, 0);
      put(h.frame, f, hh, d, h.b + f / 2, y, 0);
    }
  }
}

// 沿 X 方向的墙：{ z, x0, x1, y0, y1, t, holes, surface, tile, mat2 }
export function wallX(ctx, mat, o) { wall(ctx, mat, 'x', { ...o, at: o.z, u0: o.x0, u1: o.x1 }); }
// 沿 Z 方向的墙：{ x, z0, z1, y0, y1, t, holes, surface, tile, mat2 }
export function wallZ(ctx, mat, o) { wall(ctx, mat, 'z', { ...o, at: o.x, u0: o.z0, u1: o.z1 }); }

// 楼板：顶面在 y，厚 t，holes: [{ x0, x1, z0, z1 }] 是楼梯口。matBottom 给了就在底面再贴一层（天花板）。
export function slab(ctx, mat, { x0, x1, z0, z1, y, t = 0.2, holes = [], surface = 'concrete', tile = 3, matBottom = null }) {
  const { batch, phys } = ctx;
  const cuts = [...new Set([x0, x1, ...holes.flatMap((h) => [h.x0, h.x1])])].filter((v) => v >= x0 && v <= x1).sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1], mid = (a + b) / 2;
    if (b - a < 1e-3) continue;
    const gaps = holes.filter((h) => h.x0 <= mid && h.x1 >= mid).sort((p, q) => p.z0 - q.z0);
    let cursor = z0;
    const piece = (c, d) => {
      if (d - c < 1e-3) return;
      const cx = mid, cz = (c + d) / 2;
      if (matBottom) {
        batch.add(mat, box(b - a, t - 0.03, d - c), xf(cx, y - (t - 0.03) / 2, cz), { tile });
        batch.add(matBottom, box(b - a, 0.03, d - c), xf(cx, y - t + 0.015, cz), { tile });
      } else batch.add(mat, box(b - a, t, d - c), xf(cx, y - t / 2, cz), { tile });
      phys.addBox(cx, y - t / 2, cz, (b - a) / 2, t / 2, (d - c) / 2, 0, surface);
    };
    for (const h of gaps) {
      piece(cursor, Math.max(cursor, h.z0));
      cursor = Math.max(cursor, h.z1);
    }
    piece(cursor, z1);
  }
}

// 直跑楼梯：从脚点 (x, z) 的 y0 起，朝 dir（[dx, dz]，单位向量）上到 y1，水平总长 run，宽 w。
// open：只做踏板（钢梯），否则是实心梯段。返回顶端落脚点 { x, z, y }。
// 物理里没有斜面，楼梯就是一串台阶；每级升高不超过 0.2，玩家和敌人都能直接走上去。
export function stairs(ctx, mat, { x, z, dir = [0, -1], w = 1.4, y0 = 0, y1, run, open = false, surface = 'concrete', tile = 3 }) {
  const { batch, phys } = ctx;
  const n = Math.max(1, Math.ceil((y1 - y0) / STEP_RISE)), rise = (y1 - y0) / n, tread = run / n;
  const m = xf(x, 0, z, 0, Math.atan2(dir[0], dir[1]), 0);
  for (let i = 0; i < n; i++) {
    const top = y0 + (i + 1) * rise, base = open ? top - 0.05 : y0, h = top - base, lz = (i + 0.5) * tread;
    batch.add(mat, box(w, h, tread + (open ? 0.03 : 0)), m.clone().multiply(xf(0, base + h / 2, lz)), { tile });
    phys.solid(m, 0, base + h / 2, lz, w / 2, h / 2, tread / 2, surface);
  }
  if (open) {
    // 两侧斜梁
    for (const s of [-1, 1]) {
      const g = cylBetween(s * (w / 2), y0 + rise - 0.08, 0, s * (w / 2), y1 - 0.08, run, 0.035, 6);
      batch.add(mat, g, m, { tile });
    }
  }
  return { x: x + dir[0] * run, z: z + dir[1] * run, y: y1 };
}

// 坡道：看上去是斜面，碰撞是很矮的小台阶（每级不到 0.1）。参数同 stairs。
export function ramp(ctx, mat, { x, z, dir = [0, -1], w = 2, y0 = 0, y1, run, surface = 'concrete', tile = 3 }) {
  const { batch, phys } = ctx;
  const m = xf(x, 0, z, 0, Math.atan2(dir[0], dir[1]), 0);
  // 三角形截面沿宽度拉伸；extrude 的轮廓在 XY 平面，转 -90° 让轮廓的 X 对上梯段的前进方向
  const wedge = extrude([[0, 0], [run, 0], [run, y1 - y0]], w, 0);
  batch.add(mat, wedge, m.clone().multiply(xf(0, y0, 0, 0, -Math.PI / 2, 0)), { tile });
  const n = Math.max(1, Math.ceil((y1 - y0) / 0.09)), rise = (y1 - y0) / n, tread = run / n;
  for (let i = 0; i < n; i++) {
    const top = y0 + (i + 1) * rise, lz = (i + 0.5) * tread;
    phys.solid(m, 0, (y0 + top) / 2, lz, w / 2, (top - y0) / 2, tread / 2, surface);
  }
  return { x: x + dir[0] * run, z: z + dir[1] * run, y: y1 };
}

// 栏杆：a、b 是两端的 [x, z]，底在 y，高 h。挡人不挡子弹。ya / yb 给了就是斜栏杆（楼梯扶手）。
export function railing(ctx, mat, { a, b, y = 0, h = 1.05, ya = y, yb = y, posts = 1.4, r = 0.022 }) {
  const { batch, phys } = ctx;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-3) return;
  const G = { tile: 1.2 };
  for (const k of [1, 0.5]) batch.add(mat, cylBetween(a[0], ya + h * k, a[1], b[0], yb + h * k, b[1], r * (k === 1 ? 1 : 0.7), 8), null, G);
  const n = Math.max(1, Math.round(len / posts));
  for (let i = 0; i <= n; i++) {
    const t = i / n, px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t, py = ya + (yb - ya) * t;
    batch.add(mat, cylBetween(px, py, pz, px, py + h, pz, r, 8), null, G);
  }
  const lo = Math.min(ya, yb), hi = Math.max(ya, yb) + h;
  const c = phys.addBox((a[0] + b[0]) / 2, (lo + hi) / 2, (a[1] + b[1]) / 2, len / 2, (hi - lo) / 2, 0.04, Math.atan2(-(b[1] - a[1]), b[0] - a[0]), 'metal');
  c.playerOnly = true;
}
