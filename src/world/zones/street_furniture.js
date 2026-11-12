import { xf, box, cyl, cylBetween, extrude } from '../../gfx/geo.js';
import { ZONE } from '../plan.js';
import { aabb, collider, cable, decal, rb } from './street_kit.js';
import { TILE } from './street_mats.js';
import { STENCIL_FONT, distress } from '../labels.js';

// 人行道、路缘石、排水沟和雨水箅子，电线杆（带钠灯）和架空线。
export const KERB = 38.8, WALK_Y = 0.15, FACE = 42.0;
export const POLE_X = 39.4;
export const POLES = [-38, -15, 7];
const G = { tile: TILE.galv };

function pavement(ctx, S) {
  const { mats, batch } = ctx;
  const z0 = ZONE.street.z0, z1 = ZONE.street.z1;
  aabb(ctx, S.paver, KERB + 0.2, FACE, 0, WALK_Y, z0, z1, { tile: TILE.paver });
  collider(ctx, KERB, FACE, 0, WALK_Y, z0, z1, 'concrete');
  // 路缘石：一米一块，朝路的上棱倒角
  const prof = [[0, 0], [0.2, 0], [0.2, WALK_Y + 0.005], [0.04, WALK_Y + 0.005], [0, WALK_Y - 0.03]];
  for (let z = z0; z < z1 - 0.01; z += 1) {
    const len = Math.min(1, z1 - z) - 0.006;
    batch.add(mats.concrete, extrude(prof, len, 0.003), xf(KERB, 0, z + len / 2 + 0.003), { tile: TILE.conc, ou: ctx.rand(), ov: ctx.rand() });
  }
  // 路边的混凝土排水带（东侧沿路缘，西侧沿墙根）
  batch.add(mats.concreteDark, box(0.42, 0.012, z1 - z0), xf(KERB - 0.21, 0.006, (z0 + z1) / 2), { tile: TILE.conc });
  for (const [x, a, b] of [[29.3, -20, z1], [30.0, -32.9, -20], [30.4, z0, -32.9]]) {
    batch.add(mats.concreteDark, box(0.36, 0.01, b - a), xf(x + 0.18, 0.005, (a + b) / 2), { tile: TILE.conc });
  }
  // 雨水箅子
  const grate = (x, z, along) => {
    const m = xf(x, 0.012, z, 0, along ? 0 : Math.PI / 2, 0);
    batch.add(mats.steelDark, box(0.36, 0.012, 0.62), m, G);
    for (let i = 0; i < 9; i++) batch.add(mats.black, box(0.025, 0.004, 0.54), m.clone().multiply(xf(-0.14 + i * 0.035, 0.005, 0)));
  };
  for (const z of [-44, -30, -18, -4, 9.5, 18]) grate(KERB - 0.2, z, true);
  for (const z of [-26, -8, 14]) grate(29.55, z, true);
  grate(30.65, -45.3, true);
}

// 水泥电线杆：横担、瓷瓶、钠灯挑臂、灯头。返回灯头下沿的位置
function pole(ctx, S, z, { transformer = false, sign = null } = {}) {
  const { mats, batch } = ctx;
  const x = POLE_X, top = 9.2;
  batch.add(mats.concrete, cyl(0.11, 0.17, top - WALK_Y, 14), xf(x, (top + WALK_Y) / 2, z), { tile: TILE.conc, ou: ctx.rand() });
  batch.add(mats.concreteDark, cyl(0.2, 0.22, 0.3, 14), xf(x, WALK_Y + 0.15, z), { tile: TILE.conc });
  ctx.phys.addCyl(x, z, 0.2, 0, top, 'concrete');
  // 横担和瓷瓶（三根线挂在上面）
  batch.add(mats.galv, rb(1.7, 0.08, 0.08, 0.01), xf(x, top - 0.35, z), G);
  for (const dx of [-0.7, 0, 0.7]) {
    batch.add(mats.reflective, cyl(0.035, 0.05, 0.14, 8), xf(x + dx, top - 0.24, z));
    batch.add(mats.reflective, cyl(0.06, 0.06, 0.02, 10), xf(x + dx, top - 0.22, z));
  }
  for (const s of [-1, 1]) batch.add(mats.galv, cylBetween(x, top - 0.9, z, x + s * 0.6, top - 0.37, z, 0.015, 6), null, G);
  // 钠灯挑臂：从杆子往路中间挑出两米
  const arm = [[x, 7.3], [x - 0.6, 7.55], [x - 1.3, 7.7], [x - 1.95, 7.72]];
  for (let i = 0; i < arm.length - 1; i++) batch.add(mats.galv, cylBetween(arm[i][0], arm[i][1], z, arm[i + 1][0], arm[i + 1][1], z, 0.03, 8), null, G);
  batch.add(mats.galv, cylBetween(x, 6.7, z, x - 0.9, 7.6, z, 0.018, 6), null, G);
  batch.add(mats.galv, rb(0.14, 0.4, 0.14, 0.01), xf(x - 0.07, 7.15, z), G);
  const hx = x - 2.15, hy = 7.68;
  batch.add(S.box, rb(0.7, 0.16, 0.34, 0.05, 2), xf(hx, hy, z, 0, 0, 0.04), { tile: TILE.paint });
  batch.add(S.box, rb(0.3, 0.08, 0.26, 0.03), xf(hx + 0.32, hy + 0.08, z), { tile: TILE.paint });
  batch.add(mats.emissive(0xffb45e, 70), box(0.46, 0.02, 0.24), xf(hx - 0.05, hy - 0.085, z, 0, 0, 0.04));
  // 杆上的接线盒、上杆的线管、编号牌
  batch.add(S.box, rb(0.3, 0.42, 0.18, 0.015), xf(x + 0.24, 2.6, z), { tile: TILE.paint });
  batch.add(mats.galv, cyl(0.022, 0.022, 4.4, 8), xf(x + 0.19, 5.0, z), G);
  const no = ctx.atlas.add(96, 160, (c, w, h) => {
    c.fillStyle = '#e8e4d8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#b01c14'; c.fillRect(0, 0, w, 34);
    c.fillStyle = '#f4f0e6'; c.font = `700 24px ${STENCIL_FONT}`; c.textAlign = 'center'; c.fillText('10kV', w / 2, 26);
    c.fillStyle = '#1a1a1a'; c.font = '700 26px "Microsoft YaHei UI", sans-serif';
    c.fillText('港前', w / 2, 74); c.font = `700 34px ${STENCIL_FONT}`; c.fillText(`${17 + POLES.indexOf(z)}#`, w / 2, 122);
    distress(c, w, h, ctx.rand, 0.3);
  });
  decal(ctx, no, 0.18, 0.3, x - 0.17, 3.4, z, 'w');
  if (transformer) {
    batch.add(S.box, cyl(0.32, 0.32, 1.0, 16), xf(x + 0.48, 6.0, z), { tile: TILE.paint });
    batch.add(S.box, cyl(0.34, 0.34, 0.06, 16), xf(x + 0.48, 6.53, z), { tile: TILE.paint });
    batch.add(mats.steelDark, rb(0.5, 0.08, 0.5, 0.01), xf(x + 0.42, 5.46, z), G);
    for (const dz of [-0.12, 0.12]) batch.add(mats.reflective, cyl(0.03, 0.04, 0.2, 8), xf(x + 0.48, 6.66, z + dz));
  }
  if (sign) decal(ctx, sign, 0.9, 0.3, x - 0.2, 3.0, z, 'w');
  return { x: hx, y: hy - 0.12, z };
}

// 路名牌（蓝底白字，挂在杆子上）
function streetSign(ctx) {
  return ctx.atlas.cached('street|roadSign', 384, 128, (c, w, h) => {
    c.fillStyle = '#1b4f9c'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e8eef8'; c.lineWidth = 5; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = '#f2f6ff'; c.textAlign = 'center';
    c.font = '700 54px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'; c.fillText('港 前 路', w / 2, 66);
    c.font = `600 26px ${STENCIL_FONT}`; c.fillText('GANGQIAN RD  ↑ N', w / 2, 106);
    distress(c, w, h, ctx.rand, 0.2);
  });
}

// 架空线：沿杆子一路拉，往北越过北墙、往南出了南门接到远处的杆子；再从杆子往对面门面和仓库墙上拉几根
function wires(ctx) {
  const { mats } = ctx;
  const x = POLE_X, y = 9.2 - 0.17;
  const pts = [-62, ...POLES, 34];
  for (const dx of [-0.7, 0, 0.7]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const sag = Math.abs(pts[i + 1] - pts[i]) * 0.018;
      cable(ctx, mats.black, [x + dx, y, pts[i]], [x + dx, y, pts[i + 1]], sag, 0.011, 12);
    }
  }
  // 远处两根杆子（出了地图，不要碰撞）
  for (const z of [-62, 34]) ctx.batch.add(mats.concrete, cyl(0.11, 0.17, 9.2, 10), xf(x, 4.6, z), { tile: TILE.conc });
  // 低一点的通信线，挂在灯臂下面
  for (let i = 0; i < pts.length - 1; i++) cable(ctx, mats.black, [x + 0.15, 6.4, pts[i]], [x + 0.15, 6.4, pts[i + 1]], 0.9, 0.02, 12);
  // 入户线：杆子 → 对面门面
  for (const [z, tz, ty] of [[-38, -42.5, 6.6], [-15, -19, 7.2], [-15, -10.5, 5.8], [7, 2.5, 6.1], [7, 15.5, 5.6]]) {
    cable(ctx, mats.black, [x + 0.7, y, z], [FACE - 0.05, ty, tz], 0.35, 0.008, 8);
  }
  // 跨街线：杆子 → 仓库墙、堆场墙顶的支架
  for (const [z, tx, ty, tz] of [[-38, 30.05, 7.8, -31], [-15, 30.05, 8.2, -24], [7, 29.35, 4.6, 12]]) {
    cable(ctx, mats.black, [x - 0.7, y, z], [tx, ty, tz], 0.9, 0.01, 14);
    cable(ctx, mats.black, [x + 0.15, 6.4, z], [tx, ty - 0.4, tz], 1.2, 0.016, 14);
    ctx.batch.add(mats.galv, rb(0.25, 0.06, 0.06, 0.008), xf(tx + 0.1, ty - 0.2, tz), G);
  }
}

export function buildStreetBase(ctx, S) {
  pavement(ctx, S);
  const sign = streetSign(ctx);
  const lamps = POLES.map((z, i) => pole(ctx, S, z, { transformer: i === 1, sign: i === 2 ? sign : null }));
  wires(ctx);
  return lamps;
}
