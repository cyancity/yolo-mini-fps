import * as THREE from 'three';
import { xf, box, rbox, cyl, cylBetween } from '../../gfx/geo.js';
import { distress, STENCIL_FONT } from '../labels.js';
import { G, P } from './warehouse_kit.js';
import { cargo } from './warehouse_cargo.js';
import { cabin } from './warehouse_cab.js';

// 车辆：平衡重叉车、手动液压搬运车、厢式货车。局部坐标里车头朝 -z，xf 的 yaw 把它转到位。
const at = (m, x, y, z, rx = 0, ry = 0, rz = 0) => m.clone().multiply(xf(x, y, z, rx, ry, rz));
const wheel = (ctx, m, x, y, z, r, w, seg = 18) => {
  ctx.batch.add(ctx.mats.rubber, cyl(r, r, w, seg), at(m, x, y, z, 0, 0, Math.PI / 2));
  ctx.batch.add(ctx.mats.galvIn, cyl(r * 0.5, r * 0.5, w + 0.02, 10), at(m, x, y, z, 0, 0, Math.PI / 2), G);
};

// 叉车：货叉抬到 lift，叉着一托缠膜货。返回占地（局部 z 从车尾 1.3 到货叉尖 -2.3）
export function forklift(ctx, k, o, rand) {
  const { batch, mats, phys } = ctx;
  const m = xf(o.x, o.y, o.z, 0, o.yaw, 0), Y = k.yellow, S = mats.steelIn, lift = o.lift ?? 0.9;
  batch.add(Y, rbox(1.08, 0.55, 1.9, 0.06, 1), at(m, 0, 0.45, 0.1), P);
  batch.add(S, rbox(1.12, 0.78, 0.58, 0.12, 2), at(m, 0, 0.72, 1.0), G);
  batch.add(Y, rbox(1.0, 0.24, 0.85, 0.04, 1), at(m, 0, 0.84, 0.42), P);
  batch.add(mats.plasticBlack, rbox(0.46, 0.12, 0.44, 0.03, 1), at(m, 0, 1.02, 0.36));
  batch.add(mats.plasticBlack, rbox(0.46, 0.5, 0.1, 0.03, 1), at(m, 0, 1.28, 0.6, -0.15, 0, 0));
  batch.add(Y, rbox(0.9, 0.32, 0.22, 0.04, 1), at(m, 0, 0.88, -0.62), P);
  batch.add(S, cylBetween(0, 0.95, -0.5, 0, 1.22, -0.36, 0.025, 6), m, G);
  batch.add(mats.plasticBlack, cyl(0.17, 0.17, 0.03, 16), at(m, 0, 1.24, -0.34, -1.0, 0, 0));
  for (const s of [-1, 1]) batch.add(mats.plasticBlack, cylBetween(s * 0.15, 0.98, -0.66, s * 0.15 + 0.02, 1.25, -0.58, 0.012, 5), m);
  // 护顶架
  for (const [x, z, y0] of [[-0.48, -0.55, 0.72], [0.48, -0.55, 0.72], [-0.48, 0.78, 1.1], [0.48, 0.78, 1.1]]) {
    batch.add(S, box(0.06, 2.17 - y0, 0.06), at(m, x, (y0 + 2.17) / 2, z), G);
  }
  for (const s of [-1, 1]) batch.add(S, box(0.06, 0.06, 1.45), at(m, s * 0.48, 2.17, 0.12), G);
  for (let i = 0; i < 6; i++) batch.add(S, box(0.96, 0.025, 0.06), at(m, 0, 2.17, -0.5 + i * 0.25), G);
  batch.add(mats.emissive(0xff2a12, 12), new THREE.SphereGeometry(0.05, 10, 6), at(m, 0.38, 2.27, 0.72));
  batch.add(mats.plasticBlack, rbox(0.14, 0.1, 0.08, 0.02, 1), at(m, -0.38, 2.12, -0.6));
  batch.add(k.lamp, box(0.11, 0.07, 0.005), at(m, -0.38, 2.12, -0.642));
  wheel(ctx, m, -0.53, 0.32, -0.6, 0.32, 0.22);
  wheel(ctx, m, 0.53, 0.32, -0.6, 0.32, 0.22);
  wheel(ctx, m, -0.48, 0.25, 0.85, 0.25, 0.18);
  wheel(ctx, m, 0.48, 0.25, 0.85, 0.25, 0.18);
  // 门架、油缸、叉架、货叉
  for (const s of [-1, 1]) {
    batch.add(S, box(0.08, 2.3, 0.12), at(m, s * 0.33, 1.2, -1.05), G);
    batch.add(S, box(0.07, 2.1, 0.1), at(m, s * 0.24, 1.1 + lift * 0.5, -1.08), G);
    batch.add(mats.galvIn, cylBetween(s * 0.42, 0.55, -0.7, s * 0.36, 1.2, -1.0, 0.035, 8), m, G);
    batch.add(S, box(0.12, 0.55, 0.05), at(m, s * 0.25, lift + 0.3, -1.17), G);
    batch.add(S, box(0.12, 0.045, 1.1), at(m, s * 0.25, lift + 0.022, -1.75), G);
  }
  for (const y of [0.15, 2.3]) batch.add(S, box(0.74, 0.08, 0.1), at(m, 0, y, -1.05), G);
  batch.add(S, box(0.9, 0.5, 0.05), at(m, 0, lift + 0.33, -1.14), G);
  for (let i = -2; i <= 2; i++) batch.add(S, box(0.03, 0.6, 0.03), at(m, i * 0.2, lift + 0.85, -1.14), G);
  batch.add(mats.galvIn, cyl(0.04, 0.04, 2.0, 8), at(m, 0, 1.2, -1.0), G);
  const top = lift + 0.045 + cargo(ctx, k, at(m, 0, lift + 0.045, -1.75, 0, Math.PI / 2, 0), rand, { type: 'wrapped', hmax: 1.35 });
  // 碰撞：车身、门架、货（子弹能打）；抬起的货下面那段只挡人
  phys.solid(m, 0, 0.62, 0.25, 0.57, 0.62, 1.05, 'metal');
  phys.solid(m, 0, 1.2, -1.05, 0.42, 1.2, 0.1, 'metal');
  phys.solid(m, 0, (lift + top) / 2, -1.75, 0.55, (top - lift) / 2, 0.6, 'wood');
  phys.solid(m, 0, lift / 2, -1.75, 0.55, lift / 2, 0.6, 'metal').playerOnly = true;
}

// 手动液压搬运车：load 为 true 时叉着一托货
export function palletJack(ctx, k, o, rand) {
  const { batch, mats, phys } = ctx;
  const m = xf(o.x, o.y, o.z, 0, o.yaw, 0);
  for (const s of [-1, 1]) {
    batch.add(k.red, box(0.16, 0.07, 1.15), at(m, s * 0.27, 0.05, -0.58), P);
    batch.add(mats.rubber, cyl(0.04, 0.04, 0.14, 8), at(m, s * 0.27, 0.04, -1.08, 0, 0, Math.PI / 2));
  }
  batch.add(k.red, rbox(0.66, 0.26, 0.28, 0.03, 1), at(m, 0, 0.2, 0.12), P);
  batch.add(mats.steelIn, cyl(0.05, 0.05, 0.3, 10), at(m, 0, 0.42, 0.14), G);
  batch.add(mats.rubber, cyl(0.1, 0.1, 0.1, 14), at(m, 0, 0.1, 0.18, 0, 0, Math.PI / 2));
  const tilt = o.handle ?? 0.25;
  batch.add(k.red, cylBetween(0, 0.5, 0.18, 0, 0.5 + Math.cos(tilt) * 0.75, 0.18 + Math.sin(tilt) * 0.75, 0.02, 8), m, P);
  const hx = 0.18 + Math.sin(tilt) * 0.78, hy = 0.5 + Math.cos(tilt) * 0.78;
  batch.add(mats.plasticBlack, cyl(0.022, 0.022, 0.36, 8), at(m, 0, hy, hx, 0, 0, Math.PI / 2));
  if (!o.load) return;
  const top = 0.085 + cargo(ctx, k, at(m, 0, 0.085, -0.58, 0, Math.PI / 2, 0), rand, { type: o.load, hmax: o.hmax ?? 1.4 });
  phys.solid(m, 0, top / 2, -0.55, 0.52, top / 2, 0.62, 'wood');
}

// 厢式货车（车头朝南停在车辆区东侧）：驾驶室、货厢、底盘、六个轮子、后门锁杆。货厢侧面喷公司名
export function boxTruck(ctx, k, o, rand) {
  const { batch, mats, phys, atlas, decals } = ctx;
  const m = xf(o.x, o.y, o.z, 0, o.yaw, 0), S = mats.steelIn;
  for (const s of [-1, 1]) batch.add(S, box(0.12, 0.26, 7.0), at(m, s * 0.45, 0.86, 0.1), G);
  for (const z of [-2.7, 1.95, 3.0]) {
    for (const s of [-1, 1]) wheel(ctx, m, s * (z < 0 ? 1.0 : 0.94), 0.48, z, 0.48, z < 0 ? 0.3 : 0.5, 20);
  }
  batch.add(S, box(1.6, 0.12, 0.12), at(m, 0, 0.48, -2.7), G);
  for (const z of [1.95, 3.0]) batch.add(S, box(1.5, 0.14, 0.14), at(m, 0, 0.48, z), G);
  // 驾驶室：外壳、车窗、车内、大灯、轮拱、门和脚踏在 warehouse_cab.js
  const cab = k.rackBlue;
  cabin(ctx, k, m);
  batch.add(cab, rbox(2.3, 0.5, 0.5, 0.06, 1), at(m, 0, 0.95, -3.55), P);
  batch.add(S, rbox(2.38, 0.32, 0.24, 0.04, 1), at(m, 0, 0.7, -3.86), G);
  batch.add(mats.black, box(1.3, 0.5, 0.03), at(m, 0, 1.35, -3.81));
  for (let i = 0; i < 6; i++) batch.add(S, box(1.24, 0.025, 0.02), at(m, 0, 1.15 + i * 0.08, -3.83), G);
  for (const s of [-1, 1]) {
    batch.add(S, cylBetween(s * 1.15, 2.4, -3.68, s * 1.42, 2.3, -3.44, 0.015, 5), m, G);
    batch.add(mats.plasticBlack, rbox(0.06, 0.38, 0.2, 0.02, 1), at(m, s * 1.45, 2.2, -3.42));
  }
  batch.add(mats.galvIn, cyl(0.26, 0.26, 1.0, 14), at(m, 0.85, 0.72, -1.15, Math.PI / 2, 0, 0), G);
  // 货厢
  batch.add(S, box(2.38, 0.14, 5.6), at(m, 0, 1.08, 1.0), G);
  batch.add(k.white, rbox(2.45, 2.5, 5.6, 0.05, 1), at(m, 0, 2.4, 1.0), P);
  for (const s of [-1, 1]) {
    batch.add(k.white, box(0.6, 0.06, 1.7), at(m, s * 0.98, 1.0, 2.48), P);
    for (let z = -1.6; z < 3.7; z += 0.9) batch.add(S, box(0.02, 2.46, 0.05), at(m, s * 1.235, 2.4, z), G);
  }
  batch.add(S, box(2.2, 0.12, 0.12), at(m, 0, 0.58, 3.86), G);
  for (const s of [-1, 1]) {
    batch.add(S, box(0.12, 0.5, 0.1), at(m, s * 0.9, 0.82, 3.8), G);
    batch.add(k.red, rbox(0.3, 0.14, 0.05, 0.02, 1), at(m, s * 1.02, 0.98, 3.84), P);
  }
  batch.add(S, box(0.02, 2.4, 0.03), at(m, 0, 2.4, 3.815), G);
  for (const x of [-0.85, -0.35, 0.35, 0.85]) {
    batch.add(mats.galvIn, cyl(0.018, 0.018, 2.3, 6), at(m, x, 2.4, 3.84), G);
    batch.add(mats.galvIn, box(0.1, 0.05, 0.05), at(m, x, 1.75, 3.86), G);
  }
  const name = atlas.cached('wh|truck', 1024, 256, (c, w, h) => {
    c.fillStyle = '#1d4a80'; c.fillRect(0, 150, w, 16);
    c.fillStyle = '#1d4a80'; c.font = '700 110px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
    c.fillText('泊远货运', 24, 124);
    c.font = `700 52px ${STENCIL_FONT}`; c.fillStyle = '#2b2f33';
    c.fillText('BOYUAN FREIGHT · 港区专线', 26, 222);
    distress(c, w, h, rand, 0.25);
  });
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(3.8, 0.95);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, name[0] + uv.getX(i) * (name[2] - name[0]), name[1] + uv.getY(i) * (name[3] - name[1]));
    decals.add(atlas.material, g, at(m, s * 1.228, 2.7, 1.0, 0, s * Math.PI / 2, 0));
  }
  // 碰撞：车底只挡人（看得到车底的地面），车身、驾驶室、轮子挡子弹
  phys.solid(m, 0, 1.85, 0, 1.25, 1.85, 3.9, 'metal').playerOnly = true;
  phys.solid(m, 0, 2.4, 1.0, 1.225, 1.25, 2.8, 'metal');
  phys.solid(m, 0, 1.85, -2.85, 1.15, 0.95, 0.98, 'metal');
  phys.solid(m, 0, 0.85, 0.1, 0.5, 0.15, 3.5, 'metal');
  phys.solid(m, 0, 0.48, -2.7, 1.15, 0.48, 0.48, 'metal');
  phys.solid(m, 0, 0.48, 2.47, 1.2, 0.48, 1.0, 'metal');
}
