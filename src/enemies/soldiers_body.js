import * as THREE from 'three';

// 人形敌人的身体：优先用 soldier_rig.js（另一位同事在做的骨骼模型），
// 模块缺失或者抛错时退回这里的胶囊小人。两者接口一致，管理器不用分辨。
export const SOLDIER_DEFAULT = { radius: 0.32, height: 1.82, eye: 1.62, crouchHeight: 1.25, crouchEye: 1.1 };
const RIG_MODULE = './soldier_rig.js';

// 返回 { SOLDIER, createShared(mats), Rig, real }。先探一下文件在不在：开发服务器对不存在的路径回首页 HTML，
// 直接 import 会在控制台留一条模块加载错误
export async function loadBody() {
  const url = new URL(RIG_MODULE, import.meta.url).href;
  // 地址栏带 ?standin 强制用胶囊小人：排查是 AI 还是模型的问题
  if (typeof location !== 'undefined' && /[?&]standin\b/.test(location.search)) return standIn();
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok || !/javascript/.test(head.headers.get('content-type') || '')) throw new Error('soldier_rig.js 还没有');
    const mod = await import(/* @vite-ignore */ url);
    if (typeof mod.SoldierRig !== 'function' || typeof mod.createSoldierShared !== 'function') throw new Error('soldier_rig.js 接口不全');
    return { SOLDIER: { ...SOLDIER_DEFAULT, ...mod.SOLDIER }, createShared: mod.createSoldierShared, Rig: mod.SoldierRig, variants: mod.SOLDIER_VARIANTS || 0, real: true };
  } catch (e) {
    console.info('[soldiers] 用胶囊占位小人：', e?.message || e);
    return standIn();
  }
}

export function standIn() {
  return { SOLDIER: SOLDIER_DEFAULT, createShared: createStandInShared, Rig: StandInRig, variants: 2, real: false };
}

function createStandInShared(mats) {
  const paint = (c, o) => mats?.paint?.(c, o) || new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  return {
    cloth: paint(0x3e4536, { wear: 0.1, dirt: 0.7, rough: 0.85 }),
    vest: paint(0x2a2d28, { wear: 0.2, dirt: 0.6, rough: 0.75 }),
    skin: paint(0x7a5c48, { wear: 0, dirt: 0.3, rough: 0.7 }),
    gun: mats?.steelDark || paint(0x1d1f21, { wear: 0.3, dirt: 0.4, rough: 0.5 }),
    leg: new THREE.CapsuleGeometry(0.085, 0.72, 4, 8).translate(0, -0.44, 0),
    torso: new THREE.CapsuleGeometry(0.17, 0.4, 4, 10),
    head: new THREE.SphereGeometry(0.115, 12, 10),
    gunGeo: new THREE.BoxGeometry(0.06, 0.09, 0.78),
  };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4();
const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

// 射线与胶囊（线段 a→b，半径 r）求交，返回距离或 Infinity。d 是单位向量
export function rayCapsule(o, d, a, b, r, maxDist) {
  // 先求射线与轴线最近的那一点，再以它为球心解球面：精度够命中判定用
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, uu = ux * ux + uy * uy + uz * uz || 1e-9;
  const wx = o.x - a.x, wy = o.y - a.y, wz = o.z - a.z;
  const du = d.x * ux + d.y * uy + d.z * uz, wu = wx * ux + wy * uy + wz * uz, dw = d.x * wx + d.y * wy + d.z * wz;
  const den = uu - du * du;
  let t = den > 1e-9 ? (du * wu - uu * dw) / den : -dw;
  t = Math.max(0, Math.min(maxDist, t));
  const s = Math.max(0, Math.min(1, (wu + du * t) / uu));
  const cx = a.x + ux * s, cy = a.y + uy * s, cz = a.z + uz * s;
  // 以最近的轴上点为球心解射线与球
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const bq = ox * d.x + oy * d.y + oz * d.z, cq = ox * ox + oy * oy + oz * oz - r * r, disc = bq * bq - cq;
  if (disc < 0) return Infinity;
  const hit = -bq - Math.sqrt(disc);
  return hit >= 0 && hit <= maxDist ? hit : cq < 0 ? 0 : Infinity;
}

// 胶囊小人：没有骨骼模型时顶上，接口照 soldier_rig.js 的约定
export class StandInRig {
  constructor(shared, variant = 0) {
    const S = shared;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.upper = new THREE.Group();
    this.arms = new THREE.Group();
    this.root.add(this.body);
    this.body.add(this.upper);
    const mesh = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = true; return o; };
    this.legs = [-1, 1].map((sx) => {
      const leg = mesh(S.leg, S.cloth);
      leg.position.set(sx * 0.1, 0.94, 0);
      this.body.add(leg);
      return leg;
    });
    this.torso = mesh(S.torso, variant % 2 ? S.vest : S.cloth);
    this.torso.position.set(0, 1.22, 0);
    this.head = mesh(S.head, S.skin);
    this.head.position.set(0, 1.62, 0);
    this.arms.position.set(0, 1.4, 0);
    this.gun = mesh(S.gunGeo, S.gun);
    this.gun.position.set(0.13, -0.03, -0.3);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.01, -0.4);
    this.gun.add(this.muzzle);
    this.arms.add(this.gun);
    this.upper.add(this.torso, this.head, this.arms);
    this.state = { speed: 0, moveYaw: 0, aim: 0, aimPitch: 0, aimYaw: 0, crouch: 0 };
    this.bounds = { center: new THREE.Vector3(), radius: 1.15 };
    this.result = { dist: 0, point: new THREE.Vector3(), part: 'torso' };
    this.reset();
  }

  reset() {
    this.dead = false;
    this.deathDone = false;
    this.deathT = 0;
    this.phase = 0;
    this.kick = 0;
    this.recoil = 0;
    this.fallX = 0;
    this.fallZ = 1;
    this.body.rotation.set(0, 0, 0);
    for (const k in this.state) this.state[k] = 0;
  }

  setVisible(on) { this.root.visible = on; }
  fire() { this.recoil = 1; }

  flinch(dir) {
    this.kick = 1;
    if (dir) this.kickDir = Math.sign(this.localZ(dir)) || 1;
  }

  die(dir) {
    this.dead = true;
    this.deathT = 0;
    if (dir) {
      const yaw = this.root.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
      // 子弹方向转到模型局部：往子弹飞的方向倒
      this.fallX = dir.x * c - dir.z * s;
      this.fallZ = dir.x * s + dir.z * c;
      const l = Math.hypot(this.fallX, this.fallZ) || 1;
      this.fallX /= l; this.fallZ /= l;
    }
  }

  localZ(dir) {
    const yaw = this.root.rotation.y;
    return dir.x * Math.sin(yaw) + dir.z * Math.cos(yaw);
  }

  update(dt) {
    const st = this.state, c = Math.min(1, Math.max(0, st.crouch));
    this.kick = Math.max(0, this.kick - dt * 5);
    this.recoil = Math.max(0, this.recoil - dt * 14);
    if (this.dead) {
      this.deathT = Math.min(1, this.deathT + dt * 1.8);
      const t = this.deathT * this.deathT, a = t * Math.PI * 0.49;
      this.body.rotation.set(a * this.fallZ, 0, -a * this.fallX);
      if (this.deathT >= 1) this.deathDone = true;
    } else {
      const sp = Math.min(1, st.speed / 3);
      this.phase += dt * (2 + st.speed * 2.2);
      const swing = Math.sin(this.phase) * 0.55 * sp, back = Math.cos(wrap(st.moveYaw)) < -0.3 ? -1 : 1;
      // 蹲下：胯跟着上身一起降，腿按比例缩短，脚始终在地上
      const hip = 0.94 - 0.52 * c;
      for (const leg of this.legs) { leg.position.y = hip; leg.scale.y = hip / 0.94; }
      this.legs[0].rotation.x = swing * back - c * 0.35;
      this.legs[1].rotation.x = -swing * back + c * 0.25;
      this.upper.position.y = -0.52 * c;
      this.upper.rotation.x = -0.25 * this.kick * (this.kickDir || 1);
      this.upper.rotation.y = Math.max(-0.9, Math.min(0.9, st.aimYaw)) * 0.7;
      this.arms.rotation.y = Math.max(-0.9, Math.min(0.9, st.aimYaw)) * 0.3;
      this.arms.rotation.x = Math.max(-0.9, Math.min(0.9, st.aimPitch)) - (1 - st.aim) * 0.7 + this.recoil * 0.06;
      this.gun.position.z = -0.3 + this.recoil * 0.04;
    }
    this.root.updateMatrixWorld(true);
    this.bounds.center.set(0, 0.95 - 0.3 * c, 0).applyMatrix4(this.root.matrixWorld);
  }

  getMuzzle(outPos, outDir) {
    const e = this.muzzle.matrixWorld.elements;
    outPos.set(e[12], e[13], e[14]);
    outDir?.set(-e[8], -e[9], -e[10]).normalize();
    return outPos;
  }

  getEye(out) {
    return out.setFromMatrixPosition(this.head.matrixWorld);
  }

  getChest(out) {
    return out.setFromMatrixPosition(this.torso.matrixWorld);
  }

  raycast(o, d, maxDist) {
    if (this.dead) return null;
    let best = maxDist, part = null;
    const head = _a.setFromMatrixPosition(this.head.matrixWorld);
    const ox = o.x - head.x, oy = o.y - head.y, oz = o.z - head.z;
    const bq = ox * d.x + oy * d.y + oz * d.z, disc = bq * bq - (ox * ox + oy * oy + oz * oz - 0.13 * 0.13);
    if (disc >= 0) {
      const t = -bq - Math.sqrt(disc);
      if (t >= 0 && t < best) { best = t; part = 'head'; }
    }
    // 躯干：胸口到胯；腿：胯到脚（两条腿并成一根粗胶囊）
    _m.copy(this.torso.matrixWorld);
    _a.set(0, 0.24, 0).applyMatrix4(_m);
    _b.set(0, -0.3, 0).applyMatrix4(_m);
    let t = rayCapsule(o, d, _a, _b, 0.2, best);
    if (t < best) { best = t; part = 'torso'; }
    _a.copy(_b);
    _b.set(0, 0.08, 0).applyMatrix4(this.root.matrixWorld);
    t = rayCapsule(o, d, _a, _b, 0.17, best);
    if (t < best) { best = t; part = 'limb'; }
    if (!part) return null;
    const r = this.result;
    r.dist = best;
    r.point.copy(o).addScaledVector(d, best);
    r.part = part;
    return r;
  }
}
