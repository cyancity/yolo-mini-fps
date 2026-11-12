// 波次回归。开发服务器上的游戏页里加载：await import('/dev/review_waves.js?v=' + Date.now())
// 玩家站在固定位置跑 4 波（不死，看见玩家超过 0.8 秒的敌人打死），记每波时长、首次接敌、最后一个敌人的去向、
// 卡住（30 秒位移 < 2 米且不在交火）、掉出地图、穿墙（0.25 秒采样之间的连线被挡）、悬空、无人机钻屋面。
// 用法：__rw.start(x, y, z)，反复 __rw.run(40) 直到 done，__rw.report()
(() => {
  const D = window.__dbg, G = D.game, P = D.player, S = G.soldiers, R = G.drones, phys = D.level.phys;
  const V = D.camera.position.constructor;
  const a = new V(), b = new V();
  const ROOFS = [{ x0: -30, x1: 30, z0: -32.9, z1: -20, y: 9.0 }, { x0: -30, x1: 8.4, z0: -48, z1: -32.9, y: 8.1 }];
  const MAP = { x0: -30.4, x1: 42.4, z0: -48.4, z1: 21.3 };
  const W = { home: null, waves: {}, rec: new Map(), drec: new Map(), ev: [], t: 0 };
  W.start = (x, y, z) => {
    S.clear(); R.clear(); G.smoke?.clear?.();
    W.home = { x, y, z };
    P.position.set(x, y, z); P.velocity.set(0, 0, 0); P.alive = true; P.health = 100; P.invulnerable = false;
    G.state = 'playing'; G.wave = 0; G.waveActive = false; G.nextWaveAt = G.time + 0.5;
    W.waves = {}; W.rec.clear(); W.drec.clear(); W.ev.length = 0; W.t = 0;
  };
  const ev = (k, o) => { if (W.ev.length < 60) W.ev.push(k + '@w' + G.wave + ' ' + o); };
  const r1 = (x) => Math.round(x * 10) / 10;
  W.tick = (dt) => {
    // 玩家钉在原地（站桩）
    P.position.x = W.home.x; P.position.z = W.home.z; P.velocity.x = P.velocity.z = 0;
    if (!G.waveActive) return;
    const w = (W.waves[G.wave] ||= { dur: 0, firstSee: null, firstWho: '', last: '', kills: 0 });
    w.dur += dt;
    W.t += dt;
    let alive = 0, lastDesc = '';
    for (const s of S.active) {
      if (!s.alive) { W.rec.delete(s); continue; }
      alive++;
      let r = W.rec.get(s);
      if (!r) W.rec.set(s, (r = { see: 0, hist: [], st: 0, prev: s.pos.clone(), pt: 0, hov: 0 }));
      if (s.sees) { if (w.firstS == null) w.firstS = `${r1(w.dur)}s d${r1(Math.hypot(s.pos.x - W.home.x, s.pos.z - W.home.z))}`; if (w.firstSee == null) { w.firstSee = r1(w.dur); w.firstWho = `s ${s.state} d${r1(Math.hypot(s.pos.x - W.home.x, s.pos.z - W.home.z))} y${r1(s.pos.y)}`; } r.see += dt; }
      if (r.see > 0.8) { w.last = `s killed ${r1(s.pos.x)},${r1(s.pos.y)},${r1(s.pos.z)} t${r1(w.dur)}`; S.hit(s, 1000, s.chest, null, 'head'); w.kills++; continue; }
      r.pt += dt;
      if (r.pt >= 0.25) {
        r.pt = 0;
        a.set(r.prev.x, r.prev.y + 1.0, r.prev.z); b.set(s.pos.x, s.pos.y + 1.0, s.pos.z);
        if (a.distanceTo(b) > 0.05 && phys.blocked(a, b)) ev('soldierWall', `${r1(s.pos.x)},${r1(s.pos.y)},${r1(s.pos.z)}`);
        r.prev.copy(s.pos);
        r.hist.push(s.pos.clone()); if (r.hist.length > 120) r.hist.shift();
        if (r.hist.length === 120 && r.hist[0].distanceTo(s.pos) < 2 && s.state !== 'combat' && !r.stuckFlag) { r.stuckFlag = true; ev('stuck30', `${s.state}/${s.tac} ${r1(s.pos.x)},${r1(s.pos.y)},${r1(s.pos.z)}`); }
        const gh = phys.groundHeight(s.pos.x, s.pos.z, 0.25, s.pos.y + 0.4, 0.5);
        if (s.pos.y - gh > 0.35) { r.hov++; if (r.hov === 8) ev('hover2s', `${r1(s.pos.x)},${r1(s.pos.y)},${r1(s.pos.z)} g${r1(gh)}`); } else r.hov = 0;
        if (s.pos.y < -1 || s.pos.x < MAP.x0 - 1 || s.pos.x > MAP.x1 + 1 || s.pos.z < MAP.z0 - 1 || s.pos.z > MAP.z1 + 1) ev('outOfMap', `${r1(s.pos.x)},${r1(s.pos.y)},${r1(s.pos.z)}`);
      }
      lastDesc = `s ${s.state}/${s.tac} ${r1(s.pos.x)},${r1(s.pos.y)},${r1(s.pos.z)} d${r1(Math.hypot(s.pos.x - W.home.x, s.pos.z - W.home.z))}`;
    }
    for (const d of R.drones) {
      if (!d.alive || d.delay > 0) continue;
      alive++;
      let r = W.drec.get(d);
      if (!r) W.drec.set(d, (r = { see: 0, prev: d.position.clone(), pt: 0 }));
      if (d.sees) { if (w.firstSee == null) { w.firstSee = r1(w.dur); w.firstWho = `d ${d.state} d${r1(Math.hypot(d.position.x - W.home.x, d.position.z - W.home.z))} y${r1(d.position.y)}`; } r.see += dt; }
      if (r.see > 0.8) { w.last = `d killed ${r1(d.position.x)},${r1(d.position.y)},${r1(d.position.z)} t${r1(w.dur)}`; R.hit(d, 1000, d.position.clone(), null); w.kills++; continue; }
      r.pt += dt;
      if (r.pt >= 0.25) {
        r.pt = 0;
        if (r.prev.distanceTo(d.position) > 0.05 && phys.blocked(r.prev, d.position)) ev('droneWall', `${r1(d.position.x)},${r1(d.position.y)},${r1(d.position.z)}`);
        r.prev.copy(d.position);
        for (const f of ROOFS) if (d.position.x > f.x0 && d.position.x < f.x1 && d.position.z > f.z0 && d.position.z < f.z1 && d.position.y < f.y + 0.3) ev('droneUnderRoof', `${r1(d.position.x)},${r1(d.position.y)},${r1(d.position.z)}`);
      }
      lastDesc = `d ${d.state} ${r1(d.position.x)},${r1(d.position.y)},${r1(d.position.z)}`;
    }
    if (alive === 1 && lastDesc) w.last = lastDesc + ' t' + r1(w.dur);
  };
  W.run = (sec) => {
    for (let i = 0; i < sec * 120 && G.wave <= 4; i++) {
      if (G.wave === 4 && !G.waveActive && W.waves[4]) break;
      D.step(1 / 120); W.tick(1 / 120);
    }
    return { wave: G.wave, active: G.waveActive, t: r1(W.t) };
  };
  W.report = () => ({ waves: W.waves, ev: W.ev });
  window.__rw = W;
  return 'ok';
})();
