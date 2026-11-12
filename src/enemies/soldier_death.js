import * as THREE from 'three';
import { B, BONE_COUNT, PARENT, toBone } from './soldier_skeleton.js';
import { GUN } from './soldier_gun.js';
import { Pose, euler } from './soldier_pose.js';
import { VOLUMES, TORSO_VOLUMES, LIMB_CHAINS } from './soldier_hit.js';

// 死亡动画：关键帧是一组关节参数（骨盆位置和朝向、脊柱、颈、四肢各关节角），帧间缓动插值。
// 头 0.22 s 从活着时的姿势过渡进来；py 写 NaN 的帧在开始时自动算高度（最低点贴地）。
// 最后一帧再逐条肢体绕根关节转到刚好贴地，所以躺下后不陷进地面也不悬空。枪在开始时脱手，抛到身体旁边侧躺。

// 参数下标：0-2 骨盆 xyz，3-5 骨盆 yaw/pitch/roll，6-8 脊柱 pitch/yaw/roll，9-11 颈 pitch/yaw/roll，
// 12-15 右臂 [前屈, 外展, 内旋, 屈肘]，16-19 左臂，20-24 右腿 [前屈, 外展, 内旋, 屈膝, 勾脚]，25-29 左腿
const N = 30;
const STAND = { py: NaN, pitch: -0.04, sp: -0.06, aR: [0.55, 0.35, 0.3, 1.7], aL: [1.1, -0.2, 0, 0.9], lR: [0.1, 0.05, 0, 0.18, NaN], lL: [0.12, 0.05, 0, 0.2, NaN] };
function key(t, o) {
  const a = new Float32Array(N);
  const v = { ...STAND, ...o };
  [v.px, v.py, v.pz, v.yaw, v.pitch, v.roll, v.sp, v.sy, v.sr, v.np, v.ny, v.nr].forEach((x, i) => { a[i] = x ?? 0; });
  a.set(v.aR, 12); a.set(v.aL, 16); a.set(v.lR, 20); a.set(v.lL, 25);
  return { t, a };
}
const AUTO = NaN;

const KINDS = {
  // 正面中弹：上身后甩，膝盖一软，仰面倒下
  back: { dur: 1.1, keys: [
    key(0, {}),
    key(0.16, { py: AUTO, pz: 0.06, pitch: 0.12, sp: 0.35, np: 0.35, nr: 0.1, aR: [0.9, 0.6, 0.2, 0.9], aL: [1.0, 0.5, 0, 0.6], lR: [0.2, 0.08, 0, 0.35, AUTO], lL: [0.15, 0.1, 0, 0.3, AUTO] }),
    key(0.42, { py: AUTO, pz: 0.28, pitch: 0.75, sp: 0.2, np: 0.2, aR: [1.6, 0.9, 0.3, 0.5], aL: [1.7, 0.8, 0, 0.4], lR: [0.75, 0.1, 0, 1.1, 0.2], lL: [0.6, 0.15, 0, 0.9, 0.3] }),
    key(0.7, { py: AUTO, pz: 0.52, pitch: 1.5, sp: 0.08, np: -0.1, aR: [1.2, 1.2, 0, 0.5], aL: [1.1, 1.1, 0.2, 0.6], lR: [0.6, 0.12, 0, 0.8, 0.3], lL: [0.5, 0.18, 0, 0.7, 0.2] }),
    key(0.84, { py: AUTO, pz: 0.56, pitch: 1.57, sp: -0.02, np: 0.25, ny: 0.3, aR: [0.6, 0.95, 0, 0.4], aL: [0.5, 0.75, 0.3, 0.8], lR: [0.3, 0.14, 0.1, 0.35, 0.1], lL: [0.35, 0.12, -0.1, 0.6, 0.2] }),
    key(1, { py: AUTO, pz: 0.58, pitch: 1.57, sp: 0, np: 0.15, ny: 0.55, nr: 0.15, aR: [0.25, 0.6, 0, 0.35], aL: [0.15, 0.42, 0.3, 0.85], lR: [0, 0.15, 0.15, 0.12, 0.1], lL: [0.25, 0.1, -0.15, 0.5, 0.25] }),
  ] },
  // 软倒：先跪下，再往前扑倒，脸侧着贴地
  forward: { dur: 1.27, keys: [
    key(0, {}),
    key(0.14, { py: AUTO, pz: -0.02, pitch: -0.12, sp: -0.25, np: -0.35, aR: [0.4, 0.15, 0.2, 1.0], aL: [0.7, 0, 0, 0.6], lR: [0.35, 0.05, 0, 0.6, AUTO], lL: [0.3, 0.05, 0, 0.55, AUTO] }),
    key(0.4, { py: AUTO, pz: -0.04, pitch: -0.15, sp: -0.35, np: -0.3, aR: [0.2, 0.2, 0, 0.5], aL: [0.3, 0.15, 0, 0.4], lR: [0.05, 0.05, 0, 1.55, -0.5], lL: [0.1, 0.08, 0, 1.6, -0.5] }),
    key(0.68, { py: AUTO, pz: -0.15, pitch: -0.85, sp: -0.3, np: 0.2, aR: [0.6, 0.35, 0, 0.3], aL: [0.8, 0.3, 0, 0.4], lR: [-0.15, 0.06, 0, 1.2, -0.6], lL: [-0.1, 0.1, 0, 1.3, -0.5] }),
    key(0.86, { py: AUTO, pz: -0.38, pitch: -1.5, sp: -0.05, np: 0.35, ny: 0.5, aR: [0.25, 0.5, -0.5, 0.4], aL: [0.2, 0.9, 0, 0.5], lR: [-0.12, 0.08, 0, 0.5, -0.7], lL: [0.1, 0.25, 0.1, 0.8, -0.5] }),
    key(1, { py: AUTO, pz: -0.42, pitch: -1.57, sp: 0.05, np: 0.3, ny: 1.15, aR: [0.1, 0.3, -1.0, 0.3], aL: [-0.05, 0.6, 0, 0.35], lR: [-0.05, 0.08, 0.05, 0.2, -0.7], lL: [0.35, 0.45, 0.2, 0.9, -0.4] }),
  ] },
  // 侧面中弹：被打得原地拧转，侧身摔倒再翻成半趴
  spin: { dur: 1.2, keys: [
    key(0, {}),
    key(0.18, { py: AUTO, yaw: 0.45, sy: 0.5, roll: 0.08, sp: -0.1, aR: [1.2, 0.9, 0, 0.6], aL: [0.6, 0.3, 0, 0.6], lR: [0.15, 0.05, 0.2, 0.35, AUTO], lL: [0.2, 0.05, 0, 0.3, AUTO] }),
    key(0.45, { py: AUTO, px: -0.12, yaw: 1.2, sy: 0.4, roll: 0.35, pitch: -0.15, sp: -0.2, aR: [1.6, 1.2, 0, 0.4], aL: [0.3, 0.6, 0, 0.7], lR: [0.5, 0.2, 0.2, 0.9, 0], lL: [0.3, -0.15, 0, 0.8, AUTO] }),
    key(0.72, { py: AUTO, px: -0.3, pz: 0.05, yaw: 1.85, roll: 0.9, pitch: -0.6, sp: -0.15, aR: [1.4, 1.0, 0, 0.5], aL: [0.4, 0.9, 0.3, 0.9], lR: [0.6, 0.15, 0.2, 0.9, 0], lL: [0.3, 0.1, 0, 0.6, 0] }),
    key(0.86, { py: AUTO, px: -0.36, pz: 0.08, yaw: 2.15, roll: 0.45, pitch: -1.35, sp: 0.05, np: 0.2, ny: 0.6, aR: [0.2, 0.9, 0.2, 0.5], aL: [0.1, 0.5, 0, 0.4], lR: [0.5, 0.2, 0.2, 0.8, -0.4], lL: [0.1, 0.1, 0, 0.3, -0.5] }),
    key(1, { py: AUTO, px: -0.38, pz: 0.1, yaw: 2.3, roll: 0.35, pitch: -1.5, sp: 0.05, np: 0.25, ny: 0.9, aR: [-0.1, 0.6, 0.3, 0.5], aL: [0.1, 0.38, 0, 0.3], lR: [0.55, 0.3, 0.25, 1.0, -0.4], lL: [0, 0.1, 0, 0.15, -0.6] }),
  ] },
  // 身后没地方倒（贴着墙、背后是月台边）：腿一软坐下去，背靠着墙，头垂到胸前。
  // 朝向和骨盆位移在开始时按墙的方向和距离改写（soldier_fall.js），这里写的是背朝 +z、不位移的样子
  slump: { dur: 1.0, keys: [
    key(0, {}),
    key(0.2, { py: AUTO, pitch: 0.05, sp: -0.2, np: -0.2, aR: [0.5, 0.3, 0.2, 1.0], aL: [0.7, 0.1, 0, 0.7], lR: [0.5, 0.05, 0, 0.9, AUTO], lL: [0.45, 0.08, 0, 0.85, AUTO] }),
    key(0.5, { py: AUTO, pitch: 0.3, sp: -0.25, np: -0.3, aR: [0.3, 0.35, 0, 0.6], aL: [0.4, 0.3, 0, 0.6], lR: [1.3, 0.1, 0, 1.6, 0], lL: [1.2, 0.12, 0, 1.5, 0] }),
    key(0.8, { py: AUTO, pitch: 0.65, sp: -0.3, np: -0.45, nr: 0.2, aR: [0.15, 0.4, 0, 0.4], aL: [0.2, 0.45, 0.1, 0.5], lR: [1.15, 0.12, 0.05, 0.7, 0.1], lL: [1.05, 0.15, -0.05, 0.9, 0.15] }),
    key(1, { py: AUTO, pitch: 0.72, sp: -0.3, np: -0.6, ny: 0.35, nr: 0.3, aR: [0.05, 0.45, 0, 0.3], aL: [0.1, 0.55, 0.2, 0.45], lR: [1.05, 0.14, 0.1, 0.35, 0.1], lL: [0.95, 0.18, -0.1, 0.7, 0.2] }),
  ] },
};
// 中弹时按方向挑的三种；slump 只在三种都倒不下时用
export const DEATHS = ['back', 'forward', 'spin'];
export const LAST = (kind) => KINDS[kind].keys.length - 1;

// 某种死法最后一帧的参数（含镜像），写进 out
export function finalParams(kind, flip, out) {
  const k = KINDS[kind].keys, a = k[k.length - 1].a;
  return flip ? mirror(a, out) : out.set(a);
}

// 镜像：左右肢体互换，横向位置和绕竖轴、前后轴的角取反
function mirror(a, out) {
  out.set(a);
  for (const i of [0, 3, 5, 7, 8, 10, 11]) out[i] = -a[i];
  out.set(a.subarray(16, 20), 12); out.set(a.subarray(12, 16), 16);
  out.set(a.subarray(25, 30), 20); out.set(a.subarray(20, 25), 25);
  return out;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _ax = new THREE.Vector3(), _c = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const scratch = new Pose();
// 骨索引和肢体链预先查好：每帧不拼字符串、不建数组
const SIDE = [['R', 1, 12, 20], ['L', -1, 16, 25]].map(([s, sx, o, l]) => ({
  sx, o, l, clav: B['clav' + s], ua: B['upperArm' + s], fa: B['foreArm' + s], el: B['elbow' + s], hand: B['hand' + s],
  th: B['thigh' + s], sh: B['shin' + s], kn: B['knee' + s], ft: B['foot' + s], toe: B['toe' + s],
}));
const CHAINS = Object.values(LIMB_CHAINS);

// 不算命中体、只管贴地的几块（绑定姿势的模型坐标）：腰后右侧的杂物包（每个变体都有），背包（带背包的变体）。
// 命中体只包住身体，背包和腰包比它鼓出 5 到 12 cm，不算进来就会陷进地里
const touch = (bone, a, b, r) => ({ bone, r, a: toBone(bone, ...a), b: toBone(bone, ...b) });
const BELT = [touch(B.pelvis, [0.07, 0.955, 0.146], [0.126, 0.955, 0.124], 0.03)];
const BAG = [
  touch(B.spine2, [-0.085, 1.155, 0.205], [-0.085, 1.375, 0.205], 0.04),
  touch(B.spine2, [0.085, 1.155, 0.205], [0.085, 1.375, 0.205], 0.04),
  touch(B.spine2, [-0.065, 1.16, 0.258], [-0.065, 1.26, 0.258], 0.02),
  touch(B.spine2, [0.065, 1.16, 0.258], [0.065, 1.26, 0.258], 0.02),
];
const PACK = [...BELT, ...BAG];

// 参数 → 各骨的 local（不含枪骨）
export function applyParams(pose, a) {
  pose.pelvisPos.set(a[0], a[1], a[2]);
  euler(pose.local[B.pelvis], a[4], a[3], a[5]);
  euler(pose.local[B.spine1], a[6] * 0.5, a[7] * 0.5, a[8] * 0.5);
  euler(pose.local[B.spine2], a[6] * 0.5, a[7] * 0.5, a[8] * 0.5);
  euler(pose.local[B.neck], a[9] * 0.4, a[10] * 0.4, a[11] * 0.4);
  euler(pose.local[B.head], a[9] * 0.6, a[10] * 0.6, a[11] * 0.6);
  pose.local[B.led].identity();
  for (let k = 0; k < 2; k++) {
    const S = SIDE[k], sx = S.sx, o = S.o, l = S.l;
    pose.local[S.clav].identity();
    euler(pose.local[S.ua], a[o], sx * a[o + 2], sx * a[o + 1], 'ZXY');
    euler(pose.local[S.fa], a[o + 3], 0, 0);
    euler(pose.local[S.el], a[o + 3] * 0.5, 0, 0);
    euler(pose.local[S.hand], -0.25, 0, 0);
    euler(pose.local[S.th], a[l], sx * a[l + 2], sx * a[l + 1], 'ZXY');
    euler(pose.local[S.sh], -a[l + 3], 0, 0);
    euler(pose.local[S.kn], -a[l + 3] * 0.5, 0, 0);
    // 勾脚写 NaN：按骨盆、髋、膝的俯仰反算，让脚掌保持水平（站着、跪倒前）
    const ank = Number.isNaN(a[l + 4]) ? -(a[4] + a[l] - a[l + 3]) : a[l + 4];
    euler(pose.local[S.ft], ank, 0, 0);
    pose.local[S.toe].identity();
  }
}

const lowVol = (pose, v, min) => Math.min(min, pose.point(v.bone, v.a, _w).y - v.r, pose.point(v.bone, v.b, _w).y - v.r);
// 一组命中体（VOLUMES 的下标）加上额外接地体的最低点
function lowest(pose, list, extra) {
  let min = Infinity;
  for (let i = 0; i < list.length; i++) min = lowVol(pose, VOLUMES[list[i]], min);
  for (let i = 0; i < extra.length; i++) min = lowVol(pose, extra[i], min);
  return min;
}
const ALL = VOLUMES.map((_, i) => i);
const LOWER = [4, 5], UPPER = [2, 3]; // 腹和骨盆、胸（VOLUMES 下标）
export const lowestAll = (pose, pack = false) => lowest(pose, ALL, pack ? PACK : BELT);

// 一组参数摆出来以后，身体沿水平方向 (ux, uz) 最远伸到哪（根空间，含骨盆位移），out 写头的位置（可省）
export function reachAlong(a, ux, uz, pack, out) {
  const py = a[1];
  a[1] = 0;
  applyParams(scratch, a);
  scratch.fk();
  a[1] = py;
  let m = -Infinity;
  const extra = pack ? PACK : BELT;
  for (let i = 0; i < VOLUMES.length + extra.length; i++) {
    const v = i < VOLUMES.length ? VOLUMES[i] : extra[i - VOLUMES.length];
    scratch.point(v.bone, v.a, _w);
    m = Math.max(m, _w.x * ux + _w.z * uz + v.r);
    scratch.point(v.bone, v.b, _w);
    m = Math.max(m, _w.x * ux + _w.z * uz + v.r);
  }
  if (out) out.copy(scratch.P[B.head]);
  return m;
}

// 一条肢体绕根关节、沿竖直面转 th 后的最低点（只算命中体端点，不改姿势）
function chainLow(pose, chain, J, th) {
  _q.setFromAxisAngle(_ax, th);
  let min = Infinity;
  for (let k = 1; k < chain.length; k++) {
    const v = VOLUMES[chain[k]];
    for (const off of [v.a, v.b]) {
      pose.point(v.bone, off, _v).sub(J).applyQuaternion(_q).add(J);
      min = Math.min(min, _v.y - v.r);
    }
  }
  return min;
}

export class Death {
  constructor() {
    this.live = new Pose();
    this.keys = Array.from({ length: 6 }, () => ({ t: 0, a: new Float32Array(N) }));
    this.cur = new Float32Array(N);
    this.corr = CHAINS.map(() => new THREE.Quaternion());
    this.g0 = new THREE.Vector3(); this.gq0 = new THREE.Quaternion(); this.gv = new THREE.Vector3();
    this.rest = new THREE.Vector3(); this.restQ = new THREE.Quaternion();
    this.t = 0; this.dur = 1; this.kind = 'back';
    this.pack = false; // 背着背包：倒地时背包也要贴地（由 SoldierRig 按变体设置）
    this.extra = BELT;
  }

  // pose：活着时最后一帧的姿势；gunVel：枪在根空间的速度；
  // fit：soldier_fall.js 按周围地形给的修正（scale 缩短骨盆位移；slump 的 psi 朝向、wx/wz/p 骨盆位移），可省
  start(pose, kind, flip, gunVel, fit) {
    const K = KINDS[kind];
    const extra = (this.extra = this.pack ? PACK : BELT);
    this.kind = kind;
    this.dur = K.dur * (0.92 + Math.random() * 0.16);
    this.t = 0;
    this.lift = 0;
    this.live.copy(pose);
    K.keys.forEach((k, i) => {
      const dst = this.keys[i];
      dst.t = k.t;
      if (flip) mirror(k.a, dst.a); else dst.a.set(k.a);
      const a = dst.a;
      for (const l of [20, 25]) if (Number.isNaN(a[l + 4])) a[l + 4] = -(a[4] + a[l] - a[l + 3]);
      if (!fit) return;
      if (kind === 'slump') {
        // 骨盆随时间转到背朝墙、挪到贴墙的位置
        const w = k.t * k.t * (3 - 2 * k.t);
        a[3] = fit.psi * w; a[0] = fit.wx * fit.p * w; a[2] = fit.wz * fit.p * w;
      } else if (fit.scale < 1) { a[0] *= fit.scale; a[2] *= fit.scale; }
    });
    // 最后一帧两臂外展各带一点随机，左右不对称
    const fa = this.keys[K.keys.length - 1].a;
    fa[13] += (Math.random() - 0.5) * 0.24;
    fa[17] += (Math.random() - 0.5) * 0.24;
    if (this.pack && kind === 'back') this.settle(this.keys[K.keys.length - 1].a);
    K.keys.forEach((k, i) => {
      const dst = this.keys[i];
      if (!Number.isNaN(dst.a[1])) return;
      // 自动高度：最后一帧以躯干贴地（四肢随后单独贴地），中间帧以全身最低点贴地
      dst.a[1] = 0;
      applyParams(scratch, dst.a);
      scratch.fk();
      dst.a[1] = -lowest(scratch, i === K.keys.length - 1 ? TORSO_VOLUMES : ALL, extra) + 0.004;
    });
    // 最后一帧逐条肢体贴地，修正量记成根骨的 local 旋转
    const last = this.keys[K.keys.length - 1].a;
    applyParams(scratch, last);
    scratch.fk();
    for (let c = 0; c < CHAINS.length; c++) {
      const chain = CHAINS[c], rb = chain[0], J = _c.copy(scratch.P[rb]);
      // 肢体方向取离根关节最远的那个端点
      let far = 0;
      for (let k = 1; k < chain.length; k++) {
        const v = VOLUMES[chain[k]];
        for (const off of [v.a, v.b]) {
          const d = scratch.point(v.bone, off, _w).distanceTo(J);
          if (d > far) { far = d; _v.copy(_w); }
        }
      }
      _v.sub(J);
      _ax.crossVectors(_v.normalize(), DOWN);
      this.corr[c].identity();
      if (_ax.lengthSq() < 0.01) continue;
      _ax.normalize();
      let lo = -1.4, hi = 1.4;
      if (chainLow(scratch, chain, J, lo) < 0.004 || chainLow(scratch, chain, J, hi) > 0.004) continue;
      for (let it = 0; it < 22; it++) {
        const mid = (lo + hi) / 2;
        if (chainLow(scratch, chain, J, mid) > 0.004) lo = mid; else hi = mid;
      }
      _q.setFromAxisAngle(_ax, (lo + hi) / 2);
      _q2.copy(scratch.Q[PARENT[rb]]);
      this.corr[c].copy(_q2).invert().multiply(_q).multiply(_q2);
    }
    // 枪：从手里的位置抛到右手外侧，左侧朝下躺平
    this.g0.copy(pose.weaponPos);
    this.gq0.copy(pose.Q[B.weapon]);
    this.gv.copy(gunVel);
    const chest = scratch.P[B.spine2];
    scratch.point(B.handR, _w.set(0, -0.08, 0), _v);
    _v.sub(chest).setY(0);
    const reach = Math.max(0.45, _v.length() + 0.18);
    _v.normalize();
    // 仰倒时左侧朝下；趴倒、拧转时右侧朝下：背带挂在枪左侧，人趴着时左侧朝下会把背带压进地里
    const right = kind !== 'back';
    this.rest.set(chest.x + _v.x * reach, right ? GUN.halfWidthR : GUN.halfWidth, chest.z + _v.z * reach);
    const yaw = Math.atan2(-_v.x, -_v.z) + (Math.random() - 0.5) * 1.2 + Math.PI * 0.5;
    euler(this.restQ, 0, yaw, right ? -Math.PI / 2 : Math.PI / 2);
  }

  // 仰面躺在背包上：骨盆前倾 d、腰椎反弓 d，屁股落地、胸口平着垫在背包上，而不是整个人架在背包上悬着屁股。
  // 大腿多屈 d，腿在世界里的角度不变；头随后由贴地修正垂到地上
  settle(a) {
    const p0 = a[4], s0 = a[6], y0 = a[1];
    const gap = (d) => {
      a[4] = p0 - d; a[6] = s0 + d; a[1] = 0;
      applyParams(scratch, a);
      scratch.fk();
      return lowest(scratch, LOWER, BELT) - lowest(scratch, UPPER, BAG);
    };
    let d = 0;
    if (gap(0) > 0.01) {
      let lo = 0, hi = 0.6;
      if (gap(hi) > 0) lo = hi;
      else for (let it = 0; it < 16; it++) { const m = (lo + hi) / 2; if (gap(m) > 0) lo = m; else hi = m; }
      d = (lo + hi) / 2;
    }
    a[4] = p0 - d; a[6] = s0 + d; a[1] = y0;
    a[20] += d; a[25] += d;
  }

  // 写 pose（含枪骨），返回是否已经停稳
  update(dt, pose) {
    this.t += dt;
    const u = Math.min(1, this.t / this.dur), K = KINDS[this.kind], n = K.keys.length;
    let i = 0;
    while (i < n - 2 && u > this.keys[i + 1].t) i++;
    const k0 = this.keys[i], k1 = this.keys[i + 1];
    const s = Math.min(1, Math.max(0, (u - k0.t) / (k1.t - k0.t))), e = s * s * (3 - 2 * s);
    for (let j = 0; j < N; j++) this.cur[j] = k0.a[j] + (k1.a[j] - k0.a[j]) * e;
    applyParams(pose, this.cur);
    // 最后一段把贴地修正渐渐加上
    const wc = i === n - 2 ? e : 0;
    if (wc > 0) {
      for (let c = 0; c < CHAINS.length; c++) {
        _qi.identity().slerp(this.corr[c], wc);
        pose.local[CHAINS[c][0]].premultiply(_qi);
      }
    }
    // 开头从活着的姿势过渡
    const wl = Math.min(1, this.t / 0.22), bl = wl * wl * (3 - 2 * wl);
    if (bl < 1) {
      for (let b = 0; b < BONE_COUNT; b++) if (b !== B.weapon) pose.local[b].slerpQuaternions(this.live.local[b], pose.local[b], bl);
      pose.pelvisPos.lerpVectors(this.live.pelvisPos, pose.pelvisPos, bl);
    }
    this.gun(pose, u);
    pose.fk();
    // 全身最低点不许低于地面
    const low = lowest(pose, ALL, this.extra);
    if (low < 0) { pose.pelvisPos.y -= low; pose.fk(); this.lift = Math.max(this.lift, -low); }
    return this.t >= this.dur + 0.1;
  }

  gun(pose, u) {
    // 枪和身体差不多同时落地：背带还挂在身上，枪先落地会把背带拉成一根长线
    const land = 0.78;
    if (u < land) {
      const k = u / land, h = k * k * (3 - 2 * k), tt = k * this.dur * land;
      pose.weaponPos.lerpVectors(this.g0, this.rest, h).addScaledVector(this.gv, tt * (1 - k) * 0.6);
      pose.weaponPos.y = this.g0.y + (this.rest.y - this.g0.y) * k * k + 0.12 * Math.sin(Math.PI * k) * (1 - k);
      pose.local[B.weapon].slerpQuaternions(this.gq0, this.restQ, h);
    } else {
      const k = (u - land) / (1 - land);
      pose.weaponPos.copy(this.rest);
      if (k < 0.35) pose.weaponPos.y += 0.035 * Math.sin(Math.PI * k / 0.35);
      pose.local[B.weapon].copy(this.restQ);
    }
  }
}
