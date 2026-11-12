import { wallX, wallZ } from '../build.js';
import { STENCIL_FONT } from '../labels.js';
import { IN, L0, G_SOFFIT, CEIL, PT, DOOR_H, WIN_N, UI_FONT, FACE, SPOTS, skirting } from './office_layout.js';
import { frame, pod, chair, cabinet, shelving, sofa, table, desk } from './office_furn.js';
import { rackRow, crac, vending, copier, lockers, noticeBoard, clock, extinguisher, radiator, doorLeaf, litter, whiteboard, acUnit } from './office_props.js';
import { buildCeiling, panelGrid, cellOf } from './office_ceiling.js';
import { palletStack } from '../props.js';
import { box } from '../../gfx/geo.js';
import { veneer, cartonUV } from './office_mats.js';

// 一层（楼面 1.1）：东头大堂和前台，中间开放办公区，西北角库房和机房，西头一个过厅，
// 南边一条走廊把仓库的 officeA、officeB 两扇门串起来。
// 隔墙 0.15 厚，砌到二层楼板底；门洞 2.1 高，净宽都不小于 1.3。
const Y0 = L0, Y1 = G_SOFFIT, CY = CEIL[0];
const W_SS = -42.225; // 库房 / 机房南墙
const W_SD = -18.225; // 库房和机房之间
const W_WE = -12.675; // 机房、过厅和办公区之间
const W_CR = -35.275; // 走廊北墙
const W_LB = 1.6; // 大堂西墙

export const G_ROOMS = {
  store: { x0: -24.0, x1: W_SD - PT / 2, z0: IN.z0, z1: W_SS - PT / 2 },
  server: { x0: W_SD + PT / 2, x1: W_WE - PT / 2, z0: IN.z0, z1: W_SS - PT / 2 },
  work: { x0: W_WE + PT / 2, x1: W_LB - PT / 2, z0: IN.z0, z1: W_CR - PT / 2 },
  lobby: { x0: W_LB + PT / 2, x1: IN.x1, z0: IN.z0, z1: IN.z1 },
  corridor: { x0: -24.0, x1: W_LB - PT / 2, z0: W_CR + PT / 2, z1: IN.z1 },
};

export function buildGround(ctx, M, kit) {
  const { mats, rand } = ctx;
  const frameMat = mats.steelIn;
  const door = (a, b) => ({ a, b, y0: Y0, y1: Y0 + DOOR_H, frame: frameMat });
  const glazed = (a, b) => ({ a, b, y0: Y0 + 1.0, y1: Y0 + 2.1, pane: mats.glass, frame: frameMat });
  const P = { y0: Y0, y1: Y1, t: PT };
  const walls = [
    ['x', { ...P, z: W_SS, x0: -24.0, x1: W_WE - PT / 2, holes: [door(-21.7, -20.3), door(-16.1, -14.7)] }],
    ['z', { ...P, x: W_SD, z0: IN.z0, z1: W_SS - PT / 2 }],
    ['z', { ...P, x: W_WE, z0: IN.z0, z1: W_CR - PT / 2, holes: [door(-45.25, -43.95), door(-39.9, -38.3)] }],
    ['x', { ...P, z: W_CR, x0: -24.0, x1: W_LB - PT / 2, holes: [door(-21.6, -20.0), door(-15.6, -14.0), door(-10.4, -8.8), glazed(-7.8, -4.4), door(-3.0, -1.4), glazed(-0.8, 1.0)] }],
    ['z', { ...P, x: W_LB, z0: IN.z0, z1: W_CR + PT / 2, holes: [door(-46.6, -44.6)] }],
  ];
  for (const [along, o] of walls) {
    (along === 'x' ? wallX : wallZ)(ctx, M.wall, o);
    skirting(kit, M.accent, along, o);
  }

  store(ctx, M, kit);
  server(ctx, M, kit);
  hall(ctx, M, kit);
  work(ctx, M, kit);
  lobby(ctx, M, kit);
  corridor(ctx, M, kit);

  // 北窗下的暖气片
  for (const [a, b] of WIN_N[0]) if (a > -12.6 && b < W_LB) radiator(ctx, M, { x: (a + b) / 2, y: Y0, z: IN.z0, w: Math.min(1.2, b - a - 0.4) });
  // 吊顶
  const R = G_ROOMS;
  const hall1 = { x0: -29.6, x1: -24.0, z0: -41.0, z1: IN.z1 }, hall2 = { x0: -24.0, x1: W_WE - PT / 2, z0: W_SS + PT / 2, z1: W_CR - PT / 2 };
  const holes = [cellOf(-8.0, -34.2), cellOf(-6.2, -43.2), cellOf(-5.6, -43.2), cellOf(-20.6, -37.6)];
  buildCeiling(ctx, M, kit, {
    y: CY,
    rooms: [
      { ...R.store, panels: panelGrid(R.store, [4, 4], [2, 1], { off: [1] }) },
      { ...R.server, panels: panelGrid(R.server, [4, 4], [0, 1], { off: [0, 2] }) },
      { ...hall1, panels: panelGrid(hall1, [4, 4], [2, 3]) },
      { ...hall2, panels: panelGrid(hall2, [4, 4], [2, 3], { bad: [1] }) },
      // 聚光灯正上方那块灯板接触不良，和灯一起闪
      { ...R.work, panels: [...panelGrid(R.work, [4, 4], [2, 1], { off: [3] }), [...cellOf(...SPOTS.gWork), 2]] },
      // 走廊只有 2.3 米宽，四排格子里只有正中那排离两边墙都够 0.4，灯板得排在这一排上
      { ...R.corridor, panels: panelGrid(R.corridor, [5, 3], [2, 1], { off: [2, 5] }) },
      { ...R.lobby, kind: 'plain' },
    ],
    holes,
    ducts: [
      { box: [-24.0, 1.5, -34.6, -34.0] },
      { box: [-12.6, 1.5, -43.5, -42.9], h: 0.4 },
      { a: [-6.2, -43.0], b: [-6.2, -39.0], r: 0.16 },
      { a: [-21.5, -37.6], b: [-18.5, -37.6], r: 0.14 },
    ],
    downlights: [[3.0, -46.0], [6.0, -46.0], [3.0, -43.0], [6.0, -43.0], [6.0, -40.0], [3.0, -37.0], [6.0, -37.0], [3.0, -34.2], [6.0, -34.2], SPOTS.lobby],
  });
  // 出生点四周至少 1 m 净空：同一个点第二次用时会随机错开 1.4 m，太挤会把人放进家具里。
  // 机房过道只有 1.7 m 宽，那个点挪到过厅；大堂是进门第一眼，不放
  return {
    spawns: [
      { x: -23.0, y: Y0, z: -46.0 }, { x: -20.0, y: Y0, z: -40.6 }, { x: -27.0, y: Y0, z: -36.6 },
      { x: -11.5, y: Y0, z: -43.1 }, { x: -0.5, y: Y0, z: -43.0 },
    ],
  };
}

// 库房：靠北墙一排货架，中间一组背靠背的岛架，两扇门（楼梯间东门、南门）
function store(ctx, M, kit) {
  for (const x of [-23.25, -21.9, -20.55, -19.2]) shelving(ctx, M, { x, y: Y0, z: -47.32, w: 1.3, d: 0.5, h: 2.1 });
  for (const x of [-21.65, -20.35]) for (const [z, ry] of [[-44.8, Math.PI], [-44.3, 0]]) shelving(ctx, M, { x, y: Y0, z, ry, w: 1.3, d: 0.5, h: 1.8, levels: 4 });
  // 叠着的椅子、靠墙的梯子、地上的纸箱
  for (let i = 0; i < 3; i++) chair(ctx, M, { x: -18.75, y: Y0 + i * 0.12, z: -43.0, ry: 0.3 + i * 0.05 });
  // 铝梯：两根槽形立柱、七根横档、脚底橡胶套，脚离墙 0.6 m，顶端靠在西墙上
  const lad = frame(ctx, -23.39, Y0, -43.2, 0, 0.25), LL = 2.32;
  for (const s of [-1, 1]) {
    lad.add(ctx.mats.galvIn, box(0.06, LL, 0.025), 0, LL / 2, s * 0.2, { tile: 1.2 });
    lad.add(ctx.mats.rubber, box(0.07, 0.06, 0.035), 0, 0.03, s * 0.2);
  }
  for (let i = 0; i < 7; i++) lad.add(ctx.mats.galvIn, box(0.03, 0.028, 0.38), 0, 0.28 + i * 0.29, 0, { tile: 1.2 });
  litter(ctx, M, { x0: -23.5, x1: -19.2, z0: -46.8, z1: -45.4, y: Y0, n: 4, boxes: 3 });
  kit.decal(roomPlate(kit, '库房', 'STORE'), 0.32, 0.12, -22.4, Y0 + 1.6, W_SS + PT / 2 + 0.003, FACE.pz);
}

// 机房：两排机柜和一台精密空调，门牌和一张“非请勿入”
function server(ctx, M, kit) {
  rackRow(ctx, M, { x: -15.75, y: Y0, z: -47.0, n: 8, tag: 'A' });
  crac(ctx, M, { x: -13.05, y: Y0, z: -47.0 });
  rackRow(ctx, M, { x: -16.35, y: Y0, z: -44.5, n: 6, tag: 'B' });
  extinguisher(ctx, M, { x: -12.9, y: Y0 + 0.3, z: -42.9, ry: FACE.nx });
  // 机房门：钢质防火门，开着
  doorLeaf(ctx, M, { x: -14.72 + 0.03, y: Y0, z: W_SS + PT / 2 + 0.68, ry: Math.PI / 2, w: 1.3, wood: false });
  kit.decal(roomPlate(kit, '机房', 'SERVER'), 0.32, 0.12, -17.0, Y0 + 1.6, W_SS + PT / 2 + 0.003, FACE.pz);
  const warn = kit.label('authorized', 256, 128, (c, w, h) => {
    c.fillStyle = '#f1efe8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#b3201a'; c.fillRect(0, 0, w, 40);
    c.fillStyle = '#fff'; c.font = `700 30px ${UI_FONT}`; c.textAlign = 'center'; c.fillText('非请勿入', w / 2, 31);
    c.fillStyle = '#1a1a1a'; c.font = `600 22px ${UI_FONT}`; c.fillText('机房重地 · 刷卡进出', w / 2, 76);
    c.font = `600 18px ${STENCIL_FONT}`; c.fillText('AUTHORIZED PERSONNEL ONLY', w / 2, 108);
  });
  kit.decal(warn, 0.36, 0.18, -15.4, Y0 + 2.3, W_SS + PT / 2 + 0.003, FACE.pz);
}

// 过厅：楼梯间门口。售货机、更衣柜、复印机、一张掀翻的桌子当掩体
function hall(ctx, M, kit) {
  vending(ctx, M, { x: -23.4, y: Y0, z: W_SS + PT / 2 + 0.41 });
  vending(ctx, M, { x: -22.46, y: Y0, z: W_SS + PT / 2 + 0.41 });
  copier(ctx, M, { x: -13.08, y: Y0, z: W_SS + PT / 2 + 0.34 });
  lockers(ctx, M, { x: -29.35, y: Y0, z: -40.3, ry: Math.PI / 2, cols: 3 });
  lockers(ctx, M, { x: -29.35, y: Y0, z: -36.9, ry: Math.PI / 2, cols: 4 });
  table(ctx, M, { x: -16.2, y: Y0, z: -38.0, ry: 0.25, w: 1.8, d: 0.9, fallen: true });
  chair(ctx, M, { x: -15.6, y: Y0, z: -39.1, ry: 1.4, fallen: true });
  chair(ctx, M, { x: -21.4, y: Y0, z: -38.6, ry: 2.6 });
  noticeBoard(ctx, M, { x: -18.9, y: Y0 + 1.55, z: W_SS + PT / 2, w: 1.0, h: 0.75 });
  extinguisher(ctx, M, { x: -18.3, y: Y0 + 0.3, z: -39.99, ry: 0 });
  clock(ctx, M, { x: -27.6, y: Y0 + 2.45, z: -40.99, ry: 0 });
  // 楼梯间南门：钢质防火门，铰链在西侧，开着
  doorLeaf(ctx, M, { x: -25.98, y: Y0, z: -40.99 + 0.68, ry: Math.PI / 2, w: 1.34, wood: false });
  // 三托盘复印纸：齐腰高的掩体。楼梯间门口那托离开着的门扇 1.6 m，中间不留卡人的窄缝
  for (const [x, z, ry] of [[-22.0, -37.6, 0.15], [-27.0, -33.35, 0], [-25.2, -37.8, 0.3]]) {
    palletStack(ctx, { x, y: Y0, z, n: 1, yaw: ry });
    const f = frame(ctx, x, Y0 + 0.144, z, ry);
    for (let i = 0; i < 6; i++) f.add(M.cardboard, cartonUV(kit.rb(0.43, 0.28, 0.3, 0.006)), -0.38 + (i % 3) * 0.38, 0.14 + Math.floor(i / 3) * 0.29, (i % 2 ? 0.17 : -0.17), { ry: (ctx.rand() - 0.5) * 0.06 });
    f.add(M.cardboard, cartonUV(kit.rb(0.43, 0.28, 0.3, 0.006)), 0.05, 0.72, 0.0, { ry: 0.4 });
    ctx.phys.solid(f.m, 0, 0.45, 0, 0.6, 0.45, 0.4, 'wood');
  }
  litter(ctx, M, { x0: -23, x1: -14, z0: -41.2, z1: -36.2, y: Y0, n: 7 });
}

// 开放办公区：四组工位、一排文件柜、复印机、白板
function work(ctx, M, kit) {
  pod(ctx, M, { x: -9.6, y: Y0, z: -45.5 });
  pod(ctx, M, { x: -3.2, y: Y0, z: -45.5, empty: [1] });
  pod(ctx, M, { x: -9.6, y: Y0, z: -37.8 });
  pod(ctx, M, { x: -3.2, y: Y0, z: -37.8, empty: [2, 3] });
  for (const x of [-10.55, -9.65, -8.75]) cabinet(ctx, M, { x, y: Y0, z: -41.9, h: 1.03 });
  cabinet(ctx, M, { x: -2.0, y: Y0, z: -41.6, ry: 0.4, h: 1.32, fallen: true });
  copier(ctx, M, { x: W_LB - PT / 2 - 0.34, y: Y0, z: -41.7, ry: FACE.nx });
  whiteboard(ctx, M, { x: W_LB - PT / 2, y: Y0 + 1.6, z: -38.8, ry: FACE.nx, key: 'wbG' });
  clock(ctx, M, { x: W_WE + PT / 2, y: Y0 + 2.5, z: -41.2, ry: FACE.px });
  acUnit(ctx, M, { x: W_WE + PT / 2, y: Y0 + 2.4, z: -36.6, ry: FACE.px });
  extinguisher(ctx, M, { x: -6.4, y: Y0 + 0.3, z: -39.99, ry: 0 });
  litter(ctx, M, { x0: -11, x1: -1, z0: -43.8, z1: -39.2, y: Y0, n: 9 });
}

// 大堂：前台、形象墙、等候沙发、楼层指引
function lobby(ctx, M, kit) {
  const { mats } = ctx;
  // 前台：外侧 1.1 高的深色挡板，台面木纹，里面一层 0.74 的工作台
  const f = frame(ctx, 3.6, Y0, -40.0, 0);
  f.add(M.accent, kit.rb(0.12, 1.06, 4.8), 0.3, 0.53, 0, { tile: 3 });
  f.add(M.laminateDark, veneer(kit.rb(0.5, 0.04, 5.0), 1.2, true), 0.25, 1.08, 0);
  for (const s of [-1, 1]) f.add(M.accent, kit.rb(0.7, 1.06, 0.1), 0.0, 0.53, s * 2.35, { tile: 3 });
  f.add(M.warm, kit.rb(0.01, 0.02, 4.6), 0.37, 0.05, 0);
  f.solid(0.0, 0.55, 0, 0.36, 0.55, 2.4, 'wood');
  // 台面里侧的工作台（矮），接待员面朝东坐
  desk(ctx, M, { x: 2.94, y: Y0, z: -40.6, ry: FACE.nx, w: 1.4, d: 0.6, pedestal: false, collide: false, on: true });
  chair(ctx, M, { x: 2.3, y: Y0, z: -40.5, ry: FACE.px + 0.3 });
  // 形象墙
  kit.box(M.accent, 0.03, CY - Y0, 7.0, W_LB + PT / 2 + 0.015, (Y0 + CY) / 2, -40.0, { tile: 3 });
  kit.box(M.warm, 0.03, 0.02, 6.8, W_LB + PT / 2 + 0.06, CY - 0.06, -40.0);
  const logo = kit.label('logo', 1024, 384, (c, w, h) => {
    c.strokeStyle = '#d9d6cc'; c.lineWidth = 22;
    c.beginPath(); c.arc(170, 190, 120, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 14;
    for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(80, 170 + i * 36); c.bezierCurveTo(130, 150 + i * 36, 210, 190 + i * 36, 260, 170 + i * 36); c.stroke(); }
    c.fillStyle = '#e4e1d8';
    c.font = `700 130px ${UI_FONT}`; c.fillText('零号码头', 330, 210);
    c.font = `600 48px ${STENCIL_FONT}`; c.fillText('DOCK ZERO  ·  PORT OPERATIONS', 336, 300);
  });
  kit.decal(logo, 4.2, 1.575, W_LB + PT / 2 + 0.033, Y0 + 1.75, -40.0, FACE.px);
  // 等候区
  sofa(ctx, M, { x: 4.6, y: Y0, z: -47.18, ry: 0 });
  // 一头顶到北墙：留着 1.1 m 的空当就是个卡人的死角
  sofa(ctx, M, { x: 7.6, y: Y0, z: -46.6, ry: FACE.nx });
  const t = frame(ctx, 4.6, Y0, -45.95, 0);
  t.add(M.laminate, veneer(kit.rb(1.1, 0.04, 0.55)), 0, 0.4, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.add(mats.steelIn, kit.rb(0.03, 0.38, 0.03), sx * 0.5, 0.19, sz * 0.22, { tile: 1.2 });
  // 楼层指引牌（立式）
  const dir = kit.label('directory', 256, 384, (c, w, h) => {
    c.fillStyle = '#1c2a36'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8e6df'; c.font = `700 34px ${UI_FONT}`; c.fillText('楼层指引', 22, 52);
    c.font = `600 22px ${STENCIL_FONT}`; c.fillText('DIRECTORY', 22, 84);
    c.fillRect(22, 100, w - 44, 3);
    c.font = `600 26px ${UI_FONT}`;
    [['2F', '调度室 · 会议室'], ['', '主管办公室 · 茶水间'], ['1F', '前台 · 开放办公'], ['', '机房 · 库房'], ['B', '仓库 → 南侧走廊']].forEach(([a, b], i) => {
      c.fillStyle = '#e0b52c'; c.fillText(a, 22, 150 + i * 46); c.fillStyle = '#e8e6df'; c.fillText(b, 70, 150 + i * 46);
    });
  });
  const d = frame(ctx, 6.4, Y0, -35.6, -0.5);
  d.add(mats.steelIn, kit.rb(0.62, 1.5, 0.06), 0, 0.85, 0, { tile: 1.2 });
  d.add(mats.steelIn, kit.rb(0.4, 0.02, 0.3), 0, 0.01, 0, { tile: 1.2 });
  d.decal(dir, 0.56, 0.84, 0, 1.15, 0.031);
  // 门口地垫、门边灭火器
  kit.box(mats.rubber, 1.4, 0.01, 2.0, 7.2, Y0 + 0.005, -40.0);
  extinguisher(ctx, M, { x: IN.x1, y: Y0 + 0.3, z: -42.0, ry: FACE.nx });
}

// 走廊：两堆搬家的纸箱当掩体，墙上的空调和公告栏
function corridor(ctx, M, kit) {
  for (const [x, ry] of [[-17.5, 0.05], [-5.6, -0.08]]) {
    const f = frame(ctx, x, Y0, -33.4, ry);
    for (const [lx, ly, lz, s] of [[-0.32, 0, -0.18, 0.5], [0.3, 0, -0.15, 0.55], [-0.3, 0, 0.22, 0.48], [0.28, 0, 0.2, 0.46], [-0.1, 0.5, 0, 0.5]]) {
      f.add(M.cardboard, cartonUV(kit.rb(s * 1.15, s, s * 0.85)), lx, ly + s / 2, lz, { ry: (ctx.rand() - 0.5) * 0.2 });
    }
    f.solid(0, 0.5, 0, 0.62, 0.5, 0.42, 'wood');
  }
  noticeBoard(ctx, M, { x: -11.6, y: Y0 + 1.6, z: W_CR + PT / 2, w: 1.4, h: 0.9 });
  acUnit(ctx, M, { x: -19.0, y: Y0 + 2.4, z: W_CR + PT / 2 });
  extinguisher(ctx, M, { x: -23.0, y: Y0 + 0.3, z: W_CR + PT / 2, ry: 0 });
  litter(ctx, M, { x0: -22, x1: 0, z0: -34.8, z1: -33.2, y: Y0, n: 6 });
}

function roomPlate(kit, cn, en) {
  return kit.label(`plate${en}`, 256, 96, (c, w, h) => {
    c.fillStyle = '#2b3846'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#eceae3'; c.font = `700 40px ${UI_FONT}`; c.fillText(cn, 18, 50);
    c.font = `600 22px ${STENCIL_FONT}`; c.fillText(en, 20, 82);
  });
}
