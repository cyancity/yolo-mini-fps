import * as THREE from 'three';
import { xf, box, rbox, cyl, cylBetween, lathe } from '../../gfx/geo.js';
import { decalQuad, STENCIL_FONT } from '../labels.js';

// 屋面设备件。每个函数往 ctx.batch 加几何体并登记碰撞体；M 是 roofMats() 的材质组。
// o: { x, y, z, yaw }，y 是所在屋面的标高
const G = { tile: 1.2 }, P = { tile: 5.2 }, C = { tile: 3 };
const at = (o) => xf(o.x, o.y, o.z, 0, o.yaw || 0, 0);
const add = (ctx, mat, geo, m, local, opt) => ctx.batch.add(mat, geo, local ? m.clone().multiply(local) : m, opt);

function label(ctx, key, text, sub) {
  return ctx.atlas.cached(`roof|${key}`, 192, 96, (c, w, h) => {
    c.fillStyle = '#e9e6dc'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#16181a'; c.textAlign = 'center';
    c.font = `700 44px ${STENCIL_FONT}`;
    c.fillText(text, w / 2, 48, w - 12);
    c.font = '600 24px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
    c.fillText(sub, w / 2, 82, w - 12);
  });
}

// 屋顶空调机组（RTU）：设备基座、机身、冷凝风机、百叶、检修门、电源隔离开关和燃气管。高 h 决定能不能站着躲
export function rtu(ctx, M, o) {
  const { mats } = ctx;
  const w = o.w || 3.2, d = o.d || 1.7, h = o.h || 1.5, m = at(o), base = 0.42, top = base + h;
  add(ctx, mats.galv, box(w - 0.3, 0.36, d - 0.3), m, xf(0, 0.18, 0), G);
  add(ctx, mats.steelDark, box(w, 0.08, d), m, xf(0, 0.38, 0), G);
  add(ctx, M.unit, rbox(w, h, d, 0.025, 1), m, xf(0, base + h / 2, 0), P);
  // 顶上两台冷凝风机：黑色风筒里三片扇叶，上面一个同心圆网罩
  for (const s of [-1, 1]) {
    const fx = w / 2 - 0.55, fz = s * d * 0.22;
    add(ctx, mats.plasticBlack, cyl(0.36, 0.36, 0.05, 20), m, xf(fx, top + 0.025, fz), { tile: 0.06 });
    for (let i = 0; i < 3; i++) add(ctx, mats.steelDark, box(0.6, 0.008, 0.1), m, xf(fx, top + 0.055, fz, 0.25, (i * Math.PI * 2) / 3 + s, 0), G);
    add(ctx, mats.galv, box(0.74, 0.02, 0.025), m, xf(fx, top + 0.075, fz), G);
    add(ctx, mats.galv, box(0.025, 0.02, 0.74), m, xf(fx, top + 0.075, fz), G);
    for (const r of [0.13, 0.24, 0.35]) add(ctx, mats.galv, new THREE.TorusGeometry(r, 0.006, 3, 14), m, xf(fx, top + 0.085, fz, Math.PI / 2, 0, 0), G);
    add(ctx, mats.steelDark, cyl(0.07, 0.07, 0.06, 10), m, xf(fx, top + 0.07, fz), G);
  }
  // 冷凝端的进风百叶（两侧）：机身上贴一块黑板当里面的暗腔，外面一圈边框，叶片斜着夹在框里，看得出深度
  const lh = Math.min(1.1, h - 0.55), ly = base + 0.18 + lh / 2, lx = w / 2 - 0.6, nl = Math.round(lh / 0.12);
  for (const s of [-1, 1]) {
    const fz = s * (d / 2 + 0.035);
    add(ctx, mats.black, box(1.1, lh, 0.012), m, xf(lx, ly, s * (d / 2 + 0.006)));
    for (const sy of [-1, 1]) add(ctx, M.trim, box(1.2, 0.05, 0.07), m, xf(lx, ly + sy * (lh / 2 + 0.025), fz), P);
    for (const sx of [-1, 1]) add(ctx, M.trim, box(0.05, lh + 0.1, 0.07), m, xf(lx + sx * 0.575, ly, fz), P);
    for (let i = 0; i < nl; i++) add(ctx, M.unit, box(1.1, 0.02, 0.065), m, xf(lx, ly - lh / 2 + (i + 0.5) * (lh / nl), s * (d / 2 + 0.04), s * 0.6, 0, 0), P);
  }
  // 检修门：板缝和把手
  // 门不压到百叶框（窄机组少一扇）
  for (let i = 0; i < 3; i++) {
    const px = -w / 2 + 0.45 + i * 0.62;
    if (px + 0.3 > lx - 0.6) break;
    add(ctx, M.unit, box(0.56, h - 0.3, 0.02), m, xf(px, base + h / 2, -d / 2 - 0.006), P);
    add(ctx, mats.galv, box(0.03, 0.12, 0.03), m, xf(px + 0.22, base + h / 2, -d / 2 - 0.025), G);
  }
  // 隔离开关、穿线管、燃气管
  add(ctx, mats.steelDark, box(0.05, 0.9, 0.05), m, xf(-w / 2 - 0.35, 0.45, -d / 2 + 0.2), G);
  add(ctx, M.box, rbox(0.3, 0.4, 0.16, 0.01, 1), m, xf(-w / 2 - 0.35, 0.95, -d / 2 + 0.28), P);
  add(ctx, mats.galv, cylBetween(-w / 2 - 0.35, 1.15, -d / 2 + 0.28, -w / 2 - 0.35, 1.4, -d / 2 + 0.28, 0.018, 6), m, null, G);
  add(ctx, mats.galv, cylBetween(-w / 2 - 0.35, 1.4, -d / 2 + 0.28, -w / 2, 1.4, -d / 2 + 0.28, 0.018, 6), m, null, G);
  add(ctx, M.yellow, cylBetween(-w / 2 + 0.3, 0.12, -d / 2 - 0.25, -w / 2 + 0.3, 0.7, -d / 2 - 0.25, 0.022, 8), m, null, P);
  add(ctx, M.yellow, cylBetween(-w / 2 + 0.3, 0.7, -d / 2 - 0.25, -w / 2 + 0.3, 0.7, -d / 2 - 0.02, 0.022, 8), m, null, P);
  add(ctx, M.red, box(0.12, 0.04, 0.04), m, xf(-w / 2 + 0.3, 0.55, -d / 2 - 0.25), P);
  ctx.decals.add(ctx.atlas.material, decalQuad(0.36, 0.18, label(ctx, `rtu${o.tag}`, `RTU-${o.tag}`, '屋顶机组')), m.clone().multiply(xf(w / 2 - 0.25, base + h - 0.25, -d / 2 - 0.018, 0, Math.PI, 0)));
  ctx.phys.solid(m, 0, top / 2, 0, w / 2, top / 2, d / 2, 'metal');
}

// 蘑菇形排风机
export function exhaustFan(ctx, o) {
  const { mats } = ctx;
  const m = at(o), s = o.s || 1;
  add(ctx, mats.galv, box(0.8 * s, 0.32, 0.8 * s), m, xf(0, 0.16, 0), G);
  add(ctx, mats.galv, cyl(0.3 * s, 0.32 * s, 0.3, 18), m, xf(0, 0.47, 0), G);
  add(ctx, mats.steelDark, cyl(0.29 * s, 0.29 * s, 0.14, 18, true), m, xf(0, 0.69, 0), G);
  add(ctx, mats.galv, lathe([[0.4, 0.74], [0.54, 0.76], [0.52, 0.8], [0.36, 0.92], [0.02, 0.98]].map(([r, y]) => [r * s, y]), 20), m, null, G);
  ctx.phys.addCyl(o.x, o.z, 0.45 * s, o.y, o.y + 0.98, 'metal');
}

// 矩形风管：a、b 是两端 [x, z]（只能沿 x 或 z），每 1.2 m 一道法兰，底下垫枕木
export function duct(ctx, o) {
  const { mats } = ctx;
  const { a, b, y, w = 0.7, h = 0.6, lift = 0.12 } = o;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
  const m = xf((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, 0, yaw, 0);
  add(ctx, mats.galv, box(len, h, w), m, xf(0, lift + h / 2, 0), G);
  const nf = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i <= nf; i++) {
    const x = -len / 2 + (len * i) / nf;
    add(ctx, mats.galv, box(0.04, h + 0.05, w + 0.05), m, xf(x, lift + h / 2, 0), G);
    if (i % 2 === 0) add(ctx, mats.rubber, box(0.18, lift, w + 0.2), m, xf(x, lift / 2, 0));
  }
  ctx.phys.solid(m, 0, (lift + h) / 2, 0, len / 2, (lift + h) / 2, w / 2 + 0.03, 'metal');
}

// 梯式桥架：两根侧梁 + 横档，里面一束电缆，垫在橡胶支墩上；矮到能直接跨过去
export function cableTray(ctx, o) {
  const { mats } = ctx;
  const { a, b, y, w = 0.4 } = o;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
  const m = xf((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, 0, yaw, 0), hy = 0.17;
  for (const s of [-1, 1]) add(ctx, mats.galv, box(len, 0.08, 0.025), m, xf(0, hy + 0.04, s * w / 2), G);
  for (let x = -len / 2 + 0.15; x < len / 2; x += 0.3) add(ctx, mats.galv, box(0.03, 0.02, w), m, xf(x, hy + 0.01, 0), G);
  for (let i = 0; i < 3; i++) add(ctx, mats.rubber, cyl(0.025, 0.025, len, 6), m, xf(0, hy + 0.045 + (i % 2) * 0.03, -0.1 + i * 0.09, 0, 0, Math.PI / 2));
  for (let x = -len / 2 + 0.4; x < len / 2; x += 1.6) add(ctx, mats.rubber, box(0.22, hy, w + 0.12), m, xf(x, hy / 2, 0));
  ctx.phys.solid(m, 0, 0.13, 0, len / 2, 0.13, w / 2 + 0.06, 'metal');
}

// 管廊：几根管子架在滚轮支座上，顶高 0.35 左右，脚下一抬就过
export function pipeRun(ctx, M, o) {
  const { mats } = ctx;
  const { a, b, y } = o;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
  const m = xf((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, 0, yaw, 0);
  const pipes = [[0.06, M.yellow, -0.16], [0.08, M.box, 0.02], [0.045, mats.galv, 0.18]];
  for (const [r, mat, z] of pipes) add(ctx, mat, cyl(r, r, len, 12), m, xf(0, 0.24, z, 0, 0, Math.PI / 2), mat === mats.galv ? G : P);
  for (let x = -len / 2 + 0.6; x < len / 2; x += 2.2) {
    add(ctx, mats.rubber, box(0.24, 0.1, 0.6), m, xf(x, 0.05, 0));
    add(ctx, mats.steelDark, box(0.06, 0.1, 0.56), m, xf(x, 0.15, 0), G);
  }
  ctx.phys.solid(m, 0, 0.16, 0, len / 2, 0.16, 0.3, 'metal');
}

// 采光罩：镀锌底座 + 扁圆的亚克力罩，库里的灯透上来一点
export function skylight(ctx, M, o) {
  const { mats } = ctx;
  const m = at(o), s = o.s || 1.3;
  add(ctx, M.unit, rbox(s, 0.3, s, 0.02, 1), m, xf(0, 0.15, 0), P);
  add(ctx, mats.galv, box(s + 0.06, 0.04, s + 0.06), m, xf(0, 0.31, 0), G);
  const dome = new THREE.SphereGeometry(0.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  add(ctx, M.skylight, dome, m, xf(0, 0.33, 0, 0, 0, 0, s * 0.96, 0.6, s * 0.96));
  ctx.phys.solid(m, 0, 0.3, 0, s / 2, 0.3, s / 2, 'glass');
}

// 分体空调外机：机身、风扇罩、底座
export function condenser(ctx, M, o) {
  const { mats } = ctx;
  const m = at(o);
  add(ctx, mats.steelDark, box(0.06, 0.14, 0.5), m, xf(-0.3, 0.07, 0), G);
  add(ctx, mats.steelDark, box(0.06, 0.14, 0.5), m, xf(0.3, 0.07, 0), G);
  add(ctx, M.unit, rbox(0.88, 0.66, 0.34, 0.02, 1), m, xf(0, 0.47, 0), P);
  add(ctx, mats.plasticBlack, cyl(0.22, 0.22, 0.02, 18), m, xf(-0.13, 0.47, 0.17, Math.PI / 2, 0, 0), { tile: 0.06 });
  add(ctx, mats.galv, box(0.46, 0.015, 0.015), m, xf(-0.13, 0.47, 0.185), G);
  add(ctx, mats.galv, box(0.015, 0.46, 0.015), m, xf(-0.13, 0.47, 0.185), G);
  add(ctx, mats.black, cylBetween(0.32, 0.25, -0.1, 0.32, 0.25, -0.5, 0.025, 6), m, null);
}

// 拼装式钢板水箱：1 m 一块板，外凸法兰格子；侧面爬梯、顶上人孔和通气管
export function panelTank(ctx, o) {
  const { mats } = ctx;
  const m = at(o), w = o.w || 3, d = o.d || 2, h = o.h || 2, lift = 0.3;
  for (const s of [-1, 0, 1]) add(ctx, mats.steelDark, box(0.16, lift, d + 0.3), m, xf(s * (w / 2 - 0.2), lift / 2, 0), G);
  add(ctx, mats.galv, box(w, h, d), m, xf(0, lift + h / 2, 0), G);
  const fl = (sx, sy, sz, x, y, z) => add(ctx, mats.galv, box(sx, sy, sz), m, xf(x, lift + y, z), G);
  for (let i = 0; i <= w; i++) {
    const x = -w / 2 + i;
    for (const s of [-1, 1]) fl(0.03, h, 0.05, x, h / 2, s * (d / 2 + 0.02));
    fl(0.03, 0.05, d, x, h + 0.02, 0);
  }
  for (let i = 0; i <= d; i++) {
    const z = -d / 2 + i;
    for (const s of [-1, 1]) fl(0.05, h, 0.03, s * (w / 2 + 0.02), h / 2, z);
    fl(w, 0.05, 0.03, 0, h + 0.02, z);
  }
  for (let j = 1; j < h; j++) {
    for (const s of [-1, 1]) {
      fl(w, 0.03, 0.05, 0, j, s * (d / 2 + 0.02));
      fl(0.05, 0.03, d, s * (w / 2 + 0.02), j, 0);
    }
  }
  // 每块 1 m 的板中间都压出一个方形凸包
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      for (const s of [-1, 1]) fl(0.78, 0.78, 0.03, -w / 2 + i + 0.5, j + 0.5, s * (d / 2 + 0.015));
    }
    for (let k = 0; k < d; k++) fl(0.78, 0.03, 0.78, -w / 2 + i + 0.5, h + 0.015, -d / 2 + k + 0.5);
  }
  for (let k = 0; k < d; k++) {
    for (let j = 0; j < h; j++) for (const s of [-1, 1]) fl(0.03, 0.78, 0.78, s * (w / 2 + 0.015), j + 0.5, -d / 2 + k + 0.5);
  }
  add(ctx, mats.galv, cyl(0.3, 0.3, 0.08, 16), m, xf(w / 4, lift + h + 0.06, 0), G);
  add(ctx, mats.galv, cylBetween(-w / 4, lift + h, 0.3, -w / 4, lift + h + 0.5, 0.3, 0.05, 8), m, null, G);
  for (const s of [-1, 1]) add(ctx, mats.steelDark, box(0.04, h + 0.9, 0.04), m, xf(-w / 2 + 0.6 + s * 0.22, (lift + h + 0.9) / 2, d / 2 + 0.2), G);
  for (let y = 0.5; y < lift + h + 0.8; y += 0.3) add(ctx, mats.steelDark, box(0.44, 0.025, 0.025), m, xf(-w / 2 + 0.6, y, d / 2 + 0.2), G);
  add(ctx, mats.galv, cylBetween(w / 2, lift + h - 0.3, -0.5, w / 2 + 0.3, lift + h - 0.3, -0.5, 0.05, 8), m, null, G);
  add(ctx, mats.galv, cylBetween(w / 2 + 0.3, lift + h - 0.3, -0.5, w / 2 + 0.3, 0.05, -0.5, 0.05, 8), m, null, G);
  ctx.phys.solid(m, 0, (lift + h) / 2, 0, w / 2 + 0.05, (lift + h) / 2, d / 2 + 0.05, 'metal');
}

// 卫星天线：压重底架 + 抛物面 + 馈源臂；elev 是仰角
export function dish(ctx, M, o) {
  const { mats } = ctx;
  const m = at(o), r = o.r || 0.6, elev = o.elev ?? 0.7;
  for (const [x, z] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) add(ctx, mats.concrete, box(0.4, 0.1, 0.2), m, xf(x, 0.05, z), C);
  for (const s of [-1, 1]) {
    add(ctx, mats.steelDark, box(1.3, 0.05, 0.05), m, xf(0, 0.13, s * 0.55), G);
    add(ctx, mats.steelDark, box(0.05, 0.05, 1.3), m, xf(s * 0.55, 0.13, 0), G);
    add(ctx, mats.steelDark, cylBetween(s * 0.55, 0.15, 0.55, 0, 0.9, 0, 0.02, 6), m, null, G);
  }
  add(ctx, mats.galv, cyl(0.04, 0.04, 1.1, 10), m, xf(0, 0.65, 0), G);
  const dm = m.clone().multiply(xf(0, 1.2, 0, -elev, 0, 0));
  // 盘面两面都要看得见：正反两条轮廓各转一圈
  const prof = [[0, 0], [r * 0.5, r * 0.06], [r, r * 0.25], [r * 1.02, r * 0.26]];
  add(ctx, M.unit, lathe(prof, 22), dm, xf(0, 0, 0, Math.PI / 2, 0, 0), { tile: 0.6 });
  add(ctx, M.unit, lathe([...prof].reverse(), 22), dm, xf(0, 0, 0.006, Math.PI / 2, 0, 0), { tile: 0.6 });
  add(ctx, mats.galv, cylBetween(0, -r * 0.6, 0.05, 0, 0, r * 0.75, 0.015, 6), dm, null, G);
  add(ctx, mats.plasticBlack, rbox(0.07, 0.07, 0.12, 0.01, 1), dm, xf(0, 0, r * 0.75), { tile: 0.06 });
  ctx.phys.addCyl(o.x, o.z, 0.5, o.y, o.y + 1.3, 'metal');
}

// 三角格构天线塔：三根立管、之字形斜撑、顶上鞭状天线和板状天线，塔顶航标灯；三根拉索
export function mast(ctx, M, o) {
  const { mats } = ctx;
  const m = at(o), h = o.h || 11, r = 0.32, seg = Math.round(h / 1.1);
  const leg = (i, y) => [Math.cos(i * 2.094) * r, y, Math.sin(i * 2.094) * r];
  add(ctx, mats.concrete, box(1.2, 0.25, 1.2), m, xf(0, 0.125, 0), C);
  for (let i = 0; i < 3; i++) add(ctx, mats.galv, cylBetween(...leg(i, 0.25), ...leg(i, h), 0.03, 6), m, null, G);
  for (let k = 0; k < seg; k++) {
    const y0 = 0.25 + ((h - 0.25) * k) / seg, y1 = 0.25 + ((h - 0.25) * (k + 1)) / seg;
    for (let i = 0; i < 3; i++) add(ctx, mats.galv, cylBetween(...leg(i, y0), ...leg((i + 1) % 3, y1), 0.012, 4), m, null, G);
  }
  add(ctx, mats.galv, cyl(0.025, 0.035, 3, 6), m, xf(0, h + 1.5, 0), G);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 1.05;
    add(ctx, M.unit, rbox(0.22, 1.1, 0.08, 0.02, 1), m, xf(Math.cos(a) * 0.45, h - 1, Math.sin(a) * 0.45, 0, -a + Math.PI / 2, 0), P);
    add(ctx, mats.galv, cylBetween(...leg(i, h - 1.2), Math.cos(a) * 0.45, h - 1.2, Math.sin(a) * 0.45, 0.015, 4), m, null, G);
  }
  add(ctx, mats.steelDark, cyl(0.06, 0.06, 0.12, 10), m, xf(0, h + 3.02, 0), G);
  add(ctx, M.beacon, new THREE.SphereGeometry(0.075, 10, 8), m, xf(0, h + 3.14, 0));
  add(ctx, M.beacon, new THREE.SphereGeometry(0.06, 10, 8), m, xf(0.3, h * 0.55, 0));
  // 拉索落在屋面的地锚上
  for (const [ax, az] of o.guys || []) {
    ctx.batch.add(mats.galv, cylBetween(o.x, o.y + h * 0.7, o.z, ax, o.y + 0.15, az, 0.006, 4), null, G);
    ctx.batch.add(mats.steelDark, box(0.25, 0.15, 0.25), xf(ax, o.y + 0.075, az), G);
  }
  ctx.phys.addCyl(o.x, o.z, 0.45, o.y, o.y + h, 'metal');
}

// 检修人孔盖（关着）
export function hatch(ctx, M, o) {
  const { mats } = ctx;
  const m = at(o);
  add(ctx, M.unit, rbox(1.0, 0.55, 1.0, 0.02, 1), m, xf(0, 0.275, 0), P);
  add(ctx, M.unit, rbox(1.12, 0.08, 1.12, 0.02, 1), m, xf(0, 0.59, 0), P);
  for (const s of [-1, 1]) add(ctx, mats.steelDark, box(0.12, 0.06, 0.05), m, xf(s * 0.3, 0.56, -0.58), G);
  add(ctx, M.yellow, cylBetween(0.62, 0, 0.3, 0.62, 1.05, 0.3, 0.025, 8), m, null, P);
  ctx.phys.solid(m, 0, 0.32, 0, 0.56, 0.32, 0.56, 'metal');
}

// 通气立管和鹅颈通气口
export function vent(ctx, o) {
  const { mats } = ctx;
  const m = at(o);
  if (o.goose) {
    add(ctx, mats.galv, cyl(0.12, 0.12, 0.5, 12), m, xf(0, 0.25, 0), G);
    add(ctx, mats.galv, cylBetween(0, 0.5, 0, 0, 0.62, 0.1, 0.12, 12), m, null, G);
    add(ctx, mats.galv, cylBetween(0, 0.62, 0.1, 0, 0.5, 0.26, 0.12, 12), m, null, G);
  } else {
    add(ctx, mats.black, cyl(0.055, 0.055, 0.45, 10), m, xf(0, 0.225, 0));
    add(ctx, mats.rubber, cyl(0.1, 0.12, 0.08, 10), m, xf(0, 0.04, 0));
  }
}

// 小型冷却塔：钢架底座、带百叶的箱体、顶上风筒和风扇罩、进出水管
export function coolingTower(ctx, M, o) {
  const { mats } = ctx;
  const m = at(o), w = o.w || 2.4, h = 2.0, base = 0.35;
  add(ctx, mats.steelDark, box(w + 0.1, base, w + 0.1), m, xf(0, base / 2, 0), G);
  add(ctx, M.unit, rbox(w, h, w, 0.03, 1), m, xf(0, base + h / 2, 0), P);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) add(ctx, mats.steelDark, box(w - 0.3, 0.03, 0.08), m, xf(0, base + 0.2 + i * 0.13, s * (w / 2 + 0.02), s * 0.7, 0, 0), G);
  }
  add(ctx, M.unit, cyl(0.85, 0.95, 0.5, 20), m, xf(0, base + h + 0.25, 0), P);
  add(ctx, mats.plasticBlack, cyl(0.84, 0.84, 0.03, 20), m, xf(0, base + h + 0.51, 0), { tile: 0.06 });
  for (let i = 0; i < 4; i++) add(ctx, mats.galv, box(1.7, 0.02, 0.03), m, xf(0, base + h + 0.54, 0, 0, (i * Math.PI) / 4, 0), G);
  add(ctx, M.yellow, cylBetween(-w / 2 - 0.3, 0.2, 0.5, -w / 2 - 0.3, base + 1.2, 0.5, 0.06, 10), m, null, P);
  add(ctx, M.yellow, cylBetween(-w / 2 - 0.3, base + 1.2, 0.5, -w / 2, base + 1.2, 0.5, 0.06, 10), m, null, P);
  add(ctx, mats.galv, cylBetween(-w / 2 - 0.3, 0.2, -0.5, -w / 2 - 0.3, base + 0.4, -0.5, 0.07, 10), m, null, G);
  add(ctx, mats.galv, cylBetween(-w / 2 - 0.3, base + 0.4, -0.5, -w / 2, base + 0.4, -0.5, 0.07, 10), m, null, G);
  ctx.decals.add(ctx.atlas.material, decalQuad(0.36, 0.18, label(ctx, `ct${o.tag}`, `CT-${o.tag}`, '冷却塔')), m.clone().multiply(xf(-0.18, base + h - 0.5, w / 2 + 0.006)));
  ctx.phys.solid(m, 0, (base + h + 0.5) / 2, 0, w / 2, (base + h + 0.5) / 2, w / 2, 'metal');
}

// 一组户外电气柜：钢支架、两台柜子、往下走的穿线管和警示贴
export function cabinets(ctx, M, o) {
  const { mats } = ctx;
  const m = at(o), n = o.n || 2;
  add(ctx, mats.steelDark, box(n * 0.82 + 0.1, 0.12, 0.6), m, xf(0, 0.06, 0), G);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.82;
    add(ctx, M.box, rbox(0.78, 1.7, 0.48, 0.015, 1), m, xf(x, 0.97, 0), P);
    add(ctx, M.box, box(0.84, 0.05, 0.56), m, xf(x, 1.84, 0.02), P);
    add(ctx, mats.galv, box(0.03, 0.16, 0.04), m, xf(x + 0.3, 1.0, 0.26), G);
    add(ctx, mats.galv, cylBetween(x - 0.2, 0.12, -0.2, x - 0.2, -0.02, -0.2, 0.03, 6), m, null, G);
    ctx.decals.add(ctx.atlas.material, decalQuad(0.2, 0.18, label(ctx, 'hv', 'HV 400V', '高压危险')), m.clone().multiply(xf(x - 0.1, 1.3, 0.243)));
  }
  ctx.phys.solid(m, 0, 0.93, 0, n * 0.41 + 0.05, 0.93, 0.3, 'metal');
}
