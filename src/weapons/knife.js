import * as THREE from 'three';
import { buildKarambit } from './knife_model.js';
import { KnifeFx, warmUp } from './knife_fx.js';
import { buildArm, applyHold } from './hands.js';
import { track, addPose, applyPose, clamp01, dipKick } from './anim.js';
import { KnifeToss, THROW } from './knife_throw.js';
import { KNIFE_TUNE, MOVES, DRAW, DRAW_T, HOLSTER_T, HOLSTER_MIN, RAISE_T, SNAP_T, SNAP_DIP, Glide, follow, spline } from './knife_anim.js';
import { knifeHitSound } from '../audio/table.js';

export { KNIFE_TUNE };

const RANGE = 2.15;
// 上一个动作收尾到这个时间以内就能接下一个；被打断时还没归位的那点姿态用 CARRY 秒淡掉
const CHAIN = 0.08, CARRY = 0.12;
const FAN = [0, -0.16, 0.16, -0.32, 0.32];
// 收刀的终点 = 掏刀的起点（画面外）
const DOWN = DRAW.pose[0][1];
// 掏刀后这么久才出转刀声，这之前就被收回去的不放；DRAW_GAP 秒内又掏一次（连着切枪）的掏刀声压低
const SPIN_CUE = 0.08, DRAW_GAP = 0.6;

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _ray = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _view = new THREE.Vector3(0, 0, 1), _q = new THREE.Quaternion();
const _pose = [0, 0, 0, 0, 0, 0], _tmp = [0, 0, 0, 0, 0, 0];
const smooth = (x) => x * x * (3 - 2 * x);

export class Knife {
  constructor(env) {
    this.env = env;
    this.slot = 3;
    this.name = '爪刀';
    this.mode = '';
    this.mag = null;
    this.reserve = null;
    this.reloading = false;
    this.reloadProgress = 0;
    this.ads = 0;
    this.speedScale = 1.1;
    this.canSprint = true;
    this.crosshair = true;
    this.spread = 6;
    this.holder = new THREE.Group();
    this.arm = buildArm(env.gear, 'R');
    this.holder.add(this.arm.root);
    this.model = buildKarambit(env.gear);
    // 刀座：applyHold 把握持物坐标摆进掌心锚点（握柄横在掌心，指环在食指一侧）；mount 留给 KNIFE_TUNE.twist 微调。
    // 刀模型的 root 原点就是握柄锚点，直接挂上去
    this.seat = applyHold(new THREE.Group(), 'knife');
    this.mount = new THREE.Group();
    this.arm.anchors.palm.add(this.seat);
    this.seat.add(this.mount);
    this.mount.add(this.model.root);
    this.carry = [0, 0, 0, 0, 0, 0];
    // 收刀程度：0 = 举着，1 = 收到底（DOWN，画面外）。收刀、取消收刀、喷气切枪都只是给它换个目标
    this.down = new Glide(0);
    // 冲刺摆臂的程度、喷气收刀的程度：都做二阶平滑，起步那一帧不会猛地一跳
    this.run = { x: 0, v: 0 };
    this.tuck = { x: 0, v: 0 };
    this.clock = 0;
    this.skin = 'steel';
    // 绿宝石涂装的粒子，以及让两套涂装和粒子的着色器提前编译的预热件（预览页没有相机，不需要）
    this.fx = new KnifeFx(env.gear, this.model, this.holder, this.model.gem);
    this.warm = env.camera ? warmUp(env.camera, [...this.model.materials, this.fx.material]) : null;
    // 扔烟雾弹用的左手，平时在画面外（预览页没有相机，不建）
    this.toss = env.camera ? new KnifeToss(env, this.holder) : null;
    this.arm.setPose('knife');
    this.reset();
  }

  reset() {
    this.drawT = DRAW_T;
    this.down.set(0);
    this.move = null;
    this.moveName = '';
    this.moveT = 0;
    this.didHit = false;
    this.didSound = false;
    this.cue = 0;
    this.next = 'slashA';
    this.heavyBuf = 0; // 动作没做完时按的右键重击留 0.2 秒，能接上时再出
    this.run.x = this.run.v = 0;
    this.tuck.x = this.tuck.v = 0;
    this.sprintT = 0;
    this.runPhase = 0;
    this.cadence = 0;
    this.strideAt = this.env.player.stride || 0;
    this.ghost = null;
    this.ghostT = 0;
    this.open = 0;
    this.spin = 0;
    this.spinRate = 0;
    this.carryT = CARRY;
    this.carrySpin = 0;
    this.carryOpen = 0;
    this.spinCue = false;
    this.drawnAt = -10;
    this.seenAt = NaN;
    this.seenDt = 0;
    this.arm.setPose('knife');
    this.fx.clear();
    this.warm?.arm();
    this.toss?.stop();
  }

  // 'steel' 钢色 / 'emerald' 绿宝石。两套网格和着色器开局都备好了，这里只切显隐
  setSkin(name) {
    this.skin = name === 'emerald' ? 'emerald' : 'steel';
    this.model.setSkin(this.skin);
    this.fx.setActive(this.skin === 'emerald');
  }

  // 两把武器共用的时钟（视图模型的）；预览页里没有，就用自己的
  now() { return this.env.vm.time ?? this.clock; }

  // 上一帧这把刀有没有被更新过，也就是还在不在画面里。weapons.js 每帧只更新当前那把
  live() { return this.env.vm.time === this.seenAt + this.seenDt; }

  // instant：喷气途中切过来，不播掏刀动作，立刻可用
  equip({ instant = false } = {}) {
    const live = this.live();
    this.holder.visible = true;
    this.heavyBuf = 0;
    if (live) this.stash();
    else {
      // 刚才不在画面里：上次留下的残余姿态都作废，喷气收刀的程度直接取现在的值
      this.carryT = CARRY;
      this.ghost = null;
      this.tuck.x = this.env.state?.tuck || 0;
      this.tuck.v = 0;
      this.fx.clear();
      this.toss?.stop();
    }
    this.move = null;
    this.spinCue = false;
    if (instant) {
      // 刀从略低一点的位置弹到位（先快后慢），不是凭空出现在手里；本来就在画面里（收到一半）的话接着当前位置举回来
      if (!live) {
        this.down.set(SNAP_DIP);
        this.down.v = -2 * SNAP_DIP / SNAP_T;
      }
      this.drawT = DRAW_T;
      this.down.to(0, SNAP_T * (0.6 + 0.4 * clamp01(this.down.x / SNAP_DIP)));
      this.fx.burst(9);
      return;
    }
    this.drawT = 0;
    this.down.set(0);
    const now = this.now(), quick = now - this.drawnAt < DRAW_GAP;
    this.drawnAt = now;
    this.env.audio.play('knifeDraw', { volume: quick ? 0.4 : 0.7 });
    this.spinCue = true;
  }

  // 刀举到了几成：看手腕离收到底的位置还差多少（掏刀没走完的那段和已经收下去的那段一起算）
  raised() {
    const h = this.down.x, dy = spline(DRAW.pose, this.drawT, _tmp)[1] * (1 - h) + DOWN[1] * h;
    return clamp01(1 - dy / DOWN[1]);
  }

  // 返回从当前姿态收到底要多久：举得越高越久，刚露头就收的几帧就下去
  unequip() {
    this.stash();
    this.move = null;
    this.spinCue = false;
    this.heavyBuf = 0;
    const T = HOLSTER_T * (HOLSTER_MIN + (1 - HOLSTER_MIN) * this.raised());
    // 到底时还带着速度：先慢后快，像把刀甩下去（从静止收就是原来的 h²）
    this.down.to(1, T, 2 * Math.max(0, 1 - this.down.x) / T);
    return T;
  }

  // 收到一半又切回来：从当前位置和当前速度举回去，收得越深举得越久。min：途中至少沉到这么深（摇刀）
  cancelUnequip(min = 0) {
    const d = this.down, T = RAISE_T * (0.45 + 0.55 * clamp01(Math.max(d.x, min)));
    dipKick(d, min, T);
    d.to(0, T);
  }

  // 左手扔烟雾弹：刀在右手，左手随时腾得出来，挥到一半也能扔；正在收刀时不扔。返回 { release, total }（秒）或 null
  offhandThrow() {
    const toss = this.toss;
    if (!toss || toss.active || this.down.target !== 0) return null;
    toss.start();
    return { release: THROW.release, total: THROW.total };
  }

  // 相机和刀的姿态都更新完之后：扔东西的左手
  late() { this.toss?.late(this.env.camera); }

  // 打断当前动作：它不立刻停，接着往下走（ghost），权重在 CARRY 秒里淡到 0，位置和速度都不跳。
  // 划到一半切枪时，看到的是刀顺着原来的弧线收下去。转刀角和张开的手指记下残余量淡出
  stash() {
    const m = this.move, w = this.carryT < CARRY ? 1 - smooth(this.carryT / CARRY) : 0;
    for (let i = 0; i < 6; i++) this.carry[i] *= w;
    // 上一个还没淡完的动作：此刻剩下的那点并进 carry
    if (this.ghost && w > 0) addPose(this.carry, spline(this.ghost.pose, this.ghostT, _tmp), w);
    this.carrySpin *= w;
    this.carryOpen *= w;
    this.ghost = m;
    this.ghostT = this.moveT;
    if (m && m.spin) {
      // 转刀转到一半：就近转完这一圈
      const a = track(m.spin, this.moveT) % (Math.PI * 2);
      this.carrySpin += a > Math.PI ? a - Math.PI * 2 : a;
      this.carryOpen = Math.max(this.carryOpen, track(m.open, this.moveT));
    }
    this.carryT = 0;
  }

  start(name) {
    this.stash();
    this.move = MOVES[name];
    this.moveName = name;
    this.moveT = 0;
    this.didHit = false;
    this.didSound = false;
    this.cue = 0;
  }

  strike() {
    const { env } = this, { vm, fx, audio } = env, m = this.move;
    vm.aim(_o, _d);
    let best = null;
    for (const yaw of FAN) {
      _ray.copy(_d).applyAxisAngle(_up, yaw);
      const hit = env.hitscan(_o, _ray, RANGE);
      if (hit && (!best || (hit.enemy && !best.enemy) || (!!hit.enemy === !!best.enemy && hit.dist < best.dist))) best = hit;
      if (best?.enemy) break;
    }
    if (!best) return;
    if (best.enemy) {
      const metal = best.enemy.kind !== 'soldier';
      // silent：刀伤的声音就是下面这一声，敌人那边不再叠一声中弹
      env.hud.hitmarker(env.strike(best, m.dmg, _d, { silent: true }).killed);
      if (metal) fx.sparks(best.point, best.normal, 14);
      audio.play(metal ? 'knifeHitMetal' : 'knifeHitSoft', { position: best.point, volume: 0.9 });
    } else {
      fx.slash(best.point, best.normal, best.surface);
      audio.play(knifeHitSound(best.surface), { position: best.point, volume: 0.8 });
    }
    vm.punch(m.punch[0], m.punch[1], m.punch[2], m.punch[3], m.punch[4]);
    env.kickView(m.kick[0], m.kick[1]);
  }

  update(dt, active) {
    const { env } = this, { input, player, audio } = env;
    this.clock += dt;
    this.seenAt = env.vm.time;
    this.seenDt = dt;
    this.drawT = Math.min(DRAW_T, this.drawT + dt);
    this.down.update(dt);
    this.carryT = Math.min(CARRY, this.carryT + dt);
    if (this.carryT >= CARRY) this.ghost = null;
    else this.ghostT += dt;
    if (this.spinCue && this.drawT >= SPIN_CUE) {
      this.spinCue = false;
      audio.play('knifeSpin', { volume: 0.5 });
    }
    // 取消收刀后举回一多半就能出手，不用等完全到位
    const ready = active && this.drawT >= DRAW_T * 0.8 && this.down.target === 0 && this.down.x < 0.4;
    const free = !this.move || this.move.cancel || this.moveT > this.move.t - CHAIN;
    // 看 input.active 而不是 active：收刀、喷气收刀时按的也要记
    this.heavyBuf = !player.alive ? 0 : input.active && input.pressed('Mouse2') ? 0.2 : this.heavyBuf - dt;

    if (ready && free) {
      if (input.down('Mouse0')) {
        this.start(this.next);
        this.next = this.next === 'slashA' ? 'slashB' : 'slashA';
      } else if (this.heavyBuf > 0) {
        this.heavyBuf = 0;
        this.start('heavy');
      }
      else if (input.pressed('Backquote') && !this.move) this.start('inspect');
    }
    const m = this.move;
    if (m) {
      this.moveT += dt;
      if (m.sound !== undefined && !this.didSound && this.moveT >= m.sound) {
        this.didSound = true;
        audio.play('knifeSwing', { volume: 0.7, pitch: m.pitch || 1 + Math.random() * 0.1 });
        env.kickView(m.swing[0], m.swing[1]);
        this.fx.swing(m === MOVES.heavy ? 20 : 12, m === MOVES.heavy ? 0.16 : 0.11);
      }
      while (m.cues && this.cue < m.cues.length && this.moveT >= m.cues[this.cue][0]) {
        const c = m.cues[this.cue++];
        audio.play(c[1], { volume: c[2] });
      }
      if (m.hit !== undefined && !this.didHit && this.moveT >= m.hit) {
        this.didHit = true;
        this.strike();
      }
      if (this.moveT >= m.t) this.move = null;
    }
    const busy = this.move && !this.move.cancel;
    this.sprintT = follow(this.run, player.sprinting && !busy ? 1 : 0, 13, dt);
    // 摆臂的相位跟着 player.stride 走：正常步频两步摆一个来回；步频太密（每秒五步以上）时放慢到四步一个来回，
    // 不然胳膊一秒抡三个来回，看着像抽搐
    const stride = player.stride || 0, ds = stride - this.strideAt;
    this.strideAt = stride;
    if (ds > 0 && ds < 1 && dt > 0) {
      this.cadence += (ds / dt - this.cadence) * Math.min(1, dt * 6);
      this.runPhase += Math.PI * ds * (1 - 0.5 * smooth(clamp01((this.cadence - 4) / 1.2)));
    }
    follow(this.tuck, env.state?.tuck || 0, 38, dt);
    this.toss?.update(dt);
    this.crosshair = !player.sprinting;
    this.animate(dt);
    this.fx.update(dt, this);
  }

  animate(dt = 0) {
    const T = KNIFE_TUNE, m = this.move, player = this.env.player;
    const slide = player.slide || 0, lean = player.lean || 0;
    const tuck = this.tuck.x, dashS = (player.dashS || 0) * tuck, h = this.down.x;
    for (let i = 0; i < 6; i++) _pose[i] = T.idle[i];
    addPose(_pose, T.sprint, this.sprintT);
    const k = this.sprintT * Math.min(1, player.moveAmount ?? 1);
    if (Math.abs(k) > 1e-4) {
      const ph = this.runPhase;
      addPose(_pose, T.run.swing, Math.sin(ph) * k);
      addPose(_pose, T.run.lag, Math.cos(ph) * k);
      addPose(_pose, T.run.bounce, Math.cos(2 * ph) * k);
    }
    addPose(_pose, T.slide, slide);
    addPose(_pose, T.lean, lean);
    addPose(_pose, T.tuck, tuck);
    addPose(_pose, T.dashLean, dashS);
    if (this.toss?.active) addPose(_pose, T.toss, this.toss.sag);
    // 掏刀没走完的那段随着收刀淡掉：收到底时正好是 DOWN，不会比它更远
    addPose(_pose, spline(DRAW.pose, this.drawT, _tmp), 1 - h);
    addPose(_pose, DOWN, h);
    let spin = track(DRAW.spin, this.drawT), open = track(DRAW.open, this.drawT);
    if (m) {
      addPose(_pose, spline(m.pose, this.moveT, _tmp));
      if (m.spin) { spin += track(m.spin, this.moveT); open = Math.max(open, track(m.open, this.moveT)); }
    }
    if (this.carryT < CARRY) {
      const w = 1 - smooth(this.carryT / CARRY);
      addPose(_pose, this.carry, w);
      if (this.ghost) addPose(_pose, spline(this.ghost.pose, this.ghostT, _tmp), w);
      spin += this.carrySpin * w;
      open = Math.max(open, this.carryOpen * w);
    }
    applyPose(this.holder, _pose);
    const roll = T.leanRoll * lean + T.slideRoll * slide + T.dashRoll * dashS;
    if (roll !== 0) {
      _q.setFromAxisAngle(_view, roll);
      this.holder.position.applyQuaternion(_q);
      this.holder.quaternion.premultiply(_q);
    }
    this.spinRate = dt > 0 ? Math.abs(spin - this.spin) / dt : 0;
    this.spin = spin;
    this.model.spin.rotation.x = spin;
    this.mount.rotation.set(T.twist[0], T.twist[1], T.twist[2]);
    // 转刀时松开四指，只留食指穿在指环里
    const o = clamp01(open);
    if (Math.abs(o - this.open) > 0.01 || (o === 0 && this.open !== 0)) {
      this.open = o;
      this.arm.setPose('knife');
      if (o > 0) this.arm.setPose('knifeOpen', o);
    }
  }
}
