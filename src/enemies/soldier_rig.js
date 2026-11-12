import * as THREE from 'three';
import { B, BONE_COUNT, createBones, bindInverses } from './soldier_skeleton.js';
import { buildSoldierAsset, attachSoldierMesh, VARIANTS } from './soldier_mesh.js';
import { Pose, euler } from './soldier_pose.js';
import { Gait } from './soldier_gait.js';
import { Upper } from './soldier_upper.js';
import { Death } from './soldier_death.js';
import { chooseFall, fitGun } from './soldier_fall.js';
import { HitVolumes, VOLUMES } from './soldier_hit.js';
import { GUN } from './soldier_gun.js';

// 人形敌人的骨架动画、命中体和对外接口。可见网格在 soldier_mesh.js 里，这里只认 attachSoldierMesh 的返回值。
// 坐标：根节点原点在脚底，root.rotation.y = 0 时面朝 -Z，正值左转，朝向向量 (-sin(yaw), 0, -cos(yaw))。

export const SOLDIER = { radius: 0.32, height: 1.82, eye: 1.62, crouchHeight: 1.25, crouchEye: 1.1 };
export const SOLDIER_VARIANTS = VARIANTS.length;

// 重：建所有变体的几何和材质，整局只调一次
export function createSoldierShared(mats) {
  return { asset: buildSoldierAsset(mats) };
}

const EYE = new THREE.Vector3(0, 0.065, -0.088);   // 相对 head 骨：两眼中点
const CHEST = new THREE.Vector3(0, 0.09, -0.03);   // 相对 spine2 骨：胸口中心
const MUZZLE = new THREE.Vector3(...GUN.muzzle);
const FORWARD = new THREE.Vector3(0, 0, -1);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();

export class SoldierRig {
  constructor(shared, variant = 0) {
    this.root = new THREE.Group();
    this.root.name = 'soldier';
    this.bones = createBones();
    this.root.add(this.bones[B.pelvis], this.bones[B.weapon]);
    this.skeleton = new THREE.Skeleton(this.bones, bindInverses());
    this.mesh = attachSoldierMesh(shared.asset, variant, this.skeleton, this.root);
    this.variant = variant;
    this.info = { tris: this.mesh.tris, drawCalls: this.mesh.drawCalls };
    this.state = { speed: 0, moveYaw: 0, aim: 0, aimPitch: 0, aimYaw: 0, crouch: 0 };
    this.s = { ...this.state };
    this.pose = new Pose();
    this.gait = new Gait();
    this.upper = new Upper();
    this.death = new Death();
    this.death.pack = !!VARIANTS[((variant % VARIANTS.length) + VARIANTS.length) % VARIANTS.length].pack;
    this.hits = new HitVolumes();
    this.pel = { yaw: 0, pitch: 0, roll: 0, runK: 0 };
    this.bounds = { center: new THREE.Vector3(), radius: 1.1 };
    this.muzzlePos = new THREE.Vector3(); this.muzzleDir = new THREE.Vector3(0, 0, -1);
    this.eye = new THREE.Vector3(); this.chest = new THREE.Vector3();
    this.gunPrev = new THREE.Vector3(); this.gunVel = new THREE.Vector3();
    this.prevPos = new THREE.Vector3(); this.hasPrev = false;
    this.visible = true;
    this.reset();
  }

  // 回到默认的活着的姿势（对象池复用）
  reset() {
    this.dead = false;
    this.deathDone = false;
    this.mesh.setDead(false);
    Object.assign(this.state, { speed: 0, moveYaw: 0, aim: 0, aimPitch: 0, aimYaw: 0, crouch: 0 });
    Object.assign(this.s, this.state);
    this.gait.reset();
    this.upper.reset();
    this.time = Math.random() * 100;
    this.bones[B.led].scale.setScalar(1);
    this.gunVel.set(0, 0, 0);
    this.hasPrev = false;
    this.prevYaw = null;
    this.update(0);
    this.gunPrev.copy(this.pose.weaponPos);
    // 复位后调用方才把根节点摆到出生点、转到出生朝向，下一帧的位移和转角不能算进步子里
    this.prevYaw = null;
    this.hasPrev = false;
  }

  setVisible(on) {
    this.visible = on;
    this.mesh.setVisible(on);
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.root.updateWorldMatrix(true, false);
    const pose = this.pose;
    if (this.dead) {
      if (!this.deathDone) {
        this.deathDone = this.death.update(dt, pose);
        this.applyBones();
      }
      this.refresh(false);
      return;
    }
    const yaw = this.root.rotation.y, dYaw = this.prevYaw == null ? 0 : wrap(yaw - this.prevYaw);
    this.prevYaw = yaw;
    // 根节点这一帧在根空间里的位移：支撑脚按它踩住地面。刚复位或一帧挪了 1 米以上（瞬移）不算
    const p = this.root.position;
    let mx = 0, mz = 0;
    if (this.hasPrev) {
      const ex = p.x - this.prevPos.x, ez = p.z - this.prevPos.z;
      if (ex * ex + ez * ez < 1) { const cy = Math.cos(yaw), sy = Math.sin(yaw); mx = ex * cy - ez * sy; mz = ex * sy + ez * cy; }
    }
    this.prevPos.copy(p);
    this.hasPrev = true;

    // 根节点真在动时步频按真实速度算：AI 的速度一跳变，平滑过的 state.speed 会落后，支撑脚就够不着、被拖着滑。
    // 原地踏步（预览页、被挡住）时用 state.speed
    const s = this.s, st = this.state, k20 = 1 - Math.exp(-dt * 20), moved = dt > 0 && (mx !== 0 || mz !== 0);
    s.speed += (clamp(moved ? Math.hypot(mx, mz) / dt : st.speed, 0, 7) - s.speed) * (moved ? k20 : 1 - Math.exp(-dt * 12));
    s.aim += clamp(clamp(st.aim, 0, 1) - s.aim, -dt * 4, dt * 4);
    s.crouch += clamp(clamp(st.crouch, 0, 1) - s.crouch, -dt * 3.5, dt * 3.5);
    s.aimYaw += (clamp(st.aimYaw, -0.9, 0.9) - s.aimYaw) * k20;
    s.aimPitch += (clamp(st.aimPitch, -0.9, 0.9) - s.aimPitch) * k20;
    s.moveYaw = wrap(s.moveYaw + wrap(st.moveYaw - s.moveYaw) * (1 - Math.exp(-dt * 8)));

    const g = this.gait, u = this.upper, pel = this.pel;
    g.update(dt, s, dYaw, this.time, mx, mz);
    u.step(dt, this.time, s.aim);
    pel.yaw = g.yaw + 0.25 * s.aimYaw;
    pel.pitch = g.pitch;
    pel.roll = g.roll + u.hips.x.z * 0.12;
    pel.runK = g.runK;
    euler(pose.local[B.pelvis], pel.pitch, pel.yaw, pel.roll);
    pose.pelvisPos.set(g.px, 0, g.pz);
    pose.place(B.pelvis);
    pose.pelvisPos.y = g.pelvisHeight(pose, g.py) - Math.max(0, u.hips.x.x) * 0.06;
    pose.place(B.pelvis);
    g.legs(pose);
    u.pose(pose, s, pel, this.time);
    this.applyBones();
    this.refresh(true);
    if (dt > 0) this.gunVel.subVectors(pose.weaponPos, this.gunPrev).divideScalar(dt);
    this.gunPrev.copy(pose.weaponPos);
  }

  applyBones() {
    const bones = this.bones, pose = this.pose;
    for (let i = 0; i < BONE_COUNT; i++) bones[i].quaternion.copy(pose.local[i]);
    bones[B.pelvis].position.copy(pose.pelvisPos);
    bones[B.weapon].position.copy(pose.weaponPos);
  }

  // 世界空间的缓存：命中体、包围球、枪口、眼睛、胸口
  refresh(alive) {
    const pose = this.pose, m = this.root.matrixWorld;
    if (alive) this.hits.update(pose, m);
    _c.copy(pose.P[B.pelvis]).add(pose.P[B.neck]).multiplyScalar(0.5);
    let r = 0;
    if (alive) {
      const L = this.hits.local;
      for (let i = 0; i < VOLUMES.length; i++) {
        for (let k = 0; k < 2; k++) {
          const o = i * 6 + k * 3;
          r = Math.max(r, Math.hypot(L[o] - _c.x, L[o + 1] - _c.y, L[o + 2] - _c.z) + VOLUMES[i].r);
        }
      }
    } else r = 1.4;
    this.bounds.center.copy(_c).applyMatrix4(m);
    this.bounds.radius = r;
    pose.point(B.weapon, MUZZLE, this.muzzlePos).applyMatrix4(m);
    this.root.getWorldQuaternion(_q);
    this.muzzleDir.copy(FORWARD).applyQuaternion(pose.Q[B.weapon]).applyQuaternion(_q);
    pose.point(B.head, EYE, this.eye).applyMatrix4(m);
    pose.point(B.spine2, CHEST, this.chest).applyMatrix4(m);
  }

  fire() {
    if (!this.dead) this.upper.fire();
  }

  // 世界方向 → 模型空间（子弹飞行方向）
  toLocal(dirWorld, out) {
    this.root.getWorldQuaternion(_q).invert();
    return out.copy(dirWorld).applyQuaternion(_q).normalize();
  }

  flinch(dirWorld, part) {
    if (this.dead) return;
    const d = this.toLocal(dirWorld, _v), last = this.hits.last >= 0 ? VOLUMES[this.hits.last] : null;
    this.upper.flinch(d, part, part === 'limb' && last ? last.leg : 0);
  }

  // 按中弹方向和部位挑死法：侧面来的打转倒，正面来的仰倒（爆头有时直接软倒），背后来的往前扑。
  // env：{ phys, others }（others 是别的尸体的位置），给了就按周围的墙、月台边改倒法（soldier_fall.js）
  die(dirWorld, part, env) {
    if (this.dead) return;
    this.mesh.setDead(true); // 尸体不带轮廓光
    const d = this.toLocal(dirWorld, _v);
    let kind, flip = Math.random() < 0.5;
    if (Math.abs(d.x) > 0.75 || (part === 'limb' && Math.random() < 0.3)) { kind = 'spin'; flip = d.x > 0; } else if (d.z > 0) kind = part === 'head' && Math.random() < 0.45 ? 'forward' : 'back';
    else kind = 'forward';
    let fit = null;
    if (env?.phys) {
      fit = chooseFall(this.root, kind, flip, this.death.pack, env.phys, env.others);
      kind = fit.kind;
      flip = fit.flip;
    }
    this.dead = true;
    this.deathDone = false;
    this.deathKind = kind;
    this.bones[B.led].scale.setScalar(0);
    _c.copy(this.gunVel).clampLength(0, 3);
    this.death.start(this.pose, kind, flip, _c, fit);
    if (env?.phys) fitGun(this.root, this.death.rest, env.phys);
  }

  getMuzzle(outPos, outDir) {
    outPos.copy(this.muzzlePos);
    if (outDir) outDir.copy(this.muzzleDir);
    return outPos;
  }

  getEye(out) { return out.copy(this.eye); }
  getChest(out) { return out.copy(this.chest); }

  // 射线对当前姿势的命中体；死了或隐藏时不算。返回 null 或 { dist, point, part }
  raycast(origin, dir, maxDist) {
    if (this.dead || !this.visible) return null;
    const b = this.bounds;
    _v.subVectors(b.center, origin);
    const t = _v.dot(dir);
    if (t < -b.radius || t - b.radius > maxDist) return null;
    if (_v.lengthSq() - t * t > b.radius * b.radius) return null;
    return this.hits.raycast(origin, dir, maxDist);
  }
}
