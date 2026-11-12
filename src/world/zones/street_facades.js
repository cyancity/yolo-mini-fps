import { xf, box, cyl, cylBetween } from '../../gfx/geo.js';
import { wallZ } from '../build.js';
import { WALLS } from '../plan.js';
import { aabb, cable, decal, rb } from './street_kit.js';
import { TILE } from './street_mats.js';
import { signBoard, graffiti, banner, poster, houseNo } from './street_decals.js';
import * as F from './street_shops.js';

// 街对面一排门面（墙皮在 x 42，楼深 10 米）。北到南七栋，高 7 到 14 米，一楼是铺面，楼上是住家。
// shops 的 t：shutter 卷帘、roller 汽修铺半开大门、frosted 磨砂橱窗、glass 玻璃门、door 铁门、lit / dark 一楼小窗
const { FACE, BACK, WALK } = F;
const DEEP = 10;
const BLD = [
  { z0: -47.6, z1: -37.4, h: 11.6, fl: [4.4, 3.6], up: 'tileGrey', gr: 'renderGrey', win: 3, no: 88,
    shops: [{ t: 'roller', a: -46.9, b: -42.3, top: 3.4 }, { t: 'door', a: -41.7, b: -40.6, top: 2.4 }, { t: 'shutter', a: -40.0, b: -38.0, top: 3.2, paint: 'grey' }],
    board: { key: 'auto', a: -47.1, b: -37.9, cn: '老陈汽修', en: "CHEN'S MOTOR WORKS · 补胎 · 保养 · 钣金喷漆", bg: '#efcf33', fg: '#1a1a1a' } },
  { z0: -37.4, z1: -29.8, h: 7.6, fl: [4.2], up: 'renderOchre', gr: 'renderGrey', win: 2, no: 86, awning: 'teal',
    shops: [{ t: 'shutter', a: -36.8, b: -30.4, top: 3.1, paint: 'blue', banner: '旺铺招租  电联' }],
    board: { key: 'hard', a: -36.9, b: -30.3, cn: '福记五金', en: 'FOOK KEE HARDWARE · 水电 · 工具 · 劳保', bg: '#1b4f9c', fg: '#f4f4f0', sub: '#e9e4d6' } },
  { z0: -29.8, z1: -16.4, h: 14.0, fl: [4.4, 3.2, 3.2], up: 'tileBeige', gr: 'tileGrey', win: 4, no: 84, cages: true,
    shops: [{ t: 'frosted', a: -29.1, b: -25.0, top: 3.2 }, { t: 'glass', a: -24.6, b: -23.3, top: 2.6 }, { t: 'door', a: -22.7, b: -21.6, top: 2.4 },
      { t: 'shutter', a: -21.0, b: -17.0, top: 3.2, paint: 'green', graf: ['NOX47', '#e84a8a', '#f0e04a', '#8a2ae8'] }],
    neon: { key: 'noodle', a: -29.2, b: -23.2 }, blade: { key: 'bladeSpa', z: -17.2, y0: 5.2, flicker: true } },
  { z0: -16.4, z1: -7.2, h: 8.2, fl: [4.4], up: 'renderGrey', gr: 'renderOchre', win: 3, no: 82, awning: 'red',
    shops: [{ t: 'shutter', a: -15.8, b: -11.0, top: 3.3, paint: 'grey' }, { t: 'door', a: -10.4, b: -9.3, top: 2.4 }, { t: 'dark', a: -8.8, b: -7.8, y0: 1.0, top: 2.5 }],
    board: { key: 'marine', a: -15.9, b: -7.6, cn: '海达渔具', en: 'HAIDA MARINE SUPPLY · 船用五金 · 缆绳 · 救生衣', bg: '#e6e1d2', fg: '#0f4c7a' } },
  { z0: -7.2, z1: 5.6, h: 11.2, fl: [4.4, 3.4], up: 'tileGrey', gr: 'renderOchre', win: 4, no: 80, litBias: 0.3,
    shops: [{ t: 'shutter', a: -6.6, b: -2.6, top: 3.2, paint: 'grey', graf: ['KRAW', '#3ad0e8', '#f2f2f2', '#2a6ae8'] }, { t: 'glass', a: -1.6, b: 0.6, top: 2.7 },
      { t: 'lit', a: 1.5, b: 4.3, y0: 0.9, top: 3.0, room: 'room3' }],
    neon: { key: 'innEn', a: -2.6, b: 1.6 }, blade: { key: 'bladeInn', z: 5.05, y0: 4.7 } },
  { z0: 5.6, z1: 12.6, h: 7.2, fl: [4.2], up: 'renderOchre', gr: 'tileGrey', win: 2, no: 78,
    shops: [{ t: 'shutter', a: 6.4, b: 10.6, top: 3.2, paint: 'green' }, { t: 'lit', a: 11.0, b: 11.9, y0: 0.9, top: 1.8, room: 'room0' }],
    lightbox: { key: 'pharm', a: 6.3, b: 12.0 }, cross: 6.0, open: [11.0, 11.9] },
  { z0: 12.6, z1: 21.0, h: 10.2, fl: [4.2, 3.0], up: 'tileBeige', gr: 'renderGrey', win: 3, no: 76,
    shops: [{ t: 'shutter', a: 13.4, b: 18.6, top: 3.2, paint: 'blue', graf: ['R4T', '#f0a03a', '#111', '#e8502a'] }, { t: 'door', a: 19.2, b: 20.3, top: 2.4 }],
    lightbox: { key: 'mart', a: 13.2, b: 18.8, flicker: false } },
];
export const BUILDINGS = BLD;

// 楼层标高：一楼高 fl[0]，往上每层 fl[1]（没给就 3.2），一直到 h
function floorLines(b) {
  const out = [0];
  let y = b.fl[0];
  while (y < b.h - 2.4) { out.push(y); y += b.fl[1] || 3.2; }
  return out;
}

function building(ctx, S, glow, b, i) {
  const { batch, mats, rand } = ctx;
  const x = WALLS.streetEast.x, top = b.h + 0.9, zc = (b.z0 + b.z1) / 2, wid = b.z1 - b.z0;
  const up = S[b.up], gr = S[b.gr] || mats[b.gr];
  const tUp = b.up.startsWith('tile') ? TILE.tile : TILE.render, tGr = b.gr.startsWith('tile') ? TILE.tile : TILE.render;
  const floors = floorLines(b), f0 = b.fl[0];
  // 一楼：铺面洞口
  const holes0 = b.shops.map((s) => ({ a: s.a, b: s.b, y0: s.y0 ?? WALK, y1: s.top }));
  wallZ(ctx, gr, { x, z0: b.z0, z1: b.z1, y0: 0, y1: f0, t: 0.4, holes: holes0, tile: tGr });
  // 楼上：窗洞都装透明玻璃，后面贴屋子。亮灯的贴 room，黑着的贴很暗的 dim（窗帘、百叶、电视光），
  // 不用深色反光玻璃：那种玻璃映出来的颜色和墙差不多，窗户看着像一块空板
  // 每层单独砌一段墙：build.js 的 wallPieces 一次只认一排洞，上下两层同一列的窗洞放进同一次调用会被互相补上
  const rows = floors.map(() => []), lit = [];
  const ww = wid / b.win > 2.6 ? 1.5 : 1.2;
  for (let k = 1; k < floors.length; k++) {
    for (let w = 0; w < b.win; w++) {
      const c = b.z0 + ((w + 0.5) * wid) / b.win, y0 = floors[k] + 0.9, y1 = y0 + 1.5;
      if (b.blade && Math.abs(c - b.blade.z) < 1.2) continue;
      const on = rand() < 0.32 + (b.litBias || 0);
      rows[k].push({ a: c - ww / 2, b: c + ww / 2, y0, y1, pane: mats.glass, frame: S.frame });
      // 黑窗的花样按位置定，不多取随机数（取了会让后面空调、防盗笼的摆法全变）
      lit.push([c, (y0 + y1) / 2, on ? `room${Math.floor(rand() * 6)}` : `dim${(i * 3 + k * 5 + w * 7) % 4}`]);
      batch.add(mats.concrete, rb(0.14, 0.07, ww + 0.16, 0.01), xf(FACE - 0.05, y0 - 0.05, c), { tile: TILE.conc });
      batch.add(S.frame, box(0.05, 1.5, 0.05), xf(x, (y0 + y1) / 2, c), { tile: TILE.paint });
      if (b.cages && k <= 2 && rand() < 0.6) F.cage(ctx, S, c - ww / 2 - 0.1, c + ww / 2 + 0.1, y0 - 0.35, y1 + 0.15);
      else if (rand() < 0.45) F.acUnit(ctx, S, c + (rand() < 0.5 ? -0.25 : 0.25), y0 - 0.5);
    }
  }
  if (floors.length < 2) wallZ(ctx, up, { x, z0: b.z0, z1: b.z1, y0: f0, y1: top, t: 0.4, tile: tUp });
  for (let k = 1; k < floors.length; k++) {
    wallZ(ctx, up, { x, z0: b.z0, z1: b.z1, y0: floors[k], y1: k + 1 < floors.length ? floors[k + 1] : top, t: 0.4, holes: rows[k], tile: tUp });
  }
  for (const [c, y, key] of lit) batch.add(S.neon, glow.quad(key, ww, 1.5), xf(BACK - 0.01, y, c, 0, -Math.PI / 2, 0));
  // 楼层线脚、女儿墙压顶
  for (const y of floors.slice(1)) aabb(ctx, mats.concreteDark, FACE - 0.1, FACE, y - 0.08, y + 0.1, b.z0, b.z1, { tile: TILE.conc });
  aabb(ctx, mats.concreteDark, FACE - 0.08, BACK + 0.05, top, top + 0.1, b.z0, b.z1, { tile: TILE.conc, r: 0.015 });
  // 楼身：只做外壳（屋面、后墙、两侧山墙），里面是空的，汽修铺的车间才放得进去
  const bx = BACK + DEEP / 2, sm = mats.concreteDark;
  aabb(ctx, sm, BACK, BACK + DEEP, b.h - 0.25, b.h, b.z0, b.z1, { tile: TILE.conc });
  aabb(ctx, sm, BACK + DEEP - 0.25, BACK + DEEP, 0, top, b.z0, b.z1, { tile: TILE.conc });
  for (const z of [b.z0 + 0.1, b.z1 - 0.1]) batch.add(up, box(DEEP, top, 0.2), xf(bx, top / 2, z), { tile: tUp });
  roofTop(ctx, S, b, i);
  // 落水管
  const pz = b.z1 - 0.45;
  batch.add(S.grey, cyl(0.05, 0.05, top - 0.3, 10), xf(FACE - 0.1, (top + WALK) / 2 - 0.1, pz), { tile: TILE.paint });
  batch.add(S.grey, rb(0.2, 0.25, 0.25, 0.02), xf(FACE - 0.1, top - 0.2, pz), { tile: TILE.paint });
  for (let y = 1.5; y < top - 0.5; y += 2.2) batch.add(mats.steelDark, box(0.12, 0.04, 0.14), xf(FACE - 0.06, y, pz), { tile: TILE.galv });
  batch.add(S.grey, cylBetween(FACE - 0.1, WALK + 0.25, pz, FACE - 0.35, WALK + 0.05, pz, 0.05, 8), null, { tile: TILE.paint });
  shops(ctx, S, glow, b);
}

// 一楼的铺面、招牌、雨棚
function shops(ctx, S, glow, b) {
  const f0 = b.fl[0];
  for (const s of b.shops) {
    if (s.t === 'shutter') {
      F.shutter(ctx, S, s);
      if (s.graf) decal(ctx, graffiti(ctx, s.graf[0], s.graf[0], s.graf.slice(1)), Math.min(3.2, s.b - s.a - 0.4), 1.3, FACE + 0.05, 1.25, (s.a + s.b) / 2, 'w');
      if (s.banner) decal(ctx, banner(ctx, b.no, s.banner), 2.4, 0.38, FACE + 0.05, 2.5, (s.a + s.b) / 2, 'w');
    } else if (s.t === 'roller') F.workshop(ctx, S, s, glow);
    else if (s.t === 'frosted') F.frosted(ctx, S, s, glow);
    else if (s.t === 'glass') F.glassDoor(ctx, S, s, glow);
    else if (s.t === 'door') F.steelDoor(ctx, S, s, houseNo(ctx, b.no));
    else F.smallWindow(ctx, S, s, glow, s.t === 'lit');
  }
  // 招牌压在铺面洞口上沿和二楼楼板之间
  const sy0 = Math.max(...b.shops.map((s) => s.top)) + 0.2, sy1 = Math.min(f0 - 0.15, sy0 + 0.85);
  if (b.board) {
    const o = b.board;
    F.boardSign(ctx, S, signBoard(ctx, o.key, o.cn, o.en, o), o.a, o.b, sy0, sy1);
  }
  if (b.neon) F.glowSign(ctx, S, glow, b.neon.key, b.neon.a, b.neon.b, sy0 + 0.1, sy1);
  if (b.lightbox) F.glowSign(ctx, S, glow, b.lightbox.key, b.lightbox.a, b.lightbox.b, sy0, sy1);
  if (b.blade) F.blade(ctx, S, glow, b.blade.key, b.blade.z, b.blade.y0, 3.9, 0.9, b.blade.flicker ? S.flicker : null);
  if (b.cross) F.blade(ctx, S, glow, 'cross', b.cross, sy0 - 0.05, 0.8, 0.8);
  if (b.open) F.glowSign(ctx, S, glow, 'open', b.open[0], b.open[1], 1.9, 2.3);
  if (b.awning) F.awning(ctx, S, b.z0 + 0.4, b.z1 - 0.4, sy0 - 0.12, S[b.awning]);
  // 墙上的小广告
  if (b.no % 4 === 0) for (let k = 0; k < 2; k++) decal(ctx, poster(ctx, (b.no + k) % 4), 0.42, 0.58, FACE, 1.5 + k * 0.1, b.z1 - 0.9 - k * 0.5, 'w');
}

// 屋顶：水箱、空调外机、天线，楼顶上的人看得见
function roofTop(ctx, S, b, i) {
  const { batch, mats } = ctx;
  const y = b.h, zc = (b.z0 + b.z1) / 2;
  const tx = BACK + 6 + (i % 2), tz = zc + (i % 3 - 1) * 2;
  batch.add(S.grey, cyl(0.6, 0.6, 1.3, 16), xf(tx, y + 1.0, tz), { tile: TILE.paint });
  batch.add(S.grey, cyl(0.62, 0.62, 0.05, 16), xf(tx, y + 1.67, tz), { tile: TILE.paint });
  for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) batch.add(mats.steelDark, box(0.05, 0.35, 0.05), xf(tx + dx, y + 0.18, tz + dz), { tile: TILE.galv });
  batch.add(mats.steelDark, box(1.1, 0.05, 1.1), xf(tx, y + 0.36, tz), { tile: TILE.galv });
  for (let k = 0; k < 2; k++) batch.add(S.grey, rb(0.8, 0.6, 0.35, 0.02), xf(BACK + 2.2 + k * 1.1, y + 0.3, b.z0 + 1.2), { tile: TILE.paint });
  if (i % 2 === 0) {
    batch.add(mats.galv, cyl(0.025, 0.035, 3.2, 6), xf(BACK + 3, y + 1.6, b.z1 - 1.5), { tile: TILE.galv });
    for (const k of [0, 1, 2]) batch.add(mats.galv, box(0.02, 0.02, 1.2 - k * 0.3), xf(BACK + 3, y + 2.4 + k * 0.35, b.z1 - 1.5), { tile: TILE.galv });
  }
}

// 门面上横拉的电缆束：每栋分界处挂一个钩子，中间往下垂
function facadeCables(ctx) {
  const { mats } = ctx;
  const cuts = [BLD[0].z0, ...BLD.map((b) => b.z1)];
  for (const [y, sag, r] of [[5.0, 0.3, 0.018], [5.12, 0.22, 0.012], [5.3, 0.35, 0.009]]) {
    for (let i = 0; i < cuts.length - 1; i++) cable(ctx, mats.black, [FACE - 0.08, y, cuts[i] + 0.3], [FACE - 0.08, y, cuts[i + 1] - 0.3], sag, r, 8);
  }
  for (const z of cuts) ctx.batch.add(mats.steelDark, box(0.14, 0.06, 0.06), xf(FACE - 0.07, 5.05, z), { tile: TILE.galv });
}

// 分户的壁柱
function pilasters(ctx) {
  for (let i = 1; i < BLD.length; i++) {
    const z = BLD[i].z0, h = Math.max(BLD[i].h, BLD[i - 1].h) + 0.9;
    aabb(ctx, ctx.mats.concreteDark, FACE - 0.22, FACE, 0, h, z - 0.24, z + 0.24, { tile: TILE.conc, surface: 'concrete' });
  }
}

export function buildFacades(ctx, S, glow) {
  BLD.forEach((b, i) => building(ctx, S, glow, b, i));
  pilasters(ctx);
  facadeCables(ctx);
}
