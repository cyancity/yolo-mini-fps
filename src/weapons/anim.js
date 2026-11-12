import * as THREE from 'three';

// 武器动画用的小工具：缓动、弹簧、关键帧轨道、姿态混合
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const ease = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2,
};

// 二阶弹簧，n 个互不相干的通道。kick 给速度冲量，之后自己回到 0。
export class Spring {
  constructor(n, stiffness, damping) {
    this.x = new Float32Array(n);
    this.v = new Float32Array(n);
    this.k = stiffness;
    this.c = damping;
  }

  kick(i, impulse) { this.v[i] += impulse; }

  update(dt) {
    const steps = Math.max(1, Math.ceil(dt / 0.006)), h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < this.x.length; i++) {
        this.v[i] += (-this.k * this.x[i] - this.c * this.v[i]) * h;
        this.x[i] += this.v[i] * h;
      }
    }
  }

  reset() { this.x.fill(0); this.v.fill(0); }
}

// 关键帧轨道：keys = [[t, value, easeName?], ...]，value 是数字或等长数组。
// 每个关键帧的缓动作用在“到达它”的那一段上。
export function track(keys, t, out) {
  const first = keys[0], last = keys[keys.length - 1];
  let a = first, b = first, u = 0;
  if (t >= last[0]) { a = b = last; } else if (t > first[0]) {
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        a = keys[i - 1]; b = keys[i];
        u = (ease[b[2]] || ease.smooth)(clamp01((t - a[0]) / Math.max(b[0] - a[0], 1e-5)));
        break;
      }
    }
  }
  if (typeof a[1] === 'number') return lerp(a[1], b[1], u);
  out ??= new Array(a[1].length);
  for (let i = 0; i < a[1].length; i++) out[i] = lerp(a[1][i], b[1][i], u);
  return out;
}

// 姿态 = [px, py, pz, rx, ry, rz]
export const P0 = [0, 0, 0, 0, 0, 0];
export function mixPose(out, a, b, t) {
  for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}
export function addPose(out, a, w = 1) {
  for (let i = 0; i < 6; i++) out[i] += a[i] * w;
  return out;
}
export function applyPose(obj, p) {
  obj.position.set(p[0], p[1], p[2]);
  obj.rotation.set(p[3], p[4], p[5], 'YXZ');
}

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _p2 = new THREE.Vector3(), _q2 = new THREE.Quaternion();

// 手的摆位：算出“让 hand 的 grip 锚点和 target 重合”时 hand.root 相对 parent 的变换。
// 结果写进 out = { p: Vector3, q: Quaternion }，方便在几个抓握点之间插值。
export function gripTransform(out, armRoot, palm, target, parent, tweak = null) {
  parent.updateWorldMatrix(true, false);
  target.updateWorldMatrix(true, false);
  armRoot.updateWorldMatrix(false, false);
  palm.updateWorldMatrix(true, false);
  // 目标相对 parent
  _m.copy(parent.matrixWorld).invert().multiply(target.matrixWorld);
  if (tweak) _m.multiply(tweak);
  // 掌心相对 armRoot
  _inv.copy(armRoot.matrixWorld).invert().multiply(palm.matrixWorld).invert();
  _m.multiply(_inv);
  _m.decompose(out.p, out.q, _s);
  return out;
}

export const makeGrip = () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() });
export function mixGrip(obj, a, b, t) {
  obj.position.copy(_p.copy(a.p).lerp(_p2.copy(b.p), t));
  obj.quaternion.copy(_q.copy(a.q).slerp(_q2.copy(b.q), t));
}
export function setGrip(obj, g) {
  obj.position.copy(g.p);
  obj.quaternion.copy(g.q);
}

// 一维滑移（Glide：x、v、to()）从当前位置回到 0 的途中，保证至少再沉到 min：不够就补一个朝外的初速度，
// 补了返回 true。T 是随后 to(0, T) 用的时长。Hermite 弧线在 1/3 处到顶，峰值约等于 0.741·x + 0.148·v·T
export function dipKick(g, min, T) {
  if (g.x >= min) return false;
  g.v = Math.max(g.v, (min - 0.741 * g.x) / (0.148 * T));
  return true;
}
