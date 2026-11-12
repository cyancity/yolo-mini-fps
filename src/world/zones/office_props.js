import { xf, box, rbox, cyl } from '../../gfx/geo.js';
import { STENCIL_FONT } from '../labels.js';
import { frame } from './office_furn.js';
import { veneer, cartonUV } from './office_mats.js';
import { UI_FONT } from './office_layout.js';

// 办公楼的设备和墙上零件：机柜、精密空调、自动售货机、复印机、更衣柜、茶水台、
// 白板、公告栏、挂钟、灭火器、空调内机、暖气片、门扇、百叶帘、地上的杂物。

// 一排机柜：正面是一层层服务器面板和闪烁的指示灯，顶上走线槽
export function rackRow(ctx, M, { x, y, z, ry = 0, n = 6, w = 0.6, d = 1.0, h = 2.0, tag = 'A' }) {
  const { mats, rand } = ctx;
  const f = frame(ctx, x, y, z, ry);
  const U = 0.0445;
  for (let i = 0; i < n; i++) {
    const lx = (i - (n - 1) / 2) * w;
    f.add(M.plastic, box(w - 0.012, h, d), lx, h / 2, 0, { tile: 0.3 });
    f.add(mats.steelIn, box(w - 0.02, 0.05, 0.02), lx, h - 0.03, d / 2 + 0.01, { tile: 1.2 });
    for (const s of [-1, 1]) f.add(mats.steelIn, box(0.03, h - 0.12, 0.02), lx + s * (w / 2 - 0.035), h / 2, d / 2 + 0.01, { tile: 1.2 });
    let uy = 0.12;
    while (uy < h - 0.12) {
      const size = rand() < 0.55 ? 1 : rand() < 0.7 ? 2 : 4, uh = size * U;
      if (uy + uh > h - 0.1) break;
      if (rand() < 0.18) { uy += uh; continue; } // 空槽
      const silver = rand() < 0.45;
      f.add(silver ? M.furn : M.plastic, box(0.48, uh - 0.004, 0.02), lx, uy + uh / 2, d / 2 + 0.012, { tile: 0.3 });
      const leds = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < leds; k++) f.add(M.led, box(0.011, 0.008, 0.004), lx - 0.2 + k * 0.03 + rand() * 0.01, uy + uh * 0.5, d / 2 + 0.024);
      uy += uh;
    }
    const tagRect = ctx.atlas.cached(`office|rack${tag}${i}`, 96, 40, (c, cw, ch) => {
      c.fillStyle = '#e8e6df'; c.fillRect(0, 0, cw, ch);
      c.fillStyle = '#16181a'; c.font = `700 28px ${STENCIL_FONT}`; c.textAlign = 'center';
      c.fillText(`${tag}${String(i + 1).padStart(2, '0')}`, cw / 2, 30);
    });
    f.decal(tagRect, 0.12, 0.05, lx, h - 0.03, d / 2 + 0.021);
  }
  // 顶上的梯式线槽
  const L = n * w;
  for (const s of [-1, 1]) f.add(mats.galvIn, box(L, 0.08, 0.02), 0, h + 0.35, s * 0.15, { tile: 1.2 });
  for (let i = 0; i <= n * 2; i++) f.add(mats.galvIn, box(0.03, 0.015, 0.3), -L / 2 + (i * L) / (n * 2), h + 0.315, 0, { tile: 1.2 });
  for (let i = 0; i < n; i++) f.add(M.plastic, box(0.05, 0.08, 0.24), (i - (n - 1) / 2) * w - 0.12, h + 0.36, 0);
  f.solid(0, h / 2, 0, L / 2, h / 2, d / 2, 'metal');
}

// 精密空调：机身、出风格栅、一块小显示屏
export function crac(ctx, M, { x, y, z, ry = 0, w = 0.6, d = 1.0, h = 2.0 }) {
  const f = frame(ctx, x, y, z, ry);
  f.add(M.wall, rbox(w, h, d, 0.01, 1), 0, h / 2, 0);
  for (let i = 0; i < 14; i++) f.add(M.plastic, box(w - 0.1, 0.012, 0.01), 0, 0.4 + i * 0.05, d / 2 + 0.003);
  f.add(M.plastic, box(0.16, 0.1, 0.01), 0, 1.6, d / 2 + 0.004);
  f.add(M.screen, box(0.13, 0.07, 0.004), 0, 1.6, d / 2 + 0.01);
  f.solid(0, h / 2, 0, w / 2, h / 2, d / 2, 'metal');
}

// 自动售货机：发光的陈列窗 + 画在图集上的货品（压在发光面前）
export function vending(ctx, M, { x, y, z, ry = 0 }) {
  const { mats } = ctx;
  const f = frame(ctx, x, y, z, ry);
  const w = 0.92, h = 1.83, d = 0.8;
  f.add(M.accent, rbox(w, h, d, 0.02, 1), 0, h / 2, 0, { tile: 3 });
  f.add(M.screen, box(0.62, 1.2, 0.01), -0.1, 1.12, d / 2 + 0.006);
  const goods = ctx.atlas.cached('office|vending', 192, 384, (c, cw, ch) => {
    const cols = ['#b8322a', '#2a6cb8', '#e0b52c', '#2f9a52', '#d8d8d8', '#7a3fa0'];
    for (let r = 0; r < 6; r++) {
      const yy = 12 + r * 62;
      c.fillStyle = 'rgba(30,30,32,0.75)'; c.fillRect(0, yy + 50, cw, 5);
      for (let k = 0; k < 6; k++) {
        c.fillStyle = cols[(r * 2 + k) % cols.length];
        c.fillRect(8 + k * 30, yy + 8, 22, 42);
        c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(10 + k * 30, yy + 14, 4, 30);
      }
    }
  });
  f.decal(goods, 0.6, 1.18, -0.1, 1.12, d / 2 + 0.013);
  f.add(mats.glass, box(0.64, 1.24, 0.008), -0.1, 1.12, d / 2 + 0.02);
  f.add(M.plastic, box(0.18, 0.5, 0.02), 0.33, 1.3, d / 2 + 0.01);
  f.add(M.screen, box(0.1, 0.04, 0.004), 0.33, 1.45, d / 2 + 0.022);
  f.add(M.plastic, box(0.6, 0.18, 0.04), -0.1, 0.3, d / 2 + 0.01);
  f.solid(0, h / 2, 0, w / 2, h / 2, d / 2, 'metal');
}

// 大型复印机：机身、扫描盖、触摸屏、纸盒
export function copier(ctx, M, { x, y, z, ry = 0 }) {
  const { mats } = ctx;
  const f = frame(ctx, x, y, z, ry);
  f.add(M.wall, rbox(0.62, 0.95, 0.66, 0.02, 1), 0, 0.475, 0);
  for (let i = 0; i < 3; i++) f.add(M.plastic, box(0.56, 0.008, 0.01), 0, 0.15 + i * 0.16, 0.335);
  f.add(M.plastic, rbox(0.6, 0.08, 0.5, 0.01, 1), 0, 1.0, -0.03);
  f.add(M.plastic, box(0.24, 0.02, 0.14), 0.12, 1.06, 0.26, { rx: 0.4 });
  f.add(M.screen, box(0.18, 0.005, 0.1), 0.12, 1.072, 0.262, { rx: 0.4 });
  f.add(M.wall, box(0.3, 0.02, 0.22), -0.42, 0.75, 0.05);
  f.solid(0, 0.5, 0, 0.31, 0.5, 0.33, 'metal');
}

// 一组更衣柜：每格一扇门，带百叶和锁
export function lockers(ctx, M, { x, y, z, ry = 0, cols = 3 }) {
  const { mats } = ctx;
  const f = frame(ctx, x, y, z, ry);
  const cw = 0.4, h = 1.85, d = 0.5, L = cols * cw;
  f.add(M.furn, rbox(L, h, d, 0.01, 1), 0, h / 2, 0);
  for (let i = 0; i < cols; i++) {
    const lx = (i - (cols - 1) / 2) * cw;
    for (const [yy, hh] of [[0.06, 0.86], [0.96, 0.84]]) {
      f.add(M.furn, box(cw - 0.03, hh, 0.012), lx, yy + hh / 2, d / 2 + 0.004);
      for (let k = 0; k < 4; k++) f.add(M.plastic, box(0.2, 0.01, 0.006), lx, yy + hh - 0.1 - k * 0.025, d / 2 + 0.011);
      f.add(mats.galvIn, box(0.02, 0.06, 0.02), lx + 0.13, yy + hh * 0.5, d / 2 + 0.016, { tile: 1.2 });
    }
  }
  f.solid(0, h / 2, 0, L / 2, h / 2, d / 2, 'metal');
}

// 茶水台：地柜、台面、水槽、吊柜、冰箱、微波炉、咖啡机。len 是台面长
export function kitchen(ctx, M, { x, y, z, ry = 0, len = 2.8 }) {
  const { mats } = ctx;
  const f = frame(ctx, x, y, z, ry);
  const d = 0.6, h = 0.9;
  f.add(M.wall, box(len, h - 0.1, d - 0.05), 0, (h - 0.1) / 2 + 0.1, -0.025, { tile: 3 });
  f.add(M.plastic, box(len, 0.1, d - 0.1), 0, 0.05, -0.05);
  for (let i = 0; i < Math.floor(len / 0.6); i++) {
    const lx = -len / 2 + 0.3 + i * 0.6;
    f.add(M.wall, box(0.58, h - 0.14, 0.018), lx, (h - 0.12) / 2 + 0.1, d / 2 - 0.04, { tile: 3 });
    f.add(mats.steelIn, box(0.12, 0.012, 0.02), lx, h - 0.12, d / 2 - 0.02, { tile: 1.2 });
  }
  f.add(M.laminate, veneer(box(len + 0.02, 0.035, d)), 0, h + 0.0175, 0);
  f.add(mats.steelIn, box(0.5, 0.012, 0.38), -len / 2 + 0.7, h + 0.03, 0, { tile: 1.2 });
  f.add(mats.steelIn, cyl(0.015, 0.015, 0.3, 8), -len / 2 + 0.7, h + 0.18, -0.22, { tile: 1.2 });
  // 吊柜
  f.add(M.wall, box(len, 0.7, 0.35), 0, 1.85, -d / 2 + 0.175, { tile: 3 });
  for (let i = 0; i < Math.floor(len / 0.6); i++) f.add(mats.steelIn, box(0.012, 0.1, 0.02), -len / 2 + 0.55 + i * 0.6, 1.6, -d / 2 + 0.36, { tile: 1.2 });
  // 微波炉、咖啡机
  f.add(M.plastic, rbox(0.5, 0.3, 0.38, 0.01, 1), len / 2 - 0.45, h + 0.185, -0.05);
  f.add(mats.glass, box(0.32, 0.2, 0.005), len / 2 - 0.5, h + 0.185, 0.143);
  f.add(M.screen, box(0.06, 0.02, 0.004), len / 2 - 0.27, h + 0.27, 0.143);
  f.add(M.plastic, rbox(0.25, 0.38, 0.32, 0.02, 1), len / 2 - 1.05, h + 0.225, -0.08);
  f.solid(0, h / 2, 0, len / 2, h / 2, d / 2, 'wood');
  // 冰箱（在台面右端外）
  f.add(M.wall, rbox(0.7, 1.85, 0.68, 0.02, 1), len / 2 + 0.37, 0.925, 0.02, { tile: 3 });
  f.add(M.plastic, box(0.68, 0.006, 0.01), len / 2 + 0.37, 1.25, 0.365);
  for (const yy of [0.95, 1.5]) f.add(mats.steelIn, box(0.02, 0.3, 0.03), len / 2 + 0.07, yy, 0.38, { tile: 1.2 });
  f.solid(len / 2 + 0.37, 0.925, 0.02, 0.35, 0.925, 0.34, 'metal');
}

// 白板：铝框、白色板面、笔槽，板面上画着手写的排班和示意图
export function whiteboard(ctx, M, { x, y, z, ry = 0, w = 1.8, h = 1.1, key = 'wb' }) {
  const { mats } = ctx;
  const f = frame(ctx, x, y, z, ry);
  f.add(mats.galvIn, box(w + 0.04, h + 0.04, 0.025), 0, 0, 0.0125, { tile: 1.2 });
  f.add(M.wall, box(w, h, 0.004), 0, 0, 0.027, { tile: 3 });
  f.add(mats.galvIn, box(w * 0.6, 0.02, 0.06), 0, -h / 2 - 0.02, 0.04, { tile: 1.2 });
  const rect = ctx.atlas.cached(`office|${key}`, 512, 312, (c, cw, ch) => {
    const r = ctx.rand;
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = 'rgba(28,60,140,0.85)'; c.lineWidth = 3;
    c.font = `500 30px ${UI_FONT}`; c.fillStyle = 'rgba(28,60,140,0.85)';
    c.fillText('夜班调度 02:00', 24, 44);
    for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(24, 80 + i * 34); c.lineTo(140 + r() * 120, 80 + i * 34 + (r() - 0.5) * 4); c.stroke(); }
    c.strokeStyle = 'rgba(170,30,30,0.85)'; c.lineWidth = 4;
    c.strokeRect(300, 70, 160, 110);
    c.beginPath(); c.moveTo(300, 125); c.lineTo(250, 220); c.lineTo(420, 250); c.stroke();
    c.fillStyle = 'rgba(170,30,30,0.85)'; c.font = `700 28px ${STENCIL_FONT}`; c.fillText('B-07 ?', 330, 135);
  });
  f.decal(rect, w * 0.92, h * 0.88, 0, 0.02, 0.0295);
}

// 公告栏：软木板 + 几张纸
export function noticeBoard(ctx, M, { x, y, z, ry = 0, w = 1.2, h = 0.9 }) {
  const { rand } = ctx;
  const f = frame(ctx, x, y, z, ry);
  f.add(ctx.mats.woodIn, box(w + 0.05, h + 0.05, 0.02), 0, 0, 0.01, { tile: 0.9 });
  f.add(M.cork, box(w, h, 0.012), 0, 0, 0.022, { tile: 0.9 });
  for (let i = 0; i < 6; i++) {
    const pw = 0.21, ph = 0.297, lx = -w / 2 + 0.15 + rand() * (w - 0.3), ly = -h / 2 + 0.2 + rand() * (h - 0.4);
    f.add(M.wall, box(pw, ph, 0.002), lx, ly, 0.03 + i * 0.001, { rz: (rand() - 0.5) * 0.15 });
  }
}

// 挂钟
export function clock(ctx, M, { x, y, z, ry = 0 }) {
  const f = frame(ctx, x, y, z, ry);
  f.add(M.plastic, cyl(0.16, 0.16, 0.04, 24), 0, 0, 0.02, { rx: Math.PI / 2 });
  f.add(M.wall, cyl(0.14, 0.14, 0.004, 24), 0, 0, 0.041, { rx: Math.PI / 2 });
  f.add(M.plastic, box(0.008, 0.11, 0.003), 0.02, 0.04, 0.045, { rz: -0.5 });
  f.add(M.plastic, box(0.01, 0.07, 0.003), -0.025, -0.02, 0.046, { rz: 2.2 });
}

// 灭火器：挂在墙上的红瓶子，上方一块指示牌
export function extinguisher(ctx, M, { x, y, z, ry = 0 }) {
  const { mats } = ctx;
  const f = frame(ctx, x, y, z, ry);
  const red = M.red;
  f.add(red, cyl(0.075, 0.075, 0.48, 14), 0, 0.55, 0.1, { tile: 5.2 });
  f.add(M.plastic, box(0.05, 0.08, 0.05), 0, 0.84, 0.1);
  f.add(M.plastic, cyl(0.012, 0.012, 0.35, 6), 0.08, 0.6, 0.12);
  f.add(mats.steelIn, box(0.12, 0.04, 0.12), 0, 0.5, 0.06, { tile: 1.2 });
  const sign = ctx.atlas.cached('office|ext', 128, 160, (c, cw, ch) => {
    c.fillStyle = '#b3201a'; c.fillRect(0, 0, cw, ch);
    c.fillStyle = '#fff'; c.textAlign = 'center';
    c.fillRect(48, 40, 32, 80); c.fillRect(56, 26, 16, 16);
    c.font = `700 26px ${UI_FONT}`; c.fillText('灭火器', cw / 2, 150);
  });
  f.decal(sign, 0.2, 0.25, 0, 1.2, 0.003);
}

// 空调内机（挂墙）
export function acUnit(ctx, M, { x, y, z, ry = 0 }) {
  const f = frame(ctx, x, y, z, ry);
  f.add(M.wall, rbox(0.95, 0.3, 0.22, 0.04, 2), 0, 0, 0.11, { tile: 3 });
  f.add(M.plastic, box(0.8, 0.03, 0.02), 0, -0.13, 0.2);
  f.add(M.screen, box(0.03, 0.01, 0.004), 0.36, -0.05, 0.221);
}

// 窗下暖气片
export function radiator(ctx, M, { x, y, z, ry = 0, w = 1.2 }) {
  const f = frame(ctx, x, y, z, ry);
  for (let i = 0; i < Math.round(w / 0.06); i++) f.add(M.wall, box(0.035, 0.55, 0.08), -w / 2 + 0.03 + i * 0.06, 0.45, 0.07, { tile: 3 });
  f.add(ctx.mats.steelIn, cyl(0.012, 0.012, w, 8), 0, 0.2, 0.07, { rz: Math.PI / 2, tile: 1.2 });
}

// 门扇：开到 90° 贴着墙。wood 为 false 时是带观察窗的钢质防火门
export function doorLeaf(ctx, M, { x, y, z, ry = 0, w = 1.0, h = 2.05, wood = true }) {
  const { mats } = ctx;
  const f = frame(ctx, x, y, z, ry);
  f.add(wood ? M.laminate : M.furn, wood ? veneer(rbox(w, h, 0.045, 0.006, 1), 1.2, true) : rbox(w, h, 0.045, 0.006, 1), 0, h / 2 + 0.01, 0);
  if (!wood) {
    f.add(mats.glass, box(0.2, 0.6, 0.05), w * 0.15, 1.45, 0);
    f.add(mats.steelIn, box(w * 0.7, 0.04, 0.05), 0, 1.0, 0.05, { tile: 1.2 });
  }
  for (const s of [-1, 1]) f.add(mats.steelIn, box(0.12, 0.02, 0.03), w / 2 - 0.1, 1.05, s * 0.04, { tile: 1.2 });
  f.solid(0, h / 2, 0, w / 2, h / 2, 0.025, wood ? 'wood' : 'metal');
}

// 百叶帘：横向铝片微微斜着，放下一截。along 是窗所在墙的走向（'x' 或 'z'），at 是帘子所在的那条线
export function blinds(ctx, M, { a, b, top, drop, along, at }) {
  const len = b - a, n = Math.max(2, Math.round(drop / 0.05)), c = (a + b) / 2;
  const ry = along === 'x' ? 0 : Math.PI / 2;
  const put = (mat, g, yy, rx) => ctx.batch.add(mat, g, along === 'x' ? xf(c, yy, at, rx, ry, 0) : xf(at, yy, c, rx, ry, 0), mat === M.wall ? { tile: 3 } : {});
  for (let i = 0; i < n; i++) put(M.wall, box(len - 0.04, 0.003, 0.05), top - 0.06 - i * 0.05, 0.5);
  put(M.wall, box(len, 0.04, 0.06), top - 0.03, 0);
  put(M.furn, box(len - 0.03, 0.02, 0.05), top - 0.08 - n * 0.05, 0);
}

// 地上的杂物：散落的纸、文件夹、纸箱
export function litter(ctx, M, { x0, x1, z0, z1, y, n = 8, boxes = 0 }) {
  const { rand } = ctx;
  for (let i = 0; i < n; i++) {
    const f = frame(ctx, x0 + rand() * (x1 - x0), y, z0 + rand() * (z1 - z0), rand() * 6);
    f.add(M.wall, box(0.21, 0.002, 0.297), 0, 0.003 + rand() * 0.004, 0);
  }
  for (let i = 0; i < boxes; i++) {
    const f = frame(ctx, x0 + rand() * (x1 - x0), y, z0 + rand() * (z1 - z0), rand() * 6);
    const s = 0.28 + rand() * 0.1;
    f.add(M.cardboard, cartonUV(box(s * 1.3, s, s)), 0, s / 2, 0);
  }
}
