// 办公楼单独预览：只建办公楼这一个分区，补一盏半球光看清楚室内。
// __h.view(偏航, 俯仰, 距离, x, y, z) 换机位，比如 __h.view(-60, 25, 30, -10, 4, -40) 看整栋，
// __h.cut(y) 把高于 y 的东西藏起来（看一层平面），__h.cut() 恢复。
import { startHarness } from './harness.js';
import { Batch } from '../src/gfx/geo.js';
import { PhysicsWorld } from '../src/engine/physics.js';
import { LabelAtlas, mulberry32 } from '../src/world/labels.js';
import { build } from '../src/world/zones/office.js';

startHarness(async ({ THREE, scene, mats, view, camera, renderer }) => {
  const batch = new Batch(), decals = new Batch(), atlas = new LabelAtlas(4096, 4096), phys = new PhysicsWorld();
  const ctx = { scene, batch, decals, mats, atlas, phys, rand: mulberry32(20261112) };
  const out = build(ctx);
  const meshes = [...batch.build(scene), ...decals.build(scene, { cast: false })];
  atlas.finish();
  for (const s of out.lights) {
    const l = new THREE.SpotLight(s.color, s.intensity, s.distance, s.angle, s.penumbra, 2);
    l.position.set(...s.pos);
    l.target.position.set(...s.aim);
    scene.add(l, l.target);
  }
  scene.add(new THREE.HemisphereLight(0xb8c8e0, 0x30302c, 0.6));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mats.concreteDark);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  camera.near = 0.05;
  camera.far = 400;
  camera.updateProjectionMatrix();
  // 剖切：用裁切平面把某个高度以上的东西切掉，看平面布置
  renderer.localClippingEnabled = true;
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
  for (const m of meshes) m.material.clippingPlanes = [plane];
  window.__h.cut = (y) => { plane.constant = y ?? 1e6; };
  window.__h.stats = () => ({ spawns: out.spawns.length, lights: out.lights.length, boxes: phys.boxes.length, tris: meshes.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0) });
  window.__h.onFrame = (dt, t) => out.update?.(dt, t, []);
  view(-55, 28, 34, -10, 3, -40);
}, { exposure: 1.1 });
