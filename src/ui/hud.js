// 画布上层的 HUD 和菜单。节点在构造时一次建好，之后只改文本、属性和 CSS 变量；
// 每帧都会被调用的方法先和上次写入的值比较，没变就不碰 DOM。样式在 hud.css，由页面引入。
// tokens.css 由页面在 hud.css 前面用 <link> 引入（index.html、dev/hud.html）
import {
  TEMPLATE, MENUS, MENU_PARTS, MODE_SWITCH, COMPASS_FROM, COMPASS_SPAN, COMPASS_VIEW, CONFIRM, STATS, KILLER,
} from './hud_template.js';
import { buildSettings } from './hud_settings.js';
import { KillFeedback } from './hud_kill.js';
import { Abilities, RangeStats, CompassMarks, pct } from './hud_status.js';
import { bindUiSounds } from './hud_sound.js';

const LOW_HEALTH = 30;
const LOW_AMMO_RATIO = 0.2;
const LOW_AMMO_MIN = 3;
// 菜单弹出后这段时间内不认键盘触发的按钮点击：玩家按住的空格会连发 keydown，落到刚聚焦的按钮上
const KEY_GUARD_MS = 250;
// 二次确认：第一次点击后按钮换成确认的说法，停这么久没再点就恢复
const CONFIRM_MS = 3000;

const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0));
// 存活时间：分:秒
const clock = (sec) => {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
// 受击弧跟着视角转时，角度变化小于这个数（弧度）就不写 DOM
const ARC_EPS = 0.01;
let instances = 0;

export class Hud {
  constructor(root) {
    const layer = document.createElement('div');
    layer.className = 'hud';
    layer.innerHTML = TEMPLATE;
    root.append(layer);

    this.layer = layer;
    this.el = {};
    for (const node of layer.querySelectorAll('[data-ref]')) this.el[node.dataset.ref] = node;
    this.slots = [...this.el.slots.children];
    // 每段弧记着来源坐标和消失的时刻，updateArcs 每帧按玩家朝向重算
    this.arcs = [...this.el.dmg.children].map((el) => ({ el, x: 0, z: 0, has: false, until: 0, a: 0 }));
    this.arcMs = 0;

    this.v = { menu: 'hidden' }; // 上次写进 DOM 的值
    this.magMax = {}; // 每个栏位见过的最大弹匣数，用来判断「快打空了」
    this.arcNext = 0;
    this.noticeTimer = 0;
    this.menuAt = 0;
    this.fpsOn = false;
    this.listeners = {};
    this.mode = 'waves';
    this.number = new Intl.NumberFormat('zh-CN');
    this.killFx = new KillFeedback(this.el, this.number);
    this.abilities = new Abilities(this.el.abilities);
    this.range = new RangeStats(this.el);
    this.marks = new CompassMarks(this.el.marks, COMPASS_VIEW);
    this.statRows = [...this.el.stats.children].map((row) => ({ el: row, dt: row.firstElementChild, dd: row.lastElementChild }));
    this.runWave = 0;
    this.armed = null;
    this.armTimer = 0;

    const id = (this.id = `hud-${++instances}`);
    this.el.title.id = `${id}-title`;
    this.el.menu.setAttribute('aria-labelledby', this.el.title.id);
    // 动态效果：没接设置时跟系统偏好，bindSettings 之后跟「动态效果」设置。hud.css 里减弱档的规则都挂在这个属性上
    layer.dataset.motion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';

    for (const which of ['button', 'again', 'alt']) this.el[which].addEventListener('click', (e) => this.onButton(e, which));
    bindUiSounds(this, KEY_GUARD_MS); // 发 'uiHover'、'uiClick'，游戏接到音效上

    this.setMode('waves');
    this.setCompass(0);
  }

  // ---------- 对局信息 ----------

  setWeapon(slot, name, mode = '') {
    const v = this.v;
    if (slot !== v.slot) {
      v.slot = slot;
      for (const el of this.slots) el.toggleAttribute('data-active', Number(el.dataset.slot) === slot);
      v.mag = undefined; // 弹匣告警要按新武器的容量重算
    }
    if (name !== v.name) {
      v.name = name;
      this.el.wname.textContent = name;
    }
    if (mode !== v.mode) {
      v.mode = mode;
      this.el.mode.textContent = mode;
    }
  }

  setAmmo(mag, reserve) {
    const v = this.v;
    const melee = reserve == null;
    if (melee !== v.melee) {
      v.melee = melee;
      this.el.weapon.toggleAttribute('data-melee', melee);
    }
    if (melee) return;
    if (mag !== v.mag) {
      v.mag = mag;
      this.el.mag.textContent = mag;
      const max = Math.max(this.magMax[v.slot] || 0, mag);
      this.magMax[v.slot] = max;
      const low = Math.max(LOW_AMMO_MIN, Math.ceil(max * LOW_AMMO_RATIO));
      const level = mag <= 0 ? 'empty' : mag <= low ? 'low' : 'ok';
      if (level !== v.ammo) {
        v.ammo = level;
        this.el.weapon.dataset.ammo = level;
      }
    }
    // 练习场弹药不限：游戏里备弹数低于 60 会补满，显示的数不能跟着晃
    const shown = this.mode === 'range' ? Infinity : reserve;
    if (shown !== v.reserve) {
      v.reserve = shown;
      this.el.reserve.textContent = shown === Infinity ? '∞' : shown;
    }
  }

  setHealth(hp) {
    const v = this.v;
    const value = Math.min(100, Math.max(0, Number(hp) || 0));
    const shown = Math.ceil(value);
    if (shown !== v.hp) {
      v.hp = shown;
      this.el.hp.textContent = shown;
      this.el.health.toggleAttribute('data-low', shown <= LOW_HEALTH);
    }
    const fill = Math.round(value * 2) / 200; // 0.5% 一档
    if (fill !== v.hpFill) {
      // 掉血时残影按 CSS 的延迟晚一点缩回来；回血时残影和血条一起走，不露出红边
      const heal = v.hpFill === undefined || fill > v.hpFill;
      v.hpFill = fill;
      this.el.hpBar.style.setProperty('--v', fill);
      this.el.hpTrail.toggleAttribute('data-heal', heal);
      this.el.hpTrail.style.setProperty('--v', fill);
    }
  }

  // nextIn：清场后到下一波的秒数，给了就把「剩余」换成「下一波」倒计时
  setWave(wave, remaining, nextIn) {
    const v = this.v;
    if (wave !== v.wave) {
      v.wave = wave;
      this.el.waveNo.textContent = wave;
      this.el.wave.toggleAttribute('data-on', wave > 0);
    }
    const next = Number.isFinite(nextIn) ? Math.max(0, Math.ceil(nextIn)) : -1;
    if ((next >= 0) !== v.waveNext) {
      v.waveNext = next >= 0;
      this.el.waveLeftName.textContent = v.waveNext ? '下一波' : '剩余';
      this.el.wave.toggleAttribute('data-next', v.waveNext);
    }
    const count = next >= 0 ? next : remaining;
    if (count !== v.remaining) {
      v.remaining = count;
      this.el.waveLeft.textContent = count;
    }
  }

  setScore(score) {
    if (score === this.v.score) return;
    this.v.score = score;
    this.el.score.textContent = this.number.format(score);
  }

  // 玩法：练习场把右上角的得分换成命中统计，并隐藏波次
  setMode(mode) {
    const next = mode === 'range' ? 'range' : 'waves';
    if (next === this.layer.dataset.mode) return;
    this.mode = next;
    this.layer.dataset.mode = next;
    if (this.v.menu === 'paused') this.el.alt.textContent = this.altLabel(MENUS.paused);
  }

  setRange(stats) {
    this.range.set(stats);
  }

  // name 是 'dash' 或 'smoke'，ready01 为 1 时可用；remainSec 给了就在格子里显示剩余秒数
  setAbility(name, ready01, remainSec) {
    this.abilities.set(name, ready01, remainSec);
  }

  // 剩余敌人的方位角（度，同 setCompass 的朝向），最多两个；空数组收起
  setCompassMarks(degs) {
    this.marks.set(degs);
  }

  setCompass(yawDeg) {
    const yaw = Math.round((((yawDeg % 360) + 360) % 360) * 10) / 10; // 0.1° 一档
    if (yaw === this.v.yaw || Number.isNaN(yaw)) return;
    this.v.yaw = yaw;
    // 让 yaw 落在可视区正中：轨道左端是 COMPASS_FROM，再退回半个可视宽度
    const shift = (yaw - COMPASS_FROM - COMPASS_VIEW / 2) / COMPASS_SPAN;
    this.el.track.style.transform = `translateX(${(-shift * 100).toFixed(3)}%)`;
    this.marks.setYaw(yaw);
  }

  setCrosshair({ spread, visible } = {}) {
    const v = this.v;
    if (spread !== undefined) {
      const px = Math.max(0, Math.round(spread)) || 0; // 取整像素，线才不发虚
      if (px !== v.spread) {
        v.spread = px;
        this.el.cross.style.setProperty('--spread', `${px}px`);
      }
    }
    if (visible !== undefined && !visible !== v.crossOff) {
      v.crossOff = !visible;
      this.el.cross.toggleAttribute('data-off', !visible);
    }
  }

  setReloading(active, progress = 0) {
    const v = this.v;
    const on = !!active;
    if (on) {
      const dash = Math.round((1 - clamp01(progress)) * 200) / 2;
      if (dash !== v.dash) {
        v.dash = dash;
        this.el.reload.style.setProperty('--dash', dash);
      }
    }
    if (on !== v.reloading) {
      v.reloading = on;
      this.el.reload.toggleAttribute('data-on', on);
    }
  }

  setFps(fps) {
    if (!this.fpsOn) return;
    const value = Math.round(fps) || 0;
    if (value === this.v.fps) return;
    this.v.fps = value;
    this.el.fps.textContent = `${value} FPS`;
  }

  toggleFps() {
    this.fpsOn = !this.fpsOn;
    this.el.fps.toggleAttribute('data-on', this.fpsOn);
    return this.fpsOn;
  }

  // ---------- 一次性反馈 ----------

  hitmarker(kill = false) {
    const el = this.el.hit;
    el.toggleAttribute('data-kill', !!kill);
    // 在两份相同的关键帧之间切换，动画就会从头播，不需要强制回流
    el.dataset.anim = el.dataset.anim === 'a' ? 'b' : 'a';
  }

  // 击倒确认：kind 是 'soldier'、'drone' 或 'target'；points 是这次的总分（含爆头加分）；time 是游戏时间（秒）
  kill(info) {
    this.killFx.kill(info);
  }

  // 新开一局：收掉上一局残留的加分条和罗盘标记
  resetRun() {
    this.killFx.reset();
    this.marks.set([]);
    // 上一局刚挨打的弧：去掉动画属性就回到 opacity 0，下次 damage 重新从 'a' 起
    for (const arc of this.arcs) { arc.has = false; delete arc.el.dataset.anim; }
    this.arcNext = 0;
  }

  // angleRad：相对视线的方位，0 正前、顺时针为正。给了来源的世界坐标，之后由 updateArcs 跟着视角转
  damage(angleRad = 0, fromX, fromZ) {
    const arc = this.arcs[this.arcNext];
    this.arcNext = (this.arcNext + 1) % this.arcs.length;
    if (!this.arcMs) {
      const d = getComputedStyle(this.layer).getPropertyValue('--duration-dmg').trim();
      this.arcMs = (parseFloat(d) || 1.1) * (d.endsWith('ms') ? 1 : 1000);
    }
    arc.has = Number.isFinite(fromX) && Number.isFinite(fromZ);
    arc.x = fromX;
    arc.z = fromZ;
    arc.until = performance.now() + this.arcMs;
    this.writeArc(arc, Number(angleRad) || 0);
    arc.el.dataset.anim = arc.el.dataset.anim === 'a' ? 'b' : 'a';
  }

  // 每帧调用：还没消失的弧按玩家位置和朝向（player.yaw）重算方位
  updateArcs(px, pz, yaw) {
    let now = 0;
    for (const arc of this.arcs) {
      if (!arc.has) continue;
      now ||= performance.now();
      if (now > arc.until) { arc.has = false; continue; }
      const a = Math.atan2(arc.x - px, pz - arc.z) + yaw;
      const d = Math.atan2(Math.sin(a - arc.a), Math.cos(a - arc.a));
      if (Math.abs(d) > ARC_EPS) this.writeArc(arc, arc.a + d);
    }
  }

  writeArc(arc, a) {
    arc.a = a;
    arc.el.style.setProperty('--a', `${a.toFixed(3)}rad`);
  }

  // variant 为 'wave' 时用大一档的横幅样式，带入场动画（「第 N 波」「区域已肃清」）
  notice(text, ms = 2200, variant = '') {
    const el = this.el.notice;
    el.textContent = text;
    if (variant) {
      el.dataset.variant = variant;
      el.dataset.anim = el.dataset.anim === 'a' ? 'b' : 'a';
    } else {
      delete el.dataset.variant;
      delete el.dataset.anim;
    }
    el.setAttribute('data-on', '');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => el.removeAttribute('data-on'), ms);
  }

  // ---------- 菜单 ----------

  showMenu({ mode = 'hidden', progress, stats } = {}) {
    const v = this.v;
    const el = this.el;
    const menu = MENUS[mode];
    const key = menu ? mode : 'hidden';

    if (key !== v.menu) {
      v.menu = key;
      this.disarm();
      if (!menu) {
        this.layer.removeAttribute('data-menu');
        // 淡出期间按钮还留着焦点的话，游戏里的空格会再次触发它
        if (el.menu.contains(document.activeElement)) document.activeElement.blur();
      } else {
        this.layer.dataset.menu = key;
        this.menuAt = performance.now();
        el.title.textContent = menu.title;
        this.setCause(null);
        for (const part of MENU_PARTS) el[part].hidden = !menu.parts.includes(part);
        el.button.textContent = menu.button;
        el.button.disabled = !!menu.disabled;
        el.again.textContent = menu.again || '';
        el.alt.textContent = this.altLabel(menu);
        // 不聚焦按钮的状态把焦点放在面板上：空格和回车不会触发任何东西，按一次 Tab 就到按钮
        (menu.focus ? el.button : el.panel).focus({ preventScroll: true });
      }
    }

    if (key === 'loading' && progress !== undefined) {
      const pct = Math.round(clamp01(progress) * 100);
      if (pct !== v.loadPct) {
        v.loadPct = pct;
        el.loadBar.style.setProperty('--v', pct / 100);
        el.loadPct.textContent = `${pct}%`;
        el.load.setAttribute('aria-valuenow', pct);
      }
    }

    if (menu?.parts.includes('stats')) this.fillStats(stats);
  }

  // 本局战绩（game.stats()）：{ mode, wave, kills, score, shots, hits, headshots, time, death }。
  // 波次模式六项，练习场是命中率、击倒、爆头率；阵亡页的标题下写死因
  fillStats(stats) {
    const range = stats?.mode === 'range';
    this.runWave = range ? 0 : stats?.wave ?? 0;
    if (this.v.menu === 'dead') this.setCause(stats?.death);
    if (!stats) return;
    const kills = stats.kills ?? 0, heads = stats.headshots ?? 0, acc = pct(stats.hits, stats.shots);
    const values = range
      ? [acc, kills, pct(heads, kills)]
      : [stats.wave ?? 0, kills, this.number.format(stats.score ?? 0), acc, heads, clock(stats.time)];
    const names = STATS[range ? 'range' : 'waves'];
    this.statRows.forEach((row, i) => {
      row.el.hidden = i >= names.length;
      if (row.el.hidden) return;
      row.dt.textContent = names[i];
      row.dd.textContent = values[i];
    });
  }

  // death：{ kind: 'soldier' | 'drone', dist }；没有就换回副标题
  setCause(death) {
    const who = KILLER[death?.kind];
    const text = who ? `被${who}击倒${Number.isFinite(death.dist) ? ` · ${Math.round(death.dist)} 米` : ''}` : '';
    this.el.subtitle.textContent = text || 'DOCK ZERO';
    this.el.subtitle.toggleAttribute('data-cause', !!text);
  }

  // 画质已经是设置项（settings.js 的 quality）：这里只给没接设置的旧调用方同步一下控件
  setQuality(value) {
    this.settingControls?.quality?.show(value);
  }

  // 设置区按 settings.js 的 SETTING_DEFS 生成，只绑定一次
  bindSettings(settings) {
    if (!settings || this.settings) return;
    this.settings = settings;
    this.settingControls = buildSettings(this.el.settings, settings, this.id);
    // 操作说明里冲刺那一行跟着「冲刺」设置走
    const sprint = (mode) => { this.el.sprintKey.textContent = mode === 'hold' ? '按住冲刺' : '切换冲刺'; };
    sprint(settings.get('sprintMode'));
    const motion = (value) => { this.layer.dataset.motion = value === 'reduced' ? 'reduced' : 'full'; };
    motion(settings.get('motion'));
    settings.onChange?.((key, value) => {
      if (key === 'sprintMode') sprint(value);
      else if (key === 'motion') motion(value);
    });
  }

  on(event, cb) {
    (this.listeners[event] ||= []).push(cb);
    return this;
  }

  // ---------- 内部 ----------

  emit(event, arg) {
    for (const cb of this.listeners[event] || []) cb(arg);
  }

  altMode(menu) {
    if (menu.alt === 'other') return this.mode === 'range' ? 'waves' : 'range';
    return menu.alt;
  }

  altLabel(menu) {
    const mode = menu.alt && this.altMode(menu);
    return mode ? MODE_SWITCH[mode] : '';
  }

  // which：'button' 主按钮，'again' 重新开始，'alt' 切玩法
  onButton(e, which) {
    const menu = MENUS[this.v.menu];
    if (!menu || !(which === 'button' ? menu.event : menu[which])) return;
    // 键盘触发的 click 的 detail 是 0
    if (e.detail === 0 && performance.now() - this.menuAt < KEY_GUARD_MS) return;
    if (which === 'button') return this.emit(menu.event, menu.arg);
    // 波次模式打到第 1 波以后，暂停里这两个按钮会丢掉本局：先换成确认的说法，3 秒内再点才执行
    if (menu === MENUS.paused && this.mode === 'waves' && this.runWave >= 1 && this.armed !== which) return this.arm(which);
    this.disarm();
    if (which === 'again') this.emit('restart');
    else this.emit('start', this.altMode(menu));
  }

  arm(which) {
    this.disarm();
    this.armed = which;
    const btn = this.el[which];
    btn.textContent = which === 'again' ? CONFIRM.again : CONFIRM[this.altMode(MENUS.paused)];
    btn.toggleAttribute('data-confirm', true);
    this.armTimer = setTimeout(() => this.disarm(), CONFIRM_MS);
  }

  disarm() {
    clearTimeout(this.armTimer);
    const which = this.armed;
    if (!which) return;
    this.armed = null;
    const btn = this.el[which];
    btn.removeAttribute('data-confirm');
    const menu = MENUS[this.v.menu] || MENUS.paused;
    btn.textContent = which === 'again' ? menu.again || '' : this.altLabel(menu);
  }
}
