import * as THREE from 'three';
import { LightRig } from './common.js';
import { Billboards } from './billboards.js';
import { Streaks } from './streaks.js';
import { Decals } from './decals.js';
import { Shells } from './shells.js';
import { MagDrops } from './mags.js';
import { Rain } from './rain.js';
import { R, rr, TAU, D, spray, sparkBurst, puff } from './emit.js';
import { emitImpact, emitSlash } from './impacts.js';
import { emitMuzzleFlash, emitExplosion } from './blasts.js';
import { emitSlideDust } from './slide.js';
import { SmokeClouds } from './clouds.js';
import { DashJet } from './jet.js';

const NO_OPTS = Object.freeze({});
const MUZZLE_COLOR = 0xffb469;
const MUZZLE_TIME = 0.06;
const KICK_HOLD = 0.014;
const PLAYER_HOLD = 0.13; // 玩家开枪后这么久之内敌人的枪口焰不抢枪口灯（连射间隔 0.1 秒，连射时一直归玩家）
const PLAYER_TRACER = 0xffd9a0;
const ENEMY_TRACER = 0xffa05a; // 敌人的曳光偏暖偏暗，迎面飞来时靠加粗认出来
const _c = new THREE.Color();

// 特效总入口。发光粒子、烟、条带、雨画在 fxScene（TAA 之后，各一个 draw call）；
// 弹孔和弹壳在主场景里受光。所有池子启动时建好，运行中不分配、不增删灯。
export class Fx {
  constructor({ scene, fxScene, mats, pipeline, phys }) {
    this.scene = scene;
    this.fxScene = fxScene;
    this.phys = phys || null;
    this.camera = null;
    this.rig = new LightRig(pipeline);
    this.ambient = this.rig.uniforms.uAmbient.value; // 烟尘和雨的环境光，可按关卡氛围改

    const tex = mats.tex;
    // 烟雾弹的烟团有自己的预算（不占通用烟池），但和通用烟画在同一个排好序的 draw call 里
    this.clouds = new SmokeClouds(this);
    this.puffs = new Billboards({ cap: 384, extra: this.clouds.cap, smoke: true, atlas: tex.smoke, rig: this.rig, renderOrder: 0 });
    this.puffs.ext = this.clouds.ext;
    this.jet = new DashJet(this);
    this.rainFx = new Rain({ rig: this.rig, phys: this.phys, renderOrder: 1 });
    this.glow = new Billboards({ cap: 256, atlas: tex.flash, blob: tex.blob, rig: this.rig, renderOrder: 2 });
    this.streaks = new Streaks({ cap: 640, rig: this.rig, renderOrder: 3 });
    this.puffs.wind.set(0.5, 0.04, 0.18);
    fxScene.add(this.puffs.mesh, this.rainFx.mesh, this.rainFx.splash.mesh, this.glow.mesh, this.streaks.mesh);
    this.decals = new Decals(scene, mats);
    this.shells = new Shells(scene, this.phys);
    // 空仓换弹掉下去的旧弹匣：外形由步枪启动时给（mags.setShape），材质借场景里已经在画的橡胶，不新编着色器
    this.mags = new MagDrops(scene, this.phys, mats.rubber);

    // 两盏瞬时点光常驻场景，闲置时强度为 0（增删灯会让全部着色器重编译）
    this.lights = {
      muzzle: new THREE.PointLight(MUZZLE_COLOR, 0, 16, 2),
      blast: new THREE.PointLight(0xff8a3c, 0, 36, 2),
    };
    scene.add(this.lights.muzzle, this.lights.blast);
    this.muzzlePeak = 0;
    this.muzzleAge = 1;
    this.muzzleOwn = false; // 枪口灯现在归不归玩家
    this.muzzleD2 = 0;      // 占着枪口灯的那团枪口焰离镜头的距离平方
    this.blastPeak = 0;
    this.blastAge = 10;

    this.rain = { enabled: true, intensity: 1 };
    this.time = 0;
    this.slideAt = -1;
    this.onShellBounce = null;
    this.shells.onBounce = (pos, speed) => this.onShellBounce?.(pos, speed);
    this.streaks.onTrail = (x, y, z, heat) => {
      const p = this.puffs;
      const i = p.emit(x, y, z, 0, 0.3, 0, 0.45 + heat * 0.3, 0.05, 0.22, 0.12 + 0.35 * heat, (R() * 4) | 0);
      p.tint(i, 0.12, 0.11, 0.1);
      p.motion(i, 0, 1.5, R() * TAU, 0, 1, 0);
      p.heat(i, 0.5 * heat, 0.25);
    };

    // 粒子缓冲在 fxScene 开画前才打包上传：这样无论 update 和开火谁先谁后，当帧发射的粒子当帧可见
    this.missed = 0;
    const prev = fxScene.onBeforeRender;
    fxScene.onBeforeRender = (renderer, scn, camera, target) => {
      prev.call(fxScene, renderer, scn, camera, target);
      this.flush(camera);
      this.missed = 0;
    };
  }

  update(dt, camera) {
    if (camera) this.camera = camera;
    const { muzzle, blast } = this.lights;
    // dt 为 0 表示暂停：画面冻住，什么都不推进
    if (dt > 0) {
      this.time += dt;
      // 点亮后的第一帧保持峰值（KICK_HOLD 抵掉这一帧的 dt），之后才开始衰减
      this.muzzleAge += dt;
      const m = Math.min(1, Math.max(0, 1 - this.muzzleAge / MUZZLE_TIME));
      muzzle.intensity = this.muzzlePeak * m * m;
      this.blastAge += dt;
      const b = Math.max(0, this.blastAge);
      // 爆炸光：一下很亮的闪 + 火球余辉
      blast.intensity = b < 1.6 ? this.blastPeak * (0.8 * Math.exp(-b / 0.045) + 0.2 * Math.exp(-b / 0.28)) : 0;

      this.jet.update(dt);
      this.clouds.update(dt);
      this.puffs.update(dt);
      this.glow.update(dt);
      this.streaks.update(dt);
      this.shells.update(dt);
      this.mags.update(dt);
    }
    this.rig.update(this.camera, muzzle, blast);
    this.rainFx.update(dt, this.camera, this.rain);
    // fxScene 的钩子被别处覆盖时，退回在这里上传（晚一帧）
    if (++this.missed > 1) this.flush(this.camera);
  }

  flush(camera) {
    this.clouds.flush(camera, this.rig.uniforms);
    this.puffs.flush(camera);
    this.glow.flush(camera);
    this.streaks.flush();
  }

  // 脚下地面高度（碰撞体顶面或 y = 0），火花和碎片落地用
  floorAt(x, y, z) {
    return this.phys ? this.phys.groundHeight(x, z, 0.05, y, 0.02) : 0;
  }

  // 到镜头的距离平方：远处的配方按它缩水
  dist2(x, y, z) {
    if (!this.camera) return 0;
    const e = this.camera.matrixWorld.elements, dx = x - e[12], dy = y - e[13], dz = z - e[14];
    return dx * dx + dy * dy + dz * dz;
  }

  // 这一点淋不淋得到雨：头顶有比它高的遮挡就是干的
  wetAt(x, y, z) {
    return this.rainFx.roof.coverAt(x, z) <= y + 0.05;
  }

  // 镜头头顶有遮挡的程度：0 露天 … 1 在屋里或棚下（平滑过）
  get cover() {
    return this.rainFx.cover;
  }

  // 挪动或改了已有碰撞体之后手动重烤遮雨图（增减碰撞体会自动重烤）
  bakeRoof() {
    this.rainFx.bakeRoof();
  }

  // 只有一盏枪口灯。own：玩家自己的枪口焰，总是拿到灯；
  // 敌人的只在灯空着（或玩家停火够久）时拿，几个敌人同时开火时留给离镜头最近的那个，第一人称武器就不会被远处的枪口焰照得一闪一闪
  // color：喷气借这盏灯闪一下蓝光，换颜色不增删灯
  kickMuzzle(x, y, z, peak, own = true, color = MUZZLE_COLOR) {
    const d2 = this.dist2(x, y, z);
    if (!own) {
      if (this.muzzleOwn && this.muzzleAge < PLAYER_HOLD) return;
      if (!this.muzzleOwn && this.muzzleAge < MUZZLE_TIME && d2 > this.muzzleD2) return;
    }
    this.lights.muzzle.color.setHex(color);
    this.lights.muzzle.position.set(x, y, z);
    this.lights.muzzle.intensity = peak;
    this.muzzlePeak = peak;
    this.muzzleAge = -KICK_HOLD;
    this.muzzleOwn = own;
    this.muzzleD2 = d2;
  }

  kickBlast(x, y, z, peak) {
    this.lights.blast.position.set(x, y, z);
    this.lights.blast.intensity = peak;
    this.blastPeak = peak;
    this.blastAge = -KICK_HOLD;
  }

  // opts.enemy：敌人开的枪（焰小一点、远处不缩没）；opts.light：false 不动枪口灯，true 当成玩家的抢灯
  muzzleFlash(pos, dir, scale = 1, opts = NO_OPTS) {
    emitMuzzleFlash(this, pos, dir, scale, opts);
  }

  // opts：speed、width、color、power；enemy 为 true 时默认更暖更暗、加粗，迎面飞来缩成一点也认得出
  tracer(from, to, opts = NO_OPTS) {
    const enemy = opts.enemy === true;
    const speed = opts.speed ?? (enemy ? 260 : 300), width = opts.width ?? (enemy ? 0.024 : 0.02);
    _c.set(opts.color ?? (enemy ? ENEMY_TRACER : PLAYER_TRACER));
    const st = this.streaks;
    // 玩家的曳光让开枪身前一段（不穿过第一人称武器），敌人的从枪口外一点就开始画
    const i = st.tracer(from.x, from.y, from.z, to.x, to.y, to.z, speed, width, speed * 0.035, enemy ? 0.6 : 1.5);
    st.color(i, _c.r, _c.g, _c.b, opts.power ?? (enemy ? 22 : 36));
    if (enemy) st.bold(i);
  }

  // opts：decal（默认 true）、scale；enemy（或 low）：敌人的流弹，弹孔记进另一个环，不顶掉玩家刚打的
  impact(point, normal, surface, opts = NO_OPTS) {
    emitImpact(this, point, normal, surface, opts.decal ?? true, opts.scale ?? 1, opts.enemy === true || opts.low === true);
  }

  // 滑铲时每帧调用（里面限频）。position：脚底；direction：滑行速度；surface：脚下材质
  slideDust(position, direction, surface = 'asphalt') {
    emitSlideDust(this, position, direction, surface);
  }

  slash(point, normal, surface) {
    emitSlash(this, point, normal, surface);
  }

  sparks(point, normal, count = 12, opts = NO_OPTS) {
    _c.set(opts.color ?? 0xffc070);
    const nx = normal.x, ny = normal.y, nz = normal.z;
    const x = point.x + nx * 0.02, y = point.y + ny * 0.02, z = point.z + nz * 0.02;
    sparkBurst(this, x, y, z, nx, ny, nz, count, opts.speed ?? 6, 0.85, _c.r, _c.g, _c.b, 7,
      this.floorAt(x + nx * 0.3, y, z + nz * 0.3));
  }

  smoke(point, opts = NO_OPTS) {
    const size = opts.size ?? 0.4, life = opts.life ?? 1.6, rise = opts.rise ?? 0.6, count = opts.count ?? 1;
    _c.set(opts.color ?? 0x777777);
    for (let k = 0; k < count; k++) {
      spray(0, 1, 0, 1);
      const j = size * 0.35;
      puff(this, point.x + D.x * j, point.y + D.y * j, point.z + D.z * j, D.x * 0.25, rise * rr(0.7, 1.2), D.z * 0.25,
        life * rr(0.8, 1.2), size * 0.3, size * rr(0.9, 1.3), 0.65, _c.r, _c.g, _c.b, 0.8, 0.12);
    }
  }

  shell(pos, vel, quat) {
    this.shells.spawn(pos, vel, quat);
  }

  explosion(point, opts = NO_OPTS) {
    emitExplosion(this, point, opts.scale ?? 1);
  }

  // 烟雾弹的烟：约 0.4 秒炸开到 radius，原地慢慢翻滚，最后 1.2 秒变稀，life 秒时散尽。
  // 形状是地面上的扁穹顶（point 正下方的地面起，顶到约 0.8 × radius 高），被墙挡住的部分沿门洞和空处铺开。
  // 同时最多 4 团，再多顶掉最快散尽的那团。返回槽位
  smokeCloud(point, opts = NO_OPTS) {
    return this.clouds.spawn(point.x, point.y, point.z, opts.radius ?? 4.2, opts.life ?? 6);
  }

  // 喷气冲刺开始时调用一次。position：脚底（传玩家的 position，持续段会跟着人走）；(dirX, dirZ)：行进方向
  dashJet(position, dirX, dirZ, grounded = true) {
    this.jet.start(position, dirX || 0, dirZ || 0, grounded !== false);
  }

  // list: [{ light: SpotLight }]。雨丝和烟尘都按这张表受光
  setRainLights(list) {
    this.rig.setLights(list);
  }

  clear() {
    this.puffs.clear();
    this.glow.clear();
    this.streaks.clear();
    this.decals.clear();
    this.shells.clear();
    this.mags.clear();
    this.clouds.clear();
    this.jet.clear();
    this.muzzlePeak = 0;
    this.muzzleOwn = false;
    this.blastPeak = 0;
    this.slideAt = -1;
    this.lights.muzzle.intensity = 0;
    this.lights.blast.intensity = 0;
  }
}
