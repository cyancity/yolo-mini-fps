import * as THREE from 'three';
import { B, BONES } from './soldier_skeleton.js';

// 命中体：挂在骨上的球和胶囊，端点按绑定姿势的模型坐标写。同一套也当倒地时的接地点用。
// part：'head' | 'torso' | 'limb'；leg：-1/1 表示左/右腿（受击时用）
const DEF = [
  ['head', B.head, [0, 1.695, 0.004], [0, 1.695, 0.004], 0.125],
  ['torso', B.neck, [0, 1.5, 0.014], [0, 1.57, 0.004], 0.065],
  ['torso', B.spine2, [-0.06, 1.37, 0.0], [0.06, 1.37, 0.0], 0.15],
  ['torso', B.spine2, [-0.05, 1.22, -0.012], [0.05, 1.22, -0.012], 0.15],
  ['torso', B.spine1, [-0.05, 1.08, 0.0], [0.05, 1.08, 0.0], 0.14],
  ['torso', B.pelvis, [-0.065, 0.92, 0.008], [0.065, 0.92, 0.008], 0.13],
];
for (const [s, sx] of [['L', -1], ['R', 1]]) {
  const x = 0.192 * sx, hx = 0.095 * sx;
  DEF.push(
    ['limb', B['upperArm' + s], [x + 0.008 * sx, 1.44, 0], [x, 1.14, 0], 0.058],
    ['limb', B['foreArm' + s], [x, 1.14, 0], [x, 0.878, 0], 0.047],
    ['limb', B['hand' + s], [x - 0.014 * sx, 0.81, -0.004], [x - 0.014 * sx, 0.81, -0.004], 0.05],
    ['limb', B['thigh' + s], [hx, 0.9, 0.01], [hx, 0.5, 0], 0.085],
    ['limb', B['shin' + s], [hx, 0.5, 0.004], [hx, 0.14, 0.008], 0.062],
    ['limb', B['foot' + s], [hx, 0.045, 0.045], [hx - 0.006 * sx, 0.045, -0.17], 0.048],
  );
}
export const VOLUMES = DEF.map(([part, bone, a, b, r]) => {
  const p = BONES[bone].pos;
  return {
    part, bone, r, leg: /thigh|shin|foot/.test(BONES[bone].name) ? (BONES[bone].name.endsWith('R') ? 1 : -1) : 0,
    a: new THREE.Vector3(a[0] - p[0], a[1] - p[1], a[2] - p[2]), b: new THREE.Vector3(b[0] - p[0], b[1] - p[1], b[2] - p[2]),
  };
});
export const TORSO_VOLUMES = [1, 2, 3, 4, 5];
export const LIMB_CHAINS = {
  // 倒地后的贴地修正：[肢体根骨, 这条肢体上的命中体]
  armR: [B.upperArmR], armL: [B.upperArmL], legR: [B.thighR], legL: [B.thighL], head: [B.neck],
};
VOLUMES.forEach((v, i) => {
  const n = BONES[v.bone].name;
  const key = /Arm|hand/.test(n) ? 'arm' + n.at(-1) : /thigh|shin|foot/.test(n) ? 'leg' + n.at(-1) : v.part === 'head' || v.bone === B.neck ? 'head' : null;
  if (key) LIMB_CHAINS[key].push(i);
});

const _d = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Vector3();

// 每个士兵一份：world 是各命中体端点的世界坐标（Float32Array，a/b 交错）
export class HitVolumes {
  constructor() {
    this.world = new Float32Array(VOLUMES.length * 6);
    this.local = new Float32Array(VOLUMES.length * 6);
    this.last = -1;
  }

  // pose 的根空间端点 → local；乘上根节点矩阵 → world
  update(pose, matrix) {
    const L = this.local, W = this.world, e = matrix.elements;
    for (let i = 0; i < VOLUMES.length; i++) {
      const v = VOLUMES[i];
      for (let k = 0; k < 2; k++) {
        pose.point(v.bone, k ? v.b : v.a, _w);
        const o = i * 6 + k * 3;
        L[o] = _w.x; L[o + 1] = _w.y; L[o + 2] = _w.z;
        W[o] = e[0] * _w.x + e[4] * _w.y + e[8] * _w.z + e[12];
        W[o + 1] = e[1] * _w.x + e[5] * _w.y + e[9] * _w.z + e[13];
        W[o + 2] = e[2] * _w.x + e[6] * _w.y + e[10] * _w.z + e[14];
      }
    }
  }

  // 根空间里一组命中体（或全部）的最低点
  lowest(pose, list = null) {
    let min = Infinity;
    const n = list ? list.length : VOLUMES.length;
    for (let j = 0; j < n; j++) {
      const i = list ? list[j] : j, v = VOLUMES[i];
      min = Math.min(min, pose.point(v.bone, v.a, _w).y - v.r, pose.point(v.bone, v.b, _w).y - v.r);
    }
    return min;
  }

  // 射线对所有命中体，取最近的入射点。胶囊用“射线到线段最近点”近似入射距离
  raycast(o, dir, maxDist) {
    const W = this.world;
    let best = maxDist, hit = -1;
    for (let i = 0; i < VOLUMES.length; i++) {
      const r = VOLUMES[i].r, k = i * 6;
      const ax = W[k], ay = W[k + 1], az = W[k + 2];
      _d.set(W[k + 3] - ax, W[k + 4] - ay, W[k + 5] - az);
      _w.set(o.x - ax, o.y - ay, o.z - az);
      const dd = _d.dot(_d), de = _d.dot(dir), dw = _d.dot(_w), ew = dir.dot(_w);
      let s = 0, t;
      if (dd < 1e-8) t = -ew;
      else {
        const den = dd - de * de;
        s = den > 1e-8 ? Math.min(1, Math.max(0, (dw - de * ew) / den)) : 0;
        t = s * de - ew;
        if (t < 0) { t = 0; s = Math.min(1, Math.max(0, dw / dd)); }
      }
      _e.copy(_w).addScaledVector(dir, t).addScaledVector(_d, -s);
      const d2 = _e.lengthSq();
      if (d2 > r * r) continue;
      const tin = Math.max(0, t - Math.sqrt(r * r - d2));
      if (tin < best) { best = tin; hit = i; }
    }
    if (hit < 0) return null;
    this.last = hit;
    return { dist: best, point: new THREE.Vector3().copy(o).addScaledVector(dir, best), part: VOLUMES[hit].part };
  }
}
