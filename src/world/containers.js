import * as THREE from 'three';
import { xf, box, rbox, cyl, corrugated } from '../gfx/geo.js';
import { decalQuad, decalCorrugated, distress, mulberry32, STENCIL_FONT } from './labels.js';

export const CW = 2.438, CH = 2.591, C20 = 6.058, C40 = 12.192;
const PITCH = 0.276, DEPTH = 0.036;
// 虚构的航运公司名
const LINES = ['KESTREL', 'NORVIK', 'ARGOSEA', 'TIDELINE', 'OSTRAL', 'HALDEN'];

function wordmark(atlas, line, dark, rand) {
  const name = LINES[line % LINES.length];
  return atlas.cached(`wm|${name}|${dark}`, 768, 150, (c, w, h) => {
    c.fillStyle = dark ? '#16181a' : '#e9e7e0';
    c.font = `700 118px ${STENCIL_FONT}`;
    c.textBaseline = 'middle';
    c.fillText(name, 6, h / 2 + 4, w - 12);
    distress(c, w, h, rand, 0.7);
  });
}

function idLabel(atlas, text, dark, rand) {
  return atlas.add(384, 96, (c, w, h) => {
    c.fillStyle = dark ? '#16181a' : '#e9e7e0';
    c.textBaseline = 'top';
    c.font = `600 50px ${STENCIL_FONT}`;
    c.fillText(text, 4, 2, w - 8);
    c.font = `600 32px ${STENCIL_FONT}`;
    c.fillText('22G1', 4, 58);
    distress(c, w, h, rand, 0.5);
  });
}

function weightsLabel(atlas, rand) {
  return atlas.cached('weights', 256, 224, (c, w, h) => {
    c.fillStyle = '#e9e7e0';
    c.font = `500 22px ${STENCIL_FONT}`;
    c.textBaseline = 'top';
    const rows = [['MAX GROSS', '30,480 KG'], ['', '67,200 LB'], ['TARE', '2,230 KG'], ['', '4,920 LB'],
      ['NET', '28,250 KG'], ['', '62,280 LB'], ['CU. CAP.', '33.2 CU.M']];
    rows.forEach(([a, b], i) => { c.fillText(a, 4, 6 + i * 30); c.fillText(b, 128, 6 + i * 30); });
    distress(c, w, h, rand, 0.5);
  });
}

// 一扇门（局部坐标：铰链在原点，门板沿 +X 展开，外表面朝 +Z）。
// lean：锁杆支座、锁扣、把手、铰链这些几厘米的小件用直角盒（108 → 12 个三角形），一扇门省 1900 个
function doorParts(mats, paint, doorW, doorH, lean = false) {
  const parts = [];
  const galv = mats.galv;
  const small = lean ? (w, h, d) => box(w, h, d) : (w, h, d, r) => rbox(w, h, d, r, 1);
  parts.push([paint, rbox(doorW, doorH, 0.05, 0.008, 1), xf(doorW / 2, doorH / 2, 0)]);
  for (const v of [0.2, 0.5, 0.8]) parts.push([paint, rbox(doorW - 0.14, 0.2, 0.03, 0.014, 1), xf(doorW / 2, doorH * v, 0.032)]);
  for (const u of [0.3, 0.74]) {
    const dy = u > 0.5 ? 0.09 : 0;
    parts.push([galv, cyl(0.017, 0.017, doorH + 0.12, 8), xf(doorW * u, doorH / 2, 0.066)]);
    for (const v of [0.07, 0.34, 0.66, 0.93]) parts.push([galv, small(0.075, 0.05, 0.035, 0.005), xf(doorW * u, doorH * v, 0.058)]);
    for (const v of [-0.02, 1.02]) parts.push([galv, small(0.1, 0.07, 0.05, 0.006), xf(doorW * u, doorH * v, 0.06)]);
    parts.push([galv, small(0.3, 0.032, 0.014, 0.004), xf(doorW * u - 0.15, doorH * 0.43 + dy, 0.082)]);
    parts.push([galv, small(0.07, 0.1, 0.035, 0.005), xf(doorW * u - 0.27, doorH * 0.43 + dy, 0.064)]);
  }
  for (const v of [0.1, 0.36, 0.64, 0.9]) parts.push([paint, small(0.1, 0.15, 0.06, 0.006), xf(0.03, doorH * v, 0.03)]);
  parts.push([mats.rubber, box(doorW - 0.01, 0.025, 0.07), xf(doorW / 2, -0.012, 0)]);
  parts.push([mats.rubber, box(doorW - 0.01, 0.025, 0.07), xf(doorW / 2, doorH + 0.012, 0)]);
  return parts;
}

// ctx: { batch, decals, mats, atlas, solid(matrix, lx, ly, lz, hx, hy, hz, surface) }
// o.lean：门上小五金用直角盒（见 doorParts），整只箱子 8100 → 4300 个三角形
export function addContainer(ctx, o) {
  const { x, z, y = 0, yaw = 0, len = C20, color = 0x7d2a1e, open = false, seed = 1, wear = 0.45, line = 0, darkText = false } = o;
  const rand = mulberry32(seed * 7919 + 13);
  const { batch, decals, mats, atlas } = ctx;
  const base = xf(x, y, z, 0, yaw, 0);
  const paint = mats.paint(color, { wear, dirt: 0.6 });
  const L = len, W = CW, H = CH;
  const ou = rand(), ov = rand();
  const T = { tile: 5.2, ou, ov };
  const put = (mat, geo, local, opts = T) => batch.add(mat, geo, local ? base.clone().multiply(local) : base.clone(), opts || {});
  const sticker = (geo, local) => decals.add(atlas.material, geo, base.clone().multiply(local));

  // 框架：角柱、角件、上下梁
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      put(paint, rbox(0.16, H, 0.16, 0.012, 1), xf(sx * (L / 2 - 0.08), H / 2, sz * (W / 2 - 0.08)));
      for (const sy of [0, 1]) {
        put(paint, rbox(0.19, 0.125, 0.19, 0.015, 1), xf(sx * (L / 2 - 0.085), sy ? H - 0.0625 : 0.0625, sz * (W / 2 - 0.085)));
      }
    }
    put(paint, rbox(0.12, 0.16, W - 0.3, 0.008, 1), xf(sx * (L / 2 - 0.06), 0.08, 0));
    put(paint, rbox(0.12, 0.12, W - 0.3, 0.008, 1), xf(sx * (L / 2 - 0.06), H - 0.06, 0));
  }
  for (const sz of [-1, 1]) {
    put(paint, rbox(L - 0.3, 0.16, 0.09, 0.008, 1), xf(0, 0.08, sz * (W / 2 - 0.05)));
    put(paint, rbox(L - 0.3, 0.12, 0.09, 0.008, 1), xf(0, H - 0.06, sz * (W / 2 - 0.05)));
  }

  // 波纹侧板、端板、顶板
  const wallW = L - 0.3, wallH = H - 0.28, endW = W - 0.3;
  const wallZ = W / 2 - 0.05;
  const pSide = wallW / Math.round(wallW / PITCH);
  const sideGeo = () => corrugated(wallW, wallH, { pitch: PITCH, depth: DEPTH, tile: 5.2, ou, ov });
  const endGeo = () => corrugated(endW, wallH, { pitch: PITCH, depth: DEPTH, tile: 5.2, ou: ou + 0.4, ov });
  const sideA = xf(-wallW / 2, 0.16, wallZ);
  const sideB = xf(wallW / 2, 0.16, -wallZ, 0, Math.PI, 0);
  put(paint, sideGeo(), sideA, null);
  put(paint, sideGeo(), sideB, null);
  put(paint, endGeo(), xf(L / 2 - 0.05, 0.16, endW / 2, 0, Math.PI / 2, 0), null);
  const roofL = L - 0.2, roofW = W - 0.2;
  put(paint, corrugated(roofL, roofW, { pitch: 0.21, depth: 0.018, tile: 5.2, ou, ov: ov + 0.3 }),
    xf(-roofL / 2, H - 0.03, roofW / 2, -Math.PI / 2, 0, 0), null);

  // 侧面喷字：公司名 + 箱号
  const idText = `${LINES[line % LINES.length].slice(0, 3)}U ${100000 + Math.floor(rand() * 899999)} ${Math.floor(rand() * 10)}`;
  const idRect = idLabel(atlas, idText, darkText, rand);
  const wmRect = wordmark(atlas, line, darkText, rand);
  const wmW = Math.min(3.3, wallW * 0.5), wmH = wmW * (150 / 768);
  for (const sideM of [sideA, sideB]) {
    const k = Math.round((wallW * 0.08) / pSide);
    sticker(decalCorrugated(wmW, wmH, wmRect, pSide, DEPTH), sideM.clone().multiply(xf(k * pSide, wallH * 0.5, 0.004)));
    const idW = 1.38, k2 = Math.round((wallW - idW - 0.15) / pSide);
    sticker(decalCorrugated(idW, idW * 0.25, idRect, pSide, DEPTH), sideM.clone().multiply(xf(k2 * pSide, wallH - 0.5, 0.004)));
  }

  // 门：铰链在外角，可以 270 度折到侧面
  const doorW = W / 2 + 0.016, doorH = H - 0.3;
  const swing = open ? (o.swing || [1.85, 4.5]) : [0, 0];
  const doorL = xf(-L / 2 - 0.03, 0.15, -(W / 2 + 0.02), 0, -Math.PI / 2 - swing[0], 0);
  const doorR = xf(-L / 2 - 0.03, 0.15, W / 2 + 0.02, 0, -Math.PI / 2 + swing[1], 0).multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  for (const dm of [doorL, doorR]) {
    for (const [mat, geo, local] of doorParts(mats, paint, doorW, doorH, o.lean)) put(mat, geo, dm.clone().multiply(local));
  }
  // 门上的箱号和载重表（贴在右门，文字不能镜像，所以单独算位置）
  const doorFace = xf(-L / 2 - 0.03, 0.15, W / 2 + 0.02, 0, -Math.PI / 2 + swing[1], 0);
  sticker(decalQuad(0.86, 0.215, idRect), doorFace.clone().multiply(xf(-doorW + 0.12, doorH * 0.62, 0.027)));
  sticker(decalQuad(0.5, 0.44, weightsLabel(atlas, rand)), doorFace.clone().multiply(xf(-doorW + 0.3, doorH * 0.27, 0.027)));

  if (!open) {
    ctx.solid(base, 0, H / 2, 0, L / 2, H / 2, W / 2, 'metal');
    return;
  }

  // 敞开的箱子：内壁、地板和分片碰撞体，玩家能走进去
  const inner = mats.paint(0x8f8f88, { wear: 0.3, dirt: 0.5, wet: false });
  const iz = W / 2 - 0.09;
  put(inner, sideGeo(), xf(wallW / 2, 0.16, iz, 0, Math.PI, 0), null);
  put(inner, sideGeo(), xf(-wallW / 2, 0.16, -iz), null);
  put(inner, endGeo(), xf(L / 2 - 0.09, 0.16, -endW / 2, 0, -Math.PI / 2, 0), null);
  put(inner, corrugated(roofL, roofW, { pitch: 0.21, depth: 0.018, tile: 5.2, ou, ov }),
    xf(-roofL / 2, H - 0.07, -roofW / 2, Math.PI / 2, 0, 0), null);
  put(mats.woodDark, box(L - 0.24, 0.03, W - 0.2), xf(0, 0.165, 0), { tile: 0.9 });
  ctx.solid(base, 0, 0.09, 0, L / 2, 0.09, W / 2, 'wood');
  ctx.solid(base, 0, H - 0.05, 0, L / 2, 0.05, W / 2, 'metal');
  ctx.solid(base, 0, H / 2, W / 2 - 0.05, L / 2, H / 2, 0.05, 'metal');
  ctx.solid(base, 0, H / 2, -(W / 2 - 0.05), L / 2, H / 2, 0.05, 'metal');
  ctx.solid(base, L / 2 - 0.05, H / 2, 0, 0.05, H / 2, W / 2, 'metal');
  ctx.solid(base.clone().multiply(doorL), doorW / 2, doorH / 2, 0, doorW / 2, doorH / 2, 0.04, 'metal');
  ctx.solid(base.clone().multiply(doorFace), -doorW / 2, doorH / 2, 0, doorW / 2, doorH / 2, 0.04, 'metal');
}
