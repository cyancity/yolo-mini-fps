import * as THREE from 'three';
import { DEATHS, finalParams, reachAlong } from './soldier_death.js';

// 倒地前看一眼周围：沿每种死法（含镜像）最后躺下的方向探墙、探月台边和别的尸体，
// 挑一种躺得下的；都躺不下就缩短骨盆位移，再不行就背靠墙坐倒（slump）。只在 die() 时算一次。
const MARGIN = 0.08; // 头和墙之间留的缝
const EDGE = 0.3; // 脚下落差超过它算边沿
const OPTS = []; // { kind, flip, ux, uz, reach, disp }：根空间的倒地方向、身体伸出去多远、其中骨盆位移占多少
const RES = { kind: 'back', flip: false, scale: 1, psi: 0, wx: 0, wz: 0, p: 0 };
const _a = new Float32Array(30), _h = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3();
const D = new Float32Array(6);

function build() {
  if (OPTS.length) return;
  for (const kind of DEATHS) {
    for (const flip of [false, true]) {
      finalParams(kind, flip, _a);
      reachAlong(_a, 1, 0, true, _h);
      const l = Math.hypot(_h.x, _h.z) || 1, ux = _h.x / l, uz = _h.z / l;
      OPTS.push({ kind, flip, ux, uz, reach: reachAlong(_a, ux, uz, true), disp: Math.max(0, _a[0] * ux + _a[2] * uz) });
    }
  }
}

// 从脚下沿世界方向 (dx, dz) 能放下多长的身体
function clearance(P, dx, dz, max, phys, others) {
  let d = max;
  _d.set(dx, 0, dz);
  for (const h of [0.3, 0.85]) {
    _o.set(P.x, P.y + h, P.z);
    const t = phys.rayDist(_o, _d, max);
    if (t >= 0 && t < d) d = t;
  }
  for (let r = 0.3; r < d; r += 0.3) {
    if (P.y - phys.groundHeight(P.x + dx * r, P.z + dz * r, 0.1, P.y, EDGE) > EDGE) { d = Math.max(0, r - 0.15); break; }
  }
  // 别的尸体：两具叠在一起会互相穿插
  if (others) {
    for (const c of others) {
      const rx = c.x - P.x, rz = c.z - P.z, along = rx * dx + rz * dz;
      if (along <= 0 || along > d + 0.4 || Math.abs(c.y - P.y) > 1) continue;
      if (Math.abs(rx * dz - rz * dx) < 0.55) d = Math.max(0, Math.min(d, along - 0.4));
    }
  }
  return d;
}

// root：士兵的根节点（脚底、朝向）；kind/flip：按中弹方向挑的死法。返回给 Death.start 的 fit
export function chooseFall(root, kind, flip, pack, phys, others) {
  build();
  const P = root.position, yaw = root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
  let first = 0;
  for (let i = 0; i < OPTS.length; i++) {
    const o = OPTS[i];
    if (o.kind === kind && o.flip === flip) first = i;
    D[i] = clearance(P, o.ux * c + o.uz * s, -o.ux * s + o.uz * c, o.reach + 0.25, phys, others);
  }
  RES.scale = 1;
  // 先看原本的死法，再看它的镜像，最后看别的
  const order = [first, first ^ 1];
  for (let i = 0; i < OPTS.length; i++) if (i !== first && i !== (first ^ 1)) order.push(i);
  for (const i of order) {
    if (D[i] >= OPTS[i].reach + MARGIN) return pick(OPTS[i]);
  }
  // 都伸不开：骨盆少挪一点能放下的，挑余量最大的那种
  let best = -1, slack = -Infinity, near = 0;
  for (const i of order) {
    const o = OPTS[i], k = D[i] - (o.reach - o.disp) - MARGIN;
    if (k > slack) { slack = k; best = i; }
    if (D[i] < D[near]) near = i;
  }
  if (slack >= 0) {
    const o = OPTS[best];
    pick(o);
    RES.scale = o.disp > 0 ? Math.max(0, (D[best] - MARGIN - (o.reach - o.disp)) / o.disp) : 1;
    return RES;
  }
  // 背靠最近的那堵墙坐下：背朝墙的方向转过去，骨盆挪到背刚好贴墙
  const o = OPTS[near];
  RES.kind = 'slump';
  RES.flip = Math.random() < 0.5;
  RES.psi = Math.atan2(o.ux, o.uz);
  RES.wx = o.ux;
  RES.wz = o.uz;
  finalParams('slump', RES.flip, _a);
  _a[0] = _a[2] = 0;
  _a[3] = RES.psi;
  const back = reachAlong(_a, o.ux, o.uz, pack);
  RES.p = Math.max(-0.3, Math.min(0.4, D[near] - back - 0.03));
  return RES;
}

function pick(o) {
  RES.kind = o.kind;
  RES.flip = o.flip;
  RES.scale = 1;
  return RES;
}

// 脱手的枪不能落进墙里，也不能悬在月台边外：rest 是根空间的落点，按需要往身体这边收
export function fitGun(root, rest, phys) {
  const P = root.position, yaw = root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
  const wx = rest.x * c + rest.z * s, wz = -rest.x * s + rest.z * c, L = Math.hypot(wx, wz);
  if (L < 0.2) return;
  let k = 1;
  _d.set(wx / L, 0, wz / L);
  _o.set(P.x, P.y + 0.25, P.z);
  const t = phys.rayDist(_o, _d, L + 0.25);
  if (t >= 0) k = Math.max(0.15, (t - 0.25) / L);
  if (P.y - phys.groundHeight(P.x + wx * k, P.z + wz * k, 0.1, P.y, EDGE) > EDGE) k *= 0.4;
  if (k < 1) { rest.x *= k; rest.z *= k; }
}
