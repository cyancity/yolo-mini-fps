import * as THREE from 'three';
import { Player, DASH } from './player.js';
import { Weapons } from '../weapons/weapons.js';
import { Fx } from '../fx/fx.js';
import { DroneManager } from '../enemies/drones.js';
import { SoldierManager } from '../enemies/soldiers.js';
import { RunStats } from './run_stats.js';
import { wireAudio, updateAudio } from './game_audio.js';

const QUALITY = {
  // 低档不下雨、不画海面和地面倒影：开发时后台标签页默认用它
  low: { scale: 0.62, maxPixelRatio: 1, ao: false, fog: true, reflection: false, shadows: 1, rain: false, water: false },
  medium: { scale: 0.8, maxPixelRatio: 1, ao: true, fog: true, reflection: true, shadows: 1, rain: true, water: true },
  high: { scale: 1, maxPixelRatio: 1, ao: true, fog: true, reflection: true, shadows: 2, rain: true, water: true },
  ultra: { scale: 1, maxPixelRatio: 2, ao: true, fog: true, reflection: true, shadows: 3, rain: true, water: true },
};
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
// 开局、重开、切模式时从黑淡入的时长（秒）；阵亡后画面最多压暗这么多
const FADE_IN = 0.35, DEATH_DIM = 0.35;
const _fwd = new THREE.Vector3(), _up = new THREE.Vector3();
const _marks = [];
// 罗盘方位角：0 北（-Z），90 东（+X），和 HUD 罗盘的读数一致
const bearing = (p, from) => (Math.atan2(p.x - from.x, from.z - p.z) * 180) / Math.PI;

// 一局游戏：状态机（菜单/进行中/暂停/阵亡）、波次、计分，以及各子系统之间的接线
export class Game {
  constructor({ pipeline, scene, fxScene, camera, mats, sky, level, input, hud, audio, resize, settings }) {
    Object.assign(this, { pipeline, scene, fxScene, camera, mats, sky, level, input, hud, audio, resize, settings });
    this.state = 'menu';
    this.want = null;
    this.time = 0;
    this.menuTime = 0;
    this.wave = 0;
    this.kills = 0;
    this.score = 0;
    this.nextWaveAt = Infinity;
    this.waveActive = false;
    this.deadAt = 0;
    this.heartbeatAt = 0;
    this.damageFx = 0;
    this.indoor = 0;
    this.indoorT = 0;
    this.indoorKind = 'room'; // 'room' 小房间，'hall' 仓库大厅
    this.quality = 'high';
    // 玩法：waves 波次，range 练习场（没有敌人，只有靶子，弹药不限）
    this.mode = 'waves';
    this.wantMode = null;
    this.targets = null;
    this.smoke = null;
    this.run = new RunStats();
    this.fadeT = 1;
    this.reducedMotion = false;
    this.smokeWant = 0;
    this.brightness = 1;
    scene.add(camera);

    this.player = new Player(camera, level.phys, input);
    this.fx = new Fx({ scene, fxScene, mats, pipeline, phys: level.phys });
    this.drones = new DroneManager({ scene, phys: level.phys, mats, fx: this.fx, audio });
    this.drones.kind = 'drone';
    this.soldiers = new SoldierManager({ scene, phys: level.phys, mats, fx: this.fx, audio, level });
    this.soldiers.kind = 'soldier';
    // 武器每次射线都现查这张表，后加载的靶场直接 push 进来
    this.enemyGroups = [this.drones, this.soldiers];
    this.weapons = new Weapons({
      camera, pipeline, scene, fxScene, mats, input, audio, hud,
      player: this.player, phys: level.phys, fx: this.fx, enemies: this.enemyGroups,
    });
    level.lighting.addFogLights(this.drones.lights, 0.55);
    this.fx.setRainLights(level.lighting.fogLights.map((f) => f.light));
    this.wire();
    this.player.respawn(level.spawn);
    this.weapons.setVisible(false);
    this.loadExtras();
    if (settings) {
      settings.onChange((key, value) => this.applySetting(key, value));
      input.onFullscreenWant = (on) => settings.set('fullscreen', on ? 'on' : 'off');
      for (const key of settings.keys()) this.applySetting(key, settings.get(key));
    }
  }

  // 靶场和烟雾弹各是一个独立模块：加载失败只少一个功能，不拖垮启动
  async loadExtras() {
    const { scene, mats, fx, audio, level } = this, phys = level.phys;
    try {
      const m = await import('../enemies/targets.js');
      const t = new m.TargetRange({ scene, phys, mats, fx, audio, level });
      t.kind = 'target';
      t.onKill = (target, info) => this.killFeedback('target', info);
      this.enemyGroups.push(t);
      this.targets = t;
      t.setActive(this.mode === 'range' && this.state !== 'menu');
    } catch (e) { console.warn('[game] 靶场没加载起来', e); }
    try {
      const m = await import('./smoke.js');
      this.smoke = new m.SmokeGrenades({ scene, phys, mats, fx, audio });
    } catch (e) { console.warn('[game] 烟雾弹没加载起来', e); }
  }

  applySetting(key, value) {
    if (key === 'sensitivity') this.player.sensitivity = 0.0021 * value;
    else if (key === 'adsSensitivity') this.player.adsScale = value;
    else if (key === 'brightness') { this.brightness = value; this.applyExposure(); }
    else if (key === 'timeOfDay') {
      this.level.setTime?.(value);
      const tod = this.level.tod;
      if (tod?.ambient) this.fx.ambient.set(tod.ambient.r, tod.ambient.g, tod.ambient.b);
      this.fx.rain.intensity = tod?.rain ?? 1;
      this.audio.setRain?.(tod?.rain ?? 1);
      this.audio.setTimeOfDay?.(value); // 环境层和地面湿度（沥青上叠不叠水声）跟着时段走
      this.applyExposure();
    }
    else if (key === 'knifeSkin') this.weapons.knife.setSkin?.(value);
    else if (key === 'sprintMode') this.player.sprintMode = value;
    else if (key === 'fullscreen') this.input.setFullscreen(value === 'on');
    else if (key === 'volume') this.audio.setMaster(value);
    else if (key === 'quality') this.applyQuality(value);
    else if (key === 'motion') {
      // 减弱：视野拉伸和喷气滚转只留三成，喷气的后处理（模糊、速度线）关掉，低血红晕不脉动
      this.reducedMotion = value === 'reduced';
      this.player.motion = this.reducedMotion ? 0.3 : 1;
    } else if (key === 'fov') {
      const d = value - this.player.baseFov;
      this.player.baseFov = value;
      // 对局中（含暂停）相机直接挪到新视野，不等阻尼；菜单镜头固定 46 度
      if (d && this.state !== 'menu') { this.camera.fov += d; this.camera.updateProjectionMatrix(); }
    }
  }

  // 曝光 = 当前时段的基准 × 玩家调的亮度
  applyExposure() {
    this.pipeline.final.uExposure.value = (this.level.tod?.exposure ?? 1) * this.brightness;
  }

  // 击杀反馈：音效、准心上的击杀标记、加分飘字。波次和练习场共用
  killFeedback(kind, info = {}) {
    const headshot = !!info.headshot;
    const mult = this.mode === 'range' ? 1 : Math.max(1, this.wave);
    const bonus = headshot ? 70 * mult : 0;
    const points = (kind === 'soldier' ? 150 : 100) * mult + bonus;
    this.kills++;
    this.run.kill(headshot);
    this.score += points;
    this.hud.setScore(this.score);
    this.hud.kill?.({ kind, headshot, points, bonus, dist: info.dist, time: this.time });
    this.audio.play(headshot ? 'killHeadshot' : 'killConfirm', { volume: 0.8 });
  }

  wire() {
    const { player, hud, audio, input, fx, drones } = this;
    wireAudio(this); // 脚步、下蹲、探头这类拟音，弹壳，界面声，遮挡和灯具嗡声
    player.onDash = () => {
      audio.play('dash', { volume: 0.8 });
      fx.dashJet?.(player.position, player.dashX, player.dashZ, player.grounded);
    };
    player.onDamage = (angle, amount, from) => {
      hud.damage(angle, from?.x, from?.z);
      audio.play('hurt', { volume: 0.7 });
      this.damageFx = Math.min(1, this.damageFx + amount / 28);
      this.weapons.vm.punch(0.25, -0.1, 0.5, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.2);
    };
    player.onDeath = () => {
      this.deadAt = this.time;
      this.run.died(this.time, player.lastHit);
      this.state = 'dying';
      this.weapons.setVisible(false);
      audio.setMuffle(1);
      audio.play('playerDeath');
    };
    drones.onKill = () => this.killFeedback('drone');
    this.soldiers.onKill = (soldier, info) => this.killFeedback('soldier', info);
    this.weapons.onShot = () => {
      this.soldiers.hear(player.position, 45);
      this.run.shot();
      if (this.mode === 'range' && this.weapons.rifle.reserve < 60) this.weapons.resupply();
    };
    // 命中率只算步枪：刀砍中也会走这个钩子，但不算开枪
    this.weapons.onHit = () => { if (this.weapons.current === this.weapons.rifle) this.run.hit(); };
    // 菜单的开始按钮带上玩法（'waves' 或 'range'）；不带就沿用上一次的
    hud.on('start', (mode) => this.request('start', mode));
    hud.on('resume', () => this.request('resume'));
    hud.on('restart', () => this.request('start'));
    // 真锁定了鼠标在玩的时候，误按 Ctrl+W 之类先弹确认，不直接丢进度
    window.addEventListener('beforeunload', (e) => { if (input.locked && this.state === 'playing') e.preventDefault(); });
    input.onLockChange = (locked) => {
      if (locked && this.want) this.enter();
      else if (!locked && this.state === 'playing') this.pause();
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); hud.toggleFps(); }
    });
  }

  // 开始/继续都要先拿到指针锁定；拿到后才真正进入游戏
  request(what, mode) {
    this.want = what;
    if (mode === 'waves' || mode === 'range') this.wantMode = mode;
    this.audio.unlock();
    if (this.input.active) this.enter();
    else this.input.lock();
  }

  enter() {
    const what = this.want;
    this.want = null;
    if (what === 'start' || this.state !== 'paused') this.newRun();
    this.state = 'playing';
    this.hud.showMenu({ mode: 'hidden' });
    this.audio.resume();
    this.audio.setWorldPaused(false);
    this.audio.setMuffle(0);
  }

  newRun() {
    if (this.wantMode) this.mode = this.wantMode;
    this.wantMode = null;
    const range = this.mode === 'range';
    this.drones.clear();
    this.soldiers.clear();
    this.smoke?.clear();
    this.targets?.reset();
    this.targets?.setActive(range);
    this.run.reset(this.time);
    this.smokeWant = 0;
    this.fx.clear();
    this.wave = 0;
    this.kills = 0;
    this.score = 0;
    this.waveActive = false;
    this.nextWaveAt = range ? Infinity : this.time + 3;
    this.damageFx = 0;
    this.pipeline.final.uDesat.value = 0; // 阵亡时的去色，不清的话淡入完还要灰半秒
    // 从黑淡入：这一帧就压黑，TAA 的历史帧（菜单镜头或上一局）作废，相机视野在 respawn 里直接设到位
    this.fadeT = 0;
    this.pipeline.final.uFade.value = 0;
    this.pipeline.historyValid = false;
    this.player.respawn(this.level.spawn);
    this.weapons.reset();
    this.weapons.setVisible(true);
    this.hud.setScore(0);
    this.hud.setWave(0, 0);
    this.hud.resetRun?.();
    this.hud.setMode?.(this.mode);
    this.hud.notice(range ? '练习场：只有靶子，弹药不限' : '肃清码头的武装人员和无人机', 2800);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.showMenu({ mode: 'paused', stats: this.stats() });
    // 只停世界里的声音，菜单的界面声照常；上下文不挂起，继续时没有爆音
    this.audio.setWorldPaused(true);
  }

  // 本局战绩：暂停和阵亡菜单用，字段见 hud.js 的 fillStats
  stats() {
    return { mode: this.mode, wave: this.wave, kills: this.kills, score: this.score, ...this.run.snapshot(this.time) };
  }

  // 只在本次运行切画质（省内存档、调试）：设置面板跟着显示，存档里还是玩家选的档
  setQuality(name) {
    if (!QUALITY[name]) return;
    this.settings?.force?.('quality', name);
    if (this.quality !== name) this.applyQuality(name);
  }

  applyQuality(name) {
    const q = QUALITY[name];
    if (!q) return;
    this.quality = name;
    const s = this.pipeline.settings;
    s.scale = q.scale; s.maxPixelRatio = q.maxPixelRatio; s.ao = q.ao; s.fog = q.fog;
    this.level.ground.enabled = q.reflection;
    this.level.lighting.perFrame = q.shadows;
    this.fx.rain.enabled = q.rain;
    const sea = this.scene.getObjectByName('sea');
    if (sea) sea.visible = q.water;
    this.resize();
  }

  // 每波：地面上的武装人员为主，无人机在堆场上空配合
  waves(dt) {
    const { drones, soldiers, hud, audio, player } = this;
    const alive = drones.aliveCount + soldiers.aliveCount;
    if (!this.waveActive && this.time >= this.nextWaveAt) {
      this.wave++;
      this.waveActive = true;
      this.waveAt = this.time;
      soldiers.spawnWave(Math.min(2 + this.wave, 8), this.wave, player);
      drones.spawnWave(Math.min(Math.ceil(this.wave / 2), 4), this.wave);
      audio.play('waveStart', { volume: 0.8 });
      hud.notice(`第 ${this.wave} 波`, 2200, 'wave');
    } else if (this.waveActive && alive === 0 && this.time - this.waveAt > 1) {
      this.waveActive = false;
      this.nextWaveAt = this.time + 6;
      this.score += 250 * this.wave;
      hud.setScore(this.score);
      audio.play('waveClear', { volume: 0.8 });
      hud.notice('区域已肃清', 2400, 'wave');
      this.weapons.resupply();
    }
    hud.setWave(this.wave, alive, this.waveActive ? undefined : this.nextWaveAt - this.time);
    // 剩下不多于 2 个时在罗盘上标出方位（还没落地的士兵不标）
    _marks.length = 0;
    if (this.waveActive && alive > 0 && alive <= 2) {
      for (const s of soldiers.active) if (s.alive) _marks.push(bearing(s.pos, player.position));
      for (const d of drones.drones) if (d.alive) _marks.push(bearing(d.position, player.position));
    }
    hud.setCompassMarks?.(_marks);
  }

  // 菜单背景：贴着地面的慢速环绕镜头
  menuCamera(dt) {
    this.menuTime += dt;
    const t = this.menuTime * 0.045 + 0.6, cam = this.camera;
    cam.position.set(Math.sin(t) * 7 - 1.5, 1.1 + Math.sin(t * 1.7) * 0.2, 14.5 + Math.cos(t) * 1.6);
    cam.lookAt(1 + Math.sin(t * 0.6) * 3, 2.3, -9);
    if (Math.abs(cam.fov - 46) > 0.01) { cam.fov = 46; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  update(dt, force = false) {
    if (this.frozen && !force) dt = 0;
    const { player, hud, audio, input, weapons, drones, fx, camera, pipeline } = this;
    const playing = this.state === 'playing', dying = this.state === 'dying';
    const sim = playing || dying ? dt : 0;
    this.time += sim;
    this.fadeT += sim;

    if (this.state === 'menu') this.menuCamera(dt);
    else if (sim > 0) {
      player.update(sim);
      weapons.update(sim, playing && player.alive);
      drones.update(sim, player);
      this.soldiers.update(sim, player);
      this.targets?.update(sim, player);
      // 烟雾弹：左手腾不出来时（换弹、切枪途中）把这次按键留 1 秒，腾出来就扔
      if (playing && player.alive && input.pressed('KeyG')) this.smokeWant = 1;
      if (this.smokeWant > 0) {
        this.smokeWant -= sim;
        const smoke = this.smoke;
        if (!player.alive || !smoke || smoke.ready < 1) this.smokeWant = 0;
        else if (weapons.throwOffhand(() => smoke.throw(camera, player))) this.smokeWant = 0;
      }
      this.smoke?.update(sim);
      if (playing && this.mode === 'waves') this.waves(sim);
      // 和暂停菜单同一份数据（stats()）：命中只算步枪，刀砍中靶子不算
      else if (playing) hud.setRange?.({ shots: this.run.shots, hits: Math.min(this.run.hits, this.run.shots), kills: this.kills, headshots: this.run.headshots });
    }
    fx.update(this.state === 'paused' ? 0 : dt, camera);
    this.level.lighting.update(dt);
    this.level.update(this.state === 'paused' ? 0 : dt);
    this.sky.update(dt);

    if (dying && this.time - this.deadAt > 1.6) {
      this.state = 'dead';
      this.input.unlock();
      hud.showMenu({ mode: 'dead', stats: this.stats() });
      // 结算页上世界已经停住：世界的声音一起停（阵亡音走界面总线，尾巴照常放完）
      audio.setWorldPaused(true);
    }

    // HUD 和画面反馈
    const hp = player.health;
    hud.setHealth(Math.round(hp));
    hud.setCompass((((-player.yaw * 180) / Math.PI) % 360 + 360) % 360);
    hud.updateArcs?.(player.position.x, player.position.z, player.yaw);
    hud.setAbility?.('dash', 1 - Math.max(0, player.dashCool) / DASH.cooldown);
    hud.setAbility?.('smoke', this.smoke ? this.smoke.ready : 0, this.smoke?.cool);
    this.damageFx = damp(this.damageFx, 0, 2.2, dt);
    const low = playing ? Math.max(0, 1 - hp / 45) : 0;
    const f = pipeline.final;
    const pulse = this.reducedMotion ? 0.75 : 0.75 + 0.25 * Math.sin(this.time * 5.2);
    f.uDamage.value = Math.min(0.85, this.damageFx * 0.55 + low * 0.38 * pulse);
    f.uDesat.value = damp(f.uDesat.value, dying || this.state === 'dead' ? 0.85 : low * 0.45, 4, dt);
    f.uAds.value = weapons.ads;
    f.uDash.value = playing && !this.reducedMotion ? player.dash : 0;
    const dead = dying || this.state === 'dead';
    const dim = dead ? DEATH_DIM * smooth((this.time - this.deadAt) / 1.6) : 0;
    f.uFade.value = this.state === 'menu' ? 1 : smooth(this.fadeT / FADE_IN) * (1 - dim);
    f.uDashDir.value.set(player.dashS, player.dashF);
    updateAudio(this, dt, low);
    if (playing && player.sliding && player.grounded) fx.slideDust?.(player.position, player.velocity, player.surface);

    camera.getWorldDirection(_fwd);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    audio.setListener(camera.position, _fwd, _up);
  }
}
