import * as THREE from 'three';
import { xf, rbox, cyl } from '../gfx/geo.js';
import { B } from './soldier_skeleton.js';
import { smooth, lerp, patch, tubePath, strap, ringPoint, pill, W } from './soldier_skin.js';
import { HEAD, headW } from './soldier_body.js';

// 小圆角盒只用一段圆角：三角形省到三分之一
const rb = (w, h, d, r) => rbox(w, h, d, r, 1);

// 头部装备：高切头盔（或软帽）、护目镜、电子耳罩和麦克风、下颌带、信号灯。

const _n = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// 椭球壳：th 方位（0 正前，+π/2 右），el 仰角；off 沿径向外扩
function shell(S, th, el, off = 0) {
  const rz = Math.cos(th) >= 0 ? S.rzf : S.rzb, c = Math.cos(el);
  return [(S.rx + off) * c * Math.sin(th), S.cy + (S.ry + off) * Math.sin(el), S.cz - (rz + off) * c * Math.cos(th)];
}
// 壳面上一点的摆放矩阵：+Z 朝外，+Y 沿经线朝上
function shellFrame(S, th, el, off = 0) {
  const p = shell(S, th, el, off), q = shell(S, th, el, off + 0.01), u = shell(S, th, el + 0.01, off);
  _n.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
  _y.set(u[0] - p[0], u[1] - p[1], u[2] - p[2]);
  _y.addScaledVector(_n, -_y.dot(_n)).normalize();
  _x.crossVectors(_y, _n);
  return new THREE.Matrix4().makeBasis(_x, _y, _n.clone()).setPosition(p[0], p[1], p[2]);
}
// 壳面上的鼓包：el 从帽檐线往上数（rel 时）或绝对仰角
function shellPatch(sb, mat, S, ths, els, nu, nv, h, skin, rim = null) {
  sb.grid(mat, nu, nv, (i, j) => {
    const a = i / nu, b = j / nv, th = lerp(ths[0], ths[1], a);
    const base = rim ? rim(th) : 0, el = base + lerp(els[0], els[1], b);
    const p = shell(S, th, el, h(a * 2 - 1, b * 2 - 1) - 0.002);
    return { p, skin: skin(p) };
  }, 0.08);
}

const HELMET = { cy: 1.695, rx: 0.104, ry: 0.1, rzf: 0.12, rzb: 0.126, cz: 0.004 };
// 帽檐线高度：前额、耳上（高切口）、后脑
const helmetRimY = (th) => {
  const u = Math.abs(th) / Math.PI;
  return 1.716 + 0.008 * smooth(u / 0.4) - 0.07 * smooth((u - 0.56) / 0.32);
};
const elOf = (S, y) => Math.asin(Math.max(-1, Math.min(1, (y - S.cy) / S.ry)));

const headSkin = () => B.head;

function helmet(sb, C) {
  const S = HELMET, rim = (th) => elOf(S, helmetRimY(th)), nu = 44, nv = 12;
  sb.paint(...C.helmet);
  sb.grid('hard', nu, nv, (i, j) => {
    const th = -Math.PI + (i / nu) * Math.PI * 2, e0 = rim(th), t = j / nv;
    const p = shell(S, th, lerp(e0, Math.PI / 2, 1 - (1 - t) ** 1.3));
    return { p, skin: B.head };
  }, 0.08);
  // 壳的内面：从下面看进去不是空的
  sb.paint(...C.trim);
  sb.grid('hard', nu, 3, (i, j) => {
    const th = -Math.PI + (i / nu) * Math.PI * 2;
    return { p: shell(S, th, rim(th) + j * 0.12, -0.012), skin: B.head };
  }, 0.08, true);
  // 包边
  const edge = [];
  for (let k = 0; k <= 48; k++) {
    const th = -Math.PI + (k / 48) * Math.PI * 2;
    edge.push(shell(S, th, rim(th) + 0.012, -0.005));
  }
  tubePath(sb, 'hard', edge, 0.0075, 6, headSkin, { cap: false });
  // 两侧导轨：贴着帽檐线走的长条，几道横槽
  sb.paint(...C.rail);
  for (const s of [-1, 1]) {
    const ths = s > 0 ? [0.72, 2.25] : [-2.25, -0.72];
    shellPatch(sb, 'hard', S, ths, [0.07, 0.27], 16, 3, (a, b) => 0.009 * pill(b, 4) * pill(a, 12) * (1 - 0.25 * (Math.cos(a * 30) > 0.6 ? 1 : 0)), headSkin, rim);
  }
  // 前额的夜视仪座、顶部和后部的魔术贴面（空白）
  sb.paint(...C.rail);
  sb.rigid('hard', rb(0.05, 0.034, 0.022, 0.006), shellFrame(S, 0, 0.38, 0.006), B.head, 0.06);
  sb.rigid('hard', rb(0.026, 0.018, 0.018, 0.004), shellFrame(S, 0, 0.38, 0.024), B.head, 0.06);
  sb.paint(...C.velcro);
  shellPatch(sb, 'hard', S, [-0.5, 0.5], [0.75, 1.15], 10, 6, (a, b) => 0.003 * pill(a, 10) * pill(b, 10), headSkin);
  shellPatch(sb, 'hard', S, [Math.PI - 0.45, Math.PI + 0.45], [0.05, 0.35], 10, 5, (a, b) => 0.003 * pill(a, 10) * pill(b, 10), headSkin);
  // 识别带：贴着导轨上沿绕头盔一圈
  sb.paint(...C.markHard);
  shellPatch(sb, 'hard', S, [-Math.PI, Math.PI], [0.3, 0.72], 44, 3, (a, b) => 0.0048 * pill(b, 4), headSkin, rim);
  // 配重袋（后脑下沿）
  sb.paint(...C.trim);
  shellPatch(sb, 'hard', S, [Math.PI - 0.5, Math.PI + 0.5], [-0.42, -0.2], 10, 4, (a, b) => 0.016 * pill(a, 6) * pill(b, 4), headSkin);
  // 信号灯：后部魔术贴上方一个小盒，红色灯珠挂在 led 骨上
  sb.paint(...C.rail);
  const lf = shellFrame(S, Math.PI, 0.46, 0.006);
  sb.rigid('hard', rb(0.026, 0.022, 0.012, 0.004), lf, B.head, 0.06);
  sb.paint(...C.led);
  sb.rigid('hard', cyl(0.007, 0.007, 0.006, 12).rotateX(Math.PI / 2), lf.clone().multiply(xf(0, 0.002, 0.007)), B.led, 0.06);
  // 下颌带：从耳前绕过下巴
  sb.paint(...C.strap);
  chinStrap(sb);
}

function chinStrap(sb) {
  const pts = [], nrm = [];
  const path = [[1.71, 1.48], [1.66, 1.42], [1.615, 1.22], [1.585, 0.85], [1.568, 0.4], [1.563, 0]];
  const full = [...path, ...path.slice(0, -1).reverse().map(([y, th]) => [y, -th])];
  for (const [y, th] of full) {
    const q = HEAD(y), p = ringPoint(q, 0, y, th, 0.004), o = ringPoint(q, 0, y, th, 0.05);
    pts.push(p);
    nrm.push([o[0] - p[0], (o[1] - p[1]) - 0.3 * smooth((1.6 - y) / 0.03), o[2] - p[2]]);
  }
  strap(sb, 'soft', pts, nrm, 0.016, 0.003, (p) => headW(p[1]));
}

const CAP = { cy: 1.685, rx: 0.088, ry: 0.1, rzf: 0.106, rzb: 0.11, cz: 0.004 };
function cap(sb, C) {
  const S = CAP, rimY = (th) => 1.7 - 0.012 * smooth(Math.abs(th) / Math.PI), rim = (th) => elOf(S, rimY(th)), nu = 36;
  sb.paint(...C.cap);
  sb.grid('soft', nu, 10, (i, j) => {
    const th = -Math.PI + (i / nu) * Math.PI * 2, t = j / 10;
    // 六片缝线：经线方向的浅沟
    const seam = -0.0015 * Math.max(0, Math.cos(th * 3)) ** 40 * Math.sin(t * Math.PI);
    return { p: shell(S, th, lerp(rim(th), Math.PI / 2, 1 - (1 - t) ** 1.4), seam), skin: B.head };
  }, 0.15);
  // 帽檐：上下两片，往前下垂
  const brim = (y0, flip) => sb.grid('soft', 16, 4, (i, j) => {
    const th = lerp(-0.95, 0.95, i / 16), ext = (j / 4) * 0.068 * (0.55 + 0.45 * Math.cos(th));
    const p = shell(S, th, rim(th), ext);
    p[1] = rimY(th) - 0.014 * (ext / 0.068) ** 2 + y0;
    return { p, skin: B.head };
  }, 0.15, flip);
  brim(0, true);
  brim(-0.005, false);
  // 识别带：帽墙一圈，压在帽檐上面
  sb.paint(...C.mark);
  shellPatch(sb, 'soft', S, [-Math.PI, Math.PI], [0.03, 0.34], nu, 3, (a, b) => 0.0055 * pill(b, 4), headSkin, rim);
  // 后脑的扣环和信号灯夹子
  sb.paint(...C.rail);
  const lf = shellFrame(S, Math.PI, 0.5, 0.004);
  sb.rigid('hard', rb(0.022, 0.02, 0.01, 0.004), lf, B.head, 0.06);
  sb.paint(...C.led);
  sb.rigid('hard', cyl(0.0065, 0.0065, 0.006, 12).rotateX(Math.PI / 2), lf.clone().multiply(xf(0, 0.002, 0.006)), B.led, 0.06);
  // 耳罩的头梁压在帽顶
  sb.paint(...C.ear);
  const band = [];
  for (let k = 0; k <= 12; k++) {
    const th = lerp(-Math.PI / 2, Math.PI / 2, k / 12);
    band.push(shell(S, Math.sign(th) * Math.PI / 2 || 0.0001, Math.PI / 2 - Math.abs(th) * 0.86, 0.008));
  }
  tubePath(sb, 'hard', band, 0.007, 6, headSkin);
}

function goggles(sb, C) {
  const skin = () => B.head;
  sb.paint(...C.frame);
  patch(sb, 'hard', HEAD, 0, [-1.32, 1.32], [1.638, 1.704], 18, 4, (a, b) => 0.017 * pill(a, 10) * pill(b, 6), skin, { tile: 0.06 });
  sb.paint(...C.lens);
  patch(sb, 'hard', HEAD, 0, [-1.12, 1.12], [1.646, 1.696], 18, 4,
    (a, b, y, th) => 0.023 * pill(a, 14) * pill(b, 10) + 0.004 * Math.cos(th * 1.2), skin, { tile: 0.06 });
  // 头带：在头盔下沿下面绕后脑一圈
  sb.paint(...C.strap);
  patch(sb, 'soft', HEAD, 0, [1.25, Math.PI * 2 - 1.25], [1.655, 1.69], 20, 2, (a, b) => 0.006 * pill(b, 6), skin, { tile: 0.1 });
}

function earPro(sb, C, withMic) {
  for (const s of [-1, 1]) {
    sb.paint(...C.cushion);
    sb.rigid('soft', cyl(0.04, 0.042, 0.016, 18).rotateZ(Math.PI / 2), xf(s * 0.084, 1.655, 0.012, 0, 0, 0, 1, 1, 1.12), B.head, 0.08);
    sb.paint(...C.ear);
    sb.rigid('hard', new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-s * Math.PI / 2),
      xf(s * 0.091, 1.655, 0.012, 0, 0, 0, 0.03, 0.046, 0.04), B.head, 0.06);
    sb.rigid('hard', rb(0.012, 0.03, 0.022, 0.004), xf(s * 0.122, 1.66, 0.008), B.head, 0.06);
    // 挂在导轨上的连杆
    sb.rigid('hard', rb(0.01, 0.05, 0.014, 0.003), xf(s * 0.108, 1.7, 0.012, 0, 0, s * 0.2), B.head, 0.06);
  }
  if (!withMic) return;
  sb.paint(...C.ear);
  tubePath(sb, 'hard', [[-0.1, 1.635, -0.02], [-0.096, 1.612, -0.062], [-0.072, 1.6, -0.094], [-0.04, 1.598, -0.112]], 0.0035, 6, headSkin);
  sb.rigid('hard', new THREE.SphereGeometry(0.008, 10, 6), xf(-0.034, 1.598, -0.114), B.head, 0.06);
}

// variant.head：'helmet' 或 'cap'
export function buildHead(sb, C, variant) {
  goggles(sb, C);
  if (variant.head === 'cap') cap(sb, C); else helmet(sb, C);
  earPro(sb, C, true);
}

export { W };
