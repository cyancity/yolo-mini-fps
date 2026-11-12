// 特效预览：真实管线（需要 fxScene 和深度）+ 一小块场地。
// 按钮切换各特效的循环触发；控制台里 __t 可以单发、暂停、逐帧步进、换机位、量 draw call。
import * as THREE from 'three';
import { Pipeline } from '../src/engine/pipeline.js';
import { PhysicsWorld } from '../src/engine/physics.js';
import { TexGen } from '../src/gfx/texgen.js';
import { Materials } from '../src/gfx/materials.js';
import { Sky } from '../src/gfx/sky.js';
import { boxUV } from '../src/gfx/geo.js';
import { Ground } from '../src/world/ground.js';
import { Fx } from '../src/fx/fx.js';

const canvas = document.getElementById('view');
const pipe = new Pipeline(canvas);
const renderer = pipe.renderer;
const scene = new THREE.Scene();
const fxScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.03, 1500);
camera.layers.enable(1);
scene.fog = new THREE.FogExp2(0x0b1626, 0.0052);

const rr = (a, b) => a + Math.random() * (b - a);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

async function boot() {
  const mats = new Materials(new TexGen(renderer), pipe);
  await mats.build();
  const sky = new Sky();
  sky.setRain(1); // 地面默认是雨天（涟漪、拉长的倒影），夜空跟它对上
  scene.add(sky.mesh);
  sky.bakeEnvironment(renderer, scene);
  const ground = new Ground(mats, null);
  scene.add(ground.mesh);
  const phys = new PhysicsWorld();

  // 场地：每种命中材质一个靶子，外加一个棚顶（验证雨被挡住）
  const solid = (w, h, d, x, y, z, mat, tile, surface) => {
    const mesh = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), tile), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    phys.addBox(x, y, z, w / 2, h / 2, d / 2, 0, surface);
    return mesh;
  };
  solid(6, 2.6, 2.4, -4.5, 1.3, -6.5, mats.paint(0x1c4470), 5.2, 'metal');
  solid(1.2, 1.2, 1.2, 0.2, 0.6, -4.6, mats.wood, 0.9, 'wood');
  solid(3, 1.1, 0.5, 3.4, 0.55, -4.6, mats.concrete, 3, 'concrete');
  solid(16, 4, 0.4, 0, 2, -9.2, mats.concreteDark, 3, 'concrete');
  solid(1, 0.5, 0.5, -1.6, 0.25, -3.4, mats.sandbag, 0.25, 'fabric');
  solid(4, 0.15, 4, 7.5, 3, -3.5, mats.galv, 1.2, 'metal');
  for (const [px, pz] of [[5.6, -5.4], [9.4, -5.4], [5.6, -1.6], [9.4, -1.6]]) solid(0.12, 3, 0.12, px, 1.5, pz, mats.steelDark, 1.2, 'metal');
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.6, 24), mats.rubber);
  tire.position.set(2.2, 0.3, -2.6);
  tire.castShadow = tire.receiveShadow = true;
  scene.add(tire);
  phys.addCyl(2.2, -2.6, 0.42, 0, 0.6, 'rubber');

  // 新材质的靶子：一块装在框里的玻璃、一个穿作训服的假人、棚下的一块地毯、一片碎石地
  const glassPane = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 0.02), mats.glass);
  glassPane.position.set(-3.4, 1.1, -2.6);
  scene.add(glassPane);
  phys.addBox(-3.4, 1.1, -2.6, 0.6, 0.7, 0.01, 0, 'glass');
  for (const [w, h, x, y] of [[1.32, 0.06, -3.4, 1.83], [1.32, 0.06, -3.4, 0.37], [0.06, 1.4, -4.03, 1.1], [0.06, 1.4, -2.77, 1.1]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), mats.steelDark);
    bar.position.set(x, y, -2.6);
    scene.add(bar);
  }
  for (const x of [-4.03, -2.77]) solid(0.06, 0.34, 0.5, x, 0.17, -2.6, mats.steelDark, 1.2, 'metal');
  const dummy = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.25, 6, 16), mats.tarp);
  dummy.position.set(4.4, 0.865, -3.2);
  dummy.castShadow = dummy.receiveShadow = true;
  scene.add(dummy);
  phys.addCyl(4.4, -3.2, 0.24, 0, 1.75, 'flesh');
  const carpet = mats.pbr(mats.tex.fabric, { color: 0x5a3b38, wet: false });
  solid(3.4, 0.03, 3, 7.5, 0.015, -3.6, carpet, 0.5, 'carpet');
  const gravel = mats.pbr(mats.tex.concrete, { color: 0x7a766c });
  solid(2.4, 0.04, 2, -1.6, 0.02, -0.6, gravel, 0.35, 'gravel');

  // 灯：数量固定。背后一盏高杆灯（逆光看雨），镜头侧一盏冷色工作灯，加月光
  const spot = (color, intensity, pos, target, distance, angle, penumbra) => {
    const l = new THREE.SpotLight(color, intensity, distance, angle, penumbra, 2);
    l.position.copy(pos);
    l.target.position.copy(target);
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.camera.near = 1;
    l.shadow.bias = -0.0005;
    l.shadow.normalBias = 0.03;
    scene.add(l, l.target);
    return l;
  };
  const mast = spot(0xffae58, 3000, V(2.5, 8, -8.2), V(0.5, 0, -1), 40, 1.02, 0.75);
  const work = spot(0xdfeaff, 1600, V(-6, 7, 5), V(0, 0.5, -5), 30, 0.75, 0.6);
  const moon = new THREE.DirectionalLight(0x9db8ff, 0.42);
  moon.position.copy(sky.moonDir).multiplyScalar(120);
  scene.add(moon);
  const lamps = [{ light: mast, strength: 1 }, { light: work, strength: 0.8 }];
  pipe.fogLights = lamps;
  pipe.final.tDirt.value = mats.tex.lensDirt;
  pipe.final.uDirt.value = 0.035;

  const fx = new Fx({ scene, fxScene, mats, pipeline: pipe, phys });
  fx.setRainLights(lamps);
  let bounces = 0;
  fx.onShellBounce = () => { bounces++; };

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
  sky.bakeProbe(renderer, scene, V(0, 2.4, -2));

  // 机位
  const views = {
    main: [V(0, 1.65, 3.2), V(0, 1.1, -5)],
    back: [V(-0.6, 1.6, 4.6), V(1.6, 4.6, -5)],
    metal: [V(-3.2, 1.5, -3.6), V(-3.6, 1.3, -5.3)],
    wood: [V(0.5, 1.0, -2.9), V(0.2, 0.7, -4)],
    concrete: [V(3.1, 1.0, -3.2), V(3.4, 0.6, -4.35)],
    floor: [V(1.2, 1.1, -0.6), V(1.2, 0, -2.2)],
    shell: [V(1.3, 0.5, 2.9), V(0.9, 0.05, 1.6)],
    blast: [V(-1.5, 1.7, 5), V(1, 1.2, -2.2)],
    roof: [V(3.2, 1.6, 1.5), V(7.5, 2.2, -3.5)],
    glass: [V(-2.6, 1.3, -0.6), V(-3.4, 0.9, -2.7)],
    flesh: [V(3.6, 1.4, -1.6), V(4.4, 1.1, -3.2)],
    carpet: [V(6.2, 1.3, -0.9), V(7.5, 0, -3.6)],
    gravel: [V(-0.4, 1.2, 1.2), V(-1.6, 0, -0.7)],
    tracers: [V(7.5, 1.6, -2.8), V(-1, 1.4, -3.4)],
    incoming: [V(0.6, 1.6, 3.2), V(-0.4, 1.4, -8.5)],
    slide: [V(4.4, 1.1, 2.6), V(1.5, 0.1, -0.5)],
    cloud: [V(1.5, 1.7, 10.5), V(0.5, 1.6, -1.5)],
    jetSide: [V(-0.5, 1.3, 6.8), V(-0.5, 0.9, 1)],
  };
  const view = (name) => {
    const v = typeof name === 'string' ? views[name] : name;
    camera.position.copy(v[0]);
    camera.lookAt(v[1]);
    pipe.historyValid = false;
  };
  view('main');

  // 射击：枪口固定在主机位的右下方，朝各材质的靶点打
  const muzzle = V(0.22, 1.47, 2.45);
  const targets = {
    metal: () => V(rr(-6, -2.4), rr(0.5, 2.2), -5.3),
    wood: () => V(rr(-0.25, 0.65), rr(0.2, 1.05), -4),
    concrete: () => V(rr(2.2, 4.6), rr(0.15, 0.95), -4.35),
    asphalt: () => V(rr(0.4, 2), 0, rr(-3.2, -1.2)),
    fabric: () => V(rr(-2, -1.2), rr(0.1, 0.4), -3.15),
    rubber: () => V(rr(1.95, 2.45), rr(0.1, 0.5), -2.2),
    wall: () => V(rr(-3, 6), rr(1.5, 3.6), -9),
    glass: () => V(rr(-3.9, -2.9), rr(0.5, 1.7), -2.6),
    flesh: () => V(rr(4.3, 4.5), rr(0.6, 1.5), -3.0),
    carpet: () => V(rr(6.4, 8.6), 0.03, rr(-4.6, -2.6)),
    gravel: () => V(rr(-2.6, -0.6), 0.04, rr(-1.4, 0.2)),
  };
  const dir = V(0, 0, -1), tmp = V(0, 0, 0), q = new THREE.Quaternion();
  const shoot = (surface, { flash = true, tracer = true, shell = true } = {}) => {
    dir.copy(targets[surface]()).sub(muzzle).normalize();
    const hit = phys.raycast(muzzle, dir, 200);
    if (flash) fx.muzzleFlash(muzzle, dir, 1);
    if (hit) {
      if (tracer) fx.tracer(muzzle, hit.point);
      fx.impact(hit.point, hit.normal, hit.surface);
    }
    if (shell) {
      const right = tmp.crossVectors(dir, camera.up).normalize();
      q.setFromUnitVectors(V(0, 0, -1), dir);
      const pos = muzzle.clone().addScaledVector(dir, -0.45).addScaledVector(right, 0.03);
      const vel = right.clone().multiplyScalar(rr(1.8, 2.6)).add(V(0, rr(1.6, 2.4), 0)).addScaledVector(dir, -rr(0.2, 0.8));
      fx.shell(pos, vel, q);
    }
    return hit;
  };
  const cycle = ['metal', 'concrete', 'asphalt', 'wood', 'fabric', 'rubber', 'wall', 'glass', 'flesh', 'carpet', 'gravel'];
  const fresh = ['glass', 'flesh', 'carpet', 'gravel'];
  let shot = 0, freshShot = 0;

  // 敌人：墙根下一排八个枪手，三到五发一个点射，打在镜头周围
  const gunners = Array.from({ length: 8 }, (_, k) => ({ p: V(-6 + k * 1.7, rr(1.2, 1.7), -8.6), t: k * 0.13, n: 0, burst: 3 }));
  const eDir = V(0, 0, 0), eEnd = V(0, 0, 0), eAim = V(0, 0, 0);
  const enemyShot = (from, to) => {
    eDir.copy(to).sub(from).normalize();
    const hit = phys.raycast(from, eDir, 60);
    fx.muzzleFlash(from, eDir, 0.8, { enemy: true });
    fx.tracer(from, hit ? hit.point : eEnd.copy(from).addScaledVector(eDir, 60), { enemy: true });
    if (hit) fx.impact(hit.point, hit.normal, hit.surface, { enemy: true });
  };
  const gunfire = (dt) => {
    for (const g of gunners) {
      g.t -= dt;
      if (g.t > 0) continue;
      g.n++;
      if (g.n >= g.burst) { g.n = 0; g.burst = 3 + ((Math.random() * 3) | 0); g.t = rr(0.5, 1.1); } else g.t = 0.085;
      enemyShot(g.p, eAim.set(rr(-3, 3), rr(0, 0.6), rr(-2, 1.5)));
    }
  };

  // 曳光对比：玩家的（左下）和敌人的（右上）同时平行飞向墙，从背后和侧面（tracers 机位）都分得开；迎面那发从墙根擦着镜头飞过
  const pairFrom = [V(-1.2, 1.2, 1.5), V(-0.4, 1.6, 1.5)], pairTo = [V(-1.2, 1.2, -9), V(-0.4, 1.6, -9)];
  const tracerPair = () => {
    fx.tracer(pairFrom[0], pairTo[0]);
    fx.tracer(pairFrom[1], pairTo[1], { enemy: true });
  };
  const inFrom = V(0, 0, 0), inTo = V(0, 0, 0);
  const incoming = () => {
    const c = camera.position;
    inFrom.set(rr(-1.5, 1.5), 1.5, -8.6);
    inTo.set(c.x + rr(-0.5, 0.5), c.y + rr(-0.3, 0.3), c.z + 4);
    fx.muzzleFlash(inFrom, eDir.copy(inTo).sub(inFrom).normalize(), 0.8, { enemy: true });
    fx.tracer(inFrom, inTo, { enemy: true });
  };

  // 滑铲：一条路线滑 0.9 秒，速度从 7 掉到 2.5，按顺序换地面：露天湿沥青、棚下干混凝土、棚下地毯、碎石
  const slides = [
    { surface: 'asphalt', from: V(-1, 0, 1.2), dir: V(1, 0, -0.25) },
    { surface: 'concrete', from: V(5.6, 0, -1.8), dir: V(1, 0, 0) },
    { surface: 'carpet', from: V(5.9, 0.03, -4.4), dir: V(1, 0, 0.2) },
    { surface: 'gravel', from: V(-2.7, 0.04, -1.3), dir: V(1, 0, 0.6) },
  ];
  const slide = { k: -1, t: 0, pos: V(0, 0, 0), vel: V(0, 0, 0) };
  const sliding = (dt) => {
    if (slide.k < 0 || slide.t > 0.9) {
      slide.k = (slide.k + 1) % slides.length;
      slide.t = 0;
      slide.pos.copy(slides[slide.k].from);
    }
    const s = slides[slide.k], speed = 7 - 4.5 * (slide.t / 0.9);
    slide.vel.copy(s.dir).normalize().multiplyScalar(speed);
    slide.pos.addScaledVector(slide.vel, dt);
    slide.t += dt;
    fx.slideDust(slide.pos, slide.vel, s.surface);
  };

  // 喷气：脚底位置按 16 米/秒挪 0.2 秒（和玩家一样），fx 的持续段跟着它走。
  // 循环时八个方向轮流，地面和空中交替；从 jetSide 机位侧面看
  const dash = { pos: V(0, 0, 0), vx: 0, vz: 0, t: 1, k: 0 };
  const dashMove = (dt) => {
    if (dash.t >= 0.2) return;
    dash.pos.x += dash.vx * dt;
    dash.pos.z += dash.vz * dt;
    dash.t += dt;
  };
  const dashOnce = (dirX = 1, dirZ = 0, grounded = true, x = -3.2, z = 1) => {
    const l = Math.hypot(dirX, dirZ) || 1;
    dash.pos.set(x, grounded ? 0 : 1.3, z);
    dash.vx = (dirX / l) * 16;
    dash.vz = (dirZ / l) * 16;
    dash.t = 0;
    fx.dashJet(dash.pos, dirX, dirZ, grounded);
  };
  const dashCycle = () => {
    const a = (dash.k % 8) * (Math.PI / 4), air = ((dash.k / 8) | 0) % 2 === 1;
    dash.k++;
    // 从场地中间往外冲，八个方向都落在 jetSide 机位的画面里
    dashOnce(Math.cos(a), Math.sin(a), !air, -0.5 - Math.cos(a) * 1.6, 1 - Math.sin(a) * 1.6);
  };

  const fire = {
    cloud: (x = 0.5, z = -1.5, radius = 4.2, life = 6) => fx.smokeCloud(V(x, 0.05, z), { radius, life }),
    dash: dashOnce,
    flash: () => fx.muzzleFlash(muzzle, dir.set(0, 0, -1), 1),
    tracer: () => shoot('wall', { flash: false, shell: false }),
    impact: (surface) => shoot(surface || cycle[shot++ % cycle.length], { flash: false, tracer: false, shell: false }),
    burst: () => shoot(cycle[shot++ % cycle.length]),
    sparks: () => fx.sparks(V(rr(-5.5, -2.5), rr(0.6, 2), -5.3), V(0, 0, 1), 12),
    smoke: () => fx.smoke(V(rr(-0.4, 0.4), 0.2, rr(-2.4, -1.6)), { size: 0.5, count: 2 }),
    shell: () => shoot('wall', { flash: false, tracer: false }),
    fresh: (surface) => shoot(surface || fresh[freshShot++ % fresh.length], { flash: false, tracer: false, shell: false }),
    enemy: () => enemyShot(gunners[(Math.random() * 8) | 0].p, eAim.set(rr(-3, 3), rr(0, 0.6), rr(-2, 1.5))),
    tracerPair,
    incoming,
    slide: (surface, x = 1.5, z = 0.5, vx = 6, vz = 0) => fx.slideDust(V(x, surface === 'carpet' ? 0.03 : 0, z), V(vx, 0, vz), surface),
    explosion: (x = 1, y = 0.1, z = -2.2, scale = 1) => fx.explosion(V(x, y, z), { scale }),
    slash: (surface = 'metal') => {
      const p = targets[surface === 'asphalt' ? 'asphalt' : surface]();
      fx.slash(p, surface === 'asphalt' ? V(0, 1, 0) : V(0, 0, 1), surface);
    },
  };

  // 循环触发器：[名字, 间隔秒, 动作]
  const loops = [
    ['连射', 0.1, fire.burst], ['枪口焰', 0.1, fire.flash], ['曳光', 0.12, fire.tracer], ['命中', 0.12, () => fire.impact()],
    ['火花', 0.3, fire.sparks], ['烟', 0.5, fire.smoke], ['弹壳', 0.12, fire.shell], ['爆炸', 2.6, () => fire.explosion()],
    ['刀痕', 0.7, () => fire.slash(['metal', 'wood', 'concrete', 'glass', 'flesh', 'carpet', 'gravel'][(Math.random() * 7) | 0])],
    ['新材质', 0.25, () => fire.fresh()], ['曳光对比', 0.35, tracerPair], ['迎面曳光', 0.3, incoming],
    ['敌方扫射', 0, gunfire, true], ['滑铲', 0, sliding, true],
    ['烟雾弹', 7, () => fire.cloud()], ['喷气', 1.1, dashCycle],
  ].map(([name, every, run, perFrame = false]) => ({ name, every, run, perFrame, on: false, t: 0, button: null }));
  const bar = document.getElementById('bar');
  const button = (label, pressed, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', () => b.setAttribute('aria-pressed', String(onClick())));
    bar.append(b);
    return b;
  };
  const setLoop = (name, on) => {
    const l = loops.find((x) => x.name === name);
    l.on = on;
    l.t = 0;
    l.button.setAttribute('aria-pressed', String(on));
  };
  for (const l of loops) l.button = button(l.name, false, () => { l.on = !l.on; l.t = 0; return l.on; });
  button('雨', true, () => (fx.rain.enabled = !fx.rain.enabled));
  // 白天：手动把月光调成太阳、环境光和特效的环境光调亮、曝光压低，检查烟尘不发光、火花和曳光还看得见
  const night = { ambient: fx.ambient.clone(), moon: moon.intensity, moonColor: moon.color.clone(), env: scene.environmentIntensity, exposure: pipe.final.uExposure.value };
  let isDay = false;
  const day = (on = true, { ambient = [0.55, 0.6, 0.7], sun = 3.2, env = 6, exposure = 0.55 } = {}) => {
    isDay = on;
    if (on) {
      fx.ambient.set(...ambient);
      moon.intensity = sun;
      moon.color.set(0xfff1dc);
      scene.environmentIntensity = env;
    } else {
      fx.ambient.copy(night.ambient);
      moon.intensity = night.moon;
      moon.color.copy(night.moonColor);
      scene.environmentIntensity = night.env;
    }
    pipe.final.uExposure.value = on ? exposure : night.exposure;
    return on;
  };
  button('白天', false, () => day(!isDay));
  let paused = false;
  button('暂停', false, () => (paused = !paused));
  button('清空', false, () => { fx.clear(); return false; });

  let time = 0, fps = 60;
  const stat = document.getElementById('stat');
  const frame = (dt) => {
    time += dt;
    for (const l of loops) {
      if (!l.on) continue;
      // 每帧跑的（敌方扫射、滑铲）自己管节奏
      if (l.perFrame) { l.run(dt); continue; }
      l.t -= dt;
      if (l.t <= 0) { l.t += l.every; l.run(); }
    }
    dashMove(dt);
    fx.update(dt, camera);
    sky.update(dt);
    pipe.render({ scene, fxScene, camera, dt, beforeMain: (r) => ground.update(r, scene, camera, time, pipe.frame) });
  };
  let last = performance.now(), statT = 0;
  const tick = (now) => {
    const real = (now - last) / 1000;
    last = now;
    fps += (1 / Math.max(real, 1e-3) - fps) * 0.05;
    if (!paused) frame(Math.min(0.05, real));
    statT -= real;
    if (statT <= 0) {
      statT = 0.25;
      stat.textContent = `${fps.toFixed(0)} fps\n${renderer.info.render.calls} draw\n烟 ${fx.puffs.count}  光 ${fx.glow.count}  条 ${fx.streaks.count}\n烟团 ${fx.clouds.active}（${fx.clouds.ext.count}）\n弹孔 ${fx.decals.mesh.count}  弹壳 ${fx.shells.active}`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  window.__t = {
    fx, pipe, scene, fxScene, camera, phys, fire, view, setLoop, muzzle, day, dash,
    get fps() { return fps; },
    get bounces() { return bounces; },
    all(on) { for (const l of loops) if (l.name !== '枪口焰' && l.name !== '曳光' && l.name !== '命中' && l.name !== '弹壳') setLoop(l.name, on); },
    loops: () => loops.map((l) => l.name),
    pause(on = true) { paused = on; },
    // 暂停时按固定步长推进 n 帧
    step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) frame(dt); },
    // 特效新增的 draw call：隐藏特效网格画一帧，再显示画一帧，取差值
    drawCalls() {
      const meshes = [...fxScene.children, fx.decals.mesh, fx.shells.mesh];
      meshes.forEach((m) => { m.visible = false; });
      frame(0);
      const base = renderer.info.render.calls;
      meshes.forEach((m) => { m.visible = true; });
      frame(0);
      return { base, withFx: renderer.info.render.calls, added: renderer.info.render.calls - base };
    },
    ready: true,
  };
}

boot().catch((e) => {
  window.__t = { error: String(e?.stack || e) };
  console.error(e);
});
