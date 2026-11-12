import * as THREE from 'three';
import { buildRifle } from './rifle_model.js';
import { buildArm } from './hands.js';
import { Reticle } from './reticle.js';
import { damp, clamp01, dipKick } from './anim.js';
import { RifleRig, RIFLE_POSES, DRAW_T, HOLSTER_T, RAISE_T, HOLSTER_MIN, SNAP_T, SNAP_DIP } from './rifle_anim.js';
import { RELOAD_END } from './rifle_reload.js';
import { Glide, Carry, follow, smooth } from './rifle_act_motion.js';
import { RunCycle } from './rifle_act_run.js';
import { OffhandThrow, THROW } from './rifle_act_throw.js';
import { LaserDot } from './rifle_act_laser.js';
import { INSPECT_T, INSPECT_CUES } from './rifle_act_inspect.js';
import { dropMag, magShape } from './rifle_magdrop.js';
import { impactSound } from '../audio/table.js';

export { RIFLE_TUNE, RIFLE_POSES } from './rifle_anim.js';

const RPM = 720, MAG = 30, RESERVE = 150, DAMAGE = 26, RANGE = 320;
// 换弹的音效节点（秒）：抽匣（空仓时是旧弹匣脱落，同一刻生成掉在地上的弹匣）、入匣（子弹这一刻算进去）、空仓时放枪机。
// 动作表在 rifle_reload.js，按它的关键帧对齐：左手离开护木（reloadGrab）、按卡笋（magRelease）、
// 画面外换匣 / 去取新匣（reloadGrab）、匣口碰到井口（magSeat）、左手回到护木（reloadSettle）
const CUES = {
  tactical: [[0.05, 'reloadGrab'], [0.45, 'magRelease'], [0.52, 'magOut'], [0.95, 'reloadGrab'], [1.31, 'magSeat'], [1.4, 'magIn'], [1.95, 'reloadSettle']],
  empty: [[0.05, 'reloadGrab'], [0.32, 'magRelease'], [0.38, 'magOut'], [0.62, 'reloadGrab'], [1.03, 'magSeat'], [1.12, 'magIn'], [1.7, 'boltRelease'], [2.3, 'reloadSettle']],
};
// 弹匣离枪的时刻（magOut 那个节点）
const MAG_OUT = { tactical: CUES.tactical.find((c) => c[1] === 'magOut')[0], empty: CUES.empty.find((c) => c[1] === 'magOut')[0] };
// 离弹匣离枪还差这么久以上时，扔烟雾弹可以直接收掉换弹：战术换弹 0.42 秒以前，空仓换弹 0.28 秒以前
const RELOAD_CANCEL = 0.1;
// 这么短时间内又掏一次枪（连着切枪），举枪声压低
const DRAW_GAP = 0.6;
// 动作锁定（掏枪、扔雷、喷气收枪、冲刺收枪）期间按下的键留一会儿，腾出手来再执行。R、B 留得比掏枪全程（0.7 秒）略长，
// 锁定期里任何时候按的都算数；左键只留 0.2 秒，留长了会在已经不想开枪的时候走火
const BUF = 0.2, BUF_KEY = 0.75;
// 冲刺姿态退到这个程度以下才开火：枪还横在胸前时打出去，火光和曳光从画面左下角出来
const RUN_READY = 0.2;
// 一帧里欠的发数照补（射速不跟帧率走），卡顿那一帧最多补这么多，其余丢掉
const CATCH_UP = 3;
// 后坐力的横向游走：按发数取值的一维值噪声，每 SIDE_STEP 发一个格点，SIDE_KEYS 个格点值在每串的第一发重抽。
// 格点值在 ±SIDE_AMP 内、按 1/4 次方往两头推：插值以后均方根约 0.5，和原来的 0.7·sin(0.9n) 一样，只是不再规律地左右摆
const SIDE_STEP = 2, SIDE_KEYS = 16, SIDE_AMP = 0.7;

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3(), _e = new THREE.Vector3();
const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _end = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Rifle {
  constructor(env) {
    this.env = env;
    this.slot = 1;
    this.name = 'KR-7';
    this.auto = true;
    this.holder = new THREE.Group();
    this.model = buildRifle(env.gear);
    this.holder.add(this.model.root);
    // 右手握把、左手护木；两只手都挂在枪上，跟着枪一起动
    this.armR = buildArm(env.gear, 'R');
    this.armL = buildArm(env.gear, 'L');
    this.rig = new RifleRig(this.model, this.armR, this.armL);
    // 收枪程度：0 = 举着，1 = 收到底。掏枪、收枪、取消收枪、喷气切枪都只是给它换个目标
    this.down = new Glide(0);
    this.raiseW = { x: 0, v: 0 }; // 正在往上举的程度：举到位那一下的上扬只在举枪时出现
    this.tuck = { x: 0, v: 0 };   // 喷气收枪的程度，二阶平滑，起步那一帧不跳
    this.run = new RunCycle();
    // 冲刺、滑铲姿态随开镜退掉的程度（1 = 不退）：二阶跟着开镜走，从冲刺开镜那一帧枪不会猛地一转
    this.runK = { x: 1, v: 0 };
    this.buf = { r: 0, b: 0, fire: 0 };
    this.carry = new Carry(0.2);
    this.offhand = new OffhandThrow(env, this.rig);
    this.laser = new LaserDot(env, this.model, RIFLE_POSES.hip);
    this.sideKeys = new Float32Array(SIDE_KEYS);
    // 空仓换弹的旧弹匣：外形交给世界里的掉落道具池，落地磕一下出声
    const mags = env.fx?.mags;
    if (mags) {
      mags.setShape(magShape(this.model.parts.mag, [env.gear.polymer, env.gear.black]));
      mags.onBounce = (position, speed) => {
        env.phys.groundHeight(position.x, position.z, 0.05, position.y + 0.05, 0.1); // 落点的地面材质
        env.audio.play('magDrop', { position, surface: env.phys.groundSurface, volume: Math.min(1, 0.4 + speed * 0.12) });
      };
    }

    this.reticle = new Reticle(env.pipeline);
    env.fxScene.add(this.reticle.mesh);
    this.reset();
  }

  get mode() { return this.auto ? '全自动' : '单发'; }
  get reloadProgress() { return this.reloading ? clamp01(this.reloadT / this.reloadEnd) : 0; }
  get throwing() { return this.offhand.active; }

  reset() {
    this.mag = MAG;
    this.reserve = RESERVE;
    this.ads = 0;
    this.sprintT = 0;
    this.down.set(0);
    this.freeDip = 0; // 摇枪补出来的那点下沉：沉在这个深度以内不算收枪，照常能开火
    this.raiseW.x = this.raiseW.v = 0;
    this.tuck.x = this.tuck.v = 0;
    this.quick = false;
    this.cooldown = 0;
    this.shots = 0;
    this.sinceShot = 1;
    this.bloom = 0;
    this.moveSpread = 0;
    this.boltT = 0;
    this.boltDrop = 0;
    this.locked = false;
    this.reloading = false;
    this.reloadT = 0;
    this.reloadEnd = RELOAD_END.tactical;
    this.reloadEmpty = false;
    this.cues = CUES.tactical;
    this.dropPending = false; // 旧弹匣这一帧脱落：等骨架和相机都更新完（late）再交给世界里的道具
    this.magGone = false; // 空仓换弹的旧匣已经掉了、新匣还没入匣：被切枪打断后井里保持空着，下次换弹不再掉一个
    this.selT = 1;
    this.spread = 0;
    this.crosshair = true;
    this.speedScale = 1;
    this.canSprint = true;
    this.modeDirty = false;
    this.inspectT = -1;
    this.drawnAt = -10;
    this.seenAt = NaN;
    this.seenDt = 0;
    this.run.reset(this.env.player);
    this.runK.x = 1;
    this.runK.v = 0;
    this.clearBuf();
    this.carry.clear();
    this.offhand.stop();
    this.laser.hide();
  }

  resupply() { this.reserve = RESERVE; }

  // 上一帧这把枪有没有被更新过，也就是还在不在画面里（weapons.js 每帧只更新当前那把）
  live() { return this.env.vm?.time === this.seenAt + this.seenDt; }

  // instant：喷气途中切过来，不播举枪动作，立刻能用
  equip({ instant = false } = {}) {
    const live = this.live(), d = this.down;
    this.holder.visible = true;
    this.quick = instant;
    this.freeDip = 0;
    this.clearBuf();
    if (!live) {
      // 刚才不在画面里：上次留下的动作和残余姿态都作废，喷气收枪的程度直接取现在的值
      this.offhand.stop();
      this.inspectT = -1;
      this.carry.clear();
      this.tuck.x = this.env.state?.tuck || 0;
      this.tuck.v = 0;
      this.run.w.x = this.env.player?.sprinting ? 1 : 0;
      this.run.w.v = 0;
    }
    if (instant) {
      // 枪从略低处弹到位（先快后慢），不是凭空出现；本来就在画面里（收到一半）就从当前位置接着举
      if (!live) {
        d.set(SNAP_DIP);
        d.v = (-2 * SNAP_DIP) / SNAP_T;
        this.raiseW.x = 0;
      }
      d.to(0, SNAP_T * (0.6 + 0.4 * clamp01(d.x / SNAP_DIP)));
      return;
    }
    if (live) d.to(0, DRAW_T * Math.max(0.3, clamp01(d.x)));
    else {
      // 从收到底的位置起步，先快后慢
      d.set(1);
      d.v = -2 / DRAW_T;
      d.to(0, DRAW_T);
      this.raiseW.x = 1;
    }
    const now = this.env.vm?.time ?? 0, quick = now - this.drawnAt < DRAW_GAP;
    this.drawnAt = now;
    this.env.audio.play('weaponRaise', { volume: quick ? 0.35 : 0.6 });
  }

  // 返回从当前姿态收到底要多久：举得越高越久；到底时还带着速度，像把枪甩下去
  unequip() {
    this.stopInspect();
    this.reloading = false;
    this.quick = false;
    this.freeDip = 0;
    this.clearBuf();
    const d = this.down, left = clamp01(1 - d.x);
    const T = HOLSTER_T * (HOLSTER_MIN + (1 - HOLSTER_MIN) * left);
    d.to(1, T, (2 * left) / T);
    return T;
  }

  // 收到一半又切回来：从当前位置和当前速度举回去，收得越深举得越久。举枪声由 weapons.js 的切枪声代替。
  // min：途中至少沉到这么深（摇枪）。这一下是补出来给人看的，不占用开火，见 freeDip
  cancelUnequip(min = 0) {
    const d = this.down, T = RAISE_T * (0.45 + 0.55 * clamp01(Math.max(d.x, min)));
    this.freeDip = dipKick(d, min, T) ? min + 0.03 : 0;
    d.to(0, T);
  }

  // 左手扔烟雾弹：返回 { release, total }（秒），左手腾不出来时返回 null（weapons.js 会留着这次按键重试）
  offhandThrow() {
    if (this.offhand.active || this.down.target !== 0) return null;
    if (this.reloading) {
      // 弹匣还没抽出来就直接收掉换弹，rig 的 fade 把换弹姿态淡回去；抽出来以后就等换完
      if (this.reloadT >= MAG_OUT[this.reloadEmpty ? 'empty' : 'tactical'] - RELOAD_CANCEL) return null;
      this.reloading = false;
    }
    this.stopInspect();
    this.offhand.start();
    return { release: THROW.release, total: THROW.total };
  }

  startInspect() {
    this.inspectT = 0;
  }

  // 打断检视：这一刻的检视姿态交给 Carry 淡掉
  stopInspect() {
    if (this.inspectT < 0) return;
    this.carry.grab(this.rig.inspect(this.inspectT));
    this.inspectT = -1;
  }

  startReload() {
    if (this.reloading || this.mag >= MAG || this.reserve <= 0) return;
    this.stopInspect();
    this.reloading = true;
    this.reloadT = 0;
    this.reloadEmpty = this.mag === 0 || this.locked;
    const kind = this.reloadEmpty ? 'empty' : 'tactical';
    this.reloadEnd = RELOAD_END[kind];
    this.cues = CUES[kind];
  }

  fire() {
    const { env } = this, { vm, fx, audio, player } = env;
    this.stopInspect();
    this.mag--;
    this.cooldown += 60 / RPM;
    this.sinceShot = 0;
    const n = this.shots++;

    vm.aim(_o, _d);
    const spread = this.spreadRad();
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    _r.set(1, 0, 0).applyQuaternion(env.camera.quaternion);
    _u.set(0, 1, 0).applyQuaternion(env.camera.quaternion);
    _d.addScaledVector(_r, Math.cos(a) * r).addScaledVector(_u, Math.sin(a) * r).normalize();

    const hit = env.hitscan(_o, _d, RANGE);
    vm.toWorld(this.model.anchors.muzzle, _m);
    _end.copy(_o).addScaledVector(_d, hit ? hit.dist : 120);
    fx.muzzleFlash(_m, _d, 1);
    fx.tracer(_m, _end, {});
    if (hit?.enemy) {
      const r = env.strike(hit, DAMAGE, _d);
      env.hud.hitmarker(r.killed);
      audio.play(r.headshot ? 'headshot' : 'hitmarker', { volume: 0.5 });
    } else if (hit) {
      fx.impact(hit.point, hit.normal, hit.surface, { decal: true });
      audio.play(impactSound(hit.surface), { position: hit.point, volume: 0.8 });
      if (hit.surface === 'metal' && Math.random() < 0.3) audio.play('ricochet', { position: hit.point, volume: 0.5 });
    }
    vm.toWorld(this.model.anchors.eject, _e);
    _end.copy(player.velocity).addScaledVector(_r, 2.1 + Math.random() * 0.9).addScaledVector(_u, 1.3 + Math.random() * 0.8)
      .addScaledVector(_d, -0.3 + Math.random() * 0.8);
    fx.shell(_e, _end, _q.copy(env.camera.quaternion));
    audio.play('rifleShot', { volume: 0.9, pitch: 0.97 + Math.random() * 0.06 });

    // 后坐力：前几发直着往上跳，之后左右游走；开镜时整体收小。镜头的踢第 2 帧到顶、慢慢回（weapons.js 的 shotKick），
    // 每发累计的枪口上跳（climb）不变；枪往后顶得一发比一发分明。开镜时枪口上跳只留两成：镜头已经在踢，
    // 红点再跟着枪晃就压不住了
    const k = 1 - 0.45 * this.ads, climb = n < 8 ? 1 : 0.55;
    const side = this.sideDrift(n) + (Math.random() - 0.5) * 0.9;
    env.fireKick(1.34 * k * climb, side * 0.42 * k, 0.0045 * k * climb);
    vm.firePunch(1.75 * k, 0.125 * k, 0.75 * (1 - 0.8 * this.ads), side * 0.14 * k, (Math.random() - 0.5) * 0.9 * k);
    this.bloom = Math.min(1, this.bloom + 0.16);
    this.boltT = 1;
    this.locked = this.mag === 0;
  }

  // 第 n 发的横向游走量（±SIDE_AMP），第 0 发重抽格点
  sideDrift(n) {
    const keys = this.sideKeys;
    if (n === 0) {
      for (let i = 0; i < SIDE_KEYS; i++) {
        const u = Math.random() * 2 - 1;
        keys[i] = Math.sign(u) * Math.abs(u) ** 0.25 * SIDE_AMP;
      }
    }
    const x = n / SIDE_STEP, i = Math.floor(x), f = x - i, a = keys[i % SIDE_KEYS], b = keys[(i + 1) % SIDE_KEYS];
    return a + (b - a) * f * f * (3 - 2 * f);
  }

  // 散布只看地面上的走动：跳起、落地、滑铲、喷气都按站定算，准心不因此扩散
  spreadRad() {
    const move = this.moveSpread;
    const hip = 0.0085 + move + this.bloom * 0.02;
    const ads = 0.0009 + move * 0.25 + this.bloom * 0.004;
    return hip + (ads - hip) * this.ads;
  }

  update(dt, active) {
    const { env } = this, { input, player, audio } = env;
    this.seenAt = env.vm?.time;
    this.seenDt = dt;
    this.record(dt, input, player);
    const d = this.down;
    d.update(dt);
    follow(this.raiseW, d.target === 0 ? 1 : 0, 16, dt);
    follow(this.tuck, env.state?.tuck || 0, 38, dt);
    this.offhand.update(dt);
    this.carry.update(dt);
    // 举到位才能用；喷气切过来的那一下（quick）弹到位途中就能开火
    const raised = d.target === 0 && (d.x < 0.02 || d.x <= this.freeDip || (this.quick && d.x <= SNAP_DIP + 1e-3));
    const ready = active && raised && !this.offhand.active;
    // 不截断：这一发多等的那点时间记到下一发头上。扳机松开或打不了时在下面归零，闲着不会攒发
    this.cooldown -= dt;
    this.sinceShot += dt;
    if (this.sinceShot > 0.3) this.shots = 0;
    this.bloom = damp(this.bloom, 0, 5.5, dt);
    const walking = player.grounded && !player.dashing && !player.sliding ? Math.min(player.moveAmount, 1.4) * 0.011 : 0;
    this.moveSpread = damp(this.moveSpread, walking, 14, dt);
    // 冲刺中途开火或开镜（比如滑铲一出来就开枪）：枪从胸前收回腰射要快，枪口才对得上准心。
    // 放在扳机前面算，开火门槛看的就是这一帧画出来的枪
    const quick = active && (input.down('Mouse0') || input.down('Mouse2') || this.buf.fire > 0);
    this.run.update(dt, player, player.sprinting && !this.reloading, quick);
    this.sprintT = this.run.weight;

    if (this.inspectT >= 0) this.stepInspect(dt);
    if (this.inspectT >= 0 && (player.sprinting || this.tuck.x > 0.1)) this.stopInspect();
    if (ready) {
      const buf = this.buf;
      if (input.pressed('Backquote') && !this.reloading && this.inspectT < 0 && this.ads < 0.3) {
        // 冲刺会打断检视，所以先退出冲刺（按住式由 weapons.js 的 sprintBlock 在检视期间挡住）
        player.cancelSprint?.();
        this.startInspect();
      }
      if (buf.r > 0) {
        buf.r = 0;
        this.startReload();
      }
      if (buf.b > 0 && !this.reloading) {
        buf.b = 0;
        this.auto = !this.auto;
        this.selT = 0;
        this.modeDirty = true;
        audio.play('selector', { volume: 0.7 });
      }
      this.trigger(input, player);
    }
    this.cooldown = Math.max(0, this.cooldown);
    const wantAds = ready && input.down('Mouse2') && !this.reloading && !player.sprinting;
    if (wantAds) this.stopInspect();
    this.ads = damp(this.ads, wantAds ? 1 : 0, wantAds ? 15 : 12, dt);
    if (this.ads < 0.002 && !wantAds) this.ads = 0;
    follow(this.runK, 1 - smooth(this.ads), 30, dt);
    this.model.setAim?.(this.ads); // 模型按开镜程度藏掉会挡视线的后半截（枪托一带）
    this.speedScale = this.reloading ? 0.92 : 1;
    this.spread = (Math.tan(this.spreadRad()) / Math.tan(THREE.MathUtils.degToRad(env.camera.fov * 0.5))) * window.innerHeight * 0.5;
    this.crosshair = this.ads < 0.4 && !player.sprinting && !this.reloading;

    if (this.reloading) this.stepReload(dt);
    this.rig.pose(this, player, dt);
    this.rig.parts(this, dt, active && ready && input.down('Mouse0') && this.mag > 0 && !this.reloading);
  }

  // 记下这一帧按的键。看 input.active 而不是 update 的 active：收枪、喷气收枪时后者是 false，这时按的也要记
  record(dt, input, player) {
    const b = this.buf;
    b.r -= dt;
    b.b -= dt;
    b.fire -= dt;
    if (!player.alive) this.clearBuf();
    else if (input.active) {
      if (input.pressed('KeyR')) b.r = BUF_KEY;
      if (input.pressed('KeyB')) b.b = BUF_KEY;
      if (input.pressed('Mouse0')) b.fire = BUF;
    }
  }

  clearBuf() { this.buf.r = this.buf.b = this.buf.fire = 0; }

  // 扳机。全自动按住连发，一帧里按下又松开也算一发（走缓冲）；单发一帧最多一发。
  // 冲刺姿态没退到 RUN_READY 以下先不打，按键留着，枪一到位就出膛
  trigger(input, player) {
    const buf = this.buf, pull = buf.fire > 0, held = this.auto && input.down('Mouse0');
    if (!(held || pull) || this.reloading || player.sprinting || this.run.weight >= RUN_READY || this.cooldown > 0) return;
    buf.fire = 0;
    if (this.mag > 0 && !this.locked) {
      let n = 0;
      do this.fire();
      while (held && ++n < CATCH_UP && this.cooldown <= 0 && this.mag > 0);
    } else if (pull) {
      if (this.mag > 0) {
        // 空仓换弹在入匣之后被切枪打断：匣里有弹、枪机还挂着，这一下先放枪机
        this.releaseBolt();
        this.cooldown = 0.2;
      } else {
        this.env.audio.play('rifleDry', { volume: 0.7 });
        this.startReload();
      }
    }
  }

  stepInspect(dt) {
    const before = this.inspectT;
    this.inspectT += dt;
    for (const [t, name, volume] of INSPECT_CUES) {
      if (before < t && this.inspectT >= t) this.env.audio.play(name, { volume });
    }
    if (this.inspectT >= INSPECT_T) this.inspectT = -1;
  }

  stepReload(dt) {
    const before = this.reloadT;
    this.reloadT += dt;
    for (let i = 0; i < this.cues.length; i++) {
      const t = this.cues[i][0], name = this.cues[i][1];
      if (before >= t || this.reloadT < t) continue;
      if (name === 'boltRelease') { this.releaseBolt(); continue; }
      this.env.audio.play(name, { volume: 0.8 });
      if (name === 'magOut' && this.reloadEmpty) {
        if (!this.magGone) this.dropPending = true;
        this.magGone = true;
      }
      if (name === 'magIn') {
        this.magGone = false;
        const need = Math.min(MAG - this.mag, this.reserve);
        this.mag += need;
        this.reserve -= need;
        this.env.vm.punch(0, 0.05, 0.12, 0, 0.1);
      }
    }
    if (this.reloadT >= this.reloadEnd) {
      this.reloading = false;
      if (!this.reloadEmpty) this.locked = false;
    }
  }

  // 放枪机：挂机解除，枪机猛地冲回去
  releaseBolt() {
    this.locked = false;
    this.boltDrop = 1;
    this.env.audio.play('boltRelease', { volume: 0.8 });
    this.env.vm.punch(0.1, 0, 0.06, 0, -0.2);
  }

  // 相机和骨架都更新完之后：脱落的旧弹匣、扔东西的左手、红点、激光点
  late() {
    const { env } = this;
    if (this.dropPending) {
      this.dropPending = false;
      dropMag(env, this.model, this.rig.base.mag);
    }
    this.offhand.late(env.camera);
    // 红点只在枪举到位时画：收枪一开始就关，枪放低的途中不会闪一下
    const up = 1 - smooth(this.down.x / 0.12), tuck = clamp01(this.tuck.x);
    const drawn = up * (1 - tuck);
    this.reticle.update(env.vm, this.model.anchors.sight, this.model.sight, this.holder.visible ? drawn : 0);
    // 激光点：腰射才有，开镜淡掉；收枪、喷气、左手离枪时不画（换弹、检视、冲刺时枪口偏离归零线，激光模块自己会淡掉）
    const hip = 1 - smooth(this.ads * 1.6);
    const vis = env.vm?.root.visible ? hip * up * (1 - tuck) * (1 - this.offhand.off) : 0;
    this.laser.update(vis, this.holder);
  }
}
