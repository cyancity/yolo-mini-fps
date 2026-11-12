import * as THREE from 'three';
import { ViewModel } from './viewmodel.js';
import { Spring, damp } from './anim.js';
import { Rifle } from './rifle.js';
import { Knife } from './knife.js';

const _neg = new THREE.Vector3();
// 喷气结束后枪还要收在身前这么久才能开火、开镜；喷气途中切枪可以跳过这段
const TUCK_AFTER = 0.26;
// 武器没有做副手投掷动作时用的出手和收手时刻
const PLAIN_THROW = { release: 0.1, total: 0.25 };
// 摇枪：收枪刚起步就切回来时，枪至少沉下去全程的这个比例再举回来。键盘一次按压连发 3、1 时
// 两个键几乎没有间隔，不设这个下限枪基本不动
const WIGGLE_MIN = 0.11;

// 武器栏：1 = 步枪，3 = 爪刀，滚轮切换。负责切枪过渡、视角后坐力和 HUD 同步。
export class Weapons {
  constructor(o) {
    this.o = o;
    this.player = o.player;
    this.input = o.input;
    this.hud = o.hud;
    this.vm = new ViewModel(o.camera, o.pipeline);
    this.viewKick = new Spring(2, 110, 15);
    // 步枪开火的镜头踢（0 俯仰，1 偏航）：过阻尼，两个衰减率约 5.5 和 54.5 每秒，第 2 帧到顶、之后慢慢回。
    // 冲量给原来那根软弹簧（110, 15）的 4.19 倍：单发的峰值、连发时每发出膛那一刻压在镜头上的量都和原来一样，只是不再拖 6 帧才到顶
    this.shotKick = new Spring(2, 300, 60);
    // 给各武器读的公共状态。tuck：0..1，喷气时枪收在身前的程度
    this.state = { tuck: 0 };
    this.tuckT = 0;
    this.tuckFree = false;
    this.wasDash = false;
    this.throwT = -1; // 副手投掷进行了多久，-1 = 没在投
    this.throwRelease = this.throwTotal = 0;
    this.onRelease = null;
    this.queued = 0; // 左手的东西还没出手时按下的切枪键，出手后再执行
    const env = {
      ...o, vm: this.vm, gear: o.mats.gear(true), state: this.state,
      hitscan: (origin, dir, range) => this.hitscan(origin, dir, range),
      strike: (hit, damage, dir, opts) => this.strike(hit, damage, dir, opts),
      kickView: (pitch, yaw, climb = 0) => {
        this.viewKick.kick(0, pitch);
        this.viewKick.kick(1, yaw);
        this.player.pitch = Math.min(1.52, this.player.pitch + climb);
      },
      // 步枪开火：同 kickView，走 shotKick
      fireKick: (pitch, yaw, climb = 0) => {
        this.shotKick.kick(0, pitch);
        this.shotKick.kick(1, yaw);
        this.player.pitch = Math.min(1.52, this.player.pitch + climb);
      },
    };
    this.rifle = new Rifle(env);
    this.knife = new Knife(env);
    this.slots = { 1: this.rifle, 3: this.knife };
    for (const w of [this.rifle, this.knife]) {
      this.vm.kick.add(w.holder);
      this.vm.prepare(w.holder);
      w.holder.visible = false;
    }
    this.current = this.rifle;
    this.last = this.knife;
    this.next = null;
    this.switchT = 0;
    this.lastMag = 0;
    this.onShot = null; // 开了一枪：敌人据此听到枪声
    this.onHit = null;  // 子弹或刀打中敌人、靶子：{ kind, part, killed, headshot }，每次命中一次
  }

  get ads() { return this.current.ads; }

  setVisible(v) {
    this.vm.root.visible = v;
    if (!v) {
      this.rifle.reticle.mesh.visible = false;
      this.rifle.laser.hide();
    }
  }

  reset() {
    this.rifle.reset();
    this.knife.reset();
    this.viewKick.reset();
    this.shotKick.reset();
    this.vm.resetRecoil();
    this.rifle.holder.visible = this.knife.holder.visible = false;
    this.current = this.rifle;
    this.last = this.knife;
    this.next = null;
    this.tuckT = this.state.tuck = 0;
    this.tuckFree = false;
    this.throwT = -1;
    this.onRelease = null;
    this.queued = 0;
    this.current.equip();
    this.syncHud();
  }

  resupply() { this.rifle.resupply(); }

  // 切枪。约定各武器实现（都可缺省）：unequip() 返回从当前姿态收到底要多久；
  // cancelUnequip(min) 从收到一半的位置直接举回来，途中至少沉到 min（0..1，收到底是 1）；
  // equip({ instant: true }) 不播举枪动作，立刻可用
  select(slot) {
    const w = this.slots[slot];
    if (!w) return;
    // 左手的东西还没扔出去：先记下，出手后再切（最多等 0.25 秒），不然左手会带着它跟武器一起消失
    if (this.throwT >= 0 && this.throwT < this.throwRelease) { this.queued = slot; return; }
    if (this.player.dashing || this.tuckT > 0) return this.swapNow(w);
    if (this.next) {
      if (w === this.next) return;
      // 收枪途中又按回原来那把：取消收枪，从当前位置举回来。连点 1、3 时看起来就是一直在摇枪
      this.next = null;
      if (this.current.cancelUnequip) this.current.cancelUnequip(WIGGLE_MIN);
      else this.current.equip();
      this.o.audio.play('weaponSwitch', { volume: 0.5, pitch: 1.08 });
      return;
    }
    if (w === this.current) return;
    this.switchT = this.current.unequip();
    this.next = w;
    this.o.audio.play('weaponSwitch', { volume: 0.55 });
  }

  // 喷气途中切枪：不走收枪和举枪，瞬间换好，并且解除喷气后的收枪硬直。
  // 切刀再切回枪（3、1）就能比等喷气结束更早开镜
  swapNow(w) {
    if (w === this.current && !this.next) return;
    this.current.holder.visible = false;
    if (w !== this.current) this.last = this.current;
    this.current = w;
    this.next = null;
    this.current.equip({ instant: true });
    this.tuckFree = true;
    this.state.tuck = 0;
    this.syncHud();
    this.o.audio.play('weaponSwitch', { volume: 0.55, pitch: 1.15 });
  }

  // 副手投掷（烟雾弹）：左手离开武器，单手把东西扔出去。onRelease 在出手那一刻调用。
  // 约定武器实现 offhandThrow()（可缺省）：开始播左手的投掷动作，返回 { release, total }（秒，
  // 出手的时刻和左手回到武器上的时刻）；左手腾不出来（比如正在换弹）就返回 null，这次不扔
  throwOffhand(onRelease) {
    if (this.throwT >= 0 || this.next) return false;
    const w = this.current;
    const t = w.offhandThrow ? w.offhandThrow() : PLAIN_THROW;
    if (!t) return false;
    this.throwT = 0;
    this.throwRelease = t.release;
    this.throwTotal = t.total;
    this.onRelease = onRelease;
    return true;
  }

  get throwing() { return this.throwT >= 0; }

  // 子弹和刀都走这里：世界碰撞体和各类敌人取最近的那个。
  // 打中敌人时返回 { enemy: { group, target, part, kind }, point, dist, normal, surface }
  hitscan(origin, dir, range) {
    const world = this.o.phys.raycast(origin, dir, range);
    let dist = world ? world.dist : range, best = null, owner = null;
    for (const group of this.o.enemies) {
      const hit = group.raycast(origin, dir, dist);
      if (hit && hit.dist <= dist) { dist = hit.dist; best = hit; owner = group; }
    }
    if (!best) return world;
    return {
      enemy: { group: owner, target: best.target || best.drone, part: best.part || 'body', kind: owner.kind },
      point: best.point, dist: best.dist, normal: _neg.copy(dir).negate().clone(), surface: owner.kind === 'soldier' ? 'flesh' : 'metal',
    };
  }

  // 结算一次命中（特效和音效由敌人自己出）；返回 { killed, headshot }。opts 原样交给敌人（{ silent } 不放中弹声，刀用）
  strike(hit, damage, dir, opts) {
    const e = hit.enemy;
    const r = e.group.hit(e.target, damage, hit.point, dir, e.part, opts);
    const killed = r === true || !!r?.killed, headshot = !!r?.headshot;
    this.onHit?.({ kind: e.kind, part: e.part, killed, headshot });
    return { killed, headshot };
  }

  syncHud() {
    const w = this.current;
    this.hud.setWeapon(w.slot, w.name, w.mode);
  }

  update(dt, active) {
    const { input, player, hud } = this;
    if (player.dashing && !this.wasDash) this.tuckFree = false;
    this.wasDash = player.dashing;
    this.tuckT = player.dashing ? TUCK_AFTER : Math.max(0, this.tuckT - dt);
    const tucked = !this.tuckFree && (player.dashing || this.tuckT > 0);
    this.state.tuck = damp(this.state.tuck, tucked ? 1 : 0, tucked ? 26 : 13, dt);
    if (active) {
      // 按按下的先后处理：同一帧里先 3 后 1 是摇一下枪还留在手上，先 1 后 3 是换成刀
      for (const code of input.seq || input.hit) {
        if (code === 'Digit1') this.select(1);
        else if (code === 'Digit3') this.select(3);
      }
      if (input.wheel !== 0) this.select((this.next || this.current) === this.rifle ? 3 : 1);
    }
    if (this.throwT >= 0) {
      this.throwT += dt;
      if (this.onRelease && this.throwT >= this.throwRelease) {
        const cb = this.onRelease;
        this.onRelease = null;
        cb();
      }
      if (this.queued && this.throwT >= this.throwRelease) {
        const slot = this.queued;
        this.queued = 0;
        this.select(slot);
      }
      if (this.throwT >= this.throwTotal) this.throwT = -1;
    }
    if (this.next) {
      this.switchT -= dt;
      if (this.switchT <= 0) {
        this.current.holder.visible = false;
        this.last = this.current;
        this.current = this.next;
        this.next = null;
        this.current.equip();
        this.syncHud();
      }
    }
    const w = this.current, rifle = w === this.rifle;
    this.lastMag = this.rifle.mag;
    // 步枪要开火（含还没打出去的缓冲）或开镜：这一帧就退出冲刺，枪马上开始往回收
    const gun = active && rifle && (input.down('Mouse0') || input.down('Mouse2') || input.pressed('Mouse0') || this.rifle.buf.fire > 0);
    if (gun) player.cancelSprint();
    w.update(dt, active && !this.next && !tucked);
    // 按住式冲刺：开火、开镜、检视期间不许跑，松开后 Shift 还按着就接着跑。检视途中新按下 Shift 算想跑，由冲刺打断检视
    player.sprintBlock = gun || (active && rifle && this.rifle.inspectT >= 0 && !input.pressed('ShiftLeft'));
    for (let m = this.lastMag; m > this.rifle.mag; m--) this.onShot?.();
    player.ads = w.ads;
    player.speedScale = w.speedScale;
    player.canSprint = w.canSprint;

    this.viewKick.update(dt);
    this.shotKick.update(dt);
    player.kick.pitch = this.viewKick.x[0] + this.shotKick.x[0];
    player.kick.yaw = this.viewKick.x[1] + this.shotKick.x[1];
    this.vm.update(dt, player, w.ads);
    w.late?.(dt);

    hud.setAmmo(w.mag, w.reserve);
    hud.setCrosshair({ spread: w.spread, visible: w.crosshair });
    hud.setReloading(w.reloading, w.reloadProgress);
    if (w.modeDirty) { w.modeDirty = false; this.syncHud(); }
  }
}
