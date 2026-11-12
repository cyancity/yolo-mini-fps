import { R, rr, TAU, puff, chips } from './emit.js';

const STEP = 1 / 30;   // 每秒最多发 30 次，调用方每帧都调也不会越发越多
const MIN_SPEED = 1.2; // 比这慢就是快停下了，不再扬尘

// 各种地面滑过去扬起的尘：颜色、大小、浓度；null 是不起尘（喷气贴地的尘环也用这张表）
export const DUST = {
  asphalt: [0.34, 0.34, 0.35, 0.5, 0.26],
  concrete: [0.56, 0.54, 0.5, 0.55, 0.3],
  gravel: [0.55, 0.52, 0.47, 0.6, 0.34],
  carpet: [0.5, 0.47, 0.44, 0.45, 0.22],
  wood: [0.5, 0.44, 0.36, 0.45, 0.16],
  metal: [0.4, 0.4, 0.41, 0.4, 0.12],
  fabric: [0.46, 0.44, 0.4, 0.4, 0.12],
  glass: null,
  rubber: null,
};
// 这些露天地面淋湿了就甩水，不起尘
export const SPLASHY = { asphalt: 1, concrete: 1, metal: 1, gravel: 1, wood: 1 };

// 滑铲：脚下往两侧和前方贴地甩出一片水或尘，人往前滑走，留下的尘就拖在身后。
// pos：脚底位置；dir：滑行速度（不用归一化）；surface：脚下的材质名
export function emitSlideDust(fx, pos, dir, surface) {
  if (fx.time - fx.slideAt < STEP) return;
  const vx = dir.x, vz = dir.z, speed = Math.hypot(vx, vz);
  if (speed < MIN_SPEED) return;
  fx.slideAt = fx.time;
  const fx0 = vx / speed, fz0 = vz / speed, sx = -fz0, sz = fx0;
  const k = Math.min(1, (speed - MIN_SPEED) / 5);
  const kind = surface in DUST ? surface : 'concrete';
  // 接触点在身体前面一点（滑铲时脚伸在前头）
  const x = pos.x + fx0 * 0.45, y = pos.y + 0.03, z = pos.z + fz0 * 0.45;
  const wet = SPLASHY[kind] === 1 && fx.wetAt(x, pos.y, z);
  const st = fx.streaks;

  if (wet) {
    // 甩起的水：两侧各一把，贴地往外、略往前，落回脚下的地面
    const n = 3 + ((R() * 4 * k) | 0);
    for (let i = 0; i < n; i++) {
      const side = i & 1 ? 1 : -1, out = rr(0.6, 2.6) * (0.5 + k), fwd = speed * rr(0.35, 0.8);
      const j = st.spark(x + sx * side * rr(0.05, 0.2), y, z + sz * side * rr(0.05, 0.2),
        fx0 * fwd + sx * side * out, rr(0.9, 2.4) * (0.6 + 0.6 * k), fz0 * fwd + sz * side * out,
        rr(0.25, 0.45), rr(0.0035, 0.006), rr(0.02, 0.032), pos.y, 9.8, 0.6, 0);
      st.color(j, 0.75, 0.85, 1, rr(2.4, 4.2));
      st.lit(j);
    }
    // 一层贴地的水雾，留在原地慢慢散
    puff(fx, x + sx * rr(-0.3, 0.3), y + 0.06, z + sz * rr(-0.3, 0.3), fx0 * speed * 0.3, rr(0.2, 0.45), fz0 * speed * 0.3,
      rr(0.6, 1), 0.1, rr(0.45, 0.75), 0.18 + 0.14 * k, 0.8, 0.86, 0.94, 4, 0.08);
    // 湿碎石照样踢出石子
    if (kind === 'gravel') stones(fx, x, y, z, sx, sz, speed, DUST.gravel);
    return;
  }

  const c = DUST[kind];
  if (!c) return;
  // 贴地的尘：初速度跟着脚往前，被阻力拉住，留在身后慢慢摊开
  const n = 1 + (R() < 0.35 + 0.4 * k ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const side = R() < 0.5 ? -1 : 1, out = rr(0.2, 0.9);
    const p = puff(fx, x + sx * side * rr(0, 0.25), y + 0.04, z + sz * side * rr(0, 0.25),
      fx0 * speed * rr(0.25, 0.5) + sx * side * out, rr(0.1, 0.4), fz0 * speed * rr(0.25, 0.5) + sz * side * out,
      rr(0.9, 1.5), 0.08, c[3] * rr(0.8, 1.25) * (0.7 + 0.5 * k), c[4] * (0.6 + 0.6 * k), c[0], c[1], c[2], 3, 0.12);
    fx.puffs.motion(p, -0.05, 3, R() * TAU, rr(-0.4, 0.4), 1, 0.12);
  }
  // 碎石地上滚出几粒石子；混凝土上偶尔带出一点砂
  if (kind === 'gravel') stones(fx, x, y, z, sx, sz, speed, c);
  else if (kind === 'concrete' && R() < 0.25) chips(fx, x, y, z, sx * 0.7, 0.71, sz * 0.7, 1, 1.6 + speed * 0.2, 0.007, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8);
}

// 往一侧斜上方踢出一到三粒石子
function stones(fx, x, y, z, sx, sz, speed, c) {
  const side = R() < 0.5 ? -0.7 : 0.7;
  chips(fx, x, y, z, sx * side, 0.71, sz * side, 1 + ((R() * 3) | 0), 1.6 + speed * 0.2, 0.012, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8);
}
