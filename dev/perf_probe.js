// 性能探针：在游戏页面里 `await import('/dev/perf_probe.js?v=' + Date.now())`，之后用 __perf。
//   await __perf.run({ w: 2560, h: 1440, quality: 'high', spot: 'yard' })   量一组
//   await __perf.passes({ w: 2560, h: 1440, quality: 'high', spot: 'yard' }) 各遍的 GPU 和 CPU 耗时
//   await __perf.sweep()                                                    常用的几组，返回表格
//   await __perf.table()                                                    定标表：画质 × 机位的 js、gpu、draw call
//   await __perf.snap('base') / __perf.diff('base')                         逐像素对比，见 perf_snap.js
// 量的是不限帧率连跑时的每帧耗时（毫秒）：total 是 CPU 提交加 GPU 画完的总时间，也就是能跑到的帧间隔；
// update 是游戏逻辑，submit 是 three.js 提交 draw call 的 CPU 时间，gpu 是计时查询量到的 GPU 时间。
// 内部分辨率直接设成 w × h，和画布显示多大无关；量完调 __perf.restore() 回到窗口尺寸。
import * as THREE from 'three';
import { LIGHT_LOOP } from '../src/gfx/light_loop.js';
import { makeSnap } from './perf_snap.js';

const d = window.__dbg, p = d.pipeline, r = p.renderer, gl = r.getContext();
const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const px = new Uint8Array(4);
const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
const round = (v, n = 2) => (v == null ? null : +v.toFixed(n));
const YAWS = [0, 90, 180, 270];

function gpuName() {
  const e = gl.getExtension('WEBGL_debug_renderer_info');
  return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}

// 内部分辨率（乘画质档的 scale 之前）设成 w × h
function size(w, h) {
  p.resize(w, h);
  d.level.ground.resize(p.size.x, p.size.y);
  d.camera.aspect = w / h;
  d.camera.updateProjectionMatrix();
  return [p.size.x, p.size.y];
}

function restore() {
  d.fxScene.visible = true;
  d.game.resize();
  return [p.size.x, p.size.y];
}

// 各分区的机位：取出生点里属于该分区的第一个，眼睛转四个方向
function spots() {
  const out = {};
  for (const s of d.level.spawns || []) {
    const zone = s.zone || 'yard';
    if (!out[zone]) out[zone] = [s.x ?? s.position?.x ?? s[0], s.z ?? s.position?.z ?? s[2], s.y ?? s.position?.y ?? s[1] ?? 0];
  }
  return out;
}

// 开一局，放一波敌人（数量和强度按第 wave 波），玩家无敌，波次不再自动推进
function stage(wave = 5) {
  const g = d.game;
  if (g.state !== 'playing' || g.mode !== 'waves') d.play('waves');
  d.freeze(false);
  d.god(true);
  g.nextWaveAt = Infinity;
  g.soldiers.clear?.();
  g.drones.clear?.();
  if (wave > 0) {
    g.soldiers.spawnWave(Math.min(2 + wave, 8), wave, g.player);
    g.drones.spawnWave(Math.min(Math.ceil(wave / 2), 4), wave);
  }
  d.frame(90, 1 / 60);
  return { soldiers: g.soldiers.aliveCount, drones: g.drones.aliveCount };
}

function place(spot, yaw) {
  const at = Array.isArray(spot) ? spot : spots()[spot];
  if (!at) throw new Error(`没有这个机位：${spot}，可选 ${Object.keys(spots()).join('、')}`);
  d.view(at[0], at[1], yaw, 0, at[2]);
}

function apply({ w = 2560, h = 1440, quality = 'high' } = {}) {
  if (d.game.quality !== quality) d.game.applyQuality(quality);
  return size(w, h);
}

// 连跑 frames 帧：总耗时、逻辑和提交的 CPU 时间、draw call 和三角形数
function burst(frames, dt) {
  const g = d.game;
  let tu = 0, tr = 0;
  const u0 = g.update, r0 = p.render;
  g.update = function (...a) { const t = performance.now(); const v = u0.apply(this, a); tu += performance.now() - t; return v; };
  p.render = function (...a) { const t = performance.now(); const v = r0.apply(this, a); tr += performance.now() - t; return v; };
  try {
    sync();
    const t0 = performance.now();
    d.frame(frames, dt);
    sync();
    const total = (performance.now() - t0) / frames;
    return { total, update: tu / frames, submit: tr / frames, calls: r.info.render.calls, tris: r.info.render.triangles };
  } finally {
    delete g.update;
    delete p.render;
  }
}

async function collect(queries) {
  gl.flush();
  let ns = 0, n = 0;
  for (const q of queries) {
    for (let k = 0; k < 200 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await sleep(5);
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      ns += gl.getQueryParameter(q, gl.QUERY_RESULT);
      n++;
    }
    gl.deleteQuery(q);
  }
  return n ? ns / 1e6 : null;
}

// 整帧的 GPU 时间：每帧包一个计时查询
async function gpuFrame(frames, dt) {
  if (!ext) return null;
  const qs = [];
  for (let i = 0; i < frames; i++) {
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    d.frame(1, dt);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    qs.push(q);
  }
  const ms = await collect(qs);
  return ms == null ? null : ms / frames;
}

// 一组：四个朝向各量一次，返回平均和最差
async function run(o = {}) {
  const { spot = 'yard', frames = 60, dt = 1 / 144, yaws = YAWS } = o;
  const sizeNow = apply(o);
  const rows = [];
  for (const yaw of yaws) {
    place(spot, yaw);
    d.frame(12, dt);
    const b = burst(frames, dt);
    b.gpu = await gpuFrame(16, dt);
    rows.push(b);
  }
  const avg = (k) => rows.reduce((s, x) => s + (x[k] ?? 0), 0) / rows.length;
  const max = (k) => Math.max(...rows.map((x) => x[k] ?? 0));
  return {
    quality: d.game.quality, size: sizeNow.join('x'), spot: String(spot),
    total: round(avg('total')), totalMax: round(max('total')),
    update: round(avg('update')), submit: round(avg('submit')), gpu: round(avg('gpu')), gpuMax: round(max('gpu')),
    calls: Math.round(avg('calls')), callsMax: max('calls'), tris: Math.round(avg('tris')),
    fps: Math.round(1000 / avg('total')), fpsMin: Math.round(1000 / max('total')),
  };
}

// 各遍的耗时。计时查询不能嵌套，所以一次只量一段、每段各跑 frames 帧；CPU 时间每段都记（main 含 shadow）
const SEGMENTS = ['shadow', 'ground', 'main', 'fx', 'ao', 'fog', 'blur', 'composite', 'taa', 'copy', 'bloom', 'final'];
async function passes(o = {}) {
  const { spot = 'yard', frames = 10, dt = 1 / 144, yaw = 0 } = o;
  const sizeNow = apply(o);
  place(spot, yaw);
  d.frame(12, dt);
  const mat = p.mat, ground = d.level.ground;
  const passName = (m) => (m === mat.ao ? 'ao' : m === mat.fog ? 'fog' : m === mat.blur ? 'blur' : m === mat.composite ? 'composite'
    : m === mat.taa ? 'taa' : m === mat.copy ? 'copy' : m === mat.down || m === mat.up ? 'bloom' : m === mat.final ? 'final' : 'other');
  let current = null, queries = [];
  const cpu = {};
  const undo = [];
  const hook = (obj, key, nameOf) => {
    const own = Object.prototype.hasOwnProperty.call(obj, key), orig = obj[key];
    obj[key] = function (...a) {
      const name = nameOf(...a), t = performance.now();
      const timed = ext && name === current;
      let q;
      if (timed) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      try { return orig.apply(this, a); } finally {
        if (timed) { gl.endQuery(ext.TIME_ELAPSED_EXT); queries.push(q); }
        cpu[name] = (cpu[name] || 0) + performance.now() - t;
      }
    };
    undo.push(() => { if (own) obj[key] = orig; else delete obj[key]; });
  };
  hook(r.shadowMap, 'render', () => 'shadow');
  hook(ground, 'update', () => 'ground');
  hook(r, 'render', (scene, camera) => (camera !== d.camera ? 'mirror' : scene === d.scene ? 'main' : scene === d.fxScene ? 'fx' : 'quad'));
  hook(p, 'pass', (m) => passName(m));
  const out = { quality: d.game.quality, size: sizeNow.join('x'), spot: String(spot), yaw, gpu: {}, cpu: {} };
  try {
    let n = 0;
    for (const name of SEGMENTS) {
      current = name;
      queries = [];
      d.frame(frames, dt);
      n += frames;
      const ms = ext ? await collect(queries) : null;
      out.gpu[name] = ms == null ? null : round(ms / frames, 3);
    }
    current = null;
    for (const k of Object.keys(cpu)) out.cpu[k] = round(cpu[k] / n, 3);
  } finally {
    for (const f of undo.reverse()) f();
  }
  // main 那一段把阴影图的重画也包进去了
  if (out.gpu.main != null && out.gpu.shadow != null) out.gpu.mainOnly = round(out.gpu.main - out.gpu.shadow, 3);
  out.gpuSum = round(SEGMENTS.filter((s) => s !== 'shadow').reduce((s, k) => s + (out.gpu[k] || 0), 0), 2);
  return out;
}

// 一帧里各种 GL 调用各有多少次：draw call 之外，uniform、切程序、绑贴图这些才是 CPU 耗时的大头
function glCalls(o = {}) {
  const { spot = 'yard', frames = 8, dt = 1 / 144, yaw = 0, top = 24 } = o;
  apply(o);
  place(spot, yaw);
  d.frame(12, dt);
  const count = {}, names = [];
  for (let proto = Object.getPrototypeOf(gl); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const k of Object.getOwnPropertyNames(proto)) {
      const desc = Object.getOwnPropertyDescriptor(proto, k);
      if (!desc || typeof desc.value !== 'function' || k === 'constructor' || names.includes(k)) continue;
      const orig = desc.value;
      names.push(k);
      gl[k] = function (...a) { count[k] = (count[k] || 0) + 1; return orig.apply(this, a); };
    }
  }
  try { d.frame(frames, dt); } finally { for (const k of names) delete gl[k]; }
  const rows = Object.entries(count).map(([k, v]) => [k, Math.round(v / frames)]).sort((a, b) => b[1] - a[1]);
  const sum = (re) => rows.filter(([k]) => re.test(k)).reduce((s, [, v]) => s + v, 0);
  let lights = 0, meshes = 0;
  d.scene.traverse((x) => { if (x.isLight) lights++; else if (x.isMesh) meshes++; });
  return {
    quality: d.game.quality, total: rows.reduce((s, [, v]) => s + v, 0), uniforms: sum(/^uniform/), draws: sum(/^draw/),
    programs: r.info.programs.length, useProgram: count.useProgram ? Math.round(count.useProgram / frames) : 0,
    lights, meshes, top: rows.slice(0, top),
  };
}

// 灯光循环早退和阴影采样早退（src/gfx/light_loop.js，默认开着）的前后对比：on = false 换回 three 原来的着色器块，
// 并给所有受光材质加一个 define，逼它们重新编译；on = true 去掉 define，用回启动时编译的那一套
function lightSkip(on = true, dt = 1 / 60) {
  if (!LIGHT_LOOP.patched) throw new Error('灯光循环早退没有生效，没法对比');
  THREE.ShaderChunk.lights_fragment_begin = on ? LIGHT_LOOP.patched : LIGHT_LOOP.original;
  if (LIGHT_LOOP.shadowPatched) THREE.ShaderChunk.shadowmap_pars_fragment = on ? LIGHT_LOOP.shadowPatched : LIGHT_LOOP.shadowOriginal;
  const seen = new Set();
  for (const root of [d.scene, d.fxScene]) root.traverse((x) => { for (const m of [].concat(x.material || [])) seen.add(m); });
  let n = 0;
  for (const m of seen) {
    if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial)) continue;
    m.defines = { ...(m.defines || {}) };
    if (on) delete m.defines.LIGHT_LOOP_FULL; else m.defines.LIGHT_LOOP_FULL = 1;
    m.needsUpdate = true;
    n++;
  }
  d.frame(30, dt);
  sync();
  return { materials: n, programs: r.info.programs.length };
}

function lightCensus() {
  const out = {};
  d.scene.traverse((x) => {
    if (!x.isLight) return;
    const k = x.type + (x.castShadow ? '+shadow' : '');
    out[k] = out[k] || { n: 0, lit: 0 };
    out[k].n++;
    if (x.intensity > 0 && x.visible) out[k].lit++;
  });
  return out;
}

// 不连跑、一帧一帧隔开量：js 是这一帧 JS 自己花的时间（逻辑加提交，GPU 进程闲着，不会被堵住），
// gpu 是 GPU 进程从第一条命令到最后一条命令的时间。两个里大的那个接近真正能跑到的帧间隔
async function single(o = {}) {
  const { spot = 'yard', frames = 24, dt = 1 / 144, yaw = 0, gap = 25 } = o;
  const sizeNow = apply(o);
  place(spot, yaw);
  d.frame(12, dt);
  let js = 0;
  const qs = [];
  for (let i = 0; i < frames; i++) {
    await sleep(gap);
    const q = ext ? gl.createQuery() : null;
    if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    const t = performance.now();
    d.frame(1, dt);
    js += performance.now() - t;
    if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
    gl.flush();
  }
  const ms = ext ? await collect(qs) : null;
  return { quality: d.game.quality, size: sizeNow.join('x'), js: round(js / frames), gpu: ms == null ? null : round(ms / frames), calls: r.info.render.calls, tris: r.info.render.triangles };
}

// 一帧里每一遍各画了多少：draw call、三角形，以及这一遍在 JS 里花的时间
function census(o = {}) {
  const { spot = 'yard', frames = 8, dt = 1 / 144, yaw = 0 } = o;
  apply(o);
  place(spot, yaw);
  d.frame(12, dt);
  const rows = {};
  const undo = [];
  const hook = (obj, key, nameOf) => {
    const own = Object.prototype.hasOwnProperty.call(obj, key), orig = obj[key];
    obj[key] = function (...a) {
      const name = nameOf(...a), c0 = r.info.render.calls, t0 = r.info.render.triangles, t = performance.now();
      try { return orig.apply(this, a); } finally {
        const row = (rows[name] = rows[name] || { calls: 0, tris: 0, ms: 0 });
        row.calls += r.info.render.calls - c0;
        row.tris += r.info.render.triangles - t0;
        row.ms += performance.now() - t;
      }
    };
    undo.push(() => { if (own) obj[key] = orig; else delete obj[key]; });
  };
  hook(r.shadowMap, 'render', () => 'shadow');
  hook(r, 'render', (scene, camera) => (camera !== d.camera ? 'mirror' : scene === d.scene ? 'main' : scene === d.fxScene ? 'fx' : 'quad'));
  try { d.frame(frames, dt); } finally { for (const f of undo.reverse()) f(); }
  for (const k of Object.keys(rows)) rows[k] = { calls: Math.round(rows[k].calls / frames), tris: Math.round(rows[k].tris / frames), ms: round(rows[k].ms / frames) };
  // main 和 mirror 里都含各自触发的阴影重画
  const stat = { objects: 0, meshes: 0, instanced: 0, visibleMeshes: 0, materials: new Set(), geometries: new Set() };
  const groups = {};
  const walk = (x, top, shown) => {
    stat.objects++;
    shown = shown && x.visible;
    if (x.isMesh) {
      stat.meshes++;
      if (x.isInstancedMesh) stat.instanced++;
      if (shown) stat.visibleMeshes++;
      for (const m of [].concat(x.material || [])) stat.materials.add(m);
      stat.geometries.add(x.geometry);
      const g = (groups[top] = groups[top] || { meshes: 0, tris: 0 });
      const n = x.geometry.index ? x.geometry.index.count : x.geometry.attributes.position?.count || 0;
      g.meshes++;
      g.tris += Math.round((n / 3) * (x.isInstancedMesh ? x.count : 1));
    }
    for (const c of x.children) walk(c, top, shown);
  };
  for (const c of d.scene.children) walk(c, c.name || c.type, true);
  const top = Object.entries(groups).sort((a, b) => b[1].meshes - a[1].meshes).slice(0, 30);
  return {
    quality: d.game.quality, passes: rows,
    scene: { objects: stat.objects, meshes: stat.meshes, instanced: stat.instanced, visibleMeshes: stat.visibleMeshes, materials: stat.materials.size, geometries: stat.geometries.size, programs: r.info.programs.length, textures: r.info.memory.textures },
    groups: top,
  };
}

// 定标表：几档画质 × 几个机位，四个朝向取平均。改之前、改之后各跑一次对着看（同一台机器同一时段才可比）。
// js 和 gpu 的含义见 single；fps 按两个里大的那个算
async function table(o = {}) {
  const { w = 2560, h = 1440, qualities = ['medium', 'high'], at = [[0, -9, 0], 'warehouse', 'office', 'rooftop', 'street'], wave = 5, frames = 10 } = o;
  stage(wave);
  const rows = [];
  for (const quality of qualities) {
    for (const spot of at) {
      let js = 0, gpu = 0, calls = 0;
      for (const yaw of YAWS) {
        const s = await single({ w, h, quality, spot, yaw, frames });
        js += s.js / 4; gpu += (s.gpu ?? 0) / 4; calls += s.calls / 4;
      }
      rows.push({ quality, spot: String(spot), js: round(js), gpu: round(gpu), calls: Math.round(calls), fps: Math.round(1000 / Math.max(js, gpu)) });
    }
  }
  return rows;
}

// 常用的几组：分辨率 × 画质，机位取堆场
async function sweep({ sizes = [[1920, 1080], [2560, 1440]], qualities = ['low', 'medium', 'high'], spot = 'yard', wave = 5 } = {}) {
  const staged = stage(wave);
  const rows = [];
  for (const quality of qualities) for (const [w, h] of sizes) rows.push(await run({ w, h, quality, spot }));
  return { gpu: gpuName(), timer: !!ext, staged, rows };
}

window.__perf = { gpuName, size, restore, spots, stage, place, apply, burst, gpuFrame, run, passes, glCalls, lightSkip, lightCensus, single, census, table, ...makeSnap(size), sweep, SEGMENTS, THREE };
export { gpuName, size, restore, spots, stage, run, passes, glCalls, sweep };
