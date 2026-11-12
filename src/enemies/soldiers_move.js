// 人形敌人的移动：沿路点走、互相让开、和玩家一样的圆柱体碰撞（上台阶、贴墙滑），卡住了自己想办法。
// s 是单个敌人的记录，m 是 SoldierManager（用到 phys、nav、active、player、audio、time）。
export const SPEED = { walk: 1.5, run: 4.6, crouch: 1.2 };
// 身体能迈上的台阶比寻路网格的 NAV.STEP（0.42）宽几厘米：网格按 0.5 米一格、0.24 米的探针取落脚高度，
// 压型钢板屋面的肋（高 0.26）会把肋间 0.45 的挡水台算成 0.19 的小坎，身体走到肋间就迈不上去
const STEP = 0.48, GRAVITY = 17, ACCEL = 10, SEP = 1.15;
const LAND_VY = 3; // 落地竖直速度超过它（落差约 0.3 米以上）才屈膝
const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

export function locomote(s, dt, m) {
  const p = s.pos, v = s.vel, phys = m.phys, S = m.body.SOLDIER;
  let wx = 0, wz = 0, speed = s.speedWant;
  // 蹲着走不快
  speed = Math.min(speed, SPEED.run - (SPEED.run - SPEED.crouch) * Math.min(1, s.crouch * 1.4));
  if (s.pathN > s.pathI && speed > 0) {
    const path = s.path;
    let i3 = s.pathI * 3, dx = path[i3] - p.x, dz = path[i3 + 2] - p.z, d = Math.hypot(dx, dz);
    // 路点不是终点就提前转向，免得每个拐角都停一下
    while (s.pathI < s.pathN - 1 && d < 0.55) {
      s.pathI++;
      i3 = s.pathI * 3;
      dx = path[i3] - p.x; dz = path[i3 + 2] - p.z; d = Math.hypot(dx, dz);
    }
    const last = s.pathI === s.pathN - 1;
    if (last && d < 0.22) {
      s.pathN = 0;
      s.arrived = true;
    } else if (d > 1e-4) {
      if (last) speed = Math.min(speed, 0.4 + d * 2.5);
      wx = dx / d; wz = dz / d;
      // 不在战斗里时先转身再走：方向差太多就放慢，不会倒着溜
      if (s.state !== 'combat') {
        const face = Math.abs(wrap(Math.atan2(-wx, -wz) - s.yaw));
        if (face > 1.1) speed *= 0.25;
      } else {
        // 战斗中可以侧移、后退，但后退跑不快
        const rel = Math.abs(wrap(Math.atan2(-wx, -wz) - s.yaw));
        if (rel > 1.9) speed = Math.min(speed, 2.4);
      }
    }
  } else speed = 0;
  if (s.nudgeT > 0) {
    s.nudgeT -= dt;
    wx += s.nudge.x; wz += s.nudge.z;
    speed = Math.max(speed, 1.2);
  }
  let tx = wx * speed, tz = wz * speed;
  // 互相让开：只推开不吸引，路过时侧身让一下
  for (const o of m.active) {
    if (o === s || !o.alive || Math.abs(o.pos.y - p.y) > 1.5) continue;
    const dx = p.x - o.pos.x, dz = p.z - o.pos.z, d2 = dx * dx + dz * dz;
    if (d2 > SEP * SEP || d2 < 1e-6) continue;
    const d = Math.sqrt(d2), k = ((SEP - d) / SEP) * 3 / d;
    tx += dx * k; tz += dz * k;
  }
  const pl = m.player;
  if (pl) {
    const dx = p.x - pl.position.x, dz = p.z - pl.position.z, d2 = dx * dx + dz * dz;
    if (d2 < 1.2 * 1.2 && d2 > 1e-6 && Math.abs(pl.position.y - p.y) < 1.5) {
      const d = Math.sqrt(d2), k = ((1.2 - d) / 1.2) * 4 / d;
      tx += dx * k; tz += dz * k;
    }
  }
  // 加速度有上限：起步、转弯、急停都有过程
  let ax = tx - v.x, az = tz - v.z;
  const al = Math.hypot(ax, az), amax = ACCEL * dt * (s.grounded ? 1 : 0.2);
  if (al > amax) { ax *= amax / al; az *= amax / al; }
  v.x += ax; v.z += az;

  const px = p.x, pz = p.z, height = S.height + (S.crouchHeight - S.height) * s.crouch;
  p.x += v.x * dt;
  p.z += v.z * dt;
  phys.resolve(p, S.radius, p.y, p.y + height, s.grounded ? STEP : 0.12);
  if (dt > 0) {
    v.x = (p.x - px) / dt;
    v.z = (p.z - pz) / dt;
  }
  s.vy -= GRAVITY * dt;
  p.y += s.vy * dt;
  const g = phys.groundHeight(p.x, p.z, S.radius * 0.75, p.y, s.grounded ? STEP : 0.05);
  if (p.y <= g + 1e-3 && s.vy <= 0) {
    // 从月台边这种高度跳下来：落地屈膝缓一下（下蹲量随后由 act 收回去，约 0.3 秒），顺带吃掉一部分水平速度
    if (!s.grounded && s.vy < -LAND_VY) {
      s.crouch = Math.max(s.crouch, Math.min(0.75, (-s.vy - LAND_VY) * 0.22));
      v.x *= 0.55; v.z *= 0.55;
      m.audio?.play?.('npcStep', { position: p, surface: phys.groundSurface, volume: 0.9 });
    }
    p.y = g; s.vy = 0; s.grounded = true; s.surface = phys.groundSurface;
  } else if (s.grounded && s.vy <= 0 && p.y - g <= STEP) {
    p.y = g; s.vy = 0; s.surface = phys.groundSurface;
  } else s.grounded = false;
  if (p.y < -5) { p.y = 0; s.vy = 0; } // 掉出世界的保险

  unstick(s, dt, m);
  steps(s, dt, m);
}

// 卡住检测：想走却 0.7 秒没往当前路点靠近 0.15 米。先侧着挤一下，再重新寻路，实在不行吸到最近的网格点上。
// 只看挪没挪不够：侧挤本身就挪 0.3 米，挤完又被同一道坎挡回来，计数到不了吸附那一步
// （网格以为走得过去、身体过不去的坎）。换了路点、离路点不到 0.6 米都算有进展
function unstick(s, dt, m) {
  s.progT += dt;
  if (s.progT < 0.7) return;
  const trying = s.pathN > s.pathI && s.speedWant > 0.3;
  s.progT = 0;
  const i3 = s.pathI * 3, tx = s.path[i3], tz = s.path[i3 + 2];
  const d = Math.hypot(tx - s.pos.x, tz - s.pos.z);
  const same = s.progPos.x === tx && s.progPos.z === tz, gain = same ? s.progD - d : Infinity;
  s.progPos.set(tx, 0, tz);
  s.progD = d;
  if (!trying || gain > 0.15 || d < 0.6) { s.stuck = 0; return; }
  s.stuck++;
  if (s.stuck === 1) {
    const dx = tx - s.pos.x, dz = tz - s.pos.z, k = (Math.random() < 0.5 ? -0.8 : 0.8) / (d || 1);
    s.nudge.set(-dz * k, 0, dx * k);
    s.nudgeT = 0.45;
  } else if (s.stuck <= 3) {
    s.needPath = true;
  } else {
    const nav = m.nav, n = nav.ready ? nav.nearest(s.pos.x, s.pos.y, s.pos.z, 1.6) : -1;
    if (n >= 0) s.pos.set(nav.cx(n), nav.nY[n], nav.cz(n));
    s.needPath = true;
    s.stuck = 0;
  }
}

// 脚步声：离听者远了就不放，省得占满发声数
function steps(s, dt, m) {
  const sp = Math.hypot(s.vel.x, s.vel.z);
  if (!s.grounded || sp < 0.5) return;
  const before = Math.floor(s.stride);
  s.stride += (sp * dt) / (sp > 3 ? 1.15 : 0.78);
  if (Math.floor(s.stride) === before) return;
  const pl = m.player;
  if (pl && s.pos.distanceToSquared(pl.position) > 38 * 38) return;
  m.audio?.play?.('npcStep', { position: s.pos, surface: s.surface, volume: 0.3 + 0.55 * Math.min(1, sp / SPEED.run) * (1 - 0.5 * s.crouch) });
}
