// 步枪冲刺姿态：枪斜挎在胸前、两只手都在枪上，跟着步子松松地晃，肩膀带着整把枪轻轻转
import * as THREE from 'three';
import { follow, smooth, clamp01 } from './rifle_act_motion.js';

// 姿态 = [x, y, z, 俯仰, 偏航, 滚转]（YXZ），都是叠在冲刺基础姿态上的偏移
export const RUN = {
  // 冲刺基础姿态（holder 相对相机，和腰射之间按冲刺程度混合）：枪斜挎在胸前、往左歪着，枪口朝左下，
  // 右手连握把在画面右侧，左手托着护木在左下；枪托从右边出画面，离镜头至少 0.2 米，两只手前臂的断口都在画面外
  carry: [0.135, -0.072, -0.29, -0.42, 0.85, 0.9],
  // 左右晃（乘 sin 相位）：枪跟着身体往两边摆，滚转比偏航大，像挎在胸前甩
  swing: [0.011, 0.003, 0, 0.012, 0.05, 0.075],
  // 滞后（乘 cos 相位）：转动比位移晚四分之一拍，枪才显得是被手带着走，不是焊在镜头上
  lag: [0.002, 0, 0.005, 0.03, 0.012, -0.035],
  // 落脚（乘 cos 两倍相位）：每落一脚枪往下一沉、枪口点一下
  bounce: [0, 0.006, 0.002, 0.026, 0, 0.008],
  // 肩膀：整把枪连同两只手绕胸口转。[俯仰, 偏航, 滚转] 的幅度，偏航、滚转乘 sin，俯仰乘 cos 两倍相位
  shoulder: [0.012, 0.022, 0.04],
  pivot: [0.02, -0.32, 0.12],
  // 冲刺时视图模型自带的 8 字晃动太硬：抵掉这个比例，换成上面这套松的
  calmBob: 0.55,
};

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _v = new THREE.Vector3();

export class RunCycle {
  constructor() {
    this.w = { x: 0, v: 0 };
    this.phase = 0;
    this.cadence = 0;
    this.strideAt = null;
  }

  reset(player) {
    this.w.x = this.w.v = 0;
    this.phase = 0;
    this.cadence = 0;
    this.strideAt = player?.stride || 0;
  }

  get weight() { return clamp01(this.w.x); }

  // want：这一帧是不是在冲刺（换弹时不摆冲刺姿态）；quick：要开火或开镜，收回来得快一点。
  // quick 的 32：权重 0.1 秒内降到 0.2 以下（rifle.js 的 RUN_READY），冲刺转开火最多等 6 帧
  update(dt, player, want, quick = false) {
    follow(this.w, want ? 1 : 0, want ? 10 : quick ? 32 : 13, dt);
    // 相位跟着 player.stride 走：正常步频两步一个来回；冲刺步频每秒六步，按原样摆像抽搐，放慢到四步一个来回
    const stride = player.stride || 0;
    if (this.strideAt === null) this.strideAt = stride;
    const ds = stride - this.strideAt;
    this.strideAt = stride;
    if (ds > 0 && ds < 1 && dt > 0) {
      this.cadence += (ds / dt - this.cadence) * Math.min(1, dt * 6);
      this.phase += Math.PI * ds * (1 - 0.5 * smooth((this.cadence - 4) / 1.2));
    }
    this.amp = this.weight * Math.min(1, player.moveAmount ?? 1);
  }

  // 晃动叠到姿态上；k 是额外的权重（开镜时为 0）
  add(pose, k) {
    const a = this.amp * k;
    if (a < 1e-4) return;
    const s = Math.sin(this.phase), c = Math.cos(this.phase), b = Math.cos(2 * this.phase);
    for (let i = 0; i < 6; i++) pose[i] += (RUN.swing[i] * s + RUN.lag[i] * c + RUN.bounce[i] * b) * a;
  }

  // 肩膀转动：holder 绕胸口的支点转，两只手跟着枪一起走
  shoulder(holder, k) {
    const a = this.amp * k;
    if (a < 1e-4) return;
    const s = Math.sin(this.phase), b = Math.cos(2 * this.phase), S = RUN.shoulder;
    _q.setFromEuler(_e.set(S[0] * b * a, S[1] * s * a, S[2] * s * a, 'YXZ'));
    _p.fromArray(RUN.pivot);
    holder.position.sub(_p).applyQuaternion(_q).add(_p);
    holder.quaternion.premultiply(_q);
  }

  // 抵掉视图模型 8 字晃动的一部分（viewmodel.js 按 player.stride 和 bobAmp 算的那一套，这里按同一个式子反着来）
  calm(holder, vm, player, ads, k) {
    const a = RUN.calmBob * this.weight * k;
    if (a < 1e-4 || !vm) return;
    const calm = 1 - 0.86 * ads, amp = (vm.bobAmp || 0) * calm, ph = Math.PI * (player.stride || 0);
    const bx = Math.sin(ph) * 0.0085 * amp, by = -Math.abs(Math.sin(ph)) * 0.0075 * amp + 0.004 * amp;
    // root = T(bob) · R(bob)，holder 在它下面：左乘 R⁻¹ · T⁻¹ 的 a 倍
    _q.setFromEuler(_e.set(0, -bx * 1.2 * a, -bx * 2.2 * a, 'YXZ'));
    holder.position.sub(_v.set(bx * a, by * a, 0)).applyQuaternion(_q);
    holder.quaternion.premultiply(_q);
  }
}
