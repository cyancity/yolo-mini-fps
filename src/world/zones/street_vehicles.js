import * as THREE from 'three';
import { xf, box, cyl, cylBetween, extrude, lathe, scaleUV } from '../../gfx/geo.js';
import { rb } from './street_kit.js';
import { decalQuad } from '../labels.js';
import { tarpCargo } from '../props.js';
import { TILE } from './street_mats.js';
import { plate, fleetMark } from './street_decals.js';

// 停着的车：厢式货车、面包车、叉车。局部坐标车头朝 +Z，x 是车宽方向。
// 每辆车一个整体碰撞体从地面起算（人钻不到车底下），车就是掩体。
const G = { tile: TILE.galv }, P = { tile: TILE.paint }, K = { tile: TILE.plastic };

function put(ctx, mat, geo, m, local, opts = {}) {
  ctx.batch.add(mat, geo, local ? m.clone().multiply(local) : m.clone(), opts);
}

// 车轮：轮胎 + 轮辋 + 轮毂螺母。side = +1 / -1 是轮辋朝外的那一侧
function wheel(ctx, m, x, y, z, r, w, side, rimMat) {
  const { mats } = ctx;
  const ri = r * 0.6, hw = w / 2;
  const tyre = lathe([[ri, -hw * 0.85], [r * 0.88, -hw], [r * 0.97, -hw * 0.82], [r, -hw * 0.45], [r, hw * 0.45], [r * 0.97, hw * 0.82], [r * 0.88, hw], [ri, hw * 0.85]], 18);
  const rim = lathe([[0.001, hw * 0.45], [ri * 0.3, hw * 0.45], [ri * 0.38, hw * 0.25], [ri * 0.88, hw * 0.3], [ri, hw * 0.62], [ri * 1.02, hw * 0.75], [ri * 1.02, -hw * 0.6]], 14);
  const wm = m.clone().multiply(xf(x, y, z, 0, 0, -side * Math.PI / 2));
  ctx.batch.add(mats.rubber, scaleUV(tyre, 10, 1), wm);
  ctx.batch.add(rimMat || mats.galv, rim, wm, G);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.batch.add(mats.steelDark, box(0.022, 0.03, 0.022), wm.clone().multiply(xf(Math.cos(a) * ri * 0.24, hw * 0.48, Math.sin(a) * ri * 0.24)), G);
  }
}

// 车牌（空白），贴在局部 z 处的车头或车尾
function plateAt(ctx, m, y, z, back) {
  const g = decalQuad(0.44, 0.14, plate(ctx));
  g.translate(-0.22, -0.07, 0);
  ctx.batch.add(ctx.mats.black, box(0.47, 0.17, 0.01), m.clone().multiply(xf(0, y, z)));
  ctx.decals.add(ctx.atlas.material, g, m.clone().multiply(xf(0, y, z + (back ? -0.008 : 0.008), 0, back ? Math.PI : 0, 0)));
}

function mirror(ctx, m, s, x, y, z) {
  put(ctx, ctx.mats.galv, cylBetween(s * x, y + 0.15, z, s * (x + 0.28), y + 0.1, z + 0.05, 0.015, 6), m, null, G);
  put(ctx, ctx.mats.plasticBlack, rb(0.07, 0.36, 0.2, 0.02), m, xf(s * (x + 0.32), y, z + 0.05), K);
  put(ctx, ctx.mats.glassDark, box(0.005, 0.3, 0.16), m, xf(s * (x + 0.32), y, z - 0.052, 0, 0, 0));
}

// 厢式货车：平头驾驶室 + 冷藏厢，长约 7.4 米
export function boxTruck(ctx, S, o) {
  const { mats } = ctx;
  const m = xf(o.x, 0, o.z, 0, o.yaw || 0, 0), paint = S.carWhite;
  put(ctx, mats.steelDark, box(0.12, 0.24, 6.7), m, xf(-0.45, 0.78, -0.15), G);
  put(ctx, mats.steelDark, box(0.12, 0.24, 6.7), m, xf(0.45, 0.78, -0.15), G);
  // 驾驶室
  put(ctx, paint, rb(2.3, 2.0, 1.72, 0.1, 2), m, xf(0, 2.0, 2.8), P);
  put(ctx, mats.plasticBlack, rb(2.2, 0.48, 0.3, 0.04), m, xf(0, 0.8, 3.55), K);
  put(ctx, mats.plasticBlack, rb(2.1, 0.98, 0.03, 0.02), m, xf(0, 2.42, 3.655, -0.06, 0, 0), K);
  put(ctx, mats.glassDark, box(2.0, 0.88, 0.02), m, xf(0, 2.42, 3.67, -0.06, 0, 0));
  for (const s of [-1, 1]) {
    put(ctx, mats.plasticBlack, box(0.02, 0.8, 1.1), m, xf(s * 1.148, 2.42, 3.0), K);
    put(ctx, mats.glassDark, box(0.02, 0.72, 1.02), m, xf(s * 1.156, 2.42, 3.0));
    for (const z of [2.18, 3.6]) put(ctx, mats.black, box(0.012, 1.7, 0.015), m, xf(s * 1.152, 1.95, z));
    put(ctx, mats.galv, rb(0.03, 0.04, 0.2, 0.008), m, xf(s * 1.165, 1.85, 2.45), G);
    put(ctx, mats.steelDark, box(0.28, 0.04, 0.5), m, xf(s * 1.0, 0.62, 2.95), G);
    put(ctx, mats.plasticBlack, box(0.34, 0.05, 0.95), m, xf(s * 1.0, 0.92, 2.62), K);
    mirror(ctx, m, s, 1.15, 2.45, 3.45);
    put(ctx, mats.reflective, rb(0.38, 0.2, 0.05, 0.02), m, xf(s * 0.8, 1.22, 3.66));
    put(ctx, mats.plasticOrange, rb(0.12, 0.12, 0.05, 0.015), m, xf(s * 1.06, 1.22, 3.66), K);
    put(ctx, mats.plasticOrange, box(0.1, 0.05, 0.05), m, xf(s * 0.9, 3.04, 3.5), K);
  }
  put(ctx, mats.plasticBlack, rb(1.5, 0.42, 0.05, 0.02), m, xf(0, 1.55, 3.665), K);
  for (let i = 0; i < 4; i++) put(ctx, mats.galv, box(1.42, 0.025, 0.02), m, xf(0, 1.42 + i * 0.09, 3.69), G);
  put(ctx, mats.plasticBlack, rb(2.36, 0.3, 0.26, 0.04), m, xf(0, 0.62, 3.72), K);
  plateAt(ctx, m, 0.62, 3.855, false);
  // 货厢：白色厢板、铝合金包角和竖筋、后门锁杆
  const zb = -1.05, L = 5.3;
  put(ctx, paint, box(2.4, 2.4, L), m, xf(0, 2.3, zb), P);
  put(ctx, mats.steelDark, box(2.3, 0.12, L), m, xf(0, 1.04, zb), G);
  for (const s of [-1, 1]) {
    for (const z of [zb - L / 2, zb + L / 2]) put(ctx, mats.galv, rb(0.08, 2.46, 0.08, 0.01), m, xf(s * 1.2, 2.3, z), G);
    for (const y of [1.1, 3.5]) put(ctx, mats.galv, rb(0.08, 0.08, L, 0.01), m, xf(s * 1.2, y, zb), G);
    for (let z = zb - L / 2 + 0.6; z < zb + L / 2 - 0.3; z += 0.6) put(ctx, mats.galv, box(0.012, 2.3, 0.04), m, xf(s * 1.205, 2.3, z), G);
    const fm = fleetMark(ctx), g = decalQuad(4.0, 1.0, fm);
    g.translate(-2.0, -0.5, 0);
    ctx.decals.add(ctx.atlas.material, g, m.clone().multiply(xf(s * 1.213, 2.35, zb, 0, s * Math.PI / 2, 0)));
    for (const y of [0.55, 0.8]) put(ctx, mats.galv, rb(0.04, 0.08, 3.3, 0.01), m, xf(s * 1.12, y, 0.15), G);
    put(ctx, S.lensRed, rb(0.3, 0.12, 0.05, 0.015), m, xf(s * 0.9, 0.85, -3.71));
    for (const x of [0.35, 0.95]) put(ctx, mats.galv, cyl(0.016, 0.016, 2.3, 6), m, xf(s * x, 2.3, -3.72), G);
  }
  for (const y of [1.1, 3.5]) put(ctx, mats.galv, rb(2.46, 0.08, 0.08, 0.01), m, xf(0, y, zb - L / 2), G);
  put(ctx, mats.black, box(0.015, 2.3, 0.01), m, xf(0, 2.3, -3.705));
  // 后门：铰链、锁杆的把手和卡座，门槛上一条红白反光贴，后面看过去不再是一整块白板
  for (const s of [-1, 1]) {
    for (const y of [1.5, 2.3, 3.1]) put(ctx, mats.galv, rb(0.12, 0.1, 0.03, 0.006), m, xf(s * 1.1, y, -3.718), G);
    for (const x of [0.35, 0.95]) {
      put(ctx, mats.galv, rb(0.3, 0.04, 0.03, 0.008), m, xf(s * (x - 0.13), 1.62, -3.745), G);
      for (const y of [1.25, 3.3]) put(ctx, mats.steelDark, box(0.08, 0.06, 0.04), m, xf(s * x, y, -3.725), G);
    }
  }
  for (let i = 0; i < 8; i++) put(ctx, i % 2 ? S.lensRed : mats.reflective, box(0.28, 0.05, 0.01), m, xf(-0.98 + i * 0.28, 1.2, -3.712));
  put(ctx, mats.steelDark, rb(2.2, 0.14, 0.12, 0.01), m, xf(0, 0.5, -3.62), G);
  for (const s of [-0.7, 0.7]) put(ctx, mats.steelDark, box(0.08, 0.5, 0.08), m, xf(s, 0.75, -3.55), G);
  plateAt(ctx, m, 0.78, -3.7, true);
  // 油箱、电瓶箱
  put(ctx, mats.galv, cyl(0.27, 0.27, 0.95, 18), m, xf(-0.82, 0.68, 1.0, Math.PI / 2, 0, 0), G);
  put(ctx, mats.steelDark, rb(0.5, 0.45, 0.6, 0.02), m, xf(0.82, 0.68, 1.0), G);
  // 车轮：前单后双
  for (const s of [-1, 1]) {
    wheel(ctx, m, s * 1.0, 0.44, 2.65, 0.44, 0.24, s, S.grey);
    wheel(ctx, m, s * 1.07, 0.44, -2.25, 0.44, 0.24, s, S.grey);
    wheel(ctx, m, s * 0.8, 0.44, -2.25, 0.44, 0.24, s, S.grey);
  }
  ctx.phys.solid(m, 0, 1.52, 2.82, 1.17, 1.52, 0.95, 'metal');
  ctx.phys.solid(m, 0, 1.76, zb, 1.22, 1.76, L / 2 + 0.05, 'metal');
}

// 面包车侧面轮廓（带两个轮拱缺口），u 是车长方向
function vanProfile(rz, fz, r) {
  const pts = [[-2.55, 0.32]];
  const arch = (cz) => { for (let i = 0; i <= 8; i++) { const a = Math.PI - (i / 8) * Math.PI; pts.push([cz + Math.cos(a) * r, 0.33 + Math.sin(a) * r]); } };
  arch(rz); arch(fz);
  pts.push([2.42, 0.32], [2.55, 0.45], [2.56, 0.9], [2.45, 1.08], [1.9, 1.22], [1.25, 2.08], [1.05, 2.2], [-2.45, 2.22], [-2.55, 2.12]);
  return pts;
}

// 面包车（高顶厢式），长 5.1 米
export function van(ctx, S, o) {
  const { mats } = ctx;
  const m = xf(o.x, 0, o.z, 0, o.yaw || 0, 0), paint = o.paint || S.carBlue;
  const rz = -1.6, fz = 1.75, R = 0.42;
  // inset：车壳正好落在轮廓上，下面按轮廓尺寸贴的挡风玻璃、大灯、格栅、后窗、门缝才露得出来
  put(ctx, paint, extrude(vanProfile(rz, fz, R), 1.94, 0.035, [], { inset: true }), m, xf(0, 0, 0, 0, -Math.PI / 2, 0), P);
  // 轮拱内衬
  for (const cz of [rz, fz]) for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI;
    put(ctx, mats.black, box(1.7, 0.03, 0.17), m, xf(0, 0.33 + Math.sin(a) * (R - 0.02), cz + Math.cos(a) * (R - 0.02), -(a - Math.PI / 2), 0, 0));
  }
  // 前挡风：斜面上贴一块
  const a = -Math.atan2(0.65, 0.86);
  put(ctx, mats.plasticBlack, box(1.8, 1.04, 0.012), m, xf(0, 1.655, 1.582, a, 0, 0), K);
  put(ctx, mats.glassDark, box(1.72, 0.96, 0.012), m, xf(0, 1.662, 1.59, a, 0, 0));
  for (const s of [-1, 1]) {
    put(ctx, mats.glassDark, box(0.012, 0.6, 0.9), m, xf(s * 0.985, 1.66, 0.72));
    put(ctx, mats.black, box(0.012, 1.6, 0.012), m, xf(s * 0.985, 1.25, 0.22));
    put(ctx, mats.black, box(0.012, 1.6, 0.012), m, xf(s * 0.985, 1.25, 1.28));
    put(ctx, mats.galv, rb(0.03, 0.035, 0.18, 0.008), m, xf(s * 0.995, 1.3, 0.38), G);
    mirror(ctx, m, s, 0.97, 1.65, 1.45);
    put(ctx, mats.reflective, rb(0.34, 0.15, 0.05, 0.02), m, xf(s * 0.66, 0.98, 2.5, -0.5, 0, 0));
    put(ctx, S.lensRed, rb(0.08, 0.5, 0.05, 0.015), m, xf(s * 0.88, 1.2, -2.56));
    put(ctx, mats.glassDark, box(0.66, 0.48, 0.012), m, xf(s * 0.43, 1.82, -2.567));
    wheel(ctx, m, s * 0.8, 0.33, rz, 0.33, 0.2, s, mats.steelDark);
    wheel(ctx, m, s * 0.8, 0.33, fz, 0.33, 0.2, s, mats.steelDark);
  }
  put(ctx, mats.black, box(0.012, 1.85, 0.012), m, xf(0, 1.25, -2.566));
  // 右侧（-X）滑门的门缝和滑轨
  put(ctx, mats.black, box(0.012, 1.7, 0.012), m, xf(-0.985, 1.2, -1.05));
  put(ctx, mats.galv, box(0.02, 0.03, 1.4), m, xf(-0.99, 1.62, -1.75), G);
  put(ctx, mats.plasticBlack, rb(1.25, 0.22, 0.05, 0.02), m, xf(0, 0.8, 2.56), K);
  for (const z of [2.6, -2.6]) put(ctx, mats.plasticBlack, rb(2.0, 0.22, 0.2, 0.04), m, xf(0, 0.45, z), K);
  plateAt(ctx, m, 0.45, 2.705, false);
  plateAt(ctx, m, 0.45, -2.705, true);
  // 白车是冷运公司的送货车：货厢两侧贴同一套车身字（图集里已有，不占新面积），免得侧面是一整块白板
  if (o.mark) for (const s of [-1, 1]) {
    const g = decalQuad(2.4, 0.6, fleetMark(ctx));
    g.translate(-1.2, -0.3, 0);
    ctx.decals.add(ctx.atlas.material, g, m.clone().multiply(xf(s * 0.977, 1.42, -1.15, 0, s * Math.PI / 2, 0)));
  }
  // 车顶行李架：横杆压在车顶上，纵杆架在横杆上。车顶从前往后抬高 2 cm（vanProfile），纵杆跟着斜一点
  const roofY = (z) => 2.2 + ((1.05 - z) / 3.5) * 0.02;
  for (const s of [-0.75, 0.75]) put(ctx, mats.galv, rb(0.04, 0.04, 3.0, 0.01), m, xf(s, roofY(-0.8) + 0.047, -0.8, 0.02 / 3.5, 0, 0), G);
  for (let i = 0; i < 4; i++) { const z = -2.1 + i * 0.9; put(ctx, mats.galv, box(1.5, 0.03, 0.04), m, xf(0, roofY(z) + 0.012, z), G); }
  ctx.phys.solid(m, 0, 1.13, 0, 1.0, 1.13, 2.62, 'metal');
}

// 叉车：配重车身、护顶架、门架和货叉，叉上一托盘盖着布的货
export function forklift(ctx, S, o) {
  const { mats } = ctx;
  const yaw = o.yaw || 0, m = xf(o.x, 0, o.z, 0, yaw, 0), paint = S.yellow;
  const prof = [[-1.25, 0.22], [-1.13, 0.22], [-1.1, 0.42], [-0.85, 0.55], [-0.6, 0.42], [-0.57, 0.22], [0.85, 0.22], [0.9, 0.55], [0.85, 0.95],
    [-0.3, 0.95], [-0.48, 1.28], [-1.05, 1.32], [-1.25, 1.15], [-1.32, 0.8], [-1.3, 0.4]];
  put(ctx, paint, extrude(prof, 1.0, 0.03), m, xf(0, 0, 0, 0, -Math.PI / 2, 0), P);
  put(ctx, mats.black, box(0.95, 0.04, 0.6), m, xf(0, 0.97, 0.3));
  put(ctx, mats.plasticBlack, rb(0.46, 0.12, 0.44, 0.03), m, xf(0, 1.06, -0.22), K);
  put(ctx, mats.plasticBlack, rb(0.46, 0.44, 0.1, 0.03), m, xf(0, 1.32, -0.46, -0.15, 0, 0), K);
  put(ctx, mats.plasticBlack, rb(0.7, 0.3, 0.25, 0.03), m, xf(0, 1.1, 0.7), K);
  put(ctx, mats.steelDark, cylBetween(0, 1.2, 0.62, 0, 1.45, 0.42, 0.025, 8), m, null, G);
  put(ctx, mats.plasticBlack, new THREE.TorusGeometry(0.16, 0.02, 6, 18), m, xf(0, 1.47, 0.4, -1.0, 0, 0), K);
  // 护顶架
  for (const s of [-1, 1]) {
    put(ctx, mats.steelDark, cylBetween(s * 0.47, 0.95, -0.62, s * 0.47, 2.15, -0.62, 0.035, 8), m, null, G);
    put(ctx, mats.steelDark, cylBetween(s * 0.47, 0.95, 0.62, s * 0.47, 2.15, 0.3, 0.035, 8), m, null, G);
    put(ctx, mats.steelDark, rb(0.06, 0.06, 1.0, 0.01), m, xf(s * 0.47, 2.17, -0.16), G);
    put(ctx, mats.reflective, rb(0.12, 0.1, 0.06, 0.02), m, xf(s * 0.47, 2.05, 0.38));
  }
  for (let i = 0; i < 6; i++) put(ctx, mats.steelDark, box(1.0, 0.04, 0.05), m, xf(0, 2.18, -0.62 + i * 0.185), G);
  put(ctx, mats.plasticOrange, cyl(0.06, 0.07, 0.12, 12), m, xf(0, 2.27, -0.55), K);
  // 气瓶
  put(ctx, S.red, cyl(0.15, 0.15, 0.78, 16), m, xf(0, 1.48, -0.92, 0, 0, Math.PI / 2), P);
  // 门架、链条、油缸、货叉
  for (const s of [-1, 1]) {
    put(ctx, mats.steelDark, rb(0.1, 2.25, 0.12, 0.01), m, xf(s * 0.37, 1.2, 0.98), G);
    put(ctx, mats.steelDark, rb(0.08, 2.1, 0.1, 0.01), m, xf(s * 0.27, 1.15, 1.06), G);
    put(ctx, mats.black, box(0.03, 2.0, 0.015), m, xf(s * 0.14, 1.15, 1.07));
    put(ctx, mats.steelDark, box(0.1, 0.55, 0.045), m, xf(s * 0.3, 0.33, 1.17), G);
    put(ctx, mats.steelDark, box(0.1, 0.045, 1.1), m, xf(s * 0.3, 0.07, 1.72), G);
  }
  for (const y of [0.22, 1.25, 2.28]) put(ctx, mats.steelDark, box(0.84, 0.07, 0.08), m, xf(0, y, 0.98), G);
  put(ctx, mats.galv, cyl(0.045, 0.045, 1.8, 10), m, xf(0, 1.1, 0.93), G);
  put(ctx, mats.steelDark, rb(0.95, 0.42, 0.06, 0.01), m, xf(0, 0.4, 1.13), G);
  for (let i = 0; i < 6; i++) put(ctx, mats.steelDark, box(0.03, 0.6, 0.03), m, xf(-0.4 + i * 0.16, 0.95, 1.13), G);
  for (const s of [-1, 1]) {
    wheel(ctx, m, s * 0.62, 0.32, 0.55, 0.32, 0.22, s, S.red);
    wheel(ctx, m, s * 0.42, 0.24, -0.85, 0.24, 0.17, s, S.red);
  }
  ctx.phys.solid(m, 0, 1.1, -0.25, 0.6, 1.1, 1.1, 'metal');
  ctx.phys.solid(m, 0, 1.17, 0.98, 0.45, 1.17, 0.1, 'metal');
  if (o.load) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    tarpCargo(ctx, { x: o.x + s * 1.75, y: 0.1, z: o.z + c * 1.75, yaw, w: 1.0, h: 0.75, d: 1.1 });
  }
}
