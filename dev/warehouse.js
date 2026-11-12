// 仓库分区单独预览 + 预算统计：只建这一个分区，数三角形、材质、贴图、图集面积和碰撞体。
// 控制台：__h.stats 看统计，__h.view(yaw, pitch, dist, x, y, z) 换视角。
import * as THREE from 'three';
import { startHarness } from './harness.js';
import { Batch } from '../src/gfx/geo.js';
import { PhysicsWorld } from '../src/engine/physics.js';
import { LabelAtlas, mulberry32 } from '../src/world/labels.js';
import { build } from '../src/world/zones/warehouse.js';
import { whMats } from '../src/world/zones/warehouse_kit.js';
import { facadeMats } from '../src/world/warehouse.js';

startHarness(async (h) => {
  const { scene, mats, view } = h;
  const texBefore = new Set(Object.keys(mats.tex));
  const matsBefore = new Set(mats.cache.values());
  const shared = new Set(Object.values(mats).filter((m) => m && m.isMaterial));
  const names = new Map();
  for (const [k, m] of Object.entries(mats)) if (m && m.isMaterial) names.set(m, k);
  const batch = new Batch(), decals = new Batch(), atlas = new LabelAtlas(4096, 4096), phys = new PhysicsWorld();
  // 按调用位置（文件:函数）记三角形数，找出谁最费
  const bySite = new Map();
  const rawAdd = batch.add.bind(batch);
  batch.add = (m, g, mx, o) => {
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const line = new Error().stack.split('\n').find((l) => /warehouse_[a-z]+\.js|world\/warehouse\.js/.test(l) && !/warehouse_kit/.test(l)) || '?';
    const site = (line.match(/at (\S+) .*\/([a-z_]+\.js)/) || [, '?', line.trim().slice(0, 40)]).slice(1).reverse().join(':');
    bySite.set(site, (bySite.get(site) || 0) + n);
    return rawAdd(m, g, mx, o);
  };
  let atlasPx = 0;
  const add = atlas.add.bind(atlas);
  atlas.add = (w, hh, draw) => { atlasPx += w * hh; return add(w, hh, draw); };
  const ctx = { scene, batch, decals, mats, atlas, phys, rand: mulberry32(20261112), solid: (...a) => phys.solid(...a) };
  const t0 = performance.now();
  const out = build(ctx);
  for (const [k, m] of [...Object.entries(facadeMats(mats)).map(([k, m]) => ['out.' + k, m]), ...Object.entries(whMats(mats))]) names.set(m, k);
  for (const [k, m] of mats.cache) if (!names.has(m) && m.isMaterial) names.set(m, k);
  const ms = performance.now() - t0;
  // 每种材质的三角形数
  const perMat = [];
  let tris = 0;
  for (const [m, list] of batch.groups) {
    const n = list.reduce((s, g) => s + g.attributes.position.count / 3, 0);
    tris += n;
    perMat.push([names.get(m) || m.uuid.slice(0, 6), Math.round(n), shared.has(m) ? 'shared' : matsBefore.has(m) ? 'cached' : 'new']);
  }
  const decalTris = [...decals.groups.values()].flat().reduce((s, g) => s + g.attributes.position.count / 3, 0);
  batch.build(scene);
  decals.build(scene, { cast: false });
  atlas.finish();
  const used = atlas.y + atlas.rowH;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 80), mats.concreteDark);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.001, -26);
  scene.add(ground);
  h.stats = {
    buildMs: Math.round(ms), tris: Math.round(tris), decalTris: Math.round(decalTris), materials: perMat.length,
    newMaterials: perMat.filter((p) => p[2] !== 'shared').length,
    newTextures: Object.keys(mats.tex).filter((k) => !texBefore.has(k)),
    atlasMP: +(atlasPx / 1e6).toFixed(2), atlasRowsUsedPx: used, boxes: phys.boxes.length, cyls: phys.cyls.length,
    bySite: [...bySite].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)]), lights: out.lights.length, spawns: out.spawns.length, perMat: perMat.sort((a, b) => b[1] - a[1]),
  };
  console.log('[warehouse] 统计', h.stats);
  view(200, 35, 55, 0, 2, -26);
}, { exposure: 1.0 });
