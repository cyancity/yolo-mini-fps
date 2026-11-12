// 逐帧跟踪：游戏页里 `await import('/dev/perf_trace.js?v=' + Date.now())`，之后用 __trace。用 ?full 开。
//   __trace.hold(true)                 停掉页面自己的 rAF 循环（面板显示着时它会和手动推帧抢 GPU），量完 hold(false)
//   await __trace.combat({ quality })  放第 5 波敌人、按住开火、匀速转身，逐帧记 js、gpu 和各模块的独占时间
//   await __trace.spawns({ waves })    从新开一局起连刷几波，看刷敌那一帧和之后几帧
//   await __trace.dash({ variant })    喷气前、喷气中（0.32 秒）、喷气后（0.5 秒）三段的帧时间；variant 可以去掉粒子或模糊
//   await __trace.ab(set, n)           同一个页面里 A、B 交替量：set(true) / set(false) 切换被测的东西
// js 是这一帧 JS 自己的时间（逻辑加提交），gpu 是计时查询量到的 GPU 进程时间，frame 取两者较大的那个。
// 每帧之间隔 gap 毫秒让 GPU 进程排空，js 才不会被上一帧堵住；w、h 是输出像素（乘画质档的 scale 之前）。
const d = window.__dbg, p = d.pipeline, r = p.renderer, gl = r.getContext();
const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const round = (v, n = 2) => (v == null || Number.isNaN(v) ? null : +v.toFixed(n));
const GL_EVENTS = ['compileShader', 'linkProgram', 'texImage2D', 'texStorage2D', 'texSubImage2D', 'bufferData', 'generateMipmap'];

let rafOrig = null;
const parked = [];
function hold(on = true) {
  if (on && !rafOrig) {
    rafOrig = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => { parked.push(cb); return 0; };
  } else if (!on && rafOrig) {
    window.requestAnimationFrame = rafOrig;
    rafOrig = null;
    for (const cb of parked.splice(0)) requestAnimationFrame(cb);
  }
  return !!rafOrig;
}

// 输出 w × h 像素：超高档的像素比跟着屏幕缩放走，这里按它反算 CSS 尺寸
function setRes(quality = 'high', w = 2560, h = 1440) {
  if (d.game.quality !== quality) d.game.applyQuality(quality);
  const pr = Math.min(window.devicePixelRatio || 1, p.settings.maxPixelRatio);
  p.resize((w + 0.01) / pr, (h + 0.01) / pr);
  d.level.ground.resize(p.size.x, p.size.y);
  d.camera.aspect = w / h;
  d.camera.updateProjectionMatrix();
  return `${p.size.x}x${p.size.y}`;
}

// 独占计时：嵌套调用的时间从外层里扣掉
let cur = null;
const stack = [];
function wrap(obj, key, name) {
  if (!obj || typeof obj[key] !== 'function') return null;
  const own = Object.prototype.hasOwnProperty.call(obj, key), orig = obj[key];
  obj[key] = function (...a) {
    const label = typeof name === 'function' ? name(...a) : name, node = { t0: performance.now(), child: 0 };
    stack.push(node);
    try { return orig.apply(this, a); } finally {
      stack.pop();
      const dt = performance.now() - node.t0;
      if (cur) cur.sec[label] = (cur.sec[label] || 0) + dt - node.child;
      if (stack.length) stack[stack.length - 1].child += dt;
    }
  };
  return () => { if (own) obj[key] = orig; else delete obj[key]; };
}

function install(glSlow = 0) {
  const g = d.game, L = d.level, undo = [];
  const add = (o, k, n) => { const u = wrap(o, k, n); if (u) undo.push(u); };
  add(g, 'update', 'update.rest');
  for (const [o, n] of [[g.player, 'player'], [g.weapons, 'weapons'], [g.drones, 'drones'], [g.soldiers, 'soldiers'], [g.targets, 'targets'],
    [g.smoke, 'smoke'], [g.fx, 'fx'], [L.lighting, 'lighting'], [L, 'level'], [d.sky, 'sky']]) add(o, 'update', n);
  add(g, 'waves', 'waves');
  add(g.soldiers, 'spawnWave', 'spawn.soldiers');
  add(g.drones, 'spawnWave', 'spawn.drones');
  add(g.soldiers.pf, 'flood', 'pf.flood');
  for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(d.hud))) if (k !== 'constructor') add(d.hud, k, 'hud');
  add(p, 'render', 'render.rest');
  add(L.ground, 'update', 'mirror');
  add(r.shadowMap, 'render', 'shadow');
  add(r, 'render', (scene, camera) => (camera !== d.camera ? 'mirror' : scene === d.scene ? 'main' : scene === d.fxScene ? 'fxScene' : 'post'));
  add(p, 'pass', 'post');
  add(d.scene, 'updateMatrixWorld', 'matrixWorld');
  add(d.fxScene, 'updateMatrixWorld', 'matrixWorld');
  for (const k of GL_EVENTS) {
    const orig = gl[k];
    gl[k] = function (...a) { if (cur) cur.gl[k] = (cur.gl[k] || 0) + 1; return orig.apply(this, a); };
    undo.push(() => { delete gl[k]; });
  }
  if (glSlow > 0) undo.push(...slowCalls(glSlow));
  return undo;
}

// 找卡住的那一下：给每个 GL 调用计时，超过 limit 毫秒的记进这一帧的 slowGl；glMs 是这一帧花在 GL 调用里的总时间。
// 一帧卡了两百毫秒而 glMs 很小，说明卡在 JS 自己身上（回收，或者主线程被系统挂起），不是卡在等 GPU 进程
function slowCalls(limit) {
  const undo = [];
  for (let proto = Object.getPrototypeOf(gl); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      const desc = Object.getOwnPropertyDescriptor(proto, k);
      if (!desc || typeof desc.value !== 'function' || k === 'constructor' || Object.prototype.hasOwnProperty.call(gl, k)) continue;
      const orig = desc.value;
      gl[k] = function (...a) {
        const t = performance.now();
        try { return orig.apply(this, a); } finally {
          const ms = performance.now() - t;
          if (cur) { cur.glMs = (cur.glMs || 0) + ms; if (ms > limit) (cur.slowGl = cur.slowGl || []).push([k, round(ms, 1)]); }
        }
      };
      undo.push(() => { delete gl[k]; });
    }
  }
  return undo;
}

async function collect(qs) {
  gl.flush();
  const out = [];
  for (const q of qs) {
    if (!q) { out.push(null); continue; }
    for (let k = 0; k < 400 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await sleep(5);
    const ok = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT);
    out.push(ok ? gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 : null);
    gl.deleteQuery(q);
  }
  return out;
}

// 两帧之间等一拍。面板显示着时跟浏览器的 rAF 走（一次显示刷新画一帧）：在 rAF 之外画得比显示器刷新还快，
// 画布的交换会排队，GL 调用一卡就是一个刷新周期（16 毫秒的整数倍），量出来全是假卡顿。
// 面板在后台时 rAF 不来，退回定时器（gap 毫秒，不要小于 17）
function beat(gap) {
  const raf = rafOrig || window.requestAnimationFrame;
  return new Promise((ok) => {
    const id = setTimeout(ok, Math.max(gap, 40));
    raf.call(window, () => { clearTimeout(id); ok(); });
  });
}

// 推进 frames 帧，逐帧记录。each(i) 在每帧开头调用（注入输入用）
async function run(o = {}) {
  const { frames = 300, dt = 1 / 144, gap = 20, each = null, sections = true, glSlow = 0 } = o;
  const was = rafOrig ? null : false;
  hold(true);
  const undo = sections ? install(glSlow) : [];
  const recs = [], qs = [];
  let heap0 = performance.memory?.usedJSHeapSize ?? 0, prog0 = r.info.programs.length;
  try {
    for (let i = 0; i < frames; i++) {
      await beat(gap);
      each?.(i);
      const rec = (cur = { i, sec: {}, gl: {} });
      const q = ext ? gl.createQuery() : null;
      if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      const t = performance.now();
      d.frame(1, dt);
      rec.js = performance.now() - t;
      // 开了 glSlow 才有：cpu 是扣掉 GL 调用（含等 GPU 进程的时间）以后纯 JS 的部分
      if (rec.glMs != null) rec.cpu = rec.js - rec.glMs;
      if (q) gl.endQuery(ext.TIME_ELAPSED_EXT);
      qs.push(q);
      gl.flush();
      cur = null;
      rec.calls = r.info.render.calls;
      rec.tris = r.info.render.triangles;
      const heap = performance.memory?.usedJSHeapSize ?? 0;
      rec.heap = heap - heap0;
      heap0 = heap;
      rec.programs = r.info.programs.length - prog0;
      prog0 = r.info.programs.length;
      recs.push(rec);
    }
  } finally {
    for (const f of undo.reverse()) f();
    cur = null;
  }
  const gpu = await collect(qs);
  recs.forEach((x, i) => { x.gpu = gpu[i]; x.frame = Math.max(x.js, x.gpu ?? 0); });
  if (was === false) hold(false);
  return recs;
}

const pct = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : null);
function dist(recs, k) {
  const a = recs.map((x) => x[k]).filter((v) => v != null).sort((x, y) => x - y);
  return { p50: round(pct(a, 0.5)), p95: round(pct(a, 0.95)), max: round(a[a.length - 1]), mean: round(a.reduce((s, v) => s + v, 0) / (a.length || 1)) };
}

// 一段记录的摘要：js、gpu、frame 的分布，各模块平均每帧的毫秒数，超过 slow 毫秒的帧
function stats(recs, { slow = 25, top = 8 } = {}) {
  const sec = {};
  for (const x of recs) for (const k of Object.keys(x.sec)) sec[k] = (sec[k] || 0) + x.sec[k] / recs.length;
  const brief = (x) => ({
    i: x.i, js: round(x.js), gpu: round(x.gpu), programs: x.programs || undefined, heapMB: round(x.heap / 1048576, 1), gl: x.gl,
    glMs: round(x.glMs), slowGl: x.slowGl,
    sec: Object.fromEntries(Object.entries(x.sec).filter(([, v]) => v > 0.5).map(([k, v]) => [k, round(v)])),
  });
  const gc = recs.filter((x) => x.heap < -2e6);
  return {
    frames: recs.length, js: dist(recs, 'js'), gpu: dist(recs, 'gpu'), frame: dist(recs, 'frame'),
    cpu: recs.some((x) => x.cpu != null) ? dist(recs, 'cpu') : undefined,
    calls: Math.round(recs.reduce((s, x) => s + x.calls, 0) / recs.length), tris: Math.round(recs.reduce((s, x) => s + x.tris, 0) / recs.length),
    sec: Object.fromEntries(Object.entries(sec).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, round(v, 3)])),
    slowCount: recs.filter((x) => x.frame > slow).length,
    slow: recs.filter((x) => x.frame > slow).slice(0, top).map(brief),
    worst: recs.slice().sort((a, b) => b.frame - a.frame).slice(0, top).map(brief),
    newPrograms: recs.reduce((s, x) => s + Math.max(0, x.programs), 0),
    // 堆每帧涨多少（只算在涨的帧），和堆一下子掉了 2 兆以上的帧（回收）
    allocKBPerFrame: round(recs.filter((x) => x.heap > 0).reduce((s, x) => s + x.heap, 0) / 1024 / recs.length, 1),
    gc: { count: gc.length, js: gc.map((x) => round(x.js)) },
  };
}

// 开一局放第 wave 波，玩家无敌站在 spot，先空跑 warm 秒让敌人接上火
function stage({ wave = 5, spot = [0, -9, 0], warm = 8 } = {}) {
  const g = d.game;
  if (g.state !== 'playing' || g.mode !== 'waves') d.play('waves');
  d.freeze(false);
  d.god(true);
  g.nextWaveAt = Infinity;
  g.soldiers.clear?.();
  g.drones.clear?.();
  d.view(spot[0], spot[1], 0, 0, spot[2]);
  d.frame(30, 1 / 60);
  if (wave > 0) {
    g.soldiers.spawnWave(Math.min(2 + wave, 8), wave, g.player);
    g.drones.spawnWave(Math.min(Math.ceil(wave / 2), 4), wave);
  }
  for (let t = 0; t < warm; t += 0.5) { d.step(0.5); d.view(spot[0], spot[1], 0, 0, spot[2]); }
  d.frame(20, 1 / 60);
  return { soldiers: g.soldiers.aliveCount, drones: g.drones.aliveCount, info: g.soldiers.debugInfo?.() };
}

// 交火：按住开火（打空了换弹、补弹），每秒转 turn 度
async function combat(o = {}) {
  const { quality = 'high', w = 2560, h = 1440, frames = 360, dt = 1 / 144, spot = [0, -9, 0], fire = true, turn = 60, restage = true, slow = 25 } = o;
  const g = d.game, inp = d.input;
  hold(true);
  const staged = restage ? stage({ spot, wave: o.wave ?? 5, warm: o.warm ?? 8 }) : null;
  const size = setRes(quality, w, h);
  d.frame(8, dt);
  const rifle = g.weapons.rifle, step = -(turn * Math.PI / 180) * dt / g.player.sensitivity;
  if (fire) inp.press('Mouse0');
  let recs;
  try {
    recs = await run({ ...o, frames, dt, each: (i) => {
      inp.dx = step;
      g.player.position.set(spot[0], spot[2], spot[1]);
      if (fire && rifle && rifle.mag === 0 && !rifle.reloading) { rifle.reserve = 120; inp.press('KeyR'); inp.release('KeyR'); }
    } });
  } finally { inp.release('Mouse0'); }
  return { quality, size, staged, ...stats(recs, { slow }), recs: o.keep ? recs : undefined };
}

// 刷敌：新开一局，连刷 waves 波。每波在第 lead 帧触发，记到之后 tail 帧
async function spawns(o = {}) {
  const { quality = 'high', w = 2560, h = 1440, waves = 5, dt = 1 / 144, lead = 12, tail = 48 } = o;
  const g = d.game;
  hold(true);
  d.play('waves');
  d.god(true);
  g.nextWaveAt = Infinity;
  const size = setRes(quality, w, h);
  d.frame(40, 1 / 60);
  const out = [];
  for (let k = 0; k < waves; k++) {
    g.nextWaveAt = g.time + (lead + 0.5) * dt;
    const recs = await run({ ...o, frames: lead + tail, dt });
    const at = recs.findIndex((x) => x.sec['spawn.soldiers'] != null), hit = recs[at], after = recs.slice(at + 1);
    const base = dist(recs.slice(0, Math.max(1, at)), 'js').p50, worst = after.slice().sort((a, b) => b.frame - a.frame)[0];
    out.push({
      wave: g.wave, baseJs: base, spawnJs: round(hit?.js), spawnGpu: round(hit?.gpu),
      soldiers: round(hit?.sec['spawn.soldiers']), flood: round(hit?.sec['pf.flood']), drones: round(hit?.sec['spawn.drones']),
      programs: recs.reduce((s, x) => s + Math.max(0, x.programs), 0), gl: hit?.gl,
      after: { i: worst.i - at, js: round(worst.js), gpu: round(worst.gpu), gl: worst.gl, sec: Object.fromEntries(Object.entries(worst.sec).filter(([, v]) => v > 0.5).map(([n, v]) => [n, round(v)])) },
      over25: recs.filter((x) => x.frame > 25).map((x) => x.i - at),
    });
    g.soldiers.clear?.();
    g.drones.clear?.();
    d.step(1.3);
  }
  return { quality, size, waves: out };
}

// 喷气：先跑 pre 帧，第 pre 帧按 V，之后记 0.32 秒（喷气中）加 0.5 秒（喷气后）。
// variant：'full' 原样，'noJet' 不发粒子，'noBlur' 关掉后处理里的喷气模糊和速度线
async function dash(o = {}) {
  const { quality = 'high', w = 2560, h = 1440, dt = 1 / 144, pre = 30, variant = 'full', spot = [0, 8, 0], yaw = 0, turn = 0 } = o;
  const g = d.game, inp = d.input, pl = g.player;
  hold(true);
  if (g.state !== 'playing') d.play('waves');
  d.god(true);
  const size = setRes(quality, w, h);
  d.view(spot[0], spot[1], yaw, 0, spot[2]);
  pl.dashCool = 0;
  d.frame(20, dt);
  const nDash = Math.round(0.32 / dt), nAfter = Math.round(0.5 / dt), rm = g.reducedMotion;
  if (variant === 'noJet') g.fx.dashJet = () => {};
  if (variant === 'noBlur') g.reducedMotion = true;
  const trace = [], step = -(turn * Math.PI / 180) * dt / pl.sensitivity;
  let recs;
  try {
    recs = await run({ ...o, frames: pre + nDash + nAfter, dt, each: (i) => {
      if (i === pre) inp.press('KeyV');
      if (i === pre + 1) inp.release('KeyV');
      if (turn && i >= pre + nDash) inp.dx = step;
      if (i > 0) trace.push([round(pl.dash, 3), round(d.camera.fov, 2)]);
    } });
  } finally {
    delete g.fx.dashJet;
    g.reducedMotion = rm;
  }
  const seg = (a, b) => { const s = recs.slice(a, b); return { js: dist(s, 'js'), gpu: dist(s, 'gpu'), fx: round(s.reduce((n, x) => n + (x.sec.fx || 0) + (x.sec.fxScene || 0), 0) / s.length, 3) }; };
  return { quality, size, variant, before: seg(0, pre), during: seg(pre, pre + nDash), after: seg(pre + nDash, recs.length), trace: o.keep ? trace : undefined, recs: o.keep ? recs : undefined };
}

// A、B 交替：set(true) 是 A，set(false) 是 B，各量 rounds 轮、每轮 frames 帧，返回两边 js 和 gpu 的中位数
async function ab(set, o = {}) {
  const { rounds = 4, frames = 24, dt = 1 / 144, settle = 6 } = o;
  const acc = { a: [], b: [] };
  hold(true);
  for (let k = 0; k < rounds * 2; k++) {
    const on = k % 2 === 0;
    set(on);
    d.frame(settle, dt);
    acc[on ? 'a' : 'b'].push(...await run({ ...o, frames, dt, sections: !!o.sections }));
  }
  set(true);
  const row = (x) => ({ js: dist(x, 'js').p50, gpu: dist(x, 'gpu').p50, calls: Math.round(x.reduce((s, v) => s + v.calls, 0) / x.length), tris: Math.round(x.reduce((s, v) => s + v.tris, 0) / x.length) });
  const a = row(acc.a), b = row(acc.b);
  return { a, b, saved: { js: round(b.js - a.js), gpu: round(b.gpu - a.gpu), calls: b.calls - a.calls } };
}

// 阴影图和地面倒影实际画了多少：推进 seconds 秒游戏时间（每帧 dt），返回每盏投影灯每秒重画几次、
// 平均每帧重画几张阴影图、倒影每秒画几次。只数次数，不受机器负载影响
function rates({ seconds = 2, dt = 1 / 144 } = {}) {
  const L = d.level.lighting, list = L.shadowed, cnt = list.map(() => 0), frames = Math.round(seconds / dt);
  let mirror = 0;
  const sm = r.shadowMap, orig = sm.render, rr = r.render;
  sm.render = function (...a) { list.forEach((l, i) => { if (l.shadow.needsUpdate) cnt[i]++; }); return orig.apply(this, a); };
  r.render = function (scene, camera) { if (camera !== d.camera) mirror++; return rr.call(this, scene, camera); };
  // 这两个 render 是实例上的属性，不能 delete，要赋回去
  try { d.frame(frames, dt); } finally { sm.render = orig; r.render = rr; }
  return {
    fps: Math.round(1 / dt), lightHz: cnt.map((c) => round(c / seconds, 1)),
    shadowMapsPerFrame: round(cnt.reduce((s, c) => s + c, 0) / frames, 3), mirrorHz: round(mirror / seconds, 1),
  };
}

// 浏览器在 rAF 之后做样式、布局、绘制要多久：rAF 回调结束到紧接着的宏任务之间的时间。要面板显示着、页面自己的循环在跑
async function domCost(n = 120) {
  hold(false);
  const out = [], gaps = [], inp = d.input, orig = inp.endFrame;
  await new Promise((ok) => {
    const ch = new MessageChannel();
    let t0 = 0, last = 0;
    ch.port1.onmessage = () => { out.push(performance.now() - t0); if (out.length >= n) ok(); };
    // endFrame 是游戏每帧最后做的事：从它结束到下一个宏任务之间就是浏览器自己的活
    inp.endFrame = function () {
      orig.call(this);
      t0 = performance.now();
      if (last) gaps.push(t0 - last);
      last = t0;
      ch.port2.postMessage(0);
    };
    setTimeout(ok, 8000);
  });
  delete inp.endFrame;
  out.sort((a, b) => a - b);
  gaps.sort((a, b) => a - b);
  return { frames: out.length, dom: { p50: round(pct(out, 0.5)), p95: round(pct(out, 0.95)), max: round(out[out.length - 1]) }, interval: { p50: round(pct(gaps, 0.5)), p95: round(pct(gaps, 0.95)), max: round(gaps[gaps.length - 1]) } };
}

window.__trace = { hold, setRes, run, stats, dist, stage, combat, spawns, dash, ab, rates, domCost, sleep };
export { hold, setRes, run, stats, stage, combat, spawns, dash, ab };
