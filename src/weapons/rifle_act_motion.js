// 步枪动作共用的小件：一维滑移（掏枪收枪）、二阶跟随（各种权重的淡入淡出）、残留姿态的淡出
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smooth = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };

// 一维滑移：从现在的值和现在的速度出发，T 秒后到 x1（到达那一刻的速度是 v1）。
// 半路改目标时速度接着用，收枪、取消、再收这样连着打断，位置和速度都不跳
export class Glide {
  constructor(x = 0) { this.set(x); }

  set(x) {
    this.x = this.a = this.b = x;
    this.v = this.ma = this.mb = 0;
    this.T = this.t = 0;
  }

  get target() { return this.b; }
  get done() { return this.t >= this.T; }

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

// 临界阻尼跟随：s = { x, v } 朝 target 靠，起步和到位都没有速度突变（一阶 damp 起步那一下是硬的）
export function follow(s, target, omega, dt) {
  const d = s.x - target, e = Math.exp(-omega * dt), j = (s.v + omega * d) * dt;
  s.x = target + (d + j) * e;
  s.v = (s.v - omega * j) * e;
  return s.x;
}

// 被打断的动作留下的姿态偏移：记下这一刻的量，在 T 秒里淡到 0，枪不会一帧跳回原位
export class Carry {
  constructor(T = 0.18) {
    this.T = T;
    this.t = T;
    this.pose = [0, 0, 0, 0, 0, 0];
  }

  get weight() { return this.t < this.T ? 1 - smooth(this.t / this.T) : 0; }

  // 把 pose（再加上还没淡完的旧残留）记成新的残留
  grab(pose) {
    const w = this.weight;
    for (let i = 0; i < 6; i++) this.pose[i] = this.pose[i] * w + pose[i];
    this.t = 0;
  }

  update(dt) { this.t = Math.min(this.T, this.t + dt); }

  add(out) {
    const w = this.weight;
    if (w > 0) for (let i = 0; i < 6; i++) out[i] += this.pose[i] * w;
  }

  clear() { this.t = this.T; }
}
