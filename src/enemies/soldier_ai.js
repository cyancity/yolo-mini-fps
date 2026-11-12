import * as THREE from 'three';
import { SPEED } from './soldiers_move.js';
import { THINK, setGoal, setWaypoint, enterSearch, enterCombat, investigate, busy } from './soldiers_states.js';
import { combat } from './soldiers_tactics.js';
import { CONTACT } from './contact.js';
import { TUNE } from './tuning.js';
import { levelK } from './soldiers_gun.js';

// 人形敌人的头脑：感知（视野锥、视线、反应时间、听觉、发现尸体、互通情报）和非战斗状态（站岗巡逻、调查、搜索）。
// think 每人每秒约 10 次（错开），act 每帧跑：计时、瞄准、转身、要不要开火。
const SIGHT = 60;
const TWIST = 0.9; // 上身相对脚下朝向最多扭这么多（弧度），和 soldier_rig 里对 aimYaw 的限幅一致
const CONE = Math.cos(THREE.MathUtils.degToRad(55)), CONE_ALERT = Math.cos(THREE.MathUtils.degToRad(82));
const TURN_MAX = 7.85; // 全身转速上限（弧度每秒，约 450°/s）：转身加扭身补偿合起来不超过它
const FACE_LEFT = 4, FACE_SEEN = 2; // 交火里路剩不到 4 米、或者 2 秒内看见过玩家：面朝他倒退、横移过去，不转背
const _c = new THREE.Vector3(), _t = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const turn = (cur, want, max) => cur + clamp(wrap(want - cur), -max, max);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export function think(s, m, player) {
  perceive(s, m, player);
  intel(s, m);
  if (s.state !== 'combat') noticeBodies(s, m);
  s.stateT += THINK;
  if (s.waitT > 0) { s.waitT -= THINK; return; }
  if (s.state === 'patrol') patrol(s, m);
  else if (s.state === 'investigate') checkOut(s, m);
  else if (s.state === 'search') search(s, m, player);
  else if (s.state === 'combat') {
    friendCheck(s, m);
    combat(s, m, player);
  }
}

function perceive(s, m, player) {
  if (!player.alive) { s.sees = false; return; }
  const e = s.eye, pe = player.eye;
  const dx = pe.x - e.x, dy = pe.y - e.y, dz = pe.z - e.z, hd = Math.hypot(dx, dz), dist = Math.hypot(hd, dy);
  const alert = s.state !== 'patrol';
  // 蹲着的人远处不容易发现；没警觉时看得近一些
  const range = SIGHT * (1 - 0.3 * player.crouch) * (alert ? 1 : 0.75);
  let ok = dist < range;
  if (ok && hd > 2.5) {
    const look = s.yaw + s.aimYaw;
    ok = (dx * -Math.sin(look) + dz * -Math.cos(look)) / hd > (alert ? CONE_ALERT : CONE);
  }
  if (!ok) { s.sees = false; return; }
  if (!m.spendRay()) return; // 本帧射线额度用完：沿用上次的结果
  const was = s.sees;
  s.visEye = !m.phys.blocked(e, pe);
  _c.set(player.position.x, player.position.y + player.height * 0.62, player.position.z);
  if (m.spendRay()) s.visChest = !m.phys.blocked(e, _c);
  else s.visChest = s.visEye && Math.abs(player.leanX || 0) < 0.1;
  s.sees = s.visEye || s.visChest;
  s.dist = dist;
  if (s.sees && !was) {
    const T = TUNE;
    // 丢了一阵视线再看见（玩家从掩体后探头）：交火中也要重新反应，不能一露头就挨枪。
    // 第一次发现也走这里（lostT 初值 99），15~20 米约 0.6~0.86 秒，T1 的 7~9 秒是按它量的
    if (s.lostT > T.reacqLost) {
      s.seeT = 0;
      s.reaction = reacquireTime(s, dist);
    } else if (s.seeT <= 0) s.reaction = reactionTime(s, dist);
    // 玩家换了位置、或者躲了一阵才重新算“刚发现”：第一轮带大的系统误差
    if (s.lostT > T.freshLost || player.position.distanceToSquared(s.seenPos) > T.freshMove * T.freshMove) s.onTarget = 0;
  }
}

// 反应时间：只在丢失视线不到 reacqLost 秒、看见的累计时间又衰减到 0 时用。远了慢、等级高了快；交火里的人更快
function reactionTime(s, dist) {
  const base = 0.35 + 0.45 * Math.min(1, dist / 40);
  const st = s.state === 'combat' ? 0.45 : s.state === 'patrol' ? 1.1 : 0.8;
  return Math.max(TUNE.reactMin, base * st * levelK(s.level, TUNE.levelStep));
}

// 重新捕获：知道人在那儿，但要重新找到、对准
function reacquireTime(s, dist) {
  const T = TUNE, k = Math.min(1, dist / T.reacqDist);
  return Math.max(T.reacqNear, (T.reacqNear + (T.reacqFar - T.reacqNear) * k) * rand(T.reacqJitter[0], T.reacqJitter[1]));
}

// 附近有人看见玩家，就把位置报过来
function intel(s, m) {
  const sh = m.shared;
  if (sh.t <= s.knownT || m.time - sh.t > 1.5) return;
  if (s.state !== 'combat' && s.pos.distanceToSquared(sh.from) > 35 * 35) return;
  s.lastKnown.copy(sh.pos);
  s.knownT = sh.t;
  if (s.state !== 'combat') enterCombat(s, m);
}

function noticeBodies(s, m) {
  if (!m.bodies) return;
  for (const o of m.active) {
    if (o.alive || (s.noticed & o.bit) || m.time - o.deathT > 45) continue;
    const dx = o.pos.x - s.pos.x, dz = o.pos.z - s.pos.z, d = Math.hypot(dx, dz);
    if (d > 26 || Math.abs(o.pos.y - s.pos.y) > 3) continue;
    const look = s.yaw + s.aimYaw;
    if (d > 2 && (dx * -Math.sin(look) + dz * -Math.cos(look)) / d < 0.35) continue;
    if (!m.spendRay()) return;
    _t.set(o.pos.x, o.pos.y + 0.35, o.pos.z);
    if (m.phys.blocked(s.eye, _t)) continue;
    s.noticed |= o.bit;
    if (m.time - s.alertT > 6) m.audio?.play?.('npcAlert', { position: s.eye, volume: 0.9 });
    s.alertT = m.time;
    investigate(s, m, o.pos, true);
    return;
  }
}

// 队友挡在枪线上就先不打
function friendCheck(s, m) {
  s.friendBlock = false;
  if (!s.sees) return;
  const e = s.eye, f = s.firePt, ux = f.x - e.x, uy = f.y - e.y, uz = f.z - e.z, L = Math.hypot(ux, uy, uz) || 1;
  for (const o of m.active) {
    if (o === s || !o.alive) continue;
    const wx = o.chest.x - e.x, wy = o.chest.y - e.y, wz = o.chest.z - e.z, t = (wx * ux + wy * uy + wz * uz) / L;
    if (t < 0.5 || t > L - 0.5) continue;
    const px = wx - (ux / L) * t, py = wy - (uy / L) * t, pz = wz - (uz / L) * t;
    if (px * px + py * py + pz * pz < 0.55 * 0.55) { s.friendBlock = true; return; }
  }
}

function patrol(s, m) {
  s.crouchWant = 0;
  if (busy(s, m)) return;
  s.lookT += THINK;
  if (s.lookT < s.lookDur) return;
  s.lookT = 0;
  s.lookDur = rand(3, 7);
  if (Math.random() < 0.6 && m.nav.ready) {
    const n = m.nav.randomNear(s.home.x, s.home.y, s.home.z, 7);
    if (n >= 0) setGoal(s, m.nav.cx(n), m.nav.nY[n], m.nav.cz(n), SPEED.walk);
  } else s.lookBase = rand(-Math.PI, Math.PI);
}

// 调查：到了地方原地张望几秒，没发现就转入搜索
function checkOut(s, m) {
  if (busy(s, m)) return;
  s.speedWant = 0;
  s.lookT += THINK;
  if (s.lookT > (s.urgent ? 2 : 3.5)) enterSearch(s, m);
}

function search(s, m, player) {
  s.searchT += THINK;
  if (s.searchT > (s.hunter ? 12 : 22)) {
    if (s.hunter && player.alive) {
      // 整波人不能因为玩家躲起来就僵住：隔一阵拿到一个带误差的方位，朝那儿压过去
      s.lastKnown.set(player.position.x + rand(-6, 6), player.position.y, player.position.z + rand(-6, 6));
      s.searchT = 0;
      setGoal(s, s.lastKnown.x, s.lastKnown.y, s.lastKnown.z, SPEED.run * 0.75);
      return;
    }
    s.state = 'patrol';
    s.home.copy(s.pos);
    s.lookT = 0;
    return;
  }
  if (busy(s, m)) return;
  s.lookT += THINK;
  if (s.lookT < s.lookDur || !m.nav.ready) return;
  s.lookT = 0;
  s.lookDur = rand(1.2, 2.8);
  const n = m.nav.randomNear(s.lastKnown.x, s.lastKnown.y, s.lastKnown.z, 9);
  if (n >= 0) setWaypointFar(s, m, n);
}

function setWaypointFar(s, m, n) {
  const nav = m.nav;
  if (nav.lineWalk(nav.nearest(s.pos.x, s.pos.y, s.pos.z, 1.5), n)) setWaypoint(s, nav, n, 2.2);
  else setGoal(s, nav.cx(n), nav.nY[n], nav.cz(n), 2.2);
}

// 听到动静：没在交火的去看看，交火中的人借枪声更新玩家位置
export function hear(s, m, pos, radius) {
  const d = s.pos.distanceTo(pos);
  if (d > radius) return;
  const err = d * 0.12;
  if (s.state === 'combat') {
    if (m.time - s.knownT > 0.8) {
      s.lastKnown.set(pos.x + rand(-err, err) * 0.5, pos.y, pos.z + rand(-err, err) * 0.5);
      s.knownT = m.time;
    }
    return;
  }
  // 连发每枪都会调一次：已经在赶去的地方附近再响就不重新寻路
  if (s.state === 'investigate' && s.urgent && s.lastKnown.distanceToSquared(pos) < (4 + err) ** 2) return;
  if (s.state === 'search' && m.time - s.heardT < 2 && s.lastKnown.distanceToSquared(pos) < (6 + err) ** 2) return;
  s.heardT = m.time;
  _t.set(pos.x + rand(-err, err), pos.y, pos.z + rand(-err, err));
  s.lookBase = Math.atan2(-(pos.x - s.pos.x), -(pos.z - s.pos.z));
  investigate(s, m, _t, true);
}

// 每帧：看见多久了、看哪儿、身体往哪转、蹲多低、能不能开火
export function act(s, dt, m, player) {
  if (s.sees) {
    s.seeT += dt;
    s.lostT = 0;
    if (s.seeT >= s.reaction) spotted(s, m, player);
  } else {
    s.lostT += dt;
    s.seeT = s.lostT > 1.5 ? 0 : Math.max(0, s.seeT - dt * 0.5);
  }
  const p = s.pos, pp = player.position, combat = s.state === 'combat';
  // 开火点：看得见胸口打胸口，只露头就打头
  if (s.visChest) s.firePt.set(pp.x, pp.y + player.height * 0.62, pp.z);
  else s.firePt.set(player.eye.x, player.eye.y - 0.06, player.eye.z);
  // 赶路的方向：有路点就朝下一个路点（刚起步、速度还没起来时也得先转过去），否则看速度
  const vx = s.vel.x, vz = s.vel.z;
  let tx = 0, tz = 0, moving = false;
  if (s.pathN > s.pathI && s.speedWant > 0) {
    const i3 = s.pathI * 3;
    tx = s.path[i3] - p.x; tz = s.path[i3 + 2] - p.z;
    moving = tx * tx + tz * tz > 0.01;
  }
  if (!moving && vx * vx + vz * vz > 0.16) { tx = vx; tz = vz; moving = true; }
  if (s.sees && (combat || s.seeT > 0.05)) _t.copy(s.firePt);
  else if (combat) _t.set(s.lastKnown.x, s.lastKnown.y + 1.3, s.lastKnown.z);
  else if (moving) {
    const k = 10 / Math.hypot(tx, tz);
    _t.set(p.x + tx * k, s.eye.y, p.z + tz * k);
  } else {
    const look = s.lookBase + Math.sin(m.time * 0.45 + s.id * 1.7) * (s.state === 'patrol' ? 0.7 : 1.1);
    _t.set(p.x - Math.sin(look) * 10, s.eye.y - (s.state === 'patrol' ? 0.8 : 0), p.z - Math.cos(look) * 10);
  }
  s.aimPt.x = damp(s.aimPt.x, _t.x, 14, dt);
  s.aimPt.y = damp(s.aimPt.y, _t.y, 14, dt);
  s.aimPt.z = damp(s.aimPt.z, _t.z, 14, dt);
  const ax = s.aimPt.x - p.x, az = s.aimPt.z - p.z, aimYawW = Math.atan2(-ax, -az);
  let want = aimYawW;
  if (moving && !s.sees) {
    const travel = Math.atan2(-tx, -tz);
    // 交火中赶路时尽量侧身对着威胁方向，扭不过来才转身跑；短距离换位、刚丢了视线时一直面朝他
    const face = combat && (m.time - s.lastSeenT < FACE_SEEN || pathLeft(s, FACE_LEFT) < FACE_LEFT);
    if (!face && (!combat || Math.abs(wrap(aimYawW - travel)) > 1.6)) want = travel;
  }
  const yaw0 = s.yaw;
  s.yaw = turn(s.yaw, want, (combat ? 5.5 : 3) * dt);
  // 上身最多扭 TWIST，再多就整个人快速跟着转：不然枪口和身子对不上，看着像背对着人在瞄。
  // 侧身赶路（want 是行进方向）时不管，那会儿没看见人、不开火。转速有上限，从赶路切回瞄准时不会一帧甩过去
  const twist = wrap(aimYawW - s.yaw);
  if (want === aimYawW && Math.abs(twist) > TWIST) s.yaw += clamp(twist - Math.sign(twist) * TWIST, -7 * dt, 7 * dt);
  s.yaw = yaw0 + clamp(wrap(s.yaw - yaw0), -TURN_MAX * dt, TURN_MAX * dt);
  s.aimYaw = clamp(wrap(aimYawW - s.yaw), -TWIST, TWIST);
  s.aimPitch = clamp(Math.atan2(s.aimPt.y - s.eye.y, Math.hypot(ax, az)), -0.9, 0.9);
  const fy = Math.atan2(-(s.firePt.x - p.x), -(s.firePt.z - p.z));
  s.aimed = Math.abs(wrap(fy - s.yaw)) < TWIST;
  s.aim = damp(s.aim, combat ? (s.sees || s.token ? 1 : 0.75) : s.state === 'patrol' ? 0.12 : 0.55, 6, dt);
  s.crouch = damp(s.crouch, s.crouchWant, 6, dt);
  // 蹲着不开火：蹲在矮掩体后枪口贴着掩体，站起来（探头）再打
  s.wantFire = combat && s.token && s.sees && s.seeT >= s.reaction && !s.friendBlock && player.alive && s.crouch < 0.35;
}

// 沿路点还要走多远（超过 cap 就不再往下算）
function pathLeft(s, cap) {
  if (s.pathN <= s.pathI) return 0;
  const P = s.path;
  let x = s.pos.x, z = s.pos.z, d = 0;
  for (let i = s.pathI; i < s.pathN && d < cap; i++) {
    const nx = P[i * 3], nz = P[i * 3 + 2];
    d += Math.hypot(nx - x, nz - z);
    x = nx; z = nz;
  }
  return d;
}

function spotted(s, m, player) {
  s.lastKnown.copy(player.position);
  s.seenPos.copy(player.position);
  s.lastSeenT = s.knownT = m.time;
  const sh = m.shared;
  sh.pos.copy(player.position);
  sh.t = m.time;
  sh.from.copy(s.pos);
  CONTACT.soldier = true;
  if (s.state !== 'combat') enterCombat(s, m);
}

// 寻路：从当前位置到 goal 开一次 A*（分帧跑，管理器每帧推进）。返回是否开了搜索；
// 网格没建好或者起止点不在网格上时直着走
export function route(s, m) {
  s.needPath = false;
  const nav = m.nav;
  const a = nav.ready ? nav.nearest(s.pos.x, s.pos.y, s.pos.z, 2) : -1;
  const b = a >= 0 ? nav.nearest(s.goal.x, s.goal.y, s.goal.z, 4) : -1;
  if (a < 0 || b < 0) {
    s.path[0] = s.goal.x; s.path[1] = s.goal.y; s.path[2] = s.goal.z;
    s.pathN = 1; s.pathI = 0;
    return false;
  }
  m.watchFrom(m.router, s.state === 'combat');
  // 上楼顶的路要展开一万五到两万个节点（目标正在头顶时启发值帮不上忙），按每帧额度分十几帧搜完
  m.router.open(a, b, 30000, true);
  return true;
}

// 搜索结束：抽稀后写进 s.path
export function finishRoute(s, m) {
  const r = m.router;
  if (r.result < 0) { s.pathN = 0; s.arrived = true; return; }
  const len = r.extract(r.result);
  s.pathN = r.smooth(len, s.path);
  s.pathI = 0;
  s.arrived = s.pathN === 0;
}
