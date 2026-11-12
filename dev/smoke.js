// 烟雾弹预览：真实管线 + 一小块场地（空地、一只集装箱、一个墙角）。
// 按钮从固定的出手位朝三个目标扔；控制台里 __s 可以单扔、逐帧推进、跑整段时间线并取回碰撞记录和视线判定。
import * as THREE from 'three';
import { Pipeline } from '../src/engine/pipeline.js';
import { PhysicsWorld } from '../src/engine/physics.js';
import { TexGen } from '../src/gfx/texgen.js';
import { Materials } from '../src/gfx/materials.js';
import { Sky } from '../src/gfx/sky.js';
import { boxUV } from '../src/gfx/geo.js';
import { Ground } from '../src/world/ground.js';
import { Fx } from '../src/fx/fx.js';
import { SmokeGrenades } from '../src/game/smoke.js';

const canvas = document.getElementById('view');
const pipe = new Pipeline(canvas);
const renderer = pipe.renderer;
const scene = new THREE.Scene();
const fxScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.03, 1500);
camera.layers.enable(1);
scene.fog = new THREE.FogExp2(0x0b1626, 0.0052);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

async function boot() {
  const lite = new URLSearchParams(location.search).has('lite') || document.visibilityState === 'hidden';
  const texgen = new TexGen(renderer);
  texgen.scale = lite ? 0.5 : 1;
  const mats = new Materials(texgen, pipe);
  await mats.build();
  const sky = new Sky();
  sky.setRain(1); // 地面默认是雨天（涟漪、拉长的倒影），夜空跟它对上
  scene.add(sky.mesh);
  sky.bakeEnvironment(renderer, scene);
  const ground = new Ground(mats, null);
  scene.add(ground.mesh);
  const phys = new PhysicsWorld();

  const solid = (w, h, d, x, y, z, mat, tile, surface) => {
    const mesh = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), tile), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    phys.addBox(x, y, z, w / 2, h / 2, d / 2, 0, surface);
    return mesh;
  };
  // 集装箱（侧壁朝出手位）、墙角（两道混凝土墙）、一只木箱
  solid(6.06, 2.6, 2.44, -5, 1.3, -10, mats.paint(0x1c4470), 5.2, 'metal');
  solid(7, 4, 0.4, 6.5, 2, -13.2, mats.concreteDark, 3, 'concrete');
  solid(0.4, 4, 7, 10.2, 2, -9.9, mats.concreteDark, 3, 'concrete');
  solid(1.2, 1.2, 1.2, 1.5, 0.6, -14, mats.wood, 0.9, 'wood');

  const spot = (color, intensity, pos, target, distance, angle, penumbra) => {
    const l = new THREE.SpotLight(color, intensity, distance, angle, penumbra, 2);
    l.position.copy(pos);
    l.target.position.copy(target);
    l.castShadow = true;
    l.shadow.mapSize.set(1024, 1024);
    l.shadow.camera.near = 1;
    l.shadow.bias = -0.0005;
    l.shadow.normalBias = 0.03;
    scene.add(l, l.target);
    return l;
  };
  const mast = spot(0xffae58, 3600, V(1, 9, -16), V(1, 0, -6), 45, 1.05, 0.75);
  const work = spot(0xdfeaff, 1800, V(-7, 7, 6), V(1, 0.5, -8), 34, 0.8, 0.6);
  const moon = new THREE.DirectionalLight(0x9db8ff, 0.42);
  moon.position.copy(sky.moonDir).multiplyScalar(120);
  scene.add(moon);
  const lamps = [{ light: mast, strength: 1 }, { light: work, strength: 0.8 }];
  pipe.fogLights = lamps;
  pipe.final.tDirt.value = mats.tex.lensDirt;
  pipe.final.uDirt.value = 0.035;

  const fx = new Fx({ scene, fxScene, mats, pipeline: pipe, phys });
  fx.setRainLights(lamps);
  fx.rain.enabled = !lite;
  const sounds = [];
  const audio = { play: (name, opts) => sounds.push({ name, t: +time.toFixed(3), pos: opts?.position ? opts.position.toArray().map((v) => +v.toFixed(2)) : null }) };
  const smoke = new SmokeGrenades({ scene, phys, mats, fx, audio });

  // 碰撞记录：包住实例上的 contact / burst，只在预览页里
  const events = [];
  const rawContact = smoke.contact.bind(smoke), rawBurst = smoke.burst.bind(smoke);
  smoke.contact = (g, n, surface, speed) => {
    events.push({ t: +time.toFixed(3), kind: 'contact', n: g.contacts + 1, surface, pos: g.pos.toArray().map((v) => +v.toFixed(2)) });
    rawContact(g, n, surface, speed);
  };
  smoke.burst = (g, n) => {
    events.push({ t: +time.toFixed(3), kind: 'burst', fuse: g.t >= 3, pos: g.pos.toArray().map((v) => +v.toFixed(2)) });
    rawBurst(g, n);
  };

  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    pipe.resize(w, h);
    ground.resize(pipe.size.x, pipe.size.y);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  renderer.setRenderTarget(null);
  sky.bakeProbe(renderer, scene, V(0, 2.4, -6));

  // 出手位：一台不渲染的镜头，摆在玩家眼睛的高度朝目标看
  const hand = new THREE.PerspectiveCamera(72, 1, 0.03, 100);
  const player = { velocity: V(0, 0, 0) };
  const shots = {
    open: { from: V(0, 1.6, 4), at: V(-0.5, 0.2, -6) },
    wall: { from: V(-3.5, 1.6, 2), at: V(-4.6, 1.5, -8.7) },
    corner: { from: V(2, 1.6, -1), at: V(9.6, 0.9, -12.6) },
    far: { from: V(0, 1.6, 4), at: V(0, 6, -20) },
  };
  const views = {
    main: [V(0, 2.2, 6.5), V(1, 1, -8)],
    side: [V(-13, 4, -3), V(1, 1.2, -8)],
    wall: [V(-1, 2, 0.5), V(-5, 1, -8)],
    corner: [V(3, 2.2, -2), V(9, 0.8, -12)],
    top: [V(0.5, 22, -4), V(0.5, 0, -8.5)],
  };
  const view = (name) => {
    const v = typeof name === 'string' ? views[name] : name;
    camera.position.copy(v[0]);
    camera.lookAt(v[1]);
    camera.updateMatrixWorld();
    pipe.historyValid = false;
  };
  view('main');

  const throwAt = (name, { free = true } = {}) => {
    const s = shots[name];
    hand.position.copy(s.from);
    hand.lookAt(s.at);
    hand.updateMatrixWorld();
    if (free) smoke.cool = 0;
    return smoke.throw(hand, player);
  };

  // 视线球：烟团登记给物理的半径，半透明线框显示；两侧各一个哨位，看它们之间被不被挡
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color: 0x66ccff, wireframe: true, transparent: true, opacity: 0.25 }));
  ball.visible = false;
  scene.add(ball);
  // 哨位线：穿过烟团、没有烟时两头互相看得见的一条线（墙角里找不到穿过中心的，就往开阔处挪开一点再找）
  const lines = smoke.slots.map(() => ({ a: V(0, 0, 0), b: V(0, 0, 0), ok: false, key: '' }));
  const findLine = (slot) => {
    const s = smoke.slots[slot].smoke, L = lines[slot], r0 = s.r;
    L.ok = false;
    s.r = 0;
    for (const off of [0, 1, 1.8]) {
      for (let k = 0; k < 24 && !L.ok; k++) {
        const a = (k / 24) * Math.PI * 2, ox = Math.cos(a), oz = Math.sin(a);
        const mx = s.x - oz * off, mz = s.z + ox * off;
        L.a.set(mx + ox * 5, s.y + 1.1, mz + oz * 5);
        L.b.set(mx - ox * 5, s.y + 1.1, mz - oz * 5);
        L.ok = !phys.blocked(L.a, L.b) && !phys.blocked(L.b, L.a);
      }
      if (L.ok) break;
    }
    s.r = r0;
    L.key = `${s.x},${s.z}`;
  };
  const blockedAcross = (slot = 0) => {
    const s = smoke.slots[slot].smoke, L = lines[slot];
    if (L.key !== `${s.x},${s.z}`) findLine(slot);
    return { r: +s.r.toFixed(2), line: L.ok, blocked: L.ok ? phys.blocked(L.a, L.b) : null };
  };

  let time = 0, paused = false, showBall = false, auto = false, autoT = 0, autoK = 0;
  const frame = (dt, render = true) => {
    time += dt;
    if (auto && (autoT -= dt) <= 0) {
      autoT = 9;
      throwAt(['open', 'wall', 'corner'][autoK++ % 3]);
    }
    smoke.update(dt);
    fx.update(dt, camera);
    sky.update(dt);
    const live = smoke.slots.find((g) => g.smoke.r > 0);
    ball.visible = showBall && !!live;
    if (live) { ball.position.set(live.smoke.x, live.smoke.y, live.smoke.z); ball.scale.setScalar(live.smoke.r); }
    if (render) pipe.render({ scene, fxScene, camera, dt, beforeMain: (r) => ground.update(r, scene, camera, time, pipe.frame) });
  };

  const bar = document.getElementById('bar');
  const button = (label, pressed, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (pressed !== null) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', () => { const r = onClick(); if (pressed !== null) b.setAttribute('aria-pressed', String(r)); });
    bar.append(b);
    return b;
  };
  button('扔向空地', null, () => throwAt('open'));
  button('扔向箱壁', null, () => throwAt('wall'));
  button('扔进墙角', null, () => throwAt('corner'));
  button('轮流扔', false, () => { auto = !auto; autoT = 0; return auto; });
  button('视线球', false, () => (showBall = !showBall));
  // 退路：在实例上用 null 盖住 fx.smokeCloud，烟雾弹就改用自己往 fx.smoke 里喂的烟
  const fallback = (on) => {
    if (on) fx.smokeCloud = null; else delete fx.smokeCloud;
    return on;
  };
  button('退路烟', false, () => fallback(typeof fx.smokeCloud === 'function'));
  button('雨', fx.rain.enabled, () => (fx.rain.enabled = !fx.rain.enabled));
  button('暂停', false, () => (paused = !paused));
  for (const name of Object.keys(views)) button(`机位 ${name}`, null, () => view(name));

  let fps = 60, statT = 0, last = performance.now();
  const stat = document.getElementById('stat');
  const tick = (now) => {
    const real = (now - last) / 1000;
    last = now;
    fps += (1 / Math.max(real, 1e-3) - fps) * 0.05;
    if (!paused) frame(Math.min(0.05, real));
    if ((statT -= real) <= 0) {
      statT = 0.25;
      const st = smoke.slots.map((g) => ['空', '飞', '烟'][g.state] + (g.state === 2 ? ` ${g.cloud.t.toFixed(1)}s r${g.smoke.r.toFixed(1)}` : '')).join('  ');
      stat.textContent = `${fps.toFixed(0)} fps  ${renderer.info.render.calls} draw\n冷却 ${(smoke.ready * 100).toFixed(0)}%\n${st}\n烟粒 ${fx.puffs.count}`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  window.__s = {
    smoke, fx, phys, pipe, scene, camera, hand, shots, views, events, sounds, view, throwAt, blockedAcross, fallback,
    get time() { return time; },
    pause(on = true) { paused = on; },
    ball(on = true) { showBall = on; },
    // 按固定步长推进 n 帧（后台标签页里截图前先调它）
    step(n = 1, dt = 1 / 60, render = true) { for (let i = 0; i < n; i++) frame(dt, render); },
    reset() { smoke.clear(); fx.clear(); events.length = 0; sounds.length = 0; },
    // 跑一整段：扔出去之后每 0.1 秒记一次状态（不渲染，快），返回碰撞记录、视线判定和冷却
    run(name, seconds = 9, dt = 1 / 60) {
      this.reset();
      paused = true;
      const thrown = throwAt(name), t0 = time, samples = [];
      let nextSample = 0;
      while (time - t0 < seconds) {
        frame(dt, false);
        if (time - t0 >= nextSample) {
          nextSample += 0.1;
          const g = smoke.slots.find((x) => x.state !== 0) || smoke.slots[0];
          samples.push({ t: +(time - t0).toFixed(2), state: g.state, ...blockedAcross(smoke.slots.indexOf(g)), ready: +smoke.ready.toFixed(2) });
        }
      }
      return { thrown, events: [...events], sounds: sounds.map((s) => s.name), samples };
    },
    ready: true,
  };
}

boot().catch((e) => {
  window.__s = { error: String(e?.stack || e) };
  console.error(e);
});
