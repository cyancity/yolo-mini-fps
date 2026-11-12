import * as THREE from 'three';
import { Batch } from '../gfx/geo.js';
import { PhysicsWorld } from '../engine/physics.js';
import { LabelAtlas, mulberry32, STENCIL_FONT } from './labels.js';
import { addContainer, C20, C40, CH, CW } from './containers.js';
import { buildFence, lightMast, buildBackdrop } from './yard.js';
import * as P from './props.js';
import { buildYardCover } from './yard_cover.js';
import { Ground } from './ground.js';
import { Lighting } from './lighting.js';
import { MAP, PORTAL } from './plan.js';

// 堆场以外的分区。动态加载并各自兜错：某个分区建不起来，其余部分照常能玩
const ZONES = [
  ['warehouse', () => import('./zones/warehouse.js')],
  ['office', () => import('./zones/office.js')],
  ['rooftop', () => import('./zones/rooftop.js')],
  ['street', () => import('./zones/street.js')],
];

const RED = 0x7d2a1e, BLUE = 0x1c4470, TEAL = 0x1f5e56, YELLOW = 0xb8901f, GRAY = 0xa8a89f, ORANGE = 0xb24a18,
  MAROON = 0x5a1f24, GREEN = 0x2c4a2e;
export const BOUNDS = { x0: -24, x1: 24, z0: -17, z1: 18 };
export const SPAWN = { x: -9, z: 16, yaw: 0 };

// 地面标线和喷字（俯视图，toPx 把世界 x,z 换成画布像素）
function paintGround(ctx, toPx, ppm) {
  const yellow = 'rgb(212,168,30)', white = 'rgb(214,214,204)';
  const line = (x0, z0, x1, z1, w, color) => {
    const [ax, ay] = toPx(x0, z0), [bx, by] = toPx(x1, z1);
    ctx.strokeStyle = color; ctx.lineWidth = w * ppm; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  };
  const text = (str, x, z, size, color, rot = 0) => {
    const [px, py] = toPx(x, z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${size * ppm}px ${STENCIL_FONT}, "Microsoft YaHei"`;
    ctx.fillText(str, 0, 0); ctx.restore();
  };
  // 装卸区边线和黄色斜纹禁停带
  line(-24, -14.2, 24, -14.2, 0.15, yellow);
  ctx.save();
  const [hx, hy] = toPx(-14, -16.9), [hx2, hy2] = toPx(10, -14.4);
  ctx.beginPath(); ctx.rect(hx, hy, hx2 - hx, hy2 - hy); ctx.clip();
  for (let x = -18; x < 12; x += 1.1) line(x, -14.3, x + 2.6, -17, 0.16, yellow);
  ctx.restore();
  // 堆位框和编号
  const slot = (x, z, w, d, label, rot = 0) => {
    ctx.save();
    const [px, py] = toPx(x, z);
    ctx.translate(px, py); ctx.rotate(rot);
    ctx.strokeStyle = white; ctx.lineWidth = 0.1 * ppm;
    ctx.strokeRect((-w / 2) * ppm, (-d / 2) * ppm, w * ppm, d * ppm);
    ctx.restore();
    if (label) text(label, x + Math.cos(rot) * (w / 2 + 0.9), z + Math.sin(rot) * (w / 2 + 0.9), 0.62, white, rot + Math.PI / 2);
  };
  slot(-17, -7.5, 6.5, 2.9, 'A1');
  slot(-10.6, -7.5, 6.5, 2.9, '');
  slot(9.5, -3, 6.5, 2.9, 'B2');
  slot(13.5, 9, 6.5, 2.9, 'C1');
  slot(13.5, 11.6, 6.5, 2.9, '');
  slot(-2, -6, 6.5, 2.9, 'A3');
  slot(2, 8.5, 6.5, 2.9, 'C4');
  // 行车道虚线、箭头和限速
  for (let x = -22; x < 22; x += 3) line(x, 0, x + 1.5, 0, 0.12, white);
  line(-24, 17.6, 24, 17.6, 0.15, yellow);
  text('5', -19.5, 1.6, 1.5, white);
  ctx.strokeStyle = white; ctx.lineWidth = 0.14 * ppm;
  const [cx, cy] = toPx(-19.5, 1.55);
  ctx.beginPath(); ctx.arc(cx, cy, 1.25 * ppm, 0, Math.PI * 2); ctx.stroke();
  text('慢', 18, 1.5, 1.6, white);
  text('GATE 2', 0, 15.6, 0.9, yellow);
  text('零号泊位', 0, -12.8, 1.0, white);
}

export async function buildLevel({ scene, mats, sky, lite = false }) {
  const phys = new PhysicsWorld();
  const batch = new Batch(), decals = new Batch(), atlas = new LabelAtlas(4096, 4096);
  const rand = mulberry32(20261112);
  const ctx = { scene, batch, decals, mats, atlas, phys, rand, solid: (...a) => phys.solid(...a) };
  let seed = 1;
  const box20 = (x, z, yaw, color, opt = {}) => addContainer(ctx, { x, z, yaw, color, seed: seed++, line: seed, ...opt });

  // 西墙：三列 40 尺箱，两到三层
  [-12.4, 0, 12.4].forEach((z, i) => {
    const cols = [[BLUE, YELLOW], [RED, TEAL, BLUE], [GRAY, MAROON]][i];
    cols.forEach((c, k) => box20(-27.6, z, Math.PI / 2, c, { len: C40, y: k * CH, darkText: c === GRAY || c === YELLOW }));
  });
  // 东墙：六列 20 尺箱，抽掉通往街道的那一列（东门）
  [-15.9, -9.6, -3.3, 3.0, 9.3, 15.6].forEach((z, i) => {
    if (Math.abs(z - PORTAL.yardGate.z) < 0.5) return;
    const cols = [[TEAL, RED], [ORANGE, BLUE, GRAY], [MAROON, GREEN], [BLUE, YELLOW, RED], [RED, TEAL], [GREEN, ORANGE]][i];
    cols.forEach((c, k) => box20(27.6, z, Math.PI / 2 + (rand() - 0.5) * 0.01, c, { y: k * CH, darkText: c === GRAY || c === YELLOW }));
  });
  // 场内
  box20(-17, -7.5, 0, RED);
  box20(-17, -7.5, 0.012, BLUE, { y: CH });
  box20(-10.6, -7.5, 0.02, TEAL);
  box20(9.5, -3, 0, GRAY, { open: true, darkText: true, wear: 0.55 });
  box20(9.5, -5.62, 0, ORANGE);
  box20(9.5, -5.62, -0.01, MAROON, { y: CH });
  box20(13.5, 9, 0, BLUE);
  box20(13.5, 11.6, 0, RED);
  box20(13.5, 9, 0.015, TEAL, { y: CH });
  box20(-4, 5.5, Math.PI / 2, YELLOW, { darkText: true });
  box20(-13.2, 3.6, 0.52, GREEN, { wear: 0.6 });

  buildFence(ctx);
  const masts = [
    lightMast(ctx, { x: -21.5, z: 16.4, aim: [-9, 7] }),
    lightMast(ctx, { x: 21.5, z: 17, aim: [9, 8], cool: true }),
    lightMast(ctx, { x: -22.6, z: -15.4, aim: [-10, -8], cool: true }),
    lightMast(ctx, { x: 20.5, z: -15.2, aim: [10, -8] }),
  ];

  // 掩体和杂物
  for (const x of [-2.6, 0, 2.6]) P.jerseyBarrier(ctx, { x, z: 13.2, yaw: Math.PI / 2 + (rand() - 0.5) * 0.05 });
  P.jerseyBarrier(ctx, { x: 4.6, z: -11.2, yaw: Math.PI / 2 });
  P.jerseyBarrier(ctx, { x: 7.2, z: -11.3, yaw: Math.PI / 2 + 0.06 });
  P.jerseyBarrier(ctx, { x: -9, z: 0.4, yaw: 0.35 });
  P.jerseyBarrier(ctx, { x: 19.5, z: 2, yaw: 0.1 });
  P.sandbagWall(ctx, { x: 1.6, z: 1.8, yaw: 0.2, len: 3.2, rows: 5 });
  P.sandbagWall(ctx, { x: -8, z: -12.6, yaw: -0.1, len: 2.6, rows: 4 });
  P.crate(ctx, { x: 2, z: -12, yaw: 0.1 });
  P.crate(ctx, { x: 3.25, z: -12.3, yaw: 0.25, w: 1.2, h: 1.0, d: 0.9 });
  P.crate(ctx, { x: 2.1, y: 0.83, z: -12.05, yaw: -0.3, w: 0.8, h: 0.6, d: 0.7 });
  P.crate(ctx, { x: -20.4, z: 8.2, yaw: 0.6 });
  P.crate(ctx, { x: -21.6, z: 9.3, yaw: -0.2, w: 1.3, h: 1.1, d: 1.0 });
  P.crate(ctx, { x: 6.3, z: 3.6, yaw: 0.4, w: 0.9, h: 0.7, d: 0.9 });
  // 月台上的三件贴着仓库外墙放（避开 2、3 号门洞），离月台边留出 2 米，人跳上来有地方站
  P.crate(ctx, { x: -12, y: 1.1, z: -19.45, yaw: 0.15 });
  P.crate(ctx, { x: -6.3, y: 1.1, z: -19.45, yaw: -0.25, w: 1.2, h: 0.9, d: 0.8 });
  P.crate(ctx, { x: 12, z: -2.6, yaw: 0.2, w: 1.1, h: 0.9, d: 0.8 });
  P.palletStack(ctx, { x: -22, z: -12.8, n: 6, yaw: 0.05 });
  P.palletStack(ctx, { x: -20.5, z: -13, n: 3, yaw: -0.2 });
  P.palletStack(ctx, { x: 17, z: -13, n: 5, yaw: 0.4 });
  P.palletStack(ctx, { x: 4.2, z: 11.6, n: 4, yaw: 1.2 });
  // 这一垛放在 2、3 号门之间的墙段上：月台东端 x 8..10 是台阶口，摆在那里敌人下不了月台
  P.palletStack(ctx, { x: 2, y: 1.1, z: -19.45, n: 3, yaw: 0.1 });
  P.palletStack(ctx, { x: 10.6, z: -2.4, n: 2, yaw: 0.3 });
  const drum = (x, z, color, opt = {}) => P.barrel(ctx, { x, z, color, yaw: rand() * 6, ...opt });
  drum(18, -7, BLUE); drum(18.7, -7.2, RED); drum(18.3, -6.35, BLUE, { wear: 0.8 }); drum(19.1, -6.5, 0x555a5f);
  drum(17.2, -5.6, RED, { lying: true, yaw: 0.7 });
  drum(-6.5, -1.5, 0x555a5f); drum(-5.8, -1.3, BLUE); drum(-6.2, -0.75, RED, { wear: 0.85 });
  drum(21, 13.2, YELLOW); drum(-23.5, 6, BLUE); drum(-23.6, 6.75, BLUE);
  P.tireStack(ctx, { x: -22.6, z: 14.2, n: 4 });
  P.tireStack(ctx, { x: -21.6, z: 13.5, n: 2 });
  P.cone(ctx, { x: 5.2, z: 6.4 }); P.cone(ctx, { x: 6.5, z: 7.2 }); P.cone(ctx, { x: 4.6, z: 7.8, tip: true, yaw: 1 });
  P.cone(ctx, { x: -1.5, z: -14 }); P.cone(ctx, { x: 11.9, z: -15.4 });
  P.generator(ctx, { x: 19.2, z: 14.6, yaw: -0.5 });
  const work = P.workLight(ctx, { x: 17.3, z: 13.2, yaw: -2.2 });
  P.cableSpool(ctx, { x: -23.6, z: -3.2, yaw: 0.3 });
  P.tarpCargo(ctx, { x: -21.4, z: -2.6, yaw: 0.1 });
  P.tarpCargo(ctx, { x: 15.2, z: -14.6, yaw: -0.15, w: 1.9, h: 1.3, d: 1.3 });
  P.tarpCargo(ctx, { x: -1.2, z: 9.6, yaw: 0.5, w: 1.4, h: 0.9 });
  for (const x of [-14.7, 12.3]) P.bollard(ctx, { x, z: -16.4 });
  for (const x of [-5.2, 5.2]) P.bollard(ctx, { x, z: 19.3 });
  buildYardCover(ctx);

  buildBackdrop(ctx, scene);

  // 其余分区：每个模块导出 build(ctx)，返回 { lights, spawns, paint, update }（接口见 dev/README.md）
  // 每个分区的几何体单独合批：整张图合成一个网格的话，视锥剔除就不起作用了
  const zones = [];
  for (const [name, load] of ZONES) {
    const zb = new Batch(), zd = new Batch();
    try {
      const out = (await load()).build({ ...ctx, batch: zb, decals: zd }) || {};
      zones.push({ name, lights: out.lights || [], spawns: out.spawns || [], paint: out.paint || null, update: out.update || null });
      zb.build(scene);
      zd.build(scene, { cast: false });
    } catch (e) {
      console.error(`[level] 分区 ${name} 没建起来`, e);
    }
  }

  batch.build(scene);
  decals.build(scene, { cast: false });
  atlas.finish();

  // 全图四周的隐形墙：站在屋顶边上也掉不出去
  const mx = (MAP.x0 + MAP.x1) / 2, mz = (MAP.z0 + MAP.z1) / 2, hx = (MAP.x1 - MAP.x0) / 2, hz = (MAP.z1 - MAP.z0) / 2;
  for (const [x, z, bx, bz] of [[MAP.x0 - 0.5, mz, 0.5, hz + 1], [MAP.x1 + 0.5, mz, 0.5, hz + 1], [mx, MAP.z0 - 0.5, hx + 1, 0.5], [mx, MAP.z1 + 0.5, hx + 1, 0.5]]) {
    phys.addBox(x, 10, z, bx, 10, bz, 0, 'metal').playerOnly = true;
  }
  // 西侧箱墙顶上不让站
  phys.addBox(-29.4, 5, 0, 0.4, 5, 19, 0, 'metal').playerOnly = true;

  const ground = new Ground(mats, (c, toPx, ppm) => {
    paintGround(c, toPx, ppm);
    for (const z of zones) z.paint?.(c, toPx, ppm);
  });
  scene.add(ground.mesh);

  const lighting = new Lighting(scene, sky, {
    lite,
    masts,
    containerLight: { position: new THREE.Vector3(12, CH - 0.35, -3), target: new THREE.Vector3(7.2, 0.4, -3) },
    workLight: work,
    zones,
    exitSign: new THREE.Vector3(21, 2.5, -19.6),
  });
  // 倒影隔帧重画时，阴影图排到它不画的那一帧
  lighting.mirror = ground;
  // 箱内吊着的灯管
  const tube = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.09), mats.emissive(0xd8e8ff, 18));
  tube.position.set(11.2, CH - 0.12, -3);
  scene.add(tube);

  // 敌人出生点：堆场里的几个空位，加上各分区自己报的
  const spawns = [[-19, -9.5], [21.5, 8], [0, -9], [-14, 10], [8, 14]].map(([x, z]) => ({ x, y: 0, z, zone: 'yard' }));
  for (const z of zones) for (const s of z.spawns) spawns.push({ y: 0, zone: z.name, ...s });

  let time = 0;
  const update = (dt) => {
    time += dt;
    for (const z of zones) z.update?.(dt, time, lighting.zoneLights[z.name] || []);
  };
  return { phys, ground, lighting, atlas, spawn: SPAWN, spawns, zones, update, bounds: BOUNDS, sizes: { CW, CH, C20 } };
}
