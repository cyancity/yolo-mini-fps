import { xf, box, rbox, cylBetween } from '../../gfx/geo.js';
import { distress, STENCIL_FONT } from '../labels.js';
import { HALL, ZN, ZS, P, G, rng, sticker, floorLine, visual } from './warehouse_kit.js';
import { cargo, PALLET_H } from './warehouse_cargo.js';

// 西区高位货架：一排靠墙单排 + 两排背靠背双排，中间三条叉车通道（南北向），两端是横向通道。
// 每排货架整体一个只挡人的碰撞体（人钻不进货位、爬不上去），子弹只被货挡，空货位能打穿。
const Y0 = HALL.y, H = 6.0;
export const RACK = { z0: -30.4, bay: 2.6, bays: 3, levels: [0, 1.6, 3.2, 4.8] };
RACK.z1 = RACK.z0 + RACK.bay * RACK.bays;
// x0..x1 是一排的进深，face 是朝通道的一侧；back 是碰撞体往后延伸到的位置（单排封到墙）
export const UNITS = [
  { x0: -29.2, x1: -28.1, face: 1, back: HALL.x0 },
  { x0: -25.4, x1: -24.3, face: -1 }, { x0: -24.1, x1: -23.0, face: 1 },
  { x0: -20.0, x1: -18.9, face: -1 }, { x0: -18.7, x1: -17.6, face: 1 },
];
export const AISLES = [(UNITS[0].x1 + UNITS[1].x0) / 2, (UNITS[2].x1 + UNITS[3].x0) / 2, (UNITS[4].x1 - 14.6) / 2];

function frameAt(ctx, k, u, z) {
  const { batch } = visual(ctx);
  const xa = u.x0 + 0.04, xb = u.x1 - 0.04;
  for (const x of [xa, xb]) {
    batch.add(k.rackBlue, box(0.08, H, 0.07), xf(x, Y0 + H / 2, z), P);
    batch.add(ctx.mats.steelIn, box(0.14, 0.01, 0.12), xf(x, Y0 + 0.005, z), G);
  }
  batch.add(k.rackBlue, box(xb - xa, 0.04, 0.03), xf((xa + xb) / 2, Y0 + 0.15, z), P);
  batch.add(k.rackBlue, box(xb - xa, 0.04, 0.03), xf((xa + xb) / 2, Y0 + H - 0.1, z), P);
  for (let y = 0.15, i = 0; y < H - 0.6; y += 0.95, i++) {
    const [p, q] = i % 2 ? [xa, xb] : [xb, xa];
    batch.add(k.rackBlue, cylBetween(p, Y0 + y, z, q, Y0 + y + 0.95, z, 0.016, 5), null, P);
  }
  // 朝通道那根立柱的防撞护脚
  const fx = u.face > 0 ? xb : xa;
  batch.add(k.yellow, box(0.16, 0.4, 0.14), xf(fx + u.face * 0.02, Y0 + 0.2, z), P);
}

function unit(ctx, k, u, rand) {
  const { batch, phys } = ctx;
  const zs = Array.from({ length: RACK.bays + 1 }, (_, i) => RACK.z0 + i * RACK.bay);
  for (const z of zs) frameAt(ctx, k, u, z);
  const cx = (u.x0 + u.x1) / 2, depth = u.x1 - u.x0;
  const v = visual(ctx);
  for (let b = 0; b < RACK.bays; b++) {
    const zc = zs[b] + RACK.bay / 2;
    RACK.levels.forEach((lv, li) => {
      if (li > 0) for (const x of [u.x0 + 0.04, u.x1 - 0.04]) v.batch.add(k.rackOrange, box(0.05, 0.12, RACK.bay - 0.08), xf(x, Y0 + lv - 0.06, zc), P);
      const hmax = (RACK.levels[li + 1] ?? H + 0.3) - lv - 0.32;
      let lo = Infinity, hi = -Infinity, top = 0, metal = false;
      for (const s of [-1, 1]) {
        // 越高的层空位越多；最下面一层多是整托
        if (rand() < (li === 0 ? 0.1 : 0.12 + li * 0.06)) continue;
        const z = zc + s * 0.62, type = rand() < 0.15 ? 'drums' : null;
        const h = cargo(ctx, k, xf(cx, Y0 + lv, z, 0, (rand() - 0.5) * 0.04, 0), rand, { type, hmax });
        lo = Math.min(lo, z - 0.5); hi = Math.max(hi, z + 0.5); top = Math.max(top, h);
        if (type) metal = true;
      }
      if (top > 0) phys.addBox(cx, Y0 + lv + top / 2, (lo + hi) / 2, depth / 2 + 0.05, top / 2, (hi - lo) / 2, 0, metal ? 'metal' : 'wood');
    });
  }
  // 整排只挡人：从地面到立柱顶，两头把护栏也包进去
  const x0 = Math.min(u.x0, u.back ?? u.x0), x1 = u.x1;
  phys.addBox((x0 + x1) / 2, Y0 + H / 2, (RACK.z0 + RACK.z1) / 2, (x1 - x0) / 2, H / 2, RACK.bay * RACK.bays / 2 + 0.35, 0, 'metal').playerOnly = true;
  // 通道边的黄线
  const lx = u.face > 0 ? u.x1 + 0.12 : u.x0 - 0.12;
  floorLine(ctx, ctx.sw.yellow, Y0, lx, RACK.z0 - 0.3, lx, RACK.z1 + 0.3, 0.1);
  // 排头的载荷牌
  sticker(ctx, ctx.sw.load, cx, Y0 + 1.6, RACK.z1 + 0.05, 0.36, 0.24);
}

// 双排货架两端的防撞护栏
function endGuards(ctx, k) {
  const { batch } = visual(ctx);
  const groups = [[UNITS[0]], [UNITS[1], UNITS[2]], [UNITS[3], UNITS[4]]];
  for (const g of groups) {
    const x0 = g[0].x0, x1 = g[g.length - 1].x1;
    for (const z of [RACK.z0 - 0.25, RACK.z1 + 0.25]) {
      batch.add(k.yellow, rbox(x1 - x0 + 0.1, 0.12, 0.08, 0.02, 1), xf((x0 + x1) / 2, Y0 + 0.32, z), P);
      for (const x of [x0 + 0.05, x1 - 0.05]) batch.add(k.yellow, box(0.1, 0.4, 0.1), xf(x, Y0 + 0.2, z), P);
    }
  }
}

// 通道号吊牌：挂在屋架下，南北两头各一块
function aisleSigns(ctx, k) {
  const { batch, mats } = visual(ctx);
  AISLES.forEach((x, i) => {
    const rect = ctx.atlas.cached(`wh|aisle${i}`, 256, 160, (c, w, h) => {
      c.fillStyle = '#1d3f6e'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#e8e6df'; c.textAlign = 'center';
      c.font = `700 92px ${STENCIL_FONT}`;
      c.fillText(`A${i + 1}`, w / 2, 96);
      c.font = '600 30px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
      c.fillText(`第 ${i + 1} 通道`, w / 2, 144);
    });
    for (const [z, yaw] of [[RACK.z0 - 0.6, Math.PI], [RACK.z1 + 0.6, 0]]) {
      batch.add(mats.steelIn, box(0.82, 0.52, 0.03), xf(x, 6.9, z), G);
      for (const s of [-1, 1]) batch.add(mats.galvIn, cylBetween(x + s * 0.3, 7.16, z, x + s * 0.3, 7.9, z, 0.006, 4), null, G);
      sticker(ctx, rect, x, 6.9, z + (yaw ? -0.017 : 0.017), 0.78, 0.49, yaw);
    }
  });
}

export function buildRacks(ctx, k) {
  const rand = rng(4242);
  ctx.sw.load = ctx.atlas.cached('wh|load', 256, 170, (c, w, h) => {
    c.fillStyle = '#e6e3d8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#b5241b'; c.fillRect(0, 0, w, 44);
    c.fillStyle = '#fff'; c.textAlign = 'center';
    c.font = '700 30px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
    c.fillText('货架限载', w / 2, 33);
    c.fillStyle = '#16181a';
    c.font = `700 40px ${STENCIL_FONT}`;
    c.fillText('1000 KG / 层', w / 2, 96);
    c.font = '600 24px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
    c.fillText('禁止攀爬 · 叉车慢行', w / 2, 142);
    distress(c, w, h, rand, 0.3);
  });
  for (const u of UNITS) unit(ctx, k, u, rand);
  endGuards(ctx, k);
  aisleSigns(ctx, k);
}
