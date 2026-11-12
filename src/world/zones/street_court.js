import * as THREE from 'three';
import { xf, box, cyl, cylBetween, corrugated } from '../../gfx/geo.js';
import { crate, palletStack, tarpCargo, cone, barrel } from '../props.js';
import { aabb, collider, decal, rb } from './street_kit.js';
import { TILE } from './street_mats.js';
import { warnSign } from './street_decals.js';
import { forklift } from './street_vehicles.js';

// 卸货场（x 8.4..30，z -47.6..-32.9）：垃圾斗、托盘堆、木箱、吨桶、叉车、洗手池和气瓶笼、墙灯。
// 让开：仓库大门 x 19.5..24.5、消防梯脚 x 9..13.4 z > -36.6、办公楼台阶 x 8.4..11 z -41.6..-38.4，以及从东门进来的通道。
const G = { tile: TILE.galv }, P = { tile: TILE.paint }, K = { tile: TILE.plastic };
const NW = -47.6; // 北墙内皮

// 带盖的钢垃圾斗
function dumpster(ctx, S, x, z) {
  const { batch, mats } = ctx;
  const w = 2.0, d = 1.1, h = 1.25, paint = S.green;
  batch.add(paint, rb(w, h - 0.2, d, 0.03), xf(x, 0.2 + (h - 0.2) / 2, z), P);
  batch.add(paint, rb(w + 0.06, 0.08, d + 0.06, 0.02), xf(x, h - 0.02, z), P);
  for (const s of [-1, 1]) {
    batch.add(mats.plasticBlack, rb(w / 2 - 0.03, 0.05, d + 0.12, 0.02), xf(x + s * w / 4, h + 0.06, z + 0.02, s < 0 ? 0.06 : -0.03, 0, 0), K);
    batch.add(mats.steelDark, cyl(0.06, 0.06, 0.12, 10), xf(x + s * (w / 2 + 0.06), 0.85, z, 0, 0, Math.PI / 2), G);
    for (const sz of [-1, 1]) batch.add(mats.rubber, cyl(0.08, 0.08, 0.05, 10), xf(x + s * 0.8, 0.09, z + sz * 0.38, 0, 0, Math.PI / 2));
  }
  for (const s of [-0.5, 0, 0.5]) batch.add(paint, box(0.08, h - 0.4, 0.03), xf(x + s * w * 0.8, 0.7, z + d / 2 + 0.01), P);
  collider(ctx, x - w / 2 - 0.05, x + w / 2 + 0.05, 0, h + 0.1, z - d / 2 - 0.06, z + d / 2 + 0.06, 'metal');
}

// 吨桶（白色塑料罐 + 镀锌格栅 + 钢托盘）
function ibc(ctx, S, x, z, yaw = 0, y = 0) {
  const { batch, mats } = ctx;
  const m = xf(x, y, z, 0, yaw, 0), w = 1.2, d = 1.0, h = 1.16;
  batch.add(mats.steelDark, box(w, 0.14, d), m.clone().multiply(xf(0, 0.07, 0)), G);
  batch.add(mats.reflective, rb(w - 0.08, h - 0.22, d - 0.08, 0.08), m.clone().multiply(xf(0, 0.14 + (h - 0.22) / 2, 0)));
  batch.add(mats.plasticBlack, cyl(0.1, 0.1, 0.06, 12), m.clone().multiply(xf(0, h - 0.05, 0)), K);
  for (let i = 0; i <= 6; i++) {
    const u = -w / 2 + (i * w) / 6;
    for (const s of [-1, 1]) batch.add(mats.galv, box(0.02, h - 0.14, 0.02), m.clone().multiply(xf(u, 0.14 + (h - 0.14) / 2, s * d / 2)), G);
  }
  for (const y of [0.45, 0.8, h]) for (const s of [-1, 1]) {
    batch.add(mats.galv, box(w, 0.02, 0.02), m.clone().multiply(xf(0, y, s * d / 2)), G);
    batch.add(mats.galv, box(0.02, 0.02, d), m.clone().multiply(xf(s * w / 2, y, 0)), G);
  }
  batch.add(mats.plasticBlack, cyl(0.04, 0.04, 0.12, 8), m.clone().multiply(xf(0, 0.22, d / 2 + 0.03, Math.PI / 2, 0, 0)), K);
  ctx.phys.solid(m, 0, h / 2, 0, w / 2, h / 2, d / 2, 'metal');
}

// 东北角的杂务角：不锈钢洗手槽、热水器、水管卷盘、拖把桶、小雨篷，旁边是气瓶笼
function utility(ctx, S) {
  const { batch, mats } = ctx;
  const z = NW + 0.3;
  aabb(ctx, mats.galv, 25.6, 27.0, 0.82, 0.92, NW, NW + 0.55, { tile: TILE.galv, r: 0.02, surface: 'metal' });
  batch.add(mats.black, box(1.3, 0.02, 0.45), xf(26.3, 0.915, z));
  for (const x of [25.65, 26.95]) for (const dz of [0.05, 0.5]) batch.add(mats.galv, cyl(0.018, 0.018, 0.82, 6), xf(x, 0.41, NW + dz), G);
  collider(ctx, 25.6, 27.0, 0, 0.82, NW, NW + 0.55, 'metal');
  for (const x of [26.0, 26.6]) batch.add(mats.galv, cylBetween(x, 1.25, NW + 0.02, x, 1.25, NW + 0.22, 0.012, 6), null, G);
  batch.add(S.grey, cyl(0.22, 0.22, 0.75, 14), xf(27.6, 1.85, NW + 0.24), P);
  batch.add(mats.reflective, cylBetween(27.6, 1.45, NW + 0.24, 27.6, 0.95, NW + 0.1, 0.015, 6));
  batch.add(S.plasticGreen, new THREE.TorusGeometry(0.24, 0.05, 8, 18), xf(24.9, 1.3, NW + 0.08), K);
  batch.add(S.plasticGreen, cyl(0.2, 0.2, 0.12, 14), xf(24.9, 1.3, NW + 0.08, Math.PI / 2, 0, 0), K);
  batch.add(mats.plasticOrange, cyl(0.17, 0.14, 0.3, 14), xf(27.5, 0.15, NW + 0.75), K);
  batch.add(mats.woodDark, cylBetween(27.5, 0.2, NW + 0.75, 27.3, 1.25, NW + 0.4, 0.014, 6), null, { tile: TILE.wood });
  // 小雨篷
  const len = 4.6, y = 2.65;
  for (const x of [25.3, 28.25]) batch.add(mats.steelDark, cyl(0.03, 0.03, y - 0.15, 8), xf(x, (y - 0.15) / 2, NW + 1.25), G);
  // 波纹板从墙根往外（+Z）略向下斜：局部 x 朝西、y 顺坡、z 朝上
  const t = 0.12, ex = new THREE.Vector3(-1, 0, 0), ey = new THREE.Vector3(0, -Math.sin(t), Math.cos(t));
  const basis = new THREE.Matrix4().makeBasis(ex, ey, new THREE.Vector3().crossVectors(ex, ey)).setPosition(25.1 + len, y, NW);
  batch.add(S.grey, corrugated(len, 1.4, { pitch: 0.2, depth: 0.02, tile: TILE.paint }), basis);
  batch.add(S.grey, box(len, 0.012, 1.4), xf(25.1 + len / 2, y - 0.09, NW + 0.7, t, 0, 0), P);
  batch.add(mats.steelDark, rb(len, 0.06, 0.06, 0.01), xf(25.1 + len / 2, y - 0.18, NW + 1.28), G);
  // 气瓶笼，贴东墙
  const cx0 = 28.4, cx1 = 30.0, cz1 = NW + 0.8;
  for (const [x, zz] of [[cx0, cz1], [cx0, NW], [cx1 - 0.03, cz1]]) batch.add(mats.galv, rb(0.05, 1.6, 0.05, 0.008), xf(x, 0.8, zz), G);
  for (const yy of [0.05, 1.6]) {
    batch.add(mats.galv, box(cx1 - cx0, 0.04, 0.04), xf((cx0 + cx1) / 2, yy, cz1), G);
    batch.add(mats.galv, box(0.04, 0.04, 0.8), xf(cx0, yy, NW + 0.4), G);
  }
  const mesh = (w, h, m) => { const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 0.48, uv.getY(i) * h / 0.48); batch.add(mats.chainlink, g, m); };
  mesh(cx1 - cx0, 1.5, xf((cx0 + cx1) / 2, 0.82, cz1));
  mesh(0.8, 1.5, xf(cx0, 0.82, NW + 0.4, 0, Math.PI / 2, 0));
  for (let i = 0; i < 4; i++) {
    const gx = cx0 + 0.3 + i * 0.36, col = i === 2 ? S.blue : S.grey;
    batch.add(col, cyl(0.12, 0.12, 1.25, 14), xf(gx, 0.63, NW + 0.4), P);
    batch.add(col, cyl(0.04, 0.12, 0.12, 14), xf(gx, 1.31, NW + 0.4), P);
    batch.add(mats.galv, cyl(0.03, 0.03, 0.1, 8), xf(gx, 1.41, NW + 0.4), G);
  }
  collider(ctx, cx0, cx1, 0, 1.62, NW, cz1, 'metal');
}

// 墙灯（只是灯具；真灯只有中间那一盏）
function wallLamp(ctx, S, x, y, z, bright) {
  const { batch, mats } = ctx;
  batch.add(S.frame, rb(0.36, 0.2, 0.16, 0.03), xf(x, y, z + 0.08), P);
  batch.add(bright ? mats.emissive(0xdfeaff, 55) : mats.emissive(0xffe2b8, 30), box(0.3, 0.012, 0.12), xf(x, y - 0.1, z + 0.09));
  batch.add(mats.galv, cyl(0.012, 0.012, y - 0.3, 6), xf(x + 0.25, (y + 0.3) / 2 - 0.15, z + 0.03), G);
}

export function buildCourt(ctx, S) {
  const { batch, mats } = ctx;
  dumpster(ctx, S, 14.25, NW + 0.17 + 0.61);
  dumpster(ctx, S, 16.4, NW + 0.17 + 0.61);
  palletStack(ctx, { x: 9.05, z: NW + 0.42, n: 7, yaw: 0.02 });
  palletStack(ctx, { x: 10.3, z: NW + 0.42, n: 4, yaw: -0.05 });
  palletStack(ctx, { x: 18.15, z: NW + 0.6, n: 7, yaw: 0.03 });
  palletStack(ctx, { x: 19.4, z: NW + 0.6, n: 3, yaw: -0.06 });
  utility(ctx, S);
  // 场中掩体：吨桶、盖布货堆、木箱
  // 吨桶两个并排，上面再叠一个，人站着也藏得住
  ibc(ctx, S, 21.5, -42.9);
  ibc(ctx, S, 22.75, -42.95, 0.04);
  ibc(ctx, S, 22.1, -42.92, -0.03, 1.16);
  tarpCargo(ctx, { x: 18.4, z: -42.6, yaw: 0.25, w: 1.6, h: 1.1, d: 1.2 });
  // 大门和仓库大门之间那片空场：一托没拆的纸箱，齐腰高，蹲下能躲
  palletStack(ctx, { x: 26.2, z: -37.3, n: 2, yaw: 0.1 });
  crate(ctx, { x: 26.22, y: 0.288, z: -37.3, yaw: 0.14, w: 1.1, h: 0.72, d: 0.74 });
  // 西北角一垛两层木箱，东北角一排木箱，把两个角落和东门隔开
  crate(ctx, { x: 13.2, z: -44.5, yaw: 0, w: 1.2, h: 1.1, d: 0.8 });
  crate(ctx, { x: 13.2, z: -43.65, yaw: 0, w: 1.2, h: 1.0, d: 0.8 });
  crate(ctx, { x: 13.15, y: 1.12, z: -44.1, yaw: 0.06, w: 1.0, h: 0.9, d: 1.4 });
  // 木箱垛往南再接一组：挡住从仓库大门看西北角的视线
  crate(ctx, { x: 13.2, z: -42.75, yaw: 0.02, w: 1.2, h: 1.0, d: 0.9 });
  crate(ctx, { x: 13.25, y: 1.02, z: -42.8, yaw: -0.05, w: 1.0, h: 0.8, d: 0.8 });
  // 东北角木箱一字排开，西头多接一垛，箱子后面那块空地从各个门口都看不见
  crate(ctx, { x: 24.75, z: -45.0, yaw: -0.04, w: 1.0, h: 1.0, d: 1.0 });
  crate(ctx, { x: 24.8, y: 1.02, z: -44.95, yaw: 0.07, w: 0.85, h: 0.8, d: 0.85 });
  crate(ctx, { x: 25.8, z: -44.6, yaw: 0.05, w: 1.0, h: 0.9, d: 0.9 });
  crate(ctx, { x: 25.85, y: 0.92, z: -44.55, yaw: -0.1, w: 0.9, h: 0.8, d: 0.8 });
  crate(ctx, { x: 26.85, z: -44.5, yaw: 0, w: 0.9, h: 1.0, d: 1.0 });
  crate(ctx, { x: 26.85, y: 1.02, z: -44.5, yaw: 0.04, w: 0.8, h: 0.7, d: 0.8 });
  crate(ctx, { x: 27.85, z: -44.45, yaw: 0, w: 1.0, h: 1.1, d: 1.0 });
  crate(ctx, { x: 27.85, y: 1.12, z: -44.45, yaw: -0.08, w: 0.9, h: 0.8, d: 0.9 });
  // 仓库大门东边靠墙的木箱
  // 从东墙往西一字排开，彼此贴紧，墙角不留能卡人的缝
  crate(ctx, { x: 26.6, z: -33.4, yaw: 0, w: 1.2, h: 1.0, d: 0.9 });
  crate(ctx, { x: 26.65, y: 1.02, z: -33.4, yaw: 0.05, w: 1.0, h: 0.8, d: 0.8 });
  crate(ctx, { x: 27.7, z: -33.4, yaw: 0, w: 0.9, h: 0.9, d: 0.8 });
  barrel(ctx, { x: 28.48, z: -33.3, color: 0x1c4470, yaw: 1 });
  barrel(ctx, { x: 29.08, z: -33.3, color: 0x7d2a1e, yaw: 2 });
  barrel(ctx, { x: 29.68, z: -33.3, color: 0x1c4470, yaw: 3 });
  // 叉车停在消防梯和仓库大门之间，叉着一托货
  forklift(ctx, S, { x: 16.1, z: -35.1, yaw: Math.PI / 2, load: true });
  cone(ctx, { x: 18.9, z: -36.4 });
  cone(ctx, { x: 24.9, z: -36.2 });
  cone(ctx, { x: 19.6, z: -37.3, tip: true, yaw: 0.6 });
  // 墙灯、监控、警示牌
  wallLamp(ctx, S, 13.0, 3.4, NW, false);
  wallLamp(ctx, S, 25.5, 3.4, NW, false);
  batch.add(S.frame, rb(0.5, 0.26, 0.3, 0.03), xf(19.3, 4.25, NW + 0.2), P);
  batch.add(mats.emissive(0xdfeaff, 55), box(0.44, 0.012, 0.24), xf(19.3, 4.11, NW + 0.22));
  batch.add(mats.steelDark, cylBetween(19.3, 4.45, NW, 19.3, 4.3, NW + 0.2, 0.02, 6), null, G);
  batch.add(mats.plasticBlack, rb(0.12, 0.12, 0.3, 0.02), xf(29.75, 3.9, -43.6, -0.4, -0.7, 0), K);
  batch.add(mats.galv, cylBetween(30.0, 4.0, -43.6, 29.8, 3.95, -43.6, 0.015, 6), null, G);
  decal(ctx, warnSign(ctx, 'fork', '叉车作业 注意避让', 'FORKLIFT AREA · KEEP CLEAR'), 1.3, 0.65, 21.6, 2.1, NW + 0.21, 's');
  decal(ctx, warnSign(ctx, 'smoke', '严禁烟火', 'NO SMOKING · 气瓶存放', { bg: '#e8e2d0' }), 0.8, 0.4, 29.2, 2.1, NW + 0.01, 's');
  // 场地中间的雨水箅子
  for (const [x, z] of [[19.0, -40.2], [12.6, -38.5]]) {
    batch.add(mats.steelDark, box(0.62, 0.012, 0.62), xf(x, 0.006, z), G);
    for (let i = 0; i < 8; i++) batch.add(mats.black, box(0.02, 0.004, 0.54), xf(x - 0.245 + i * 0.07, 0.013, z));
  }
}

// 卸货场的敌人出生点：东北角箱子后面；西北角木箱垛西侧（只有近处的办公楼门口和消防梯看得到）；北墙中段吨桶后面
export const COURT_SPAWNS = [{ x: 27.3, y: 0, z: -46.15 }, { x: 11.5, y: 0, z: -44.1 }, { x: 20.0, y: 0, z: -45.0 }];
