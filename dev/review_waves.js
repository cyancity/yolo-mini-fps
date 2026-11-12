// 区域目标回归。开发服务器上的游戏页里加载：await import('/dev/review_waves.js?v=' + Date.now())，先 __dbg.play('waves')。
// 从第 1 个目标起连清 n 个。每个目标：
//   1. 刷人那一刻记每个人刷在哪：是不是在目标区域里、离玩家多远、玩家看不看得见（头和胸口两条视线）；
//   2. 玩家先留在原地 wait 秒（默认 20）：这段时间驻守的人不该出区域（leftZone 记出了区域的人）；
//   3. 把玩家传送到目标区域里的站位，看见玩家超过 0.8 秒的敌人打死；进区域 lure 秒（默认 25）后还有人没露面，
//      用 0 伤害的命中惊动剩下的人，之后每 10 秒再惊动一次。
// 另记：清完到下一个目标出现的间隔 gap、卡住（赶路中 10 秒位移 < 1 米）、掉出地图、穿墙（0.25 秒采样之间的连线被挡）、
// 悬空、无人机钻屋面。玩家无敌。
// 用法：__rw.start(6)，反复 __rw.run(60) 直到返回的 done 为真，__rw.report()。start(n, { wait, lure }) 可以改那两个时长
import { objectiveAt, MAP, ROOF } from '../src/world/plan.js';

{
  const D = window.__dbg, G = D.game, P = D.player, S = G.soldiers, R = G.drones, phys = D.level.phys;
  const V = D.camera.position.constructor;
  const a = new V(), b = new V();
  const ROOFS = [ROOF.warehouse, ROOF.office];
  // 各区域里玩家的站位（脚底），吸到最近的网格点上
  const STAND = { yard: [-9, 0, 16], warehouse: [0, 1.1, -26], office: [-10, 1.1, -40], rooftop: [0, 9, -26], street: [36, 0, 0] };
  const W = { goals: {}, rec: new Map(), drec: new Map(), ev: [], n: 6, wait: 20, lure: 25, cur: 0, clearT: null, done: false };
  const r1 = (x) => Math.round(x * 10) / 10;
  const at = (p) => `${r1(p.x)},${r1(p.y)},${r1(p.z)}`;
  const ev = (k, o) => { if (W.ev.length < 60) W.ev.push(`${k}@${G.wave} ${o}`); };
  const sees = (p) => !phys.blocked(P.eye, a.set(p.x, p.y + 1.6, p.z)) || !phys.blocked(P.eye, a.set(p.x, p.y + 0.9, p.z));
  const stand = (zone) => {
    const [x, y, z] = STAND[zone] || STAND.yard, n = S.nav.nearest(x, y, z, 3);
    if (n >= 0) P.position.set(S.nav.cx(n), S.nav.nY[n], S.nav.cz(n)); else P.position.set(x, y, z);
    P.velocity.set(0, 0, 0);
    D.step(1 / 60); // 眼睛跟到新位置
  };
  W.start = (n = 6, { wait = 20, lure = 25 } = {}) => {
    if (G.state !== 'playing' || G.mode !== 'waves') D.play('waves');
    S.clear(); R.clear(); G.smoke?.clear?.();
    Object.assign(W, { goals: {}, ev: [], n, wait, lure, cur: 0, clearT: null, done: false });
    W.rec.clear(); W.drec.clear();
    P.alive = true; P.health = 100; P.invulnerable = true;
    stand('yard');
    Object.assign(G, { state: 'playing', wave: 0, routeI: 0, cleared: 0, zone: '', waveActive: false, nextWaveAt: G.time + 0.5 });
  };
  W.tick = (dt) => {
    if (!G.waveActive) {
      if (W.cur && W.clearT == null) { W.clearT = G.time; if (G.wave >= W.n) W.done = true; }
      return;
    }
    if (G.wave !== W.cur) {
      W.cur = G.wave;
      W.goals[G.wave] = { zone: G.zone, n: 0, spawnMin: null, spawnSeen: 0, spawnOut: 0, gap: W.clearT == null ? null : r1(G.time - W.clearT), leftZone: 0, dur: 0, firstSee: null, kills: 0, lured: 0, inAt: null, last: '' };
      W.clearT = null;
    }
    const w = W.goals[G.wave], zone = w.zone;
    w.dur += dt;
    if (w.inAt == null && w.dur >= W.wait) { w.inAt = w.dur; stand(zone); }
    const inside = w.inAt != null;
    let alive = 0, lastDesc = '';
    for (const s of S.active) {
      if (!s.alive) { W.rec.delete(s); continue; }
      alive++;
      let r = W.rec.get(s);
      if (!r) {
        W.rec.set(s, (r = { see: 0, hist: [], prev: s.pos.clone(), pt: 0, hov: 0, out: false }));
        // 刚刷出来：位置核对
        const d = Math.hypot(s.pos.x - P.position.x, s.pos.y - P.position.y, s.pos.z - P.position.z);
        w.n++;
        w.spawnMin = w.spawnMin == null ? r1(d) : Math.min(w.spawnMin, r1(d));
        if (sees(s.pos)) { w.spawnSeen++; ev('spawnSeen', at(s.pos)); }
        if (objectiveAt(s.pos.x, s.pos.y, s.pos.z) !== zone) { w.spawnOut++; ev('spawnOut', at(s.pos)); }
      }
      if (!inside && !r.out && objectiveAt(s.pos.x, s.pos.y, s.pos.z) !== zone) { r.out = true; w.leftZone++; ev('leftZone', `${s.state} ${at(s.pos)}`); }
      if (inside && s.sees) {
        if (w.firstSee == null) w.firstSee = `${r1(w.dur - w.inAt)}s ${s.state} d${r1(s.dist)}`;
        r.see += dt;
      }
      if (r.see > 0.8) { w.last = `s killed ${at(s.pos)} t${r1(w.dur)}`; S.hit(s, 1000, s.chest, null, 'head'); w.kills++; continue; }
      r.pt += dt;
      if (r.pt >= 0.25) {
        r.pt = 0;
        a.set(r.prev.x, r.prev.y + 1.0, r.prev.z); b.set(s.pos.x, s.pos.y + 1.0, s.pos.z);
        if (a.distanceTo(b) > 0.05 && phys.blocked(a, b)) ev('soldierWall', at(s.pos));
        r.prev.copy(s.pos);
        const trying = s.pathN > s.pathI && s.speedWant > 0.3;
        r.hist.push(trying ? s.pos.clone() : null); if (r.hist.length > 40) r.hist.shift();
        if (r.hist.length === 40 && r.hist.every(Boolean) && r.hist[0].distanceTo(s.pos) < 1 && !r.stuckFlag) { r.stuckFlag = true; ev('stuck10', `${s.state}/${s.tac} ${at(s.pos)}`); }
        const gh = phys.groundHeight(s.pos.x, s.pos.z, 0.25, s.pos.y + 0.4, 0.5);
        if (s.pos.y - gh > 0.35) { r.hov++; if (r.hov === 8) ev('hover2s', `${at(s.pos)} g${r1(gh)}`); } else r.hov = 0;
        if (s.pos.y < -1 || s.pos.x < MAP.x0 - 1 || s.pos.x > MAP.x1 + 1 || s.pos.z < MAP.z0 - 1 || s.pos.z > MAP.z1 + 1) ev('outOfMap', at(s.pos));
      }
      lastDesc = `s ${s.state}/${s.tac} ${at(s.pos)}`;
    }
    for (const d of R.drones) {
      if (!d.alive || d.delay > 0) continue;
      alive++;
      let r = W.drec.get(d);
      if (!r) W.drec.set(d, (r = { see: 0, prev: d.position.clone(), pt: 0 }));
      if (d.sees) { if (w.firstSee == null) w.firstSee = `${r1(w.dur)}s drone ${d.state}`; r.see += dt; }
      if (r.see > 0.8) { w.last = `d killed ${at(d.position)} t${r1(w.dur)}`; R.hit(d, 1000, d.position.clone(), null); w.kills++; continue; }
      r.pt += dt;
      if (r.pt >= 0.25) {
        r.pt = 0;
        if (r.prev.distanceTo(d.position) > 0.05 && phys.blocked(r.prev, d.position)) ev('droneWall', at(d.position));
        r.prev.copy(d.position);
        for (const f of ROOFS) if (d.position.x > f.x0 && d.position.x < f.x1 && d.position.z > f.z0 && d.position.z < f.z1 && d.position.y < f.y + 0.3) ev('droneUnderRoof', at(d.position));
      }
      lastDesc = `d ${d.state} ${at(d.position)}`;
    }
    // 进了区域还有人一直没露面：惊动他们（等于朝他们开了一枪）
    if (inside && w.dur - w.inAt > W.lure + w.lured * 10) {
      w.lured++;
      for (const s of S.active) if (s.alive && s.state !== 'combat') S.hit(s, 0, s.chest, null, 'torso');
    }
    if (alive === 1 && lastDesc) w.last = `${lastDesc} t${r1(w.dur)}`;
  };
  W.run = (sec) => {
    for (let i = 0; i < sec * 120 && !W.done; i++) { D.step(1 / 120); W.tick(1 / 120); }
    return { goal: G.wave, zone: G.zone, active: G.waveActive, done: W.done };
  };
  W.report = () => {
    const goals = {};
    for (const k in W.goals) { const w = { ...W.goals[k] }; w.dur = r1(w.dur); w.inAt = w.inAt == null ? null : r1(w.inAt); goals[k] = w; }
    return { goals, ev: W.ev };
  };
  window.__rw = W;
}
