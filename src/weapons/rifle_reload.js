// 步枪换弹的动作表。rifle.js 的 CUES 按这里的关键帧放拟音节点，改关键帧时要同步改 CUES：
// 战术换弹 0.52 抽匣（magOut）、1.40 入匣（magIn，子弹在这一刻算进去），共 2.1 秒；
// 空仓换弹 0.38 旧弹匣脱落（magOut，同一刻在世界里生成掉落的弹匣）、1.12 入匣、1.70 放枪机（boltRelease），共 2.5 秒。
// 姿态 = [x, y, z, 俯仰, 偏航, 滚转]（YXZ）：+俯仰 枪口上抬，+偏航 枪口左摆，+滚转 从枪后看逆时针。

export const RELOAD_END = { tactical: 2.1, empty: 2.5 };
const P0 = [0, 0, 0, 0, 0, 0];

// 整枪叠加在腰射姿态上的偏移：右手把枪往上提、枪口左上、顺时针侧过来，弹匣井转向镜头，左手的动作才看得见。
// 枪侧得越厉害，左前臂越往画面里翻：左手回到护木时枪必须已经回正一半以上，否则前臂的断口会露出来
// [t, 姿态, 张力]：张力 1 顺着弧线滑过，0 在这一帧停住；首尾两帧总是停住
const TILT = [-0.06, 0.07, -0.08, 0.45, 0.5, -0.7];
const tilt = (dx, dy, dz, rx, ry, rz) => [TILT[0] + dx, TILT[1] + dy, TILT[2] + dz, TILT[3] + rx, TILT[4] + ry, TILT[5] + rz];
export const RIFLE_POSE = {
  tactical: [
    [0, P0], [0.34, TILT, 0.4],
    [0.52, tilt(0, 0.004, 0, 0.02, 0, 0.02)], [0.66, tilt(0, -0.006, 0, -0.02, 0, -0.03), 0.6], [0.95, tilt(0.004, 0, 0, 0, 0, 0.03)],
    [1.34, tilt(0, -0.008, 0, -0.025, 0, -0.02), 0.5], [1.41, tilt(0, 0.012, 0, 0.05, 0, 0.03), 0], [1.56, TILT, 0.5], [2.1, P0],
  ],
  // 空仓：旧弹匣一脱落枪身轻了往上一弹；新匣拍进去以后往回立一点、推远一点，左手贴着机匣左侧拍拨片时不至于把整个画面挡住
  empty: [
    [0, P0], [0.34, TILT, 0.4],
    [0.42, tilt(0, 0.006, 0, 0.025, 0, 0.02)], [0.56, tilt(0, -0.004, 0, -0.01, 0, -0.02), 0.6], [0.85, tilt(0.004, 0, 0, 0, 0, 0.03)],
    [1.06, tilt(0, -0.008, 0, -0.025, 0, -0.02), 0.5], [1.13, tilt(0, 0.012, 0, 0.05, 0, 0.03), 0], [1.28, TILT, 0.5],
    [1.58, tilt(0.02, 0, -0.03, 0, 0, 0.25)], [1.7, tilt(0.024, -0.006, -0.028, -0.03, 0.02, 0.3), 0],
    [1.84, tilt(0.02, 0, -0.03, 0, 0, 0.27)], [2.5, P0],
  ],
};

// 弹匣相对插好时的偏移（枪坐标，绕匣口转），按换弹种类各一张。
// 战术：先顺着匣井直着抽出，再被左手带着往左下甩出画面，画面外换成新弹匣，原路送回井口，最后一推到底（多推 3 毫米再回弹，看得出是拍进去的）。
// 空仓：旧弹匣在 0.38 秒交给世界里的掉落道具（rifle.js），第一人称这一个直接跳到画面外的 GONE，当新弹匣用：
// 左手在那里捏住它，再走和战术换弹一样的路送回去
const OUT = [0, -0.068, 0, 0, 0, 0], GONE = [-0.11, -0.36, 0.1, 0.55, -0.2, 0.75], BACK = [-0.012, -0.11, 0.004, 0.16, -0.04, 0.18];
export const MAG_GONE = GONE;
export const MAG_DROP_T = 0.38; // 空仓换弹旧弹匣脱落的时刻，和 rifle.js 的 CUES.empty 里 magOut 节点一致（改这里要同步改 CUES）
export const MAG_POSES = {
  tactical: [
    [0.52, P0], [0.6, OUT, 0.5], [0.9, GONE, 0], [1.02, GONE, 0], [1.22, BACK], [1.31, [0, -0.07, 0, 0, 0, 0], 0.4],
    [1.4, [0, 0.003, 0, 0, 0, 0], 0], [1.47, P0],
  ],
  empty: [
    [0.3799, P0, 0], [0.38, GONE, 0], [0.74, GONE, 0], [0.94, BACK], [1.03, [0, -0.07, 0, 0, 0, 0], 0.4],
    [1.12, [0, 0.003, 0, 0, 0, 0], 0], [1.19, P0],
  ],
};

// 左手的落点：F 护木、M 弹匣（跟着弹匣走）、P 画面外取新匣的位置（弹匣在 GONE 时的 M）、B 空仓挂机拨片、b 拍拨片前离开一点的预备位。
// [落点, t, 中途绕开的偏移（枪坐标，过渡中点处最大）, 缓动]：两帧之间从前一个落点滑到后一个；
// 缓动默认两头慢，'in' 是越来越快（拍拨片要砸上去）
const AROUND = [-0.045, -0.06, 0.02];
export const HAND = {
  tactical: [['F', 0.06], ['M', 0.42, AROUND], ['M', 1.48], ['F', 1.98, AROUND]],
  // 空仓：左手不碰旧弹匣，离开护木直接往下去取新匣
  empty: [['F', 0.06], ['P', 0.5, AROUND], ['M', 0.74], ['M', 1.2], ['b', 1.58, [-0.03, -0.035, 0]], ['B', 1.7, null, 'in'], ['b', 1.8], ['F', 2.32, AROUND]],
};
// 手指：[t, 姿势]，两帧之间线性过渡
export const FINGERS = {
  tactical: [[0.06, 'foregrip'], [0.2, 'relaxed'], [0.34, 'relaxed'], [0.46, 'pinch'], [1.46, 'pinch'], [1.6, 'relaxed'], [1.9, 'relaxed'], [2.02, 'foregrip']],
  empty: [[0.06, 'foregrip'], [0.2, 'relaxed'], [0.42, 'relaxed'], [0.56, 'pinch'], [1.18, 'pinch'], [1.34, 'flat'], [1.82, 'flat'], [2.02, 'relaxed'], [2.22, 'relaxed'], [2.36, 'foregrip']],
};

// 关键帧样条：keys = [[t, 值数组, 张力], ...]，段内 Hermite 插值；关键帧处的速度取前后两帧的平均斜率再乘张力
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

const EASE = { smooth: (u) => u * u * (3 - 2 * u), in: (u) => u * u * u };

// 左手在 t 时刻处在哪一段：写进 out = { a, b, u, via }，a、b 是前后两个落点，u 是 0..1 的过渡进度
export function handSegment(keys, t, out) {
  let i = 0;
  while (i < keys.length - 1 && t >= keys[i + 1][1]) i++;
  const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
  out.a = a[0];
  out.b = b[0];
  out.u = b === a ? 0 : EASE[b[3] || 'smooth'](Math.min(1, Math.max(0, (t - a[1]) / (b[1] - a[1]))));
  out.via = b[2] || null;
  if (t < keys[0][1]) { out.b = out.a; out.u = 0; }
  return out;
}

// 手指在 t 时刻的两个姿势和混合比例
export function fingerBlend(keys, t, out) {
  let i = 0;
  while (i < keys.length - 1 && t >= keys[i + 1][0]) i++;
  const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
  out.a = a[1];
  out.b = b[1];
  out.u = b === a || t <= a[0] ? 0 : Math.min(1, (t - a[0]) / (b[0] - a[0]));
  return out;
}
