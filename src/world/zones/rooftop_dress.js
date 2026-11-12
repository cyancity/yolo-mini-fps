import * as THREE from 'three';
import { xf, box, rbox, cyl, cylBetween } from '../../gfx/geo.js';
import { Y } from '../plan.js';
import { tarpCargo, palletStack } from '../props.js';
import * as K from './rooftop_kit.js';

// 两块屋面上的设备和杂物。坐标都按 plan.js 的总平面摆：
// 仓库屋面 x -29.7..29.7、z -32.6..-20.3（标高 9.0），办公楼屋面 x -29.75..8.15、z -47.75..-32.9（8.1）
const G = { tile: 1.2 }, P = { tile: 5.2 }, C = { tile: 3 };

export function dressWarehouseRoof(ctx, M) {
  const { batch, mats } = ctx;
  const y = Y.whRoof;
  // 设备：两排屋顶机组错开摆，把东西 60 m 的长视线切断
  K.rtu(ctx, M, { x: -15, y, z: -29.0, tag: '01' });
  K.rtu(ctx, M, { x: -4, y, z: -29.2, w: 3.6, d: 1.8, h: 1.9, tag: '02' });
  K.rtu(ctx, M, { x: 8, y, z: -29.0, tag: '03' });
  K.rtu(ctx, M, { x: 20.5, y, z: -23.4, yaw: Math.PI, w: 3.0, h: 1.7, tag: '04' });
  K.panelTank(ctx, { x: -26.4, y, z: -29.4, w: 3, d: 2, h: 2 });
  K.mast(ctx, M, { x: 24.5, y, z: -29.8, h: 11, guys: [[21.4, -30.6], [27.6, -31.2], [24.8, -26.6]] });
  K.dish(ctx, M, { x: -27.6, y, z: -22.4, r: 0.65, elev: 0.75 });
  K.dish(ctx, M, { x: 28.0, y, z: -22.3, r: 0.5, elev: 0.6, yaw: -0.4 });
  K.rtu(ctx, M, { x: 5.5, y, z: -24.9, w: 2.2, d: 1.6, h: 1.8, tag: '07' });
  K.coolingTower(ctx, M, { x: -18.5, y, z: -25.4, tag: '1' });
  K.cabinets(ctx, M, { x: -25.0, y, z: -21.9 });
  K.cabinets(ctx, M, { x: -9.8, y, z: -30.9, yaw: Math.PI });
  K.cabinets(ctx, M, { x: 16.5, y, z: -30.7, n: 3, yaw: Math.PI });
  for (const [x, z] of [[-22.4, -29.0], [-10.6, -25.8], [2.0, -25.9], [16.2, -26.0], [26.6, -25.8]]) K.exhaustFan(ctx, { x, y, z });
  for (const x of [-22.5, -14.5, 9.0, 15.5]) K.skylight(ctx, M, { x, y, z: -23.6 });
  for (const x of [-8.5, 0.5]) K.skylight(ctx, M, { x, y, z: -26.8, s: 1.1 });
  K.hatch(ctx, M, { x: 1.6, y, z: -30.5 });
  K.hatch(ctx, M, { x: 27.6, y, z: -28.2, yaw: Math.PI / 2 });
  // 风管：RTU-01 出来往东拐进屋面，腰高，能蹲着躲
  K.duct(ctx, { a: [-13.3, -28.5], b: [-9.6, -28.5], y });
  K.duct(ctx, { a: [6.3, -28.4], b: [3.0, -28.4], y, w: 0.6, h: 0.5 });
  for (const [x, z] of [[-9.4, -28.5], [2.8, -28.4]]) batch.add(mats.galv, box(0.9, 0.3, 0.9), xf(x, y + 0.15, z), G);
  // 桥架沿北边走，管廊沿屋面中线走；都矮到能跨过去
  K.cableTray(ctx, { a: [-24, -31.7], b: [22.6, -31.7], y });
  K.pipeRun(ctx, M, { a: [3.8, -26.9], b: [23.2, -26.9], y });
  K.pipeRun(ctx, M, { a: [-24.4, -27.4], b: [-12.0, -27.4], y });
  // 检修走道上的橡胶垫：屋面中线东西一条，接消防梯口和台阶口
  // 碰到设备的地方让开
  const keep = [[-19.9, -17.1, -26.8, -24.0], [4.0, 7.0, -25.9, -23.9], [-12.6, -10.6, -23.5, -22.1]];
  const pad = (x, z) => {
    if (keep.some(([a, b, c, d]) => x > a && x < b && z > c && z < d)) return;
    batch.add(mats.rubber, box(0.58, 0.02, 0.58), xf(x, y + 0.01, z));
  };
  for (let x = -24; x <= 23; x += 0.64) pad(x, -25.0);
  for (let z = -32.3; z < -25.3; z += 0.64) { pad(12.7, z); if (z < -27.2) pad(-19.5, z); }
  // 招牌后面这条夹在采光罩和斜撑脚板之间，两边各留几厘米
  for (let x = -16.9; x < 3.8; x += 0.64) pad(x, -22.55);
  // 雨水斗和周围的积水
  const water = M.water;
  for (const [x, z, rx, rz] of [[-6.2, -27.2, 1.5, 0.8], [18.2, -28.1, 1.2, 0.7], [-25.2, -24.4, 0.8, 1.0], [11.0, -25.6, 0.9, 0.5]]) {
    // 两个错开的椭圆叠成不规则的一摊
    for (const [ox, oz, k] of [[0, 0, 1], [rx * 0.45, rz * 0.35, 0.6]]) {
      const g = new THREE.CircleGeometry(1, 20);
      g.rotateX(-Math.PI / 2);
      batch.add(water, g, xf(x + ox, y + 0.008 + k * 0.001, z + oz, 0, x * 0.7 + k, 0, rx * k, 1, rz * k), { tile: 4 });
    }
    batch.add(mats.steelDark, cyl(0.16, 0.18, 0.06, 12), xf(x + rx * 0.3, y + 0.03, z));
  }
  // 屋面上零散的东西：废弃的木托盘、一卷卷材、几块压重混凝土块
  palletStack(ctx, { x: -11.5, y, z: -22.8, n: 2, yaw: 0.3 });
  tarpCargo(ctx, { x: 12.6, y, z: -21.8, yaw: -0.1, w: 1.8, h: 1.0, d: 1.2 });
  batch.add(mats.black, cyl(0.16, 0.16, 1.0, 14), xf(15.3, y + 0.16, -21.4, 0, 0.4, Math.PI / 2));
  for (const [x, z] of [[17.8, -30.2], [18.3, -30.3], [-1.0, -30.8]]) batch.add(mats.concrete, rbox(0.4, 0.1, 0.4, 0.01, 1), xf(x, y + 0.05, z, 0, x, 0), C);
}

export function dressOfficeRoof(ctx, M) {
  const { batch, mats, phys } = ctx;
  const y = Y.officeRoof;
  // 沿北墙一排空调外机，钢架靠着女儿墙，不留缝
  batch.add(mats.steelDark, box(8.4, 0.08, 0.9), xf(-13, y + 0.2, -47.3), G);
  for (let i = 0; i < 8; i++) {
    K.condenser(ctx, M, { x: -16.7 + i * 1.06, y: y + 0.24, z: -47.25, yaw: 0 });
    batch.add(mats.steelDark, box(0.06, 0.24, 0.9), xf(-17.1 + i * 1.06, y + 0.12, -47.3), G);
  }
  phys.addBox(-13, y + 0.5, -47.25, 4.25, 0.5, 0.5, 0, 'metal');
  // 西墙下一组外机
  for (let i = 0; i < 3; i++) K.condenser(ctx, M, { x: -29.3, y: y + 0.1, z: -38.6 + i * 1.06, yaw: Math.PI / 2 });
  phys.addBox(-29.3, y + 0.4, -37.55, 0.45, 0.4, 1.65, 0, 'metal');
  // 外机的冷媒管走线槽：贴着北墙走到楼梯间墙上
  batch.add(M.unit, box(6.8, 0.1, 0.14), xf(-20.6, y + 0.1, -47.4), P);
  batch.add(M.unit, box(0.1, 1.4, 0.14), xf(-23.95, y + 0.7, -47.4), P);
  // 大一点的机组：站着也能躲
  K.rtu(ctx, M, { x: -13, y, z: -38.2, w: 2.6, d: 1.7, h: 1.9, tag: '05' });
  K.rtu(ctx, M, { x: -2.5, y, z: -38.0, w: 2.8, d: 1.6, h: 1.3, yaw: Math.PI, tag: '06' });
  K.hatch(ctx, M, { x: -8.4, y, z: -35.0 });
  K.dish(ctx, M, { x: -21.0, y, z: -46.2, r: 0.45, elev: 0.6 });
  for (const [x, z, goose] of [[-18.2, -40.4, true], [-6.4, -45.3, false], [-5.9, -45.0, false], [1.2, -40.6, true], [-21.8, -36.2, false]]) K.vent(ctx, { x, y, z, goose });
  tarpCargo(ctx, { x: -7.2, y, z: -41.6, yaw: 0.2, w: 1.7, h: 1.1, d: 1.2 });
  tarpCargo(ctx, { x: -12.5, y, z: -44.6, yaw: 0.05, w: 1.6, h: 0.95, d: 1.2 });
  tarpCargo(ctx, { x: -2.5, y, z: -33.7, yaw: -0.04, w: 1.8, h: 1.05, d: 1.2 });
  palletStack(ctx, { x: -5.75, y, z: -42.0, n: 5, yaw: -0.1 });
  // 储物间：薄钢板小屋，整人高
  const shed = { x: 5.4, z: -36.4 };
  batch.add(M.grey, rbox(2.2, 2.1, 1.6, 0.02, 1), xf(shed.x, y + 1.05, shed.z), P);
  batch.add(M.trim, box(2.4, 0.06, 1.8), xf(shed.x, y + 2.13, shed.z), P);
  batch.add(M.trim, box(0.9, 1.9, 0.03), xf(shed.x - 0.4, y + 0.97, shed.z - 0.81), P);
  batch.add(mats.galv, box(0.04, 0.12, 0.04), xf(shed.x - 0.05, y + 1.0, shed.z - 0.84), G);
  phys.addBox(shed.x, y + 1.05, shed.z, 1.1, 1.05, 0.8, 0, 'metal');
  // 塑料水箱：垫在混凝土墩上
  batch.add(mats.concrete, box(1.9, 0.3, 1.9), xf(0.2, y + 0.15, -46.8), C);
  batch.add(M.blue, cyl(0.82, 0.86, 1.6, 24), xf(0.2, y + 1.1, -46.8), P);
  batch.add(M.blue, cyl(0.3, 0.3, 0.1, 16), xf(0.2, y + 1.95, -46.8), P);
  batch.add(mats.galv, cylBetween(0.9, y + 0.5, -46.8, 1.6, y + 0.5, -46.8, 0.03, 8), null, G);
  phys.addBox(0.2, y + 0.15, -46.8, 0.95, 0.15, 0.95, 0, 'concrete');
  phys.addCyl(0.2, -46.8, 0.86, y, y + 2.0, 'metal');
  restCorner(ctx, M, y);
  // 检修走道：混凝土步道板，门口 → 台阶口，再往东一条
  const slab = (x, z) => batch.add(mats.concrete, box(0.56, 0.05, 0.56), xf(x, y + 0.045, z, 0, (x * 13.1 + z) % 0.04, 0), C);
  for (let x = -23.4; x <= -19.6; x += 0.6) slab(x, -44.5);
  for (let z = -43.9; z <= -35.6; z += 0.6) slab(-19.5, z);
  for (let x = -18.9; x <= 2.6; x += 0.6) slab(x, -43.6);
}

// 东北角的休息角：两把塑料椅、木箱当桌子、烟灰桶、泡沫箱种的菜、一串小灯
function restCorner(ctx, M, y) {
  const { batch, mats } = ctx;
  const chair = (x, z, yaw, mat) => {
    const m = xf(x, y, z, 0, yaw, 0);
    batch.add(mat, rbox(0.46, 0.04, 0.44, 0.015, 1), m.clone().multiply(xf(0, 0.44, 0)), { tile: 0.06 });
    batch.add(mat, rbox(0.46, 0.42, 0.04, 0.015, 1), m.clone().multiply(xf(0, 0.68, -0.23, -0.12, 0, 0)), { tile: 0.06 });
    for (const [lx, lz] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) batch.add(mat, cyl(0.016, 0.02, 0.44, 6), m.clone().multiply(xf(lx, 0.22, lz)), { tile: 0.06 });
  };
  chair(3.2, -45.4, 0.5, mats.plasticOrange);
  chair(4.9, -44.9, -0.9, mats.plasticBlack);
  batch.add(mats.woodDark, rbox(0.7, 0.5, 0.5, 0.01, 1), xf(4.1, y + 0.25, -45.9, 0, 0.2, 0), { tile: 0.9 });
  batch.add(M.yellow, cyl(0.12, 0.1, 0.3, 12), xf(4.0, y + 0.65, -45.95), P);
  batch.add(mats.galv, cyl(0.15, 0.13, 0.34, 12), xf(2.4, y + 0.17, -46.6), G);
  ctx.phys.addBox(4.1, y + 0.25, -45.9, 0.38, 0.25, 0.28, 0.2, 'wood');
  for (let i = 0; i < 4; i++) {
    const px = 5.6 + i * 0.66;
    batch.add(M.unit, rbox(0.6, 0.32, 0.42, 0.02, 1), xf(px, y + 0.16, -47.4), P);
    for (let k = 0; k < 5; k++) {
      const g = new THREE.IcosahedronGeometry(0.11, 0);
      batch.add(mats.tarp, g, xf(px - 0.2 + k * 0.1, y + 0.36 + (k % 2) * 0.04, -47.4 + ((k * 7) % 3 - 1) * 0.1, k, k * 2, 0, 1, 0.7, 1), { tile: 0.25 });
    }
  }
  ctx.phys.addBox(6.6, y + 0.2, -47.4, 1.36, 0.2, 0.25, 0, 'wood');
  // 一根竹竿绑着灯串拉到女儿墙
  batch.add(mats.woodDark, cyl(0.025, 0.03, 2.6, 6), xf(1.8, y + 1.3, -44.2), { tile: 0.9 });
  const a = [1.8, y + 2.5, -44.2], b = [7.9, y + 1.15, -47.7], n = 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n, sag = Math.sin(t * Math.PI) * 0.45;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag, a[2] + (b[2] - a[2]) * t];
    if (i < n) {
      const t2 = (i + 1) / n, s2 = Math.sin(t2 * Math.PI) * 0.45;
      batch.add(mats.black, cylBetween(...p, a[0] + (b[0] - a[0]) * t2, a[1] + (b[1] - a[1]) * t2 - s2, a[2] + (b[2] - a[2]) * t2, 0.004, 3), null);
    }
    if (i > 0 && i < n) batch.add(M.signFace, new THREE.SphereGeometry(0.03, 6, 4), xf(p[0], p[1] - 0.05, p[2]));
  }
}
