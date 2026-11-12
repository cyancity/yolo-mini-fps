// 楼顶分区单独预览：只建楼顶这一个分区（屋面、楼梯间、消防梯、招牌、设备和远景），补一盏半球光。
// __h.view(偏航, 俯仰, 距离, x, y, z) 换机位，比如 __h.view(20, 35, 60, 0, 9, -30) 看两块屋面，
// __h.view(0, 8, 260, 0, 30, -40) 拉远看远景；__h.far(false) 藏远景（它自己合一个批次，建的时候就加进场景了）。
import { startHarness } from './harness.js';
import { Batch } from '../src/gfx/geo.js';
import { PhysicsWorld } from '../src/engine/physics.js';
import { LabelAtlas, mulberry32 } from '../src/world/labels.js';
import { build } from '../src/world/zones/rooftop.js';

startHarness(async ({ THREE, scene, mats, view, camera }) => {
  const batch = new Batch(), decals = new Batch(), atlas = new LabelAtlas(4096, 4096), phys = new PhysicsWorld();
  const ctx = { scene, batch, decals, mats, atlas, phys, rand: mulberry32(20261112) };
  const before = scene.children.length;
  const out = build(ctx);
  const far = scene.children.slice(before);
  const meshes = [...batch.build(scene), ...decals.build(scene, { cast: false })];
  atlas.finish();
  for (const s of out.lights) {
    const l = new THREE.SpotLight(s.color ?? 0xffffff, s.intensity, s.distance, s.angle, s.penumbra, 2);
    l.position.set(...s.pos);
    l.target.position.set(...s.aim);
    scene.add(l, l.target);
  }
  scene.add(new THREE.HemisphereLight(0xb8c8e0, 0x30302c, 0.5));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), mats.concreteDark);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  // 远景铺到 480 m，远裁剪面放远
  camera.near = 0.05;
  camera.far = 1500;
  camera.updateProjectionMatrix();
  const tris = (list) => list.reduce((n, m) => n + (m.geometry?.attributes.position.count ?? 0) / 3, 0);
  window.__h.far = (on = true) => { for (const o of far) o.visible = on; };
  window.__h.stats = () => ({ spawns: out.spawns.length, lights: out.lights.length, boxes: phys.boxes.length, cyls: phys.cyls.length, tris: tris(meshes), farTris: tris(far) });
  window.__h.onFrame = (dt, t) => out.update?.(dt, t, []);
  view(20, 35, 60, 0, 9, -30);
}, { exposure: 1.1 });
