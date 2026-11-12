import { xf, box, rbox, cylBetween } from '../../gfx/geo.js';
import { decalQuad, distress, STENCIL_FONT } from '../labels.js';
import { ROOF } from '../plan.js';

// 仓库屋面南沿朝堆场的大招牌：钢框架 + 槽形发光字 “DOCK 0”。
// 立柱站在女儿墙后面的屋面上，斜撑往北落到屋面；字面自发光，K 的下撇接触不良会闪。
const SX = -4, Y0 = ROOF.warehouse.y, ZP = ROOF.warehouse.z1 - 0.45;
const LH = 2.8, T = 0.36, DEPTH = 0.2, GAP = 0.45, SPACE = 0.8, LY = Y0 + 1.35;
const ZF = ROOF.warehouse.z1 - 0.08; // 字面
const G = { tile: 1.2 }, P = { tile: 5.2 };

// 字形：笔画中心线 [x0, y0, x1, y1, 两端加长, 闪]；字框宽 w、高 LH
function glyphs() {
  const L = T / 2, B = T / 2, Tp = LH - T / 2, c = 0.55, e = 0.075;
  const ring = (w, open) => {
    const R = w - T / 2;
    const s = [[L + c, B, R - c, B, e], [R - c, B, R, B + c, e], [R - c, Tp, L + c, Tp, e], [R, Tp - c, R - c, Tp, e],
      [L + c, Tp, L, Tp - c, e], [L, Tp - c, L, B + c, e], [L, B + c, L + c, B, e]];
    if (open) s.push([R, B + c, R, B + c + 0.18, e], [R, Tp - c, R, Tp - c - 0.18, e]);
    else s.push([R, B + c, R, Tp - c, e]);
    return s;
  };
  const W = 2.0, R = W - T / 2;
  return [
    { w: W, s: [[L, B, L, Tp, T / 2], [L, Tp, R - c, Tp, e], [R - c, Tp, R, Tp - c, e], [R, Tp - c, R, B + c, e], [R, B + c, R - c, B, e], [R - c, B, L, B, e]] },
    { w: W, s: ring(W, false) },
    { w: W, s: ring(W, true) },
    { w: W, s: [[L, B, L, Tp, T / 2], [L + 0.05, 1.25, R, Tp, e], [0.8, 1.74, R, B, e, 1]], space: true },
    { w: 1.75, s: [...ring(1.75, false), [L + 0.22, B + 0.4, 1.75 - T / 2 - 0.22, Tp - 0.4, 0]] },
  ];
}

export function buildSign(ctx, M) {
  const { batch, mats, phys, atlas, decals } = ctx;
  const list = glyphs();
  const total = list.reduce((a, g) => a + g.w + GAP + (g.space ? SPACE : 0), -GAP);
  let x = SX - total / 2;
  const x0 = SX - 7, x1 = SX + 7;
  for (const g of list) {
    for (const [ax, ay, bx, by, e, flick] of g.s) {
      const len = Math.hypot(bx - ax, by - ay) + e * 2, ang = Math.atan2(by - ay, bx - ax);
      const cx = x + (ax + bx) / 2, cy = LY + (ay + by) / 2;
      batch.add(M.dark, box(len, T, DEPTH), xf(cx, cy, ZF - DEPTH / 2, 0, 0, ang), P);
      batch.add(flick ? M.signFlicker : M.signFace, box(len - 0.04, T - 0.05, 0.012), xf(cx, cy, ZF + 0.004, 0, 0, ang));
    }
    phys.addBox(x + g.w / 2, LY + LH / 2, ZF - DEPTH / 2, g.w / 2, LH / 2, DEPTH / 2, 0, 'metal');
    x += g.w + GAP + (g.space ? SPACE : 0);
  }

  // 钢框架：五根立柱、三道横梁、往北的斜撑；横梁在立柱前面托住字
  const posts = [-7, -3.5, 0, 3.5, 7].map((d) => SX + d), top = LY + LH + 0.45;
  for (const px of posts) {
    batch.add(M.trim, box(0.16, top - Y0, 0.16), xf(px, (top + Y0) / 2, ZP), P);
    batch.add(M.trim, box(0.4, 0.03, 0.4), xf(px, Y0 + 0.015, ZP), P);
    const kz = ZP - 1.5, ky = Y0 + 3.0;
    batch.add(mats.steelDark, cylBetween(px, ky, ZP - 0.05, px, Y0 + 0.08, kz, 0.05, 6), null, G);
    batch.add(mats.steelDark, box(0.36, 0.1, 0.5), xf(px, Y0 + 0.05, kz), G);
    batch.add(mats.steelDark, cylBetween(px, Y0 + 1.1, ZP - 0.05, px, Y0 + 0.3, kz + 0.1, 0.03, 6), null, G);
    // 斜撑只挡人：屋面上沿招牌走会被它们隔成几个开间
    phys.addBox(px, Y0 + 1.2, ZP - 0.75, 0.08, 1.2, 0.75, 0, 'metal').playerOnly = true;
    phys.addBox(px, (top + Y0) / 2, ZP, 0.08, (top - Y0) / 2, 0.08, 0, 'metal');
  }
  for (const gy of [LY - 0.2, LY + LH / 2, LY + LH + 0.2]) batch.add(M.trim, box(x1 - x0 + 0.3, 0.12, 0.08), xf(SX, gy, ZP + 0.12), P);
  for (let i = 0; i < posts.length - 1; i++) {
    batch.add(mats.steelDark, cylBetween(posts[i], LY - 0.2, ZP + 0.1, posts[i + 1], LY + LH + 0.2, ZP + 0.1, 0.025, 6), null, G);
  }
  // 女儿墙顶到字底之间不许翻过去
  phys.addBox(SX, (Y0 + 0.6 + top) / 2, ZP + 0.2, 7.2, (top - Y0 - 0.6) / 2, 0.12, 0, 'metal').playerOnly = true;

  // 字背后的穿线管、驱动电源箱
  batch.add(mats.galv, cylBetween(x0, LY + LH / 2 + 0.12, ZP + 0.2, x1, LY + LH / 2 + 0.12, ZP + 0.2, 0.02, 6), null, G);
  for (const px of [posts[1] + 0.5, posts[3] - 0.5]) {
    batch.add(M.box, rbox(0.5, 0.6, 0.25, 0.01, 1), xf(px, Y0 + 0.75, ZP - 0.3), P);
    batch.add(mats.galv, cylBetween(px, Y0 + 1.05, ZP - 0.3, px, LY + LH / 2 + 0.12, ZP + 0.2, 0.018, 6), null, G);
    batch.add(mats.steelDark, box(0.05, 0.45, 0.05), xf(px, Y0 + 0.225, ZP - 0.3), G);
  }

  // 字下面的副牌，被泛光灯照着
  const sub = atlas.add(1024, 64, (c, w, h) => {
    c.fillStyle = '#1b2026'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#d9d4c6'; c.textBaseline = 'middle';
    c.font = '700 44px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
    c.fillText('零号码头', 18, h / 2 + 2);
    c.font = `700 40px ${STENCIL_FONT}`;
    c.textAlign = 'right';
    c.fillText('DOCK ZERO TERMINAL  ·  BERTH 00', w - 18, h / 2 + 2);
    distress(c, w, h, ctx.rand, 0.25);
  });
  batch.add(M.dark, box(12, 0.52, 0.06), xf(SX, LY - 0.4, ZF - 0.05), P);
  decals.add(atlas.material, decalQuad(11.8, 0.46, sub), xf(SX - 5.9, LY - 0.63, ZF - 0.018));

  // 两盏投光灯：挑臂伸到字前面，往上打
  for (const d of [-3.6, 3.6]) {
    const lx = SX + d, lz = ZF + 0.55, ly = Y0 + 0.8;
    batch.add(mats.steelDark, cylBetween(lx, Y0 + 0.62, ZP + 0.1, lx, ly, lz, 0.03, 6), null, G);
    batch.add(mats.plasticBlack, rbox(0.42, 0.14, 0.3, 0.02, 1), xf(lx, ly, lz, -0.9, 0, 0), { tile: 0.06 });
    batch.add(M.lampCool, box(0.36, 0.01, 0.24), xf(lx, ly + 0.05, lz - 0.04, -0.9, 0, 0));
  }
  return {
    light: { pos: [SX, Y0 + 0.95, ZF + 0.6], aim: [SX, LY + LH * 0.55, ZF - 0.3], color: 0xdfe8ff, intensity: 260, distance: 9, angle: 1.25, penumbra: 0.6, fog: 0.5 },
  };
}
