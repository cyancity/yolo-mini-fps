import { xf, rbox, box, extrude } from '../gfx/geo.js';
import { B, HIP, SHOULDER, BONES } from './soldier_skeleton.js';
import { smooth, lerp, profile, loftY, patch, tubePath, onSurface, pill, W } from './soldier_skin.js';

// 小圆角盒只用一段圆角：三角形省到三分之一
const rb = (w, h, d, r) => rbox(w, h, d, r, 1);

// 身体：作战衫、头套、袖子、手套、裤子、靴子。全部按绑定姿势的模型坐标建（米，面朝 -Z）。
// 每个函数收一个 SkinBuilder 和配色表 C（各部位的 [颜色, 粗糙度, 金属度, 自发光, 第四通道]）。

const side = (sx) => (sx > 0 ? 'R' : 'L');
const g2 = (a, b) => Math.exp(-(a * a + b * b));

// 躯干沿脊柱的权重：骨盆 → 腰 → 胸 → 颈
export function spineW(y) {
  const a = smooth((y - 1.0) / 0.12), b = smooth((y - 1.17) / 0.13), c = smooth((y - 1.46) / 0.07);
  return [B.pelvis, 1 - a, B.spine1, a * (1 - b), B.spine2, b * (1 - c), B.neck, c];
}

// 躯干加上肩部：靠外上方的顶点逐渐交给锁骨和上臂
export function torsoW(p) {
  const ax = Math.abs(p[0]), s = side(p[0]);
  const sh = smooth((ax - 0.07) / 0.09) * smooth((p[1] - 1.34) / 0.08);
  const arm = smooth((ax - 0.165) / 0.035) * smooth((p[1] - 1.3) / 0.06);
  const w = spineW(p[1]);
  for (let i = 1; i < w.length; i += 2) w[i] *= 1 - sh;
  return W(...w, B['clav' + s], sh * (1 - arm * 0.7), B['upperArm' + s], sh * arm * 0.7);
}

export const TORSO = profile([
  [0.97, 0.152, 0.094, 0.1, 0.008], [1.04, 0.148, 0.094, 0.098, 0.006], [1.12, 0.152, 0.1, 0.096, 0.004],
  [1.2, 0.16, 0.108, 0.096, 0], [1.29, 0.168, 0.112, 0.1, 0], [1.36, 0.172, 0.108, 0.1, 0.002],
  [1.415, 0.182, 0.095, 0.092, 0.008], [1.445, 0.198, 0.08, 0.08, 0.012], [1.47, 0.17, 0.07, 0.072, 0.016],
  [1.49, 0.13, 0.064, 0.066, 0.018], [1.51, 0.09, 0.06, 0.062, 0.018], [1.53, 0.068, 0.056, 0.056, 0.016],
]);

export const HEAD = profile([
  [1.46, 0.06, 0.058, 0.056, 0.016], [1.5, 0.057, 0.054, 0.054, 0.014], [1.54, 0.058, 0.058, 0.058, 0.01],
  [1.565, 0.064, 0.082, 0.072, 0.004], [1.59, 0.07, 0.094, 0.088, 0], [1.625, 0.074, 0.1, 0.096, 0],
  [1.665, 0.077, 0.101, 0.1, 0], [1.705, 0.077, 0.097, 0.101, 0], [1.74, 0.07, 0.084, 0.093, 0.004],
  [1.762, 0.054, 0.062, 0.072, 0.006], [1.775, 0.02, 0.024, 0.03, 0.008],
]);
export const headW = (y) => {
  const a = smooth((y - 1.47) / 0.05), b = smooth((y - 1.55) / 0.04);
  return W(B.spine2, 1 - a, B.neck, a * (1 - b), B.head, b);
};

export const HIPS = profile([
  [0.8, 0.15, 0.075, 0.085, 0.01], [0.86, 0.17, 0.085, 0.11, 0.012], [0.92, 0.172, 0.095, 0.115, 0.012],
  [0.98, 0.162, 0.097, 0.105, 0.01], [1.04, 0.154, 0.097, 0.1, 0.008],
]);

export const LEG = profile([
  [0.19, 0.045, 0.042, 0.048, 0.005], [0.22, 0.047, 0.044, 0.05, 0.006], [0.28, 0.052, 0.046, 0.058, 0.01],
  [0.36, 0.058, 0.05, 0.068, 0.012], [0.44, 0.057, 0.055, 0.062, 0.006], [0.5, 0.058, 0.058, 0.06, 0],
  [0.56, 0.062, 0.06, 0.063, 0], [0.64, 0.07, 0.068, 0.072, 0.004], [0.74, 0.078, 0.076, 0.08, 0.008],
  [0.84, 0.086, 0.083, 0.09, 0.012], [0.92, 0.088, 0.085, 0.092, 0.012],
]);

const ARM_ROWS = [
  [0.9, 0.034, 0.032, 0.032, 0, 0], [0.95, 0.037, 0.035, 0.035, 0, 0], [1.0, 0.041, 0.04, 0.041, 0, 0],
  [1.07, 0.044, 0.043, 0.044, 0.004, 0], [1.14, 0.042, 0.042, 0.047, 0.008, 0], [1.2, 0.044, 0.043, 0.046, 0.005, 0.002],
  [1.28, 0.047, 0.046, 0.048, 0.004, 0.004], [1.36, 0.051, 0.048, 0.05, 0.003, 0.006], [1.42, 0.053, 0.05, 0.052, 0, 0.007],
  [1.45, 0.05, 0.048, 0.05, 0, 0.006], [1.47, 0.034, 0.036, 0.038, 0, 0.003], [1.482, 0.012, 0.014, 0.016, 0, 0],
];
export const armProfile = (sx) => profile(ARM_ROWS.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5] * sx]));

// 两段肢体中间的关节：上段 → 半角辅助骨 → 下段，t 从 0 到 1
const jointW = (a, mid, b, t) => (t < 0.5 ? [a, 1 - 2 * t, mid, 2 * t] : [mid, 2 - 2 * t, b, 2 * t - 1]);

function armW(p, sx) {
  const s = side(sx), y = p[1];
  const top = smooth((y - 1.43) / 0.06);
  if (y > 1.25) return W(B['upperArm' + s], 1 - top * 0.6, B['clav' + s], top * 0.6);
  if (y > 0.95) return W(...jointW(B['upperArm' + s], B['elbow' + s], B['foreArm' + s], smooth((1.2 - y) / 0.12)));
  const h = smooth((0.925 - y) / 0.05);
  return W(B['foreArm' + s], 1 - h, B['hand' + s], h);
}

function legW(p, sx) {
  const s = side(sx), y = p[1];
  if (y > 0.84) { const t = smooth((0.93 - y) / 0.09); return W(B.pelvis, (1 - t) * 0.6, B['thigh' + s], 1 - (1 - t) * 0.6); }
  return W(...jointW(B['thigh' + s], B['knee' + s], B['shin' + s], smooth((0.58 - y) / 0.16)));
}

export function buildTorso(sb, C) {
  sb.paint(...C.shirt);
  // 作战衫：前后片的竖缝、腰侧的褶
  const off = (y, th) => 0.0015 * Math.cos(th * 9 + y * 20) * smooth((1.2 - y) / 0.15) - 0.002 * g2((Math.abs(th) - 1.57) / 0.2, (y - 1.07) / 0.05);
  loftY(sb, 'soft', TORSO, 0, [0.97, 1.0, 1.04, 1.08, 1.12, 1.16, 1.2, 1.25, 1.29, 1.33, 1.36, 1.39, 1.415, 1.435, 1.45, 1.465, 1.48, 1.495, 1.505, 1.515, 1.53],
    40, torsoW, { tile: 0.12, e: 0.88, off });
  // 头套：鼻梁和眉弓的起伏，口鼻处的透气网略往里收
  sb.paint(...C.balaclava);
  const hoff = (y, th) => 0.016 * g2(th / 0.22, (y - 1.632) / 0.022) + 0.006 * g2(th / 0.9, (y - 1.69) / 0.012) * (Math.cos(th) > 0 ? 1 : 0)
    - 0.004 * g2(th / 0.35, (y - 1.6) / 0.012);
  const ys = [];
  for (let k = 0; k < 25; k++) ys.push(1.46 + k * 0.0125);
  ys.push(1.77, 1.775);
  loftY(sb, 'soft', HEAD, 0, ys, 32, (p) => headW(p[1]), { tile: 0.15, e: 0.92, off: hoff, capTop: true });
}

export function buildArms(sb, C) {
  for (const sx of [-1, 1]) {
    const P = armProfile(sx), cx = SHOULDER[0] * sx;
    sb.paint(...C.shirt);
    const ys = [];
    for (let k = 0; k < 22; k++) ys.push(0.9 + k * 0.025);
    ys.push(1.455, 1.47, 1.478, 1.482);
    // 肘内侧的布褶、袖口的收紧
    const off = (y, th) => 0.003 * Math.sin(th * 3 + y * 70) * g2((y - 1.14) / 0.05, 0) * (0.5 + 0.5 * Math.cos(th))
      + 0.002 * g2((y - 0.92) / 0.012, 0);
    loftY(sb, 'soft', P, cx, ys, 20, (p) => armW(p, sx), { tile: 0.12, e: 0.95, off, capTop: true });
    // 上臂外侧的口袋（魔术贴面，不贴任何标识）
    sb.paint(...C.shirtDark);
    const th0 = sx > 0 ? 0.9 : -2.2;
    patch(sb, 'soft', P, cx, [th0, th0 + 1.3], [1.27, 1.37], 8, 5, (a, b) => 0.006 * pill(a, 8) * pill(b, 8), (p) => armW(p, sx), { tile: 0.2 });
    // 识别袖标：绕上臂一整圈，压在口袋外面；外侧竖着一道灯条
    sb.paint(...C.mark);
    patch(sb, 'soft', P, cx, [-Math.PI, Math.PI], [1.275, 1.405], 20, 3, (a, b) => 0.0075 * pill(b, 6), (p) => armW(p, sx), { tile: 0.2, e: 0.95 });
    sb.paint(...C.light);
    sb.rigid('hard', rb(0.007, 0.05, 0.003, 0.0012), onSurface(P, cx, 1.343, sx * Math.PI / 2, 0.006, 0.95), (p) => armW(p, sx), 0.08);
    buildHand(sb, C, sx);
  }
}

// 手套：握拳的手，中立位四指沿 -Y、掌心朝身体（右手 -X）、拇指朝 -Z。握持中心见 skeleton 的 GRIP_HOLE
const FIST = [
  [-0.124, 0.012, 0.02, 0.014, 0.004, -0.026], [-0.118, 0.026, 0.035, 0.024, 0.004, -0.026],
  [-0.105, 0.036, 0.042, 0.03, 0.004, -0.024], [-0.085, 0.033, 0.046, 0.036, 0.004, -0.017],
  [-0.06, 0.022, 0.046, 0.04, 0.003, -0.006], [-0.025, 0.021, 0.04, 0.037, 0, -0.002],
  [0, 0.024, 0.031, 0.031, 0, 0], [0.032, 0.03, 0.033, 0.033, 0, 0],
];
function buildHand(sb, C, sx) {
  const s = side(sx), hb = B['hand' + s], [hx, hy] = BONES[hb].pos;
  const P = profile(FIST.map((r) => [hy + r[0], r[1], r[2], r[3], r[4], r[5] * sx]));
  const skin = (p) => W(hb, 1 - smooth((p[1] - hy) / 0.03) * 0.7, B['foreArm' + s], smooth((p[1] - hy) / 0.03) * 0.7);
  sb.paint(...C.glove);
  const ys = [-0.124, -0.121, -0.117, -0.11, -0.1, -0.09, -0.08, -0.07, -0.055, -0.04, -0.025, -0.01, 0.005, 0.02, 0.032].map((y) => hy + y);
  // 指缝：卷起的四指前端有三道浅沟
  const off = (y, th) => -0.0025 * Math.max(0, Math.cos(th * 1)) * Math.abs(Math.sin((th + 0.2) * 5)) * smooth((hy - 0.08 - y) / 0.02);
  loftY(sb, 'soft', P, hx, ys, 18, skin, { tile: 0.08, off, capBot: true });
  const L = (x, y, z) => [hx + x * sx, hy + y, z];
  tubePath(sb, 'soft', [L(-0.006, -0.028, -0.026), L(-0.018, -0.052, -0.042), L(-0.03, -0.068, -0.046), L(-0.04, -0.078, -0.04)],
    [0.0125, 0.0115, 0.0105, 0.0095], 8, () => hb, { tile: 0.08 });
  sb.paint(...C.knuckle);
  sb.rigid('hard', rb(0.012, 0.026, 0.074, 0.005), xf(hx + 0.017 * sx, hy - 0.087, 0.004), hb, 0.06);
}

export function buildLegs(sb, C) {
  sb.paint(...C.pants);
  const hipW = (p) => {
    const ax = Math.abs(p[0]), t = smooth((0.93 - p[1]) / 0.12) * smooth((ax - 0.03) / 0.06) * 0.75;
    return W(...spineW(p[1]).map((v, i) => (i % 2 ? v * (1 - t) : v)), B['thigh' + side(p[0])], t);
  };
  loftY(sb, 'soft', HIPS, 0, [0.8, 0.82, 0.85, 0.88, 0.91, 0.94, 0.97, 1.0, 1.04], 40, hipW, { tile: 0.12, e: 0.85, capBot: true });
  for (const sx of [-1, 1]) {
    const cx = HIP[0] * sx, s = side(sx);
    sb.paint(...C.pants);
    const off = (y, th) => 0.0035 * Math.sin(th * 4 + y * 60) * g2((y - 0.5) / 0.06, 0)
      + 0.004 * g2((y - 0.235) / 0.03, 0) * (0.6 + 0.4 * Math.sin(th * 5))
      + 0.002 * Math.sin(th * 2 + y * 25) * smooth((0.9 - y) / 0.2);
    const ys = [];
    for (let y = 0.19; y < 0.92; y += 0.02) ys.push(y);
    ys.push(0.92);
    loftY(sb, 'soft', LEG, cx, ys, 24, (p) => legW(p, sx), { tile: 0.12, e: 0.92, off });
    // 大腿外侧的贴袋和袋盖
    sb.paint(...C.pantsDark);
    const ths = sx > 0 ? [0.85, 1.85] : [-1.85, -0.85];
    patch(sb, 'soft', LEG, cx, ths, [0.6, 0.76], 8, 6, (a, b) => 0.011 * pill(a, 6) * pill(b, 6) + 0.004 * smooth((b - 0.55) / 0.1) * pill(a, 10),
      (p) => legW(p, sx), { tile: 0.2 });
    buildBoot(sb, C, sx, s);
  }
}

// 靴子：鞋面沿 z 放样（截面上拱下平），鞋帮绕踝一圈，鞋底是外轮廓拉伸的厚片
const BOOT = [
  [0.088, 0, 0.085, 0.03], [0.082, 0.034, 0.112, 0.024], [0.064, 0.044, 0.138, 0.022], [0.02, 0.047, 0.15, 0.022],
  [-0.03, 0.049, 0.126, 0.022], [-0.08, 0.051, 0.096, 0.022], [-0.13, 0.051, 0.073, 0.022], [-0.17, 0.047, 0.061, 0.022],
  [-0.198, 0.038, 0.053, 0.022], [-0.212, 0.024, 0.046, 0.024], [-0.219, 0, 0.04, 0.028],
];
function buildBoot(sb, C, sx, s) {
  const cx = HIP[0] * sx, fb = B['foot' + s], tb = B['toe' + s], sh = B['shin' + s];
  const skin = (p) => {
    const t = smooth((-p[2] - 0.105) / 0.06), u = smooth((p[1] - 0.13) / 0.08);
    return W(fb, (1 - t) * (1 - u), tb, t * (1 - u), sh, u);
  };
  const inward = (z) => -0.008 * sx * smooth((-z - 0.05) / 0.15);
  sb.paint(...C.boot);
  const nu = 20;
  sb.grid('soft', nu, BOOT.length - 1, (i, j) => {
    const [z, w, top, bot] = BOOT[j], th = (i / nu) * Math.PI * 2;
    const c = Math.cos(th), sn = Math.sin(th), mid = (top + bot) / 2, hh = (top - bot) / 2;
    const p = [cx + inward(z) + w * Math.sign(c) * Math.abs(c) ** 0.6, mid + hh * Math.sign(sn) * Math.abs(sn) ** (sn > 0 ? 0.8 : 0.35), z];
    return { p, skin: skin(p) };
  }, 0.1);
  const shaft = profile([[0.1, 0.046, 0.05, 0.056, 0.012], [0.13, 0.047, 0.05, 0.058, 0.01], [0.18, 0.047, 0.048, 0.054, 0.008], [0.225, 0.049, 0.048, 0.054, 0.006], [0.236, 0.05, 0.049, 0.055, 0.006]]);
  loftY(sb, 'soft', shaft, cx, [0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.215, 0.225, 0.236], 20, skin, { tile: 0.1 });
  // 鞋带：鞋面中线上一排横条
  sb.paint(...C.lace);
  for (let k = 0; k < 6; k++) {
    const z = -0.005 - k * 0.019, row = BOOT.findIndex((r) => r[0] < z), r0 = BOOT[row - 1], r1 = BOOT[row];
    const top = lerp(r0[2], r1[2], (z - r0[0]) / (r1[0] - r0[0]));
    sb.rigid('hard', box(0.034, 0.004, 0.006), xf(cx + inward(z), top + 0.0015, z, -0.45 + k * 0.06), fb, 0.06);
  }
  // 鞋底：脚印外轮廓（后跟圆、足弓收窄、前掌宽、鞋尖圆）拉伸 2.4 cm
  sb.paint(...C.sole);
  const pts = [];
  for (let k = 0; k <= 32; k++) {
    const a = (k / 32) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    const v = 0.065 + 0.157 * sn;
    const half = v > 0.12 ? 0.054 * Math.sqrt(Math.max(0, 1 - ((v - 0.12) / 0.105) ** 2)) + 0.004 : v > 0 ? lerp(0.047, 0.056, v / 0.12) : 0.046 * Math.sqrt(Math.max(0, 1 - (v / 0.095) ** 2)) + 0.004;
    pts.push([sx * c * half + inward(-v), v]);
  }
  const sole = extrude(pts, 0.026, 0.005).rotateX(-Math.PI / 2);
  sb.rigid('hard', sole, xf(cx, 0.013, 0), (p) => skin([p[0], 0, p[2]]), 0.06);
}

export function buildBody(sb, C) {
  buildTorso(sb, C);
  buildArms(sb, C);
  buildLegs(sb, C);
}
