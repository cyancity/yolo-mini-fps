// DOCK ZERO 敌人杀伤力量法（T1~T6），数字定在 src/enemies/tuning.js。开发服务器上的游戏页里加载：
//   await import('/dev/tune_measure.js?v=' + Date.now())
// 前提：__dbg.ready，且已经 __dbg.play('waves')。脚本把 game.nextWaveAt 设成 Infinity，不让波次自己刷人。
// 在 dev/drone.html?sim 里加载时只有 __tune.t5s（空旷场地的无人机自然交火）。
// 用法（每个返回 5 次以上的明细和中位数）：
//   __tune.t1(5)  站桩：OPEN 空地，3 个第 3 波士兵在 15~20 米，方向每次从看得见玩家的方向里随机挑（间隔至少 45°）。t100 = 第一个人看见玩家起累计 100 点伤害的秒数；
//                 dmg30 = 看见后 30 秒的累计伤害（T6）；still = 没名额的人最长原地不动秒数
//   __tune.t2(5)  跑动：同上，玩家以 6.3 m/s 沿 x 来回横移 8 米，士兵只摆在和 x 轴夹角 45° 以上的方向（对他们是横着跑），15 秒累计伤害
//   __tune.t3(5)  探头：玩家在高掩体（集装箱）后 HIDE，每 3 秒挪到 PEEK 露 0.8 秒，30 秒；
//                 先用 0 伤害的 hit 惊动 3 个士兵、躲 3 秒再开始。perPeek 每次露头的平均伤害，clean06 头 0.6 秒不中弹的比例
//   __tune.t4(5)  大波次：OPEN 空地，8 个第 6 波士兵摆在 14~24 米的一圈（随机方向），加 spawnWave(3, 6) 的无人机，到 100 点的秒数
//   __tune.t4w(5) 同上但士兵用 spawnWave(8, 6) 从正常出生点进场
//   __tune.t5(5, level, run)  1 架无人机，强制悬停在 20 米外（关掉开波静默），看见后 20 秒的每秒伤害；run=true 时玩家横移
//   __tune.t5n(5, level, run, count)  不强制位置、不关俯冲：count 架无人机自己选悬停点，进场 20 秒后再量 20 秒的每秒伤害
//   __tune.t5s(5, level, run, count)  同 t5n，但在 dev/drone.html?sim 的空旷场地（没有遮挡，是上限）
//   __tune.check()  量场前确认空地和掩体还是空的（另一个 agent 在往室外加掩体）
// 玩家不死：包住 player.takeDamage 记下时间、数值、来源，再把血补满。不用 god（god 下不记伤害）。
// 每次开火时检查士兵眼睛到玩家眼睛和胸口是否都被挡住，记在 blocked（第 7 条：挡住不开火）；
// 这和 soldiers_gun.js 的检查是同一条，按构造是 0。另从枪口再查一次记在 mBlocked（枪口比眼睛先探出去时可能不是 0，只作参考）。
(() => {
  // 无人机预览页：假玩家没有 takeDamage 包装，直接读 player.hits
  if (!window.__dbg && window.__sim) {
    const sim = window.__sim, mgr = sim.mgr, pl = sim.player;
    const med = (xs) => { const v = xs.filter((x) => x != null && isFinite(x)).sort((p, q) => p - q); return v.length ? v[(v.length - 1) >> 1] * 0.5 + v[v.length >> 1] * 0.5 : null; };
    const t5s = (n = 5, level = 3, running = false, count = 1) => {
      const runs = [];
      for (let i = 0; i < n; i++) {
        sim.reset();
        pl.position.set(0, 0, 6);
        sim.walk = running ? (t) => { const L = 8, u = (t * 6.3) % (2 * L); return [-4 + (u < L ? u : 2 * L - u), 6]; } : null;
        mgr.spawnWave(count, level);
        mgr.waveT = -100;
        for (const d of mgr.drones) d.delay = Math.min(d.delay, 0.01);
        sim.step(20);
        const t0 = mgr.time;
        sim.step(20);
        let s = 0, near = 0;
        for (const h of pl.hits) if (h.t >= t0) { s += h.amount; if (Math.hypot(h.from[0] - pl.position.x, h.from[2] - pl.position.z) < 10) near += h.amount; }
        runs.push({ dps: Math.round(s / 20 * 100) / 100, near: Math.round(near) });
      }
      sim.walk = null;
      return { median: med(runs.map((r) => r.dps)), runs };
    };
    window.__tune = { t5s };
    return 'ok (sim)';
  }
  const D = window.__dbg, G = D.game, P = D.player, S = G.soldiers, R = G.drones, phys = D.level.phys;
  const V = D.camera.position.constructor;
  const OPEN = { x: 4, z: 2 };
  // 堆场中部一只集装箱的北侧：箱体在 x>6.2、z>-1.88，高 2.6 米以上。HIDE 在箱后，PEEK 从西头露出 0.8 米
  const HIDE = { x: 7.6, z: -2.4 }, PEEK = { x: 5.4, z: -2.4 };
  const PEEK_SOLDIERS = [[1.5, 14.5], [5.5, 15.5], [9.5, 14.5]];
  const ring3 = [0, 4, 11].map((k) => k * Math.PI / 8);
  const a = new V(), b = new V();
  // 钩子只装一次，重新加载脚本时沿用同一份记录
  const ST = (window.__tuneState ||= { log: [], mv: { fn: null }, fire: { n: 0, blocked: 0, mBlocked: 0, times: [] }, sawT: new Float64Array(64) });
  const { log, mv, fire, sawT } = ST;
  const mz = new V(), md = new V();
  const med = (xs) => { const v = xs.filter((x) => x != null && isFinite(x)).sort((p, q) => p - q); return v.length ? v[(v.length - 1) >> 1] * 0.5 + v[v.length >> 1] * 0.5 : null; };
  const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

  if (!P.__tune) {
    P.__tune = true;
    const take = P.takeDamage.bind(P), upd = P.update.bind(P);
    P.takeDamage = function (amt, from, kind) {
      if (!this.alive || this.invulnerable) return;
      log.push({ t: G.time, a: amt, k: kind || '?', d: from ? Math.hypot(from.x - this.position.x, from.z - this.position.z) : null });
      this.health = 100;
      take(amt, from, kind);
      this.health = 100;
    };
    // 跑动：原来的更新跑完后把位置挪到轨迹上（眼睛一起挪），速度写成轨迹速度（敌人的散布读它）
    P.update = function (dt) {
      upd(dt);
      if (mv.fn) mv.fn(dt);
    };
  }
  // 每发子弹：开火那一刻士兵眼睛到玩家眼睛和胸口是否都被挡住
  function hookRigs() {
    for (const s of S.records) {
      const rig = s.rig;
      if (!rig || rig.__tune) continue;
      rig.__tune = true;
      const f = rig.fire.bind(rig);
      rig.fire = function () {
        fire.n++;
        fire.times.push(G.time);
        a.set(P.position.x, P.position.y + P.height * 0.62, P.position.z);
        if (phys.blocked(s.eye, P.eye) && phys.blocked(s.eye, a)) { fire.blocked++; fire.lastBlockedT = G.time; }
        rig.getMuzzle(mz, md);
        if (phys.blocked(mz, P.eye) && phys.blocked(mz, a)) fire.mBlocked++;
        return f();
      };
    }
  }

  function reset(x, z) {
    S.clear();
    R.clear();
    G.smoke?.clear?.();
    G.nextWaveAt = Infinity;
    G.waveActive = false;
    G.state = 'playing';
    P.invulnerable = false;
    P.alive = true;
    P.health = 100;
    P.position.set(x, 0, z);
    P.velocity.set(0, 0, 0);
    P.crouchLatch = false;
    mv.fn = null;
    log.length = 0;
    fire.n = fire.blocked = fire.mBlocked = 0;
    sawT.fill(-99);
    fire.times.length = 0;
    D.step(1 / 60);
    hookRigs();
  }
  const sum = (t0, t1) => { let s = 0; for (const e of log) if (e.t >= t0 && e.t < t1) s += e.a; return s; };
  const t100 = (t0) => { let s = 0; for (const e of log) { if (e.t < t0) continue; s += e.a; if (s >= 100) return e.t - t0; } return null; };
  const anySees = () => S.active.some((s) => s.alive && s.sees);
  const ground = (x, z) => { const n = S.nav.nearest(x, 0, z, 0.6); return n >= 0 && Math.abs(S.nav.nY[n]) < 0.3; };
  const strafe = (cx, cz, half) => {
    let t = 0;
    return (dt) => {
      t += dt;
      const L = half * 2, u = (t * 6.3) % (2 * L), x = cx - half + (u < L ? u : 2 * L - u), vx = u < L ? 6.3 : -6.3;
      const dx = x - P.position.x, dz = cz - P.position.z;
      P.position.x += dx; P.position.z += dz; P.eye.x += dx; P.eye.z += dz;
      P.velocity.set(vx, 0, 0);
    };
  };
  // 每帧统计：最多同时开火的士兵、没名额的人最长原地不动
  function tracker() {
    const still = new Float64Array(16), max = new Float64Array(16), moved = new Float64Array(16), last = [];
    let maxShooters = 0, maxDroneFiring = 0;
    return {
      tick(dt) {
        let sh = 0;
        for (const s of S.active) {
          if (!s.alive) continue;
          if (s.token) sh++;
          const sp = Math.hypot(s.vel.x, s.vel.z);
          moved[s.id] += sp * dt;
          // 蹲在掩体后等名额（hold + postCover）算正常，不算发呆
          if (!s.token && sp < 0.2 && !(s.tac === 'hold' && s.postCover && s.crouch > 0.5) && s.state === 'combat') still[s.id] += dt;
          else still[s.id] = 0;
          max[s.id] = Math.max(max[s.id], still[s.id]);
        }
        let df = 0;
        for (const d of R.drones) if (d.alive && d.fire.phase !== 'idle') df++;
        maxShooters = Math.max(maxShooters, sh);
        maxDroneFiring = Math.max(maxDroneFiring, df);
      },
      get() {
        let ms = 0, mvd = [];
        for (const s of S.active) { ms = Math.max(ms, max[s.id]); mvd.push(r2(moved[s.id])); }
        return { maxShooters, maxDroneFiring, still: r2(ms), moved: mvd };
      },
    };
  }
  function run(sec, tr, until) {
    const n = Math.round(sec * 120);
    for (let i = 0; i < n; i++) {
      D.step(1 / 120);
      for (const s of S.active) if (s.alive && s.sees) sawT[s.id] = G.time;
      tr?.tick(1 / 120);
      if (until && until()) return i / 120;
    }
    return sec;
  }
  function waitSight(maxT, tr) {
    run(maxT, tr, anySees);
    return anySees() ? G.time : null;
  }
  // 一圈摆人：每个方向要地面可走、能直接看见玩家；被新加的掩体挡住时就近换 1~2 格（22.5° 一格）
  function spawnRing(cx, cz, angs, rmin, rmax, level) {
    const used = [];
    for (const ang0 of angs) {
      let done = false;
      for (const off of [0, 1, -1, 2, -2]) {
        const ang = ang0 + off * Math.PI / 8;
        if (used.some((u) => Math.abs(u - ang) < 0.01)) continue;
        for (let k = 0; k < 6 && !done; k++) {
          const r = rmin + Math.random() * (rmax - rmin), x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
          a.set(cx, 1.1, cz); b.set(x, 1.6, z);
          if (!ground(x, z) || phys.blocked(a, b)) continue;
          S.spawnAt(x, 0, z, level);
          used.push(ang);
          done = true;
        }
        if (done) break;
      }
    }
  }

  // 每次随机挑方向：16 个方向里 17 米处地面可走、能直接看见玩家的，洗牌后按至少 gap 格（22.5° 一格）的间隔取 n 个。
  // 摆件在变，固定方向的结果跟着地形跳，随机方向取中位数才稳
  // lateral：只要和横移方向（x 轴）夹角不小于 45° 的方向，玩家对他们来说是横着跑，不是迎面或背向跑
  function pickDirs(n, gap, lateral) {
    const ok = [];
    for (let k = 0; k < 16; k++) {
      if (lateral && Math.abs(Math.cos(k * Math.PI / 8)) > 0.75) continue;
      const ang = k * Math.PI / 8, x = OPEN.x + Math.cos(ang) * 17, z = OPEN.z + Math.sin(ang) * 17;
      a.set(OPEN.x, 1.1, OPEN.z); b.set(x, 1.6, z);
      if (ground(x, z) && !phys.blocked(a, b)) ok.push(k);
    }
    for (let i = ok.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [ok[i], ok[j]] = [ok[j], ok[i]]; }
    const out = [];
    for (const k of ok) if (out.length < n && out.every((q) => Math.min((k - q + 16) % 16, (q - k + 16) % 16) >= gap)) out.push(k);
    for (const k of ok) if (out.length < n && !out.includes(k)) out.push(k);
    return out.map((k) => k * Math.PI / 8);
  }

  function t1once() {
    reset(OPEN.x, OPEN.z);
    const tr = tracker();
    spawnRing(OPEN.x, OPEN.z, pickDirs(3, 2), 15, 20, 3);
    const t0 = waitSight(8, tr);
    if (t0 == null) return { err: 'no sight' };
    run(30, tr);
    return { t100: r2(t100(t0)), dmg30: r2(sum(t0, t0 + 30)), shots: fire.n, blocked: fire.blocked, mBlocked: fire.mBlocked, ...tr.get() };
  }
  function t2once() {
    reset(OPEN.x, OPEN.z);
    const tr = tracker();
    mv.fn = strafe(OPEN.x, OPEN.z, 4);
    spawnRing(OPEN.x, OPEN.z, pickDirs(3, 2, true), 15, 20, 3);
    const t0 = waitSight(8, tr);
    if (t0 == null) return { err: 'no sight' };
    run(15, tr);
    let near = 0;
    for (const e of log) if (e.t >= t0 && e.t < t0 + 15 && e.d < 10) near += e.a;
    return { dmg15: r2(sum(t0, t0 + 15)), near10: r2(near), shots: fire.n, blocked: fire.blocked, ...tr.get() };
  }
  function t3once() {
    reset(HIDE.x, HIDE.z);
    const tr = tracker();
    for (const [x, z] of PEEK_SOLDIERS) S.spawnAt(x + Math.random() - 0.5, 0, z + Math.random() - 0.5, 3);
    // 惊动：0 伤害的命中，进交火、知道玩家在哪
    for (const s of S.active) S.hit(s, 0, s.chest, null, 'limb');
    run(3, tr);
    const peeks = [], near = [];
    const T0 = G.time;
    for (let i = 0; i < 10; i++) {
      const ts = G.time;
      // 已经绕到侧面、躲着时也看得见玩家的人数（露头前 1 秒内看见过）：这种探头不是“重新露头”，单独统计
      const flank = S.active.filter((s) => s.alive && ts - sawT[s.id] < 1).length;
      P.position.set(PEEK.x, 0, PEEK.z);
      run(0.8, tr);
      P.position.set(HIDE.x, 0, HIDE.z);
      run(2.2, tr);
      const hits = log.filter((e) => e.t >= ts && e.t < ts + 0.8);
      const shot = fire.times.find((t) => t >= ts && t < ts + 0.8);
      // 露头时离玩家最近的士兵（推得太近是 T3 不达标的主因）
      let nearest = Infinity;
      for (const s of S.active) if (s.alive) nearest = Math.min(nearest, Math.hypot(s.pos.x - PEEK.x, s.pos.z - PEEK.z));
      near.push(nearest);
      peeks.push({ shot: shot == null ? null : shot - ts, dmg: sum(ts, ts + 0.8), first: hits.length ? hits[0].t - ts : null, flank, hd: hits.map((e) => r2(e.t - ts) + '@' + Math.round(e.d)).join(',') });
    }
    const hidden = sum(T0, G.time) - peeks.reduce((s, p) => s + p.dmg, 0);
    const pp = peeks.filter((p) => !p.flank);
    return {
      perPeek: r2(peeks.reduce((s, p) => s + p.dmg, 0) / peeks.length),
      clean06: r2(peeks.filter((p) => p.first == null || p.first > 0.6).length / peeks.length),
      // 只算没被绕侧的探头
      perPeekF: pp.length ? r2(pp.reduce((s, p) => s + p.dmg, 0) / pp.length) : null,
      clean06F: pp.length ? r2(pp.filter((p) => p.first == null || p.first > 0.6).length / pp.length) : null,
      flanked: peeks.filter((p) => p.flank).length,
      // 没被绕侧的探头里，露头到第一发子弹（不论中没中）的秒数
      firstShot: pp.filter((p) => p.shot != null).map((p) => r2(p.shot)).join(' '),
      hits: peeks.filter((p) => p.hd).map((p) => p.hd + (p.flank ? '*' : '')).join(' | '),
      peeks: peeks.map((p) => r2(p.dmg) + (p.flank ? '*' : '')).join(' '), hidden: r2(hidden), minNear: r2(Math.min(...near)), shots: fire.n, blocked: fire.blocked, mBlocked: fire.mBlocked, ...tr.get(),
    };
  }
  function t4once(natural, level = 6, drones = 3) {
    reset(OPEN.x, OPEN.z);
    const tr = tracker();
    if (natural) S.spawnWave(8, level, P);
    else spawnRing(OPEN.x, OPEN.z, pickDirs(8, 1), 14, 24, level);
    R.spawnWave(drones, level);
    const t0 = waitSight(natural ? 40 : 8, tr);
    if (t0 == null) return { err: 'no sight' };
    run(20, tr, () => sum(t0, Infinity) >= 100);
    const kinds = {};
    for (const e of log) kinds[e.k] = r2((kinds[e.k] || 0) + e.a);
    return { t100: r2(t100(t0)), kinds, n: S.active.length, shots: fire.n, blocked: fire.blocked, ...tr.get() };
  }
  function t5once(level, running) {
    reset(OPEN.x, OPEN.z);
    const tr = tracker();
    if (running) mv.fn = strafe(OPEN.x, OPEN.z, 4);
    R.spawnWave(1, level);
    R.waveT = -100;
    const d = R.drones[0];
    d.delay = 0.01;
    d.params.dive = 0; // 不俯冲：俯冲会从 20 米外贴到身边，这一项只量悬停射击
    // 进场后强制悬停在玩家北面 20 米、高 6 米（和横移方向垂直）：plan 不再换位
    const hold = () => { if (d.state === 'engage') { d.replanT = 99; d.seekT = 99; d.range = 20; d.alt = 6; d.orbitRate = 0; d.orbit = -Math.PI / 2; } };
    let t0 = null;
    for (let i = 0; i < 30 * 120 && t0 == null; i++) { hold(); D.step(1 / 120); if (d.state === 'engage' && d.sees && Math.hypot(d.position.x - P.position.x, d.position.z - P.position.z) < 22) t0 = G.time; }
    if (t0 == null) return { err: 'no sight' };
    let seen = 0;
    for (let i = 0; i < 20 * 120; i++) { hold(); D.step(1 / 120); tr.tick(1 / 120); if (d.sees) seen++; }
    return { dps: r2(sum(t0, t0 + 20) / 20), dist: r2(Math.hypot(d.position.x - P.position.x, d.position.z - P.position.z)), seen: r2(seen / 2400) };
  }
  // 无人机自己选悬停点（7~15 米）、照常俯冲：进场 20 秒后再量 20 秒
  function t5nOnce(level, running, count) {
    reset(OPEN.x, OPEN.z);
    if (running) mv.fn = strafe(OPEN.x, OPEN.z, 4);
    R.spawnWave(count, level);
    R.waveT = -100;
    for (const d of R.drones) d.delay = Math.min(d.delay, 0.01);
    run(20);
    const t0 = G.time;
    let seen = 0, dist = 0, n = 0;
    for (let i = 0; i < 20 * 120; i++) {
      D.step(1 / 120);
      for (const d of R.drones) if (d.alive) { if (d.sees) seen++; dist += Math.hypot(d.position.x - P.position.x, d.position.z - P.position.z); n++; }
    }
    let near = 0;
    for (const e of log) if (e.t >= t0 && e.d < 10) near += e.a;
    return { dps: r2(sum(t0, t0 + 20) / 20), near10: r2(near), dist: r2(dist / (n || 1)), seen: r2(seen / (n || 1)) };
  }
  function rep(n, f) {
    const runs = [];
    for (let i = 0; i < n; i++) runs.push(f());
    const keys = Object.keys(runs.find((r) => !r.err) || {}).filter((k) => typeof runs[0][k] === 'number');
    const median = {};
    for (const k of keys) median[k] = r2(med(runs.map((r) => r[k])));
    return { median, runs };
  }
  function check() {
    const out = { open: 0, peekVis: 0, hideBlocked: 0 };
    for (let k = 0; k < 16; k++) {
      const ang = k * Math.PI / 8, x = OPEN.x + Math.cos(ang) * 17, z = OPEN.z + Math.sin(ang) * 17;
      a.set(OPEN.x, 1.1, OPEN.z); b.set(x, 1.5, z);
      if (ground(x, z) && !phys.blocked(a, b)) out.open++;
    }
    out.ringClear = ring3.map((ang) => { a.set(OPEN.x, 1.1, OPEN.z); b.set(OPEN.x + Math.cos(ang) * 17, 1.6, OPEN.z + Math.sin(ang) * 17); return !phys.blocked(a, b); });
    for (const [x, z] of PEEK_SOLDIERS) {
      a.set(x, 1.6, z);
      b.set(PEEK.x, 1.1, PEEK.z); if (!phys.blocked(a, b)) out.peekVis++;
      b.set(HIDE.x, 1.6, HIDE.z); if (phys.blocked(a, b)) out.hideBlocked++;
    }
    let strafeOk = true;
    for (let x = OPEN.x - 4; x <= OPEN.x + 4; x += 0.5) if (!ground(x, OPEN.z)) strafeOk = false;
    out.strafeOk = strafeOk;
    return out; // 期望：open ≥ 9、ringClear 全 true、peekVis 3、hideBlocked 3、strafeOk true
  }
  // 性能：8 个第 6 波士兵一圈加 drones 架无人机交火，热身 8 秒后 10 秒里 soldiers.update 的平均毫秒（S.cost 是 EMA，逐步取平均）
  function perf(drones = 4) {
    reset(OPEN.x, OPEN.z);
    spawnRing(OPEN.x, OPEN.z, [0, 1, 3, 4, 5, 9, 11, 15].map((k) => k * Math.PI / 8), 14, 24, 6);
    R.spawnWave(drones, 6);
    run(8);
    let acc = 0, n = 0;
    for (let i = 0; i < 1200; i++) {
      D.step(1 / 120);
      acc += S.cost; n++;
    }
    return { updateMs: r2(acc / n * 1000) / 1000, alive: S.aliveCount, drones: R.aliveCount };
  }
  // 回归：正常的波次流程（game.waves 自己刷人），玩家站在出生点不动、不死。士兵交火 12 秒后打死、无人机出场 25 秒后打掉，
  // 推进到第 maxWave 波打完。每波记：最多同时开火的士兵、名额上限、名额拿了 3 秒一轮都没打的次数、
  // 没名额的人在交火中原地不动（不算蹲在掩体后）最长几秒和超过 5 秒的次数、无人机开了几枪、最多同时预警或点射的架数。
  // 用法：__tune.waves.start()，然后反复 __tune.waves.run(60) 直到返回的 wave 超过 4，__tune.waves.report()
  const WV = { waves: {}, rec: new Map(), maxWave: 4 };
  WV.start = () => {
    reset(D.level.spawn?.x ?? -9, D.level.spawn?.z ?? 16);
    G.wave = 0;
    G.nextWaveAt = G.time + 0.5;
    WV.waves = {};
    WV.rec.clear();
    if (!R.__tuneShoot) {
      const sh = R.shoot.bind(R);
      R.__tuneShoot = true;
      R.shoot = (d) => { if (WV.cur) WV.cur.droneShots++; return sh(d); };
    }
  };
  WV.tick = (dt) => {
    if (!G.waveActive) return;
    const w = (WV.waves[G.wave] ||= { dur: 0, soldierShots: 0, droneShots: 0, maxShooters: 0, limit: 0, tokens: 0, idleTokens: 0, stillMax: 0, stillOver5: 0, droneFiringMax: 0, shots0: fire.n });
    WV.cur = w;
    w.dur += dt;
    w.soldierShots = fire.n - w.shots0;
    let sh = 0;
    for (const s of S.active) {
      if (!s.alive) { WV.rec.delete(s); continue; } // 记录会复用，人死了就清掉
      let r = WV.rec.get(s);
      if (!r) WV.rec.set(s, (r = { tok: false, tokT: 0, b0: 0, flag: false, still: 0, sflag: false, combatT: 0 }));
      if (s.token) {
        sh++;
        if (!r.tok) { r.tok = true; r.tokT = 0; r.b0 = s.gun.bursts; w.tokens++; }
        r.tokT += dt;
        if (r.tokT > 3 && s.gun.bursts === r.b0 && !r.flag) { r.flag = true; w.idleTokens++; }
      } else { r.tok = false; r.flag = false; }
      const sp = Math.hypot(s.vel.x, s.vel.z);
      if (s.state === 'combat' && !s.token && sp < 0.2 && !(s.tac === 'hold' && s.postCover && s.crouch > 0.5)) r.still += dt;
      else { r.still = 0; r.sflag = false; }
      w.stillMax = Math.max(w.stillMax, r.still);
      if (r.still > 5 && !r.sflag) { r.sflag = true; w.stillOver5++; }
      if (s.state === 'combat') r.combatT += dt;
      if (r.combatT > 12) S.hit(s, 1000, s.chest, null, 'head');
    }
    w.maxShooters = Math.max(w.maxShooters, sh);
    w.limit = Math.max(w.limit, S.maxShooters);
    let df = 0;
    for (const d of R.drones) {
      if (!d.alive || d.delay > 0) continue;
      if (d.fire.phase !== 'idle') df++;
      d.__age = (d.__age || 0) + dt;
      if (d.__age > 25) R.hit(d, 1000, d.position.clone(), null);
    }
    w.droneFiringMax = Math.max(w.droneFiringMax, df);
  };
  WV.run = (sec) => {
    for (let i = 0; i < sec * 120 && G.wave <= WV.maxWave; i++) { D.step(1 / 120); WV.tick(1 / 120); }
    return { wave: G.wave, active: G.waveActive, t: r2(G.time) };
  };
  WV.report = () => {
    const out = {};
    for (const k in WV.waves) { const w = { ...WV.waves[k] }; delete w.shots0; w.dur = r2(w.dur); w.stillMax = r2(w.stillMax); out[k] = w; }
    const dmg = {};
    for (const e of log) dmg[e.k] = r2((dmg[e.k] || 0) + e.a);
    return { waves: out, dmg };
  };

  window.__tune = {
    log, fire, check, perf, waves: WV,
    t1: (n = 5) => rep(n, t1once), t2: (n = 5) => rep(n, t2once), t3: (n = 5) => rep(n, t3once),
    // t4(n, level, drones)：后期波次也能量，比如 t4(5, 10, 4)
    t4: (n = 5, level = 6, drones = 3) => rep(n, () => t4once(false, level, drones)), t4w: (n = 5) => rep(n, () => t4once(true)),
    t5: (n = 5, level = 3, running = false) => rep(n, () => t5once(level, running)),
    t5n: (n = 5, level = 3, running = false, count = 1) => rep(n, () => t5nOnce(level, running, count)),
    // dev/tune_cover.js（掩体可靠度）借用的内部工具
    lib: { reset, run, sum, ground, tracker, rep, r2, med, sawT },
  };
  return 'ok';
})();
