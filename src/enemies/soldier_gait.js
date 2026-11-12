import * as THREE from 'three';
import { B, ANKLE_H, FOOT, LEN, OFFSET } from './soldier_skeleton.js';
import { euler, twoBone } from './soldier_pose.js';

// 步态：由速度、移动方向、下蹲程度算出两只脚的落点、骨盆高度和摆动，再用两段 IK 摆腿。
// 支撑期脚相对身体的速度正好等于移动速度，所以脚不打滑；转身时支撑脚锁住世界朝向，转多了自动踏步。

const lerp = (a, b, t) => a + (b - a) * t;
const frac = (x) => x - Math.floor(x);
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
const LEG = LEN.thigh + LEN.shin;
const LOCK = 0.85; // 支撑脚相对身体最多拧这么多，再多就得迈步
const REACH_H = 0.48; // 支撑脚离落点基准最远多少（水平），再远腿就够不着了
const HEEL = new THREE.Vector3(0, -ANKLE_H, FOOT.heel), BALL = new THREE.Vector3(0, FOOT.ballY - ANKLE_H, FOOT.ball);
const _o = new THREE.Vector3(), _r = new THREE.Vector3(), _pole = new THREE.Vector3(), _hip = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0), _yAxis = new THREE.Vector3(0, 1, 0);

// 站姿：右脚在后、脚尖外撇（右手持枪的侧身站法）；蹲姿是深蹲、右脚跟抬起
const STAND = { R: [0.125, 0.07, -0.35], L: [-0.105, -0.09, -0.12] };
const CROUCH = { R: [0.15, 0.17, -0.5], L: [-0.125, -0.2, -0.15] };

class Foot {
  constructor(sx) {
    this.sx = sx;
    const s = (this.side = sx > 0 ? 'R' : 'L');
    // 骨索引和站姿在这里查好，每帧不拼字符串、不建数组
    this.thigh = B['thigh' + s]; this.shin = B['shin' + s]; this.knee = B['knee' + s]; this.foot = B['foot' + s]; this.toeB = B['toe' + s];
    this.stand = STAND[s]; this.crouch = CROUCH[s];
    this.ankle = new THREE.Vector3(sx * 0.1, ANKLE_H, 0);
    this.yaw = 0; this.pitch = 0; this.toe = 0; this.lift = 0; this.lock = 0; this.stanceU = 0;
    this.home();
  }

  // 脚的落点基准（相对身体）：只在脚离地时挪向目标，踩在地上时不动；和目标差太多就触发迈步。
  // ox、oz 是步幅偏移：支撑期按根节点的真实位移反向积分，摆动期从离地点插值到下一个落点
  // off 是这只脚的相位偏移（右 0、左 0.5）：踩久了提前抬脚时改它，摆动期再慢慢回到和另一只脚差半拍
  home() {
    this.bx = this.stand[0]; this.bz = this.stand[1]; this.byaw = this.stand[2]; this.mis = 0;
    this.ox = this.oz = this.ox0 = this.oz0 = 0; this.planted = true; this.p0 = 0; this.reachK = 0;
    this.off = this.sx > 0 ? 0 : 0.5;
  }
}

export class Gait {
  constructor() {
    this.feet = [new Foot(1), new Foot(-1)];
    this.reset();
  }

  reset() {
    this.phase = Math.random();
    this.act = 0; this.theta = 0; this.lead = 1; this.runK = 0; this.omega = 0; this.duty = 0.6;
    this.px = 0; this.py = 0.96; this.pz = 0; this.yaw = 0; this.pitch = 0; this.roll = 0;
    for (const f of this.feet) { f.lock = 0; f.lift = 0; f.home(); }
  }

  // s：平滑过的状态；dYaw：这一帧根节点转了多少；t：时间；mx、mz：根节点这一帧在根空间里的位移。
  // 位移正好是 0（预览页原地踏步、被挡住）时按 speed 和 moveYaw 推算
  update(dt, s, dYaw, t, mx = 0, mz = 0) {
    const v = s.speed, c = s.crouch, m = s.moveYaw;
    const runK = smooth((v - 1.9) / 1.9) * (1 - c);
    this.runK = runK;
    if (dt > 0) this.omega += (dYaw / dt - this.omega) * (1 - Math.exp(-dt * 8));
    const w = Math.abs(this.omega);
    // 原地转身转得越快，步子越碎越快；摆动的脚提前往转的方向拧，落地后支撑期正好拧回来，脚不在地上搓
    const spin = smooth((w - 0.5) / 2.5) * (1 - runK);
    const cad = lerp(1.6 + 0.35 * v, 2.4 + 0.15 * v, runK) * (1 - 0.25 * c) + 2 * spin;
    // 支撑占比慢慢变：一下子跳会把正在摆动的脚判成踩地（急停时脚“砸”到身后）
    this.duty += (lerp(lerp(0.6, 0.34, runK), 0.5, spin) - this.duty) * (1 - Math.exp(-dt * 4));
    const duty = this.duty;
    const ahead = Math.max(-LOCK, Math.min(LOCK, (this.omega * duty) / cad));
    const F0 = this.feet[0], F1 = this.feet[1];
    const lockMax = Math.max(Math.abs(F0.lock), Math.abs(F1.lock));
    const turn = Math.max(smooth((w - 0.4) / 1.2), smooth((lockMax - 0.22) / 0.2), smooth((Math.max(F0.mis, F1.mis) - 0.03) / 0.04));
    const target = Math.max(smooth(v / 0.45), turn * 0.8);
    this.act += (target - this.act) * (1 - Math.exp(-dt * 8));
    const act = this.act;
    if (act > 0.01) this.phase = (this.phase + dt * cad * 0.5) % 1;

    const L = (2 * v * duty) / cad, c0 = -L * lerp(0.08, 0.14, runK);
    const dx = -Math.sin(m), dz = -Math.cos(m), fwd = Math.cos(m), lat = Math.sin(m);
    // 横移时两条脚印线跟着移动方向转，脚一前一后交错过去；前进、后退时线是左右并排的
    if (fwd > 0.15) this.lead = 1; else if (fwd < -0.15) this.lead = -1;
    const mf = this.lead > 0 ? wrap(m) : wrap(m + Math.PI);
    const thT = Math.max(-1.75, Math.min(1.75, mf)) * 0.72 * smooth(v / 0.3);
    this.theta += (thT - this.theta) * (1 - Math.exp(-dt * 6));
    const pcx = Math.cos(this.theta), pcz = -Math.sin(this.theta);
    const H = lerp(0.075, 0.2, runK) * act * (1 - 0.3 * c), lpow = lerp(1, 0.7, runK);
    const pLand = lerp(0.25, 0.08, runK) * fwd * act, pOff = -lerp(0.55, 0.75, runK) * fwd * act;
    const half = lerp(0.105, 0.13, c);
    if (mx === 0 && mz === 0) { mx = dx * v * dt; mz = dz * v * dt; }

    for (const f of this.feet) {
      const other = f === F0 ? F1 : F0;
      const A = f.stand, C = f.crouch, ix = lerp(A[0], C[0], c), iz = lerp(A[1], C[1], c), iyaw = lerp(A[2], C[2], c);
      const tx = lerp(ix, pcx * half * f.sx, act), tz = lerp(iz, pcz * half * f.sx, act);
      const tyaw = lerp(iyaw, -0.1 * f.sx, act) + this.theta * 0.5 * act;
      const ph = frac(this.phase + f.off);
      let lift = 0, pitch, slip = 0;
      if (ph < duty) {
        const u = ph / duty;
        f.stanceU = u;
        f.planted = true;
        pitch = u < 0.18 ? lerp(pLand, 0, smooth(u / 0.18)) : u > 0.5 ? lerp(0, pOff, smooth((u - 0.5) / 0.5)) : 0;
        f.p0 = pitch; // 离地那一刻的脚掌角：摆动开头从它过渡，提前抬脚时脚掌不跳
        f.lock = Math.max(-LOCK, Math.min(LOCK, f.lock - dYaw));
        // 支撑脚踩住地面：根节点走了多远脚就反向挪多远（先扣掉转身锁定角），腿够不着了才让它滑
        const cl = Math.cos(f.lock), sl = Math.sin(f.lock), se = L / 2 - L * u + c0;
        f.ox -= mx * cl - mz * sl; f.oz -= mx * sl + mz * cl;
        const ol = Math.hypot(f.ox, f.oz), reach = Math.max(REACH_H, L / 2 - c0 + 0.08);
        f.reachK = ol / reach;
        if (ol > reach) { f.ox *= reach / ol; f.oz *= reach / ol; }
        // 起步、急停、变向时脚会落在步态之外：差得多、另一只脚踩稳了，就提前抬脚迈过去，不在地上拖
        slip = Math.hypot(dx * se - f.ox, dz * se - f.oz);
        if (slip > 0.12 && act > 0.05 && other.planted && other.stanceU < 0.7) f.off = frac(f.off + duty - ph + 1e-3);
      } else {
        const sw = (ph - duty) / (1 - duty);
        f.stanceU = -1;
        if (f.planted) { f.planted = false; f.ox0 = f.ox; f.oz0 = f.oz; }
        // 迈步时在摆动期把相位慢慢拉回和另一只脚差半拍（不迈步时脚贴着地，不能动它）；
        // 另一只脚踩着快够不着了（起步、变向），这一步就迈快点，好让它早点抬
        if (act > 0.05) {
          const hurry = other.planted ? smooth((other.reachK - 0.55) / 0.25) : 0;
          const dOff = frac(other.off + 0.5 - f.off + 0.5) - 0.5;
          f.off = frac(f.off + (hurry > 0 ? hurry * 3 * dt : Math.max(-0.6 * dt, Math.min(0.6 * dt, dOff))));
        }
        const e = (1 - Math.cos(Math.PI * sw)) / 2, se = L / 2 + c0;
        f.ox = lerp(f.ox0, dx * se, e); f.oz = lerp(f.oz0, dz * se, e);
        lift = H * Math.sin(Math.PI * sw ** lpow);
        pitch = lerp(f.p0, lerp(pOff, pLand, smooth(sw)) + 0.15 * Math.sin(Math.PI * sw) * fwd * act, smooth(sw / 0.35));
        f.lock += (ahead * act - f.lock) * (1 - Math.exp(-dt * 14 * act));
        if (act < 0.05) f.lock = Math.max(-LOCK, Math.min(LOCK, f.lock - dYaw));
        if (act > 0.01) {
          const k = 1 - Math.exp(-dt * 14);
          f.bx += (tx - f.bx) * k; f.bz += (tz - f.bz) * k; f.byaw += (tyaw - f.byaw) * k;
        }
      }
      f.mis = Math.hypot(tx - f.bx, tz - f.bz) + 0.15 * Math.abs(tyaw - f.byaw) + slip;
      pitch += -0.5 * (f.sx > 0 ? 1 : 0) * c * (1 - act);
      f.lift = lift;
      // 支撑脚锁世界朝向：位置绕根原点转回去
      const ax = f.bx + f.ox, az = f.bz + f.oz, cl = Math.cos(f.lock), sl = Math.sin(f.lock);
      const gx = ax * cl + az * sl, gz = -ax * sl + az * cl;
      f.yaw = f.byaw + f.lock;
      f.pitch = pitch;
      // 抬脚跟时绕前掌转，勾脚尖时绕后跟转：着地点不动
      _o.copy(pitch < 0 ? BALL : HEEL);
      _r.copy(_o).applyAxisAngle(_xAxis, pitch);
      _o.sub(_r).applyAxisAngle(_yAxis, f.yaw);
      f.ankle.set(gx + _o.x, ANKLE_H + lift + _o.y, gz + _o.z);
      f.toe = Math.max(0, -pitch) * (1 - smooth(lift / 0.04));
    }
    const R = this.feet[0], Lf = this.feet[1];
    this.py = lerp(lerp(0.962, 0.945, act), lerp(0.48, 0.53, act), c) - runK * (0.035 + 0.025 * Math.cos(Math.PI * 4 * (this.phase - duty / 2)));
    this.px = -0.1 * (R.lift - Lf.lift) * (1 - runK) + (1 - act) * (0.012 * Math.sin(t * 0.55) + 0.008);
    this.pz = 0.05 * c - 0.03 * runK * fwd;
    this.yaw = lerp(lerp(-0.28, -0.1, act), -0.35, c) + this.theta * 0.35 * act + 0.35 * (Lf.ankle.z - R.ankle.z) * act;
    this.pitch = -0.04 - 0.35 * c - 0.16 * runK * fwd;
    this.roll = -0.5 * (R.lift - Lf.lift) * (1 - 0.5 * runK) + 0.05 * lat * smooth(v / 0.5) + (1 - act) * 0.02 * Math.sin(t * 0.55);
  }

  // 骨盆高度：目标高度和“两条腿都够得着”的上限取软最小值，腿永远不会被拉直到够不着
  pelvisHeight(pose, target) {
    const k = 0.012;
    let acc = Math.exp(-target / k);
    for (const f of this.feet) {
      _hip.copy(OFFSET[f.thigh]).applyQuaternion(pose.Q[B.pelvis]);
      const hx = pose.pelvisPos.x + _hip.x - f.ankle.x, hz = pose.pelvisPos.z + _hip.z - f.ankle.z;
      const maxY = f.ankle.y + Math.sqrt(Math.max(0, (0.996 * LEG) ** 2 - hx * hx - hz * hz)) - _hip.y;
      acc += Math.exp(-maxY / k);
    }
    return -k * Math.log(acc);
  }

  // 摆腿：骨盆必须已经放好
  legs(pose) {
    for (const f of this.feet) {
      _pole.set(0.12 * f.sx, 0, -1).applyAxisAngle(_yAxis, f.yaw);
      pose.place(f.thigh); // 髋关节跟着这一帧的骨盆走，不能用上一帧的位置
      twoBone(pose.P[f.thigh], f.ankle, LEN.thigh, LEN.shin, _pole, true, _q, _q2);
      pose.setWorld(f.thigh, _q);
      pose.setWorld(f.shin, _q2);
      _qi.identity().slerp(pose.local[f.shin], 0.5);
      pose.setLocal(f.knee, _qi);
      euler(_q, f.pitch, f.yaw, 0);
      pose.setWorld(f.foot, _q);
      euler(_q, f.toe, 0, 0);
      pose.setLocal(f.toeB, _q);
    }
  }
}
