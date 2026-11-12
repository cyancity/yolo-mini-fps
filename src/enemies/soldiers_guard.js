import * as THREE from 'three';
import { SPEED } from './soldiers_move.js';
import { setGoal, setWaypoint } from './soldiers_states.js';
import { waveRoles } from './soldiers_roles.js';
import { CONTACT } from './contact.js';
import { TUNE } from './tuning.js';
import { objectiveAt } from '../world/plan.js';

// 驻守：一个区域目标的敌人刷在该区域自己的出生点上，在岗位附近站岗、小范围走动，不出区域找人，玩家不过去就一直等着。
// 看见玩家、挨打、听见附近的枪声以后走原来的交战逻辑（分工、掩体、包抄）；丢了玩家、搜完一轮就走回岗位。
// 记录上的 zone 是所守的区域名（spawnWave 进场的人是空串），station 是岗位。
const BACK = 8; // 离岗位超过这么远（或者不在一层）就先走回去
const _e = new THREE.Vector3(), _v = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);

// 玩家看不看得见站在这儿的人：头和胸口两条视线都被挡住才算看不见（不管玩家朝哪边看）
function seenAt(m, eye, x, y, z) {
  if (!eye) return false;
  _e.copy(eye);
  return !m.phys.blocked(_e, _v.set(x, y + 1.6, z)) || !m.phys.blocked(_e, _v.set(x, y + 0.9, z));
}

// 挑出生点：只用这个区域的点，玩家看得见的、离玩家不到 guardNear 的不用；一个都不满足时取最远的那个。
// 人数按区域的出生点数量封顶；合格的点不够就几个人共用一个点，后来的在旁边错开一格
function pickPosts(m, zone, count, player) {
  const all = (m.level?.spawns || []).filter((p) => p.zone === zone);
  if (!all.length) return [];
  const pp = player?.position, eye = player?.eye, nav = m.nav;
  const info = all.map((p) => {
    const y = p.y || 0, d = pp ? Math.hypot(p.x - pp.x, y - pp.y, p.z - pp.z) : 99;
    return { p, d, ok: d >= TUNE.guardNear && !seenAt(m, eye, p.x, y, p.z), k: Math.random() };
  });
  let pool = info.filter((r) => r.ok).sort((a, b) => a.k - b.k);
  if (!pool.length) pool = [info.reduce((a, b) => (b.d > a.d ? b : a))];
  const out = [];
  for (let i = 0, n = Math.min(count, all.length); i < n; i++) {
    const r = pool[i % pool.length], p = r.p, y = p.y || 0;
    let x = p.x, z = p.z;
    if (i >= pool.length && nav.ready) {
      // 错开的位置要从原点直着走得到（不落到墙另一边），玩家也看不见；试几次都不行就叠在原点上（反正看不见），走动起来就散开了。
      // 原点本来就看得见（都不合格时取的最远点）就不挑了，走得到就行，不叠成一摞
      const a = nav.nearest(x, y, z, 2);
      for (let t = 0; t < 4 && a >= 0; t++) {
        const b = nav.nearest(p.x + rand(-1.4, 1.4), y, p.z + rand(-1.4, 1.4), 0.6);
        if (b < 0 || b === a || !nav.lineWalk(a, b) || (r.ok && seenAt(m, eye, nav.cx(b), nav.nY[b], nav.cz(b)))) continue;
        x = nav.cx(b); z = nav.cz(b);
        break;
      }
    }
    out.push({ x, y, z, dist: r.d, ok: r.ok });
  }
  return out;
}

// SoldierManager.spawnGarrison 的实现。返回刷了几个（这个区域没有出生点时是 0）
export function spawnGuards(m, zone, count, level, player) {
  m.player = player || m.player;
  m.setLevel(level);
  CONTACT.soldier = false;
  m.ensureNav(false);
  const pts = pickPosts(m, zone, count, m.player), roles = waveRoles(pts.length, level);
  // 验收用：这一次刷在哪、当时离玩家多远、是不是合格的点（都不合格时取的最远点 ok 为 false）
  m.spawnLog = pts.map((p) => ({ x: p.x, y: p.y, z: p.z, zone, dist: +p.dist.toFixed(1), ok: p.ok }));
  for (let i = 0; i < pts.length; i++) m.place(pts[i].x, pts[i].y, pts[i].z, level, { zone, wait: rand(0, 1.5), role: roles[i] });
  return pts.length;
}

// 站岗（soldier_ai.js 的 patrol 每隔几秒调一次）：在岗位周围 guardRoam 米内挪一处，或者原地换个方向看。
// 要去的格子得还在自己的区域里、从脚下直着走得到：不绕到墙另一边，不走出区域
export function guardWalk(s, m) {
  const nav = m.nav, st = s.station;
  if (!nav.ready) return;
  if ((s.pos.x - st.x) ** 2 + (s.pos.z - st.z) ** 2 > BACK * BACK || Math.abs(s.pos.y - st.y) > 1.5) { guardReturn(s); return; }
  if (Math.random() < 0.55) {
    const from = nav.nearest(s.pos.x, s.pos.y, s.pos.z, 1.5), n = nav.randomNear(st.x, st.y, st.z, TUNE.guardRoam, 3);
    if (from >= 0 && n >= 0 && n !== from && objectiveAt(nav.cx(n), nav.nY[n], nav.cz(n)) === s.zone && nav.lineWalk(from, n)) {
      setWaypoint(s, nav, n, SPEED.walk);
      return;
    }
  }
  s.lookBase = rand(-Math.PI, Math.PI);
}

// 回岗位：搜索到点还没找到人（soldier_ai.js 的 search）
export function guardReturn(s) {
  const st = s.station;
  s.home.copy(st);
  setGoal(s, st.x, st.y, st.z, 2.2);
}
