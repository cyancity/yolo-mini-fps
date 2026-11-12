// 爪刀的姿态表和动作轨道。姿态 = holder 相对相机的 [x, y, z, 俯仰, 偏航, 滚转]（YXZ）。
// holder 原点在手腕，前臂沿它的 +Z 伸到 0.34 m 处的肘，那头是封口的断面，不能进画面。读表时这样想：
//   位置 = 手腕在哪；偏航为正 = 肘往右摆，俯仰为正 = 肘往下沉（肘只能从画面右边或下边出去）；
//   滚转 = 前臂自转：0 掌心朝下，−π/2 拇指朝上（刀从拳底伸出、钩尖朝前），−π 掌心朝上。
const PI = Math.PI;

export const KNIFE_TUNE = {
  idle: [0.14, -0.105, -0.32, 0.5, 0.75, -1.35],
  // 以下几项是叠在 idle 上的偏移：冲刺、滑铲（乘 player.slide）、探头（乘 player.lean）
  // 冲刺：摆臂的中点。拳头收在右下角贴近身体，比站着时低
  sprint: [0.03, -0.05, 0.04, 0.2, -0.3, -0.65],
  // 摆臂：相位跟着 player.stride 走（knife.js 里的 runPhase），一个来回是 2π。
  //   swing × sin φ = 前摆到顶（拳头往前往上往里送，肘往下沉）/ 后摆到底（拳头落到画面右下角外面，只露出指环）；
  //   lag × cos φ = 转动比位移慢半拍，拳头走的是个扁圈而不是一条线；bounce × cos 2φ = 每摆一下往下一顿
  run: {
    swing: [-0.018, 0.03, -0.045, 0.12, 0.05, 0.1],
    lag: [0.008, 0.004, 0.01, -0.04, 0.04, 0.08],
    bounce: [0, -0.004, 0, 0.02, 0, 0.015],
  },
  slide: [-0.02, 0.02, 0.03, 0.08, 0.05, -0.15],
  lean: [-0.012, 0, 0, 0, 0, 0],
  // 喷气（乘 env.state.tuck）：拳头收到胸前正下方，掌心翻过来、刀尖朝下护在身前；
  // dashLean 再乘 player.dashS，往哪边喷手就往反方向甩一点
  tuck: [-0.05, -0.015, 0.05, 0.12, 0.3, -0.85],
  dashLean: [-0.02, 0.004, 0, 0, -0.07, 0],
  // 左手扔烟雾弹（乘 KnifeToss.sag）：身子往左拧，持刀的手往右下让开一点
  toss: [0.014, -0.016, 0.012, 0.04, -0.05, 0.06],
  // 探头、滑铲、侧向喷气时镜头会侧倾，刀绕视线轴往回找一点，不跟着镜头一起歪到底
  leanRoll: 0.07, slideRoll: -0.03, dashRoll: 0.08,
  twist: [0, 0, 0],
};

const IDLE = KNIFE_TUNE.idle;
// 动作的关键帧按绝对姿态写（好对着画面想），存成相对 idle 的偏移；[t, 姿态, 张力]
const key = (t, pose, tension) => [t, pose.map((v, i) => v - IDLE[i]), tension];
const REST = [0, 0, 0, 0, 0, 0];

export const DRAW_T = 0.72, HOLSTER_T = 0.22;
// 切枪被打断时用的几个时间：RAISE_T = 收到底又被取消、举回来要多久（只收了一点的按比例更短）；
// HOLSTER_MIN = 刀还没怎么举起来就收，最短按 HOLSTER_T 的这个比例算；
// SNAP_T / SNAP_DIP = 喷气途中切过来没有掏刀动作，刀从略低处（收刀姿态的这个比例）弹到位的时间
export const RAISE_T = 0.24, HOLSTER_MIN = 0.3, SNAP_T = 0.1, SNAP_DIP = 0.3;
// 掏刀：手从右下方抬进画面，刀挂在食指上转一圈，转到位五指一合；收刀是在当前姿态上叠 DRAW.pose[0]（画面外的起点）
export const DRAW = {
  pose: [[0, [0.04, -0.22, 0.06, 0.5, -0.3, 0.4]], [0.2, [0.01, -0.03, 0, 0.15, -0.1, 0.25]], [0.5, [0, 0.008, -0.01, 0.05, 0, 0], 0], [DRAW_T, REST]],
  spin: [[0.12, -PI * 2], [0.48, 0, 'out']],
  open: [[0, 1], [0.4, 1], [0.52, 0]],
};

// 每个动作：时长 t、命中时刻 hit、伤害 dmg、挥空声时刻 sound；
// swing = 出手时给镜头的 [俯仰, 偏航] 冲量，punch = 命中时给视图模型的 [后退, 上跳, 俯仰, 偏航, 滚转] 冲量。
// 命中那一帧刀身正好扫过屏幕中心（dev/knife.js 的 check 里 atHit.gap 接近 0）
export const MOVES = {
  // 正手：拳头先往右上一收、刀尖朝左蓄住，再斜着往左下扫过中心，钩尖领先
  slashA: {
    t: 0.5, hit: 0.15, dmg: 55, sound: 0.06, swing: [0.01, 0.07], kick: [-0.05, 0.12], punch: [0.3, 0, -0.25, 0.3, 0.6],
    pose: [
      [0, REST],
      key(0.085, [0.21, 0, -0.28, 0.25, 0.45, -2.3], 0.4),
      key(0.15, [0.103, -0.027, -0.4, 0.55, 1, -2.75]),
      // 收势时肘往下沉，前臂从画面底边出去，断面离画面边缘留几厘米
      key(0.21, [-0.03, -0.08, -0.39, 0.68, 1.15, -2.85]),
      key(0.3, [-0.08, -0.13, -0.35, 0.7, 1.22, -2.75], 0.5),
      [0.5, REST],
    ],
  },
  // 反手：拳头沉到左下、刀尖朝右，再往右上撩过中心
  slashB: {
    t: 0.5, hit: 0.16, dmg: 55, sound: 0.07, swing: [0.01, -0.07], kick: [-0.05, -0.12], punch: [0.3, 0, -0.25, -0.3, -0.6],
    pose: [
      [0, REST],
      key(0.1, [-0.12, -0.125, -0.32, 0.7, 0.68, -0.4], 0.4),
      key(0.16, [-0.064, -0.07, -0.38, 0.75, 0.4, 0.6]),
      key(0.23, [0.06, -0.01, -0.38, 0.7, 0.3, 0.95]),
      key(0.31, [0.12, -0.01, -0.35, 0.62, 0.25, 1.05], 0.5),
      [0.5, REST],
    ],
  },
  // 重击：先往下一沉蓄力，再把拳头举到右上方、刀尖朝左，然后整条胳膊往左下砸，钩住停一下再收
  heavy: {
    t: 1.02, hit: 0.4, dmg: 140, sound: 0.3, pitch: 0.8, swing: [-0.03, 0.03], kick: [-0.09, 0.06], punch: [0.5, -0.1, -0.5, 0.2, 0.5],
    pose: [
      [0, REST],
      key(0.12, [0.16, -0.13, -0.28, 0.6, 0.6, -1.6]),
      key(0.3, [0.15, -0.01, -0.28, 1.1, 0.35, -2.3], 0.6),
      key(0.4, [0.109, -0.024, -0.42, 0.85, 0.65, -2.35]),
      key(0.5, [0, -0.1, -0.38, 0.62, 0.9, -2.6], 0.4),
      key(0.68, [-0.01, -0.11, -0.36, 0.6, 0.92, -2.55], 0),
      [1.02, REST],
    ],
  },
  inspect: {
    t: 3.9, cancel: true, cues: [[0.42, 'knifeSpin', 0.6]],
    // 两个展示姿态：掌心朝镜头（转刀、握住后手腕慢慢一拧让刀面扫过灯光），然后翻成拳背朝镜头
    pose: [
      [0, REST],
      key(0.5, [0.06, -0.03, -0.24, 0.35, 1.45, -1.5], 0),
      key(1.45, [0.06, -0.03, -0.24, 0.35, 1.43, -1.48]),
      key(1.8, [0.065, -0.035, -0.245, 0.3, 1.36, -1.72]),
      key(2.1, [0.06, -0.025, -0.24, 0.33, 1.4, -1.45], 0),
      // 拳背朝镜头时前臂再往外拧一点，刀面才对着镜头，不是一条细边
      key(2.7, [0.03, -0.1, -0.26, 1.15, 0.15, 0.15], 0),
      key(3.05, [0.032, -0.1, -0.26, 1.1, 0.26, 0.03]),
      key(3.4, [0.03, -0.095, -0.26, 1.12, 0.2, 0.2], 0),
      [3.9, REST],
    ],
    // 指环转刀：三圈，收回握住
    spin: [[0.45, 0], [1.35, PI * 6, 'inOut']],
    open: [[0.3, 0], [0.46, 1], [1.26, 1], [1.4, 0]],
  },
};

// 关键帧样条：keys = [[t, 值数组, 张力], ...]。段内 Hermite 插值，关键帧处的速度取前后两帧的平均斜率再乘张力：
// 1（默认）= 顺着弧线滑过去，0 = 在这一帧停住。首尾两帧总是停住，所以动作从静止起、到静止收。
export function spline(keys, t, out) {
  const n = keys.length, last = keys[n - 1];
  if (t <= keys[0][0] || t >= last[0]) {
    const v = t <= keys[0][0] ? keys[0][1] : last[1];
    for (let c = 0; c < out.length; c++) out[c] = v[c];
    return out;
  }
  let i = 1;
  while (t > keys[i][0]) i++;
  const a = keys[i - 1], b = keys[i], h = b[0] - a[0], s = (t - a[0]) / h, s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = (s3 - 2 * s2 + s) * h, h01 = 3 * s2 - 2 * s3, h11 = (s3 - s2) * h;
  const p = i > 1 ? keys[i - 2] : null, q = i < n - 1 ? keys[i + 1] : null;
  const ka = p ? (a[2] ?? 1) / (b[0] - p[0]) : 0, kb = q ? (b[2] ?? 1) / (q[0] - a[0]) : 0;
  for (let c = 0; c < out.length; c++) {
    const ma = p ? (b[1][c] - p[1][c]) * ka : 0, mb = q ? (q[1][c] - a[1][c]) * kb : 0;
    out[c] = h00 * a[1][c] + h10 * ma + h01 * b[1][c] + h11 * mb;
  }
  return out;
}

// 一维滑移：从现在的值和现在的速度出发，T 秒后到 x1（到达那一刻的速度是 v1）。
// 半路改目标时速度接着用，所以收刀、取消、再收这样连着打断，位置和速度都不会跳
export class Glide {
  constructor(x = 0) { this.set(x); }

  set(x) {
    this.x = this.a = this.b = x;
    this.v = this.ma = this.mb = 0;
    this.T = this.t = 0;
  }

  get target() { return this.b; }

  to(x1, T, v1 = 0) {
    this.T = Math.max(T, 1e-3);
    this.t = 0;
    this.a = this.x;
    this.b = x1;
    this.ma = this.v * this.T;
    this.mb = v1 * this.T;
  }

  update(dt) {
    if (this.t >= this.T) return this.x;
    this.t += dt;
    if (this.t >= this.T) {
      this.x = this.b;
      this.v = 0;
      return this.x;
    }
    const s = this.t / this.T, s2 = s * s, s3 = s2 * s;
    this.x = (2 * s3 - 3 * s2 + 1) * this.a + (s3 - 2 * s2 + s) * this.ma + (3 * s2 - 2 * s3) * this.b + (s3 - s2) * this.mb;
    this.v = ((6 * s2 - 6 * s) * (this.a - this.b) + (3 * s2 - 4 * s + 1) * this.ma + (3 * s2 - 2 * s) * this.mb) / this.T;
    return this.x;
  }
}

// 临界阻尼跟随：s = { x, v } 朝 target 靠，起步和到位都没有速度突变（一阶的 damp 起步那一下是硬的）
export function follow(s, target, omega, dt) {
  const d = s.x - target, e = Math.exp(-omega * dt), j = (s.v + omega * d) * dt;
  s.x = target + (d + j) * e;
  s.v = (s.v - omega * j) * e;
  return s.x;
}
