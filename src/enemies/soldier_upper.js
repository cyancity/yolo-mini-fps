import * as THREE from 'three';
import { B, LEN, GRIP_HOLE } from './soldier_skeleton.js';
import { GUN } from './soldier_gun.js';
import { euler, twoBone, twistY } from './soldier_pose.js';

// 上半身：脊柱扭转和俯仰、头看向瞄准方向、锁骨、枪的位置朝向、双手 IK 握枪，加上后坐和受击的弹簧。
// 枪的朝向在瞄准时就是 Ry(aimYaw)·Rx(aimPitch)，不经过脊柱累加，所以枪口方向是精确的。

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const V = (a) => new THREE.Vector3(...a);

// 握把上的手：四指(-Y)顺着 long 方向，握持孔轴(+Z)顺着握把轴线
function gripQuat(axis, long) {
  const g = V(axis).normalize(), a = V(long);
  a.addScaledVector(g, -a.dot(g)).normalize();
  const y = a.clone().negate(), x = y.clone().cross(g);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, g));
}
const GRIP_Q = { R: gripQuat(GUN.gripRAxis, [-0.15, -0.25, -1]), L: gripQuat(GUN.gripLAxis, [0.25, -0.1, -1]) };
const GRIP_P = { R: V(GUN.gripR), L: V(GUN.gripL) };
const HOLE = { R: V(GRIP_HOLE), L: V([-GRIP_HOLE[0], GRIP_HOLE[1], GRIP_HOLE[2]]) };
const BUTT = V(GUN.butt);
// 托底板抵的位置（相对 spine2 的绑定偏移）：抵肩瞄准、低姿戒备
const S_AIM = new THREE.Vector3(0.09, 1.5, -0.095).sub(V([0, 1.27, 0.006]));
const S_LOW = new THREE.Vector3(0.115, 1.37, -0.14).sub(V([0, 1.27, 0.006]));
const POLE = { R: V([0.75, -0.62, 0.22]).normalize(), L: V([-0.4, -0.9, 0.1]).normalize() };
// 骨索引按侧预先查好，每帧不拼字符串
const ARM = {};
for (const s of ['R', 'L']) ARM[s] = { ua: B['upperArm' + s], fa: B['foreArm' + s], el: B['elbow' + s], hand: B['hand' + s] };
const SIDES = ['R', 'L'];
// 左手够前握把：肘留一点弯；够不着时锁骨先前伸下沉（最多 CLAV_MAX），再不够就把枪整体往左肩拉
const REACH = (LEN.upperArm + LEN.foreArm) * 0.97;
const CLAV_LEN = 0.162, CLAV_MAX = 0.35;

// 三维阻尼弹簧：受击时给速度冲量
class Spring {
  constructor(w, z) { this.w = w; this.z = z; this.x = new THREE.Vector3(); this.v = new THREE.Vector3(); }
  step(dt) {
    const n = Math.ceil(dt / (1 / 120)), h = dt / n, w = this.w, k = 2 * this.z * w;
    for (let i = 0; i < n; i++) {
      this.v.x += (-w * w * this.x.x - k * this.v.x) * h; this.v.y += (-w * w * this.x.y - k * this.v.y) * h; this.v.z += (-w * w * this.x.z - k * this.v.z) * h;
      this.x.addScaledVector(this.v, h);
    }
  }
  reset() { this.x.set(0, 0, 0); this.v.set(0, 0, 0); }
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _p = new THREE.Vector3(), _p2 = new THREE.Vector3(), _t = new THREE.Vector3(), _pole = new THREE.Vector3();
const _a = new THREE.Vector3(), _ax = new THREE.Vector3();

export class Upper {
  constructor() {
    this.torso = new Spring(13, 0.45);
    this.head = new Spring(16, 0.4);
    this.gun = new Spring(18, 0.5);
    this.hips = new Spring(11, 0.5); // x 下沉，z 侧倾
    this.recoil = new Spring(30, 1);
    this.springs = [this.torso, this.head, this.gun, this.hips, this.recoil];
    this.recoilYaw = 0;
    this.look = { y: 0, p: 0, ty: 0, tp: 0, next: 0 };
    this.gunQ = new THREE.Quaternion();
  }

  reset() {
    for (const s of this.springs) s.reset();
    this.look.y = this.look.p = this.look.ty = this.look.tp = 0;
  }

  fire() {
    this.recoil.v.x += 30 * Math.E;
    this.recoilYaw = (Math.random() - 0.5) * 0.5;
  }

  // dir：子弹在模型空间的飞行方向；leg：-1/1 打中哪条腿，0 不是腿
  flinch(dir, part, leg) {
    const ax = dir.z, az = -dir.x, r = () => Math.random() - 0.5;
    const kt = part === 'torso' ? 5.5 : part === 'head' ? 3 : 2;
    this.torso.v.x += ax * kt; this.torso.v.z += az * kt; this.torso.v.y += r() * kt * 0.8;
    const kh = part === 'head' ? 15 : 4;
    this.head.v.x += ax * kh; this.head.v.z += az * kh + r() * kh * 0.5; this.head.v.y += r() * kh * 0.4;
    const kg = part === 'limb' ? 5 : 2.5;
    this.gun.v.x += (0.3 + r()) * kg; this.gun.v.y += r() * kg * 1.4; this.gun.v.z += r() * kg;
    if (leg) { this.hips.v.x += 0.9; this.hips.v.z += leg * 2.4; }
  }

  step(dt, t, aim) {
    for (const s of this.springs) s.step(dt);
    const L = this.look;
    if (t > L.next) {
      L.next = t + 2 + Math.random() * 3;
      L.ty = (Math.random() - 0.5) * 0.6;
      L.tp = (Math.random() - 0.5) * 0.2;
    }
    const k = 1 - Math.exp(-dt * 3), idle = 1 - smooth(aim / 0.4);
    L.y += (L.ty * idle - L.y) * k;
    L.p += (L.tp * idle - L.p) * k;
  }

  // 骨盆和腿已经放好。s：平滑过的状态；g：步态（骨盆欧拉角、跑步程度）
  pose(pose, s, g, t) {
    const aim = s.aim, ya = s.aimYaw, pa = s.aimPitch, c = s.crouch;
    const fwd = Math.cos(s.moveYaw), rec = this.recoil.x.x, ft = this.torso.x, fh = this.head.x, fg = this.gun.x;
    const breath = 0.012 * Math.sin(t * Math.PI * 2 * 0.27);
    const chestYaw = ya - lerp(0.12, 0.24, aim);
    const twist = chestYaw - g.yaw;
    const chestPitch = pa * lerp(0.25, 0.6, aim) - 0.06 - 0.26 * g.runK * fwd - 0.42 * c;
    const bend = chestPitch - g.pitch;
    euler(_q, bend * 0.45 + ft.x * 0.4, twist * 0.45 + ft.y * 0.4, -g.roll * 0.5 + ft.z * 0.4);
    pose.setLocal(B.spine1, _q);
    euler(_q, bend * 0.55 + breath + rec * 0.03 + ft.x * 0.6, twist * 0.55 + ft.y * 0.6, -g.roll * 0.4 + ft.z * 0.6);
    pose.setLocal(B.spine2, _q);

    // 头：看向瞄准方向，抵肩时低头、往右歪向枪托
    euler(_q, pa + lerp(0, -0.13, aim) + this.look.p + fh.x, ya + this.look.y + fh.y, lerp(0, -0.15, aim) + fh.z);
    _q2.copy(pose.Q[B.spine2]).invert().multiply(_q);
    _qi.identity().slerp(_q2, 0.4);
    pose.setLocal(B.neck, _qi);
    pose.setWorld(B.head, _q);
    pose.setLocal(B.led, _qi.identity());

    // 锁骨：瞄准时右肩耸起前送，左肩前伸去够前握把
    euler(_q, 0, 0.04 + 0.1 * aim, 0.1 * aim + breath * 0.6);
    pose.setLocal(B.clavR, _q);
    euler(_q, 0, -(0.16 + 0.06 * aim), -(0.02 + breath * 0.6));
    pose.setLocal(B.clavL, _q);

    // 枪：低姿戒备（枪口朝左下）和抵肩瞄准之间插值，再叠后坐和受击
    const ae = smooth(aim);
    euler(_q, pa, ya, 0);
    euler(_q2, -0.62 + pa * 0.3, ya * 0.75 + 0.32, 0.18);
    this.gunQ.copy(_q2).slerp(_q, ae);
    euler(_q3, rec * 0.07 + fg.x * 0.12, this.recoilYaw * rec * 0.05 + fg.y * 0.12, fg.z * 0.1);
    this.gunQ.multiply(_q3);
    pose.point(B.spine2, S_LOW, _p);
    pose.point(B.spine2, S_AIM, _p2);
    _p.lerp(_p2, ae);
    _t.copy(BUTT).setZ(BUTT.z - rec * 0.028).applyQuaternion(this.gunQ);
    pose.weaponPos.copy(_p).sub(_t);
    pose.setWorld(B.weapon, this.gunQ);

    this.reachLeft(pose);
    for (const side of SIDES) this.arm(pose, side);
  }

  // 握把上的手：腕骨的目标位置写进 outP，手的根空间朝向写进 outQ
  wrist(pose, side, outP, outQ) {
    outQ.multiplyQuaternions(this.gunQ, GRIP_Q[side]);
    outP.copy(GRIP_P[side]).applyQuaternion(this.gunQ).add(pose.weaponPos);
    return outP.sub(_t.copy(HOLE[side]).applyQuaternion(outQ));
  }

  // 前握把离左肩太远时：左锁骨朝握把方向转（前伸、下沉），还差的距离把枪平移过去。
  // 只平移不转，枪口方向不变；右手随后按新的枪位置重新求 IK
  reachLeft(pose) {
    const sh = pose.P[ARM.L.ua];
    this.wrist(pose, 'L', _p, _q);
    _a.subVectors(_p, sh);
    let e = _a.length() - REACH;
    if (e <= 0) return;
    _t.subVectors(sh, pose.P[B.clavL]);
    _ax.crossVectors(_t, _a);
    if (_ax.lengthSq() > 1e-8) {
      _q2.setFromAxisAngle(_ax.normalize(), Math.min(CLAV_MAX, e / CLAV_LEN)).multiply(pose.Q[B.clavL]);
      pose.setWorld(B.clavL, _q2);
      pose.place(ARM.L.ua);
      _a.subVectors(_p, sh);
      e = _a.length() - REACH;
    }
    if (e <= 0) return;
    pose.weaponPos.addScaledVector(_a.normalize(), -e);
    pose.place(B.weapon);
  }

  arm(pose, side) {
    const A = ARM[side];
    this.wrist(pose, side, _p, _q);
    _pole.copy(POLE[side]).applyQuaternion(pose.Q[B.spine2]);
    twoBone(pose.P[A.ua], _p, LEN.upperArm, LEN.foreArm, _pole, false, _q2, _q3);
    pose.setWorld(A.ua, _q2);
    // 前臂分担一半的旋前旋后，腕部不拧成麻花
    _qi.copy(_q3).invert().multiply(_q);
    const tw = Math.max(-1.5, Math.min(1.5, twistY(_qi)));
    _q3.multiply(_qi.setFromAxisAngle(_yAxis, tw * 0.5));
    pose.setWorld(A.fa, _q3);
    _qi.identity().slerp(pose.local[A.fa], 0.5);
    pose.setLocal(A.el, _qi);
    pose.setWorld(A.hand, _q);
  }
}

const _yAxis = new THREE.Vector3(0, 1, 0);
