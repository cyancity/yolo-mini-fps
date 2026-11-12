import * as THREE from 'three';
import { buildPlateGeometry, buildBaseGeometry, plateHit, HINGE_Y, HINGE_Z, PLATE_T, PLATE_CY, PLATE_R, TILT_DOWN } from './target_model.js';
import { targetMaterial, createTargetData, CHIPS, PAINT } from './target_mat.js';
import { FIRE, LAYOUT, RAIL_H, RAIL_HALF, buildProps } from './target_layout.js';
import { stepTarget, DOWN_TIME, POP_TIME, MOVE_SPEED } from './target_motion.js';

const HP = 100, HEAD_MUL = 4;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
const PIVOT = new THREE.Vector3(0, HINGE_Y, HINGE_Z);
const MISS = Object.freeze({ killed: false, headshot: false });
const IMPACT = Object.freeze({ decal: false });
const NOOP = () => {};
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _l = new THREE.Vector3(), _n = new THREE.Vector3(), _p = new THREE.Vector3();
const _qy = new THREE.Quaternion(), _qx = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _m = new THREE.Matrix4();

// 练习场：没有敌人，只有钢靶。固定靶、移动靶、起倒靶三种，接口和敌人组一样（raycast / hit），
// 武器不用区分打的是人还是靶。全部启动时建好：两个实例化网格（靶板、底座）加三个静态网格（两种涂装钢的轨道和挡板、距离牌），
// 一共 5 个 draw call、约 1.1 万个三角形。layout 和 fire 只给预览页换场地用，游戏里用默认的堆场布置
export class TargetRange {
  constructor({ scene, phys, mats, fx, audio, level, layout = LAYOUT, fire = FIRE }) {
    Object.assign(this, { scene, phys, fx, audio, level, fire });
    this.kind = 'target';
    this.onKill = null; // (target, { headshot, part, dist }) => void
    // hits 每次命中都算（含刀），kills 击倒数，headshots 爆头击倒数
    this.stats = { hits: 0, kills: 0, headshots: 0 };
    this.active = false;
    this.time = 0;
    this.player = null;
    this.popAt = 0;
    this.lastPop = null;
    this.targets = layout.map((o, i) => this.makeTarget(o, i));
    const n = this.targets.length;
    this.data = createTargetData(n);
    this.material = targetMaterial(mats, this.data.tex);
    this.root = new THREE.Group();
    this.root.name = 'targets';
    this.plates = new THREE.InstancedMesh(buildPlateGeometry(), this.material, n);
    this.bases = new THREE.InstancedMesh(buildBaseGeometry(), this.material, n);
    for (const m of [this.plates, this.bases]) {
      m.castShadow = m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(m);
    }
    this.props = buildProps(this.root, mats, this.targets);
    scene.add(this.root);
    this.reset();
    // 包围球一次算好：放大一圈把横移和倒下都包进去，之后不再重算
    for (const m of [this.plates, this.bases]) {
      m.computeBoundingSphere();
      m.boundingSphere.radius += 3;
    }
    this.warmUp();
  }

  makeTarget(o, index) {
    const dx = this.fire.x - o.x, dz = this.fire.z - o.z, yaw = Math.atan2(dx, dz);
    const ground = this.phys ? this.phys.groundHeight(o.x, o.z, 0.05, 3, 0) : 0;
    return {
      index, type: o.type, paint: PAINT[o.type] ?? 0, yaw, ground, dist: Math.hypot(dx, dz),
      origin: new THREE.Vector3(o.x, ground, o.z),
      base: new THREE.Vector3(o.x, ground + (o.type === 'mover' ? RAIL_H : 0), o.z),
      ax: Math.cos(yaw), az: -Math.sin(yaw), // 横移方向（局部 x）
      center: new THREE.Vector3(), // 靶面中心的世界坐标，射线粗筛用
      mat: new THREE.Matrix4(), inv: new THREE.Matrix4(),
      hp: HP, alive: true, state: 'up', timer: 0,
      tilt: 0, tiltV: 0, rock: 0, rockV: 0, twist: 0, twistV: 0,
      s: 0, v: 0, vt: MOVE_SPEED, chip: 0, flash: 0,
    };
  }

  get aliveCount() {
    let n = 0;
    for (const t of this.targets) if (t.alive) n++;
    return n;
  }

  // 第一次进练习场不卡：开局前先缩成一个点藏在地面下渲一帧，着色器在菜单里就编译好
  warmUp() {
    const meshes = [this.plates, this.bases, ...this.props], seen = new Set();
    this.warm = true;
    this.root.scale.setScalar(1e-4);
    this.root.position.set(1, -0.3, -9);
    this.root.visible = true;
    for (const m of meshes) {
      m.onAfterRender = () => {
        seen.add(m);
        if (seen.size === meshes.length) this.endWarm();
      };
    }
  }

  endWarm() {
    if (!this.warm) return;
    this.warm = false;
    for (const m of [this.plates, this.bases, ...this.props]) m.onAfterRender = NOOP;
    this.root.scale.setScalar(1);
    this.root.position.set(0, 0, 0);
    this.root.visible = this.active;
  }

  setActive(on) {
    this.active = !!on;
    if (this.active) this.endWarm();
    if (!this.warm) this.root.visible = this.active;
  }

  reset() {
    const s = this.stats;
    s.hits = s.kills = s.headshots = 0;
    this.data.data.fill(0);
    for (const t of this.targets) {
      const pop = t.type === 'popup';
      t.hp = HP;
      t.alive = !pop;
      t.state = pop ? 'down' : 'up';
      t.timer = 0;
      t.tilt = pop ? TILT_DOWN : 0;
      t.tiltV = t.rock = t.rockV = t.twist = t.twistV = 0;
      t.s = t.type === 'mover' ? (Math.random() * 2 - 1) * RAIL_HALF * 0.7 : 0;
      t.v = 0;
      t.vt = Math.random() < 0.5 ? -MOVE_SPEED : MOVE_SPEED;
      t.chip = 0;
      t.flash = 0;
      this.writeInfo(t);
      this.pose(t);
    }
    this.data.tex.needsUpdate = true;
    this.plates.instanceMatrix.needsUpdate = this.bases.instanceMatrix.needsUpdate = true;
    this.popAt = this.time + 2;
    this.lastPop = null;
  }

  update(dt, player) {
    if (!this.active || !(dt > 0)) return;
    this.player = player;
    this.time += dt;
    let dirty = false;
    for (const t of this.targets) {
      stepTarget(t, dt);
      if (t.type === 'popup') {
        if ((t.state === 'up' || t.state === 'rise') && t.timer >= POP_TIME) this.drop(t);
      } else if (t.state === 'down' && t.timer >= DOWN_TIME) this.raise(t);
      if (t.flash > 0) {
        t.flash = Math.max(0, t.flash - dt * 8);
        this.writeInfo(t);
        dirty = true;
      }
      this.pose(t);
    }
    this.schedulePopups();
    if (dirty) this.data.tex.needsUpdate = true;
    this.plates.instanceMatrix.needsUpdate = this.bases.instanceMatrix.needsUpdate = true;
  }

  // 起倒靶一次只立一块，随机挑（尽量不连着挑同一块）
  schedulePopups() {
    if (this.time < this.popAt) return;
    let pick = null, n = 0;
    for (const t of this.targets) {
      if (t.type !== 'popup') continue;
      if (t.state !== 'down') return;
      if (t !== this.lastPop && Math.random() * ++n < 1) pick = t;
    }
    pick ??= this.lastPop;
    if (!pick) return;
    this.lastPop = pick;
    this.raise(pick);
  }

  raise(t) {
    t.state = 'rise';
    t.timer = 0;
    t.hp = HP;
    // 倒地复位和起倒靶弹出都走这里；开局的 reset() 不走，不会一下子响一片
    this.audio?.play?.('targetReset', { position: t.center.clone(), volume: 0.9 });
  }

  // 起倒靶没打中、时间到了：自己倒回去，不算击杀
  drop(t) {
    t.state = 'fall';
    t.alive = false;
    t.timer = 0;
    t.tiltV = Math.max(t.tiltV, 1.6);
    this.popAt = this.time + 1.4 + Math.random() * 1.4;
  }

  knockDown(t, head) {
    t.state = 'fall';
    t.alive = false;
    t.timer = 0;
    t.tiltV = Math.max(0, t.tiltV) + (head ? 3 : 2.2);
    if (t.type === 'popup') this.popAt = this.time + 1.4 + Math.random() * 1.4;
  }

  // 底座和靶板的矩阵。靶板绕铰链（PIVOT）先扭再后仰：M = 底座 · T(P) · Rx · Ry · T(-P)
  pose(t) {
    if (t.type === 'mover') t.base.set(t.origin.x + t.ax * t.s, t.ground + RAIL_H, t.origin.z + t.az * t.s);
    _qy.setFromAxisAngle(Y, t.yaw);
    _m.compose(t.base, _qy, ONE);
    this.bases.setMatrixAt(t.index, _m);
    _qx.setFromAxisAngle(X, -(t.tilt + t.rock));
    _qt.setFromAxisAngle(Y, t.twist);
    _qx.multiply(_qt);
    _p.copy(PIVOT).applyQuaternion(_qx);
    _p.subVectors(PIVOT, _p).applyQuaternion(_qy).add(t.base);
    _qx.premultiply(_qy);
    t.mat.compose(_p, _qx, ONE);
    t.inv.copy(t.mat).invert();
    this.plates.setMatrixAt(t.index, t.mat);
    t.center.set(0, PLATE_CY, 0).applyMatrix4(t.mat);
  }

  writeInfo(t) {
    const o = t.index * this.data.W * 4, d = this.data.data;
    d[o] = t.flash;
    d[o + 1] = t.paint;
  }

  // 掉漆点记在靶板局部坐标里，跟着靶板摇、倒、横移
  addChip(t, x, y, size) {
    const o = (t.index * this.data.W + 1 + (t.chip++ % CHIPS)) * 4, d = this.data.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = size;
    d[o + 3] = Math.random();
  }

  // 射线对两块靶板的真实形状求交：先用靶面中心的球粗筛，再换到靶板局部坐标和板面求交
  raycast(origin, dir, maxDist = 500) {
    if (!this.active) return null;
    let best = null, bd = maxDist, part = null;
    for (const t of this.targets) {
      if (!t.alive) continue;
      const c = t.center;
      const wx = c.x - origin.x, wy = c.y - origin.y, wz = c.z - origin.z;
      const along = wx * dir.x + wy * dir.y + wz * dir.z;
      if (along < -PLATE_R || along - PLATE_R > bd) continue;
      if (wx * wx + wy * wy + wz * wz - along * along > PLATE_R * PLATE_R) continue;
      _o.copy(origin).applyMatrix4(t.inv);
      _d.copy(dir).transformDirection(t.inv);
      if (Math.abs(_d.z) < 1e-5) continue;
      // 从正面来打正面，从背后来打背面
      const s = ((_d.z < 0 ? PLATE_T : -PLATE_T) * 0.5 - _o.z) / _d.z;
      if (s < 0 || s >= bd) continue;
      const p = plateHit(_o.x + _d.x * s, _o.y + _d.y * s);
      if (!p) continue;
      best = t;
      bd = s;
      part = p;
    }
    if (!best) return null;
    return { target: best, dist: bd, part, point: new THREE.Vector3().copy(origin).addScaledVector(dir, bd) };
  }

  // 结算一次命中：头 ×4、躯干 ×1，100 血。返回 { killed, headshot }
  hit(target, damage, point, dir, part = 'torso') {
    const t = target;
    if (!this.active || !t || !t.alive) return MISS;
    const head = part === 'head';
    const dmg = damage * (head ? HEAD_MUL : 1);
    this.stats.hits++;
    _l.copy(point).applyMatrix4(t.inv);
    this.addChip(t, _l.x, _l.y, head ? 0.022 : 0.027);
    // 火花朝射手那一面喷
    const e = t.mat.elements;
    _n.set(e[8], e[9], e[10]);
    if (dir && _n.dot(dir) > 0) _n.negate();
    this.fx?.impact?.(point, _n, 'metal', IMPACT);
    this.audio?.play?.('targetHit', { position: point, volume: head ? 1 : 0.85 });
    // 打得越高越往后仰，打偏一侧就往那边扭
    const k = Math.min(dmg, 60);
    t.rockV += 0.055 * k * Math.max(0.3, _l.y - HINGE_Y);
    t.twistV += 0.3 * k * _l.x;
    t.flash = 1;
    this.writeInfo(t);
    this.data.tex.needsUpdate = true;
    t.hp -= dmg;
    if (t.hp > 0) return { killed: false, headshot: head };
    this.knockDown(t, head);
    // headshots 记的是爆头击倒数：HUD 的爆头率 = headshots / kills
    this.stats.kills++;
    if (head) this.stats.headshots++;
    this.audio?.play?.('targetDown', { position: t.center.clone(), volume: 1 });
    const from = this.player?.eye || this.player?.position;
    this.onKill?.(t, { headshot: head, part: head ? 'head' : 'torso', dist: from ? from.distanceTo(point) : t.dist });
    return { killed: true, headshot: head };
  }
}
