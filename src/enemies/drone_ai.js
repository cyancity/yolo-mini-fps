import * as THREE from 'three';
import { DRONE_BOUNDS as B, clampBounds } from './drone_nav.js';
import { CONTACT } from './contact.js';
import { TUNE } from './tuning.js';

// 单架无人机每帧的五步：think（感知和决策）→ fly（飞行）→ pose（姿态）→ aim（云台）→ fire（点射）。
// 状态：enter 进场 → engage 悬停交火 ⇄ dive 俯冲掠过；连续 droneLeave 秒看不见玩家就 leave 撤离（drones.js 飞远了回收）。
// m 是 DroneManager，这里用到它的 phys、nav、drones、time、shared、firing、divers、attackers、nextFireT、audio、shoot。

export const BULLET_SPEED = 110, RANGE = 38;
const SIGHT = 60, SHOT_GAP = 0.09; // 开火前的预警时长在 tuning.js 的 droneWarn
const CLEAR = 1.5, HARD = 0.6; // 巡航时离障碍顶面的高度；任何时候都不许低于的高度
const CLIMB = 6, SINK = 4, SEP = 2.6;
const LOOK = [0.25, 0.5, 0.85];
const SEEK_ALT = [2.4, 3, 4, 5.5, 7];
const QUIET = 5; // 开波后这么久不先开火：除非玩家先打了它，或者已经有士兵接敌
const DOOR_R = 28, DOOR_TRY = 8; // 玩家在室内时，在他周围这么远的楼外贴墙点里抽几个试视线
// 悬停点离目标的最近水平距离：再近就是堵在集装箱口、门口两三米外往里打，玩家躲进去也躲不开
const NEAR_MIN = 6;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion();
const clamp = THREE.MathUtils.clamp;
const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
const turn = (cur, want, max) => cur + clamp(wrap(want - cur), -max, max);
const ease = (dt, rate) => 1 - Math.exp(-dt * rate);
// 守区域的无人机的地盘：巡逻椭圆外扩 m 米。小于 1 在地盘里
const reach = (h, x, z) => Math.hypot((x - h.x) / (h.rx + h.m), (z - h.z) / (h.rz + h.m));

export function createDrone(model, P, position) {
  model.root.rotation.order = 'YXZ';
  return {
    ...model, model, position, params: P,
    velocity: new THREE.Vector3(), accel: new THREE.Vector3(),
    hp: P.hp, maxHp: P.hp, alive: true,
    state: 'enter', delay: 0, entry: null, goal: position.clone(), speedMul: 1,
    yaw: 0, tiltX: 0, tiltZ: 0, throttle: 0.6, shake: 0, phase: Math.random() * 100, hand: Math.random() < 0.5 ? -1 : 1,
    provoked: false, sees: false, dist: 99, losT: Math.random() * 0.15, seenT: 0, lostT: 0, hintT: 0, lastKnown: new THREE.Vector3(),
    orbit: 0, orbitRate: 0, range: 10, alt: 5, replanT: 0, seekT: 0,
    jink: new THREE.Vector3(), jinkT: rand(0.5, 2), jinkOn: false,
    diveT: 0, divePhase: 0, diveAlt: 2, diveDir: new THREE.Vector3(), diveSide: new THREE.Vector3(), diveExit: new THREE.Vector3(),
    gy: 0, gp: -0.4, aimPt: new THREE.Vector3(), aimErr: new THREE.Vector3(), aimOff: 9,
    fire: { phase: 'idle', t: rand(0.2, 1), shots: 0, run: 0 }, eyeGlow: 2.5, lampK: 0,
    sound: null, smokeT: 0, spark: null, leaveT: 0,
    // 守区域的无人机（drones.js 的 spawnFor）：home 是巡逻圈和活动范围，contact 是见没见过玩家，alertT 是挨打后还知道玩家在哪的秒数
    home: null, contact: false, alertT: 0, patrol: false,
  };
}

export function think(d, dt, m, player) {
  const p = d.position, pp = player.position;
  if ((d.losT -= dt) <= 0) {
    // 视线检测分摊开，每架约 8 次/秒
    d.losT = 0.1 + Math.random() * 0.05;
    _a.set(p.x, p.y - 0.14, p.z);
    d.dist = _a.distanceTo(player.eye);
    // 守区域的只留意进了地盘（多看出去一成半）的人；刚挨了打的那几秒不受这个限制
    const near = !d.home || d.alertT > 0 || reach(d.home, pp.x, pp.z) < 1.15;
    d.sees = near && player.alive !== false && d.dist < SIGHT && !m.phys?.blocked?.(_a, player.eye);
  }
  d.alertT -= dt;
  if (d.sees) {
    d.seenT += dt;
    d.lostT = 0;
    d.contact = true;
    d.lastKnown.copy(pp);
    m.shared.pos.copy(pp);
    m.shared.t = m.time;
  } else {
    d.seenT = 0;
    d.lostT += dt;
    // 别的无人机看得见就共享目标位置
    if (m.time - m.shared.t < 0.6) d.lastKnown.copy(m.shared.pos);
    // 守区域的不凭空知道玩家在哪：只有刚挨了打（开枪的人暴露了位置）才拿得到方位
    else if (d.home) { if (d.alertT > 0) d.lastKnown.copy(pp); }
    // 跟着玩家打的（旧的波次刷法）：全都看不见时隔几秒拿到一次带误差的方位，免得玩家一躲整波就僵住
    else if ((d.hintT -= dt) <= 0) {
      d.hintT = rand(3.5, 6);
      d.lastKnown.set(pp.x + rand(-4, 4), pp.y, pp.z + rand(-4, 4));
    }
  }
  // 撤离看全队：别的无人机还看得见玩家（还在交火）就不走。守区域的没见过玩家就一直巡逻，不撤
  if (d.state !== 'leave' && (!d.home || d.contact) && Math.min(d.lostT, m.time - m.shared.t) > TUNE.droneLeave) startLeave(d);
  if (d.state === 'leave') d.leaveT += dt;
  else if (d.state === 'enter') enter(d, pp);
  else if (d.state === 'dive') dive(d, dt, player);
  else engage(d, dt, m, player);
}

function enter(d, pp) {
  const p = d.position;
  if (!d.entry && d.home) {
    // 守区域的：直接飞到巡逻圈上离来向最近的那一点
    const h = d.home, a = Math.atan2((p.z - h.z) / h.rz, (p.x - h.x) / h.rx);
    d.entry = clampBounds(new THREE.Vector3(h.x + Math.cos(a) * h.rx, h.alt, h.z + Math.sin(a) * h.rz));
  } else if (!d.entry) {
    // 入场点在玩家和来向之间；先保持在箱墙之上的高度，进场后再降
    _a.set(p.x - pp.x, 0, p.z - pp.z).normalize();
    const r = rand(10, 16);
    d.entry = clampBounds(new THREE.Vector3(pp.x + _a.x * r, rand(8.5, 10.5), pp.z + _a.z * r));
  }
  d.goal.copy(d.entry);
  d.speedMul = 1.8;
  const inside = p.x > B.x0 - 1 && p.x < B.x1 + 1 && p.z > B.z0 - 1 && p.z < B.z1 + 1;
  if (inside && (d.sees || Math.hypot(p.x - d.entry.x, p.z - d.entry.z) < 5)) {
    d.state = 'engage';
    d.speedMul = 1;
    d.replanT = 0;
    d.seenT = 0; // 进场后重新计反应时间，不在半路上就开火
  }
}

// 玩家躲进了无人机进不去的地方（办公楼二层深处）：不在门外干等到天荒地老，背着地图中心爬高飞出去，
// 不然这一波结束不了。撤离途中不开火，打下来照常算击杀
function startLeave(d) {
  const p = d.position, cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
  const dx = p.x - cx, dz = p.z - cz, l = Math.hypot(dx, dz) || 1;
  d.state = 'leave';
  d.leaveT = 0;
  d.fire.phase = 'idle';
  d.jink.set(0, 0, 0);
  d.jinkOn = false;
  d.speedMul = 1.3;
  d.goal.set(p.x + (dx / l) * 90, 32, p.z + (dz / l) * 90);
}

// 守区域的无人机没有目标时：绕着区域上空的椭圆慢飞，探照灯左右扫（aim 里没目标的那一支）
function patrol(d, dt) {
  const h = d.home;
  if (!d.patrol) {
    d.patrol = true;
    d.orbit = Math.atan2((d.position.z - h.z) / h.rz, (d.position.x - h.x) / h.rx);
    d.jink.set(0, 0, 0);
    d.jinkOn = false;
    d.speedMul = 0.55;
  }
  d.orbit += (d.hand * 3 * dt) / Math.max(h.rx, h.rz);
  d.goal.set(h.x + Math.cos(d.orbit) * h.rx, 0, h.z + Math.sin(d.orbit) * h.rz);
  clampBounds(d.goal).y = h.alt;
}

function engage(d, dt, m, player) {
  const p = d.position, pp = player.position, home = d.home;
  // 守区域的：droneForget 秒看不见玩家就回去巡逻，不满图追
  if (home && !d.sees && d.alertT <= 0 && d.lostT > TUNE.droneForget) { patrol(d, dt); return; }
  if (d.patrol) { d.patrol = false; d.speedMul = 1; d.replanT = 0; }
  const focus = d.sees ? pp : d.lastKnown;
  if ((d.replanT -= dt) <= 0) plan(d, m, focus, false);
  else if (!d.sees && d.lostT > 1.2 && (d.seekT -= dt) <= 0) {
    d.seekT = 0.7;
    plan(d, m, focus, true);
  }
  d.orbit += d.orbitRate * dt;
  d.goal.set(focus.x + Math.cos(d.orbit) * d.range, 0, focus.z + Math.sin(d.orbit) * d.range);
  clampBounds(d.goal).y = Math.max(d.alt, focus.y + 2.4);
  if (home) {
    // 玩家走远了不跟出去：悬停点收在地盘里
    const k = reach(home, d.goal.x, d.goal.z);
    if (k > 1) { d.goal.x = home.x + (d.goal.x - home.x) / k; d.goal.z = home.z + (d.goal.z - home.z) / k; }
  }
  // 预警和点射的时候稳住不横移：亮灯那一下是留给玩家还手的
  if (d.fire.phase !== 'idle') {
    if (d.jinkOn) { d.jinkOn = false; d.jink.set(0, 0, 0); d.jinkT = rand(TUNE.droneJinkGap[0], TUNE.droneJinkGap[1]); }
  } else if ((d.jinkT -= dt) <= 0) {
    if (d.jinkOn || !d.sees) {
      d.jinkOn = false;
      d.jink.set(0, 0, 0);
      d.jinkT = rand(TUNE.droneJinkGap[0], TUNE.droneJinkGap[1]);
    } else {
      // 垂直于视线横移一段，让玩家不好跟枪
      const s = (Math.random() < 0.5 ? -1 : 1) * rand(2, 3.5);
      _a.set(pp.x - p.x, 0, pp.z - p.z).normalize();
      d.jink.set(-_a.z * s, 0, _a.x * s);
      d.jinkOn = true;
      d.jinkT = rand(0.45, 0.85);
    }
  }
}

// 在目标周围选一个悬停位：平时就近换位，尽量挑看得见目标的；seeking（丢失视线）时多试几个方向和高度，
// 取离自己最近的可视点，一个都没有就保持原计划等下次再找
function plan(d, m, focus, seeking) {
  if (m.nav.covered(focus)) { planDoor(d, m, focus); return; }
  const p = d.position, P = d.params;
  const cur = Math.atan2(p.z - focus.z, p.x - focus.x);
  const tries = seeking ? 6 : 5;
  let best = Infinity;
  _b.set(focus.x, focus.y + 1.5, focus.z);
  for (let i = 0; i < tries; i++) {
    const ang = cur + rand(-1, 1) * (seeking ? 1.7 : 0.5 + i * 0.35);
    const range = seeking ? rand(NEAR_MIN, 13) : Math.max(NEAR_MIN, rand(7, 15) - (P.level - 1) * 0.5);
    const alt = seeking ? SEEK_ALT[(Math.random() * SEEK_ALT.length) | 0] : rand(3, 7);
    _a.set(focus.x + Math.cos(ang) * range, 0, focus.z + Math.sin(ang) * range);
    clampBounds(_a).y = Math.max(alt, focus.y + 2.4, m.nav.floor(_a.x, _a.z) + CLEAR);
    if (m.phys?.blocked?.(_a, _b) && (seeking || i < tries - 1)) continue;
    const cost = seeking ? _a.distanceToSquared(p) : 0;
    if (cost < best) {
      best = cost;
      d.orbit = ang;
      d.range = range;
      d.alt = alt;
    }
    if (!seeking) break;
  }
  if (seeking && best === Infinity) return;
  d.replanT = rand(2.5, 5);
  d.orbitRate = seeking ? 0 : d.hand * rand(0.1, 0.28) * (0.8 + 0.1 * P.level);
  if (Math.random() < 0.35) d.hand = -d.hand;
}

// 目标在屋里（头顶有屋面）：从楼外贴墙的露天点里随机抽几个，挑能隔着门洞、窗洞看见他、离自己最近的悬停；
// 一个都看不见就先到离他最近的那个门口外面等着，过一会儿再试，不在屋顶上或者边界上干转
function planDoor(d, m, focus) {
  const nav = m.nav, D = nav.doors, p = d.position;
  _b.set(focus.x, focus.y + 1.5, focus.z);
  let seen = 0, best = Infinity, near = Infinity, bx = 0, bz = 0, by = 0, nxp = 0, nzp = 0;
  for (let i = 0; i < nav.doorN; i++) {
    const x = D[i * 2], z = D[i * 2 + 1], r2 = (x - focus.x) ** 2 + (z - focus.z) ** 2;
    if (r2 > DOOR_R * DOOR_R) continue;
    // 离他不到 NEAR_MIN 的门口不试视线，只在没别处可等时才去那儿等
    const close = r2 < NEAR_MIN * NEAR_MIN, nk = close ? r2 + 1e4 : r2;
    if (nk < near) { near = nk; nxp = x; nzp = z; }
    if (close) continue;
    // 蓄水池抽样：范围内的点等概率抽 DOOR_TRY 个试视线
    if (++seen > DOOR_TRY && Math.random() * seen > DOOR_TRY) continue;
    const y = Math.max(focus.y + (Math.random() < 0.5 ? 2.4 : 3.4), nav.floor(x, z) + CLEAR);
    _a.set(x, y - 0.14, z);
    if (m.phys?.blocked?.(_a, _b)) continue;
    const cost = (x - p.x) ** 2 + (z - p.z) ** 2;
    if (cost < best) { best = cost; bx = x; bz = z; by = y; }
  }
  if (best === Infinity) {
    if (near === Infinity) return;
    bx = nxp; bz = nzp; by = focus.y + 2.4;
  }
  d.orbit = Math.atan2(bz - focus.z, bx - focus.x);
  d.range = Math.hypot(bx - focus.x, bz - focus.z);
  d.alt = by;
  d.orbitRate = 0;
  d.replanT = best === Infinity ? rand(1, 2) : rand(2.5, 5);
}

function startDive(d, m, player) {
  const p = d.position, pp = player.position;
  _a.set(pp.x - p.x, 0, pp.z - p.z);
  const len = _a.length();
  // 太近没有助跑距离；玩家在棚下、箱内或贴着箱子时冲不进去
  if (len < 4 || m.nav.floor(pp.x, pp.z) > pp.y + 0.6) return;
  d.diveDir.copy(_a).multiplyScalar(1 / len);
  d.diveSide.set(-d.diveDir.z * d.hand, 0, d.diveDir.x * d.hand);
  d.diveAlt = rand(1.6, 2.2);
  d.diveT = 0;
  d.divePhase = 0;
  d.jink.set(0, 0, 0);
  d.jinkOn = false;
  d.state = 'dive';
  m.divers++;
}

function dive(d, dt, player) {
  const p = d.position, pp = player.position;
  d.diveT += dt;
  d.speedMul = 1.55;
  if (d.divePhase === 0) {
    // 掠过点在玩家身侧 1.4 m。目标取“自己→掠过点”延长线上再往前 6 m：不减速，而且一定从掠过点经过
    const sx = pp.x + d.diveSide.x * 1.4, sz = pp.z + d.diveSide.z * 1.4;
    const ux = sx - p.x, uz = sz - p.z, ul = Math.hypot(ux, uz) || 1;
    d.goal.set(sx + (ux / ul) * 6, 0, sz + (uz / ul) * 6);
    clampBounds(d.goal).y = pp.y + d.diveAlt;
    if (ul < 1 || ux * d.diveDir.x + uz * d.diveDir.z < 0) {
      d.divePhase = 1;
      d.diveExit.set(p.x + (ux / ul) * 9, 0, p.z + (uz / ul) * 9);
      clampBounds(d.diveExit).y = pp.y + rand(4.5, 6.5);
    }
  } else d.goal.copy(d.diveExit);
  const out = d.divePhase === 1 && Math.hypot(p.x - d.diveExit.x, p.z - d.diveExit.z) < 3;
  if (out || d.diveT > 3.6 || player.alive === false) {
    d.state = 'engage';
    d.speedMul = 1;
    d.replanT = 0;
  }
}

export function fly(d, dt, m, player) {
  const p = d.position, v = d.velocity, P = d.params, nav = m.nav, pp = player.position;
  const gx = d.goal.x - p.x, gz = d.goal.z - p.z, gd = Math.hypot(gx, gz) || 1e-4;
  const sp = Math.min(P.speed * d.speedMul, gd * 1.5);
  let wx = (gx / gd) * sp + d.jink.x, wz = (gz / gd) * sp + d.jink.z;
  const push = (dx, dz, R, gain, swirl = 0) => {
    const dd = Math.hypot(dx, dz);
    if (dd >= R) return;
    const k = (((R - dd) / R) * gain) / (dd || 1e-3);
    // swirl 给一点切向分量：目标正好在杆子背后时不会顶着杆子停住
    wx += (dx + dz * swirl) * k;
    wz += (dz - dx * swirl) * k;
  };
  for (const o of m.drones) {
    if (o !== d && o.alive && o.delay <= 0 && Math.abs(p.y - o.position.y) < 1.6) push(p.x - o.position.x, p.z - o.position.z, SEP, 5);
  }
  if (p.y - pp.y < 2.8) push(p.x - pp.x, p.z - pp.z, 1.5, 12);
  for (const q of nav.poles) {
    if (p.y < q.top + 0.8) push(p.x - q.x, p.z - q.z, q.r + 1.6, 7, 0.7 * d.hand);
  }
  if (d.state !== 'enter' && d.state !== 'leave') {
    if (p.x < B.x0) wx += (B.x0 - p.x) * 3; else if (p.x > B.x1) wx -= (p.x - B.x1) * 3;
    if (p.z < B.z0) wz += (B.z0 - p.z) * 3; else if (p.z > B.z1) wz -= (p.z - B.z1) * 3;
  }
  // 沿想去的方向往前看：前面有高障碍就提前爬升，来不及爬够就按比例减速
  const ws = Math.hypot(wx, wz) || 1e-4, ux = wx / ws, uz = wz / ws;
  const reach = Math.max(Math.hypot(v.x, v.z), Math.min(2.5, ws));
  let need = nav.floor(p.x, p.z), slow = 1;
  for (const t of LOOK) {
    const f = nav.floor(p.x + ux * reach * t, p.z + uz * reach * t);
    if (f > need) need = f;
    const lack = f + HARD + 0.3 - p.y;
    if (lack > 0) slow = Math.min(slow, clamp((t * CLIMB) / lack, 0.12, 1));
  }
  wx *= slow;
  wz *= slow;
  const wy = clamp((Math.max(d.goal.y, need + CLEAR) - p.y) * 2.2, -SINK * d.speedMul, CLIMB);
  let ax = (wx - v.x) * 3.5, az = (wz - v.z) * 3.5;
  const ah = Math.hypot(ax, az), amax = P.accel * (d.speedMul > 1 ? 1.3 : 1);
  if (ah > amax) { ax *= amax / ah; az *= amax / ah; }
  const ay = clamp((wy - v.y) * 5, -10, 13);
  d.accel.set(ax, ay, az);
  v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
  // 积分。高度不够进不去的格子就贴着它滑，不往里钻
  const ny = p.y + v.y * dt;
  let nx = p.x + v.x * dt, nz = p.z + v.z * dt;
  if (nav.floor(nx, nz) + HARD > ny) {
    if (nav.floor(nx, p.z) + HARD <= ny) { nz = p.z; v.z = 0; }
    else if (nav.floor(p.x, nz) + HARD <= ny) { nx = p.x; v.x = 0; }
    else { nx = p.x; nz = p.z; v.x = 0; v.z = 0; }
  }
  for (const q of nav.poles) {
    const dx = nx - q.x, dz = nz - q.z, dd = Math.hypot(dx, dz), R = q.r + 0.62;
    if (dd < R && ny < q.top + 0.3) { nx = q.x + (dx / (dd || 1)) * R; nz = q.z + (dz / (dd || 1)) * R; }
  }
  const low = nav.floor(nx, nz) + HARD;
  if (ny < low && v.y < 0) v.y = 0;
  p.set(nx, Math.max(ny, low), nz);
}

export function pose(d, dt, m) {
  const p = d.position, v = d.velocity, t = m.time + d.phase;
  let want = d.yaw + 0.5 * d.hand * dt;
  if (d.sees || d.lostT < 2.5) want = Math.atan2(p.x - d.lastKnown.x, p.z - d.lastKnown.z);
  else if (v.x * v.x + v.z * v.z > 2) want = Math.atan2(-v.x, -v.z);
  d.yaw = turn(d.yaw, want, 3.2 * dt);
  // 机身朝加速方向倾（外加一点速度项，巡航时也带着前倾）
  const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
  const fx = d.accel.x + v.x * 0.45, fz = d.accel.z + v.z * 0.45;
  const k = ease(dt, 7);
  d.tiltX += (clamp((fx * s + fz * c) * 0.032, -0.5, 0.5) - d.tiltX) * k;
  d.tiltZ += (clamp(-(fx * c - fz * s) * 0.032, -0.5, 0.5) - d.tiltZ) * k;
  d.shake = Math.max(0, d.shake - dt * 4);
  const sh = d.shake, hurt = d.hp < d.maxHp * 0.4 ? 1 : 0, jit = () => (Math.random() - 0.5) * sh;
  d.root.position.set(
    p.x + Math.sin(t * 1.3) * 0.035 + jit() * 0.06,
    p.y + Math.sin(t * 1.9) * 0.05 + Math.sin(t * 3.7) * 0.018 + jit() * 0.06,
    p.z + Math.cos(t * 1.1) * 0.035 + jit() * 0.06,
  );
  d.root.rotation.set(
    d.tiltX + Math.sin(t * 2.3) * 0.012 + jit() * 0.35 + hurt * Math.sin(t * 9) * 0.05,
    d.yaw,
    d.tiltZ + Math.cos(t * 2) * 0.012 + jit() * 0.35 + hurt * Math.sin(t * 7.3) * 0.06,
  );
  const thr = clamp(0.55 + d.accel.y * 0.035 + Math.hypot(d.accel.x, d.accel.z) * 0.025, 0.3, 1.2);
  d.throttle += (thr - d.throttle) * ease(dt, 6);
  // 每帧加一个随机角：高速桨在逐帧画面里本来就是闪的，叠上 TAA 正好糊成桨盘
  const w = (120 + 90 * d.throttle) * dt;
  for (let i = 0; i < d.rotors.length; i++) d.rotors[i].rotation.y += (i % 2 ? -1 : 1) * (w + Math.random() * 2.2);
}

export function aim(d, dt, m, player) {
  const P = d.params;
  let wy, wp;
  if (d.sees || d.fire.phase === 'burst') {
    if (d.sees) {
      // 瞄胸口，按弹丸飞行时间给提前量；瞄准点低通跟随，所以横向快跑能甩开一部分子弹（两项都再乘 tuning.js 的系数）
      _a.copy(player.position).lerp(player.eye, 0.7).addScaledVector(player.velocity, (d.dist / BULLET_SPEED) * P.lead * TUNE.droneLead).add(d.aimErr);
      if (d.seenT <= dt * 1.5) d.aimPt.copy(_a); else d.aimPt.lerp(_a, ease(dt, 1 / (P.lag * TUNE.droneLag)));
    }
    _b.set(0, -0.152, -0.03).applyQuaternion(d.root.quaternion).add(d.root.position);
    _a.copy(d.aimPt).sub(_b).applyQuaternion(_q.copy(d.root.quaternion).invert());
    wy = Math.atan2(-_a.x, -_a.z);
    wp = Math.atan2(_a.y, Math.hypot(_a.x, _a.z));
  } else {
    // 没目标：探照灯左右扫
    const t = m.time + d.phase;
    wy = Math.sin(t * 0.8) * 0.9;
    wp = -0.55 + Math.sin(t * 0.53) * 0.2;
  }
  d.gy = turn(d.gy, wy, 5 * dt);
  d.gp += clamp(clamp(wp, -1.4, 0.35) - d.gp, -4 * dt, 4 * dt);
  d.gimbal.rotation.y = d.gy;
  d.pitch.rotation.x = d.gp;
  d.aimOff = Math.abs(wrap(wy - d.gy)) + Math.abs(wp - d.gp);
}

export function fire(d, dt, m, player) {
  const f = d.fire, P = d.params;
  let glow = d.sees ? 6 : 2.5;
  if (f.phase === 'idle') {
    f.t -= dt;
    const quiet = m.time - m.waveT < QUIET && !d.provoked && !CONTACT.soldier;
    const ready = f.t <= 0 && !quiet && d.state === 'engage' && d.sees && d.seenT >= P.reaction && d.dist < RANGE && d.aimOff < 0.16;
    if (ready && m.firing < m.attackers && m.time >= m.nextFireT) {
      m.firing++;
      m.nextFireT = m.time + P.interval * TUNE.droneInterval;
      f.phase = 'warn';
      f.t = TUNE.droneWarn;
      f.shots = P.burst;
      const pv = player.velocity, run = Math.min(1, Math.hypot(pv.x, pv.z) / 6.3);
      f.run = run; // drones.js 的 shoot 按它放大散布
      const e = Math.max(TUNE.droneErrMin, d.dist * TUNE.droneErr) * (1 + run * TUNE.droneErrMove);
      // 误差只放在和视线垂直的方向上：顺着视线的那一分量打不偏，玩家迎着或背着无人机跑时等于没有误差
      const lx = player.position.x - d.position.x, lz = player.position.z - d.position.z, ll = Math.hypot(lx, lz) || 1, side = gauss() * e;
      d.aimErr.set((-lz / ll) * side, gauss() * e * 0.6, (lx / ll) * side);
      m.audio?.play?.('droneAlert', { position: d.position, volume: 0.9, pitch: rand(0.95, 1.08) });
    }
  } else if (f.phase === 'warn') {
    f.t -= dt;
    glow = 18 + 37 * (1 - f.t / TUNE.droneWarn) + Math.sin(m.time * 55) * 8;
    if (!d.sees && d.lostT > 0.3) {
      // 目标躲掉了，取消这次点射
      f.phase = 'idle';
      f.t = 0.5;
    } else if (f.t <= 0) {
      f.phase = 'burst';
      f.t = 0;
    }
  } else {
    glow = 60;
    f.t -= dt;
    while (f.t <= 0 && f.shots > 0) {
      m.shoot(d);
      f.shots--;
      f.t += SHOT_GAP * rand(0.92, 1.1);
    }
    if (f.shots <= 0) {
      f.phase = 'idle';
      f.t = P.cooldown * rand(0.8, 1.25) * TUNE.droneCool;
      if (d.sees && d.dist < 22 && m.divers === 0 && Math.random() < P.dive) startDive(d, m, player);
    }
  }
  d.eyeGlow += (glow - d.eyeGlow) * ease(dt, 18);
  d.eye.emissiveIntensity = d.eyeGlow;
}
