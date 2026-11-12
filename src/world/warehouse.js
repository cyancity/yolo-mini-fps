import * as THREE from 'three';
import { xf, box, rbox, cyl, cylBetween, corrugated } from '../gfx/geo.js';
import { decalQuad, decalCorrugated, distress, mulberry32, STENCIL_FONT } from './labels.js';
import { PORTAL, Y, ZONE } from './plan.js';

// 仓库外皮：混凝土勒脚 + 竖纹钢板 + 檐口封板，正立面上的三扇卷帘门、装卸平台、雨棚和逃生门。
// 墙体本身（带洞口和碰撞）在 zones/warehouse_shell.js，这里只贴在外墙面上。
const DOOR_TOP = PORTAL.dockDoor2.y1;
export const WH = {
  z: -20, x0: -30, x1: 30, h: ZONE.warehouse.ceil, dockX0: -14, dockX1: 10, dockD: 3, dockH: Y.dock,
  doors: [-10, PORTAL.dockDoor2.x, PORTAL.dockDoor3.x], doorW: PORTAL.dockDoor2.w, doorTop: DOOR_TOP,
  // 卷帘下沿：01 号关着，02 号全开，03 号放下一截
  curtain: [Y.dock, DOOR_TOP, PORTAL.dockDoor3.y1],
};
const CLAD_PITCH = 0.25, CLAD_DEPTH = 0.03, EAVE = 8.55, PLINTH = 1.2;
const OUT = { S: -20, N: -32.9, E: 30, W: -30 }; // 四面外墙皮的位置

export function facadeMats(mats) {
  return {
    clad: mats.paint(0x46525c, { wear: 0.3, dirt: 0.75 }),
    trim: mats.paint(0x2b3238, { wear: 0.35, dirt: 0.6 }),
    yellow: mats.paint(0xc79a12, { wear: 0.6, dirt: 0.6 }),
    door: mats.paint(0xa3a398, { wear: 0.4, dirt: 0.8 }),
    exitDoor: mats.paint(0x24382b, { wear: 0.5, dirt: 0.6 }),
  };
}

// 外墙面上的一块构件。face 是哪一面，u 沿墙（南北面是 x，东西面是 z），off 是离墙面往外的距离
function onFace(face, u, y, off = 0) {
  if (face === 'S') return xf(u, y, OUT.S + off);
  if (face === 'N') return xf(u, y, OUT.N - off, 0, Math.PI, 0);
  if (face === 'E') return xf(OUT.E + off, y, u, 0, Math.PI / 2, 0);
  return xf(OUT.W - off, y, u, 0, -Math.PI / 2, 0);
}
// 波纹板从 u0 铺到 u1：板的局部 +x 在南面朝东、北面朝西、东面朝北、西面朝南
function cladPanel(batch, mat, face, u0, u1, y0, y1) {
  if (u1 - u0 < 0.05 || y1 - y0 < 0.05) return;
  const start = face === 'S' || face === 'W' ? u0 : u1;
  const g = corrugated(u1 - u0, y1 - y0, { pitch: CLAD_PITCH, depth: CLAD_DEPTH, tile: 5.2, ou: u0 / 5.2, ov: y0 / 5.2 });
  batch.add(mat, g, onFace(face, start, y0, 0.002));
}

// 一整面外皮：洞口之间满铺，洞口上方从门头往上铺；勒脚和檐口封板沿全长
function skin(ctx, M, face, u0, u1, holes, from = PLINTH) {
  const { batch, mats } = ctx;
  let cursor = u0;
  const run = (a, b) => {
    if (b - a < 0.02) return;
    if (from <= PLINTH) batch.add(mats.concrete, box(b - a, PLINTH, 0.1), onFace(face, (a + b) / 2, PLINTH / 2, 0.05), { tile: 3 });
    cladPanel(batch, M.clad, face, a, b, from, EAVE);
  };
  for (const h of holes) {
    run(cursor, h.a);
    cladPanel(batch, M.clad, face, h.a, h.b, h.y1 + h.head, EAVE);
    cursor = h.b;
  }
  run(cursor, u1);
  batch.add(M.trim, rbox(u1 - u0 + 0.24, 0.45, 0.12, 0.02), onFace(face, (u0 + u1) / 2, EAVE + 0.225, 0.06), { tile: 5.2 });
}

// 北面朝卸货场那一段：车辆门上方的壁灯、门边的通道牌和门控盒、落水管。消防梯（x 9..13.4）那段留给楼顶模块
function courtSide(ctx, M) {
  const { batch, decals, mats, atlas } = ctx;
  const bd = PORTAL.bayDoor, P = { tile: 5.2 }, G = { tile: 1.2 };
  batch.add(M.trim, rbox(0.56, 0.24, 0.32, 0.02), onFace('N', bd.x, 4.95, 0.16), P);
  batch.add(mats.emissive(0xffe2b8, 30), box(0.46, 0.02, 0.24), onFace('N', bd.x, 4.82, 0.17));
  batch.add(mats.galv, cylBetween(bd.x, 5.0, OUT.N - 0.01, bd.x, 7.6, OUT.N - 0.01, 0.02, 8), null, G);
  for (const x of [15.5, 28.6]) {
    batch.add(mats.galv, cyl(0.055, 0.055, 8.5, 12), onFace('N', x, 4.35, 0.1), G);
    for (const y of [1.6, 4.4, 7.2]) batch.add(mats.galv, rbox(0.16, 0.05, 0.1, 0.006), onFace('N', x, y, 0.07), G);
  }
  // 门控盒：两颗指示灯，线管沿墙上到檐口
  const cx = bd.x + bd.w / 2 + 0.7;
  batch.add(M.yellow, rbox(0.3, 0.42, 0.14, 0.012), onFace('N', cx, 1.45, 0.07), P);
  batch.add(mats.emissive(0x2bff6a, 6), box(0.04, 0.04, 0.01), onFace('N', cx - 0.06, 1.56, 0.145));
  batch.add(mats.emissive(0xff3018, 6), box(0.04, 0.04, 0.01), onFace('N', cx + 0.06, 1.56, 0.145));
  batch.add(mats.galv, cyl(0.018, 0.018, 6.9, 8), onFace('N', cx, 5.1, 0.04), G);
  const sign = atlas.add(384, 160, (c, w, h) => {
    c.fillStyle = '#e4e1d6'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1d4a80'; c.fillRect(0, 0, 104, h);
    c.fillStyle = '#f2f0ea'; c.font = `700 120px ${STENCIL_FONT}`; c.textAlign = 'center';
    c.fillText('C', 52, 124);
    c.fillStyle = '#16181a'; c.font = '700 46px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
    c.fillText('车辆出入口', 244, 74);
    c.font = `600 30px ${STENCIL_FONT}`;
    c.fillText('VEHICLE BAY · 限高 4 M', 244, 122);
    distress(c, w, h, mulberry32(311), 0.4); // 自己的种子，不扰动关卡共用的 rand
  });
  const sw = 1.5, sh = 0.62, sx = bd.x - bd.w / 2 - 1.3;
  batch.add(M.trim, rbox(sw + 0.06, sh + 0.06, 0.03, 0.008), onFace('N', sx, 3.1, 0.06), P);
  decals.add(atlas.material, decalQuad(sw, sh, sign), onFace('N', sx + sw / 2, 3.1 - sh / 2, 0.077));
}

// 返回雨棚灯的位置
export function buildWarehouse(ctx) {
  const { batch, decals, mats, atlas, phys } = ctx;
  const M = facadeMats(mats);
  const Z = WH.z, C = { tile: 3 }, P = { tile: 5.2 }, G = { tile: 1.2 };
  const hw = WH.doorW / 2, ex = PORTAL.exitDoor, exw = ex.w / 2;

  // 四面外皮。北面办公楼那一段在室内，只铺办公楼屋面以上那一截
  skin(ctx, M, 'S', WH.x0, WH.x1, [
    ...WH.doors.map((x) => ({ a: x - hw, b: x + hw, y1: DOOR_TOP, head: 0.2 })),
    { a: ex.x - exw, b: ex.x + exw, y1: ex.y1, head: 0.12 },
  ]);
  const bd = PORTAL.bayDoor;
  skin(ctx, M, 'N', ZONE.court.x0, WH.x1, [{ a: bd.x - bd.w / 2, b: bd.x + bd.w / 2, y1: bd.y1, head: 0.25 }]);
  skin(ctx, M, 'N', WH.x0, ZONE.court.x0, [], Y.officeRoof);
  courtSide(ctx, M);
  skin(ctx, M, 'E', OUT.N, OUT.S, []);
  skin(ctx, M, 'W', OUT.N, OUT.S, []);
  // 勒脚顶上的泛水条（门洞处断开）
  let cur = WH.x0;
  for (const [a, b] of [...WH.doors.map((x) => [x - hw, x + hw]), [ex.x - exw - 0.1, ex.x + exw + 0.1]]) {
    batch.add(M.trim, box(a - cur, 0.14, 0.12), xf((a + cur) / 2, 1.27, Z + 0.06), P);
    cur = b;
  }
  batch.add(M.trim, box(WH.x1 - cur, 0.14, 0.12), xf((WH.x1 + cur) / 2, 1.27, Z + 0.06), P);

  // 卷帘门：门套、导轨、帘片（内外两面）、底梁。帘片挡人也挡子弹
  WH.doors.forEach((dx, i) => {
    const y0 = WH.curtain[i], hgt = DOOR_TOP - y0;
    if (hgt > 0.05) {
      batch.add(M.door, corrugated(WH.doorW, hgt, { pitch: 0.085, depth: 0.012, horizontal: true, tile: 5.2, ou: i * 0.31 }), xf(dx - hw, y0, Z - 0.14));
      batch.add(M.door, corrugated(WH.doorW, hgt, { pitch: 0.085, depth: 0.012, horizontal: true, tile: 5.2, ou: i * 0.17 }), xf(dx + hw, y0, Z - 0.26, 0, Math.PI, 0));
      phys.addBox(dx, (y0 + DOOR_TOP) / 2, Z - 0.2, hw, hgt / 2, 0.07, 0, 'metal');
    }
    const bar = Math.min(y0, DOOR_TOP - 0.1);
    batch.add(mats.steelDark, rbox(WH.doorW, 0.1, 0.14, 0.01), xf(dx, bar + 0.05, Z - 0.2), G);
    if (y0 < DOOR_TOP - 0.2) batch.add(mats.rubber, box(WH.doorW, 0.04, 0.06), xf(dx, bar - 0.02, Z - 0.2));
    for (const s of [-1, 1]) {
      batch.add(M.yellow, rbox(0.22, DOOR_TOP - WH.dockH + 0.1, 0.2, 0.012), xf(dx + s * (hw + 0.11), (DOOR_TOP + WH.dockH) / 2, Z + 0.1), P);
      batch.add(mats.steelDark, box(0.07, DOOR_TOP - WH.dockH, 0.09), xf(dx + s * (hw - 0.035), (DOOR_TOP + WH.dockH) / 2, Z - 0.2), G);
    }
    batch.add(M.yellow, rbox(WH.doorW + 0.44, 0.22, 0.2, 0.012), xf(dx, DOOR_TOP + 0.11, Z + 0.1), P);
    batch.add(M.trim, rbox(WH.doorW + 0.3, 0.42, 0.32, 0.02), xf(dx, DOOR_TOP + 0.42, Z + 0.16), P);
    // 门号
    const num = atlas.add(256, 160, (c, w, h) => {
      c.fillStyle = '#dedbd2';
      c.font = `700 150px ${STENCIL_FONT}`;
      c.textAlign = 'center';
      c.fillText(`0${i + 1}`, w / 2, 132);
      distress(c, w, h, ctx.rand, 0.6);
    });
    decals.add(atlas.material, decalCorrugated(1.5, 0.94, num, CLAD_PITCH, CLAD_DEPTH), xf(dx - 0.75, 7.25, Z + 0.004));
    // 平台上的调节板和防撞胶块
    batch.add(mats.steelDark, box(2.4, 0.03, 1.7), xf(dx, WH.dockH + 0.015, Z + 1.1), G);
    for (const s of [-1, 1]) batch.add(mats.rubber, rbox(0.3, 0.5, 0.14, 0.02), xf(dx + s * 1.5, 0.75, Z + WH.dockD + 0.07));
  });

  // 装卸平台、黄色护角、台阶和栏杆
  const dl = WH.dockX1 - WH.dockX0, dcx = (WH.dockX0 + WH.dockX1) / 2, dz = Z + WH.dockD / 2;
  batch.add(mats.concrete, rbox(dl, WH.dockH, WH.dockD, 0.02), xf(dcx, WH.dockH / 2, dz), C);
  batch.add(M.yellow, rbox(dl, 0.11, 0.11, 0.012), xf(dcx, WH.dockH - 0.045, Z + WH.dockD + 0.01), P);
  phys.addBox(dcx, WH.dockH / 2, dz, dl / 2, WH.dockH / 2, WH.dockD / 2, 0, 'concrete');
  for (let i = 0; i < 4; i++) {
    const top = WH.dockH - (i + 1) * 0.22, sx = WH.dockX1 + 0.15 + i * 0.3;
    batch.add(mats.concrete, box(0.3, top, 1.3), xf(sx, top / 2, Z + 0.65), C);
    phys.addBox(sx, top / 2, Z + 0.65, 0.15, top / 2, 0.65, 0, 'concrete');
  }
  const rail = (x, y) => [x, y, Z + 1.32];
  const a = rail(WH.dockX1 - 0.1, WH.dockH + 0.95), b = rail(WH.dockX1 + 1.25, 0.95);
  batch.add(mats.galv, cylBetween(...a, ...b, 0.022, 10), null, G);
  batch.add(mats.galv, cylBetween(a[0], WH.dockH, a[2], ...a, 0.022, 10), null, G);
  batch.add(mats.galv, cylBetween(b[0], 0, b[2], ...b, 0.022, 10), null, G);
  phys.addBox(WH.dockX1 + 0.6, 0.9, Z + 1.34, 0.72, 0.9, 0.04, 0, 'metal');

  // 雨棚、拉杆和棚下条形灯。棚板是浅灰涂装（不是金属）：底面要能吃到地面反上来的光
  const cx = dcx, cw = dl + 1;
  batch.add(mats.paint(0xa9aca8, { wear: 0.25, dirt: 0.5, rough: 0.6 }), box(cw, 0.2, 3.7), xf(cx, 6.2, Z + 1.85), P);
  batch.add(M.clad, box(cw + 0.1, 0.5, 0.08), xf(cx, 6.15, Z + 3.72), P);
  phys.addBox(cx, 6.2, Z + 1.85, cw / 2, 0.14, 1.9, 0, 'metal');
  for (let i = 0; i <= 4; i++) {
    const x = cx - cw / 2 + 0.6 + (i * (cw - 1.2)) / 4;
    batch.add(mats.galv, cylBetween(x, 8.1, Z + 0.03, x, 6.3, Z + 3.4, 0.025, 8), null, G);
  }
  const lamps = [];
  for (const dx of WH.doors) {
    batch.add(M.trim, rbox(1.5, 0.07, 0.2, 0.01), xf(dx, 6.07, Z + 1.9), P);
    batch.add(mats.emissive(0xffe2b8, 30), box(1.36, 0.02, 0.11), xf(dx, 6.03, Z + 1.9));
    lamps.push(new THREE.Vector3(dx, 5.95, Z + 1.9));
  }

  // 墙面零件：落水管、桥架、配电柜、通风百叶、监控
  for (const x of [-22, 16.5, 27]) {
    batch.add(mats.galv, cyl(0.055, 0.055, 8.6, 12), xf(x, 4.5, Z + 0.1), G);
    for (const y of [1.6, 4.4, 7.2]) batch.add(mats.galv, rbox(0.16, 0.05, 0.1, 0.006), xf(x, y, Z + 0.07), G);
  }
  batch.add(mats.galv, box(17, 0.06, 0.22), xf(20.5, 6.9, Z + 0.15), G);
  for (const x of [13.2, 14.35]) {
    batch.add(mats.paint(0x6f746f, { wear: 0.4, dirt: 0.5 }), rbox(0.95, 1.5, 0.36, 0.015), xf(x, 0.95, Z + 0.22), P);
    batch.add(mats.steelDark, rbox(0.04, 0.16, 0.03, 0.005), xf(x + 0.36, 1.0, Z + 0.415), G);
    batch.add(mats.galv, cyl(0.02, 0.02, 5.2, 8), xf(x, 4.3, Z + 0.11), G);
    phys.addBox(x, 0.85, Z + 0.22, 0.48, 0.85, 0.2, 0, 'metal');
  }
  const warn = atlas.add(128, 128, (c) => {
    c.fillStyle = '#e0b020';
    c.beginPath(); c.moveTo(64, 8); c.lineTo(122, 116); c.lineTo(6, 116); c.closePath(); c.fill();
    c.fillStyle = '#111';
    c.beginPath(); c.moveTo(70, 40); c.lineTo(54, 72); c.lineTo(66, 72); c.lineTo(58, 102); c.lineTo(80, 64); c.lineTo(67, 64); c.closePath(); c.fill();
  });
  for (const x of [13.2, 14.35]) decals.add(atlas.material, decalQuad(0.22, 0.22, warn), xf(x - 0.11, 1.25, Z + 0.405));
  for (const x of [-25, -17, 22]) {
    batch.add(mats.steelDark, rbox(1.3, 0.9, 0.12, 0.012), xf(x, 7.7, Z + 0.06), G);
    for (let i = 0; i < 7; i++) batch.add(M.trim, box(1.16, 0.02, 0.07), xf(x, 7.36 + i * 0.11, Z + 0.13, -0.6, 0, 0));
  }
  batch.add(mats.plasticBlack, rbox(0.1, 0.1, 0.24, 0.02), xf(11.6, 5.1, Z + 0.33, 0.35, 0.5, 0));
  batch.add(mats.galv, cylBetween(11.6, 5.3, Z + 0.03, 11.6, 5.16, Z + 0.27, 0.015, 8), null, G);

  // 逃生门：钢门框，门扇朝外推开立在门边（碰撞跟着门扇走）
  const ex0 = ex.x - exw, ex1 = ex.x + exw;
  for (const x of [ex0 - 0.05, ex1 + 0.05]) batch.add(M.trim, rbox(0.1, ex.y1 + 0.1, 0.16, 0.01), xf(x, (ex.y1 + 0.1) / 2, Z + 0.04), P);
  batch.add(M.trim, rbox(ex.w + 0.2, 0.12, 0.16, 0.01), xf(ex.x, ex.y1 + 0.06, Z + 0.04), P);
  const leaf = xf(ex1, 0, Z + 0.06, 0, THREE.MathUtils.degToRad(95), 0);
  const lw = ex.w - 0.06, lh = ex.y1 - 0.12;
  batch.add(M.exitDoor, rbox(lw, lh, 0.05, 0.008), leaf.clone().multiply(xf(-lw / 2, 0.1 + lh / 2, 0.03)), P);
  batch.add(mats.galv, rbox(0.03, 0.14, 0.05, 0.008), leaf.clone().multiply(xf(-lw + 0.12, 1.05, 0.08)), G);
  batch.add(mats.galv, rbox(lw - 0.3, 0.05, 0.06, 0.01), leaf.clone().multiply(xf(-lw / 2, 1.0, -0.03)), G);
  for (const y of [0.35, 1.8]) batch.add(mats.steelDark, cyl(0.022, 0.022, 0.14, 8), leaf.clone().multiply(xf(0, y, 0.03)), G);
  phys.solid(leaf, -lw / 2, 0.1 + lh / 2, 0.03, lw / 2, lh / 2, 0.03, 'metal');
  batch.add(mats.concrete, box(1.5, 0.08, 0.6), xf(ex.x, 0.04, Z + 0.3), C);
  batch.add(mats.plasticBlack, rbox(0.5, 0.2, 0.07, 0.01), xf(ex.x, 2.52, Z + 0.06));
  batch.add(mats.emissive(0x36ff7c, 5), box(0.44, 0.15, 0.01), xf(ex.x, 2.52, Z + 0.1));

  // 外墙大字
  const title = atlas.add(1024, 300, (c, w, h) => {
    c.fillStyle = '#d8d5cc';
    c.font = `700 200px ${STENCIL_FONT}`;
    c.textBaseline = 'alphabetic';
    c.fillText('DOCK 0', 10, 190);
    c.font = '700 74px "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';
    c.fillText('零号泊位 · 危险品暂存区', 14, 280, w - 28);
    distress(c, w, h, ctx.rand, 0.5);
  });
  decals.add(atlas.material, decalCorrugated(6.5, 1.9, title, CLAD_PITCH, CLAD_DEPTH), xf(-27.5, 3.4, Z + 0.006));
  return { lamps };
}
