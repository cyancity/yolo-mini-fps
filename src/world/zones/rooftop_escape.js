import * as THREE from 'three';
import { xf, box, rbox, cyl, cylBetween, scaleUV } from '../../gfx/geo.js';
import { decalQuad, distress, STENCIL_FONT } from '../labels.js';
import { stairs, railing } from '../build.js';
import { RESERVED, Y } from '../plan.js';

// 室外消防梯：卸货场地面贴着仓库背墙（北立面）折返上到仓库屋面。
// 平面（俯视，南边是仓库墙）：
//   x 9.0..10.4 西平台 | 10.4..12.0 梯段 | 12.0..13.4 东平台
//   z -34.75..-32.9 靠墙一道（W），z -36.6..-34.75 外侧一道（C），各 1.85 宽
// 七跑：单数跑在外侧道往东上，双数跑在靠墙道往西上；东平台在 1、3、5、7 跑顶，西平台在 2、4、6 跑顶，
// 第 7 跑的顶就是 9.0 的屋面。头顶净空 9/7 × 2 - 0.15 ≈ 2.4 m。
// 一跑以下的空间（东平台底、靠墙道底）用铁丝网围成杂物笼，人钻不进去。
const XW = RESERVED.fireEscape.x0, XA = 10.4, XB = 12.0, XE = RESERVED.fireEscape.x1;
const ZC0 = RESERVED.fireEscape.z0, ZM = -34.75, ZW1 = RESERVED.fireEscape.z1;
const FLIGHTS = 7, H = Y.whRoof / FLIGHTS, W = ZM - ZC0, RUN = XB - XA;
const G = { tile: 1.2 }, P = { tile: 5.2 };
const NOBATCH = { add() {} };

export function buildFireEscape(ctx, M) {
  const { batch, mats, phys } = ctx;
  const steel = M.trim, grate = mats.galv;
  const level = (k) => k * H;

  // 梯段：碰撞用 build.js 的 stairs（只要碰撞体），踏板自己画成格栅
  const n = Math.ceil(H / 0.19), rise = H / n, tread = RUN / n;
  for (let k = 1; k <= FLIGHTS; k++) {
    const east = k % 2 === 1, s = east ? 1 : -1;
    const z = east ? (ZC0 + ZM) / 2 : (ZM + ZW1) / 2, x0 = east ? XA : XB, y0 = level(k - 1);
    stairs({ ...ctx, batch: NOBATCH }, null, { x: x0, z, dir: [s, 0], w: W, y0, y1: level(k), run: RUN, open: true, surface: 'metal' });
    for (let i = 0; i < n; i++) {
      const top = y0 + (i + 1) * rise, xa = x0 + s * i * tread;
      batch.add(grate, box(0.035, 0.035, W - 0.08), xf(xa + s * 0.02, top - 0.0175, z), G);
      for (let b = 1; b <= 4; b++) batch.add(grate, box(0.008, 0.03, W - 0.08), xf(xa + s * (0.02 + b * 0.045), top - 0.015, z), G);
    }
    // 两侧槽钢斜梁
    const len = Math.hypot(RUN, H), ang = Math.atan2(H, RUN) * s;
    for (const zz of [z - W / 2 + 0.02, z + W / 2 - 0.02]) {
      batch.add(steel, box(len + 0.2, 0.2, 0.03), xf((XA + XB) / 2, y0 + H / 2 - 0.12, zz, 0, 0, ang), P);
    }
    // 外侧扶手；两道之间的扶手两跑各一条，合起来就是一道隔断
    const ya = east ? y0 : level(k), yb = east ? level(k) : y0;
    railing(ctx, mats.galv, { a: [XA, ZM], b: [XB, ZM], ya, yb, posts: 1.6 });
    if (east) railing(ctx, mats.galv, { a: [XA, ZC0], b: [XB, ZC0], ya, yb, posts: 1.6 });
    else batch.add(mats.galv, cylBetween(XB, y0 + 0.9, ZW1 - 0.06, XA, level(k) + 0.9, ZW1 - 0.06, 0.02, 8), null, G);
  }

  // 平台：格栅 + 槽钢框；靠墙一侧搭在墙上的角钢托上
  for (let k = 1; k <= FLIGHTS; k++) {
    const east = k % 2 === 1, xa = east ? XB : XW, xb = east ? XE : XA, L = level(k), cx = (xa + xb) / 2, cz = (ZC0 + ZW1) / 2, d = ZW1 - ZC0;
    for (let x = xa + 0.04; x < xb - 0.02; x += 0.07) batch.add(grate, box(0.008, 0.035, d - 0.04), xf(x, L - 0.0175, cz), G);
    for (const zz of [ZC0 + 0.02, ZM, ZW1 - 0.02]) batch.add(steel, box(xb - xa, 0.15, 0.04), xf(cx, L - 0.11, zz), P);
    for (const xx of [xa + 0.02, xb - 0.02]) batch.add(steel, box(0.04, 0.15, d), xf(xx, L - 0.11, cz), P);
    batch.add(mats.steelDark, box(xb - xa, 0.08, 0.06), xf(cx, L - 0.2, ZW1 - 0.03), G);
    phys.addBox(cx, L - 0.03, cz, (xb - xa) / 2, 0.03, d / 2, 0, 'metal');
    // 平台外缘的扶手
    const r = (a, b) => railing(ctx, mats.galv, { a, b, y: L, posts: 1.4 });
    r([xa, ZC0], [xb, ZC0]);
    if (east) {
      r([XE, ZC0], [XE, ZW1]);
      if (k === FLIGHTS) r([XB, ZM], [XB, ZW1]);
    } else {
      r([XW, ZC0], [XW, ZW1]);
      // 西平台悬挑：斜撑回到立柱
      batch.add(steel, cylBetween(XA, L - 0.6, ZC0 + 0.05, XW + 0.06, L - 0.13, ZC0 + 0.05, 0.035, 6), null, P);
      batch.add(steel, cylBetween(XW + 0.3, L - 0.6, ZW1 - 0.03, XW + 0.3, L - 0.13, ZW1 - 0.7, 0.03, 6), null, P);
    }
  }

  // 立柱：外侧三根，西平台从中间那根挑出去，地面上不挡路
  for (const [x, top] of [[XA, level(6) + 1.05], [XB, Y.whRoof + 1.05], [XE - 0.06, Y.whRoof + 1.05]]) {
    batch.add(steel, box(0.1, top, 0.1), xf(x, top / 2, ZC0 + 0.06), P);
    batch.add(steel, box(0.3, 0.02, 0.3), xf(x, 0.01, ZC0 + 0.06), P);
    phys.addBox(x, top / 2, ZC0 + 0.06, 0.05, top / 2, 0.05, 0, 'metal');
  }
  batch.add(mats.concrete, box(XE - XW, 0.03, ZW1 - ZC0), xf((XW + XE) / 2, 0.015, (ZC0 + ZW1) / 2), { tile: 3 });

  buildCage(ctx, M);
  // 每层平台墙上一盏壁灯（钠灯色），只做发光体；顶层平台齐屋面，墙到那儿就没了，不挂
  for (let k = 1; k < FLIGHTS; k++) {
    const east = k % 2 === 1, x = east ? XE - 0.5 : XW + 0.5, L = level(k);
    batch.add(mats.plasticBlack, rbox(0.26, 0.2, 0.14, 0.02, 1), xf(x, L + 2.0, ZW1 - 0.07), { tile: 0.06 });
    batch.add(k % 3 === 0 ? M.lampCool : M.sodium, box(0.2, 0.012, 0.1), xf(x, L + 1.895, ZW1 - 0.08));
  }
}

// 一跑下面的杂物笼：铁丝网 + 方管框，只挡人
function buildCage(ctx, M) {
  const { batch, mats, phys, atlas, decals } = ctx;
  const hE = H - 0.16, hW = 2 * H - 0.2;
  const panel = (ax, az, bx, bz, h) => {
    const len = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(-(bz - az), bx - ax);
    const g = new THREE.PlaneGeometry(len, h - 0.08);
    scaleUV(g, len / 0.48, (h - 0.08) / 0.48);
    batch.add(mats.chainlink, g, xf((ax + bx) / 2, h / 2, (az + bz) / 2, 0, yaw, 0));
    for (const y of [0.04, h - 0.04]) batch.add(mats.galv, cylBetween(ax, y, az, bx, y, bz, 0.02, 6), null, G);
    for (const [x, z] of [[ax, az], [bx, bz]]) batch.add(mats.galv, box(0.05, h, 0.05), xf(x, h / 2, z), G);
    phys.addBox((ax + bx) / 2, h / 2, (az + bz) / 2, len / 2, h / 2, 0.03, yaw, 'metal').playerOnly = true;
  };
  panel(XA, ZM, XA, ZW1, hW);
  panel(XB, ZC0, XE, ZC0, hE);
  panel(XE, ZC0, XE, ZW1, hE);
  // 笼里的东西：气瓶、垃圾桶、水管卷
  for (let i = 0; i < 3; i++) {
    batch.add(M.red, cyl(0.12, 0.12, 0.95, 14), xf(12.5 + i * 0.28, 0.5, -33.2), P);
    batch.add(mats.steelDark, cyl(0.04, 0.05, 0.1, 8), xf(12.5 + i * 0.28, 1.02, -33.2), G);
  }
  batch.add(M.blue, rbox(0.6, 0.95, 0.7, 0.03, 1), xf(11.3, 0.48, -33.4, 0, 0.1, 0), P);
  batch.add(mats.rubber, new THREE.TorusGeometry(0.3, 0.06, 8, 20), xf(13.0, 0.5, -35.6, 0, Math.PI / 2, 0));
  const sign = atlas.add(256, 200, (c, w, h) => {
    c.fillStyle = '#b8231a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f4f1e8'; c.textAlign = 'center';
    c.font = '700 58px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
    c.fillText('消防通道', w / 2, 76, w - 16);
    c.font = `700 40px ${STENCIL_FONT}`;
    c.fillText('FIRE ESCAPE', w / 2, 128, w - 16);
    c.font = '600 30px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
    c.fillText('↑ 屋面 ROOF  保持畅通', w / 2, 178, w - 16);
    distress(c, w, h, ctx.rand, 0.2);
  });
  batch.add(mats.galv, box(0.56, 0.44, 0.012), xf(12.7, 0.75, ZC0 - 0.03), G);
  decals.add(atlas.material, decalQuad(0.5, 0.39, sign), xf(12.95, 0.555, ZC0 - 0.038, 0, Math.PI, 0));
}
