import * as THREE from 'three';

const S = 22;
const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, QX = 6, QY = 7, QZ = 8, QW = 9,
  WX = 10, WY = 11, WZ = 12, STATE = 13, TIMER = 14, HIT = 15, SCALE = 16, TY = 17, GY = 18;
const FREE = 0, FLY = 1, SETTLE = 2, REST = 3, FADE = 4;
const RADIUS = 0.0048;
const HALF_LEN = 0.0215;
const REST_TIME = 6;

const _q = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _probe = { x: 0, z: 0 };
const UP = new THREE.Vector3(0, 1, 0);

// 5.56 弹壳：底缘、抽壳槽、锥形壳体、肩部收口、壳口内壁。轴线沿本地 Z，壳口朝 -Z（枪口方向）。
function casingGeometry() {
  const pts = [
    [0, 0.0004], [0.0021, 0.0004], [0.0023, 0], [0.0042, 0], [0.00475, 0.0005], [0.00475, 0.0013],
    [0.0041, 0.0017], [0.0041, 0.0025], [0.00475, 0.0032], [0.0045, 0.0362], [0.0032, 0.0398],
    [0.0032, 0.045], [0.0027, 0.045], [0.0027, 0.039],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 14);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, 0.0225);
  return geo;
}

// 抛出的弹壳：InstancedMesh 环形复用。只和地面、碰撞体顶面、墙面做简单反弹。
export class Shells {
  constructor(scene, phys, cap = 40) {
    this.cap = cap;
    this.phys = phys;
    this.data = new Float32Array(cap * S);
    this.cursor = 0;
    this.used = 0;
    this.active = 0;
    this.onBounce = null; // (pos, speed) => void，第一次落地；speed 是落地瞬间的下落速度
    // 回调拿到的向量轮流复用这几个，对方短时间内留着引用也不会被下一发改掉
    this.hitPos = Array.from({ length: 8 }, () => new THREE.Vector3());
    this.hitCursor = 0;
    const mat = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 1, roughness: 0.28 });
    const mesh = new THREE.InstancedMesh(casingGeometry(), mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    this.mesh = mesh;
  }

  spawn(pos, vel, quat) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.cap;
    if (i >= this.used) this.used = i + 1;
    const d = this.data, o = i * S;
    d[o + PX] = pos.x; d[o + PY] = pos.y; d[o + PZ] = pos.z;
    d[o + VX] = vel.x; d[o + VY] = vel.y; d[o + VZ] = vel.z;
    if (quat) { d[o + QX] = quat.x; d[o + QY] = quat.y; d[o + QZ] = quat.z; d[o + QW] = quat.w; }
    else { d[o + QX] = 0; d[o + QY] = 0; d[o + QZ] = 0; d[o + QW] = 1; }
    this.spin(o, 22 + Math.random() * 26);
    d[o + STATE] = FLY; d[o + TIMER] = 0; d[o + HIT] = 0; d[o + SCALE] = 1;
    this.mesh.count = this.used;
    this.write(i);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.active++;
  }

  // 随机翻滚轴，角速度 w（弧度/秒）
  spin(o, w) {
    const d = this.data;
    const a = Math.random() * Math.PI * 2, z = Math.random() * 2 - 1, r = Math.sqrt(1 - z * z);
    d[o + WX] = Math.cos(a) * r * w; d[o + WY] = z * w; d[o + WZ] = Math.sin(a) * r * w;
  }

  write(i) {
    const d = this.data, o = i * S;
    _pos.set(d[o + PX], d[o + PY], d[o + PZ]);
    _q.set(d[o + QX], d[o + QY], d[o + QZ], d[o + QW]);
    _scl.setScalar(d[o + SCALE]);
    _m.compose(_pos, _q, _scl);
    _m.toArray(this.mesh.instanceMatrix.array, i * 16);
  }

  update(dt) {
    if (this.active === 0) return;
    const d = this.data, phys = this.phys;
    let active = 0, moved = false;
    for (let i = 0; i < this.used; i++) {
      const o = i * S, state = d[o + STATE];
      if (state === FREE) continue;
      active++;
      if (state === REST) {
        d[o + TIMER] -= dt;
        if (d[o + TIMER] <= 0) { d[o + STATE] = FADE; d[o + TIMER] = 0.3; }
        continue;
      }
      moved = true;
      if (state === FADE) {
        d[o + TIMER] -= dt;
        d[o + SCALE] = Math.max(d[o + TIMER] / 0.3, 0);
        if (d[o + TIMER] <= 0) { d[o + STATE] = FREE; d[o + SCALE] = 0; }
        this.write(i);
        continue;
      }
      _q.set(d[o + QX], d[o + QY], d[o + QZ], d[o + QW]);
      if (state === SETTLE) {
        // 躺平：轴线转到水平，同时滑行一小段
        _dq.setFromAxisAngle(UP, d[o + TY]);
        _q.slerp(_dq, 1 - Math.exp(-dt * 28));
        const f = Math.exp(-dt * 9);
        d[o + VX] *= f; d[o + VZ] *= f;
        d[o + PX] += d[o + VX] * dt; d[o + PZ] += d[o + VZ] * dt;
        d[o + PY] = d[o + GY] + RADIUS + Math.abs(2 * (_q.y * _q.z - _q.w * _q.x)) * HALF_LEN;
        d[o + TIMER] -= dt;
        if (d[o + TIMER] <= 0) { d[o + STATE] = REST; d[o + TIMER] = REST_TIME + Math.random() * 2; }
      } else {
        const prevY = d[o + PY];
        d[o + VY] -= 9.81 * dt;
        d[o + PX] += d[o + VX] * dt; d[o + PY] += d[o + VY] * dt; d[o + PZ] += d[o + VZ] * dt;
        const w = Math.hypot(d[o + WX], d[o + WY], d[o + WZ]);
        if (w > 1e-3) {
          _dq.setFromAxisAngle(_axis.set(d[o + WX] / w, d[o + WY] / w, d[o + WZ] / w), w * dt);
          _q.premultiply(_dq).normalize();
        }
        // 先判地面再判墙：否则刚穿进顶面的那一帧会被当成撞到侧面，横向弹飞
        const ground = phys ? phys.groundHeight(d[o + PX], d[o + PZ], 0.01, prevY, 0.006) : 0;
        // 竖着落地时离地更高：接触半径随轴线的竖直分量变
        const reach = RADIUS + Math.abs(2 * (_q.y * _q.z - _q.w * _q.x)) * HALF_LEN;
        if (d[o + PY] - reach < ground && d[o + VY] < 0) {
          d[o + PY] = ground + reach;
          d[o + GY] = ground;
          const vy = -d[o + VY];
          if (d[o + HIT] === 0) {
            d[o + HIT] = 1;
            if (this.onBounce) {
              const hp = this.hitPos[this.hitCursor];
              this.hitCursor = (this.hitCursor + 1) % this.hitPos.length;
              this.onBounce(hp.set(d[o + PX], ground, d[o + PZ]), vy);
            }
          }
          if (vy < 0.7) {
            d[o + STATE] = SETTLE; d[o + TIMER] = 0.16; d[o + VY] = 0;
            _axis.set(0, 0, 1).applyQuaternion(_q);
            d[o + TY] = Math.atan2(_axis.x, _axis.z);
          } else {
            d[o + VY] = vy * (0.26 + Math.random() * 0.16);
            d[o + VX] = d[o + VX] * 0.55 + (Math.random() - 0.5) * vy * 0.3;
            d[o + VZ] = d[o + VZ] * 0.55 + (Math.random() - 0.5) * vy * 0.3;
            this.spin(o, w * 0.6 + 4);
          }
        } else if (phys) {
          _probe.x = d[o + PX]; _probe.z = d[o + PZ];
          if (phys.resolve(_probe, 0.012, d[o + PY] - 0.004, d[o + PY] + 0.004, 0)) {
            const nx = _probe.x - d[o + PX], nz = _probe.z - d[o + PZ], nl = Math.hypot(nx, nz);
            if (nl > 1e-6) {
              const vn = (d[o + VX] * nx + d[o + VZ] * nz) / nl;
              if (vn < 0) {
                d[o + VX] -= 1.4 * vn * nx / nl;
                d[o + VZ] -= 1.4 * vn * nz / nl;
              }
            }
            d[o + PX] = _probe.x; d[o + PZ] = _probe.z;
          }
        }
      }
      d[o + QX] = _q.x; d[o + QY] = _q.y; d[o + QZ] = _q.z; d[o + QW] = _q.w;
      this.write(i);
    }
    this.active = active;
    if (moved) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.data.fill(0);
    this.cursor = 0;
    this.used = 0;
    this.active = 0;
    this.mesh.count = 0;
  }
}
