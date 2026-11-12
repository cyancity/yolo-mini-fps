import * as THREE from 'three';

// 空仓换弹甩掉的旧弹匣：世界里的道具，池子固定 CAP 个，启动时建好。
// 只和地面、碰撞体顶面碰：落地弹一下，第二次着地就侧躺下来，停 REST 秒后缩没。
// 材质用场景里已经在画的现成材质，同一份着色器程序，第一次掉弹匣不现编
const CAP = 4, G = 9.81, REST = 5, FADE = 0.4, SETTLE_T = 0.14;
// 第一次落地的反弹：竖直速度留这么多，水平速度留这么多；落地速度低于 CALM 直接躺下，不再弹
const BOUNCE = 0.32, SKID = 0.55, CALM = 0.9;
const FREE = 0, FLY = 1, SETTLE = 2, LIE = 3, FADING = 4;

const _p = new THREE.Vector3(), _a = new THREE.Vector3(), _q = new THREE.Quaternion();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _probe = { x: 0, z: 0 };

export class MagDrops {
  constructor(scene, phys, material) {
    this.scene = scene;
    this.phys = phys;
    this.material = material;
    this.items = [];
    this.corners = [];
    this.half = 0.013; // 侧躺时弹匣中面离地的高度（半个厚度）
    this.cursor = 0;
    this.active = 0;
    this.onBounce = null; // (pos, speed) => void：第一次落地；pos 每个弹匣一份，对方短时间留着引用也不会被别的改掉
  }

  // 弹匣外形（弹匣自己的坐标：原点在匣口顶面中心，-Y 是抽出方向），武器在启动时给
  setShape(geometry) {
    geometry.computeBoundingBox();
    const b = geometry.boundingBox;
    this.half = (b.max.x - b.min.x) / 2;
    this.corners = [];
    for (let i = 0; i < 8; i++) {
      this.corners.push(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
    }
    if (this.items.length) {
      for (const it of this.items) it.mesh.geometry = geometry;
      return;
    }
    for (let i = 0; i < CAP; i++) {
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = 'fx.mag';
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.items.push({ mesh, state: FREE, v: new THREE.Vector3(), w: new THREE.Vector3(), rest: new THREE.Quaternion(), hit: new THREE.Vector3(), t: 0, hits: 0, gy: 0, fresh: false });
    }
  }

  // pos、quat：弹匣原点的世界位姿；vel：速度；spin：角速度（弧度/秒，世界坐标）
  spawn(pos, quat, vel, spin) {
    if (!this.items.length) return;
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    if (it.state === FREE) this.active++;
    it.mesh.position.copy(pos);
    it.mesh.quaternion.copy(quat);
    it.mesh.scale.setScalar(1);
    it.mesh.visible = true;
    it.v.copy(vel);
    it.w.copy(spin);
    it.state = FLY;
    it.hits = 0;
    it.t = 0;
    // 生成的这一帧不动：和第一人称里的弹匣在同一个位置交接，不会先跳一截
    it.fresh = true;
  }

  // 八个包围盒角里最低的那个（世界坐标），写进 out，返回它的 y
  lowest(mesh, out) {
    let low = Infinity;
    for (const c of this.corners) {
      _a.copy(c).applyQuaternion(mesh.quaternion).add(mesh.position);
      if (_a.y < low) { low = _a.y; out.copy(_a); }
    }
    return low;
  }

  update(dt) {
    if (this.active === 0) return;
    let active = 0;
    for (const it of this.items) {
      if (it.state === FREE) continue;
      active++;
      if (it.fresh) { it.fresh = false; continue; }
      const m = it.mesh;
      if (it.state === LIE) {
        it.t -= dt;
        if (it.t <= 0) { it.state = FADING; it.t = FADE; }
      } else if (it.state === FADING) {
        it.t -= dt;
        m.scale.setScalar(Math.max(0, it.t / FADE));
        if (it.t <= 0) { it.state = FREE; m.visible = false; active--; }
      } else if (it.state === SETTLE) {
        // 躺平：转到侧面朝下，中面落到离地半个厚度，同时滑一小段
        const k = 1 - Math.exp(-dt * 30), f = Math.exp(-dt * 8);
        m.quaternion.slerp(it.rest, k);
        m.position.y += (it.gy + this.half - m.position.y) * k;
        it.v.x *= f;
        it.v.z *= f;
        m.position.x += it.v.x * dt;
        m.position.z += it.v.z * dt;
        it.t -= dt;
        if (it.t <= 0) {
          m.quaternion.copy(it.rest);
          m.position.y = it.gy + this.half;
          it.state = LIE;
          it.t = REST;
        }
      } else this.fly(it, dt);
    }
    this.active = active;
  }

  fly(it, dt) {
    const m = it.mesh, phys = this.phys;
    const prevLow = this.lowest(m, _p);
    it.v.y -= G * dt;
    m.position.addScaledVector(it.v, dt);
    const w = it.w.length();
    if (w > 1e-3) m.quaternion.premultiply(_q.setFromAxisAngle(_a.copy(it.w).divideScalar(w), w * dt)).normalize();
    const low = this.lowest(m, _p);
    const ground = phys ? phys.groundHeight(_p.x, _p.z, 0.03, prevLow, 0.03) : 0;
    if (low < ground && it.v.y < 0) {
      m.position.y += ground - low;
      const vy = -it.v.y;
      if (++it.hits === 1) this.onBounce?.(it.hit.set(_p.x, ground, _p.z), vy);
      if (it.hits >= 2 || vy < CALM) {
        this.lieDown(it, ground);
        return;
      }
      it.v.y = vy * BOUNCE;
      it.v.x *= SKID;
      it.v.z *= SKID;
      // 磕地以后换一个翻滚方向，转速减半
      it.w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(w * 0.5 + 3);
    } else if (phys) {
      // 墙：只把中心推出来，速度的法向分量反向减半
      _probe.x = m.position.x;
      _probe.z = m.position.z;
      if (phys.resolve(_probe, 0.04, m.position.y - 0.1, m.position.y, 0)) {
        const nx = _probe.x - m.position.x, nz = _probe.z - m.position.z, nl = Math.hypot(nx, nz);
        if (nl > 1e-6) {
          const vn = (it.v.x * nx + it.v.z * nz) / nl;
          if (vn < 0) { it.v.x -= 1.5 * vn * nx / nl; it.v.z -= 1.5 * vn * nz / nl; }
        }
        m.position.x = _probe.x;
        m.position.z = _probe.z;
      }
    }
  }

  // 侧躺的朝向：长轴（本地 Y）沿它现在的水平投影，厚度方向（本地 X）竖直，朝上朝下取离现在近的那边
  lieDown(it, ground) {
    const q = it.mesh.quaternion;
    _y.set(0, 1, 0).applyQuaternion(q).setY(0);
    if (_y.lengthSq() < 1e-6) _y.set(0, 0, 1).applyQuaternion(q).setY(0);
    if (_y.lengthSq() < 1e-6) _y.set(0, 0, 1);
    _y.normalize();
    _x.set(1, 0, 0).applyQuaternion(q);
    _x.set(0, _x.y >= 0 ? 1 : -1, 0);
    _z.crossVectors(_x, _y);
    it.rest.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    it.gy = ground;
    it.v.y = 0;
    it.state = SETTLE;
    it.t = SETTLE_T;
  }

  clear() {
    for (const it of this.items) {
      it.state = FREE;
      it.mesh.visible = false;
    }
    this.active = 0;
  }
}
