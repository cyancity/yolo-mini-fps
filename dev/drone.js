// 无人机预览。默认只看模型；加 ?sim 进一个简易场地跑 DroneManager（假玩家 + 打桩的 fx/audio）。
// 控制台：__drone（模型节点和面数）；__sim.step(秒) 快进并做穿模检查，__sim.follow(i) 跟拍，__sim.kill(i)。
import { startHarness } from './harness.js';
import { buildDrone } from '../src/enemies/drone_model.js';
import { DroneManager } from '../src/enemies/drones.js';
import { PhysicsWorld } from '../src/engine/physics.js';
import { boxUV } from '../src/gfx/geo.js';

const query = new URLSearchParams(location.search);

startHarness(async (h) => (query.has('sim') ? arena(h) : showcase(h)));

function showcase({ scene, mats, view }) {
  const d = buildDrone(mats);
  // 涂装材质在 1.8 m 以下会加泥污，所以放到飞行高度看
  d.root.position.y = 2.5;
  scene.add(d.root);
  let tris = 0, meshes = 0;
  d.root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  window.__drone = { ...d, tris, meshes, spin: true };
  window.__h.onFrame = (dt) => {
    if (!window.__drone.spin) return;
    d.rotors.forEach((r, i) => { r.rotation.y += (i % 2 ? -1 : 1) * (160 * dt + Math.random() * 2.2); });
  };
  view(35, 18, 1.9, 0, 2.48, 0);
}

function arena({ THREE, scene, mats, view }) {
  const phys = new PhysicsWorld();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mats.concreteDark);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const solid = (x, y, z, w, h, dp, yaw, color) => {
    const mesh = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, dp), 5.2), mats.paint(color));
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = yaw;
    scene.add(mesh);
    phys.addBox(x, y + h / 2, z, w / 2, h / 2, dp / 2, yaw, 'metal');
  };
  const L = 6.06, H = 2.59, W = 2.44;
  solid(-8, 0, -4, L, H, W, 0, 0x7d2a1e);
  solid(-8, H, -4, L, H, W, 0.02, 0x1c4470);
  solid(6, 0, 2, L, H, W, 0.4, 0x1f5e56);
  solid(10, 0, -8, L, H, W, 0, 0xb24a18);
  solid(10, H, -8, L, H, W, 0, 0x5a1f24);
  solid(-3, 0, 9, W, H, L, 0, 0xb8901f);
  solid(27.6, 0, 0, W, H * 3, 36, 0, 0x2c4a2e); // 东侧三层箱墙
  solid(0, 6.06, -18.2, 30, 0.28, 3.8, 0, 0xa8a89f); // 雨棚
  solid(2, 0, 5, 1, 0.9, 1, 0.3, 0xa8a89f);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 9.5, 12), mats.galv);
  pole.position.set(-14, 5.2, 10);
  scene.add(pole);
  phys.addCyl(-14, 10, 0.11, 0.45, 9.97, 'metal');

  const player = {
    position: new THREE.Vector3(0, 0, 6), eye: new THREE.Vector3(0, 1.65, 6), velocity: new THREE.Vector3(),
    alive: true, hp: 100, hits: [],
    takeDamage(amount, from) { this.hp -= amount; this.hits.push({ t: mgr.time, amount, from: from.toArray() }); },
  };
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.2, 4, 12), mats.plasticOrange);
  scene.add(body);

  // 打桩的特效和音效：只计数、记时间，外加最简单的可视化
  const log = {}, events = [], fades = [];
  const note = (name) => { log[name] = (log[name] || 0) + 1; events.push({ t: +mgr.time.toFixed(3), name }); };
  const blip = (geo, color, life, grow = 0, rise = 0) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    scene.add(mesh);
    fades.push({ mesh, life, age: 0, grow, rise });
    return mesh;
  };
  const ball = new THREE.SphereGeometry(1, 10, 8);
  const fx = {
    tracer(from, to) {
      note('tracer');
      const mesh = blip(new THREE.CylinderGeometry(0.02, 0.02, from.distanceTo(to), 5).rotateX(Math.PI / 2), 0xffc070, 0.12);
      mesh.position.copy(from).lerp(to, 0.5);
      mesh.lookAt(to);
    },
    muzzleFlash() { note('muzzleFlash'); },
    impact(p) { note('impact'); blip(ball, 0xfff0c0, 0.15).position.copy(p); fades.at(-1).mesh.scale.setScalar(0.08); },
    sparks(p) { note('sparks'); blip(ball, 0xffa030, 0.2).position.copy(p); fades.at(-1).mesh.scale.setScalar(0.1); },
    smoke(p, o) { note('smoke'); blip(ball, 0x30343a, o.life, 0.6, o.rise).position.copy(p); fades.at(-1).mesh.scale.setScalar(o.size * 0.3); },
    explosion(p) { note('explosion'); blip(ball, 0xff8a30, 0.35, 5).position.copy(p); fades.at(-1).mesh.scale.setScalar(0.3); },
  };
  const loops = { active: 0, last: null };
  const audio = {
    play(name) { note(name); },
    loop() { loops.active++; return { set(o) { loops.last = o; }, stop() { loops.active--; } }; },
  };

  const mgr = new DroneManager({ scene, phys, mats, fx, audio });
  const kills = [];
  mgr.onKill = (d) => kills.push({ t: +mgr.time.toFixed(3), alive: mgr.aliveCount, hp: d.hp });

  const sim = {
    mgr, player, phys, log, events, kills, loops, paused: false, cam: null, violations: [], minClear: Infinity,
    walk: null, // (t) => [x, z]：让假玩家沿路径走
    reset() {
      mgr.clear();
      events.length = 0;
      kills.length = 0;
      player.hits.length = 0;
      player.hp = 100;
      player.alive = true;
      sim.violations.length = 0;
      sim.minClear = Infinity;
      for (const k of Object.keys(log)) delete log[k];
    },
    tick(dt) {
      if (sim.walk) {
        const [x, z] = sim.walk(mgr.time);
        player.velocity.set((x - player.position.x) / dt, 0, (z - player.position.z) / dt);
        player.position.set(x, player.position.y, z);
      } else player.velocity.set(0, 0, 0);
      player.eye.copy(player.position).y += 1.65;
      body.position.copy(player.position).y += 0.9;
      mgr.update(dt, player);
      // 用物理世界独立复核：机身不许进任何障碍，也不许贴进杆子
      for (const d of mgr.drones) {
        if (!d.alive || d.delay > 0) continue;
        const p = d.position;
        const clear = p.y - 0.25 - phys.groundHeight(p.x, p.z, 0.5, 100, 0);
        if (Math.abs(p.x) < 30 && Math.abs(p.z) < 25) sim.minClear = Math.min(sim.minClear, clear);
        let bad = clear < 0 ? 'box' : null;
        for (const c of phys.cyls) if (p.y < c.y1 && Math.hypot(p.x - c.x, p.z - c.z) < c.r + 0.5) bad = 'pole';
        if (bad && sim.violations.length < 20) sim.violations.push({ t: +mgr.time.toFixed(2), bad, p: p.toArray().map((v) => +v.toFixed(2)), state: d.state });
      }
      for (let i = fades.length - 1; i >= 0; i--) {
        const f = fades[i];
        f.age += dt;
        f.mesh.material.opacity = 1 - f.age / f.life;
        f.mesh.scale.multiplyScalar(1 + f.grow * dt);
        f.mesh.position.y += f.rise * dt;
        if (f.age >= f.life) { scene.remove(f.mesh); f.mesh.material.dispose(); fades.splice(i, 1); }
      }
    },
    step(seconds, dt = 1 / 60) {
      for (let t = 0; t < seconds; t += dt) sim.tick(dt);
      return sim.state();
    },
    state() {
      return {
        t: +mgr.time.toFixed(2), alive: mgr.aliveCount, total: mgr.drones.length, shots: mgr.shots.length, hp: +player.hp.toFixed(1),
        loops: loops.active, minClear: +sim.minClear.toFixed(2), violations: sim.violations.length,
        lights: mgr.lights.map((l) => Math.round(l.intensity)),
        drones: mgr.drones.map((d) => ({
          state: d.state, fire: d.fire.phase, sees: d.sees, hp: d.hp,
          p: d.position.toArray().map((v) => +v.toFixed(1)), v: +d.velocity.length().toFixed(1), dist: +d.dist.toFixed(1),
        })),
      };
    },
    follow(i, dist = 3.5, yaw = 30, pitch = 12) { sim.cam = i == null ? null : { i, dist, yaw, pitch }; },
    kill(i = 0) {
      const d = mgr.drones.filter((x) => x.alive)[i];
      const dir = d.position.clone().sub(player.eye).normalize();
      const ray = mgr.raycast(player.eye, dir, 200);
      return { rayHit: ray?.drone === d, dist: ray && +ray.dist.toFixed(2), killed: mgr.hit(d, 200, ray?.point, dir) };
    },
  };
  window.__sim = sim;
  window.__h.onFrame = (dt) => {
    if (!sim.paused) sim.tick(dt);
    const d = sim.cam && mgr.drones[sim.cam.i];
    if (d) view(sim.cam.yaw, sim.cam.pitch, sim.cam.dist, d.root.position.x, d.root.position.y, d.root.position.z);
  };
  view(25, 38, 52, 0, 2, 0);
  if (query.has('wave')) mgr.spawnWave(+query.get('wave') || 3, +query.get('level') || 1);
}
