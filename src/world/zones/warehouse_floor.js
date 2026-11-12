import { xf, box, rbox, cylBetween } from '../../gfx/geo.js';
import { slab, stairs, ramp, railing } from '../build.js';
import { PORTAL, WALLS } from '../plan.js';
import { WH } from '../warehouse.js';
import { HALL, BAY, ZN, ZS, ZC, G, rng, sticker, floorSticker, floorLine, keepClear, visual } from './warehouse_kit.js';

// 地面：库区实心月台（顶 1.1）、车辆区薄面层（顶 0.04），两者之间沿 x = 13 有楼梯、装卸口和坡道。
// 南北向从北到南：坡道 | 栏杆 | 装卸口（不设栏杆，能跳下去）| 栏杆 | 楼梯（贴南墙）
const EDGE = HALL.x1;
export const RAMP = { z: -29.5, w: 2.4, run: 5.3 };
export const STAIR = { z0: -22.2, z1: ZS, run: 1.8 };
export const GAP = { z0: -26.2, z1: -23.8 }; // 装卸口
const rz0 = RAMP.z - RAMP.w / 2, rz1 = RAMP.z + RAMP.w / 2;

function slabs(ctx, k) {
  const { mats } = ctx;
  slab(ctx, k.floor, { x0: HALL.x0, x1: HALL.x1, z0: ZN, z1: ZS, y: HALL.y, t: HALL.y });
  slab(ctx, mats.concreteInDark, { x0: BAY.x0, x1: BAY.x1, z0: ZN, z1: ZS, y: BAY.y, t: BAY.y });
  // 逃生门和车辆门的门槛钢板（墙厚那一段露着沥青）
  const v = visual(ctx), ex = PORTAL.exitDoor, bd = PORTAL.bayDoor;
  v.batch.add(mats.steelDark, box(ex.w, 0.03, 0.42), xf(ex.x, 0.015, WALLS.whSouth.z), G);
  v.batch.add(mats.steelDark, box(bd.w, 0.03, 0.42), xf(bd.x, 0.015, WALLS.whNorth.z), G);
}

function levels(ctx, k, sw) {
  const { mats, batch } = ctx;
  // 楼梯：贴南墙，从车辆区往西上到库区
  const sw2 = STAIR.z1 - STAIR.z0, sz = (STAIR.z0 + STAIR.z1) / 2, foot = EDGE + STAIR.run;
  stairs(ctx, mats.concreteIn, { x: foot, z: sz, dir: [-1, 0], w: sw2, y0: BAY.y, y1: HALL.y, run: STAIR.run });
  const n = Math.ceil((HALL.y - BAY.y) / 0.19), rise = (HALL.y - BAY.y) / n, tread = STAIR.run / n;
  for (let i = 0; i < n; i++) batch.add(k.yellow, box(0.05, 0.012, sw2 - 0.04), xf(foot - i * tread - 0.025, BAY.y + (i + 1) * rise + 0.004, sz), G);
  railing(ctx, k.yellow, { a: [foot, STAIR.z0 + 0.05], b: [EDGE, STAIR.z0 + 0.05], ya: BAY.y, yb: HALL.y, posts: 1.0 });
  // 墙上的扶手
  const v = visual(ctx);
  v.batch.add(mats.galvIn, cylBetween(foot + 0.3, BAY.y + 0.9, ZS - 0.07, EDGE - 0.6, HALL.y + 0.9, ZS - 0.07, 0.022, 8), null, G);
  for (const t of [0.1, 0.9]) {
    const x = foot + 0.3 + (EDGE - 0.6 - foot - 0.3) * t, y = BAY.y + 0.9 + (HALL.y - BAY.y) * t;
    v.batch.add(mats.galvIn, cylBetween(x, y, ZS - 0.07, x, y, ZS, 0.012, 6), null, G);
  }

  // 坡道：叉车和推车走的，坡度约 1:5，两侧栏杆，边上黄黑警示
  const rx = EDGE + RAMP.run;
  ramp(ctx, mats.concreteIn, { x: rx, z: RAMP.z, dir: [-1, 0], w: RAMP.w, y0: BAY.y, y1: HALL.y, run: RAMP.run });
  for (const z of [rz0 + 0.06, rz1 - 0.06]) railing(ctx, k.yellow, { a: [rx - 0.1, z], b: [EDGE, z], ya: BAY.y, yb: HALL.y, posts: 1.3 });
  for (const z of [rz0, rz1]) {
    const L = Math.hypot(RAMP.run, HALL.y - BAY.y), ang = Math.atan2(HALL.y - BAY.y, RAMP.run);
    v.batch.add(mats.steelIn, box(L, 0.05, 0.06), xf(rx - RAMP.run / 2, (BAY.y + HALL.y) / 2 + 0.02, z, 0, 0, -ang), G);
  }

  // 月台边：角钢护边、侧面黄黑漆、栏杆（装卸口除外）、装卸口的防撞胶块
  v.batch.add(mats.galvIn, box(0.08, 0.08, ZS - ZN), xf(EDGE - 0.04, HALL.y - 0.04, ZC), G);
  for (const [a, b] of [[ZN, rz0], [rz1, STAIR.z0]]) {
    for (let z = a; z < b - 0.05; z += 1.2) {
      const len = Math.min(1.2, b - z);
      sticker(ctx, [sw.hazard[0], sw.hazard[1], sw.hazard[0] + (sw.hazard[2] - sw.hazard[0]) * len / 1.2, sw.hazard[3]], EDGE + 0.003, HALL.y - 0.15, z + len / 2, len, 0.15, Math.PI / 2);
    }
  }
  for (const [a, b] of [[ZN + 0.05, rz0], [rz1, GAP.z0], [GAP.z1, STAIR.z0]]) railing(ctx, k.yellow, { a: [EDGE - 0.08, a], b: [EDGE - 0.08, b], y: HALL.y });
  for (const z of [GAP.z0 + 0.5, GAP.z1 - 0.5]) {
    batch.add(mats.rubber, rbox(0.12, 0.5, 0.3, 0.02), xf(EDGE + 0.06, HALL.y - 0.4, z));
  }
  for (let z = GAP.z0; z < GAP.z1 - 0.05; z += 1.2) floorSticker(ctx, sw.hazard, EDGE - 0.12, HALL.y, z + 0.6, 1.2, 0.15, Math.PI / 2);
}

function markings(ctx, sw) {
  const y = HALL.y, by = BAY.y;
  // 地坪切缝
  for (let x = -24; x < EDGE; x += 6) floorLine(ctx, sw.dark, y, x, ZN, x, ZS, 0.012);
  floorLine(ctx, sw.dark, y, HALL.x0, ZC, EDGE, ZC, 0.012);
  for (let x = 19; x < BAY.x1; x += 6) floorLine(ctx, sw.dark, by, x, ZN, x, ZS, 0.012);
  // 卸货门内侧的调节板，两侧黄黑边
  for (const x of WH.doors) {
    const v = visual(ctx);
    v.batch.add(ctx.mats.galvIn, box(2.2, 0.012, 2.4), xf(x, y + 0.006, ZS - 1.2), G);
    for (const s of [-1, 1]) for (const z of [ZS - 0.6, ZS - 1.8]) floorSticker(ctx, sw.hazard, x + s * 1.18, y + 0.008, z, 1.2, 0.15, Math.PI / 2);
  }
  // 禁停区：门口、楼梯口、装卸口下面
  const oa = PORTAL.officeA, ob = PORTAL.officeB, bd = PORTAL.bayDoor, ex = PORTAL.exitDoor;
  keepClear(ctx, sw, y, oa.x - 1.2, oa.x + 1.2, ZN, ZN + 1.2);
  keepClear(ctx, sw, y, ob.x - 1.2, ob.x + 1.2, ZN, ZN + 1.2);
  keepClear(ctx, sw, by, bd.x - bd.w / 2, bd.x + bd.w / 2, ZN, ZN + 2.4);
  keepClear(ctx, sw, by, ex.x - 1.2, ex.x + 1.2, ZS - 1.2, ZS);
  keepClear(ctx, sw, by, EDGE + STAIR.run, EDGE + STAIR.run + 1.2, STAIR.z0, STAIR.z1);
  // 库区主通道：两道黄线，东西向贯穿中区
  for (const z of [-24.0, -29.0]) floorLine(ctx, sw.yellow, y, -14.4, z, EDGE - 0.4, z);
  // 车辆区：车位框和进出方向
  for (const [ax, az, bx, bz] of [[24.4, -31.6, 24.4, -22.4], [28.0, -31.6, 28.0, -22.4], [24.4, -22.4, 28.0, -22.4]]) floorLine(ctx, sw.white, by, ax, az, bx, bz, 0.12);
}

// 油渍和轮胎印：叉车常走的地方、卸货门口、车辆区进出的车辙
function grime(ctx) {
  const rand = rng(77);
  const stain = ctx.atlas.cached('wh|stain', 256, 256, (c) => {
    for (let i = 0; i < 16; i++) {
      const r = 18 + rand() * 60, x = 128 + (rand() - 0.5) * 120, y = 128 + (rand() - 0.5) * 120;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(14,11,8,0.32)'); g.addColorStop(1, 'rgba(14,11,8,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 6.3); c.fill();
    }
  });
  const tyre = ctx.atlas.cached('wh|tyre', 128, 16, (c, w, h) => {
    for (let x = 0; x < w; x += 2) { c.fillStyle = `rgba(10,10,10,${0.12 + rand() * 0.16})`; c.fillRect(x, 2, 2, h - 4); }
  });
  const spots = [[-2, -23.4, 2.2], [6, -23.6, 2.4], [-10, -23.2, 1.6], [7.8, -26.8, 2.6], [3.6, -25.5, 1.8], [-6.5, -27.5, 1.5],
    [11.5, -24.8, 1.4], [-16.1, -26, 1.8], [-21.5, -27.5, 1.6], [16.5, -27, 2.2], [21.6, -24.5, 2.0], [26, -22, 2.4], [26.2, -30.4, 1.8], [19.5, -21.5, 1.6]];
  for (const [x, z, s] of spots) floorSticker(ctx, stain, x, x < EDGE ? HALL.y : BAY.y, z, s, s * (0.7 + rand() * 0.5), rand() * 6.28);
  // 车辙：从车辆门进来拐向车位
  for (const dx of [-0.9, 0.9]) {
    floorLine(ctx, tyre, BAY.y + 0.002, 22 + dx, ZN + 0.5, 22.6 + dx, -27.5, 0.24);
    floorLine(ctx, tyre, BAY.y + 0.002, 22.6 + dx, -27.5, 25.6 + dx * 0.6, -23.2, 0.24);
  }
  for (const dz of [-0.45, 0.45]) floorLine(ctx, tyre, HALL.y + 0.002, -13, -25.0 + dz, 11, -25.0 + dz, 0.18);
}

export function buildFloor(ctx, k, sw) {
  slabs(ctx, k);
  levels(ctx, k, sw);
  markings(ctx, sw);
  grime(ctx);
}
