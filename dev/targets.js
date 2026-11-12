// 练习场靶子预览：固定靶（带距离牌和几处掉漆）、移动靶（在轨道上）、起倒靶（立着，前面是挡板）、一块击倒躺平的固定靶。
// 默认静止；加 ?anim 让移动靶横移、起倒靶随机起落。
// 控制台：__targets.range（TargetRange 实例）；__targets.hit(i, x, y) 按靶板局部坐标打一枪（头板中心约 0, 1.63，胸口 0, 1.2）；
// __targets.kill(i) 直接击倒；__targets.step(秒) 推进（后台标签页里截图前先推进再 __h.frame()）
import { startHarness } from './harness.js';
import { TargetRange } from '../src/enemies/targets.js';
import { PhysicsWorld } from '../src/engine/physics.js';
import { TILT_DOWN } from '../src/enemies/target_model.js';

const anim = new URLSearchParams(location.search).has('anim');

startHarness(async ({ THREE, scene, mats, view }) => {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mats.concreteDark);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const log = [];
  const fx = { impact: (p, n, s) => log.push(['impact', s]) };
  const audio = { play: (name) => log.push(['sound', name]) };
  const fire = { x: 0, z: 12 };
  const layout = [
    { type: 'static', x: -2.4, z: 0 },
    { type: 'mover', x: 0.4, z: -1.2 },
    { type: 'popup', x: 3.4, z: 0 },
    { type: 'static', x: -5.4, z: -0.6 },
  ];
  const range = new TargetRange({ scene, phys: new PhysicsWorld(), mats, fx, audio, layout, fire });
  range.onKill = (t, info) => log.push(['kill', t.index, info]);
  range.setActive(true);
  range.popAt = anim ? 0 : Infinity;
  const [still, mover, pop, down] = range.targets;
  if (!anim) mover.vt = 0;
  // 起倒靶摆成立着的样子（静止模式下不会到时倒回去），最左边那块摆成击倒躺平
  Object.assign(pop, { state: 'up', alive: true, tilt: 0, timer: anim ? 0 : -1e9 });
  Object.assign(down, { state: 'down', alive: false, tilt: TILT_DOWN, timer: -1e9 });

  const v = new THREE.Vector3(), dir = new THREE.Vector3();
  const api = {
    range, log,
    hit(i, x, y) {
      const t = range.targets[i];
      v.set(x, y, 0.01).applyMatrix4(t.mat);
      dir.set(fire.x, 1.6, fire.z).sub(v).normalize().negate();
      const r = range.raycast(v.clone().addScaledVector(dir, -5), dir, 10);
      return r ? range.hit(r.target, 26, r.point, dir, r.part) : null;
    },
    kill(i) { const t = range.targets[i]; return range.hit(t, 400, t.center.clone(), dir.set(0, 0, -1), 'torso'); },
    step(sec) { for (let s = 0; s < sec; s += 1 / 60) range.update(1 / 60, null); },
  };
  window.__targets = api;
  // 固定靶上几处掉漆：胸口一组、肩上、头板一处（不打到击倒）
  for (const [x, y] of [[0.02, 1.21], [-0.05, 1.16], [0.16, 1.38]]) api.hit(0, x, y);
  for (const [x, y] of [[0.03, 1.25], [-0.12, 1.05]]) api.hit(1, x, y);
  still.hp = mover.hp = 100;
  range.update(1e-4, null);
  window.__h.onFrame = (dt) => range.update(dt, null);
  view(4, 8, 12.5, -1, 0.75, -0.3);
});
