// 遮挡：听者和声源之间有没有墙、楼板、集装箱挡着。结果是一个档位：
// 0 没挡；0.5 只挡了下半截（矮掩体、栏杆，抬高 0.8 米再看就通了，声音从上面绕过来）；1 隔着墙；2 隔着楼板（上下差一层）。
// 射线每 16 ms 最多打 RAYS 条，超出时返回 -1（单发的音当没挡，循环音沿用上一次的结果）；重要的声音（force，枪声、爆炸）
// 不受这个限制。同一处刚问过的直接用缓存，一个敌人连着走几步、一梭子弹落在一块，只打一条
const RAYS = 16;     // 一次判定（两条射线）实测约 6 微秒
const WINDOW = 16;     // 毫秒
const KEEP = 250;      // 缓存多久（毫秒）
const NEAR2 = 1.5 * 1.5; // 离缓存里的声源和听者都在 1.5 米内才算同一处
const CACHE = 12;
const LIFT = 0.3;      // 声源先往上抬一点：脚步和地上的弹着点贴着地面，射线会擦着楼板边判成挡住
const OVER = 0.8;      // 第一条被挡时，第二条再抬这么高
export const FLOOR_DY = 2.5;

// 每个档位的低通上限（Hz）和增益
const SHAPE = { 0: [Infinity, 1], 0.5: [2600, 0.7], 1: [1100, 0.45], 2: [650, 0.3] };
export const occCut = (occ) => SHAPE[occ][0];
export const occGain = (occ) => SHAPE[occ][1];

const _d = { x: 0, y: 0, z: 0 };

export class Occluder {
  constructor() {
    this.phys = null;
    this.cache = [];
    this.win = 0;
    this.used = 0;
    this.rays = 0; // 累计打了多少条，调试用
  }

  _clear(phys, l, x, y, z) {
    _d.x = x - l.x; _d.y = y - l.y; _d.z = z - l.z;
    const len = Math.hypot(_d.x, _d.y, _d.z);
    if (len < 0.3) return true;
    _d.x /= len; _d.y /= len; _d.z /= len;
    this.rays++;
    // 用 rayDist 而不是 blocked：blocked 把烟团也算成遮挡，烟挡得住视线挡不住声音
    const hit = phys.rayDist(l, _d, len);
    return hit < 0 || hit >= len - 0.05;
  }

  // lift：声源往上抬多少再打射线；吊在顶棚下的灯具要传负数（往下挪），不然点落进楼板里
  test(l, p, force = false, lift = LIFT) {
    const phys = this.phys;
    if (!phys?.rayDist) return 0;
    const now = performance.now();
    for (const c of this.cache) {
      if (now - c.t > KEEP) continue;
      const dp = (c.px - p.x) ** 2 + (c.py - p.y) ** 2 + (c.pz - p.z) ** 2, dl = (c.lx - l.x) ** 2 + (c.ly - l.y) ** 2 + (c.lz - l.z) ** 2;
      if (dp < NEAR2 && dl < NEAR2) return c.occ;
    }
    if (now - this.win > WINDOW) { this.win = now; this.used = 0; }
    if (this.used >= RAYS && !force) return -1;
    this.used++;
    let occ = 0;
    if (!this._clear(phys, l, p.x, p.y + lift, p.z)) {
      this.used++;
      occ = lift >= 0 && this._clear(phys, l, p.x, p.y + lift + OVER, p.z) ? 0.5 : Math.abs(p.y - l.y) > FLOOR_DY ? 2 : 1;
    }
    const c = this.cache.length < CACHE ? {} : this.cache.reduce((a, b) => (a.t < b.t ? a : b));
    if (this.cache.length < CACHE) this.cache.push(c);
    Object.assign(c, { t: now, px: p.x, py: p.y, pz: p.z, lx: l.x, ly: l.y, lz: l.z, occ });
    return occ;
  }
}
