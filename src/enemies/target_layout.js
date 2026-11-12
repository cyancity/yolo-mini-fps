import * as THREE from 'three';
import { Batch, xf, box, scaleUV, canvasTexture } from '../gfx/geo.js';
import { STENCIL_FONT } from '../world/labels.js';

// 射击位：玩家出生点，面朝北
export const FIRE = { x: -9, z: 16 };
// 移动靶的轨道：半程（米）和轨面高度
export const RAIL_HALF = 2, RAIL_H = 0.06;

// 堆场里的靶位。每个位置都用 phys.raycast 从射击位核对过：头、胸、腹、两肩都看得见（移动靶查了轨道两端），
// 倒下去的那 1.8 m 落在空地上，静止靶之间方位角错开、互不遮挡。
// 北边是两个箱子之间的通道和仓库月台，东边是开阔的扇面；方位角从北起顺时针，写在每行后面
export const LAYOUT = [
  // 近排 9–12 m
  { type: 'static', x: -13.0, z: 8.0 }, // -27°
  { type: 'static', x: -10.2, z: 6.2 }, // -7°
  { type: 'static', x: -7.6, z: 4.2 }, // 7°
  { type: 'static', x: 3.0, z: 17.0 }, // 95°
  // 中距离 20–22 m
  { type: 'static', x: -8.3, z: -4.0 }, // 2°
  { type: 'static', x: 5.0, z: 0.5 }, // 42°
  { type: 'static', x: 7.4, z: 1.3 }, // 48°
  // 远靶 35 m 以上：一个站在仓库月台上（门洞前），一个在东边桶堆后面
  { type: 'static', x: -2.5, z: -18.6 }, // 11°
  { type: 'static', x: 20.5, z: -6.5 }, // 53°
  // 移动靶：轨道和视线垂直，15 m 和 23 m 各一条
  { type: 'mover', x: 6.0, z: 12.2 }, // 68–83°
  { type: 'mover', x: 11.0, z: 4.5 }, // 55–65°
  // 起倒靶：躺在挡板后面，随机立起 2.5 秒
  { type: 'popup', x: -10.0, z: -2.6 }, // -3°
  { type: 'popup', x: 3.7, z: 3.3 }, // 45°
  { type: 'popup', x: 11.0, z: 15.3 }, // 88°
];

// 验收用：从射击位（眼高 1.64）看每块靶的头、胸、腹、两肩，返回被场景挡住的点；空数组就是都看得见。
// 移动靶查轨道两端和中点。控制台：(await import('/src/enemies/target_layout.js')).auditLayout(__dbg.game.targets, __dbg.level.phys)
export function auditLayout(range, phys, eyeY = 1.64) {
  const eye = new THREE.Vector3(FIRE.x, eyeY, FIRE.z), w = new THREE.Vector3(), d = new THREE.Vector3();
  const pts = [[0, 1.632], [0, 1.2], [0, 0.95], [-0.2, 1.35], [0.2, 1.35]];
  const bad = [];
  for (const t of range.targets) {
    const keep = { s: t.s, tilt: t.tilt, rock: t.rock, twist: t.twist };
    t.tilt = t.rock = t.twist = 0;
    for (const s of t.type === 'mover' ? [-RAIL_HALF, 0, RAIL_HALF] : [0]) {
      t.s = s;
      range.pose(t);
      for (const [x, y] of pts) {
        w.set(x, y, 0.01).applyMatrix4(t.mat);
        d.subVectors(w, eye);
        const len = d.length();
        const hit = phys.raycast(eye, d.normalize(), len);
        if (hit && hit.dist < len - 0.03) bad.push({ index: t.index, type: t.type, s, x, y, blockedAt: +hit.dist.toFixed(2) });
      }
    }
    Object.assign(t, keep);
    range.pose(t);
  }
  return bad;
}

// 距离牌图集：每格一块 128×64 的小铁牌
const CELL_W = 128, CELL_H = 64, COLS = 4, ROWS = 4;

function labelAtlas(texts) {
  return canvasTexture(CELL_W * COLS, CELL_H * ROWS, (c) => {
    texts.forEach((text, i) => {
      const x = (i % COLS) * CELL_W, y = Math.floor(i / COLS) * CELL_H;
      c.fillStyle = '#1d2023';
      c.fillRect(x, y, CELL_W, CELL_H);
      c.strokeStyle = '#d9d3bf';
      c.lineWidth = 4;
      c.strokeRect(x + 5, y + 5, CELL_W - 10, CELL_H - 10);
      c.fillStyle = '#ece6d2';
      c.font = `700 38px ${STENCIL_FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, x + CELL_W / 2, y + CELL_H / 2 + 2);
    });
  }, { aniso: 4 });
}

// 不动的东西：移动靶的轨道、起倒靶的挡板和电机箱、固定靶旁边的距离牌。
// 合成两个网格（涂装钢一个、距离牌一个），挂在 parent 下
export function buildProps(parent, mats, targets) {
  const batch = new Batch();
  const steel = mats.paint(0x2f3438, { wear: 0.3, dirt: 0.6 });
  const olive = mats.paint(0x343b2e, { wear: 0.25, dirt: 0.6 });
  const P = { tile: 5.2 };
  const texts = [];
  const signs = [];
  for (const t of targets) {
    const base = new THREE.Matrix4().makeRotationY(t.yaw).setPosition(t.origin.x, t.ground, t.origin.z);
    const at = (x, y, z, rx = 0, ry = 0, rz = 0) => base.clone().multiply(xf(x, y, z, rx, ry, rz));
    if (t.type === 'mover') {
      const len = RAIL_HALF * 2 + 0.9;
      for (const z of [-0.2, 0.2]) {
        batch.add(steel, box(len, 0.045, 0.05), at(0, RAIL_H - 0.0225, z), P);
        batch.add(steel, box(len, 0.008, 0.11), at(0, 0.004, z), P);
      }
      for (let x = -len / 2 + 0.2; x <= len / 2 - 0.15; x += 0.7) batch.add(olive, box(0.12, 0.02, 0.62), at(x, 0.01, 0), P);
      for (const s of [-1, 1]) batch.add(olive, box(0.08, 0.16, 0.56), at(s * (len / 2 + 0.04), 0.08, 0), P);
    } else if (t.type === 'popup') {
      // 斜挡板：躺倒时整块靶都藏在它后面
      batch.add(olive, box(1.1, 0.5, 0.014), at(0, 0.22, 0.62, -0.42, 0, 0), P);
      for (const s of [-1, 1]) batch.add(steel, box(0.04, 0.04, 0.42), at(s * 0.5, 0.12, 0.45, 0.55, 0, 0), P);
      batch.add(olive, box(0.26, 0.2, 0.32), at(0.5, 0.1, -0.12), P);
      batch.add(steel, box(0.3, 0.03, 0.36), at(0.5, 0.215, -0.12), P);
    } else {
      // 距离牌：射手看过去在靶子右手边
      batch.add(steel, box(0.03, 0.44, 0.008), at(0.62, 0.22, 0.24), P);
      batch.add(steel, box(0.32, 0.17, 0.008), at(0.62, 0.42, 0.24), P);
      signs.push({ m: at(0.62, 0.42, 0.248), cell: texts.length });
      texts.push(`${Math.round(t.dist)} m`);
    }
  }
  const meshes = batch.build(parent);
  if (signs.length) {
    const mat = new THREE.MeshStandardMaterial({
      map: labelAtlas(texts), roughness: 0.7, metalness: 0.15, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const labels = new Batch();
    for (const s of signs) {
      const g = new THREE.PlaneGeometry(0.29, 0.145);
      const cx = s.cell % COLS, cy = Math.floor(s.cell / COLS);
      scaleUV(g, 1 / COLS, 1 / ROWS, cx / COLS, 1 - (cy + 1) / ROWS);
      labels.add(mat, g, s.m);
    }
    meshes.push(...labels.build(parent, { cast: false }));
  }
  return meshes;
}
