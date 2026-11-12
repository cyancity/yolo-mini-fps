import * as THREE from 'three';
import { xf, box, rbox, cyl, cylBetween, extrude, lathe, scaleUV } from '../gfx/geo.js';
import { decalQuad, distress, STENCIL_FONT } from './labels.js';

// 场景道具。每个函数往 ctx.batch 里加几何体，并登记碰撞体。
// ctx: { batch, decals, mats, atlas, phys, rand }

const at = (o) => xf(o.x, o.y || 0, o.z, 0, o.yaw || 0, 0);

export function jerseyBarrier(ctx, o) {
  const len = o.len || 2.4;
  const m = at(o);
  const prof = [[-0.3, 0], [0.3, 0], [0.3, 0.08], [0.14, 0.3], [0.1, 0.8], [-0.1, 0.8], [-0.14, 0.3], [-0.3, 0.08]];
  ctx.batch.add(ctx.mats.concrete, extrude(prof, len, 0.012), m, { tile: 3, ou: ctx.rand(), ov: ctx.rand() });
  // 吊装孔和端部连接钢件
  for (const s of [-1, 1]) {
    ctx.batch.add(ctx.mats.steelDark, rbox(0.05, 0.2, 0.03, 0.005), m.clone().multiply(xf(0, 0.5, s * (len / 2 + 0.012))), { tile: 1.2 });
  }
  ctx.phys.solid(m, 0, 0.15, 0, 0.3, 0.15, len / 2, 'concrete');
  ctx.phys.solid(m, 0, 0.55, 0, 0.13, 0.25, len / 2, 'concrete');
}

const BARREL = [[0, 0], [0.275, 0], [0.285, 0.015], [0.285, 0.28], [0.297, 0.295], [0.297, 0.31], [0.285, 0.325],
  [0.285, 0.565], [0.297, 0.58], [0.297, 0.595], [0.285, 0.61], [0.285, 0.865], [0.29, 0.88], [0.277, 0.885],
  [0.27, 0.862], [0, 0.862]];

export function barrel(ctx, o) {
  const paint = ctx.mats.paint(o.color ?? 0x1c4470, { wear: o.wear ?? 0.6, dirt: 0.7, rough: 0.42 });
  const m = o.lying ? xf(o.x, 0.297, o.z, 0, o.yaw || 0, Math.PI / 2) : xf(o.x, o.y || 0, o.z, 0, o.yaw || 0, 0);
  ctx.batch.add(paint, scaleUV(lathe(BARREL, 28), 0.36, 0.3, ctx.rand(), ctx.rand()), m);
  ctx.batch.add(ctx.mats.steelDark, cyl(0.03, 0.03, 0.02, 10), m.clone().multiply(xf(0.17, 0.872, 0)), { tile: 1.2 });
  ctx.batch.add(ctx.mats.steelDark, cyl(0.016, 0.016, 0.02, 8), m.clone().multiply(xf(-0.15, 0.872, 0.08)), { tile: 1.2 });
  if (o.lying) {
    const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0);
    ctx.phys.addBox(o.x - c * 0.44, 0.297, o.z + s * 0.44, 0.44, 0.297, 0.297, o.yaw || 0, 'metal');
  } else {
    ctx.phys.addCyl(o.x, o.z, 0.297, o.y || 0, (o.y || 0) + 0.885, 'metal');
  }
}

// lean：省三角形的简版（240 → 60），给垛在中间、只露侧面的那几层用：上下铺板各并成一块，
// 九个垫块并成三条纵梁。两头看得见叉孔，侧面看不出来
function palletGeo(ctx, m, lean = false) {
  const w = ctx.mats.wood, T = { tile: 0.9, ou: ctx.rand(), ov: ctx.rand() };
  if (lean) {
    for (const y of [0.011, 0.133]) ctx.batch.add(w, box(1.2, 0.022, 0.8), m.clone().multiply(xf(0, y, 0)), T);
    for (const x of [-0.53, 0, 0.53]) ctx.batch.add(w, box(0.14, 0.1, 0.8), m.clone().multiply(xf(x, 0.072, 0)), T);
    return;
  }
  for (let i = 0; i < 5; i++) ctx.batch.add(w, box(1.2, 0.022, 0.12), m.clone().multiply(xf(0, 0.133, -0.34 + i * 0.17)), T);
  for (const z of [-0.35, 0, 0.35]) {
    ctx.batch.add(w, box(1.2, 0.022, 0.1), m.clone().multiply(xf(0, 0.011, z)), T);
    for (const x of [-0.53, 0, 0.53]) ctx.batch.add(w, box(0.14, 0.078, 0.1), m.clone().multiply(xf(x, 0.061, z)), T);
  }
  for (const x of [-0.53, 0, 0.53]) ctx.batch.add(w, box(0.14, 0.022, 0.8), m.clone().multiply(xf(x, 0.111, 0)), T);
}

// o.lean：除了最上面一层都用简版。o.load：顶上再压一托盖布的薄货，值是布罩厚度
// （托盘一层 0.144，5 层加 0.22 的货顶在 1.084：比蹲姿眼高 1.02 高，原地还跳得上去）
export function palletStack(ctx, o) {
  const n = o.n || 4;
  for (let i = 0; i < n; i++) {
    palletGeo(ctx, xf(o.x + (ctx.rand() - 0.5) * 0.05, (o.y || 0) + i * 0.144, o.z + (ctx.rand() - 0.5) * 0.05, 0, (o.yaw || 0) + (ctx.rand() - 0.5) * 0.08, 0), o.lean && (i < n - 1 || o.load));
  }
  ctx.phys.addBox(o.x, (o.y || 0) + n * 0.072, o.z, 0.6, n * 0.072, 0.4, o.yaw || 0, 'wood');
  if (o.load) tarpCargo(ctx, { x: o.x, y: (o.y || 0) + n * 0.144, z: o.z, yaw: (o.yaw || 0) + 0.03, w: 1.2, h: o.load, d: 0.8, lean: o.lean });
}

const CRATE_TEXTS = [['DZ-07', '货批 0481'], ['易碎', 'FRAGILE'], ['此面向上', '↑ ↑'], ['NET 180 KG', 'LOT 2219']];
function crateLabel(ctx) {
  const i = Math.floor(ctx.rand() * CRATE_TEXTS.length), [a, b] = CRATE_TEXTS[i];
  return ctx.atlas.cached(`crate|${i}`, 256, 128, (c, w, h) => {
    c.fillStyle = '#17130e';
    c.textAlign = 'center';
    c.font = `700 52px ${STENCIL_FONT}, "Microsoft YaHei"`;
    c.fillText(a, w / 2, 56, w - 10);
    c.font = `600 36px ${STENCIL_FONT}, "Microsoft YaHei"`;
    c.fillText(b, w / 2, 106, w - 10);
    distress(c, w, h, ctx.rand, 0.9);
  });
}

// o.lean：箱体的圆角只细分一级（300 → 108 个三角形），6 毫米的圆角看不出差别
export function crate(ctx, o) {
  const w = o.w || 1.0, h = o.h || 0.8, d = o.d || 0.8;
  const m = xf(o.x, o.y || 0, o.z, 0, o.yaw || 0, 0);
  const wood = ctx.mats.wood, dark = ctx.mats.woodDark;
  const T = { tile: 0.9, ou: ctx.rand(), ov: ctx.rand() };
  ctx.batch.add(wood, rbox(w, h, d, 0.006, o.lean ? 1 : 2), m.clone().multiply(xf(0, h / 2, 0)), T);
  const bt = 0.022, bw = 0.085;
  // 四个立面的边框和斜撑
  for (let f = 0; f < 4; f++) {
    const fw = f % 2 === 0 ? w : d, off = f % 2 === 0 ? d / 2 : w / 2;
    const fm = m.clone().multiply(xf(0, 0, 0, 0, (f * Math.PI) / 2, 0)).multiply(xf(0, 0, off + bt / 2));
    ctx.batch.add(dark, box(fw + bt * 2, bw, bt), fm.clone().multiply(xf(0, bw / 2, 0)), T);
    ctx.batch.add(dark, box(fw + bt * 2, bw, bt), fm.clone().multiply(xf(0, h - bw / 2, 0)), T);
    for (const s of [-1, 1]) ctx.batch.add(dark, box(bw, h - bw * 2, bt), fm.clone().multiply(xf(s * (fw / 2 - bw / 2 + bt), h / 2, 0)), T);
    const dl = Math.hypot(fw - bw * 2, h - bw * 2), ang = Math.atan2(h - bw * 2, fw - bw * 2);
    ctx.batch.add(dark, box(dl, bw * 0.8, bt * 0.9), fm.clone().multiply(xf(0, h / 2, 0, 0, 0, f % 2 ? ang : -ang)), T);
    if (f === 0 || f === 2) ctx.decals.add(ctx.atlas.material, decalQuad(0.34, 0.17, crateLabel(ctx)), fm.clone().multiply(xf(fw / 2 - bw - 0.36, h - bw - 0.21, -bt / 2 + 0.003)));
  }
  for (const s of [-1, 1]) ctx.batch.add(dark, box(w, bt, bw), m.clone().multiply(xf(0, h + bt / 2, s * (d / 2 - bw / 2))), T);
  ctx.phys.solid(m, 0, h / 2, 0, w / 2 + bt, h / 2 + bt / 2, d / 2 + bt, 'wood');
}

// 沙袋：把球压成枕头形，两头收口，底面压平，表面带一点鼓包
function sandbagGeo(rand) {
  const g = new THREE.SphereGeometry(1, 14, 9);
  const p = g.attributes.position;
  const sq = (v, e) => Math.sign(v) * Math.abs(v) ** e;
  const a = rand() * 6, b = rand() * 6;
  for (let i = 0; i < p.count; i++) {
    const x = sq(p.getX(i), 0.45), y = sq(p.getY(i), 0.7), z = sq(p.getZ(i), 0.55);
    const lump = 1 + 0.07 * Math.sin(x * 5 + a) * Math.cos(z * 4 + b);
    p.setXYZ(i, x * 0.31, y * 0.098 * lump * (y < 0 ? 0.8 : 1), z * 0.178 * (1 - 0.14 * x * x));
  }
  g.computeVertexNormals();
  return g;
}

export function sandbagWall(ctx, o) {
  const len = o.len || 3, rows = o.rows || 4, m = at(o);
  const per = Math.max(1, Math.round(len / 0.62));
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < per + (r % 2 ? -1 : 0); i++) {
      const x = -len / 2 + 0.31 + i * 0.62 + (r % 2 ? 0.31 : 0);
      const g = sandbagGeo(ctx.rand);
      ctx.batch.add(ctx.mats.sandbag, g, m.clone().multiply(xf(x + (ctx.rand() - 0.5) * 0.04, 0.08 + r * 0.145, (ctx.rand() - 0.5) * 0.05,
        (ctx.rand() - 0.5) * 0.08, (ctx.rand() - 0.5) * 0.14, (ctx.rand() - 0.5) * 0.06)), { tile: 0.25, ou: ctx.rand(), ov: ctx.rand() });
    }
  }
  ctx.phys.solid(m, 0, rows * 0.0725, 0, len / 2, rows * 0.0725, 0.19, 'fabric');
}

export function tireStack(ctx, o) {
  const n = o.n || 3;
  for (let i = 0; i < n; i++) {
    const g = new THREE.TorusGeometry(0.3, 0.115, 10, 22);
    ctx.batch.add(ctx.mats.rubber, scaleUV(g, 6, 2), xf(o.x + (ctx.rand() - 0.5) * 0.06, 0.115 + i * 0.225, o.z + (ctx.rand() - 0.5) * 0.06, Math.PI / 2, 0, 0));
  }
  ctx.phys.addCyl(o.x, o.z, 0.42, 0, n * 0.225 + 0.01, 'rubber');
}

export function cone(ctx, o) {
  const y = o.y || 0, m = xf(o.x, y, o.z, 0, o.yaw || 0, o.tip ? 1.45 : 0);
  ctx.batch.add(ctx.mats.plasticOrange, rbox(0.38, 0.03, 0.38, 0.01), m.clone().multiply(xf(0, 0.015, 0)), { tile: 0.06 });
  ctx.batch.add(ctx.mats.plasticOrange, scaleUV(lathe([[0.15, 0.03], [0.03, 0.7], [0, 0.7]], 18), 14, 10), m);
  ctx.batch.add(ctx.mats.reflective, lathe([[0.107, 0.3], [0.079, 0.46]], 18), m.clone().multiply(xf(0, 0, 0, 0, 0, 0, 1.03, 1, 1.03)));
  if (!o.tip) ctx.phys.addCyl(o.x, o.z, 0.14, y, y + 0.7, 'rubber');
}

export function bollard(ctx, o) {
  const m = at(o);
  ctx.batch.add(ctx.mats.paint(0xc79a12, { wear: 0.7, dirt: 0.5 }), scaleUV(cyl(0.075, 0.075, 0.95, 16), 0.1, 0.18, ctx.rand(), ctx.rand()), m.clone().multiply(xf(0, 0.475, 0)));
  ctx.batch.add(ctx.mats.black, cyl(0.078, 0.078, 0.12, 16), m.clone().multiply(xf(0, 0.72, 0)));
  ctx.batch.add(ctx.mats.steelDark, new THREE.SphereGeometry(0.075, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.clone().multiply(xf(0, 0.95, 0)));
  ctx.phys.addCyl(o.x, o.z, 0.08, 0, 1.0, 'metal');
}

// 柴油发电机 + 三脚架工作灯。返回灯头的位置和朝向，交给灯光模块放聚光灯。
export function generator(ctx, o) {
  const m = at(o);
  const body = ctx.mats.paint(0xb8901f, { wear: 0.55, dirt: 0.8 });
  const T = { tile: 5.2, ou: ctx.rand(), ov: ctx.rand() };
  ctx.batch.add(body, rbox(1.7, 0.95, 0.85, 0.03), m.clone().multiply(xf(0, 0.62, 0)), T);
  ctx.batch.add(ctx.mats.steelDark, box(1.9, 0.1, 0.95), m.clone().multiply(xf(0, 0.09, 0)), { tile: 1.2 });
  for (const s of [-1, 1]) ctx.batch.add(ctx.mats.steelDark, rbox(1.9, 0.06, 0.06, 0.01), m.clone().multiply(xf(0, 1.16, s * 0.43)), { tile: 1.2 });
  for (let i = 0; i < 9; i++) ctx.batch.add(ctx.mats.black, box(0.5, 0.02, 0.012), m.clone().multiply(xf(-0.45, 0.4 + i * 0.05, 0.428, -0.5, 0, 0)));
  ctx.batch.add(ctx.mats.black, rbox(0.42, 0.3, 0.02, 0.006), m.clone().multiply(xf(0.5, 0.72, 0.43)));
  ctx.batch.add(ctx.mats.emissive(0x2bff6a, 6), box(0.03, 0.03, 0.01), m.clone().multiply(xf(0.38, 0.8, 0.445)));
  ctx.batch.add(ctx.mats.emissive(0xff3018, 6), box(0.03, 0.03, 0.01), m.clone().multiply(xf(0.44, 0.8, 0.445)));
  ctx.batch.add(ctx.mats.steelDark, cyl(0.04, 0.04, 0.45, 12), m.clone().multiply(xf(-0.6, 1.3, 0)), { tile: 1.2 });
  ctx.phys.solid(m, 0, 0.6, 0, 0.95, 0.6, 0.48, 'metal');
}

export function workLight(ctx, o) {
  const m = at(o), h = 2.0;
  const st = ctx.mats.steelDark;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    ctx.batch.add(st, cylBetween(0, 0.75, 0, Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55, 0.014, 8), m);
  }
  ctx.batch.add(st, cyl(0.02, 0.02, h - 0.4, 10), m.clone().multiply(xf(0, 0.4 + (h - 0.4) / 2, 0)));
  ctx.batch.add(st, rbox(0.7, 0.03, 0.03, 0.006), m.clone().multiply(xf(0, h, 0)));
  const tilt = 0.38;
  for (const s of [-1, 1]) {
    const hm = m.clone().multiply(xf(s * 0.22, h + 0.14, 0, tilt, 0, 0));
    ctx.batch.add(ctx.mats.plasticBlack, rbox(0.34, 0.24, 0.07, 0.012), hm, { tile: 0.06 });
    ctx.batch.add(ctx.mats.emissive(0xdfeaff, 55), box(0.3, 0.2, 0.004), hm.clone().multiply(xf(0, 0, 0.037)));
  }
  ctx.phys.addCyl(o.x, o.z, 0.12, 0, h + 0.2, 'metal');
  const yaw = o.yaw || 0;
  return {
    position: new THREE.Vector3(o.x, h + 0.14, o.z),
    direction: new THREE.Vector3(Math.sin(yaw) * Math.cos(tilt), -Math.sin(tilt), Math.cos(yaw) * Math.cos(tilt)),
  };
}

export function cableSpool(ctx, o) {
  const m = xf(o.x, 0.6, o.z, 0, o.yaw || 0, Math.PI / 2);
  const T = { tile: 0.9, ou: ctx.rand(), ov: ctx.rand() };
  for (const s of [-1, 1]) ctx.batch.add(ctx.mats.wood, cyl(0.6, 0.6, 0.05, 28), m.clone().multiply(xf(0, s * 0.33, 0)), T);
  ctx.batch.add(ctx.mats.rubber, scaleUV(cyl(0.36, 0.36, 0.6, 24, true), 8, 3), m);
  ctx.phys.addBox(o.x, 0.6, o.z, 0.36, 0.6, 0.6, o.yaw || 0, 'wood');
}

// 用防水布罩着的货堆。o.lean：布罩圆角细分两级、底下托盘用简版（852 → 384 个三角形）
export function tarpCargo(ctx, o) {
  const w = o.w || 1.6, h = o.h || 1.1, d = o.d || 1.2, m = at(o);
  ctx.batch.add(ctx.mats.tarp, rbox(w, h, d, 0.09, o.lean ? 2 : 3), m.clone().multiply(xf(0, 0.144 + h / 2, 0)), { tile: 0.25, ou: ctx.rand(), ov: ctx.rand() });
  for (const s of [-0.3, 0.3]) ctx.batch.add(ctx.mats.plasticOrange, box(0.035, h + 0.012, d + 0.012), m.clone().multiply(xf(s * w, 0.144 + h / 2, 0)), { tile: 0.06 });
  palletGeo(ctx, m.clone().multiply(xf(0, 0, 0, 0, 0, 0, w / 1.2, 1, d / 0.8)), o.lean);
  ctx.phys.solid(m, 0, (h + 0.144) / 2, 0, w / 2, (h + 0.144) / 2, d / 2, 'fabric');
}

// 高件（1.8 米左右的盖布货、两层木箱）顶上罩一块只挡玩家的空气盒，一直到 5 米：groundHeight 不把 playerOnly
// 当地面，人站不上去。不然从旁边的矮件（1.1 米）起跳就能上到 1.8 米的顶，成了敌人上不去的蹲点，
// 贴着围栏的还能从顶上翻出去。射线和寻路的落脚面都不看 playerOnly，挡视线和敌人走位照旧
export function noPerch(ctx, o) {
  ctx.phys.addBox(o.x, (o.top + 5) / 2, o.z, o.hw, (5 - o.top) / 2, o.hd, o.yaw || 0, 'fabric').playerOnly = true;
}
