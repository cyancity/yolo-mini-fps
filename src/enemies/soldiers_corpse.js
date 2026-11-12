import * as THREE from 'three';

// 对象池满了要拿尸体当新兵：先收玩家看不见的（视锥外或被挡住）；都看得见就让最早那具沉进地面 0.5 秒再收。
export const SINK = 0.5;
const DEPTH = 0.6;
const CONE = Math.cos(THREE.MathUtils.degToRad(70));
const _t = new THREE.Vector3();

function seen(m, r, player) {
  if (!player?.eye) return false;
  const e = player.eye;
  _t.set(r.pos.x, r.pos.y + 0.4, r.pos.z);
  const dx = _t.x - e.x, dy = _t.y - e.y, dz = _t.z - e.z, d = Math.hypot(dx, dy, dz);
  if (d < 1e-3) return true;
  const yaw = player.yaw || 0, pitch = player.pitch || 0, cp = Math.cos(pitch);
  if ((dx * -Math.sin(yaw) * cp + dy * Math.sin(pitch) + dz * -Math.cos(yaw) * cp) / d < CONE) return false;
  return !m.phys.blocked(e, _t);
}

// 挑一具可以收的尸体：看不见的里面最早倒下的；都看得见时返回最早的一具，pickCorpse.seen 为真
export function pickCorpse(m, player) {
  let hidden = null, any = null;
  for (const r of m.active) {
    if (r.alive || r.sinking) continue;
    if (!any || r.deathT < any.deathT) any = r;
    if ((!hidden || r.deathT < hidden.deathT) && !seen(m, r, player)) hidden = r;
  }
  pickCorpse.seen = !hidden && !!any;
  return hidden || any;
}
pickCorpse.seen = false;

// 每帧推进正在沉的尸体，沉到底就交给 done(记录, 出生请求)
export function sinkStep(m, dt, done) {
  const list = m.sinks;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i], s = e.s;
    e.t -= dt;
    const k = 1 - Math.max(0, e.t) / SINK;
    s.rig.root.position.y = s.pos.y - DEPTH * k * k;
    if (e.t > 0) continue;
    list.splice(i, 1);
    done(s, e);
  }
}
