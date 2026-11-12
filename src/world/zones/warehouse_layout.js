import { xf, rbox, cyl } from '../../gfx/geo.js';
import { HALL, BAY, ZN, ZS, P, G, rng } from './warehouse_kit.js';
import { cargo, palletPile } from './warehouse_cargo.js';
import { forklift, palletJack, boxTruck } from './warehouse_vehicles.js';
import { cage, wrapper, firePoint, lockers, bench, panels, ibc } from './warehouse_props.js';
import { cone } from '../props.js';

// 库内摆放：中区集货理货（南北两侧靠墙设备，中间几处货垛做掩体），车辆区停一辆厢式货车。
// 掩体间距和离墙距离都按「要么贴着、要么留够 1.3 米」摆，免得人卡进窄缝。
const Y = HALL.y, B = BAY.y;

// 一垛托盘货：layers 自下而上，每层 { type, hmax }；cells 是并排的托盘中心（托盘 1.2 沿 x、1.0 沿 z）
function stack(ctx, k, rand, cells, y, layers) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = 0;
  for (const [x, z] of cells) {
    let h = 0;
    for (const L of layers) h += cargo(ctx, k, xf(x, y + h, z, 0, (rand() - 0.5) * 0.04, 0), rand, L);
    x0 = Math.min(x0, x - 0.6); x1 = Math.max(x1, x + 0.6); z0 = Math.min(z0, z - 0.5); z1 = Math.max(z1, z + 0.5);
    top = Math.max(top, h);
  }
  ctx.phys.addBox((x0 + x1) / 2, y + top / 2, (z0 + z1) / 2, (x1 - x0) / 2, top / 2, (z1 - z0) / 2, 0, 'wood');
}
function pile(ctx, rand, x, y, z, n) {
  const h = palletPile(ctx, xf(x, y, z, 0, (rand() - 0.5) * 0.1, 0), rand, n);
  ctx.phys.addBox(x, y + h / 2, z, 0.6, h / 2, 0.5, 0, 'wood');
}
function drum(ctx, k, x, y, z, paint) {
  ctx.batch.add(paint, cyl(0.285, 0.285, 0.86, 14), xf(x, y + 0.43, z, 0, x * 7, 0), P);
  ctx.batch.add(ctx.mats.steelIn, cyl(0.292, 0.292, 0.03, 14, true), xf(x, y + 0.29, z), G);
  ctx.batch.add(ctx.mats.steelIn, cyl(0.292, 0.292, 0.03, 14, true), xf(x, y + 0.58, z), G);
  ctx.phys.addCyl(x, z, 0.29, y, y + 0.86, 'metal');
}

export function buildLayout(ctx, k, sw) {
  const rand = rng(1331);
  const C2 = { type: 'carton', hmax: 1.3 }, W2 = { type: 'wrapped', hmax: 1.3 }, C1 = { type: 'carton', hmax: 1.05 };

  // 北墙一侧：更衣柜、缠膜机、打包台、危险品笼
  lockers(ctx, k, -8.75, 4, Y, ZN);
  wrapper(ctx, k, { x: -5.0, y: Y, z: ZN + 1.35, mz: -1.15 }, rand);
  bench(ctx, k, -2.6, -0.6, Y, ZN, rand);
  cage(ctx, k, { x0: 5.2, x1: 11, z0: ZN, z1: -28.5, y: Y, gate: [5.8, 7.2] }, rand);
  for (const [x, z, p] of [[9.6, -28.18, k.rackBlue], [10.2, -28.18, k.rackBlue], [9.9, -27.66, k.red]]) drum(ctx, k, x, Y, z, p);

  // 中区货垛：两处满高（能整个人躲），几处齐腰（蹲着躲）
  stack(ctx, k, rand, [[-11.2, -26.6], [-10.0, -26.6]], Y, [C2, W2]);
  stack(ctx, k, rand, [[-2.6, -27.3], [-1.4, -27.3], [-2.6, -26.3], [-1.4, -26.3]], Y, [C2, { type: null, hmax: 1.3 }]);
  stack(ctx, k, rand, [[2.2, -27.5]], Y, [C1]);
  stack(ctx, k, rand, [[-7.35, -20.95]], Y, [C2, W2]);
  pile(ctx, rand, -11.2, Y, -22.7, 7);
  pile(ctx, rand, -5.0, Y, -22.7, 7);
  pile(ctx, rand, -6.0, Y, -25.0, 7);
  pile(ctx, rand, 10.5, Y, -22.8, 8);
  palletJack(ctx, k, { x: 3.4, y: Y, z: -22.8, yaw: Math.PI / 2, load: 'wrapped', hmax: 1.3 }, rand);
  palletJack(ctx, k, { x: 11.6, y: Y, z: -25.0, yaw: -1.9, handle: 0.05 }, rand);
  forklift(ctx, k, { x: 7.1, y: Y, z: -25.4, yaw: Math.PI / 2, lift: 0.9 }, rand);

  // 南墙一侧：配电柜、消防点、消火栓箱
  panels(ctx, k, 0.15, 3, Y, ZS, -1, 6.4);
  firePoint(ctx, k, sw, -15.9, Y, ZS, -1);
  firePoint(ctx, k, sw, 10.3, Y, ZS, -1);
  ctx.batch.add(k.red, rbox(0.6, 0.7, 0.2, 0.02, 1), xf(3, Y + 1.55, ZS - 0.48), P);
  ctx.batch.add(ctx.mats.glassDark, rbox(0.4, 0.4, 0.01, 0.005, 1), xf(3, Y + 1.6, ZS - 0.585));

  // 车辆区：货车靠东墙车头朝南，吨桶两层挡住逃生门到车辆门的直线，装卸口下码两托货
  boxTruck(ctx, k, { x: 26.15, y: B, z: -26.8, yaw: Math.PI }, rand);
  ibc(ctx, k, 20.9, B, -26.5);
  ibc(ctx, k, 22.1, B, -26.5, Math.PI);
  ibc(ctx, k, 20.9, B + 1.16, -26.5, 0.03);
  ctx.phys.addBox(21.5, B + 0.58, -26.5, 1.2, 0.58, 0.5, 0, 'metal');
  ctx.phys.addBox(20.9, B + 1.74, -26.5, 0.6, 0.58, 0.5, 0, 'metal');
  // 离月台边留 0.18（人挤不进去），不然货会把月台边的防撞胶块吃进去一截
  stack(ctx, k, rand, [[13.78, -25.6], [13.78, -24.4]], B, [{ type: 'carton', hmax: 1.2 }]);
  pile(ctx, rand, 17.6, B, -23.3, 7);
  stack(ctx, k, rand, [[27.82, -20.95], [29.0, -20.95]], B, [{ type: 'drums', hmax: 1.2 }]);
  palletJack(ctx, k, { x: 15.6, y: B, z: -24.6, yaw: -0.5, handle: 0.4 }, rand);
  firePoint(ctx, k, sw, 16.8, B, ZN, 1);
  // props.js 的路锥总是落在 y 0，车辆区面层高 0.04，整体抬一下
  const up = { ...ctx, batch: { add: (m, g, mx, o) => ctx.batch.add(m, g, xf(0, B, 0).multiply(mx), o) } };
  cone(up, { x: 20.2, z: -29.6 });
  cone(up, { x: 23.4, z: -29.9, tip: true, yaw: 2.1 });
}

// 敌人出生点：货架通道里和货车背后，四周各留 1 米以上。按各门口（含门外）往里看的视线逐点测过，
// 只剩货架层间缝里的零星视线。货架南头和南墙之间那条横通道从卸货门里一眼看到底，不放
export const SPAWNS = [
  { x: -26.75, y: Y, z: -27.3 },
  { x: -21.5, y: Y, z: -25.0 },
  { x: -26.75, y: Y, z: -23.8 },
  { x: 28.5, y: B, z: -28.5 },
  { x: 28.5, y: B, z: -24.5 },
];
