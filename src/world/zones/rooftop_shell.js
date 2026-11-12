import { xf, box, rbox, cylBetween, scaleUV } from '../../gfx/geo.js';
import { decalQuad, distress, STENCIL_FONT } from '../labels.js';
import { slab, wallX, wallZ, stairs, railing } from '../build.js';
import { ROOF, RESERVED, Y } from '../plan.js';

// 楼顶的“壳”：两块屋面板、女儿墙、出屋面楼梯间、办公楼屋面上仓库屋面的台阶。
const G = { tile: 1.2 }, P = { tile: 5.2 }, C = { tile: 3 };
// 只要几何体不要碰撞体时用（碰撞已经由别的调用登记过）
const NOPHYS = { addBox: () => ({}), addCyl: () => ({}), solid: () => ({}) };

// [u0, u1] 去掉 gaps 之后剩下的段
function pieces(u0, u1, gaps) {
  const out = [];
  let c = u0;
  for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (a > c) out.push([c, Math.min(a, u1)]);
    c = Math.max(c, b);
  }
  if (c < u1) out.push([c, u1]);
  return out.filter(([a, b]) => b - a > 0.05);
}

// 女儿墙：along 'x' 时沿 x 走，at 是墙中心线的 z；out 是朝外一侧的符号。
// low 的墙（0.6 m）留缺口好翻越或者直接跳下去，缺口两端立一对爬梯扶手。
// down：外侧面往下包到这个标高，把屋面板的侧边盖住。
// edge：贴着地图边界的墙，跳上压顶就站在隐形墙跟前、半个身子悬在楼外，顶上加一道只挡人的挡板
function parapet(ctx, M, o) {
  const { batch, phys } = ctx;
  const { along, at, u0, u1, y, h, t = 0.3, out, gaps = [], body = ctx.mats.concrete, tile = 3, cap = ctx.mats.galv, down = null, surface = 'concrete', hoops = false, edge = false } = o;
  const put = (mat, len, hh, th, u, yy, off, opt) => {
    if (along === 'x') batch.add(mat, box(len, hh, th), xf(u, yy, at + off), opt);
    else batch.add(mat, box(th, hh, len), xf(at + off, yy, u), opt);
  };
  for (const [a, b] of pieces(u0, u1, gaps)) {
    const len = b - a, u = (a + b) / 2;
    put(body, len, h, t, u, y + h / 2, 0, { tile });
    // 压顶：两边各挑出 4 cm，外侧带滴水
    put(cap, len, 0.05, t + 0.08, u, y + h + 0.025, 0, G);
    put(cap, len, 0.08, 0.012, u, y + h - 0.03, out * (t / 2 + 0.046), G);
    // 内侧卷材泛水
    put(M.membrane, len, 0.32, 0.014, u, y + 0.16, -out * (t / 2 + 0.007), { tile: 4 });
    if (down !== null) put(body, len, y - down, t / 2, u, (y + down) / 2, out * (t / 4 + 0.012), { tile });
    if (along === 'x') phys.addBox(u, y + h / 2, at, len / 2, h / 2, t / 2, 0, surface);
    else phys.addBox(at, y + h / 2, u, t / 2, h / 2, len / 2, 0, surface);
    if (edge) {
      const top = y + h + 0.8;
      if (along === 'x') phys.addBox(u, top, at, len / 2, 0.8, t / 2, 0, 'metal').playerOnly = true;
      else phys.addBox(at, top, u, t / 2, 0.8, len / 2, 0, 'metal').playerOnly = true;
    }
  }
  if (!hoops) return;
  // 缺口两侧的鹅颈扶手（爬梯上屋面的落脚点）
  for (const [a, b] of gaps) {
    if (b - a < 1.45) continue;
    for (const v of [a + 0.06, b - 0.06]) {
      const p0 = along === 'x' ? [v, at] : [at, v];
      const p1 = along === 'x' ? [v, at + out * 0.35] : [at + out * 0.35, v];
      batch.add(ctx.mats.galv, cylBetween(p0[0], y, p0[1], p0[0], y + h + 1.0, p0[1], 0.022, 8), null, G);
      batch.add(ctx.mats.galv, cylBetween(p0[0], y + h + 1.0, p0[1], p1[0], y + h + 0.75, p1[1], 0.022, 8), null, G);
      batch.add(ctx.mats.galv, cylBetween(p1[0], y + h + 0.75, p1[1], p1[0], y + h - 0.1, p1[1], 0.022, 8), null, G);
    }
  }
}

// 仓库屋面上后补的几块卷材：比大面更黑，四边一圈压边胶。
// 按世界坐标摆、大小各不相同（写进卷材贴图会每 4 m 重复一次，成了方格）。
// 只是 6 mm 的薄片，不登记碰撞；位置让开积水、走道垫和设备。[x, z, 沿 x 宽, 沿 z 深]
const PATCHES = [[-7.0, -23.6, 2.2, 0.9], [-0.5, -28.6, 1.8, 1.4], [10.5, -30.0, 1.6, 1.8],
  [-23.5, -26.8, 2.0, 1.2], [20.5, -29.8, 2.4, 1.0], [26.0, -23.5, 1.6, 2.0],
  [-13.0, -26.0, 1.0, 0.7], [2.5, -23.5, 1.2, 0.8], [-27.6, -31.2, 1.4, 0.9],
  [14.8, -28.8, 3.0, 0.7], [24.0, -30.5, 1.0, 0.8], [-21.5, -21.5, 1.6, 0.6]];
function roofPatches(ctx, M, y) {
  for (const [x, z, w, d] of PATCHES) {
    // 新卷材比晒旧的大面黑、哑：借走道垫的橡胶材质，纹理压到每米 3 格（比垫子细一倍），不像垫子
    const g = scaleUV(box(w, 0.006, d), w * 3, d * 3, (x * 0.37) % 1, (z * 0.53) % 1);
    ctx.batch.add(ctx.mats.rubber, g, xf(x, y + 0.003, z));
    for (const s of [-1, 1]) {
      ctx.batch.add(ctx.mats.black, box(w + 0.03, 0.007, 0.03), xf(x, y + 0.0035, z + s * d / 2));
      ctx.batch.add(ctx.mats.black, box(0.03, 0.007, d - 0.03), xf(x + s * w / 2, y + 0.0035, z));
    }
  }
}

export function buildShell(ctx, M) {
  const { batch, mats, atlas, decals } = ctx;
  const W = ROOF.warehouse, O = ROOF.office, S = RESERVED.stairwell;

  // 屋面板：仓库是卷材屋面；办公楼是混凝土板上压一层卵石（卵石层只是外观，脚下照样是 8.1）
  slab(ctx, M.membrane, { ...W, holes: [], surface: 'asphalt', tile: 4, matBottom: M.ceiling });
  slab(ctx, mats.concreteIn, { ...O, holes: [S], surface: 'gravel', tile: 3, matBottom: M.ceiling });
  slab({ ...ctx, phys: NOPHYS }, M.gravel, { ...O, y: O.y + 0.03, t: 0.03, holes: [{ x0: -30, x1: -24, z0: -48, z1: -41 }], tile: 1.5 });
  roofPatches(ctx, M, W.y);

  // 仓库屋面女儿墙：外墙皮同立面的钢板色；朝堆场、街道、卸货场的一侧 0.6 m 带缺口
  const wy = W.y, wp = { body: M.clad, tile: 5.2, cap: M.trim, surface: 'metal' };
  parapet(ctx, M, { ...wp, along: 'x', at: W.z1 - 0.15, u0: W.x0, u1: W.x1, y: wy, h: 0.6, out: 1, hoops: true,
    gaps: [[-27.6, -26.1], [-19.4, -17.9], [8.6, 10.1], [16.8, 18.3], [25.4, 26.9]] });
  parapet(ctx, M, { ...wp, along: 'z', at: W.x0 + 0.15, u0: W.z0 + 0.3, u1: W.z1 - 0.3, y: wy, h: 1.0, out: -1, edge: true });
  parapet(ctx, M, { ...wp, along: 'z', at: W.x1 - 0.15, u0: W.z0 + 0.3, u1: W.z1 - 0.3, y: wy, h: 0.6, out: 1, hoops: true,
    gaps: [[-29.4, -27.9], [-24.6, -23.1]] });
  // 北边朝卸货场那段：消防梯顶的落脚口 x 12.0..13.4
  parapet(ctx, M, { ...wp, along: 'x', at: W.z0 + 0.15, u0: O.x1, u1: W.x1, y: wy, h: 0.6, out: -1, hoops: true,
    gaps: [[12.0, 13.4], [19.2, 20.7], [25.8, 27.3]] });
  // 北边压在办公楼屋面上那段：0.45 的变形缝挡水台，跨不过去只能跳；台阶口和两处缺口能直接走下去
  parapet(ctx, M, { ...wp, along: 'x', at: W.z0 + 0.15, u0: W.x0, u1: O.x1, y: wy, h: 0.45, out: -1,
    gaps: [[-20.4, -18.6], [-8.1, -6.6], [2.4, 3.9]] });
  // 高低跨处的泛水板：盖住仓库北墙露出办公楼屋面的那 0.9 m
  batch.add(M.clad, box(O.x1 - O.x0, wy - O.y + 0.02, 0.03), xf((O.x0 + O.x1) / 2, (wy + O.y) / 2, W.z0 - 0.016), P);
  batch.add(M.trim, box(O.x1 - O.x0, 0.06, 0.06), xf((O.x0 + O.x1) / 2, O.y + 0.03, W.z0 - 0.04), P);

  // 办公楼屋面女儿墙：混凝土，外侧往下包住板边。压顶和仓库那几段一样用 M.trim：
  // 镀锌贴图 1.2 m 一张，铺在 0.33 m 宽的压顶上锌花斑块太大，看着像迷彩布
  const oy = O.y, op = { down: O.y - O.t, surface: 'concrete', cap: M.trim };
  parapet(ctx, M, { ...op, along: 'x', at: O.z0 + 0.125, u0: -24, u1: O.x1, y: oy, h: 1.0, t: 0.25, out: -1, edge: true });
  parapet(ctx, M, { ...op, along: 'z', at: O.x0 + 0.125, u0: -41, u1: O.z1, y: oy, h: 1.0, t: 0.25, out: -1, edge: true });
  parapet(ctx, M, { ...op, along: 'z', at: O.x1 - 0.125, u0: O.z0 + 0.25, u1: O.z1, y: oy, h: 0.6, t: 0.25, out: 1, hoops: true,
    gaps: [[-45.6, -44.1], [-40.75, -39.25]] });

  buildPenthouse(ctx, M);
  buildRoofSteps(ctx, M);
}

// 出屋面楼梯间：四面墙从 8.1 砌到 10.6，门开在东墙（中心 z -44.5，宽 1.3），上面一块小屋面板
function buildPenthouse(ctx, M) {
  const { batch, mats, atlas, decals, phys } = ctx;
  const y0 = Y.officeRoof, y1 = 10.6, out = mats.concrete, inn = mats.concreteIn;
  const door = { a: -45.15, b: -43.85, y0, y1: y0 + 2.1, frame: M.trim };
  wallZ(ctx, out, { x: -29.8, z0: -47.6, z1: -41.4, y0, y1, mat2: inn });
  wallZ(ctx, inn, { x: -24.2, z0: -47.6, z1: -41.4, y0, y1, mat2: out, holes: [door] });
  wallX(ctx, out, { z: -47.8, x0: -30, x1: -24, y0, y1, mat2: inn });
  wallX(ctx, inn, { z: -41.2, x0: -30, x1: -24, y0, y1, mat2: out });
  slab(ctx, M.membrane, { x0: -30.15, x1: -23.85, z0: -48.15, z1: -40.85, y: y1 + 0.2, t: 0.2, tile: 4, matBottom: M.ceiling });
  // 屋面板一圈的压顶和墙根的卷材泛水
  const cx = -27, cz = -44.5;
  for (const [w, d, x, z] of [[6.36, 0.08, cx, -48.19], [6.36, 0.08, cx, -40.81], [0.08, 7.3, -30.19, cz], [0.08, 7.3, -23.81, cz]]) {
    batch.add(M.trim, box(w, 0.26, d), xf(x, y1 + 0.08, z), P);
  }
  for (const [w, d, x, z] of [[6.04, 0.02, cx, -40.99], [0.02, 2.8, -23.99, -46.6], [0.02, 2.8, -23.99, -42.4]]) {
    batch.add(M.membrane, box(w, 0.3, d), xf(x, y0 + 0.15, z), { tile: 4 });
  }
  // 门：向外开到底贴在墙上
  batch.add(M.trim, rbox(0.05, 2.08, 1.28, 0.008, 1), xf(-23.95, y0 + 1.05, -43.2), P);
  batch.add(mats.galv, box(0.04, 0.03, 0.16), xf(-23.9, y0 + 1.0, -42.7), G);
  batch.add(mats.steelDark, box(0.03, 0.4, 0.1), xf(-23.92, y0 + 1.9, -43.7), G);
  phys.addBox(-23.95, y0 + 1.05, -43.2, 0.03, 1.05, 0.64, 0, 'metal');
  // 门头的防水灯和遮雨板
  batch.add(mats.steelDark, box(0.5, 0.04, 1.9), xf(-23.75, y0 + 2.42, -44.5), G);
  batch.add(mats.plasticBlack, rbox(0.14, 0.22, 0.32, 0.03, 1), xf(-23.93, y0 + 2.27, -44.5), { tile: 0.06 });
  batch.add(M.lampCool, box(0.012, 0.15, 0.24), xf(-23.855, y0 + 2.27, -44.5));
  batch.add(mats.galv, box(0.03, 2.1, 0.03), xf(-23.98, y0 + 1.25, -45.45), G);
  batch.add(M.box, rbox(0.12, 0.18, 0.22, 0.01, 1), xf(-23.94, y0 + 1.4, -45.45), P);
  // 标牌
  const sign = atlas.add(320, 200, (c, w, h) => {
    c.fillStyle = '#1f6e3a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f2f2ea'; c.textAlign = 'center';
    c.font = '700 64px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
    c.fillText('楼顶出口', w / 2, 82, w - 24);
    c.font = `700 40px ${STENCIL_FONT}`;
    c.fillText('ROOF ACCESS B', w / 2, 152, w - 24);
    distress(c, w, h, ctx.rand, 0.15);
  });
  decals.add(atlas.material, decalQuad(0.64, 0.4, sign), xf(-23.985, y0 + 1.45, -45.62, 0, Math.PI / 2, 0));
  // 南墙上的进风百叶
  batch.add(mats.steelDark, rbox(1.2, 0.8, 0.08, 0.01, 1), xf(-27.6, y0 + 1.6, -40.98), G);
  for (let i = 0; i < 6; i++) batch.add(M.trim, box(1.08, 0.02, 0.08), xf(-27.6, y0 + 1.27 + i * 0.13, -40.93, -0.6, 0, 0), P);
  // 南墙东头的雨水斗和落水管，管脚弯出来泄在卵石上
  batch.add(mats.galv, box(0.26, 0.22, 0.16), xf(-24.75, y1 - 0.2, -40.9), G);
  batch.add(mats.galv, cylBetween(-24.75, y1 - 0.3, -40.89, -24.75, y0 + 0.25, -40.89, 0.045, 8), null, G);
  batch.add(mats.galv, cylBetween(-24.75, y0 + 0.25, -40.89, -24.75, y0 + 0.08, -40.62, 0.045, 8), null, G);
  for (const yy of [y0 + 0.7, y0 + 1.9]) batch.add(mats.steelDark, box(0.12, 0.03, 0.1), xf(-24.75, yy, -40.945), G);
  // 屋顶上的排风帽、避雷针
  batch.add(mats.galv, box(0.7, 0.3, 0.7), xf(-28.4, y1 + 0.35, -46.6), G);
  batch.add(mats.galv, cylBetween(-28.4, y1 + 0.5, -46.6, -28.4, y1 + 0.95, -46.6, 0.24, 14), null, G);
  batch.add(mats.galv, cylBetween(-28.4, y1 + 0.95, -46.6, -28.4, y1 + 1.05, -46.6, 0.36, 14), null, G);
  batch.add(mats.galv, cylBetween(-24.4, y1 + 0.2, -41.4, -24.4, y1 + 2.4, -41.4, 0.012, 6), null, G);
}

// 办公楼屋面上到仓库屋面：0.9 m 高差，钢格栅踏步加两侧扶手
function buildRoofSteps(ctx, M) {
  const { batch, mats } = ctx;
  const R = RESERVED.roofSteps, x = -19.5, w = 1.8, z0 = R.z0, z1 = R.z1;
  stairs(ctx, mats.galv, { x, z: z0, dir: [0, 1], w, y0: Y.officeRoof, y1: Y.whRoof, run: z1 - z0, open: true, surface: 'metal', tile: 1.2 });
  const n = 5, tread = (z1 - z0) / n;
  for (let i = 0; i < n; i++) batch.add(M.yellow, box(w - 0.04, 0.012, 0.05), xf(x, Y.officeRoof + (i + 1) * 0.18 + 0.006, z0 + i * tread + 0.03), P);
  for (const s of [-1, 1]) {
    const rx = x + s * (w / 2);
    railing(ctx, mats.galv, { a: [rx, z0], b: [rx, z1], ya: Y.officeRoof, yb: Y.whRoof, posts: 1.7 });
    batch.add(mats.galv, box(0.06, 0.9, 0.06), xf(rx, Y.officeRoof + 0.45, z0 + 0.03), G);
  }
  // 台阶脚下一块混凝土垫板
  batch.add(mats.concrete, box(2.4, 0.05, 0.8), xf(x, Y.officeRoof + 0.045, z0 - 0.4), C);
}
