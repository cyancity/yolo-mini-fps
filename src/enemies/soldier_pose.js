import * as THREE from 'three';
import { BONE_COUNT, PARENT, OFFSET, B } from './soldier_skeleton.js';

// 姿势：每根骨相对父骨的朝向 local（位置固定是绑定偏移），外加挂在根节点下的两根骨（骨盆、枪）在根空间的位置。
// fk() 之后 P、Q 是每根骨在根空间（脚底原点、面朝 -Z）的位置和朝向。绑定姿势下所有骨的朝向都是单位四元数。
export class Pose {
  constructor() {
    this.local = Array.from({ length: BONE_COUNT }, () => new THREE.Quaternion());
    this.P = OFFSET.map(() => new THREE.Vector3());
    this.Q = OFFSET.map(() => new THREE.Quaternion());
    this.pelvisPos = new THREE.Vector3(0, 0.98, 0);
    this.weaponPos = new THREE.Vector3();
  }

  // 按骨的顺序（父骨在前）算一根骨的根空间变换
  place(i) {
    const p = PARENT[i];
    if (p < 0) {
      this.Q[i].copy(this.local[i]);
      this.P[i].copy(i === B.pelvis ? this.pelvisPos : this.weaponPos);
    } else {
      this.Q[i].multiplyQuaternions(this.Q[p], this.local[i]);
      this.P[i].copy(OFFSET[i]).applyQuaternion(this.Q[p]).add(this.P[p]);
    }
  }

  setLocal(i, q) { this.local[i].copy(q); this.place(i); }

  // 给定根空间朝向，反推相对父骨的 local（父骨必须已经放好）
  setWorld(i, q) {
    const p = PARENT[i];
    if (p < 0) this.local[i].copy(q); else this.local[i].copy(this.Q[p]).invert().multiply(q);
    this.place(i);
  }

  fk() { for (let i = 0; i < BONE_COUNT; i++) this.place(i); }

  copy(o) {
    for (let i = 0; i < BONE_COUNT; i++) this.local[i].copy(o.local[i]);
    this.pelvisPos.copy(o.pelvisPos);
    this.weaponPos.copy(o.weaponPos);
    return this;
  }

  // 根空间里一个跟着骨走的点：绑定姿势下相对这根骨的偏移 off
  point(i, off, out) { return out.copy(off).applyQuaternion(this.Q[i]).add(this.P[i]); }
}

const _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _j = new THREE.Vector3(), _n = new THREE.Vector3();
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _e = new THREE.Euler();

// 肢段朝向：本地 -Y 沿 dir，本地 +X 是铰链轴 hinge（两者须正交）
export function segmentQuat(dir, hinge, out) {
  _y.copy(dir).negate();
  _x.copy(hinge);
  _z.crossVectors(_x, _y);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

// 两段 IK：从关节 A 够到目标 T。pole 是中间关节（膝、肘）凸出去的方向；
// knee = true 时下段往后折（腿），false 时往前折（胳膊）。结果写进 outUpper、outLower（根空间朝向），返回是否够得着
export function twoBone(A, T, l1, l2, pole, knee, outUpper, outLower) {
  _a.subVectors(T, A);
  let d = _a.length();
  const reach = d < l1 + l2 - 1e-4;
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-3), (l1 + l2) * 0.9999);
  _a.normalize();
  _j.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_j.lengthSq() < 1e-8) _j.set(0, 0, knee ? -1 : 1).addScaledVector(_a, -_a.z);
  _j.normalize();
  const ca = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))), sa = Math.sqrt(1 - ca * ca);
  _u.copy(_a).multiplyScalar(ca).addScaledVector(_j, sa);
  _knee.copy(A).addScaledVector(_u, l1);
  _v.copy(A).addScaledVector(_a, d).sub(_knee).normalize();
  if (knee) _n.crossVectors(_a, _j); else _n.crossVectors(_j, _a);
  _n.normalize();
  segmentQuat(_u, _n, outUpper);
  segmentQuat(_v, _n, outLower);
  return reach;
}

// 绕本地 Y 的扭转角（swing-twist 分解）
export function twistY(q) { return 2 * Math.atan2(q.y, q.w); }

export function euler(out, x, y, z, order = 'YXZ') { return out.setFromEuler(_e.set(x, y, z, order)); }

export const yAxis = new THREE.Vector3(0, 1, 0);
export const xAxis = new THREE.Vector3(1, 0, 0);
export const zAxis = new THREE.Vector3(0, 0, 1);
