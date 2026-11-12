import * as THREE from 'three';
import { loadBody, standIn } from './soldiers_body.js';
import { SoldierNav } from './soldier_nav.js';
import { PathFinder, MAX_WP } from './soldiers_path.js';
import { locomote } from './soldiers_move.js';
import { updateGun, GUN } from './soldiers_gun.js';
import { think, act, hear, route, finishRoute } from './soldier_ai.js';
import { THINK, enterCombat, investigate } from './soldiers_states.js';
import { pickSpawns } from './soldiers_spawn.js';
import { CONTACT } from './contact.js';
import { suppress } from './soldiers_react.js';
import { pickCorpse, sinkStep, SINK } from './soldiers_corpse.js';
import { TUNE } from './tuning.js';
import { assignRole, waveRoles, updateRoles } from './soldiers_roles.js';

// 人形敌人的管理器：对象池、出生、每帧更新、命中判定和伤害结算。游戏只和这个类打交道。
// 身体模型异步加载（缺了就用胶囊小人），加载完之前的出生请求先排队。
const POOL = 10;
const RAYS_PER_FRAME = 8; // 视线检测每帧上限，超出的推到下一帧
const ROUTE_BUDGET = 1500; // A* 每帧最多展开的节点数（约 0.5 毫秒），长路径分几帧搜完
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _p = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
const NO_HIT = Object.freeze({ killed: false, headshot: false });

function record(i) {
  const V = () => new THREE.Vector3();
  return {
    id: i, bit: 1 << i, rig: null, alive: false, broken: false, level: 1, hp: 100, maxHp: 100,
    pos: V(), vel: V(), vy: 0, grounded: true, surface: 'asphalt', yaw: 0, crouch: 0, crouchWant: 0, eye: V(), chest: V(),
    state: 'patrol', stateT: 0, hunter: false, waitT: 0, urgent: false,
    home: V(), goal: V(), needPath: false, speedWant: 0, arrived: true,
    path: new Float32Array(MAX_WP * 3), pathN: 0, pathI: 0,
    nudge: V(), nudgeT: 0, stuck: 0, progT: 0, progPos: V(), progD: 0, stride: 0,
    thinkT: 0, sees: false, visEye: false, visChest: false, seeT: 0, lostT: 99, reaction: 0.5, dist: 99,
    lastKnown: V(), seenPos: V(), knownT: -99, lastSeenT: -99, alertT: -99, hurtT: -99, hurtSoundT: -99, heardT: -99,
    lookBase: 0, lookT: 0, lookDur: 3, searchT: 0, noticed: 0, watchedT: 0, friendBlock: false,
    token: false, tokenT: 0, tokenCool: 0, tokenBursts: 0,
    tac: 'none', post: V(), postNode: -1, peekNode: -1, postCover: false, postKind: '',
    role: 'support', engage: 15, reach: 15, anchor: NaN, anchorX: 0, anchorZ: 0, // 交战分工（soldiers_roles.js）
    holdT: 0, peekT: 0, duckT: 0, lastBursts: 0, exposedT: 0, fellBack: false, blind: false, pickCool: 0,
    aimPt: V(), firePt: V(), aimErr: V(), aimYaw: 0, aimPitch: 0, aim: 0, aimed: false, wantFire: false, onTarget: 0,
    gun: { mag: GUN.mag, reloadT: 0, burst: 0, shotT: 0, cool: 0, bursts: 0, shot: 0, lag: 0 },
    shake: 0, hitWinT: -99, hitN: 0, suppT: -99, // 挨打压制（soldiers_react.js）
    deathT: 0, sinking: false,
  };
}

export class SoldierManager {
  constructor({ scene, phys, mats, fx, audio, level }) {
    Object.assign(this, { scene, phys, mats, fx, audio, level });
    this.onKill = null;
    this.kind = 'soldier';
    this.time = 0;
    this.records = Array.from({ length: POOL }, (_, i) => record(i));
    this.active = [];
    this.pending = [];
    this.sinks = []; // 正在沉进地面、沉完要拿来出生的尸体（soldiers_corpse.js）
    this.corpses = [];
    this.fallEnv = { phys, others: this.corpses };
    this.bodies = 0;
    this.player = null;
    this.tune = TUNE; // 杀伤力调参（tuning.js），和 drones.tune 是同一个对象
    this.shooters = 0;
    this.baseShooters = this.maxShooters = 1;
    this.wave = 1;
    this.openT = 0;
    this.promoteT = 0;
    this.shared = { pos: new THREE.Vector3(), from: new THREE.Vector3(), t: -100 };
    this.nav = new SoldierNav(phys);
    this.pf = new PathFinder(this.nav); // 找掩体的限距搜索，当帧做完
    this.router = new PathFinder(this.nav); // 分帧 A*，同一时间只给一个人搜
    this.job = null;
    this.seeds = [];
    this.rays = RAYS_PER_FRAME;
    this.searches = 1;
    this.impacts = 6;
    this.whizT = 0;
    this.cost = 0;
    this.body = standIn();
    this.ready = false;
    this.loading = this.load();
  }

  get aliveCount() {
    let n = this.pending.length + this.sinks.length;
    for (const s of this.active) if (s.alive) n++;
    return n;
  }

  async load() {
    let body = await loadBody();
    try {
      this.makePool(body);
    } catch (e) {
      console.warn('[soldiers] 人形模型建不起来，换胶囊占位小人', e);
      body = standIn();
      this.makePool(body);
    }
    this.warmup();
    this.ready = true;
    for (const p of this.pending.splice(0)) this.place(p.x, p.y, p.z, p.level, p.opts);
  }

  // 一次建好全部身体，加进场景后只切显隐，不再增删网格
  makePool(body) {
    const shared = body.createShared(this.mats);
    const rigs = [];
    for (let i = 0; i < POOL; i++) rigs.push(new body.Rig(shared, body.variants ? i % body.variants : i));
    for (const r of rigs) {
      r.setVisible(false);
      this.scene.add(r.root);
    }
    this.body = body;
    this.records.forEach((s, i) => { s.rig = rigs[i]; });
  }

  // 士兵的着色器要等第一次真画出来才编，第一波刷人那一帧会卡 60~500 毫秒。加载完就把一个身体埋到地面以下
  // 50 米、关掉视锥剔除，让菜单背景照常画它几遍：正式的渲染目标、灯光、阴影配置下的程序都编好了再收回池子。
  // 不用 renderer.compile：它按画布的输出格式编，和后处理管线的浮点目标对不上，到时候还得重编。
  // 活人和尸体两套材质共用同一个程序，编一次就够
  warmup() {
    const s = this.records[0], rig = s.rig, meshes = rig?.mesh?.meshes; // 胶囊小人没有 mesh，不用预热
    if (!meshes) return;
    rig.root.position.set(this.level?.spawn?.x || 0, -50, this.level?.spawn?.z || 0);
    rig.root.updateMatrixWorld(true);
    let left = 6; // onAfterRender 每画一遍每个网格调一次，阴影图不算
    const done = () => {
      if (--left > 0) return;
      for (const m of meshes) { m.frustumCulled = true; m.onAfterRender = () => {}; }
      if (!this.active.includes(s)) rig.setVisible(false);
    };
    for (const m of meshes) { m.frustumCulled = false; m.onAfterRender = done; }
    rig.setVisible(true);
  }

  // 网格过期（碰撞体数量变了）时重建；交火中不建，免得卡一下
  ensureNav(force) {
    const nav = this.nav;
    if (nav.ready && !nav.stale) return;
    if (!force && nav.ready) for (const s of this.active) if (s.alive && s.state === 'combat') return;
    const seeds = this.seeds;
    seeds.length = 0;
    const L = this.level;
    if (L?.spawn) seeds.push({ x: L.spawn.x, y: L.spawn.y || 0, z: L.spawn.z });
    for (const p of L?.spawns || []) seeds.push(p);
    for (const s of this.active) if (s.alive) seeds.push(s.pos);
    if (this.player) seeds.push(this.player.position);
    try {
      nav.build(seeds);
      this.pf.ensure();
      this.router.ensure();
      // 节点编号全变了：正在搜的路作废，重新排队
      if (this.job) { this.job.needPath = true; this.job = null; }
    } catch (e) {
      nav.count = this.phys.boxes.length + this.phys.cyls.length;
      console.warn('[soldiers] 寻路网格建不起来', e);
    }
  }

  setLevel(level) {
    const T = TUNE;
    this.wave = level;
    this.baseShooters = level <= 1 ? T.shooters1 : level < T.shootersLateFrom ? T.shootersMid : T.shootersLate;
    this.maxShooters = this.baseShooters;
  }

  // 玩家整个人站在明处、同时被两个以上的人看见胸口超过 2 秒：多放一个人开火，站桩不能一直站下去。
  // 躲在掩体后只探头时看不见胸口，不加；前两波不加；加上以后不超过 shootersCap
  pressure(dt) {
    const T = TUNE;
    if (this.wave < T.pressureFrom) { this.openT = 0; this.maxShooters = this.baseShooters; return; }
    let open = 0;
    for (const s of this.active) if (s.alive && s.sees && s.visChest && s.state === 'combat') open++;
    this.openT = open >= T.pressureSeen ? this.openT + dt : Math.max(0, this.openT - dt * 2);
    this.maxShooters = Math.max(this.baseShooters, Math.min(T.shootersCap, this.baseShooters + (this.openT > T.pressureT ? 1 : 0)));
  }

  // 每波从地图边上的出生点进场，朝玩家所在的大致区域压过来
  spawnWave(count, level = 1, player = this.player) {
    this.player = player || this.player;
    this.setLevel(level);
    CONTACT.soldier = false;
    // 网格要先就绪：出生点按步行距离挑（soldiers_spawn.js），level 就是波次
    this.ensureNav(false);
    const pts = pickSpawns(this, count, player, level), roles = waveRoles(pts.length, level);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      this.place(p.x, p.y, p.z, level, { hunter: true, wait: i * 0.35, role: roles[i] });
    }
  }

  // 测试用：在指定位置放一个站岗的
  spawnAt(x, y, z, level = 1) {
    if (!this.active.some((s) => s.alive)) this.setLevel(level);
    return this.place(x, y || 0, z, level, {});
  }

  place(x, y, z, level, opts) {
    if (!this.ready) { this.pending.push({ x, y, z, level, opts }); return null; }
    let s = this.records.find((r) => !this.active.includes(r));
    if (!s) {
      // 池子满了：收回玩家看不见的尸体里最早倒下的；都看得见就先让它沉下去，沉完再出生
      const old = pickCorpse(this, this.player);
      if (!old) return null;
      if (pickCorpse.seen) {
        old.sinking = true;
        this.sinks.push({ s: old, t: SINK, x, y, z, level, opts });
        return null;
      }
      this.recycle(old);
      s = old;
    }
    this.arm(s, x, y, z, level, opts);
    this.active.push(s);
    return s;
  }

  recycle(s) {
    this.active.splice(this.active.indexOf(s), 1);
    this.bodies--;
  }

  arm(s, x, y, z, level, opts) {
    // 出生点如果在网格上，吸到最近的格子中心，免得卡在东西里
    this.ensureNav(false);
    const n = this.nav.ready ? this.nav.nearest(x, y, z, 2) : -1;
    if (n >= 0) s.pos.set(this.nav.cx(n), this.nav.nY[n], this.nav.cz(n)); else s.pos.set(x, y, z);
    Object.assign(s, {
      alive: true, broken: false, level, hp: 100 + Math.min(40, 5 * (level - 1)), vy: 0, grounded: true, crouch: 0, crouchWant: 0,
      state: 'patrol', stateT: 0, hunter: !!opts.hunter, waitT: opts.wait || 0, urgent: false,
      needPath: false, speedWant: 0, arrived: true, pathN: 0, pathI: 0, nudgeT: 0, stuck: 0, progT: 0, stride: 0,
      thinkT: (s.id / POOL) * THINK, sees: false, visEye: false, visChest: false, seeT: 0, lostT: 99, reaction: 0.5,
      knownT: -99, lastSeenT: -99, alertT: -99, hurtT: -99, hurtSoundT: -99, heardT: -99, lookT: 0, lookDur: rand(1, 3), searchT: 0,
      noticed: 0, watchedT: 0, friendBlock: false, token: false, tokenT: 0, tokenCool: 0, tokenBursts: 0,
      tac: 'none', postNode: -1, peekNode: -1, postCover: false, holdT: 0, peekT: 0, duckT: 0, lastBursts: 0,
      exposedT: 0, fellBack: false, blind: false, pickCool: 0, aim: 0, aimYaw: 0, aimPitch: 0, aimed: false, wantFire: false, onTarget: 0, deathT: 0,
      shake: 0, hitWinT: -99, hitN: 0, suppT: -99, sinking: false,
    });
    s.maxHp = s.hp;
    assignRole(s, this, opts.role);
    Object.assign(s.gun, { mag: GUN.mag, reloadT: 0, burst: 0, shotT: 0, cool: 0, bursts: 0, shot: 0, lag: 0 });
    s.vel.set(0, 0, 0);
    s.home.copy(s.pos);
    s.progPos.copy(s.pos);
    s.lastKnown.copy(s.pos);
    const pp = this.player?.position;
    s.yaw = pp ? Math.atan2(-(pp.x - s.pos.x), -(pp.z - s.pos.z)) + rand(-0.6, 0.6) : rand(-Math.PI, Math.PI);
    s.lookBase = s.yaw;
    s.aimPt.set(s.pos.x - Math.sin(s.yaw) * 10, s.pos.y + 1.5, s.pos.z - Math.cos(s.yaw) * 10);
    for (const o of this.records) o.noticed &= ~s.bit;
    s.rig.reset();
    s.rig.setVisible(true);
    this.pose(s, 0);
    if (s.hunter && pp) {
      _v.set(pp.x + rand(-5, 5), pp.y, pp.z + rand(-5, 5));
      investigate(s, this, _v, true);
    }
  }

  update(dt, player) {
    if (!(dt > 0)) return;
    const t0 = performance.now();
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.player = player;
    this.rays = RAYS_PER_FRAME;
    this.searches = 1;
    this.impacts = Math.min(6, this.impacts + dt * 14);
    this.whizT -= dt;
    if (!this.ready) return;
    if (this.sinks.length) sinkStep(this, dt, (s, e) => { this.recycle(s); this.arm(s, e.x, e.y, e.z, e.level, e.opts); this.active.push(s); });
    this.ensureNav(false);
    this.routeStep();
    this.pressure(dt);
    updateRoles(this, dt);
    for (const s of this.active) {
      try {
        this.step(s, dt, player);
      } catch (e) {
        // 单个敌人出错不能拖垮整局：报一次，之后它只站着当靶子
        if (!s.broken) console.error(`[soldiers] 敌人 #${s.id} 更新出错`, e);
        s.broken = true;
      }
    }
    this.cost += (performance.now() - t0 - this.cost) * 0.05;
  }

  step(s, dt, player) {
    if (!s.alive) {
      if (!s.rig.deathDone) s.rig.update(dt);
      return;
    }
    if (s.broken) { this.pose(s, dt); return; }
    if ((s.thinkT -= dt) <= 0) {
      s.thinkT += THINK;
      if (s.thinkT < 0) s.thinkT = THINK;
      think(s, this, player);
    }
    if (s.needPath && !this.job && route(s, this)) this.job = s;
    act(s, dt, this, player);
    locomote(s, dt, this);
    this.pose(s, dt);
    updateGun(s, dt, this, player);
  }

  // 推进正在进行的 A*；要路的人死了或者又换了目标就作废
  routeStep() {
    const s = this.job;
    if (!s) return;
    if (!s.alive || s.needPath) { this.job = null; return; }
    if (this.router.step(ROUTE_BUDGET)) {
      this.job = null;
      finishRoute(s, this);
    }
  }

  // 把位置、朝向和动画参数交给身体
  pose(s, dt) {
    const r = s.rig, st = r.state, sp = Math.hypot(s.vel.x, s.vel.z);
    r.root.position.copy(s.pos);
    r.root.rotation.y = s.yaw;
    st.speed = sp;
    st.moveYaw = sp > 0.1 ? wrap(Math.atan2(-s.vel.x, -s.vel.z) - s.yaw) : 0;
    st.aim = s.aim;
    st.aimPitch = s.aimPitch;
    st.aimYaw = s.aimYaw;
    st.crouch = s.crouch;
    r.update(dt);
    r.getEye(s.eye);
    r.getChest(s.chest);
  }

  // ---- 每帧额度
  spendRay() { if (this.rays <= 0) return false; this.rays--; return true; }
  spendSearch() { if (this.searches <= 0) return false; this.searches--; return true; }
  spendImpact() { if (this.impacts < 1) return false; this.impacts--; return true; }
  spendWhiz() { if (this.whizT > 0) return false; this.whizT = 0.12; return true; }

  requestToken(s) {
    if (s.token || this.shooters >= this.maxShooters) return false;
    s.token = true;
    s.tokenT = 0;
    s.tokenBursts = s.gun.bursts;
    this.shooters++;
    return true;
  }

  releaseToken(s) {
    if (!s.token) return;
    s.token = false;
    s.tokenCool = rand(0.8, 2);
    this.shooters = Math.max(0, this.shooters - 1);
  }

  // 寻路时给玩家正前方的扇形加价：绕开被盯着的那条路
  watchFrom(pf, on) {
    const w = pf.watch, p = this.player;
    w.on = !!on && !!p && p.yaw !== undefined;
    if (!w.on) return;
    w.x = p.position.x;
    w.z = p.position.z;
    w.fx = -Math.sin(p.yaw);
    w.fz = -Math.cos(p.yaw);
  }

  // 武器的命中检测：先用包围球粗筛，再交给身体模型逐部位求交
  raycast(origin, dir, maxDist = 500) {
    let best = null, bd = maxDist, part = 'torso';
    for (const s of this.active) {
      if (!s.alive) continue;
      const b = s.rig.bounds, c = b.center;
      const ox = c.x - origin.x, oy = c.y - origin.y, oz = c.z - origin.z, t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < -b.radius || t - b.radius > bd || ox * ox + oy * oy + oz * oz - t * t > b.radius * b.radius) continue;
      const h = s.rig.raycast(origin, dir, bd);
      if (h && h.dist < bd) {
        bd = h.dist;
        best = s;
        part = h.part;
        _p.copy(h.point);
      }
    }
    return best ? { target: best, point: _p.clone(), dist: bd, part } : null;
  }

  // 结算一次命中：部位倍率 头 4、躯干 1、四肢 0.7。silent：不放 bodyHit（刀有自己的命中声）
  hit(target, damage, point, dir, part = 'torso', { silent = false } = {}) {
    const s = target;
    if (!s || !s.alive || !this.active.includes(s)) return NO_HIT;
    if (part !== 'head' && part !== 'limb') part = 'torso';
    let dmg = damage * (part === 'head' ? 4 : part === 'limb' ? 0.7 : 1);
    // 随波次多出来的血量算护甲：步枪爆头照样一枪倒
    if (part === 'head' && dmg >= 100) dmg = Math.max(dmg, s.hp);
    s.hp -= dmg;
    s.hurtT = this.time;
    if (dir) _n.copy(dir).negate(); else _n.set(0, 1, 0);
    const at = point || s.chest;
    this.fx?.impact?.(at, _n, 'flesh');
    if (!silent) this.audio?.play?.('bodyHit', { position: at, volume: 0.9 });
    const headshot = part === 'head';
    if (s.hp <= 0) {
      this.kill(s, dir, part);
      return { killed: true, headshot };
    }
    s.rig.flinch(dir || _n, part);
    if (this.time - s.hurtSoundT > 0.4) {
      s.hurtSoundT = this.time;
      this.audio?.play?.('npcHurt', { position: s.eye, volume: 0.9 });
    }
    // 挨了枪就知道玩家在哪，转过去的反应也快
    if (this.player) {
      s.lastKnown.copy(this.player.position);
      s.knownT = this.time;
    }
    s.reaction = Math.min(s.reaction, 0.3);
    if (s.state !== 'combat') enterCombat(s, this);
    suppress(s, this, part, this.player);
    return { killed: false, headshot };
  }

  kill(s, dir, part) {
    s.alive = false;
    s.hp = 0;
    s.state = 'dead';
    s.deathT = this.time;
    s.wantFire = false;
    s.gun.burst = 0;
    this.releaseToken(s);
    // 倒法要避开墙、月台边和别的尸体
    const others = this.corpses;
    others.length = 0;
    for (const o of this.active) if (!o.alive && o !== s) others.push(o.rig.bounds.center);
    s.rig.die(dir || _n.set(0, 0, 1), part, this.fallEnv);
    this.bodies++;
    this.audio?.play?.('npcDeath', { position: s.eye, volume: 1 });
    this.onKill?.(s, { headshot: part === 'head', part });
  }

  hear(position, radius = 30) {
    if (!position) return;
    for (const s of this.active) if (s.alive && !s.broken) hear(s, this, position, radius);
  }

  clear() {
    for (const s of this.records) {
      s.alive = false;
      s.token = false;
      if (s.rig) { s.rig.reset(); s.rig.setVisible(false); }
    }
    this.active.length = 0;
    this.pending.length = 0;
    this.sinks.length = 0;
    this.job = null;
    this.bodies = 0;
    this.shooters = 0;
    this.openT = 0;
    this.promoteT = 0;
    this.shared.t = -100;
    // 开局前是重建网格最好的时机
    this.ensureNav(true);
  }

  // 调试：状态分布、网格规模、上次建网格用时、每帧开销
  debugInfo() {
    const states = {}, roles = {};
    for (const s of this.active) {
      const k = s.alive ? (s.broken ? 'broken' : s.state) : 'dead';
      states[k] = (states[k] || 0) + 1;
      if (s.alive) roles[s.role] = (roles[s.role] || 0) + 1;
    }
    return {
      alive: this.aliveCount, states, roles, shooters: this.shooters, maxShooters: this.maxShooters,
      body: this.ready ? (this.body.real ? 'rig' : 'standin') : 'loading',
      nav: { cells: this.nav.walkable, nodes: this.nav.nodes, ms: +this.nav.ms.toFixed(1), builds: this.nav.builds },
      updateMs: +this.cost.toFixed(3),
    };
  }
}

