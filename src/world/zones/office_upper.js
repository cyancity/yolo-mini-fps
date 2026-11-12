import { wallX, wallZ } from '../build.js';
import { IN, L2, TOP, CEIL, PT, DOOR_H, WIN_N, WIN_E, WIN_Y, SW, UI_FONT, FACE, SPOTS, skirting } from './office_layout.js';
import { frame, pod, chair, desk, cabinet, sofa, table, monitor } from './office_furn.js';
import { copier, kitchen, whiteboard, noticeBoard, clock, extinguisher, radiator, doorLeaf, blinds, litter, acUnit, vending } from './office_props.js';
import { buildCeiling, panelGrid, cellOf } from './office_ceiling.js';
import { wallCams } from './office_cams.js';

// 二层（楼面 4.6，地毯）：开放办公区占大半，西头茶水角，东北角玻璃会议室，
// 东南角一片靠窗的工位（两扇窗开着，对着卸货场），主管办公室贴着仓库的观察窗。
const Y0 = L2, CY = CEIL[1];
const SUP = { x0: -7.6, x1: -0.4, z1: IN.z1, wn: -37.375, ww: -7.675, we: -0.325 }; // 主管办公室
const MTG = { wx: 0.925, wz: -41.525 }; // 会议室玻璃墙（西、南）

export function buildUpper(ctx, M, kit) {
  const { mats } = ctx;
  const fr = mats.steelIn;
  const door = (a, b) => ({ a, b, y0: Y0, y1: Y0 + DOOR_H, frame: fr });
  const pane = (a, b, y0 = Y0 + 0.9, y1 = Y0 + 2.3) => ({ a, b, y0, y1, pane: mats.glass, frame: fr });
  const P = { y0: Y0, y1: TOP, t: PT };
  // 主管办公室：北面是带玻璃的隔墙，东墙一扇门，西墙实墙
  const walls = [
    ['x', { ...P, z: SUP.wn, x0: SUP.ww - PT / 2, x1: SUP.we + PT / 2, holes: [door(-7.2, -5.9), pane(-5.5, -3.1), pane(-2.9, -0.7)] }],
    ['z', { ...P, x: SUP.ww, z0: SUP.wn + PT / 2, z1: IN.z1 }],
    ['z', { ...P, x: SUP.we, z0: SUP.wn + PT / 2, z1: IN.z1, holes: [door(-35.4, -34.0)] }],
  ];
  for (const [along, o] of walls) {
    (along === 'x' ? wallX : wallZ)(ctx, M.wall, o);
    skirting(kit, M.accent, along, o);
  }
  // 会议室：通高玻璃，细铝框；西墙和南墙各一扇门
  const G = { y0: Y0, y1: TOP, t: 0.1, surface: 'metal', tile: 1.2 };
  const glassY = [Y0 + 0.05, CY - 0.05];
  wallZ(ctx, M.furn, { ...G, x: MTG.wx, z0: IN.z0, z1: MTG.wz + 0.05, holes: [pane(-47.55, -46.15, ...glassY), pane(-46.07, -44.67, ...glassY), door(-44.55, -43.15), pane(-43.07, -41.6, ...glassY)] });
  wallX(ctx, M.furn, { ...G, z: MTG.wz, x0: MTG.wx - 0.05, x1: IN.x1, holes: [pane(1.0, 2.45, ...glassY), pane(2.53, 3.98, ...glassY), pane(4.06, 5.5, ...glassY), door(5.6, 7.0), pane(7.08, 7.97, ...glassY)] });
  // 玻璃上的磨砂腰带（防撞贴）
  const band = kit.label('frost', 512, 32, (c, w, h) => {
    c.fillStyle = 'rgba(235,240,245,0.55)'; c.fillRect(0, 6, w, 20);
    c.fillStyle = 'rgba(235,240,245,0.25)'; for (let x = 4; x < w; x += 14) c.fillRect(x, 0, 8, 4);
  });
  for (const [a, b] of [[-47.55, -44.67], [-43.07, -41.6]]) for (const s of [-1, 1]) kit.decal(band, b - a, 0.12, MTG.wx + s * 0.013, Y0 + 1.45, (a + b) / 2, s > 0 ? FACE.px : FACE.nx);
  for (const [a, b] of [[1.0, 5.5], [7.08, 7.97]]) for (const s of [-1, 1]) kit.decal(band, b - a, 0.12, (a + b) / 2, Y0 + 1.45, MTG.wz + s * 0.013, s > 0 ? FACE.pz : FACE.nz);

  openPlan(ctx, M, kit);
  breakCorner(ctx, M, kit);
  meeting(ctx, M, kit);
  supervisor(ctx, M, kit);
  eastDesks(ctx, M, kit);

  // 楼梯间东门：防火门开着，靠向南侧
  doorLeaf(ctx, M, { x: -24.0 + 0.68, y: Y0, z: -45.3 + 0.03, ry: 0, w: 1.34, wood: false });
  doorLeaf(ctx, M, { x: -25.98, y: Y0, z: -40.99 + 0.68, ry: Math.PI / 2, w: 1.34, wood: false });
  // 北窗：暖气片，一部分窗放着百叶
  WIN_N[1].forEach(([a, b, open], i) => {
    if (a < -24) return;
    radiator(ctx, M, { x: (a + b) / 2, y: Y0, z: IN.z0, w: Math.min(1.2, b - a - 0.4) });
    if (!open && i % 3 !== 1) blinds(ctx, M, { a, b, top: WIN_Y[1][1], drop: 0.3 + ((i * 7) % 5) * 0.18, along: 'x', at: IN.z0 + 0.06 });
  });
  WIN_E[1].forEach(([a, b, open], i) => { if (!open && i < 3) blinds(ctx, M, { a, b, top: WIN_Y[1][1], drop: 0.5 + i * 0.25, along: 'z', at: IN.x1 - 0.06 }); });

  // 吊顶
  const open1 = { x0: SW.x1 + 0.4, x1: SUP.we + PT / 2, z0: IN.z0, z1: SUP.wn - PT / 2 };
  const open2 = { x0: SUP.we + PT / 2, x1: MTG.wx - 0.05, z0: IN.z0, z1: MTG.wz - 0.05 };
  const open3 = { x0: SW.x1 + 0.4, x1: SUP.ww - PT / 2, z0: SUP.wn - PT / 2, z1: IN.z1 };
  const brk = { x0: IN.x0, x1: SW.x1 + 0.4, z0: SW.z1 + 0.4, z1: IN.z1 };
  const mtg = { x0: MTG.wx + 0.05, x1: IN.x1, z0: IN.z0, z1: MTG.wz - 0.05 };
  const east = { x0: SUP.we + PT / 2, x1: IN.x1, z0: MTG.wz + 0.05, z1: IN.z1 };
  const sup = { x0: SUP.ww + PT / 2, x1: SUP.we - PT / 2, z0: SUP.wn + PT / 2, z1: IN.z1 };
  buildCeiling(ctx, M, kit, {
    y: CY,
    rooms: [
      { ...open1, panels: [...panelGrid(open1, [4, 4], [2, 1], { off: [4, 11], bad: [7] }), [...cellOf(...SPOTS.uOpen), 0]] },
      { ...open2, panels: [] },
      { ...open3, panels: panelGrid(open3, [4, 4], [2, 1], { off: [2] }) },
      { ...brk, panels: panelGrid(brk, [4, 4], [1, 3]) },
      { ...mtg, panels: panelGrid(mtg, [3, 3], [1, 1]) },
      { ...east, panels: panelGrid(east, [4, 4], [3, 3], { off: [1] }) },
      { ...sup, panels: [...panelGrid(sup, [4, 3], [2, 1]), [...cellOf(...SPOTS.uSup), 0]] },
    ],
    holes: [cellOf(-15.2, -41.5), cellOf(-15.2, -40.9)],
    ducts: [{ a: [-17.0, -41.2], b: [-13.0, -41.2], r: 0.16 }],
  });
  return {
    spawns: [
      { x: -22.6, y: Y0, z: -43.0 }, { x: -27.4, y: Y0, z: -34.0 }, { x: -2.2, y: Y0, z: -36.2 },
      { x: 6.7, y: Y0, z: -46.5 }, { x: 4.4, y: Y0, z: -34.0 },
    ],
  };
}

// 开放办公区：北排四组、南排两组工位，贴着仓库墙一排单人桌，过道里两组高柜挡视线
function openPlan(ctx, M, kit) {
  for (const x of [-19.4, -13.6, -7.8, -2.2]) pod(ctx, M, { x, y: Y0, z: -45.5, empty: x === -7.8 ? [0, 3] : [] });
  pod(ctx, M, { x: -19.4, y: Y0, z: -37.8 });
  pod(ctx, M, { x: -13.6, y: Y0, z: -37.8, empty: [1] });
  for (const x of [-22.6, -21.0, -17.0, -15.4, -11.6, -10.0]) {
    desk(ctx, M, { x, y: Y0, z: -33.3, ry: Math.PI, dual: ctx.rand() < 0.3 });
    chair(ctx, M, { x: x + (ctx.rand() - 0.5) * 0.3, y: Y0, z: -34.35 - ctx.rand() * 0.2, ry: (ctx.rand() - 0.5) * 0.8 });
  }
  for (const x of [-10.95, -10.05]) cabinet(ctx, M, { x, y: Y0, z: -42.55, h: 2.0 });
  for (const x of [-16.95, -16.05]) cabinet(ctx, M, { x, y: Y0, z: -41.9, h: 2.0, ry: Math.PI });
  table(ctx, M, { x: -4.6, y: Y0, z: -42.2, ry: -0.35, w: 1.6, d: 0.8, fallen: true });
  chair(ctx, M, { x: -3.6, y: Y0, z: -41.1, ry: 0.9, fallen: true });
  copier(ctx, M, { x: 2.9, y: Y0, z: MTG.wz + 0.05 + 0.33, ry: 0 });
  whiteboard(ctx, M, { x: -24.0 + 0.0, y: Y0 + 1.6, z: -42.6, ry: FACE.px, w: 1.6, key: 'wbU' });
  clock(ctx, M, { x: SUP.ww - PT / 2, y: Y0 + 2.2, z: -35.2, ry: FACE.nx });
  for (const [x, z] of [[-18.3, -39.99], [-6.4, -39.99]]) extinguisher(ctx, M, { x, y: Y0 + 0.3, z, ry: 0 });
  litter(ctx, M, { x0: -22, x1: -1, z0: -44.2, z1: -39.3, y: Y0, n: 12, boxes: 2 });
}

// 茶水角：靠楼梯间南墙的茶水台、冰箱，两张圆桌，靠窗的沙发，一台售货机
function breakCorner(ctx, M, kit) {
  // 茶水台右端的冰箱正好顶到楼梯间门的门框，不留缝
  kitchen(ctx, M, { x: -28.12, y: Y0, z: SW.z1 + 0.4 + 0.3, ry: 0, len: 2.8 });
  for (const [x, z] of [[-27.0, -38.0], [-25.6, -35.8]]) {
    table(ctx, M, { x, y: Y0, z, w: 0.9, round: true });
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1 + x;
      chair(ctx, M, { x: x + Math.cos(a) * 0.75, y: Y0, z: z + Math.sin(a) * 0.75, ry: Math.atan2(-Math.cos(a), -Math.sin(a)), fallen: k === 2 && x < -26 });
    }
  }
  sofa(ctx, M, { x: -29.2, y: Y0, z: -33.8, ry: FACE.px, w: 1.8 });
  vending(ctx, M, { x: -25.6, y: Y0, z: -33.35, ry: Math.PI });
  clock(ctx, M, { x: -28.6, y: Y0 + 2.5, z: SW.z1 + 0.4, ry: 0 });
  acUnit(ctx, M, { x: IN.x0, y: Y0 + 2.45, z: -36.9, ry: FACE.px });
  extinguisher(ctx, M, { x: IN.x0, y: Y0 + 0.3, z: -37.3, ry: FACE.px });
}

// 玻璃会议室：长桌、八把椅子、墙上的大屏和白板
function meeting(ctx, M, kit) {
  const { mats } = ctx;
  table(ctx, M, { x: 4.6, y: Y0, z: -44.6, w: 3.6, d: 1.2 });
  for (let i = 0; i < 4; i++) {
    const x = 3.2 + i * 0.95;
    chair(ctx, M, { x: x + (ctx.rand() - 0.5) * 0.2, y: Y0, z: -45.75, ry: (ctx.rand() - 0.5) * 0.4 });
    chair(ctx, M, { x: x + (ctx.rand() - 0.5) * 0.2, y: Y0, z: -43.4, ry: Math.PI + (ctx.rand() - 0.5) * 0.4, fallen: i === 2 });
  }
  // 北墙上的大屏：显示港区监控
  const f = frame(ctx, 4.8, Y0 + 1.55, IN.z0, 0);
  f.add(M.plastic, kit.rb(1.9, 1.1, 0.06), 0, 0, 0.03);
  f.add(M.screen, kit.rb(1.8, 1.0, 0.004, 0.002), 0, 0, 0.062);
  f.decal(wallCams(kit), 1.78, 1.0, 0, 0, 0.065);
  kit.box(M.plastic, 0.3, 0.06, 0.3, 4.6, Y0 + 0.77, -44.6);
}

// 主管办公室：面朝观察窗的大班台、墙边高柜、窗下矮柜、保险柜、墙上一台看监控的屏
function supervisor(ctx, M, kit) {
  const { mats } = ctx;
  desk(ctx, M, { x: -4.0, y: Y0, z: -35.2, ry: Math.PI, w: 1.8, d: 0.85, dual: true, on: true });
  chair(ctx, M, { x: -4.0, y: Y0, z: -36.1, ry: Math.PI });
  cabinet(ctx, M, { x: -7.37, y: Y0, z: -36.75, ry: FACE.px, h: 2.0 });
  // 观察窗下的矮柜（压着窗台，留出窗口的视线）
  cabinet(ctx, M, { x: -6.1, y: Y0, z: IN.z1 - 0.23, ry: Math.PI, w: 1.6, h: 0.72 });
  cabinet(ctx, M, { x: -1.25, y: Y0, z: IN.z1 - 0.23, ry: Math.PI, w: 1.6, h: 0.72 });
  const safe = frame(ctx, -0.72, Y0, -36.98, 0);
  safe.add(M.furn, kit.rb(0.6, 0.75, 0.6, 0.02), 0, 0.375, 0);
  safe.add(mats.steelIn, kit.rb(0.1, 0.1, 0.03), 0.12, 0.45, 0.31, { tile: 1.2 });
  safe.solid(0, 0.375, 0, 0.3, 0.375, 0.3, 'metal');
  const tv = frame(ctx, SUP.we - PT / 2, Y0 + 1.7, -36.2, FACE.nx);
  monitor(ctx, M, tv, 0, -0.36, 0.03, true);
  sofa(ctx, M, { x: -7.2, y: Y0, z: -33.65, ry: FACE.px, w: 1.5 });
  const plate = kit.label('plateSup', 256, 96, (c, w, h) => {
    c.fillStyle = '#2b3846'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#eceae3'; c.font = `700 36px ${UI_FONT}`; c.fillText('调度主管', 18, 48);
    c.font = '600 20px "Bahnschrift", sans-serif'; c.fillText('SUPERVISOR', 20, 80);
  });
  kit.decal(plate, 0.3, 0.11, SUP.we + PT / 2 + 0.003, Y0 + 1.6, -33.4, FACE.px);
  litter(ctx, M, { x0: -6.5, x1: -1.5, z0: -36.8, z1: -34.1, y: Y0, n: 6 });
}

// 东南角：靠东墙两张桌（避开两扇开着的窗），中间一排矮文件柜当掩体
function eastDesks(ctx, M, kit) {
  for (const z of [-40.5, -36.6]) {
    desk(ctx, M, { x: IN.x1 - 0.4, y: Y0, z, ry: FACE.nx, w: 1.6 });
    chair(ctx, M, { x: IN.x1 - 1.25, y: Y0, z: z + (ctx.rand() - 0.5) * 0.4, ry: FACE.px + (ctx.rand() - 0.5) * 0.6 });
  }
  for (const x of [3.95, 4.85]) cabinet(ctx, M, { x, y: Y0, z: -37.5, h: 1.03 });
  noticeBoard(ctx, M, { x: SUP.we + PT / 2, y: Y0 + 1.6, z: -36.4, ry: FACE.px, w: 1.2, h: 0.8 });
  litter(ctx, M, { x0: 1.5, x1: 6.5, z0: -40.5, z1: -33.5, y: Y0, n: 5, boxes: 1 });
}
