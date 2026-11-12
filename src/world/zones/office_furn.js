import { xf, box, rbox, cyl } from '../../gfx/geo.js';
import { decalQuad } from '../labels.js';
import { veneer, cartonUV } from './office_mats.js';

// 办公家具：桌、椅、显示器、工位组、文件柜、铁皮柜、货架、沙发、会议桌。
// 局部坐标：x 是宽，z 是进深，+z 是人坐 / 站的那一面。家具都按真实尺寸做。

// 局部坐标系：add 放几何体，solid 登记碰撞体，decal 贴图集贴花（原点左下，朝 +z）
export function frame(ctx, x, y, z, ry = 0, rz = 0) {
  const m = xf(x, y, z, 0, ry, rz);
  return {
    m,
    add(mat, geo, lx, ly, lz, { rx = 0, ry: r2 = 0, rz: r3 = 0, tile } = {}) {
      ctx.batch.add(mat, geo, m.clone().multiply(xf(lx, ly, lz, rx, r2, r3)), tile ? { tile } : {});
    },
    solid(lx, ly, lz, hx, hy, hz, surface = 'wood') { return ctx.phys.solid(m, lx, ly, lz, hx, hy, hz, surface); },
    decal(rect, w, h, lx, ly, lz, r2 = 0) {
      ctx.decals.add(ctx.atlas.material, decalQuad(w, h, rect), m.clone().multiply(xf(lx, ly, lz, 0, r2, 0)).multiply(xf(-w / 2, -h / 2, 0)));
    },
  };
}

// 显示器屏幕上的界面：画成半透明的深色块，压在发光屏前面，读起来就是屏上有内容
const SCREENS = 4;
function screenUI(ctx, i) {
  return ctx.atlas.cached(`office|screen${i}`, 256, 160, (c, w, h) => {
    const r = ctx.rand;
    c.fillStyle = 'rgba(8,14,26,0.85)'; c.fillRect(0, 0, w, 14);
    if (i === 0) { // 表格
      for (let y = 22; y < h - 6; y += 11) {
        c.fillStyle = `rgba(10,20,36,${0.35 + r() * 0.3})`;
        for (let x = 8; x < w - 30; x += 46) c.fillRect(x, y, 20 + r() * 20, 5);
      }
    } else if (i === 1) { // 监控画面四宫格
      c.fillStyle = 'rgba(6,10,14,0.9)'; c.fillRect(0, 14, w, h - 14);
      c.fillStyle = 'rgba(120,140,150,0.35)';
      for (const [x, y] of [[4, 18], [130, 18], [4, 88], [130, 88]]) { c.fillRect(x, y, 122, 66); }
      c.fillStyle = 'rgba(6,10,14,0.8)';
      for (const [x, y] of [[20, 50], [150, 30], [40, 110], [160, 120]]) c.fillRect(x, y, 40 + r() * 40, 20 + r() * 20);
    } else if (i === 2) { // 曲线图
      c.fillStyle = 'rgba(10,20,36,0.7)'; c.fillRect(0, 14, 48, h - 14);
      c.strokeStyle = 'rgba(8,16,30,0.85)'; c.lineWidth = 3; c.beginPath();
      for (let x = 60; x < w - 8; x += 8) c.lineTo(x, 110 - Math.sin(x * 0.05) * 30 - r() * 20);
      c.stroke();
    } else { // 文档
      c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(30, 20, w - 60, h - 20);
      c.fillStyle = 'rgba(10,18,30,0.55)';
      for (let y = 30; y < h - 8; y += 9) c.fillRect(40, y, 60 + r() * 110, 3);
    }
  });
}

export function monitor(ctx, M, f, lx, ly, lz, on = true, ry = 0) {
  const { mats } = ctx;
  f.add(M.plastic, box(0.22, 0.015, 0.17), lx, ly + 0.008, lz);
  f.add(M.plastic, box(0.05, 0.3, 0.025), lx, ly + 0.16, lz - 0.04, { ry });
  const sy = ly + 0.36, bz = lz - 0.01, nx = Math.sin(ry), nz = Math.cos(ry);
  f.add(M.plastic, rbox(0.62, 0.38, 0.035, 0.006, 1), lx, sy, bz, { ry });
  if (!on) return;
  // 屏幕贴在边框前面 2 cm，界面贴花再往前 3 mm
  f.add(M.screen, box(0.585, 0.335, 0.004), lx + nx * 0.0195, sy + 0.012, bz + nz * 0.0195, { ry });
  f.decal(screenUI(ctx, Math.floor(ctx.rand() * SCREENS)), 0.585, 0.335, lx + nx * 0.0225, sy + 0.012, bz + nz * 0.0225, ry);
}

// 办公桌：木纹台面、钢架腿、挡板、活动柜，可选显示器
export function desk(ctx, M, o) {
  const { mats, rand } = ctx;
  const w = o.w ?? 1.6, d = o.d ?? 0.8, h = 0.74;
  const f = frame(ctx, o.x, o.y, o.z, o.ry ?? 0);
  f.add(M.laminate, veneer(rbox(w, 0.03, d, 0.008, 1)), 0, h - 0.015, 0);
  for (const s of [-1, 1]) {
    for (const zz of [-d / 2 + 0.07, d / 2 - 0.07]) f.add(M.furn, box(0.05, h - 0.03, 0.05), s * (w / 2 - 0.06), (h - 0.03) / 2, zz);
    f.add(M.furn, box(0.06, 0.03, d - 0.06), s * (w / 2 - 0.06), 0.015, 0);
    f.add(M.furn, box(0.04, 0.05, d - 0.14), s * (w / 2 - 0.06), h - 0.055, 0);
  }
  f.add(M.furn, box(w - 0.16, 0.32, 0.012), 0, h - 0.24, -d / 2 + 0.06);
  if (o.pedestal !== false) {
    const px = w / 2 - 0.3, pz = d / 2 - 0.33;
    f.add(M.furn, rbox(0.42, 0.58, 0.55, 0.01, 1), px, 0.31, pz);
    for (const [y, hh] of [[0.52, 0.12], [0.37, 0.14], [0.16, 0.24]]) {
      f.add(M.furn, box(0.4, hh - 0.012, 0.01), px, y, pz + 0.278);
      f.add(mats.galvIn, box(0.12, 0.012, 0.02), px, y + hh / 2 - 0.035, pz + 0.29, { tile: 1.2 });
    }
  }
  if (o.monitor !== false) {
    const n = o.dual ? 2 : 1;
    for (let i = 0; i < n; i++) monitor(ctx, M, f, (i - (n - 1) / 2) * 0.62, h, -d / 2 + 0.2, o.on ?? rand() > 0.25, n > 1 ? (i ? -0.18 : 0.18) : 0);
    f.add(M.plastic, box(0.44, 0.02, 0.14), 0, h + 0.01, 0.08);
    f.add(M.plastic, box(0.06, 0.02, 0.1), 0.34, h + 0.01, 0.1);
  }
  // 桌上散着的纸
  for (let i = 0; i < 2; i++) if (rand() < 0.6) f.add(M.wall, box(0.21, 0.002, 0.297), -w / 2 + 0.3 + rand() * 0.3, h + 0.002 + i * 0.002, 0.05 + rand() * 0.15, { ry: rand() - 0.5 });
  if (o.collide !== false) f.solid(0, h / 2, 0, w / 2, h / 2, d / 2, 'wood');
  return f;
}

// 办公椅：五星脚、气杆、座垫、靠背、扶手。没有碰撞（算小杂物）。fallen：侧翻在地上
export function chair(ctx, M, o) {
  const { mats } = ctx;
  const f = o.fallen ? frame(ctx, o.x, (o.y ?? 0) + 0.3, o.z, o.ry ?? 0, Math.PI / 2) : frame(ctx, o.x, o.y, o.z, o.ry ?? 0);
  const k = M.plastic;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    // 星脚末端往下折一点，当脚轮
    f.add(k, box(0.3, 0.035, 0.045), Math.cos(a) * 0.15, 0.07, Math.sin(a) * 0.15, { ry: -a, rz: -0.12 });
  }
  f.add(mats.steelIn, cyl(0.025, 0.025, 0.34, 8), 0, 0.27, 0, { tile: 1.2 });
  f.add(M.fabric, rbox(0.5, 0.08, 0.48, 0.03, 1), 0, 0.48, 0, { tile: 0.25 });
  f.add(k, box(0.04, 0.32, 0.03), 0, 0.62, -0.25, { rx: -0.08 });
  f.add(M.fabric, rbox(0.46, 0.52, 0.06, 0.03, 1), 0, 0.88, -0.27, { rx: -0.1, tile: 0.25 });
  for (const s of [-1, 1]) {
    f.add(k, box(0.03, 0.2, 0.03), s * 0.25, 0.6, 0.02);
    f.add(k, box(0.06, 0.03, 0.24), s * 0.25, 0.71, 0.03);
  }
}

// 工位组：两排背靠背，中间一道布面隔断。cols 是每排几张桌
export function pod(ctx, M, { x, y, z, ry = 0, cols = 2, empty = [] }) {
  const { rand } = ctx;
  const f = frame(ctx, x, y, z, ry);
  const W = 1.6, D = 0.8, h = 0.74;
  let n = 0;
  for (const s of [-1, 1]) {
    for (let c = 0; c < cols; c++) {
      const lx = (c - (cols - 1) / 2) * W;
      const p = { x: lx, z: s * D / 2 };
      p.ry = s > 0 ? 0 : Math.PI;
      // 局部坐标换到世界
      const c0 = Math.cos(ry), s0 = Math.sin(ry);
      const wx = x + p.x * c0 + p.z * s0, wz = z - p.x * s0 + p.z * c0;
      desk(ctx, M, { x: wx, y, z: wz, ry: ry + p.ry, collide: false, monitor: !empty.includes(n), dual: rand() < 0.3 });
      const cz = s * (D + 0.32 + rand() * 0.25), cx = lx + (rand() - 0.5) * 0.3;
      chair(ctx, M, { x: x + cx * c0 + cz * s0, y, z: z - cx * s0 + cz * c0, ry: ry + p.ry + Math.PI + (rand() - 0.5) * 0.8 });
      n++;
    }
  }
  const L = cols * W;
  f.add(M.fabric, rbox(L, 0.46, 0.05, 0.015, 1), 0, h + 0.23, 0, { tile: 0.25 });
  f.add(ctx.mats.galvIn, box(L + 0.02, 0.025, 0.06), 0, h + 0.47, 0, { tile: 1.2 });
  for (const s of [-1, 1]) f.add(M.fabric, rbox(0.05, h + 0.46, D * 2, 0.015, 1), s * (L / 2 + 0.025), (h + 0.46) / 2, 0, { tile: 0.25 });
  f.solid(0, h / 2, 0, L / 2 + 0.05, h / 2, D, 'wood');
  f.solid(0, h + 0.24, 0, L / 2, 0.24, 0.03, 'wood');
  return { w: L + 0.1, d: D * 2 };
}

// 文件柜（抽屉）或铁皮柜（对开门）。h 0.72 / 1.03 / 1.32 是抽屉柜，> 1.6 是对开门的高柜
export function cabinet(ctx, M, { x, y, z, ry = 0, w = 0.9, d = 0.46, h = 1.32, fallen = false }) {
  const { mats } = ctx;
  // 倒地的柜子：绕局部 x 轴转 -90°，正面朝天，躺下后居中在原点
  const base = xf(x, y, z, 0, ry, 0);
  const m = fallen ? base.clone().multiply(xf(0, d / 2, h / 2, -Math.PI / 2, 0, 0)) : base;
  const put = (mat, g, lx, ly, lz) => ctx.batch.add(mat, g, m.clone().multiply(xf(lx, ly, lz)), mat === M.furn ? {} : { tile: 1.2 });
  const f = { solid: (...a) => ctx.phys.solid(base, ...a) };
  put(M.furn, rbox(w, h, d, 0.01, 1), 0, h / 2, 0);
  if (h > 1.6) {
    for (const s of [-1, 1]) {
      put(M.furn, box(w / 2 - 0.02, h - 0.1, 0.012), s * (w / 4), h / 2 + 0.02, d / 2 + 0.004);
      put(mats.galvIn, box(0.015, 0.16, 0.02), s * 0.04, h * 0.55, d / 2 + 0.018);
    }
  } else {
    const n = Math.round(h / 0.33), dh = (h - 0.04) / n;
    for (let i = 0; i < n; i++) {
      const cy = 0.02 + dh * (i + 0.5);
      put(M.furn, box(w - 0.04, dh - 0.016, 0.012), 0, cy, d / 2 + 0.004);
      put(mats.galvIn, box(0.16, 0.014, 0.022), 0, cy + dh * 0.28, d / 2 + 0.018);
      put(M.wall, box(0.07, 0.035, 0.004), 0, cy + dh * 0.12, d / 2 + 0.012);
    }
  }
  if (fallen) f.solid(0, d / 2, 0, w / 2, d / 2, h / 2, 'metal');
  else f.solid(0, h / 2, 0, w / 2, h / 2, d / 2, 'metal');
}

// 钢货架：四根角钢立柱、几层隔板，上面堆纸箱
export function shelving(ctx, M, { x, y, z, ry = 0, w = 1.2, d = 0.5, h = 2.0, levels = 5, fill = 0.75 }) {
  const { mats, rand } = ctx;
  const f = frame(ctx, x, y, z, ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.add(M.furn, box(0.04, h, 0.04), sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02));
  for (let i = 0; i < levels; i++) {
    const ly = 0.1 + (i * (h - 0.15)) / (levels - 1);
    f.add(mats.galvIn, box(w, 0.025, d), 0, ly, 0, { tile: 1.2 });
    let cx = -w / 2 + 0.04;
    while (cx < w / 2 - 0.25) {
      const bw = 0.25 + rand() * 0.25, bh = 0.18 + rand() * 0.2;
      if (cx + bw > w / 2 - 0.03) break;
      if (rand() < fill && i < levels - 1) f.add(M.cardboard, cartonUV(box(bw - 0.02, Math.min(bh, (h - 0.15) / (levels - 1) - 0.06), d * (0.7 + rand() * 0.25))), cx + bw / 2, ly + 0.0125 + Math.min(bh, (h - 0.15) / (levels - 1) - 0.06) / 2, (rand() - 0.5) * 0.05, { ry: (rand() - 0.5) * 0.1 });
      cx += bw;
    }
  }
  f.solid(0, h / 2, 0, w / 2, h / 2, d / 2, 'metal');
}

// 布艺沙发：底座、坐垫、靠背、扶手
export function sofa(ctx, M, { x, y, z, ry = 0, w = 1.9, mat }) {
  const m = mat ?? M.fabric, T = { tile: 0.25 };
  const f = frame(ctx, x, y, z, ry);
  f.add(M.plastic, box(w - 0.1, 0.1, 0.75), 0, 0.05, 0);
  f.add(m, rbox(w - 0.3, 0.2, 0.62, 0.05, 1), 0, 0.33, 0.06, T);
  f.add(m, rbox(w, 0.62, 0.2, 0.05, 1), 0, 0.53, -0.3, { ...T, rx: -0.08 });
  for (const s of [-1, 1]) f.add(m, rbox(0.18, 0.58, 0.8, 0.05, 1), s * (w / 2 - 0.09), 0.36, 0, T);
  f.solid(0, 0.4, 0, w / 2, 0.4, 0.4, 'carpet');
}

// 会议桌 / 茶水桌。fallen：掀翻成侧立，台面朝外当掩体
export function table(ctx, M, { x, y, z, ry = 0, w = 2.4, d = 1.1, h = 0.74, fallen = false, round = false }) {
  const { mats } = ctx;
  if (fallen) {
    const f = frame(ctx, x, y, z, ry);
    f.add(M.laminate, veneer(rbox(w, d, 0.04, 0.01, 1)), 0, d / 2, 0);
    for (const s of [-1, 1]) f.add(M.furn, box(0.05, 0.05, h - 0.04), s * (w / 2 - 0.12), d - 0.12, -(h - 0.04) / 2 - 0.02);
    for (const s of [-1, 1]) f.add(M.furn, box(0.05, 0.05, h - 0.04), s * (w / 2 - 0.12), 0.12, -(h - 0.04) / 2 - 0.02);
    f.solid(0, d / 2, 0, w / 2, d / 2, 0.04, 'wood');
    return;
  }
  const f = frame(ctx, x, y, z, ry);
  if (round) {
    f.add(M.laminate, veneer(cyl(w / 2, w / 2, 0.03, 24)), 0, h - 0.015, 0);
    f.add(mats.steelIn, cyl(0.04, 0.04, h - 0.03, 10), 0, (h - 0.03) / 2, 0, { tile: 1.2 });
    f.add(mats.steelIn, cyl(0.26, 0.28, 0.03, 16), 0, 0.015, 0, { tile: 1.2 });
    ctx.phys.addCyl(x, z, w / 2, y, y + h, 'wood');
    return;
  }
  f.add(M.laminate, veneer(rbox(w, 0.04, d, 0.012, 1)), 0, h - 0.02, 0);
  for (const s of [-1, 1]) {
    f.add(M.furn, box(0.06, h - 0.04, d - 0.3), s * (w / 2 - 0.25), (h - 0.04) / 2, 0);
    f.add(M.furn, box(0.1, 0.03, d - 0.2), s * (w / 2 - 0.25), 0.015, 0);
  }
  f.solid(0, h / 2, 0, w / 2, h / 2, d / 2, 'wood');
}
