import { R, rr, TAU, D, spray, puff } from './emit.js';

const OWN_RANGE2 = 2.5 * 2.5; // 离镜头这么近的枪口焰算玩家自己的
const FAR2 = 28 * 28;         // 再远就看不清烟和火药星了，只留火焰

// 枪口焰：正面火焰精灵 + 前向和侧向火舌 + 光晕 + 一缕烟 + 几点未燃尽的火药。
// opts.enemy：敌人开的枪；opts.light：false 不动枪口灯，true 当成玩家的枪口焰优先用灯
export function emitMuzzleFlash(fx, pos, dir, scale, opts) {
  const x = pos.x, y = pos.y, z = pos.z, dx = dir.x, dy = dir.y, dz = dir.z;
  const g = fx.glow, st = fx.streaks;
  const d2 = fx.dist2(x, y, z), near = d2 < FAR2;
  const own = opts.light === true || (!opts.enemy && d2 < OWN_RANGE2);
  // 垂直于枪管的一组基：right = dir × up，up2 = right × dir
  let rx = -dz, ry = 0, rz = dx;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-4) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }
  const ux = ry * dz - rz * dy, uy = rz * dx - rx * dz, uz = rx * dy - ry * dx;

  // 每枪换图集格、转角和大小，连发时不重样。敌人的焰在远处撑大一点，二三十米外也看得出谁在开枪
  const grow = opts.enemy ? Math.min(2.4, Math.max(1, Math.sqrt(d2) / 14)) : 1;
  const s = 0.13 * scale * grow * rr(0.8, 1.25);
  let i = g.emit(x + dx * 0.05 * scale, y + dy * 0.05 * scale, z + dz * 0.05 * scale, 0, 0, 0, 0.04, s, s * 1.3, 1, (R() * 4) | 0);
  g.tint(i, 11, 8.5, 6, 6, 3, 1.2);
  g.motion(i, 0, 0, R() * TAU, 0);
  i = g.emit(x + dx * 0.03, y + dy * 0.03, z + dz * 0.03, 0, 0, 0, 0.05, 0.2 * scale * grow, 0.28 * scale * grow, 1, 4);
  g.tint(i, 2.2, 1.1, 0.4, 1.2, 0.45, 0.1);

  // 前向主火舌
  const fl = rr(0.25, 0.4) * scale;
  i = st.dash(x, y, z, dx * fl, dy * fl, dz * fl, 0.035, 0.03 * scale);
  st.color(i, 1, 0.8, 0.5, 12);
  // 消焰器开孔喷出的侧向火舌：左、右、上三个方向里随机出两到三条
  const skip = R() < 0.4 ? (R() * 3) | 0 : -1;
  for (let k = 0; k < 3; k++) {
    if (k === skip) continue;
    const a = (k === 0 ? 0 : k === 1 ? Math.PI : Math.PI * 0.5) + rr(-0.35, 0.35);
    const ca = Math.cos(a) * 0.65, sa = Math.sin(a) * 0.65, len = rr(0.1, 0.2) * scale;
    i = st.dash(x, y, z, (dx * 0.35 + rx * ca + ux * sa) * len, (dy * 0.35 + ry * ca + uy * sa) * len,
      (dz * 0.35 + rz * ca + uz * sa) * len, 0.03, 0.02 * scale);
    st.color(i, 1, 0.75, 0.42, 9);
  }

  if (near) {
    if (R() < 0.7) {
      const v = rr(0.8, 2);
      puff(fx, x + dx * 0.08, y + dy * 0.08, z + dz * 0.08, dx * v, dy * v + 0.25, dz * v, rr(0.5, 0.9), 0.025, 0.16 * scale, 0.16, 0.55, 0.55, 0.58, 4);
    }
    const sparks = 1 + ((R() * 3) | 0);
    for (let k = 0; k < sparks; k++) {
      spray(dx, dy, dz, 0.22);
      const v = rr(8, 16);
      i = st.spark(x, y, z, D.x * v, D.y * v, D.z * v, rr(0.08, 0.2), 0.0018, 0.012);
      st.color(i, 1, 0.8, 0.5, 6, 1, 0.4, 0.1);
    }
  }
  if (opts.light !== false) fx.kickMuzzle(x + dx * 0.12, y + dy * 0.12, z + dz * 0.12, (own ? 90 : 60) * scale * rr(0.8, 1.15), own);
}

// 爆炸：闪光 + 火球（发热的烟团冷却成黑烟）+ 黑烟柱 + 贴地尘环 + 火花 + 带烟尾的碎片 + 焦痕
export function emitExplosion(fx, point, scale) {
  const x = point.x, z = point.z, s = scale;
  const ground = fx.floorAt(x, point.y + 0.2, z);
  const onGround = point.y - ground < 1.2 * s;
  const y = Math.max(point.y, ground + 0.25 * s);
  const g = fx.glow, p = fx.puffs, st = fx.streaks;
  let i;

  for (let k = 0; k < 3; k++) {
    i = g.emit(x, y + 0.3 * s, z, 0, 0, 0, 0.12, 1.3 * s, 2.6 * s, 1, (R() * 4) | 0);
    g.tint(i, 34, 24, 12, 12, 5, 1.5);
    g.motion(i, 0, 0, R() * TAU, 0);
  }
  i = g.emit(x, y + 0.3 * s, z, 0, 0, 0, 0.25, 3.5 * s, 6 * s, 1, 4);
  g.tint(i, 3.5, 1.8, 0.6, 1.2, 0.4, 0.1);

  for (let k = 0; k < 12; k++) {
    spray(0, 1, 0, 1);
    const v = rr(2, 6) * s;
    i = p.emit(x + D.x * 0.4 * s, y + D.y * 0.4 * s, z + D.z * 0.4 * s, D.x * v, D.y * v + 1.2, D.z * v,
      rr(1.2, 2), 0.5 * s, rr(1.6, 2.4) * s, 0.95, (R() * 4) | 0);
    p.tint(i, 0.07, 0.065, 0.06, 0.05, 0.05, 0.05);
    // 负重力 = 热气上浮
    p.motion(i, -0.6, 2.2, R() * TAU, rr(-0.6, 0.6), 1, 0);
    p.heat(i, rr(1, 1.2), rr(0.4, 0.55));
  }
  for (let k = 0; k < 9; k++) {
    i = p.emit(x + rr(-0.5, 0.5) * s, y + rr(0, 0.8) * s, z + rr(-0.5, 0.5) * s, rr(-0.5, 0.5), rr(1, 2.4), rr(-0.5, 0.5),
      rr(2.6, 4.2), 0.7 * s, rr(2.6, 3.8) * s, 0.8, (R() * 4) | 0);
    p.tint(i, 0.045, 0.045, 0.05);
    p.motion(i, -0.25, 0.9, R() * TAU, rr(-0.3, 0.3), 1, 0.2);
  }
  if (onGround) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU + rr(-0.3, 0.3), v = rr(4, 7) * s, ca = Math.cos(a), sa = Math.sin(a);
      i = p.emit(x + ca * 0.4 * s, ground + 0.15, z + sa * 0.4 * s, ca * v, 0.3, sa * v, rr(1, 1.6), 0.3 * s, rr(1.1, 1.6) * s, 0.3, (R() * 4) | 0);
      p.tint(i, 0.42, 0.4, 0.37);
      p.motion(i, 0, 3.2, R() * TAU, rr(-0.5, 0.5), 1, 0.05);
    }
    fx.decals.add(x, ground, z, 0, 1, 0, 3, 2.8 * s, 2.8 * s, R() * TAU, 1, 1, 1, 0, 1.6, 0);
  }

  const sparks = Math.min(110, Math.round(75 * s));
  for (let k = 0; k < sparks; k++) {
    spray(0, 1, 0, 1.6);
    const v = rr(5, 22) * Math.sqrt(s);
    i = st.spark(x, y, z, D.x * v, D.y * v + 2, D.z * v, rr(0.35, 1.1), rr(0.003, 0.006), rr(0.02, 0.035), ground, 9.8, 1.4, 1);
    st.color(i, 1, 0.8, 0.5, rr(8, 16), 1, 0.3, 0.05);
  }
  for (let k = 0; k < 10; k++) {
    spray(0, 1, 0, 1.2);
    const v = rr(5, 12) * Math.sqrt(s);
    i = st.ember(x, y, z, D.x * v, D.y * v + 3, D.z * v, rr(1.1, 2), rr(0.008, 0.014), 0.03, ground);
    st.color(i, 1, 0.62, 0.25, rr(5, 9), 1, 0.25, 0.04);
  }
  fx.kickBlast(x, y + 1.3 * s, z, 4000 * s);
}
