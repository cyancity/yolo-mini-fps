import { xf, box, rbox, cyl } from '../../gfx/geo.js';
import { G, WD } from './warehouse_kit.js';

// 托盘和托盘上的货：纸箱垛、缠膜货、油桶、木箱、编织袋。只出几何体，碰撞由调用方按整垛登记。
// 托盘 1.2（局部 x）× 1.0（局部 z）× 0.144，m 是托盘底面中心。
export const PALLET_H = 0.144;
const at = (m, x, y, z, ry = 0) => m.clone().multiply(xf(x, y, z, 0, ry, 0));

export function pallet(ctx, m, rand) {
  const w = ctx.mats.woodIn, T = { tile: 0.9, ou: rand(), ov: rand() };
  for (let i = 0; i < 5; i++) ctx.batch.add(w, box(1.2, 0.022, 0.15), at(m, 0, 0.133, -0.425 + i * 0.2125), T);
  for (const z of [-0.44, 0, 0.44]) {
    ctx.batch.add(w, box(1.2, 0.022, 0.12), at(m, 0, 0.011, z), T);
    ctx.batch.add(w, box(1.2, 0.078, 0.1), at(m, 0, 0.061, z), T);
  }
}

// 返回货顶标高（相对托盘底），type 为 null 时随机挑
export const TYPES = ['carton', 'carton', 'carton', 'wrapped', 'wrapped', 'drums', 'crate', 'sacks'];
export function cargo(ctx, k, m, rand, { type = null, hmax = 1.3, palletToo = true } = {}) {
  const { batch, mats } = ctx;
  const t = type || TYPES[Math.floor(rand() * TYPES.length)];
  if (palletToo) pallet(ctx, m, rand);
  const y = PALLET_H, room = hmax - y;
  if (t === 'carton') {
    const rows = Math.max(1, Math.min(Math.floor(room / 0.3), 2 + Math.floor(rand() * 3)));
    const h = rows * 0.3, w = 1.12 + rand() * 0.06, d = 0.96;
    batch.add(k.carton, box(w, h, d), at(m, (rand() - 0.5) * 0.04, y + h / 2, 0, (rand() - 0.5) * 0.03), { tile: 1.2, ou: rand(), ov: rand() });
    // 顶上少码一层：缺角的垛看着才像人码的
    if (h + 0.3 < room && rand() < 0.6) {
      const s = rand() < 0.5 ? -1 : 1;
      batch.add(k.carton, box(0.8, 0.3, d), at(m, s * 0.2, y + h + 0.15, 0, (rand() - 0.5) * 0.05), { tile: 1.2, ou: rand(), ov: rand() });
      return y + h + 0.3;
    }
    return y + h;
  }
  if (t === 'wrapped') {
    const h = Math.min(room, 0.8 + rand() * 0.6);
    batch.add(k.film, rbox(1.2, h, 1.0, 0.05, 1), at(m, 0, y + h / 2, 0, (rand() - 0.5) * 0.03), { tile: 1.2, ou: rand(), ov: rand() });
    batch.add(k.white, box(1.1, 0.005, 0.9), at(m, 0, y + h + 0.002, 0), { tile: 5.2 });
    return y + h;
  }
  if (t === 'drums' && room > 0.9) {
    const paint = [k.rackBlue, k.red, mats.steelIn][Math.floor(rand() * 3)];
    for (const [dx, dz] of [[-0.3, -0.24], [0.3, -0.24], [-0.3, 0.24], [0.3, 0.24]]) {
      batch.add(paint, cyl(0.285, 0.285, 0.86, 12), at(m, dx, y + 0.43, dz, rand() * 6), { tile: 5.2, ou: rand() });
      batch.add(mats.steelIn, cyl(0.292, 0.292, 0.03, 12, true), at(m, dx, y + 0.29, dz), G);
    }
    return y + 0.86;
  }
  if (t === 'crate' || t === 'drums') {
    const h = Math.min(room, 0.65 + rand() * 0.35);
    batch.add(mats.woodIn, box(1.14, h, 0.94), at(m, 0, y + h / 2, 0), { tile: 0.9, ou: rand(), ov: rand() });
    for (const s of [-1, 1]) {
      batch.add(mats.woodDark, box(1.18, 0.08, 0.98), at(m, 0, y + (s < 0 ? 0.06 : h - 0.06), 0), WD);
      batch.add(mats.woodDark, box(0.08, h, 0.98), at(m, s * 0.53, y + h / 2, 0), WD);
    }
    return y + h;
  }
  // 编织袋：三层，层间错开一点
  const n = Math.max(1, Math.min(4, Math.floor(room / 0.19)));
  for (let i = 0; i < n; i++) {
    batch.add(mats.sandbag, rbox(1.1, 0.2, 0.92, 0.07, 1), at(m, (rand() - 0.5) * 0.06, y + 0.1 + i * 0.185, (rand() - 0.5) * 0.05, (rand() - 0.5) * 0.06),
      { tile: 0.25, ou: rand(), ov: rand() });
  }
  return y + n * 0.185 + 0.02;
}

// 空托盘垛：n 块，略微错位
export function palletPile(ctx, m, rand, n) {
  for (let i = 0; i < n; i++) pallet(ctx, at(m, (rand() - 0.5) * 0.05, i * PALLET_H, (rand() - 0.5) * 0.05, (rand() - 0.5) * 0.06), rand);
  return n * PALLET_H;
}
