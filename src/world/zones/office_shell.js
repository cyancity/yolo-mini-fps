import { xf, box, cyl, cylBetween } from '../../gfx/geo.js';
import { wallX, wallZ, slab, stairs, railing } from '../build.js';
import { WALLS, PORTAL, RESERVED } from '../plan.js';
import { STENCIL_FONT, distress } from '../labels.js';
import { IN, L0, L2, TOP, SLAB_T, SW, ST, WIN_Y, WIN_N, WIN_E, WIN_W, WIN_STAIR, COLUMNS, CANOPY, UI_FONT, FACE, skirting } from './office_layout.js';

// 办公楼外壳：三面外墙（南墙是仓库的 whNorth）、一层实心楼板（楼坐在 1.1 高的台基上）、
// 二层楼板、两根柱子、东立面的线脚和标牌、正门外的台阶和雨棚。
const BAND = [3.9, 5.35]; // 东立面深色腰线（一层窗头到二层窗台）

function holes(list, [y0, y1], glass, frame) {
  return list.map(([a, b, open]) => ({ a, b, y0, y1, pane: open ? null : glass, frame }));
}

export function buildShell(ctx, M, kit) {
  const { mats, batch } = ctx;
  const glass = mats.glass, frame = mats.steelDark;
  const front = PORTAL.officeFront;
  const doorHole = { a: front.z - front.w / 2, b: front.z + front.w / 2, y0: front.y0, y1: front.y1, frame };
  const winG = (list) => holes(list, WIN_Y[0], glass, frame), winU = (list) => holes(list, WIN_Y[1], glass, frame);

  // 外墙：下段浅灰板、上段深灰（窗间墙连成一条深色窗带），内侧一律乳胶漆。
  // 北墙和西墙从 -47.6 / 8.4 起算，转角只由北墙占，外皮不会叠面闪烁
  const east = WALLS.officeEast.x, north = WALLS.officeNorth.z, west = WALLS.officeWest.x;
  wallZ(ctx, M.wall, { x: east, z0: IN.z0, z1: IN.z1, y0: 0, y1: BAND[0], mat2: M.facade, holes: [doorHole, ...winG(WIN_E[0])] });
  wallZ(ctx, M.wall, { x: east, z0: IN.z0, z1: IN.z1, y0: BAND[0], y1: TOP, mat2: M.band, holes: winU(WIN_E[1]) });
  const stairWin = WIN_STAIR.map(([a, b, y0, y1]) => ({ a, b, y0, y1, pane: glass, frame }));
  wallX(ctx, M.facade, { z: north, x0: -30, x1: 8.4, y0: 0, y1: BAND[0], mat2: M.wall, holes: [...winG(WIN_N[0]), stairWin[0]] });
  // 楼梯间那扇高窗跨过两段墙：玻璃和窗框由下段一次做完，中段只挖洞。
  // 一次调用里同一段墙只能挖一个洞，所以北墙上段再分两截，两扇楼梯窗各在一截里
  const sw0 = WIN_STAIR[0], split = 5.2;
  wallX(ctx, M.band, { z: north, x0: -30, x1: 8.4, y0: BAND[0], y1: split, mat2: M.wall, holes: [{ a: sw0[0], b: sw0[1], y0: BAND[0], y1: sw0[3] }] });
  wallX(ctx, M.band, { z: north, x0: -30, x1: 8.4, y0: split, y1: TOP, mat2: M.wall, holes: [...winU(WIN_N[1]), stairWin[1]] });
  wallZ(ctx, M.facade, { x: west, z0: IN.z0, z1: IN.z1, y0: 0, y1: BAND[0], mat2: M.wall, holes: winG(WIN_W[0]) });
  wallZ(ctx, M.band, { x: west, z0: IN.z0, z1: IN.z1, y0: BAND[0], y1: TOP, mat2: M.wall, holes: winU(WIN_W[1]) });
  // 外墙内侧的踢脚线（楼梯间里不做：那几段墙根不是被梯段下的填实埋住，就是对着梯井）
  for (const y of [L0, L2]) {
    skirting(kit, M.accent, 'x', { z: north, x0: SW.x1 + 0.4, x1: IN.x1 }, { sides: [1], y });
    skirting(kit, M.accent, 'z', { x: west, z0: SW.z1 + 0.4, z1: IN.z1 }, { sides: [1], y });
    skirting(kit, M.accent, 'z', { x: east, z0: IN.z0, z1: IN.z1, holes: y === L0 ? [doorHole] : [] }, { sides: [-1], y });
  }

  // 一层：整块实心台基，顶面铺塑胶地板
  slab(ctx, M.vinyl, { x0: IN.x0, x1: IN.x1, z0: IN.z0, z1: IN.z1, y: L0, t: L0, tile: 2.4 });
  // 二层：办公区铺地毯；楼梯间那块是平台（水磨石色塑胶地板），梯段那里留洞
  const up = { y: L2, t: SLAB_T, matBottom: mats.concreteIn };
  slab(ctx, M.carpet, { ...up, x0: SW.x1, x1: IN.x1, z0: IN.z0, z1: IN.z1, surface: 'carpet', tile: 2 });
  slab(ctx, M.carpet, { ...up, x0: IN.x0, x1: SW.x1, z0: SW.z1, z1: IN.z1, surface: 'carpet', tile: 2 });
  slab(ctx, M.vinyl, { ...up, x0: IN.x0, x1: SW.x1, z0: IN.z0, z1: SW.z1, tile: 2.4, holes: [{ x0: ST.wx0, x1: ST.mx1, z0: IN.z0, z1: ST.zs }] });

  // 结构柱：两层通高，踢脚和护角
  for (const [x, z] of COLUMNS) {
    kit.box(M.wall, 0.42, TOP - L0, 0.42, x, (L0 + TOP) / 2, z, { tile: 3, r: 0.015 });
    kit.col(x, (L0 + TOP) / 2, z, 0.21, (TOP - L0) / 2, 0.21, 'concrete');
    for (const y of [L0, L2]) kit.box(M.plastic, 0.44, 0.1, 0.44, x, y + 0.05, z);
  }

  facade(ctx, M, kit);
  frontEntrance(ctx, M, kit);
  // 窗台板：内侧一条，外侧一条压顶（防水）
  const sills = (list, y, along, at, inSign) => {
    for (const [a, b] of list) {
      const c = (a + b) / 2, len = b - a + 0.1;
      if (along === 'x') {
        kit.box(M.wall, len, 0.03, 0.2, c, y - 0.015, at + inSign * 0.28, { tile: 3 });
        kit.box(M.band, len + 0.06, 0.04, 0.12, c, y - 0.08, at - inSign * 0.24, { tile: 5.2 });
      } else {
        kit.box(M.wall, 0.2, 0.03, len, at + inSign * 0.28, y - 0.015, c, { tile: 3 });
        kit.box(M.band, 0.12, 0.04, len + 0.06, at - inSign * 0.24, y - 0.08, c, { tile: 5.2 });
      }
    }
  };
  for (let f = 0; f < 2; f++) {
    sills(WIN_N[f], WIN_Y[f][0], 'x', north, 1);
    sills(WIN_E[f], WIN_Y[f][0], 'z', east, -1);
    sills(WIN_W[f], WIN_Y[f][0], 'z', west, 1);
  }
  // 开着的窗：框边上残留几片碎玻璃
  const shard = (x, y, z, ry, s) => batch.add(glass, box(0.012, s, s * 0.7), xf(x, y, z, 0.4, ry, 0.7));
  for (const [f, list, along, at] of [[0, WIN_N[0], 'x', north], [1, WIN_N[1], 'x', north], [1, WIN_E[1], 'z', east]]) {
    for (const [a, b, open] of list) {
      if (!open) continue;
      const y1 = WIN_Y[f][1];
      if (along === 'x') { shard(a + 0.1, y1 - 0.12, at, Math.PI / 2, 0.2); shard(b - 0.15, WIN_Y[f][0] + 0.1, at, Math.PI / 2, 0.16); }
      else { shard(at, y1 - 0.12, a + 0.12, 0, 0.22); shard(at, WIN_Y[f][0] + 0.12, b - 0.2, 0, 0.15); }
    }
  }
}

// 东立面：台基、浅灰板分缝、檐口、落水管、壁灯、监控、标牌
function facade(ctx, M, kit) {
  const { mats, batch } = ctx;
  const X = WALLS.officeEast.x + 0.2; // 外皮面
  const z0 = -48, z1 = IN.z1;
  // 台基：混凝土勒脚，略凸出墙面，顶上一道滴水
  kit.box(mats.concreteDark, 0.08, 1.15, z1 - z0, X + 0.04, 0.575, (z0 + z1) / 2, { tile: 3 });
  kit.box(M.band, 0.1, 0.04, z1 - z0, X + 0.05, 1.17, (z0 + z1) / 2, { tile: 5.2 });
  // 腰线上下两道收边
  for (const y of BAND) kit.box(M.band, 0.07, 0.06, z1 - z0, X + 0.035, y, (z0 + z1) / 2, { tile: 5.2, r: 0.01 });
  // 浅灰板的竖缝（避开门窗）
  const gaps = [[-41.2, -38.8], ...WIN_E[0].map(([a, b]) => [a - 0.1, b + 0.1])];
  for (let z = -46.4; z < z1 - 0.3; z += 1.5) {
    if (gaps.some(([a, b]) => z > a && z < b)) continue;
    kit.box(M.band, 0.012, BAND[0] - 1.2, 0.018, X + 0.006, (1.2 + BAND[0]) / 2, z);
  }
  // 横缝在窗洞和门洞处断开
  let zc = z0;
  for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (a > zc + 0.05) kit.box(M.band, 0.012, 0.018, a - zc, X + 0.006, 2.55, (a + zc) / 2);
    zc = Math.max(zc, b);
  }
  kit.box(M.band, 0.012, 0.018, z1 - zc, X + 0.006, 2.55, (z1 + zc) / 2);
  // 檐口压顶（屋面板以下这一段）
  kit.box(M.facade, 0.12, 0.5, z1 - z0 + 0.1, X + 0.06, TOP - 0.25, (z0 + z1) / 2, { tile: 5.2, r: 0.02 });
  // 落水管：檐口下的雨水斗 + 管 + 管卡 + 底部弯头
  for (const z of [-47.75, -33.2]) {
    kit.box(M.band, 0.22, 0.3, 0.28, X + 0.14, TOP - 0.62, z, { tile: 5.2, r: 0.02 });
    batch.add(mats.galv, cyl(0.05, 0.05, TOP - 0.9, 12), xf(X + 0.12, (TOP - 0.75) / 2 + 0.12, z), { tile: 1.2 });
    for (let y = 1.4; y < TOP - 1; y += 1.8) kit.box(mats.galv, 0.16, 0.04, 0.12, X + 0.07, y, z, { tile: 1.2 });
    batch.add(mats.galv, cylBetween(X + 0.12, 0.3, z, X + 0.32, 0.08, z, 0.05, 12), null, { tile: 1.2 });
  }
  // 门边壁灯（亮着）、监控探头、消防接合器箱、门牌
  for (const z of [-41.75, -38.25]) {
    kit.box(mats.plasticBlack, 0.1, 0.32, 0.14, X + 0.05, 2.75, z, { r: 0.02 });
    kit.box(M.warm, 0.02, 0.22, 0.08, X + 0.105, 2.75, z);
  }
  kit.box(mats.plasticBlack, 0.24, 0.1, 0.1, X + 0.16, 3.6, -42.3, { ry: 0.5, rz: -0.3, r: 0.02 });
  batch.add(mats.galv, cylBetween(X, 3.68, -42.3, X + 0.1, 3.64, -42.3, 0.015, 8), null, { tile: 1.2 });
  kit.box(M.red, 0.18, 0.7, 0.5, X + 0.09, 1.65, -36.4, { tile: 5.2, r: 0.02 });
  const plate = kit.label('plate', 256, 128, (c, w, h) => {
    c.fillStyle = '#1c3f68'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#e9ecef'; c.lineWidth = 6; c.strokeRect(8, 8, w - 16, h - 16);
    c.fillStyle = '#f2f2f0'; c.textAlign = 'center';
    c.font = `700 64px ${STENCIL_FONT}`; c.fillText('B2', w / 2, 72);
    c.font = `600 24px ${UI_FONT}`; c.fillText('港务调度楼', w / 2, 108);
  });
  kit.box(mats.galv, 0.02, 0.27, 0.52, X + 0.01, 2.45, -42.9, { tile: 1.2 });
  kit.decal(plate, 0.5, 0.25, X + 0.022, 2.45, -42.9, FACE.px);
  sign(ctx, M, kit, X);
}

// 雨棚上方的灯箱招牌：发光底板 + 深色字（贴花压在发光面前面）
function sign(ctx, M, kit, X) {
  const { mats } = ctx;
  const LH = 136;
  const rect = kit.label('sign', 1024, LH, (c, w, h) => {
    c.fillStyle = '#10161c';
    c.textBaseline = 'middle';
    c.font = `700 84px ${UI_FONT}`;
    c.fillText('港务调度中心', 24, h / 2 + 4);
    c.font = `700 54px ${STENCIL_FONT}`;
    c.textAlign = 'right';
    c.fillText('PORT OPS · B2', w - 24, h / 2 + 6);
    distress(c, w, h, ctx.rand, 0.12);
  });
  // 顶到腰线上沿（上面 2 cm 就是二层窗台的压顶），雨棚挑得短，院子里离门 14 m 以外整块都看得见
  const zc = PORTAL.officeFront.z, w = 5.2, h = 0.68, y = 4.98;
  kit.box(mats.plasticBlack, 0.16, h + 0.12, w + 0.12, X + 0.08, y, zc, { r: 0.02 });
  kit.box(M.panel, 0.02, h, w, X + 0.165, y, zc);
  kit.decal(rect, w - 0.2, (w - 0.2) * LH / 1024, X + 0.18, y, zc, FACE.px);
}

// 正门外：平台 + 六级台阶 + 两侧扶手 + 悬挑雨棚（都在 RESERVED.frontSteps 里）
function frontEntrance(ctx, M, kit) {
  const { mats, batch } = ctx;
  const R = RESERVED.frontSteps, X0 = R.x0, land = 9.3, zc = PORTAL.officeFront.z;
  kit.solid(mats.concrete, X0, land, 0, L0, R.z0, R.z1, 'concrete', 3, 0.015);
  stairs(ctx, mats.concrete, { x: R.x1, z: zc, dir: [-1, 0], w: R.z1 - R.z0, y0: 0, y1: L0, run: R.x1 - land, surface: 'concrete', tile: 3 });
  // 踏步前沿的黄色防滑条
  const n = 6, rise = L0 / n, tread = (R.x1 - land) / n;
  for (let i = 0; i < n; i++) kit.box(M.yellow, 0.05, 0.012, R.z1 - R.z0 - 0.3, R.x1 - i * tread - 0.03, (i + 1) * rise + 0.006, zc, { tile: 5.2 });
  kit.box(M.yellow, 0.05, 0.012, R.z1 - R.z0 - 0.3, land - 0.03, L0 + 0.006, zc, { tile: 5.2 });
  // 扶手：斜段顺着台阶，平段沿平台到墙
  for (const z of [R.z0 + 0.12, R.z1 - 0.12]) {
    railing(ctx, mats.galv, { a: [R.x1 - 0.1, z], b: [land, z], ya: 0.0, yb: L0 - rise * 0.4, posts: 0.9, r: 0.024 });
    railing(ctx, mats.galv, { a: [land, z], b: [X0 + 0.05, z], y: L0, posts: 0.9, r: 0.024 });
  }
  // 门口地垫
  kit.box(mats.rubber, 1.3, 0.012, 1.9, X0 + 0.55, L0 + 0.006, zc);
  // 雨棚：钢板盒 + 两根斜撑 + 两盏筒灯。斜撑从下面顶住（上拉的话拉杆会挡住招牌）
  const cx0 = X0, cx1 = CANOPY.x1, cz0 = R.z0 + 0.1, cz1 = R.z1 - 0.1, cy = CANOPY.y, lx = CANOPY.lampX;
  kit.box(M.band, cx1 - cx0, 0.22, cz1 - cz0, (cx0 + cx1) / 2, cy, (cz0 + cz1) / 2, { tile: 5.2, r: 0.02 });
  kit.box(M.facade, cx1 - cx0 - 0.1, 0.02, cz1 - cz0 - 0.1, (cx0 + cx1) / 2 - 0.05, cy - 0.115, (cz0 + cz1) / 2, { tile: 5.2 });
  // 外沿一道滴水槽
  kit.box(mats.galv, 0.05, 0.06, cz1 - cz0, cx1 + 0.02, cy + 0.08, (cz0 + cz1) / 2, { tile: 1.2 });
  kit.col((cx0 + cx1) / 2, cy, (cz0 + cz1) / 2, (cx1 - cx0) / 2, 0.11, (cz1 - cz0) / 2, 'metal');
  for (const z of [cz0 + 0.2, cz1 - 0.2]) {
    batch.add(mats.galv, cylBetween(cx0 + 0.05, 3.0, z, cx1 - 0.3, cy - 0.11, z, 0.028, 8), null, { tile: 1.2 });
    kit.box(mats.galv, 0.04, 0.2, 0.14, cx0 + 0.02, 3.0, z, { tile: 1.2 });
  }
  for (const z of [zc - 0.75, zc + 0.75]) {
    batch.add(mats.plasticBlack, cyl(0.1, 0.1, 0.03, 16), xf(lx, cy - 0.13, z));
    batch.add(M.warm, cyl(0.075, 0.075, 0.01, 16), xf(lx, cy - 0.145, z));
  }
  // 两扇玻璃门向里开，贴着门洞两侧的墙
  const doorX = WALLS.officeEast.x - 0.2;
  for (const s of [-1, 1]) {
    const z = zc + s * (PORTAL.officeFront.w / 2 - 0.04), x = doorX - 0.5;
    // 铝框：上下冒头、两根边梃，中间整片玻璃
    for (const y of [L0 + 0.06, L0 + 2.12]) kit.box(mats.steelIn, 1.0, y < 2 ? 0.12 : 0.06, 0.05, x, y, z, { r: 0.006 });
    for (const dx of [-0.47, 0.47]) kit.box(mats.steelIn, 0.06, 2.15, 0.05, x + dx, L0 + 1.075, z, { r: 0.006 });
    kit.box(mats.glass, 0.88, 1.97, 0.012, x, L0 + 1.105, z);
    kit.box(mats.galv, 0.03, 0.03, 0.3, x - 0.3, L0 + 1.05, z - s * 0.06, { tile: 1.2 });
    kit.col(x, L0 + 1.075, z, 0.5, 1.075, 0.03, 'glass');
  }
}
