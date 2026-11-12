import { TILT_DOWN } from './target_model.js';
import { RAIL_HALF } from './target_layout.js';

// 击倒后多久自己立起来；起倒靶每次露头多久（从开始立起算）
export const DOWN_TIME = 2.5, POP_TIME = 2.5;
// 移动靶：步行速度横移，到头前减速掉头
export const MOVE_SPEED = 1.4;
const MOVE_ACC = 5, TURN = RAIL_HALF - (MOVE_SPEED * MOVE_SPEED) / (2 * MOVE_ACC);
// 倒下：重心约 1.1 m 高的倒立摆，角加速度 ≈ g / l · sin(仰角)
const G_FALL = 11, BOUNCE = 0.28;
// 中弹后前后摇、左右扭：两组阻尼弹簧，一秒左右停稳
const ROCK_K = 150, ROCK_C = 6.5, TWIST_K = 110, TWIST_C = 5.5;
// 立起来的电机：略欠阻尼，到位时往前点一下头再停
const RISE_K = 45, RISE_C = 9.5;
// 立到这个仰角以内才算重新上靶、可以挨打
const LIVE_TILT = 0.5;

// 推进一块靶子一帧。状态：up 立着，fall 正在倒，down 躺着，rise 正在立起
export function stepTarget(t, dt) {
  t.timer += dt;
  t.rockV += (-ROCK_K * t.rock - ROCK_C * t.rockV) * dt;
  t.rock += t.rockV * dt;
  t.twistV += (-TWIST_K * t.twist - TWIST_C * t.twistV) * dt;
  t.twist += t.twistV * dt;
  if (t.state === 'fall') {
    t.tiltV += G_FALL * Math.sin(Math.max(t.tilt, 0.05)) * dt;
    t.tilt += t.tiltV * dt;
    if (t.tilt >= TILT_DOWN) {
      // 砸到地上弹一两下
      t.tilt = TILT_DOWN;
      if (t.tiltV > 1.2) t.tiltV *= -BOUNCE;
      else { t.tiltV = 0; t.state = 'down'; }
    }
  } else if (t.state === 'rise') {
    t.tiltV += (-RISE_K * t.tilt - RISE_C * t.tiltV) * dt;
    t.tilt += t.tiltV * dt;
    if (!t.alive && t.tilt < LIVE_TILT) t.alive = true;
    if (Math.abs(t.tilt) < 0.004 && Math.abs(t.tiltV) < 0.05) {
      t.tilt = t.tiltV = 0;
      t.state = 'up';
    }
  }
  if (t.type === 'mover') {
    if (t.s > TURN && t.vt > 0) t.vt = -MOVE_SPEED;
    else if (t.s < -TURN && t.vt < 0) t.vt = MOVE_SPEED;
    const a = MOVE_ACC * dt;
    t.v += Math.max(-a, Math.min(a, t.vt - t.v));
    t.s += t.v * dt;
  }
}
