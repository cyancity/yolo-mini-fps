// 材质总览：一排方块/球，检查程序化贴图
import { startHarness } from './harness.js';
import { rbox, boxUV } from '../src/gfx/geo.js';

startHarness(async ({ THREE, scene, mats, gear, view }) => {
  const world = [
    ['concrete', mats.concrete, 3], ['paint红', mats.paint(0x7d2a1e), 5.2], ['paint蓝', mats.paint(0x1c4470, { wear: 0.7 }), 5.2],
    ['wood', mats.wood, 0.9], ['galv', mats.galv, 1.2], ['sandbag', mats.sandbag, 0.25], ['rubber', mats.rubber, 0.06],
  ];
  const gearList = [
    ['metal', gear.metal, 0.25], ['steel', gear.steel, 0.12], ['blade', gear.blade, 0.12], ['polymer', gear.polymer, 0.06],
    ['g10', gear.g10, 0.08], ['glove', gear.glove, 0.2], ['sleeve', gear.sleeve, 0.6], ['brass', gear.brass, 1],
  ];
  world.forEach(([, m, tile], i) => {
    const mesh = new THREE.Mesh(boxUV(rbox(1, 1, 1, 0.03), tile), m);
    mesh.position.set((i - 3) * 1.3, 0.5, 0);
    scene.add(mesh);
  });
  gearList.forEach(([, m, tile], i) => {
    const mesh = new THREE.Mesh(boxUV(rbox(0.12, 0.12, 0.12, 0.006), tile), m);
    mesh.position.set((i - 3.5) * 0.16, 0.08, 1.6);
    scene.add(mesh);
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), mats.concreteDark);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  view(0, 22, 9, 0, 0.4, 0);
});
