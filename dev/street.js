// 街道和卸货场单独预览 + 预算统计：只建这一个分区，数三角形、材质、贴图、图集面积和碰撞体，地面标线画在一张平面上。
// 控制台：__h.stats 看统计，__h.view(yaw, pitch, dist, x, y, z) 换视角，__h.night(false) 换成摄影棚光看细节。
import * as THREE from 'three';
import { startHarness } from './harness.js';
import { Batch } from '../src/gfx/geo.js';
import { PhysicsWorld } from '../src/engine/physics.js';
import { LabelAtlas, mulberry32 } from '../src/world/labels.js';
import { build } from '../src/world/zones/street.js';

// 地面标线的画布范围（世界坐标）和精度
const X0 = 8, X1 = 44, Z0 = -48.5, Z1 = 22, PPM = 20;

startHarness(async (h) => {
  const { scene, mats, view } = h;
  const texBefore = new Set(Object.keys(mats.tex));
  const shared = new Set(Object.values(mats).filter((m) => m && m.isMaterial));
  const cachedBefore = new Set(mats.cache.values());
  const batch = new Batch(), decals = new Batch(), atlas = new LabelAtlas(4096, 4096), phys = new PhysicsWorld();
  // 按调用位置（文件:函数）记三角形数，找出谁最费
  const bySite = new Map();
  const rawAdd = batch.add.bind(batch);
  batch.add = (m, g, mx, o) => {
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const line = new Error().stack.split('\n').find((l) => /street_[a-z]+\.js|world\/props\.js/.test(l) && !/street_kit/.test(l)) || '?';
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
  const ms = performance.now() - t0;

  // 材质名：共享材质用属性名，缓存出来的用缓存键（paint 键在游戏里多半已被别的分区建过）
  const names = new Map();
  for (const [k, m] of Object.entries(mats)) if (m && m.isMaterial) names.set(m, k);
  for (const [k, m] of mats.cache) if (!names.has(m) && m?.isMaterial) names.set(m, k);
  let tris = 0;
  const perMat = [];
  for (const [m, list] of batch.groups) {
    const n = list.reduce((s, g) => s + g.attributes.position.count / 3, 0);
    tris += n;
    perMat.push([names.get(m) || m.uuid.slice(0, 6), Math.round(n), shared.has(m) ? 'shared' : cachedBefore.has(m) ? 'cached' : 'new']);
  }
  const decalTris = [...decals.groups.values()].flat().reduce((s, g) => s + g.attributes.position.count / 3, 0);
  batch.build(scene);
  decals.build(scene, { cast: false });
  atlas.finish();

  // 地面：深色沥青底 + 分区画的标线
  const cv = document.createElement('canvas');
  cv.width = (X1 - X0) * PPM;
  cv.height = (Z1 - Z0) * PPM;
  const c2 = cv.getContext('2d');
  c2.fillStyle = '#1b1c1d';
  c2.fillRect(0, 0, cv.width, cv.height);
  out.paint?.(c2, (x, z) => [(x - X0) * PPM, (z - Z0) * PPM], PPM);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((X0 + X1) / 2, -0.001, (Z0 + Z1) / 2);
  scene.add(ground);

  // 分区的灯（预览页里直接用普通聚光灯）；update 里只改亮度
  const lights = out.lights.map((l) => {
    const s = new THREE.SpotLight(l.color, l.intensity, l.distance, l.angle, l.penumbra, 2);
    s.position.set(...l.pos);
    s.target.position.set(...l.aim);
    scene.add(s, s.target);
    return s;
  });
  const hemi = new THREE.HemisphereLight(0x6c7c94, 0x15140f, 0.25);
  scene.add(hemi);
  h.onFrame = (dt, t) => out.update?.(dt, t, lights);
  // 夜景（只有分区的灯）和摄影棚光之间切换，看材质细节时用后者
  const studio = new THREE.DirectionalLight(0xffffff, 2.2);
  studio.position.set(60, 40, 10);
  scene.add(studio);
  h.night = (on = true) => { studio.intensity = on ? 0 : 2.2; hemi.intensity = on ? 0.25 : 1.2; scene.environmentIntensity = on ? 0.15 : 1.5; };
  h.night(true);

  h.stats = {
    buildMs: Math.round(ms), tris: Math.round(tris), decalTris: Math.round(decalTris), materials: perMat.length,
    newMaterials: perMat.filter((p) => p[2] === 'new').length,
    newTextures: Object.keys(mats.tex).filter((k) => !texBefore.has(k)),
    atlasMP: +(atlasPx / 1e6).toFixed(2), boxes: phys.boxes.length, cyls: phys.cyls.length,
    lights: out.lights.length, spawns: out.spawns,
    bySite: [...bySite].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)]), perMat: perMat.sort((a, b) => b[1] - a[1]),
  };
  console.log('[street] 统计', h.stats);
  view(300, 30, 46, 34, 2, -14);
}, { exposure: 1.0, studio: false });
