import * as THREE from 'three';
import { buildDrone } from './drone_model.js';
import { NavGrid, levelParams, DRONE_BOUNDS } from './drone_nav.js';
import { createDrone, think, fly, pose, aim, fire, BULLET_SPEED, RANGE } from './drone_ai.js';
import { CONTACT } from './contact.js';
import { TUNE } from './tuning.js';
import { impactSound } from '../audio/table.js';

const POOL = 6;
const LAMP_CD = 600; // 探照灯光强
const BODY_R = 0.35, WHIZ_R = 1.5; // 玩家身体线段的命中半径；子弹擦过头部多近算“嗖”一声
const HIT_Y = -0.04, HIT_RV = 0.22; // 命中椭球：中心相对机身的高度、竖直半轴（水平半轴是 radius）
// 命中椭球比机身放大这么多：无人机横移快，照着机身大小判定太难打中。只放大判定，机身和碰撞不变
const HIT_SCALE = 1.15;

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3();
const _e = new THREE.Euler();
const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
const sat = (x) => Math.min(1, Math.max(0, x));

// 线段 A→A+u 与 C→C+w 的最近距离
function segDist(A, u, C, w) {
  const rx = A.x - C.x, ry = A.y - C.y, rz = A.z - C.z;
  const a = u.dot(u), e = w.dot(w), f = w.x * rx + w.y * ry + w.z * rz, c = u.x * rx + u.y * ry + u.z * rz;
  let s = 0, t = 0;
  if (a > 1e-9 && e > 1e-9) {
    const b = u.dot(w), den = a * e - b * b;
    s = den > 1e-9 ? sat((b * f - c * e) / den) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = sat(-c / a); } else if (t > 1) { t = 1; s = sat((b - c) / a); }
  } else if (a > 1e-9) s = sat(-c / a);
  else if (e > 1e-9) t = sat(f / e);
  return Math.hypot(rx + u.x * s - w.x * t, ry + u.y * s - w.y * t, rz + u.z * s - w.z * t);
}

export class DroneManager {
  constructor({ scene, phys, mats, fx, audio }) {
    Object.assign(this, { scene, phys, mats, fx, audio });
    this.drones = [];
    this.shots = [];
    this.pool = [];
    this.onKill = null;
    this.time = 0;
    this.nav = null;
    this.shared = { pos: new THREE.Vector3(), t: -100 }; // 最近一次有无人机看见玩家的位置和时刻
    this.firing = 0;
    this.divers = 0;
    this.attackers = 1;
    this.tune = TUNE; // 杀伤力调参（tuning.js），和 soldiers.tune 是同一个对象
    this.nextFireT = 0;
    this.waveT = -100; // 最近一次开波的时刻：开波头几秒不先开火（drone_ai.js 的 QUIET）
    this.lightT = 0;
    this.lights = [];
    this.slots = [];
    for (let i = 0; i < 3; i++) {
      const light = new THREE.SpotLight(0xdbe8ff, 0, 30, 0.22, 0.5, 2);
      light.castShadow = false;
      light.position.set(0, 40, 0);
      scene.add(light, light.target);
      this.lights.push(light);
      this.slots.push({ light, drone: null, next: null, k: 0 });
    }
    // 预建几架藏在场景里，第一波出现时不用现建
    for (let i = 0; i < POOL; i++) this.pool.push(this.park(buildDrone(mats)));
    this.warmup();
  }

  // 藏着的网格不会被画，着色器要等第一次真画出来才编，第一波那两帧会各卡 250~350 毫秒。
  // 所以把池底的一架放到地面以下 50 米、关掉视锥剔除，让菜单背景照常画它几遍，程序编好了再藏回去
  // （做法同 SoldierManager.warmup，不用 renderer.compile 的原因也一样）
  warmup() {
    const model = this.pool[0];
    if (!model) return;
    const meshes = [];
    model.root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    model.root.position.set(0, -50, 0);
    model.root.visible = true;
    let left = meshes.length * 3; // 每画一个网格调一次，阴影图不算；大约三帧
    const done = () => {
      if (--left > 0) return;
      for (const m of meshes) { m.frustumCulled = true; m.onAfterRender = () => {}; }
      if (this.pool.includes(model)) model.root.visible = false;
    };
    for (const m of meshes) { m.frustumCulled = false; m.onAfterRender = done; }
  }

  get aliveCount() {
    let n = 0;
    for (const d of this.drones) if (d.alive) n++;
    return n;
  }

  park(model) {
    model.root.visible = false;
    model.root.scale.setScalar(1);
    model.root.rotation.set(0, 0, 0);
    model.gimbal.rotation.y = 0;
    model.pitch.rotation.x = -0.4;
    model.discs.visible = true;
    model.eye.emissiveIntensity = 2.5;
    model.lampMat.emissiveIntensity = 3;
    if (!model.root.parent) this.scene.add(model.root);
    return model;
  }

  // 从场外高空飞入；level 从 1 起
  spawnWave(count, level = 1) {
    const P = levelParams(level);
    // 同时预警或点射的架数：前几波 1 架，之后 2 架
    this.attackers = level < TUNE.droneAttackersFrom ? 1 : 2;
    this.waveT = this.time;
    CONTACT.soldier = false;
    let delay = 0.01;
    for (let i = 0; i < count; i++) {
      // 只从南、东、西三面来（北面是仓库）
      const ang = rand(-1.65, 1.65), R = rand(48, 60);
      const pos = new THREE.Vector3(Math.sin(ang) * R, rand(17, 24), Math.cos(ang) * R * 0.85);
      const d = createDrone(this.pool.pop() || this.park(buildDrone(this.mats)), P, pos);
      d.delay = delay;
      delay += rand(0.35, 0.8);
      d.root.position.copy(pos);
      this.drones.push(d);
    }
  }

  activate(d, player) {
    const p = d.position, pp = player.position;
    d.lastKnown.copy(pp);
    d.yaw = Math.atan2(p.x - pp.x, p.z - pp.z);
    d.velocity.set(pp.x - p.x, 0, pp.z - p.z).setLength(d.params.speed * 1.6);
    d.root.visible = true;
    d.sound = this.audio?.loop?.('droneRotor', { position: p, volume: 0.7, pitch: 1 }) || null;
  }

  update(dt, player) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.nav ??= new NavGrid(this.phys);
    let firing = 0, divers = 0;
    for (const d of this.drones) {
      if (!d.alive) continue;
      if (d.fire.phase !== 'idle') firing++;
      if (d.state === 'dive') divers++;
    }
    this.firing = firing;
    this.divers = divers;
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i];
      if (!d.alive) {
        if (this.wreck(d, dt)) {
          d.spark?.stop?.(0.4);
          d.spark = null;
          this.drones.splice(i, 1);
          this.pool.push(this.park(d.model));
        }
        continue;
      }
      if (d.delay > 0) {
        if ((d.delay -= dt) > 0) continue;
        this.activate(d, player);
      }
      think(d, dt, this, player);
      if (d.state === 'leave' && this.gone(d)) {
        this.retire(d);
        this.drones.splice(i, 1);
        continue;
      }
      fly(d, dt, this, player);
      pose(d, dt, this);
      aim(d, dt, this, player);
      fire(d, dt, this, player);
      d.sound?.set?.({ position: d.position, volume: 0.55 + 0.3 * d.throttle, pitch: 0.82 + 0.4 * d.throttle });
      if (d.hp < d.maxHp * 0.4 && (d.smokeT -= dt) <= 0) {
        d.smokeT = 0.22;
        this.fx?.smoke?.(d.position.clone(), { size: 0.35, life: 0.9, rise: 0.5, count: 1, color: 0x4a4d52 });
      }
    }
    this.updateShots(dt, player);
    this.updateLights(dt, player);
  }

  // 沿枪口实际朝向打一发：先求终点画曳光，伤害等弹丸飞到再结算
  shoot(d) {
    d.root.updateMatrixWorld(true);
    const e = d.muzzle.matrixWorld.elements, s = d.params.spread * (1 + d.fire.run * TUNE.droneSpreadMove);
    _o.set(e[12], e[13], e[14]);
    _u.set(e[0], e[1], e[2]);
    _v.set(e[4], e[5], e[6]);
    _d.set(-e[8], -e[9], -e[10]).addScaledVector(_u, gauss() * s).addScaledVector(_v, gauss() * s).normalize();
    const hit = this.phys?.raycast?.(_o, _d, RANGE) || null;
    const shot = { o: _o.clone(), d: _d.clone(), t: 0, len: hit ? hit.dist : RANGE, hit, from: d.position.clone(), whiz: false, dmg: rand(TUNE.droneDmg[0], TUNE.droneDmg[1]) };
    this.shots.push(shot);
    this.fx?.tracer?.(shot.o.clone(), shot.o.clone().addScaledVector(_d, shot.len), { speed: BULLET_SPEED, color: 0xffa860, width: 0.035 });
    this.fx?.muzzleFlash?.(shot.o.clone(), shot.d.clone(), 0.55);
    this.audio?.play?.('droneShot', { position: shot.o, volume: 1, pitch: rand(0.94, 1.06) });
    d.velocity.addScaledVector(_d, -0.25);
    d.gp += 0.012;
  }

  updateShots(dt, player) {
    const live = player.alive !== false;
    _v.set(0, player.eye.y + 0.12 - player.position.y, 0); // 身体线段：脚底到头顶
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i], t0 = s.t, t1 = Math.min(s.len, t0 + BULLET_SPEED * dt);
      s.t = t1;
      if (live) {
        _o.copy(s.o).addScaledVector(s.d, t0);
        _u.copy(s.d).multiplyScalar(t1 - t0);
        if (segDist(_o, _u, player.position, _v) < BODY_R) {
          player.takeDamage?.(s.dmg, s.from, 'drone');
          this.shots.splice(i, 1);
          continue;
        }
        const te = _d.copy(player.eye).sub(s.o).dot(s.d);
        if (!s.whiz && te <= t1) {
          s.whiz = true;
          _d.copy(s.o).addScaledVector(s.d, Math.max(0, te));
          if (te > 0 && _d.distanceTo(player.eye) < WHIZ_R) {
            this.audio?.play?.('bulletWhiz', { position: _d.clone(), volume: 0.9, pitch: rand(0.9, 1.15) });
          }
        }
      }
      if (t1 >= s.len) {
        if (s.hit) {
          this.fx?.impact?.(s.hit.point, s.hit.normal, s.hit.surface);
          // 落在玩家身边 10 米内才出声
          if (live && s.hit.point.distanceToSquared(player.eye) < 100) this.audio?.play?.(impactSound(s.hit.surface), { position: s.hit.point, volume: 0.6 });
        }
        this.shots.splice(i, 1);
      }
    }
  }

  // 三盏灯分给离玩家最近的三架；换主时先暗下去再亮起来，不跳变
  updateLights(dt, player) {
    if ((this.lightT -= dt) <= 0) {
      this.lightT = 0.4;
      const held = (d) => this.slots.some((s) => s.drone === d);
      const near = this.drones
        .filter((d) => d.alive && d.delay <= 0)
        .map((d) => ({ d, k: d.position.distanceToSquared(player.position) * (held(d) ? 0.7 : 1) }))
        .sort((a, b) => a.k - b.k).slice(0, this.slots.length).map((x) => x.d);
      const spare = near.filter((d) => !held(d));
      for (const s of this.slots) s.next = s.drone && near.includes(s.drone) ? s.drone : spare.shift() || null;
    }
    for (const s of this.slots) {
      const keep = s.drone && s.drone.alive && s.next === s.drone;
      s.k = sat(s.k + (keep ? 3 : -4) * dt);
      if (!keep && s.k <= 0) {
        if (s.drone) s.drone.lampK = 0;
        s.drone = s.next && s.next.alive ? s.next : null;
      }
      s.light.intensity = LAMP_CD * s.k;
      const d = s.drone;
      if (!d) continue;
      d.lampK = s.k;
      d.lampMat.emissiveIntensity = 3 + 60 * s.k;
      d.lamp.updateWorldMatrix(true, false);
      const e = d.lamp.matrixWorld.elements;
      s.light.position.set(e[12], e[13], e[14]);
      s.light.target.position.set(e[12] - e[8] * 10, e[13] - e[9] * 10, e[14] - e[10] * 10);
    }
  }

  raycast(origin, dir, maxDist = 500) {
    let best = null, bd = maxDist;
    for (const d of this.drones) {
      if (!d.alive || d.delay > 0) continue;
      // 压扁的椭球：把 y 方向拉伸后按球求交
      const c = d.root.position, R = d.radius * HIT_SCALE, k = d.radius / HIT_RV;
      const ox = origin.x - c.x, oy = (origin.y - c.y - HIT_Y) * k, oz = origin.z - c.z, dy = dir.y * k;
      const a = dir.x * dir.x + dy * dy + dir.z * dir.z, b = ox * dir.x + oy * dy + oz * dir.z, cc = ox * ox + oy * oy + oz * oz - R * R;
      const disc = b * b - a * cc;
      if (disc < 0) continue;
      let t = (-b - Math.sqrt(disc)) / a;
      if (t < 0) {
        if (cc > 0) continue;
        t = 0; // 起点已经在椭球里（贴脸刀）
      }
      if (t < bd) { bd = t; best = d; }
    }
    return best ? { drone: best, dist: bd, point: new THREE.Vector3().copy(origin).addScaledVector(dir, bd) } : null;
  }

  // 结算伤害；返回是否击毁。silent：不放 droneHit（刀有自己的命中声），和 soldiers.hit 一样
  hit(drone, damage, point, dir, part, { silent = false } = {}) {
    if (!drone?.alive) return false;
    const at = (point || drone.position).clone();
    drone.hp -= damage;
    drone.shake = 1;
    drone.hintT = 0;
    drone.provoked = true;
    if (dir) {
      // 挨打后被推一下，并立刻横移
      const side = (Math.random() < 0.5 ? -1 : 1) * 4;
      drone.velocity.addScaledVector(dir, Math.min(3, damage * 0.06));
      drone.jink.set(-dir.z * side, 0, dir.x * side);
      drone.jinkOn = true;
      drone.jinkT = 0.5;
    }
    this.fx?.sparks?.(at, dir ? dir.clone().negate() : new THREE.Vector3(0, 1, 0), 8);
    if (!silent) this.audio?.play?.('droneHit', { position: at, volume: 1, pitch: rand(0.9, 1.15) });
    if (drone.hp > 0) return false;
    this.kill(drone, dir);
    return true;
  }

  kill(d, dir) {
    d.alive = false;
    d.dead = true;
    d.hp = 0;
    d.state = 'wreck';
    d.sound?.stop?.();
    d.sound = null;
    d.eye.emissiveIntensity = 0;
    d.lampMat.emissiveIntensity = 0;
    d.discs.visible = false;
    this.unlight(d);
    this.fx?.explosion?.(d.position.clone(), { scale: 1 });
    this.audio?.play?.('droneExplode', { position: d.position.clone(), volume: 1 });
    // 残骸带着原速度被打飞，翻滚着掉下去
    d.velocity.multiplyScalar(0.6);
    if (dir) d.velocity.addScaledVector(dir, 3.5);
    d.velocity.y += 2.2;
    d.spinAxis = new THREE.Vector3(rand(-1, 1), rand(-0.4, 0.4), rand(-1, 1)).normalize();
    d.spin = rand(5, 11);
    d.rotorW = 150;
    d.bounces = 0;
    d.rest = false;
    d.restT = 0;
    d.smokeT = 0;
    this.onKill?.(d);
  }

  // 探照灯从这架身上撤下来（击毁、撤离回收）
  unlight(d) {
    for (const s of this.slots) {
      if (s.drone === d) { s.drone = null; s.k = 0; s.light.intensity = 0; }
      if (s.next === d) s.next = null;
    }
  }

  // 撤离的飞到地图外 15 米、或者飞了 20 秒
  gone(d) {
    const p = d.position, m = 15;
    return d.leaveT > 20 || p.x < DRONE_BOUNDS.x0 - m || p.x > DRONE_BOUNDS.x1 + m || p.z < DRONE_BOUNDS.z0 - m || p.z > DRONE_BOUNDS.z1 + m;
  }

  // 撤离的收回池子：不算击杀、不给分、不留残骸，从 drones 里拿掉以后 aliveCount 也就不算它了
  retire(d) {
    d.alive = false;
    d.sound?.stop?.(0.3);
    d.sound = null;
    this.unlight(d);
    this.pool.push(this.park(d.model));
  }

  // 残骸：下坠、弹一下、躺着冒烟约 6 秒。返回 true 表示可以移除
  wreck(d, dt) {
    const p = d.position, v = d.velocity;
    d.smokeT -= dt;
    if (!d.rest) {
      v.y -= 13 * dt;
      const sp = v.length() || 1e-4;
      const hit = this.phys?.raycast?.(p, _d.copy(v).multiplyScalar(1 / sp), sp * dt + 0.2);
      if (hit) {
        const vn = v.dot(hit.normal);
        v.addScaledVector(hit.normal, -1.35 * vn).multiplyScalar(0.55);
        d.spin *= 0.5;
        d.bounces++;
        this.fx?.sparks?.(hit.point.clone(), hit.normal.clone(), 12);
        this.fx?.impact?.(hit.point.clone(), hit.normal.clone(), hit.surface);
        // 第一下砸地是整机摔落的重响，之后的小弹跳用轻的
        const first = d.bounces === 1;
        this.audio?.play?.(first ? 'droneCrash' : 'droneHit', { position: hit.point.clone(), volume: first ? 1 : 0.5, pitch: first ? 1 : 0.6 });
        if (hit.normal.y > 0.6 && (d.bounces > 1 || vn > -2.5)) {
          // 落稳：一半概率底朝天，否则歪着趴在地上
          const flip = Math.random() < 0.5;
          d.rest = true;
          d.restQuat = new THREE.Quaternion().setFromEuler(_e.set(rand(-0.25, 0.25), rand(0, 6.28), (flip ? Math.PI : 0) + rand(-0.3, 0.3), 'YXZ'));
          p.copy(hit.point).y += flip ? 0.12 : 0.2;
          // 躺下以后电路短路冒火花，冒烟结束时停（clear 和回收时也停）
          d.spark = this.audio?.loop?.('droneSpark', { position: p.clone(), volume: 0.8 }) || null;
        } else p.copy(hit.point).addScaledVector(hit.normal, 0.2);
      } else p.addScaledVector(v, dt);
      d.root.rotateOnWorldAxis(d.spinAxis, d.spin * dt);
      if (d.smokeT <= 0) {
        d.smokeT = 0.05;
        this.fx?.smoke?.(p.clone(), { size: 0.5, life: 1, rise: 0.3, count: 1, color: 0x2c2e31 });
      }
      if (p.y < -3 || Math.abs(p.x) > 90 || Math.abs(p.z) > 90) return true;
    } else {
      d.restT += dt;
      d.root.quaternion.slerp(d.restQuat, 1 - Math.exp(-dt * 14));
      if (d.restT < 6) {
        if (d.smokeT <= 0) {
          d.smokeT = 0.14 + d.restT * 0.03;
          this.fx?.smoke?.(_o.copy(p).setY(p.y + 0.1).clone(), { size: 0.6, life: 2.4, rise: 1, count: 1, color: 0x2c2e31 });
        }
      } else {
        if (d.spark) { d.spark.stop?.(0.4); d.spark = null; }
        d.root.scale.setScalar(Math.max(0.001, 1 - (d.restT - 6) / 0.5));
        if (d.restT > 6.5) return true;
      }
    }
    d.root.position.copy(p);
    d.rotorW *= Math.exp(-dt * 2.2);
    for (let i = 0; i < d.rotors.length; i++) d.rotors[i].rotation.y += (i % 2 ? -1 : 1) * d.rotorW * dt;
    return false;
  }

  clear() {
    for (const d of this.drones) {
      d.sound?.stop?.();
      d.spark?.stop?.(0.1);
      d.spark = null;
      this.pool.push(this.park(d.model));
    }
    this.drones.length = 0;
    this.shots.length = 0;
    this.firing = this.divers = 0;
    for (const s of this.slots) {
      s.drone = s.next = null;
      s.k = 0;
      s.light.intensity = 0;
    }
  }
}
