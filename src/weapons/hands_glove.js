import * as THREE from 'three';
import { xf } from '../gfx/geo.js';
import { lerp, clamp01, smooth, bump } from './hands_skin.js';
import { FINGERS } from './hands_poses.js';

// 贴图幅面（米）；材质键对应 gear.glove / gloveGrip / polymer
export const TILE = { glove: 0.08, grip: 0.06, polymer: 0.06, sleeve: 0.3 };

const Z_BACK = 0.016, EXP = 0.77;
// 指根线：手掌前缘沿它收口，掌指关节在它后面 11 mm
const zFront = (x) => -0.1035 + 9.1 * (x + 0.004) ** 2;
const g2 = (a, b) => Math.exp(-(a * a + b * b));

// 手掌是一段放样：v = 0 腕后，v = 1 指根；截面是上下不等厚的超椭圆
function section(v) {
  const t = smooth((v - 0.12) / 0.7);
  const kb = Math.max(0, 1 - v / 0.134), kf = Math.max(0, (v - 0.9) / 0.1);
  const capY = Math.sqrt(Math.max(0, 1 - kb * kb) * Math.max(0, 1 - kf * kf));
  const capX = Math.sqrt(1 - 0.85 * kb * kb) * (1 - 0.05 * kf * kf);
  return { a: lerp(0.0288, 0.042, t) * capX, cx: lerp(0, 0.0027, t), top: lerp(0.0175, 0.0125, t) * capY, bot: lerp(0.0195, 0.0125, t) * capY };
}

// 掌侧的鱼际、小鱼际和掌心凹陷
const pads = (x, z) => 0.0075 * g2((x + 0.02) / 0.015, (z + 0.034) / 0.026)
  + 0.0035 * g2((x - 0.027) / 0.012, (z + 0.038) / 0.03) - 0.002 * g2((x - 0.002) / 0.014, (z + 0.058) / 0.02);

function palmPoint(v, th) {
  const s = section(v), cs = Math.cos(th), sn = Math.sin(th);
  const x = s.cx + s.a * Math.sign(cs) * Math.abs(cs) ** EXP;
  const z = Z_BACK + v * (zFront(x) - Z_BACK);
  let y = (sn > 0 ? s.top : -s.bot) * Math.abs(sn) ** EXP;
  if (sn < 0) y -= (-sn) ** 0.6 * pads(x, z) * Math.min(1, s.bot / 0.0125);
  return [x, y, z];
}

function surfaceY(x, z, bottom) {
  const s = section((Z_BACK - z) / (Z_BACK - zFront(x)));
  const q = Math.min(1, Math.abs(x - s.cx) / s.a), sn = Math.sqrt(Math.max(0, 1 - q ** (2 / EXP)));
  if (!bottom) return s.top * sn ** EXP;
  return -s.bot * sn ** EXP - sn ** 0.6 * pads(x, z) * Math.min(1, s.bot / 0.0125);
}
export const palmTopY = (x, z) => surfaceY(x, z, false);
export const palmBottomY = (x, z) => surfaceY(x, z, true);

function palm(sg) {
  const rows = [];
  for (let k = 0; k < 6; k++) rows.push(0.134 * (1 - Math.cos((k / 6) * Math.PI / 2)));
  for (let k = 0; k < 22; k++) rows.push(lerp(0.134, 0.9, k / 22));
  for (let k = 0; k <= 6; k++) rows.push(0.9 + 0.1 * Math.sin((k / 6) * Math.PI / 2));
  const cut = 0.42;
  const patch = (mat, a, b, nu) => sg.grid(mat, nu, rows.length - 1, (i, j) => (
    { p: palmPoint(rows[j], a + (b - a) * i / nu), skin: [0, 1] }), TILE[mat]);
  patch('glove', -cut, Math.PI + cut, 24);
  patch('grip', Math.PI + cut, 2 * Math.PI - cut, 14);
}

// 贴在底面上的鼓包（护甲、防撞条）：fn(a, b) → { p, n, h }，a、b ∈ [−1, 1]，边缘埋进底面
function pillow(sg, mat, nu, nv, bone, fn) {
  sg.grid(mat, nu, nv, (i, j) => {
    const q = fn((i / nu) * 2 - 1, (j / nv) * 2 - 1), h = q.h - 0.0004;
    return { p: [q.p[0] + q.n[0] * h, q.p[1] + q.n[1] * h, q.p[2] + q.n[2] * h], skin: [bone, 1] };
  }, TILE[mat]);
}

const _v = new THREE.Vector3();

// 一根手指 = 沿 −Z 的管子，从掌内 base 处伸到指尖；bi = [手掌, 近节, 中节, 远节] 的骨索引
function finger(sg, F, bi, thumb) {
  const [l0, l1, l2] = F.len, [R0, R1, R2, R3] = F.rad;
  const j1 = l0, j2 = l0 + l1, L = j2 + l2, cap = R3 * 1.3, base = thumb ? 0.01 : 0.014;
  const M = xf(F.mcp[0], F.mcp[1], F.mcp[2], F.rest[0], F.rest[1], F.rest[2]);
  const rad = (s) => (s <= 0 ? R0 : s < j1 ? lerp(R0, R1, s / l0) : s < j2 ? lerp(R1, R2, (s - j1) / l1) : lerp(R2, R3, clamp01((s - j2) / (l2 - cap))));
  // 关节附近行距加密，弯折和布褶才有足够的顶点
  const rows = [];
  for (let s = -base; s < L - cap - 5e-4;) {
    rows.push(s);
    s += Math.min(Math.abs(s - j1), Math.abs(s - j2)) < 0.007 ? 0.0012 : 0.0026;
  }
  for (let k = 0; k <= 6; k++) rows.push(L - cap * (1 - Math.sin((k / 6) * Math.PI / 2)));

  const local = (s, th) => {
    const k = s > L - cap ? Math.sqrt(Math.max(0, 1 - ((s - L + cap) / cap) ** 2)) : 1;
    const r = rad(s) * k, sn = Math.sin(th);
    const [s0, len] = s < j1 ? [0, l0] : s < j2 ? [j1, l1] : [j2, l2];
    const fat = thumb ? 1 - clamp01(s / l0) : 0;
    const pad = s > 0 ? 0.1 * Math.sin(Math.PI * clamp01((s - s0) / len)) ** 1.5 : 0;
    const crease = 0.09 * (bump(s - j1, 0.0028) + bump(s - j2, 0.0026));
    const knuckle = 0.09 * bump(s - j1, 0.0065) + 0.06 * bump(s - j2, 0.005) + 0.03 * Math.sin((s - j1) * 1400) * bump(s - j1, 0.006);
    // 拇指：根部并进鱼际所以更肥，远节比四指更扁更宽
    const w = r * (1 + 0.05 * bump(s - j1, 0.006) + 0.03 * bump(s - j2, 0.005) + 0.1 * fat + (thumb && s > j2 ? 0.08 : 0));
    const h = sn >= 0 ? r * (s > j2 ? 0.86 : 0.93) * (1 + knuckle) : r * 0.97 * (1 + pad - crease + 0.25 * fat);
    return [w * Math.cos(th), h * sn, -s];
  };
  const world = (q) => { _v.set(q[0], q[1], q[2]).applyMatrix4(M); return [_v.x, _v.y, _v.z]; };
  // 背侧过渡宽（关节外侧圆滑），掌侧过渡窄（指节褶子利落）
  const skin = (s, th) => {
    const dors = 0.5 + 0.5 * Math.sin(th);
    const t = (sj, r) => { const bw = r * (0.4 + 0.5 * dors); return smooth((s - sj + bw) / (2 * bw)); };
    const t0 = t(0, R0), t1 = t(j1, R1), t2 = t(j2, R2);
    return [bi[0], 1 - t0, bi[1], t0 * (1 - t1), bi[2], t1 * (1 - t2), bi[3], t2];
  };
  const patch = (mat, a, b, nu) => sg.grid(mat, nu, rows.length - 1, (i, j) => {
    const th = a + (b - a) * i / nu;
    return { p: world(local(rows[j], th)), skin: skin(rows[j], th) };
  }, TILE[mat]);
  const cut = 0.7;
  patch('glove', -cut, Math.PI + cut, 11);
  patch('grip', Math.PI + cut, 2 * Math.PI - cut, 5);

  // 指背防撞条
  const rib = (sc, len, bone) => pillow(sg, 'grip', 8, 4, bone, (a, b) => {
    const q = local(sc + b * len / 2, Math.PI / 2 + a * 0.95), l = Math.hypot(q[0], q[1]);
    _v.set(q[0] / l, q[1] / l, 0).transformDirection(M);
    return { p: world(q), n: [_v.x, _v.y, _v.z], h: 0.0022 * Math.sqrt(Math.max(0, 1 - a ** 6) * Math.max(0, 1 - b ** 4)) };
  });
  if (thumb) {
    rib(j1 + 0.5 * l1, 0.012, bi[2]);
  } else {
    for (const k of [0.36, 0.56, 0.76]) rib(k * l0, 0.0052, bi[1]);
    for (const k of [0.36, 0.66]) rib(j1 + k * l1, Math.min(0.0048, 0.22 * l1), bi[2]);
  }
}

// 虎口：一片蹼，一边跟拇指掌骨、一边跟手掌，拇指张开时被拉开，补上拇指根和掌缘之间的缝
function web(sg) {
  const F = FINGERS[0], M = xf(F.mcp[0], F.mcp[1], F.mcp[2], F.rest[0], F.rest[1], F.rest[2]);
  const B0 = [-0.024, -0.004, -0.03], B1 = [-0.0345, -0.003, -0.08], rows = 12;
  const d = new THREE.Vector3(0, 0, -1).transformDirection(M);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const patch = (mat, a0) => sg.grid(mat, 8, rows, (i, j) => {
    const t = j / rows, th = a0 + Math.PI * i / 8, s = lerp(0.006, F.len[0], t);
    A.set(0, 0, -s).applyMatrix4(M);
    B.set(lerp(B0[0], B1[0], t), lerp(B0[1], B1[1], t), lerp(B0[2], B1[2], t));
    e1.subVectors(B, A);
    const half = e1.length() / 2 + 0.003;
    e2.crossVectors(e1.normalize(), d).normalize();
    const thick = lerp(0.0095, 0.005, t) * Math.sqrt(Math.max(0, 1 - Math.max(0, (t - 0.8) / 0.2) ** 2));
    const c = Math.cos(th), k = (1 - smooth(0.5 + 0.5 * c)) * smooth((s + 0.009) / 0.018);
    A.add(B).multiplyScalar(0.5).addScaledVector(e1, half * c).addScaledVector(e2, thick * Math.sin(th));
    return { p: [A.x, A.y, A.z], skin: [0, 1 - k, 1, k] };
  }, TILE[mat]);
  patch('glove', 0);
  patch('grip', Math.PI);
}

// 指关节护甲：一整块模压件，四个关节上各鼓一个包
function guard(sg) {
  pillow(sg, 'polymer', 44, 10, 0, (a, b) => {
    const x = 0.003 - a * 0.0405, z = zFront(x) + 0.016 - b * 0.0105;
    let h = 0.0013;
    for (let f = 1; f < 5; f++) {
      const m = FINGERS[f].mcp;
      h += 0.004 * Math.exp(-((((x - m[0]) / 0.0078) ** 2 + ((z - m[2] - 0.004) / 0.0092) ** 2) ** 1.5));
    }
    return { p: [x, palmTopY(x, z), z], n: [0, 1, 0], h: h * Math.sqrt(Math.max(0, 1 - a ** 8) * Math.max(0, 1 - b ** 6)) };
  });
  // 手背上的橡胶标牌
  pillow(sg, 'grip', 14, 8, 0, (a, b) => {
    const x = 0.005 - a * 0.014, z = -0.036 - b * 0.009;
    return { p: [x, palmTopY(x, z), z], n: [0, 1, 0], h: (0.0013 + 0.0004 * Math.cos(a * 9.4)) * Math.sqrt(Math.max(0, 1 - a ** 8) * Math.max(0, 1 - b ** 8)) };
  });
}

export function buildGlove(sg) {
  palm(sg);
  FINGERS.forEach((F, f) => finger(sg, F, [0, 1 + f * 3, 2 + f * 3, 3 + f * 3], f === 0));
  web(sg);
  guard(sg);
}
