import * as THREE from 'three';
import { xf, box } from '../../gfx/geo.js';
import { jerseyBarrier, palletStack, crate, cableSpool, cone, bollard, tarpCargo, noPerch } from '../props.js';
import { WALLS } from '../plan.js';
import { mulberry32 } from '../labels.js';
import { decal, rb } from './street_kit.js';
import { TILE } from './street_mats.js';
import { KERB, WALK_Y } from './street_furniture.js';
import { boxTruck, van } from './street_vehicles.js';
import * as SP from './street_props.js';
import { graffiti, poster, warnSign, roundSign } from './street_decals.js';

// 街道上的摆放：车、掩体、街道家具、南端路障。坐标按 plan.js：街道 x 29.3..42，人行道 x 38.8..42。
// 西侧靠墙的东西要么贴墙（缝 < 0.3），要么离墙 1.3 以上，不留能卡人的缝。
export const BARRICADE_Z = 18.2;

function westSide(ctx, S) {
  // 东门北边、靠堆场墙的托盘和木箱垛（高过人，挡住从东门往北看的视线）
  palletStack(ctx, { x: 29.75, z: -15.9, n: 7, yaw: Math.PI / 2 });
  palletStack(ctx, { x: 30.6, z: -15.85, n: 6, yaw: Math.PI / 2 + 0.03 });
  crate(ctx, { x: 29.8, y: 7 * 0.144, z: -15.95, yaw: 0.05, w: 0.8, h: 0.8, d: 1.1 });
  crate(ctx, { x: 30.65, y: 6 * 0.144, z: -15.8, yaw: -0.08, w: 0.8, h: 0.9, d: 1.0 });
  cableSpool(ctx, { x: 29.68, z: -11.6, yaw: 0 });
  crate(ctx, { x: 29.85, z: -5.25, yaw: 0.03, w: 1.0, h: 0.9, d: 1.1 });
  crate(ctx, { x: 29.85, z: -4.15, yaw: -0.02, w: 1.0, h: 0.8, d: 1.0 });
  crate(ctx, { x: 29.9, y: 0.92, z: -5.1, yaw: 0.2, w: 0.8, h: 0.6, d: 0.7 });
  // 冷藏车和仓库墙之间的夹道，中段横着卸下来两垛木箱，把夹道隔成南北两个各 4 米左右的凹口：
  // 不留超过 6 米的死胡同，从卸货场门口也看不进南半截（出生点在那里）。木箱和车厢之间不留能挤进去的缝
  crate(ctx, { x: 30.6, z: -28.6, yaw: 0, w: 1.1, h: 1.0, d: 0.9 });
  crate(ctx, { x: 30.62, y: 1.02, z: -28.6, yaw: 0.06, w: 0.9, h: 0.8, d: 0.8 });
  crate(ctx, { x: 31.66, z: -28.6, yaw: 0, w: 0.9, h: 1.0, d: 0.8 });
  crate(ctx, { x: 31.64, y: 1.02, z: -28.62, yaw: -0.05, w: 0.8, h: 0.75, d: 0.75 });
  // 卸货场门外斜放的两块水泥隔离墩，彼此、和车头都隔开 1.4 米以上，人和敌人都走得过
  jerseyBarrier(ctx, { x: 33.0, z: -34.0, yaw: 0.35 });
  jerseyBarrier(ctx, { x: 34.4, z: -36.4, yaw: 0.35 });
  // 东门北侧墙上的门牌、涂鸦、小广告
  decal(ctx, warnSign(ctx, 'egate', '零号码头 · 东门', 'DOCK ZERO · EAST GATE · 车辆出入 注意安全', { bg: '#e8e4d8', w: 512, h: 160 }), 1.9, 0.6, 29.3, 2.6, -1.6, 'e');
  decal(ctx, graffiti(ctx, 'wall1', 'DZ0', ['#e8e8e0', '#e84a3a', '#c8c8c0']), 2.4, 1.05, 29.3, 1.6, -8.0, 'e');
  decal(ctx, graffiti(ctx, 'wall2', 'NOX', ['#58e870', '#111', '#2a9a40']), 2.0, 0.88, 29.3, 1.3, 16.0, 'e');
  for (let i = 0; i < 4; i++) decal(ctx, poster(ctx, i), 0.4, 0.55, 29.3, 1.55 + (i % 2) * 0.12, -12.2 - i * 0.48, 'e');
  decal(ctx, warnSign(ctx, 'nopark', '禁止停车', 'NO PARKING · 违者拖车', { bg: '#e8e4d8' }), 1.2, 0.6, WALLS.whEast.x + 0.2, 2.2, -21.8, 'e');
}

function eastSide(ctx, S, glow) {
  const y = WALK_Y;
  SP.shelter(ctx, S, glow, { x0: 39.0, x1: 40.2, z0: -25.5, z1: -21.5 });
  SP.cabinet(ctx, S, { x: 39.5, y, z: -18.0 });
  SP.hydrant(ctx, S, { x: 39.25, y, z: -32.6 });
  SP.bin(ctx, S, { x: 41.62, y, z: -36.8, yaw: -Math.PI / 2 });
  SP.bin(ctx, S, { x: 41.62, y, z: -36.15, yaw: -Math.PI / 2 + 0.06, open: true });
  SP.bin(ctx, S, { x: 39.75, y, z: -29.5, yaw: 0.05, big: true, mat: S.grey });
  SP.bin(ctx, S, { x: 41.62, y, z: 13.2, yaw: -Math.PI / 2 - 0.05 });
  SP.bin(ctx, S, { x: 41.62, y, z: -9.0, yaw: -Math.PI / 2, mat: ctx.mats.plasticBlack });
  // 斑马线两头的护栏桩
  for (const z of [-1.95, -0.4, 5.0]) bollard(ctx, { x: KERB + 0.22, y, z });
  for (const z of [-41.0, -39.5]) bollard(ctx, { x: KERB + 0.22, y, z });
  // 旅社门前的花池，贴着墙
  SP.planter(ctx, S, { x: 41.74, y, z: -6.35, yaw: Math.PI / 2, w: 0.9, d: 0.5 });
  SP.planter(ctx, S, { x: 41.74, y, z: 4.9, yaw: Math.PI / 2, w: 0.9, d: 0.5 });
  // 汽修铺门口的轮胎和机油桶
  SP.tires(ctx, { x: 41.5, y, z: -43.0, n: 5 });
  SP.tires(ctx, { x: 40.65, y, z: -43.1, n: 2 });
  // 交通标志
  SP.signPost(ctx, S, 39.15, -43.4, 'noPark', 'w');
  SP.signPost(ctx, S, 39.15, 9.0, 'limit', 'w');
  SP.signPost(ctx, S, 39.15, 16.2, 'noEntry', 'w');
}

// 南端：一排水泥墩 + 水马 + 黄闪灯，后面是锁着的栅栏门
function barricade(ctx, S, glow) {
  const z = BARRICADE_Z;
  for (const x of [30.5, 32.9, 37.1]) {
    jerseyBarrier(ctx, { x, z, yaw: Math.PI / 2 });
    SP.blinker(ctx, S, glow, x + 0.6, 0.8, z);
  }
  SP.waterBarrier(ctx, S, { x: 40.5, y: WALK_Y, z }, 0);
  SP.waterBarrier(ctx, S, { x: 41.5, y: WALK_Y, z }, 1);
  SP.aFrame(ctx, S, { x: 35.0, z: z - 2.6, yaw: 0.15 }, '道路封闭', 'ROAD CLOSED');
  // 锥桶摆在水泥墩跟前（缝小于 0.3），不堵墩子之间那道 1.8 米的口子
  for (const [x, dz] of [[33.7, -0.68], [36.6, -0.7], [37.9, -0.66]]) cone(ctx, { x, z: z + dz });
  cone(ctx, { x: 36.2, z: z - 1.6, tip: true, yaw: 2.2 });
  // 门上挂的牌子
  const rect = warnSign(ctx, 'closed', '前方封闭 禁止通行', 'ROAD CLOSED · NO THROUGH TRAFFIC', { w: 512, h: 192 });
  const gz = WALLS.streetSouth.z - 0.07;
  ctx.batch.add(S.frame, rb(1.6, 0.62, 0.03, 0.01), xf(34.45, 1.55, gz), { tile: TILE.paint });
  decal(ctx, rect, 1.52, 0.56, 34.45, 1.55, gz - 0.016, 'n');
  decal(ctx, roundSign(ctx, 'noEntry'), 0.5, 0.5, 31.2, 1.6, gz - 0.03, 'n');
}

// 远景尽头：隔壁集装箱场的大门（关着），门后就是堆场远景里那排集装箱
const GZ = 32.5;
function terminalGate(ctx, S) {
  const { batch, mats } = ctx;
  for (const [x0, x1] of [[29.1, 31.4], [38.6, 42.0]]) {
    batch.add(mats.concrete, box(x1 - x0, 2.6, 0.25), xf((x0 + x1) / 2, 1.3, GZ), { tile: TILE.conc });
    batch.add(S.renderGrey, box(x1 - x0, 0.9, 0.27), xf((x0 + x1) / 2, 0.45, GZ), { tile: TILE.render });
  }
  for (const x of [31.55, 38.45]) batch.add(S.frame, box(0.3, 3.0, 0.3), xf(x, 1.5, GZ), { tile: TILE.paint });
  // 推拉门：方管框 + 铁丝网，网眼里能看见后面的箱子
  const x0 = 31.7, x1 = 38.3, y0 = 0.08, y1 = 2.3;
  for (const y of [y0 + 0.03, y1 - 0.03, (y0 + y1) / 2]) batch.add(S.frame, box(x1 - x0, 0.06, 0.06), xf((x0 + x1) / 2, y, GZ), { tile: TILE.paint });
  for (let x = x0; x <= x1 + 1e-3; x += (x1 - x0) / 4) batch.add(S.frame, box(0.06, y1 - y0, 0.06), xf(x, (y0 + y1) / 2, GZ), { tile: TILE.paint });
  const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / 0.48, uv.getY(i) * (y1 - y0) / 0.48);
  batch.add(mats.chainlink, g, xf((x0 + x1) / 2, (y0 + y1) / 2, GZ));
  const rect = warnSign(ctx, 'terminal', '北堤集装箱场 闲人免进', 'NORTHMOLE TERMINAL · NO ENTRY', { w: 512, h: 160 });
  batch.add(S.box, box(2.0, 0.7, 0.03), xf(35.0, 1.75, GZ - 0.05), { tile: TILE.paint });
  decal(ctx, rect, 1.9, 0.6, 35.0, 1.75, GZ - 0.066, 'n');
}

// 南门外的远景：街往南走到隔壁集装箱场门口为止，两边是墙和楼，没有碰撞
function backdrop(ctx, S, glow) {
  const { batch, mats } = ctx;
  // 西侧围墙接到远处那排集装箱为止（堆场远景的箱堆在 z 33 一带）
  batch.add(S.renderGrey, box(0.4, 4.5, 11.3), xf(29.1, 2.25, 26.85), { tile: TILE.render });
  batch.add(S.paver, box(3.2, WALK_Y, 11.2), xf(40.4, WALK_Y / 2, 26.8), { tile: TILE.paver });
  batch.add(mats.concrete, box(0.2, WALK_Y + 0.005, 11.2), xf(KERB + 0.1, WALK_Y / 2, 26.8), { tile: TILE.conc });
  terminalGate(ctx, S);
  const blocks = [[21.0, 29.5, 12.5, 'tileGrey', 'backWin'], [29.5, 38.0, 9.0, 'renderOchre', 'backWin2'], [38.0, 47.0, 15.5, 'tileBeige', 'backWin']];
  for (const [z0, z1, h, mat, win] of blocks) {
    const zc = (z0 + z1) / 2, len = z1 - z0;
    batch.add(S[mat], box(10, h, len), xf(47.0, h / 2, zc), { tile: mat.startsWith('tile') ? TILE.tile : TILE.render });
    batch.add(S.neon, glow.quad(win, len - 1.4, h - 5.2), xf(41.99, (h + 4.2) / 2, zc, 0, -Math.PI / 2, 0));
    batch.add(mats.concreteDark, box(0.3, 0.2, len), xf(41.9, 4.1, zc), { tile: TILE.conc });
  }
  // 远处路口的一盏路灯（只有灯头发光）
  batch.add(mats.concrete, box(0.25, 8, 0.25), xf(39.6, 4, 44), { tile: TILE.conc });
  batch.add(S.box, rb(0.7, 0.16, 0.34, 0.05), xf(37.6, 7.9, 44), { tile: TILE.paint });
  batch.add(mats.emissive(0xffb45e, 70), box(0.46, 0.02, 0.24), xf(37.6, 7.81, 44));
  batch.add(mats.galv, box(2.1, 0.06, 0.06), xf(38.6, 7.95, 44), { tile: TILE.galv });
}

export function buildStreetLayout(ctx, S, glow) {
  westSide(ctx, S);
  eastSide(ctx, S, glow);
  barricade(ctx, S, glow);
  backdrop(ctx, S, glow);
  // 车：卸货场门外靠西停的冷藏车，东侧车位里的两辆面包车
  boxTruck(ctx, S, { x: 33.4, z: -27.5, yaw: Math.PI });
  van(ctx, S, { x: 37.8, z: -9.95, yaw: 0 });
  van(ctx, S, { x: 37.8, z: 12.05, yaw: Math.PI, paint: S.carWhite, mark: true });
  roadside({ ...ctx, rand: mulberry32(7411) }, S);
}

// 街上南北向一眼能望六七十米：东门北边路当中斜停一辆送货车，东门南边墙根卸下一排货，
// 和东侧车位里那两辆错开，把长视线截成几段。用自己的随机数，后面卸货场的摆放不跟着变
function roadside(ctx, S) {
  // 停在东门斑马线北边的停止线上，车头略朝东歪；西边离墙根木箱 3.2 米（主通道），东边离路沿 2.8 米，
  // 车尾和东侧车位里那辆面包车斜着隔开 1.4 米
  van(ctx, S, { x: 34.8, z: -3.8, yaw: 0.08, paint: S.carWhite });
  // 东侧人行道：店门口卸下来等着搬进去的一托货，贴着门面，人行道还剩 1.75 米；
  // 让开南边的电杆（z -15）和北边面包车背后的出生点
  tarpCargo(ctx, { x: 41.25, y: WALK_Y, z: -13.3, yaw: Math.PI / 2 + 0.03, w: 1.4, h: 1.7, d: 1.4, lean: true });
  noPerch(ctx, { x: 41.25, z: -13.3, yaw: Math.PI / 2 + 0.03, hw: 0.7, hd: 0.7, top: WALK_Y + 1.844 });
  // 墙根：一垛矮托盘（顶上压一托薄货，1.084 米）贴墙，一垛盖布货（高），一组两层木箱；东头离南边那辆面包车 3 米。
  // 托盘让开围栏 playerOnly 的盒子（x 到 29.62）；高件顶上罩 noPerch，从托盘上跳不上去
  palletStack(ctx, { x: 30.12, z: 8.6, n: 5, load: 0.22, yaw: Math.PI / 2 + 0.04, lean: true });
  tarpCargo(ctx, { x: 31.41, z: 8.75, yaw: 0.08, w: 1.56, h: 1.7, d: 1.3, lean: true });
  noPerch(ctx, { x: 31.41, z: 8.75, yaw: 0.08, hw: 0.78, hd: 0.65, top: 1.844 });
  crate(ctx, { x: 32.9, z: 8.5, yaw: -0.06, w: 1.2, h: 1.0, d: 0.9, lean: true });
  crate(ctx, { x: 32.93, y: 1.02, z: 8.48, yaw: 0.05, w: 1.0, h: 0.8, d: 0.8, lean: true });
  noPerch(ctx, { x: 32.93, z: 8.48, yaw: 0.05, hw: 0.522, hd: 0.422, top: 1.831 });
}

// 街道上的敌人出生点：冷藏车后夹道的南半截、两辆面包车背后的人行道
export const STREET_SPAWNS = [{ x: 31.1, y: 0, z: -25.6 }, { x: 40.5, y: WALK_Y, z: -11.0 }, { x: 40.3, y: WALK_Y, z: 12.0 }];
