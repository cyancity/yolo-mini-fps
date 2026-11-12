import * as THREE from 'three';
import { rayCapsule } from './soldiers_body.js';
import { TUNE } from './tuning.js';
import { impactSound } from '../audio/table.js';

// 人形敌人的步枪：点射、换弹、命中判定和特效。命中即时结算（hitscan），先打世界再打玩家。数字都在 tuning.js。
// 手感目标（第 3 波 3 个人在 15~20 米外，用 dev/tune_measure.js 量）：站在空地不动，从第一个人看见起 7~9 秒累计 100 点伤害，
// 30 秒不少于 250 点（站桩还是会死）；以冲刺速度来回横移，15 秒不超过 60 点；躲在高掩体后每 3 秒探头 0.8 秒，
// 每次平均不超过 5 点，九成以上的探头头 0.6 秒不中弹。第 6 波（8 人加 3 架无人机）站桩不少于 4 秒倒下。
export const GUN = { mag: 30, rpm: 650, reload: 2.6, range: 140 };
const GAP = 60 / GUN.rpm;
const BODY_R = 0.3, HEAD_R = 0.2, WHIZ_R = 1.6;
// 枪管和目标方向差超过 6° 不开枪；子弹方向（含散布）离枪管最多 8°；系统误差最多折成约 5°
const COS_AIM = Math.cos(THREE.MathUtils.degToRad(6)), COS_MAX = Math.cos(THREE.MathUtils.degToRad(8)), ERR_K = 0.09;
const CLEAR = 1; // 起点前面这么近就撞上东西：枪口或眼睛贴着掩体，这一发不打
const _o = new THREE.Vector3(), _mz = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _bd = new THREE.Vector3();
const _r = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _end = new THREE.Vector3(), _w = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
// 特效参数共用一份；弹孔记进敌人流弹那个环，不顶掉玩家刚打出来的
const FLASH = { light: false, enemy: true }, ENEMY = { enemy: true };

// 等级带来的加成系数：每波乘 (1 - step)，最低到 TUNE.levelFloor
export const levelK = (level, step) => Math.max(TUNE.levelFloor, 1 - step * (level - 1));

export function updateGun(s, dt, m, player) {
  const g = s.gun;
  if (g.reloadT > 0) {
    g.reloadT -= dt;
    // 拔匣在开头，插匣在六成处（时长每次随机）。按进度现放，不用 delay 预排：中途死了、清场了就不会再响
    const t = g.reloadLen - g.reloadT;
    if (g.cue === 0 && t >= 0.3) { g.cue = 1; m?.audio?.play?.('npcMagOut', { position: s.eye, volume: 0.9 }); }
    if (g.cue === 1 && t >= g.reloadLen * 0.62) { g.cue = 2; m?.audio?.play?.('npcMagIn', { position: s.eye, volume: 0.9 }); }
    if (g.reloadT <= 0) { g.reloadT = 0; g.mag = GUN.mag; }
    return;
  }
  g.cool -= dt;
  // 打到一半人缩回掩体、或者玩家躲开了：剩下几发不往墙上倒
  if (g.burst > 0 && !s.sees && s.lostT > 0.2) { g.burst = 0; endBurst(s); return; }
  if (g.burst > 0) {
    g.shotT -= dt;
    while (g.shotT <= 0 && g.burst > 0) {
      // 没打出去的那一发（枪管没对上、贴着掩体）不耗子弹，点射照常往下数
      if (shoot(s, m, player)) { g.mag--; g.shot++; }
      g.burst--;
      g.shotT += GAP * rand(0.94, 1.08);
      if (g.mag <= 0) { g.burst = 0; reload(s, m); }
    }
    if (g.burst === 0) endBurst(s);
    return;
  }
  if (s.wantFire && s.aimed && g.cool <= 0 && g.mag > 0 && onBarrel(s)) startBurst(s);
}

function endBurst(s) {
  const g = s.gun;
  g.cool = rand(TUNE.burstGap[0], TUNE.burstGap[1]) * levelK(s.level, TUNE.coolStep);
  g.bursts++;
  if (g.shot > 0) s.onTarget++;
}

// 枪管真的指着目标：s.aimed 只看身体朝向（TWIST 51°），太宽
function onBarrel(s) {
  s.rig.getMuzzle(_mz, _bd);
  _t.copy(s.firePt).sub(_mz).normalize();
  return _bd.dot(_t) > COS_AIM;
}

export function reload(s, m) {
  const g = s.gun;
  if (g.reloadT > 0 || g.mag >= GUN.mag) return;
  g.reloadT = g.reloadLen = GUN.reload * rand(0.9, 1.1);
  g.cue = 0; // 两声换弹声在 updateGun 里按进度放
  g.burst = 0;
}

// 一轮 3~5 发。本轮带一个系统误差：刚发现玩家的第一轮大多打偏，之后逐轮收拢
function startBurst(s) {
  const g = s.gun, T = TUNE, E = T.errDecay;
  g.burst = Math.min(g.mag, T.burstMin + ((Math.random() * (T.burstMax - T.burstMin + 1)) | 0));
  g.shotT = 0;
  g.shot = 0;
  // 跟枪滞后每轮抽一次：同一轮里瞄准点稳定地落在跑动方向后面
  g.lag = rand(T.trackLag[0], T.trackLag[1]);
  const k = E[Math.min(s.onTarget, E.length - 1)];
  s.aimErr.set((Math.random() < 0.5 ? -1 : 1) * rand(T.errSide[0], T.errSide[1]) * k, rand(T.errUp[0], T.errUp[1]) * k, 0);
  // 刚挨了一枪（soldiers_react.js）：一次性加一个偏移
  if (s.shake > 0) {
    s.aimErr.x += (Math.random() < 0.5 ? -1 : 1) * s.shake;
    s.aimErr.y += rand(-0.4, 0.4) * s.shake;
    s.shake = 0;
  }
}

// 开火那一刻眼睛还看得见玩家的眼睛或胸口：感知 10 Hz 有滞后，枪口又比眼睛先探出掩体，不补这一次会隔着墙打
function sees(s, phys, player) {
  if (!phys.blocked(s.eye, player.eye)) return true;
  const p = player.position;
  _b.set(p.x, p.y + player.height * 0.62, p.z);
  return !phys.blocked(s.eye, _b);
}

// 打出去了返回 true；枪管没对上目标、或者枪口和眼睛都贴着掩体时这一发不打，返回 false
function shoot(s, m, player) {
  const { phys, fx, audio } = m, T = TUNE;
  // 看不见人了：这一轮到此为止（updateGun 里 burst 减到 0 收尾）
  if (!sees(s, phys, player)) { s.gun.burst = 1; return false; }
  s.rig.getMuzzle(_mz, _bd);
  _o.copy(_mz);
  _t.copy(s.firePt).sub(_o);
  const dist = _t.length() || 1;
  _t.multiplyScalar(1 / dist);
  // 点射途中枪管被甩开了（扭身补偿还在追、近距离边跑边打）：子弹不能从枪口斜着飞出去
  if (_bd.dot(_t) < COS_AIM) return false;
  _r.set(-_t.z, 0, _t.x).normalize();
  // 系统误差每发收一点：一轮打出去是往目标身上“走”过去的。近处按角度封顶，不然一米多的偏移在五米外就是十几度
  const ek = Math.pow(T.errWalk, s.gun.shot), lim = dist * ERR_K;
  _a.copy(s.firePt).addScaledVector(_r, clamp(s.aimErr.x * ek, -lim, lim));
  _a.y += clamp(s.aimErr.y * ek, -lim, lim);
  // 跟枪滞后：瞄的是玩家一小会儿之前的位置，横着跑的人子弹落在身后。只算水平速度：跳起来时瞄准点不该落到脚下或头顶
  const pv = player.velocity;
  if (pv) { _a.x -= pv.x * s.gun.lag; _a.z -= pv.z * s.gun.lag; }
  _d.copy(_a).sub(_o).normalize();
  const moving = Math.min(1, Math.hypot(s.vel.x, s.vel.z) / 3);
  // 玩家跑动、滑铲时也难打一些：站桩的人最吃亏
  const target = pv ? Math.min(1, Math.hypot(pv.x, pv.z) / 6.3) : 0;
  const sigma = (T.spreadBase + moving * T.spreadSelfMove + target * T.spreadTarget + s.gun.shot * T.spreadShot + dist * T.spreadDist) * levelK(s.level, T.levelStep);
  _d.addScaledVector(_r, gauss() * sigma);
  _d.y += gauss() * sigma * 0.8;
  _d.normalize();
  // 离枪管最多 8°：超出的部分折回到枪管方向
  const c = _d.dot(_bd);
  if (c < COS_MAX) {
    _w.copy(_d).addScaledVector(_bd, -c).normalize();
    _d.copy(_bd).multiplyScalar(COS_MAX).addScaledVector(_w, Math.sqrt(1 - COS_MAX * COS_MAX));
  }
  let hit = phys.raycast(_o, _d, GUN.range);
  if (hit && hit.dist < CLEAR) {
    // 枪口夹在掩体里时从眼睛那儿算弹道（特效仍从枪口出），瞄的还是同一个点
    _w.copy(_o).addScaledVector(_d, dist);
    _o.copy(s.eye);
    _d.copy(_w).sub(_o).normalize();
    hit = phys.raycast(_o, _d, GUN.range);
    if (hit && hit.dist < CLEAR) return false;
  }
  const wd = hit ? hit.dist : GUN.range;
  const ph = player.alive ? hitPlayer(_o, _d, wd, player) : Infinity;
  _end.copy(_o).addScaledVector(_d, ph < Infinity ? ph : wd);
  // 从眼睛算的弹道落点还是贴在枪口前面（掩体边缘）：也不打
  if (ph === Infinity && _end.distanceToSquared(_mz) < CLEAR * CLEAR) return false;

  s.rig.fire();
  fx?.muzzleFlash?.(_mz, _d, 0.8, FLASH);
  fx?.tracer?.(_mz, _end, ENEMY);
  audio?.play?.('npcShot', { position: _mz, volume: 1, pitch: rand(0.96, 1.04) });
  if (ph < Infinity) {
    const k = Math.min(T.soldierDmgCap, 1 + T.soldierDmgStep * (s.level - 1));
    player.takeDamage?.(rand(T.soldierDmg[0], T.soldierDmg[1]) * k, s.pos, 'soldier');
    return true;
  }
  if (hit && m.spendImpact()) {
    fx?.impact?.(hit.point, hit.normal, hit.surface, ENEMY);
    // 落在玩家身边 10 米内才出声；3 米内打在金属上偶尔跳弹
    const d2 = hit.point.distanceToSquared(player.eye);
    if (d2 < 100) {
      audio?.play?.(impactSound(hit.surface), { position: hit.point, volume: 0.7 });
      if (hit.surface === 'metal' && d2 < 9 && Math.random() < 0.3) audio?.play?.('ricochet', { position: hit.point, volume: 0.5 });
    }
  }
  // 擦着头过去的子弹“嗖”一声
  const e = player.eye, te = (e.x - _o.x) * _d.x + (e.y - _o.y) * _d.y + (e.z - _o.z) * _d.z;
  if (player.alive && te > 1 && te < wd) {
    _w.copy(_o).addScaledVector(_d, te);
    if (_w.distanceTo(e) < WHIZ_R && m.spendWhiz()) audio?.play?.('bulletWhiz', { position: _w, volume: 0.9, pitch: rand(0.9, 1.15) });
  }
  return true;
}

// 玩家身体是竖直胶囊，探头时头偏出身体，另加一个跟着 eye 走的小球
function hitPlayer(o, d, maxT, player) {
  const p = player.position, h = player.height || 1.8;
  _a.set(p.x, p.y + BODY_R, p.z);
  _b.set(p.x, p.y + Math.max(BODY_R, h - 0.25 - BODY_R), p.z);
  let t = rayCapsule(o, d, _a, _b, BODY_R, maxT);
  const e = player.eye, ox = o.x - e.x, oy = o.y - e.y, oz = o.z - e.z;
  const bq = ox * d.x + oy * d.y + oz * d.z, disc = bq * bq - (ox * ox + oy * oy + oz * oz - HEAD_R * HEAD_R);
  if (disc >= 0) {
    const th = -bq - Math.sqrt(disc);
    if (th >= 0 && th < t && th <= maxT) t = th;
  }
  return t;
}
