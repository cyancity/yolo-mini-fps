import * as THREE from 'three';
import { xf, rbox, cyl } from '../gfx/geo.js';
import { B, WEAPON_BIND } from './soldier_skeleton.js';
import { smooth, lerp, patch, tubePath, strap, onSurface, pill, W } from './soldier_skin.js';
import { TORSO, HIPS, LEG, torsoW, spineW } from './soldier_body.js';
import { GUN } from './soldier_gun.js';

// 小圆角盒只用一段圆角：三角形省到三分之一
const rb = (w, h, d, r) => rbox(w, h, d, r, 1);

// 身上的装备：防弹插板背心（前后板、腰封、肩带）、弹匣包、通讯、腰带、护膝、背包、枪背带，以及敌方识别板和灯条。

const tw = (p) => torsoW(p);
const at = (m, x, y, z) => m.clone().multiply(xf(x, y, z));

function carrier(sb, C) {
  // 前后两块板是识别色（码头上的反光背心那种橙色），腰封、肩带和挂在板上的包还是深色
  sb.paint(...C.plate);
  // 前板：上角有肩部切角；插板是平的，所以胸口上方往外垫起来
  patch(sb, 'soft', TORSO, 0, [-0.95, 0.95], [1.1, 1.445], 22, 14, (a, b, y, th) => {
    const cut = 1 - smooth((Math.abs(a) + b - 1.12) / 0.12);
    return (0.028 + 0.038 * smooth((y - 1.35) / 0.1) * Math.cos(th)) * pill(a, 8) * pill(b, 8) * cut;
  }, tw, { tile: 0.2 });
  patch(sb, 'soft', TORSO, 0, [Math.PI - 0.95, Math.PI + 0.95], [1.08, 1.46], 22, 14, (a, b, y) => {
    const cut = 1 - smooth((Math.abs(a) + b - 1.18) / 0.12);
    return (0.026 + 0.03 * smooth((y - 1.36) / 0.1)) * pill(a, 8) * pill(b, 8) * cut;
  }, tw, { tile: 0.2 });
  // 腰封：两侧各一片，上面三排织带
  sb.paint(...C.vest);
  for (const s of [-1, 1]) {
    const ths = s > 0 ? [0.82, 2.32] : [-2.32, -0.82];
    patch(sb, 'soft', TORSO, 0, ths, [1.08, 1.31], 18, 12, (a, b) => {
      const web = smooth((Math.cos(b * Math.PI * 3) - 0.2) / 0.3) * 0.0025;
      return (0.015 + web) * pill(a, 10) * pill(b, 10);
    }, tw, { tile: 0.2 });
  }
  // 肩带：压过肩头，前后接到两块板的上沿
  for (const s of [-1, 1]) {
    const pts = [], nrm = [];
    for (let k = 0; k <= 10; k++) {
      const f = lerp(-1.42, 1.38, k / 10), x = s * (0.1 + 0.01 * Math.sin(f));
      pts.push([x, 1.432 + 0.072 * Math.cos(f), 0.012 + 0.108 * Math.sin(f)]);
      nrm.push([0, Math.cos(f), Math.sin(f)]);
    }
    strap(sb, 'soft', pts, nrm, 0.055, 0.012, tw, { tile: 0.2 });
  }
}

function pouches(sb, C) {
  // 三联弹匣包：沿胸前弧面摆开，露出弹匣底座和拉环
  for (const [x, yaw] of [[-0.079, 0.32], [0, 0], [0.079, -0.32]]) {
    const m = xf(x, 1.19, -0.15 + Math.abs(x) * 0.28, 0, yaw, 0);
    sb.paint(...C.pouch);
    sb.rigid('soft', rb(0.072, 0.115, 0.044, 0.009), m, tw, 0.2);
    sb.rigid('soft', rb(0.074, 0.02, 0.046, 0.006), at(m, 0, 0.05, 0), tw, 0.2);
    sb.paint(...C.mag);
    sb.rigid('hard', rb(0.062, 0.028, 0.026, 0.004), at(m, 0, 0.066, 0.002), tw, 0.06);
    sb.paint(...C.strap);
    sb.rigid('soft', rb(0.012, 0.03, 0.006, 0.002), at(m, 0, 0.074, -0.018), tw, 0.1);
  }
  // 胸口的文件包（上面贴识别板，见 marks）和左胸的通话按键
  sb.paint(...C.pouch);
  sb.rigid('soft', rb(0.16, 0.072, 0.024, 0.008), xf(0, 1.355, -0.158), tw, 0.2);
  sb.paint(...C.radio);
  sb.rigid('hard', rb(0.036, 0.048, 0.018, 0.006), xf(-0.105, 1.41, -0.135, 0.3, 0.25, 0), tw, 0.06);
  // 左后侧的电台和天线，右侧的杂物包
  const rm = onSurface(TORSO, 0, 1.21, -2.15, 0.038);
  sb.paint(...C.pouch);
  sb.rigid('soft', rb(0.07, 0.14, 0.046, 0.01), rm, tw, 0.2);
  sb.paint(...C.radio);
  sb.rigid('hard', rb(0.058, 0.04, 0.036, 0.006), at(rm, 0, 0.085, 0), tw, 0.06);
  sb.rigid('hard', cyl(0.008, 0.008, 0.02, 10), at(rm, 0.016, 0.115, 0), tw, 0.06);
  const base = new THREE.Vector3(0.016, 0.125, 0).applyMatrix4(rm);
  tubePath(sb, 'hard', [[base.x, base.y, base.z], [base.x + 0.002, base.y + 0.12, base.z + 0.01], [base.x + 0.004, base.y + 0.26, base.z + 0.025]],
    [0.004, 0.003, 0.002], 5, tw);
  // 通话线：从按键绕过左肩接到耳罩
  sb.paint(...C.radio);
  tubePath(sb, 'hard', [[-0.105, 1.432, -0.128], [-0.118, 1.49, -0.07], [-0.11, 1.535, -0.01], [-0.098, 1.585, 0.01], [-0.095, 1.615, 0.012]],
    0.0035, 5, (p) => W(...spineW(p[1]), B.head, smooth((p[1] - 1.55) / 0.05)));
  const gm = onSurface(TORSO, 0, 1.2, 2.0, 0.04);
  sb.paint(...C.pouch);
  sb.rigid('soft', rb(0.1, 0.1, 0.05, 0.012), gm, tw, 0.2);
}

function belt(sb, C) {
  sb.paint(...C.webbing);
  const hw = (p) => W(...spineW(p[1]));
  patch(sb, 'soft', HIPS, 0, [-Math.PI, Math.PI], [0.945, 1.005], 44, 3, (a, b) => 0.013 * pill(b, 8), hw, { tile: 0.2 });
  sb.paint(...C.rail);
  sb.rigid('hard', rb(0.062, 0.044, 0.012, 0.004), xf(0, 0.975, -0.116), B.pelvis, 0.06);
  sb.paint(...C.pouch);
  for (const [th, w, h, d] of [[1.85, 0.08, 0.09, 0.045], [-1.9, 0.09, 0.085, 0.05], [2.6, 0.12, 0.1, 0.05]]) {
    sb.rigid('soft', rb(w, h, d, 0.012), onSurface(HIPS, 0, 0.955, th, 0.012 + d / 2), B.pelvis, 0.2);
  }
}

function kneePads(sb, C) {
  for (const s of [-1, 1]) {
    const side = s > 0 ? 'R' : 'L', cx = 0.095 * s;
    const kw = (p) => W(B['knee' + side], 0.85, p[1] > 0.51 ? B['thigh' + side] : B['shin' + side], 0.15);
    sb.paint(...C.kneepad);
    patch(sb, 'hard', LEG, cx, [-1.0, 1.0], [0.44, 0.585], 12, 8, (a, b) => 0.018 * pill(a, 4) * pill(b, 4) + 0.004 * pill(a, 12) * pill(b, 12), kw, { tile: 0.08 });
    sb.paint(...C.strap);
    for (const y of [0.425, 0.6]) patch(sb, 'soft', LEG, cx, [-Math.PI, Math.PI], [y - 0.01, y + 0.01], 20, 1, () => 0.004, kw, { tile: 0.1 });
  }
}

function backpack(sb, C) {
  const bw = (p) => W(B.spine2, smooth((p[1] - 1.1) / 0.15), B.spine1, 1 - smooth((p[1] - 1.1) / 0.15));
  sb.paint(...C.pack);
  sb.rigid('soft', rb(0.25, 0.3, 0.11, 0.035), xf(0, 1.265, 0.19), bw, 0.2);
  sb.rigid('soft', rb(0.23, 0.07, 0.12, 0.03), xf(0, 1.43, 0.185, -0.12), bw, 0.2);
  sb.rigid('soft', rb(0.17, 0.14, 0.04, 0.02), xf(0, 1.21, 0.258), bw, 0.2);
  sb.paint(...C.webbing);
  for (const s of [-1, 1]) {
    sb.rigid('soft', rb(0.006, 0.02, 0.118, 0.002), xf(s * 0.126, 1.2, 0.19), bw, 0.1);
    sb.rigid('soft', rb(0.006, 0.02, 0.118, 0.002), xf(s * 0.126, 1.32, 0.19), bw, 0.1);
  }
  // 包面上的识别板和灯条（后背那块被包挡住了）
  sb.paint(...C.mark);
  sb.rigid('soft', rb(0.15, 0.06, 0.006, 0.002), xf(0, 1.352, 0.2465), bw, 0.2);
  sb.paint(...C.light);
  sb.rigid('hard', rb(LIGHT_W, 0.008, 0.003, 0.0012), xf(0, 1.352, 0.2508), bw, 0.08);
}

// 敌方识别：胸前文件包上一块橙色板带一道灯条，肩带前后各一道小灯，后背一道灯条。正面、背面、俯视都认得出。
// 前后插板本身的橙色在 carrier，上臂的袖标在 soldier_body.js，头上的识别带在 soldier_head.js
const LIGHT_W = 0.085;
function marks(sb, C, variant) {
  sb.paint(...C.markHard);
  sb.rigid('hard', rb(0.13, 0.05, 0.004, 0.002), xf(0, 1.357, -0.171), tw, 0.08);
  sb.paint(...C.light);
  sb.rigid('hard', rb(LIGHT_W, 0.008, 0.003, 0.0012), xf(0, 1.357, -0.1738), tw, 0.08);
  // 肩带：灯条顺着带子的坡度贴，f 和 carrier 里肩带的参数是同一个
  for (const s of [-1, 1]) for (const f of [-0.62, 0.62]) {
    const up = Math.cos(f), back = Math.sin(f), x = s * (0.1 + 0.01 * back);
    sb.rigid('hard', rb(0.036, 0.004, 0.013, 0.0015), xf(x, 1.432 + 0.086 * up, 0.012 + 0.122 * back, f), tw, 0.08);
  }
  // 后背：灯条贴在后板上（板在这个高度鼓出 2.3 厘米），短一点让开枪背带；有背包的灯条在包上
  if (!variant.pack) sb.rigid('hard', rb(0.07, 0.008, 0.003, 0.0012), onSurface(TORSO, 0, 1.33, Math.PI, 0.0245), tw, 0.08);
}

// 两点式背带：前挂点 → 左肩 → 斜过后背 → 右腋下 → 后挂点。挂点附近跟枪走，背上那段跟躯干走
function sling(sb, C) {
  const wb = WEAPON_BIND, F = GUN.frontMount, R = GUN.rearMount;
  const key = [
    [wb[0] + F[0] - 0.004, wb[1] + F[1], wb[2] + F[2], 1], [-0.02, 1.47, -0.52, 0.8], [-0.1, 1.49, -0.22, 0.35],
    [-0.112, 1.522, 0.0, 0], [-0.06, 1.47, 0.128, 0], [0.06, 1.33, 0.14, 0], [0.165, 1.24, 0.11, 0],
    [0.198, 1.23, 0.0, 0], [0.16, 1.33, -0.1, 0.4], [wb[0] + R[0] - 0.004, wb[1] + R[1], wb[2] + R[2], 1],
  ];
  const pts = [], nrm = [], wts = [];
  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  for (let i = 0; i < key.length - 1; i++) {
    const k0 = key[Math.max(0, i - 1)], k1 = key[i], k2 = key[i + 1], k3 = key[Math.min(key.length - 1, i + 2)];
    for (let s = 0; s < 6; s++) {
      const t = s / 6, p = [0, 1, 2].map((m) => cr(k0[m], k1[m], k2[m], k3[m], t));
      pts.push(p);
      wts.push(lerp(k1[3], k2[3], t));
    }
  }
  const last = key[key.length - 1];
  pts.push(last.slice(0, 3));
  wts.push(1);
  for (const p of pts) {
    const h = Math.hypot(p[0], p[2] - 0.01) || 1;
    nrm.push([p[0] / h, 0.6, (p[2] - 0.01) / h]);
  }
  const weightAt = (p) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = (pts[i][0] - p[0]) ** 2 + (pts[i][1] - p[1]) ** 2 + (pts[i][2] - p[2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return wts[best];
  };
  sb.paint(...C.strap);
  strap(sb, 'soft', pts, nrm, 0.03, 0.003, (p) => {
    const g = weightAt(p), body = torsoW(p);
    for (let i = 1; i < body.length; i += 2) body[i] *= 1 - g;
    return W(...body, B.weapon, g);
  }, { tile: 0.1 });
}

export function buildGear(sb, C, variant) {
  carrier(sb, C);
  pouches(sb, C);
  belt(sb, C);
  kneePads(sb, C);
  if (variant.pack) backpack(sb, C);
  marks(sb, C, variant);
  sling(sb, C);
}
