import * as THREE from 'three';
import { Pipeline } from './engine/pipeline.js';
import { PERF } from './engine/perf_flags.js';
import { Input } from './engine/input.js';
import { TexGen } from './gfx/texgen.js';
import { Materials } from './gfx/materials.js';
import { Sky } from './gfx/sky.js';
import { buildLevel } from './world/level.js';
import { Game } from './game/game.js';
import { Settings } from './game/settings.js';
import { Hud } from './ui/hud.js';
import { AudioEngine } from './audio/audio.js';

const canvas = document.getElementById('view');
const pipeline = new Pipeline(canvas);
const renderer = pipeline.renderer;
const scene = new THREE.Scene();
const fxScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.03, 1500);
camera.layers.enable(1);
scene.fog = new THREE.FogExp2(0x0c1a2e, 0.0045);
scene.environmentIntensity = 1.5;

const hud = new Hud(document.getElementById('hud'));
// 省内存档：开发服务器上后台打开的标签页（agent 开的验收页）或地址带 ?lite 时启用。
// 贴图和阴影图边长减半，画质从「低」起步（不下雨、不画海面和倒影）。地址带 ?full 强制关掉
const query = new URLSearchParams(location.search);
// 验收用的 5184 端口一律按省内存档开（面板里的后台标签页不一定报 hidden）；要看完整画面加 ?full
const lite = !query.has('full') && (query.has('lite') || (import.meta.env.DEV && (document.visibilityState === 'hidden' || location.port === '5184')));
const settings = new Settings();
hud.bindSettings?.(settings);
const dbg = (window.__dbg = { pipeline, scene, fxScene, camera, hud, perf: PERF, fps: 0, ready: false, error: null });
// 让出一帧给浏览器画进度条；标签页在后台时 rAF 不触发，用定时器兜底
const nextFrame = () => new Promise((r) => {
  const id = setTimeout(r, 60);
  requestAnimationFrame(() => { clearTimeout(id); r(); });
});

async function boot() {
  hud.showMenu({ mode: 'loading', progress: 0 });
  await nextFrame();
  const texgen = new TexGen(renderer);
  texgen.scale = lite ? 0.5 : 1;
  const mats = new Materials(texgen, pipeline);
  await mats.build((p) => hud.showMenu({ mode: 'loading', progress: p * 0.7 }));
  const sky = new Sky();
  scene.add(sky.mesh);
  sky.bakeEnvironment(renderer, scene);
  const level = await buildLevel({ scene, mats, sky, lite });
  // 时段模块单独加载：加载失败只是切不了时段，不拖垮启动
  try {
    const m = await import('./world/timeofday.js');
    const tod = new m.TimeOfDay({ renderer, scene, camera, sky, level, pipeline, mats });
    level.tod = tod;
    level.setTime = (name) => tod.set(name);
    dbg.tod = tod;
  } catch (e) { console.warn('[boot] 时段模块没加载起来', e); }
  pipeline.fogLights = level.lighting.fogLights;
  pipeline.final.tDirt.value = mats.tex.lensDirt;
  pipeline.final.uDirt.value = 0.035;
  pipeline.mat.fog.uniforms.uDensity.value = 0.008;
  hud.showMenu({ mode: 'loading', progress: 0.8 });
  await nextFrame();

  const input = new Input(canvas);
  const audio = new AudioEngine();
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    pipeline.resize(w, h);
    level.ground.resize(pipeline.size.x, pipeline.size.y);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  const game = new Game({ pipeline, scene, fxScene, camera, mats, sky, level, input, hud, audio, resize, settings });

  // 所有灯和材质都到位后再拍反射探针（金属和积水才映得出灯），顺带把着色器都编译掉
  renderer.setRenderTarget(null);
  // 省内存档随后会切到低画质（不下雨）：拍探针前先按那个状态算夜空，第一帧就不用再重烤一遍
  if (lite) level.ground.enabled = false;
  sky.bakeProbe(renderer, scene, new THREE.Vector3(0, 2.4, 3));
  hud.showMenu({ mode: 'loading', progress: 0.95 });
  await nextFrame();

  if (lite) {
    game.setQuality('low');
    console.info('[dev] 省内存档：贴图和阴影减半、低画质、无雨无海面。看完整画面用 ?full 重开，或 __dbg.game.setQuality("high")');
  }
  Object.assign(dbg, { mats, sky, level, input, audio, game, settings, lite, player: game.player });
  let last = performance.now(), time = 0, fpsAt = 0;
  // 调试和自动化验收用：不需要指针锁定就能开局、摆机位、模拟按键
  dbg.play = (mode) => { input.fake = true; game.request('start', mode); };
  dbg.view = (x, z, yawDeg = 0, pitchDeg = 0, y = 0) => {
    game.player.position.set(x, y, z);
    game.player.velocity.set(0, 0, 0);
    game.player.yaw = THREE.MathUtils.degToRad(yawDeg);
    game.player.pitch = THREE.MathUtils.degToRad(pitchDeg);
  };
  dbg.god = (on = true) => { game.player.invulnerable = on; };
  // 冻结游戏时间，方便给动画逐帧截图：dbg.freeze(true) 后用 dbg.step(秒) 推进
  dbg.freeze = (on = true) => { game.frozen = on; };
  dbg.step = (t) => { for (let left = t; left > 1e-6; left -= 1 / 120) { game.update(Math.min(1 / 120, left), true); input.endFrame(); } };
  dbg.tap = (code, ms = 60) => { input.press(code); setTimeout(() => input.release(code), ms); };
  // 标签页在后台时 rAF 不跑：手动推进 n 帧（更新 + 渲染），之后截图就是最新画面
  dbg.frame = (n = 1, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) {
      time += dt;
      game.update(dt);
      pipeline.render({ scene, fxScene, camera, dt, beforeMain: (r) => level.ground.update(r, scene, camera, time, pipeline.frame) });
      input.endFrame();
    }
    return { state: game.state, pos: game.player.position.toArray().map((v) => +v.toFixed(2)), hp: Math.round(game.player.health) };
  };
  // 自动走到某点（对准目标按住 W）：验收门洞、楼梯走不走得通。返回 { reached, t, pos }
  dbg.walkTo = (x, z, seconds = 12) => {
    const p = game.player;
    let t = 0, reached = false;
    input.press('KeyW');
    for (; t < seconds; t += 1 / 60) {
      const dx = x - p.position.x, dz = z - p.position.z;
      if (Math.hypot(dx, dz) < 0.35) { reached = true; break; }
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = 0;
      game.update(1 / 60, true);
      input.endFrame();
    }
    input.release('KeyW');
    return { reached, t: +t.toFixed(2), pos: p.position.toArray().map((v) => +v.toFixed(2)) };
  };
  // 连跑 n 帧并等 GPU 画完，返回每帧毫秒数和这一帧的 draw call、三角形数
  dbg.bench = (n = 60) => {
    const gl = renderer.getContext(), px = new Uint8Array(4), t0 = performance.now();
    dbg.frame(n);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = (performance.now() - t0) / n;
    return { ms: +ms.toFixed(2), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  };

  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    // 读数按时间平滑（时间常数约三分之一秒），高刷新率下不会跳得更快
    dbg.fps += (1 / Math.max(dt, 1e-3) - dbg.fps) * (1 - Math.exp(-dt / 0.325));
    if (now - fpsAt > 250) { fpsAt = now; hud.setFps(Math.round(dbg.fps)); }
    game.update(dt);
    pipeline.render({
      scene, fxScene, camera, dt,
      beforeMain: (r) => level.ground.update(r, scene, camera, time, pipeline.frame),
    });
    input.endFrame();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  hud.showMenu({ mode: 'start' });
  dbg.ready = true;
}

boot().catch((e) => {
  dbg.error = String(e?.stack || e);
  console.error(e);
});
