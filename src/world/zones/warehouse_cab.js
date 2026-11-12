import * as THREE from 'three';
import { xf, box, rbox, cyl, cylBetween } from '../../gfx/geo.js';
import { G, P } from './warehouse_kit.js';

// 厢式货车的驾驶室（平头车）。坐标和 warehouse_vehicles.js 的 boxTruck 一样：局部坐标车头朝 -z，m 是整车的变换。
// 车身拆成腰线以下、车顶、后围三块，中间空着：侧窗和风挡是半透明的窗玻璃，看得到座椅、方向盘和仪表台。
// 只用已有的材质（车身蓝漆、钢件、镀锌件、黑塑料、窗玻璃、白漆顶棚、橙色转向灯），不新增着色器
const at = (m, x, y, z, rx = 0, ry = 0, rz = 0) => m.clone().multiply(xf(x, y, z, rx, ry, rz));
const BOT = 1.01, BELT = 1.98, ROOF = 2.57, TOP = 2.79, FRONT = -3.8, BACK = -1.9, MID = -2.85;
const WHEEL = { z: -2.7, y: 0.48, x: 1.0 }; // 前轮（和 boxTruck 的轮距、轮径一致）

export function cabin(ctx, k, m) {
  const { batch, mats } = ctx;
  const B = k.rackBlue, S = mats.steelIn, K = mats.plasticBlack, glass = mats.glass;
  const add = (mat, g, x, y, z, rx = 0, opt) => batch.add(mat, g, at(m, x, y, z, rx), opt);
  const winH = ROOF - BELT, winY = (BELT + ROOF) / 2;

  // 外壳：腰线以下、车顶、座椅后面那一截后围、两根 A 柱
  add(B, rbox(2.3, BELT - BOT, 1.9, 0.08, 2), 0, (BOT + BELT) / 2, MID, 0, P);
  add(B, rbox(2.3, TOP - ROOF, 1.9, 0.08, 1), 0, (ROOF + TOP) / 2, MID, 0, P);
  add(B, rbox(2.3, winH + 0.04, 0.55, 0.03, 1), 0, winY, BACK - 0.275, 0, P);
  for (const s of [-1, 1]) add(B, box(0.1, winH + 0.02, 0.14), s * 1.1, winY, FRONT + 0.08, 0, P);

  // 玻璃：风挡和两侧车窗，窗框下沿一圈黑胶条
  add(glass, box(2.1, winH, 0.015), 0, winY, FRONT + 0.05);
  add(K, box(2.1, 0.05, 0.03), 0, BELT + 0.02, FRONT - 0.005);
  for (const s of [-1, 1]) {
    add(glass, box(0.015, winH, 1.2), s * 1.14, winY, -3.05);
    add(K, box(0.03, 0.025, 1.2), s * 1.145, BELT + 0.012, -3.05);
  }
  // 雨刮：两根细杆斜躺在风挡下沿
  for (const x0 of [-0.95, 0.05]) batch.add(K, cylBetween(x0, BELT + 0.05, FRONT - 0.025, x0 + 0.62, BELT + 0.14, FRONT - 0.025, 0.008, 5), m);

  // 车内：仪表台、仪表罩、转向柱和方向盘（往驾驶员一侧仰着）、两把座椅、顶棚、后围内饰、遮阳板。驾驶座在左（-x）
  add(K, rbox(2.16, 0.16, 0.36, 0.03, 1), 0, BELT + 0.06, -3.55);
  add(K, box(0.44, 0.1, 0.16), -0.55, BELT + 0.17, -3.45);
  batch.add(K, cylBetween(-0.55, BELT + 0.1, -3.42, -0.55, BELT + 0.25, -3.22, 0.03, 8), m);
  add(K, new THREE.TorusGeometry(0.2, 0.022, 5, 14), -0.55, BELT + 0.27, -3.2, -0.9);
  add(K, box(0.36, 0.03, 0.015), -0.55, BELT + 0.27, -3.2, -0.9);
  for (const sx of [-0.55, 0.5]) {
    add(K, box(0.5, 0.06, 0.45), sx, BELT + 0.03, -2.92);
    add(K, rbox(0.5, 0.52, 0.12, 0.04, 1), sx, BELT + 0.22, -2.62, 0.12);
    add(K, box(0.26, 0.14, 0.09), sx, BELT + 0.5, -2.64, 0.12);
  }
  add(k.white, box(2.16, 0.01, 1.3), 0, ROOF - 0.006, -3.1, 0, P);
  add(K, box(2.16, winH, 0.01), 0, winY, BACK - 0.555);
  add(K, box(0.5, 0.012, 0.2), -0.55, ROOF - 0.04, -3.6, 0.15);

  for (const s of [-1, 1]) {
    // 大灯：黑色灯壳，里面两个镀锌反光碗，前面一层透明灯罩；外侧一块橙色转向灯
    add(K, box(0.38, 0.2, 0.05), s * 0.82, 1.06, FRONT - 0.015);
    for (const dx of [-0.09, 0.09]) add(mats.galvIn, cyl(0.068, 0.068, 0.012, 10), s * 0.82 + dx, 1.06, FRONT - 0.04, Math.PI / 2, G);
    add(glass, box(0.36, 0.18, 0.01), s * 0.82, 1.06, FRONT - 0.06);
    add(mats.plasticOrange, box(0.09, 0.12, 0.02), s * 1.08, 1.06, FRONT - 0.03);
    // 前轮的轮拱：七段车身色的弧形翼子板，后面挂一块黑色挡泥皮
    const R = 0.58, a0 = 0.4, a1 = Math.PI - 0.3, n = 7, da = (a1 - a0) / n;
    for (let i = 0; i < n; i++) {
      const t = a0 + (i + 0.5) * da;
      add(B, box(0.32, 0.025, 2 * R * Math.sin(da / 2) + 0.012), s * WHEEL.x, WHEEL.y + R * Math.sin(t), WHEEL.z + R * Math.cos(t), -(t + Math.PI / 2), P);
    }
    add(K, box(0.3, 0.5, 0.012), s * WHEEL.x, 0.37, -2.15);
    // 门：前后两道门缝、底缝，门把手和它后面的凹槽，门后的扶手杆
    for (const z of [-3.64, -2.46]) add(mats.black, box(0.006, BELT - 1.1, 0.008), s * 1.152, (1.1 + BELT) / 2, z);
    add(mats.black, box(0.006, 0.008, 1.18), s * 1.152, 1.12, -3.05);
    add(mats.black, box(0.004, 0.07, 0.24), s * 1.152, 1.84, -2.62);
    add(K, box(0.03, 0.045, 0.2), s * 1.165, 1.84, -2.62);
    batch.add(S, cylBetween(s * 1.19, 1.2, -2.3, s * 1.19, 1.85, -2.3, 0.014, 6), m, G);
    for (const y of [1.2, 1.85]) add(S, box(0.05, 0.03, 0.03), s * 1.17, y, -2.3, 0, G);
    // 两级脚踏和内侧的支架
    add(S, box(0.3, 0.035, 0.2), s * 1.0, 0.5, -2.02, 0, G);
    add(S, box(0.26, 0.035, 0.2), s * 1.02, 0.8, -2.02, 0, G);
    add(S, box(0.02, 0.42, 0.18), s * 0.86, 0.68, -2.02, 0, G);
  }
}
