import { xf, box, rbox, cyl, cylBetween } from '../../gfx/geo.js';
import { PORTAL, WALLS, ZONE, Y } from '../plan.js';
import { WH, facadeMats } from '../warehouse.js';
import { HALL, ZN, ZS, ZC, CEIL, TRUSS_X, TRUSS, DADO, floorY, P, G, bandWall, frame, visual } from './warehouse_kit.js';

// 仓库的壳：四道外墙（带洞口和碰撞）、钢柱、檐梁、屋架、檩条、卷帘门的卷筒和导轨、各门洞的门框。
// 屋面板不归这里，屋架和檩条只做到它底下（8.8）。
const span = (p) => ({ a: p.x - p.w / 2, b: p.x + p.w / 2, y0: p.y0, y1: p.y1 });
export const SOUTH_HOLES = [
  ...WH.doors.map((x) => ({ a: x - WH.doorW / 2, b: x + WH.doorW / 2, y0: Y.dock, y1: WH.doorTop })),
  span(PORTAL.exitDoor),
];
export const NORTH_HOLES = [span(PORTAL.officeA), span(PORTAL.officeB), span(PORTAL.overlook), span(PORTAL.bayDoor)];

// 洞口 holes 里有没有挡住 u 处 y0..y1 这一段竖条：返回剩下的竖段
function cutV(u, y0, y1, holes) {
  let segs = [[y0, y1]];
  for (const h of holes) {
    if (u < h.a - 0.05 || u > h.b + 0.05) continue;
    segs = segs.flatMap(([a, b]) => [[a, Math.min(b, h.y0 - 0.08)], [Math.max(a, h.y1 + 0.08), b]]).filter(([a, b]) => b - a > 0.1);
  }
  return segs;
}
// 一条水平线（高 y）避开洞口后的各段
function cutH(u0, u1, y, holes) {
  const out = [];
  let c = u0;
  for (const h of [...holes].sort((p, q) => p.a - q.a)) {
    if (y < h.y0 - 0.1 || y > h.y1 + 0.1) continue;
    if (h.a - 0.1 > c) out.push([c, h.a - 0.1]);
    c = Math.max(c, h.b + 0.1);
  }
  if (u1 > c) out.push([c, u1]);
  return out;
}

function walls(ctx, k, F) {
  const { mats } = ctx;
  const lo = (neg, pos, surface = 'concrete') => ({ y0: 0, y1: DADO, neg, pos, surface, tile: 3 });
  const hi = (neg, pos, y0 = DADO, y1 = CEIL, surface = 'metal') => ({ y0, y1, neg, pos, surface, tile: 5.2 });
  // 南墙：-Z 是库内
  bandWall(ctx, 'x', { at: WALLS.whSouth.z, u0: -30, u1: 30, holes: SOUTH_HOLES, bands: [lo(mats.concreteIn, F.clad), hi(k.liner, F.clad)] });
  // 北墙：+Z 是库内；x < 8.4 那段的北面是办公楼室内，屋面（7.85）以上才露天
  const cx = ZONE.court.x0;
  bandWall(ctx, 'x', { at: WALLS.whNorth.z, u0: -30, u1: cx, holes: NORTH_HOLES, bands: [
    lo(mats.concreteIn, mats.concreteIn), hi(mats.concreteIn, k.liner, DADO, 7.85, 'concrete'), hi(mats.concrete, k.liner, 7.85, CEIL),
  ] });
  bandWall(ctx, 'x', { at: WALLS.whNorth.z, u0: cx, u1: 30, holes: NORTH_HOLES, bands: [lo(F.clad, mats.concreteIn), hi(F.clad, k.liner)] });
  // 东西山墙夹在南北墙之间
  bandWall(ctx, 'z', { at: WALLS.whWest.x, u0: ZN, u1: ZS, bands: [lo(F.clad, mats.concreteIn), hi(F.clad, k.liner)] });
  bandWall(ctx, 'z', { at: WALLS.whEast.x, u0: ZN, u1: ZS, bands: [lo(mats.concreteIn, F.clad), hi(k.liner, F.clad)] });
}

// 内墙面：护墙板压顶角钢、压型板竖缝、两道墙檩
function lining(ctx, k) {
  const v = visual(ctx), { batch, mats } = v;
  const faces = [
    { along: 'x', at: ZS, n: -1, u0: HALL.x0, u1: ZONE.warehouse.x1, holes: SOUTH_HOLES },
    { along: 'x', at: ZN, n: 1, u0: HALL.x0, u1: ZONE.warehouse.x1, holes: NORTH_HOLES },
    { along: 'z', at: HALL.x0, n: 1, u0: ZN, u1: ZS, holes: [] },
    { along: 'z', at: ZONE.warehouse.x1, n: -1, u0: ZN, u1: ZS, holes: [] },
  ];
  const put = (f, mat, u, y, lu, h, d) => {
    const off = f.at + f.n * d / 2;
    if (f.along === 'x') batch.add(mat, box(lu, h, d), xf(u, y, off), G);
    else batch.add(mat, box(d, h, lu), xf(off, y, u), G);
  };
  for (const f of faces) {
    for (const [a, b] of cutH(f.u0, f.u1, DADO, f.holes)) put(f, mats.galvIn, (a + b) / 2, DADO + 0.02, b - a, 0.05, 0.06);
    for (const y of [5.2, 7.3]) for (const [a, b] of cutH(f.u0, f.u1, y, f.holes)) put(f, mats.steelIn, (a + b) / 2, y, b - a, 0.16, 0.09);
    for (let u = f.u0 + 1; u < f.u1 - 0.3; u += 1) {
      for (const [y0, y1] of cutV(u, DADO + 0.05, CEIL, f.holes)) put(f, mats.steelIn, u, (y0 + y1) / 2, 0.025, y1 - y0, 0.016);
    }
  }
}

// 钢柱（H 型钢 + 底部黄色护套）、檐梁、山墙抗风柱
function columns(ctx, k) {
  const { batch, mats, phys } = ctx;
  const top = TRUSS.y0 - 0.3;
  const col = (x, z, n, alongX) => {
    const y0 = floorY(x), h = top - y0, cy = y0 + h / 2;
    // n：柱子从墙面往库内伸的方向；alongX：翼缘沿 x（南北墙上）还是沿 z（山墙上）
    const at = (a, d) => (alongX ? xf(x + a, cy, z + n * d) : xf(x + n * d, cy, z + a));
    const fl = (d) => batch.add(mats.steelIn, alongX ? box(0.3, h, 0.022) : box(0.022, h, 0.3), at(0, d), G);
    fl(0.011); fl(0.289);
    batch.add(mats.steelIn, alongX ? box(0.012, h, 0.26) : box(0.26, h, 0.012), at(0, 0.15), G);
    batch.add(mats.steelIn, box(0.42, 0.025, 0.42), alongX ? xf(x, y0 + 0.012, z + n * 0.15) : xf(x + n * 0.15, y0 + 0.012, z), G);
    batch.add(k.yellow, rbox(alongX ? 0.4 : 0.38, 1.0, alongX ? 0.38 : 0.4, 0.03, 1), alongX ? xf(x, y0 + 0.5, z + n * 0.17) : xf(x + n * 0.17, y0 + 0.5, z), P);
    if (alongX) phys.addBox(x, cy, z + n * 0.18, 0.2, h / 2, 0.18, 0, 'metal');
    else phys.addBox(x + n * 0.18, cy, z, 0.18, h / 2, 0.2, 0, 'metal');
  };
  // 柱子只落在墙下面是实墙的地方，屋架在门洞上方就搁在檐梁上
  const solidAt = (x, holes) => !holes.some((h) => x > h.a - 0.4 && x < h.b + 0.4);
  for (const x of TRUSS_X) {
    if (solidAt(x, SOUTH_HOLES)) col(x, ZS, -1, true);
    if (solidAt(x, NORTH_HOLES)) col(x, ZN, 1, true);
  }
  col(HALL.x0, ZC, 1, false);
  col(ZONE.warehouse.x1, ZC, -1, false);
  for (const [z, n] of [[ZS, -1], [ZN, 1]]) {
    batch.add(mats.steelIn, box(ZONE.warehouse.x1 - HALL.x0, 0.3, 0.16), xf(0, top + 0.15, z + n * 0.08), G);
  }
}

// 平行弦屋架（普拉特式）+ 檩条 + 端跨的屋面交叉拉杆
function roofSteel(ctx, k) {
  const { batch, mats } = visual(ctx);
  const z0 = ZN + 0.05, z1 = ZS - 0.05, L = z1 - z0, n = 8;
  const yb = TRUSS.y0 + 0.05, yt = TRUSS.y1 - 0.05;
  for (const x of TRUSS_X) {
    batch.add(mats.steelIn, box(0.12, 0.1, L), xf(x, yb, (z0 + z1) / 2), G);
    batch.add(mats.steelIn, box(0.12, 0.1, L), xf(x, yt, (z0 + z1) / 2), G);
    for (let i = 0; i <= n; i++) {
      const z = z0 + (L * i) / n;
      batch.add(mats.steelIn, box(0.07, yt - yb, 0.07), xf(x, (yb + yt) / 2, z), G);
      if (i === n) break;
      const zn = z0 + (L * (i + 1)) / n, down = i < n / 2;
      batch.add(mats.steelIn, cylBetween(x, down ? yt : yb, z, x, down ? yb : yt, zn, 0.03, 6), null, G);
    }
    for (const z of [z0, z1]) batch.add(mats.steelIn, box(0.2, 0.02, 0.3), xf(x, TRUSS.y0, z + (z === z0 ? 0.1 : -0.1)), G);
  }
  const x0 = HALL.x0, x1 = ZONE.warehouse.x1;
  for (let i = 0; i < 8; i++) {
    const z = ZN + 0.75 + i * 1.5;
    batch.add(mats.galvIn, box(x1 - x0, 0.13, 0.06), xf((x0 + x1) / 2, CEIL - 0.065, z), G);
    batch.add(mats.galvIn, box(x1 - x0, 0.02, 0.1), xf((x0 + x1) / 2, CEIL - 0.13, z + 0.02), G);
  }
  for (const [a, b] of [[TRUSS_X[0], TRUSS_X[1]], [TRUSS_X[8], TRUSS_X[9]]]) {
    batch.add(mats.galvIn, cylBetween(a, CEIL - 0.16, z0, b, CEIL - 0.16, z1, 0.012, 5), null, G);
    batch.add(mats.galvIn, cylBetween(a, CEIL - 0.16, z1, b, CEIL - 0.16, z0, 0.012, 5), null, G);
  }
}

// 卷帘门的卷筒罩、电机箱、库内侧导轨；车辆门同理（北墙）
function rollerHood(ctx, k, x, w, top, z, n) {
  const { batch, mats } = visual(ctx);
  batch.add(k.liner, cyl(0.34, 0.34, w + 0.3, 20), xf(x, top + 0.42, z + n * 0.4, 0, 0, Math.PI / 2), P);
  for (const s of [-1, 1]) {
    batch.add(mats.steelIn, box(0.03, 0.82, 0.82), xf(x + s * (w / 2 + 0.17), top + 0.42, z + n * 0.4), G);
    batch.add(mats.steelIn, box(0.09, top - floorY(x), 0.1), xf(x + s * (w / 2 + 0.05), (top + floorY(x)) / 2, z + n * 0.05), G);
  }
  batch.add(mats.steelIn, rbox(0.3, 0.36, 0.3, 0.02), xf(x + w / 2 + 0.36, top + 0.3, z + n * 0.4), G);
  batch.add(mats.plasticBlack, rbox(0.26, 0.4, 0.12, 0.015), xf(x + w / 2 + 0.45, 1.6 + floorY(x) - 0.04, z + n * 0.06));
  batch.add(mats.emissive(0x2bff6a, 6), box(0.03, 0.03, 0.01), xf(x + w / 2 + 0.4, 1.7 + floorY(x), z + n * 0.125));
  batch.add(mats.emissive(0xff3018, 6), box(0.03, 0.03, 0.01), xf(x + w / 2 + 0.5, 1.7 + floorY(x), z + n * 0.125));
}

function doors(ctx, k, F) {
  const { batch, mats, phys } = ctx;
  for (const x of WH.doors) rollerHood(ctx, k, x, WH.doorW, WH.doorTop, ZS, -1);
  const bd = PORTAL.bayDoor;
  rollerHood(ctx, k, bd.x, bd.w, bd.y1, ZN, 1);
  // 车辆门：升到顶的帘片只露底梁；两边黄色防撞柱
  batch.add(mats.steelIn, rbox(bd.w, 0.1, 0.14, 0.01), xf(bd.x, bd.y1 - 0.05, WALLS.whNorth.z), G);
  frame(ctx, F.trim, 'x', WALLS.whNorth.z, bd.x - bd.w / 2, bd.x + bd.w / 2, 0, bd.y1, { w: 0.12, d: 0.5 });
  for (const s of [-1, 1]) {
    const px = bd.x + s * (bd.w / 2 + 0.35);
    batch.add(k.yellow, cyl(0.11, 0.11, 1.2, 16), xf(px, 0.64, ZN + 0.35), P);
    batch.add(mats.black, cyl(0.112, 0.112, 0.1, 16), xf(px, 0.9, ZN + 0.35));
    phys.addCyl(px, ZN + 0.35, 0.12, 0, 1.24, 'metal');
  }
  // 逃生门：库内侧门框和出口灯
  const ex = PORTAL.exitDoor;
  frame(ctx, mats.steelIn, 'x', WALLS.whSouth.z, ex.x - ex.w / 2, ex.x + ex.w / 2, 0.04, ex.y1, { w: 0.06, d: 0.36 });
  batch.add(mats.plasticBlack, rbox(0.42, 0.17, 0.07, 0.01), xf(ex.x, ex.y1 + 0.35, ZS - 0.04));
  batch.add(mats.emissive(0x36ff7c, 5), box(0.38, 0.13, 0.01), xf(ex.x, ex.y1 + 0.35, ZS - 0.08));
  // 去办公楼的两道门：钢门框，防火门扇打开贴在库内侧墙上
  const leafs = (p, n) => {
    frame(ctx, mats.steelIn, 'x', WALLS.whNorth.z, p.x - p.w / 2, p.x + p.w / 2, p.y0, p.y1, { w: 0.07, d: 0.46 });
    const lw = p.w / n - 0.03, lh = p.y1 - p.y0 - 0.04;
    const sides = n === 2 ? [-1, 1] : [1];
    for (const s of sides) {
      const lx = p.x + s * (p.w / 2 + 0.09 + lw / 2);
      batch.add(k.liner, rbox(lw, lh, 0.05, 0.008), xf(lx, p.y0 + lh / 2 + 0.01, ZN + 0.035), P);
      batch.add(mats.glassDark, box(0.22, 0.7, 0.01), xf(lx, p.y0 + 1.45, ZN + 0.062));
      batch.add(mats.steelIn, box(lw - 0.04, 0.25, 0.006), xf(lx, p.y0 + 0.15, ZN + 0.062), G);
    }
    batch.add(mats.plasticBlack, rbox(0.42, 0.17, 0.07, 0.01), xf(p.x, p.y1 + 0.3, ZN + 0.04));
    batch.add(mats.emissive(0x36ff7c, 5), box(0.38, 0.13, 0.01), xf(p.x, p.y1 + 0.3, ZN + 0.08));
  };
  leafs(PORTAL.officeA, 2);
  leafs(PORTAL.officeB, 1);
  // 观察窗：只有窗框和窗台，不装玻璃
  const ov = PORTAL.overlook;
  frame(ctx, mats.steelIn, 'x', WALLS.whNorth.z, ov.x - ov.w / 2, ov.x + ov.w / 2, ov.y0, ov.y1, { w: 0.08, d: 0.5, sill: true });
  for (let i = 1; i < 3; i++) batch.add(mats.steelIn, box(0.06, ov.y1 - ov.y0, 0.08), xf(ov.x - ov.w / 2 + (ov.w * i) / 3, (ov.y0 + ov.y1) / 2, WALLS.whNorth.z), G);
  // 只挡人不挡子弹：蹲跳能翻上窗台，从 4.4 米高跳进库里，帧率低于 45 时会穿过地面卡在楼板下
  phys.addBox(ov.x, (ov.y0 + ov.y1) / 2, WALLS.whNorth.z, ov.w / 2, (ov.y1 - ov.y0) / 2, 0.12, 0, 'metal').playerOnly = true;
}

export function buildShell(ctx, k) {
  const F = facadeMats(ctx.mats);
  walls(ctx, k, F);
  lining(ctx, k);
  columns(ctx, k);
  roofSteel(ctx, k);
  doors(ctx, k, F);
}
