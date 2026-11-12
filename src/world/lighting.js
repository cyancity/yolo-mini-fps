import * as THREE from 'three';
import { LIGHT_BUDGET, MAP, ZONE, ROOF, RESERVED } from './plan.js';
import { IndoorLight } from './indoor.js';
import { ShadowSchedule } from './shadow_sched.js';
import { PERF } from '../engine/perf_flags.js';

const SUN_DIST = 120;    // 平行光离全图中心多远（阴影相机的远近裁面按它定的）
const SHADOW_SPAN = 110; // 平行光阴影相机罩住的边长，米
const STAIR_TOP = 10.6;  // 出屋面楼梯间的墙顶

// 这个位置算不算室内（仓库、办公楼、出屋面的楼梯间）。时段按它把人造灯分两档调：
// 白天室外的灯几乎关掉，屋里的照常亮
export function indoorAt(x, y, z) {
  const inside = (r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
  if (inside(ZONE.warehouse)) return y < ROOF.warehouse.y;
  if (inside(RESERVED.stairwell)) return y < STAIR_TOP;
  if (inside(ZONE.office)) return y < ROOF.office.y;
  return false;
}

// 全场固定的灯光编制。数量一旦定下就不再变（增删灯会让所有着色器重编译）。
// 带阴影：月光（白天当太阳用）+ 4 盏高杆灯 + 集装箱内灯；其余（工作灯、各分区报上来的灯）不投影。
// 另有一盏半球光做天光补光，强度按时段给。
export class Lighting {
  constructor(scene, sky, spec) {
    this.scene = scene;
    this.shadowed = [];
    this.fogLights = [];
    this.lamps = [];   // 人造灯：{ light, base（原本的颜色）, indoor, scale }，时段调光用
    this.time = 0;
    this.dynamicShadows = true;
    // 画质档：一帧最多重画几张阴影图，同时定了每盏灯的刷新率（见 shadow_sched.js）
    this.perFrame = 2;
    this.sunWeight = 1;
    this.sched = new ShadowSchedule(scene);
    // 地面倒影（level.js 接上）：它隔帧重画的时候，阴影排到它不画的那一帧
    this.mirror = null;
    // 阴影分帧刷新的欠账和权重，和 shadowed 一一对应（reweigh 里按长度重建）
    this.debt = new Float32Array(0);
    this.weight = new Float32Array(0);

    const moon = new THREE.DirectionalLight(0x8fb2ff, 0.85);
    // 阴影相机对准全图中心，罩住整张图（对角线一半约 52 米）
    moon.target.position.set((MAP.x0 + MAP.x1) / 2, 0, (MAP.z0 + MAP.z1) / 2);
    moon.position.copy(sky.moonDir).multiplyScalar(SUN_DIST).add(moon.target.position);
    moon.castShadow = true;
    const half = spec.lite ? 0.5 : 1; // 省内存档：阴影图边长减半
    moon.shadow.mapSize.set(4096 * half, 4096 * half);
    const sc = moon.shadow.camera;
    sc.left = -SHADOW_SPAN / 2; sc.right = SHADOW_SPAN / 2; sc.top = SHADOW_SPAN / 2; sc.bottom = -SHADOW_SPAN / 2; sc.near = 20; sc.far = 260;
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.05;
    moon.shadow.radius = 2.2;
    this.add(moon, true);
    this.moon = moon;

    // 两盏老式钠灯（暖），两盏新换的 LED（冷），画面里冷暖对着打
    this.masts = spec.masts.map((m, i) => {
      const warm = i === 0 || i === 3;
      const l = this.spot(warm ? 0xffa449 : 0xcfe1ff, warm ? 2600 : 2100, m.position, m.target, { distance: 40, angle: 1.02, penumbra: 0.75 });
      l.castShadow = true;
      l.shadow.mapSize.set(2048 * half, 2048 * half);
      l.shadow.camera.near = 1.2;
      l.shadow.bias = -0.0005;
      l.shadow.normalBias = 0.03;
      l.shadow.radius = 3;
      this.add(l, true);
      this.fogLights.push({ light: l, strength: 1 });
      return l;
    });

    const box = spec.containerLight;
    // 箱子里晒不到太阳，这盏灯算室内的
    this.boxLight = this.spot(0xd2e4ff, 150, box.position, box.target, { distance: 15, angle: 1.05, penumbra: 0.85 }, true);
    this.boxLight.castShadow = true;
    this.boxLight.shadow.mapSize.set(1024, 1024);
    this.boxLight.shadow.camera.near = 0.2;
    this.boxLight.shadow.bias = -0.001;
    this.boxLight.shadow.normalBias = 0.02;
    this.boxLight.shadow.radius = 2.5;
    this.add(this.boxLight, true);
    this.fogLights.push({ light: this.boxLight, strength: 0.6 });

    const work = spec.workLight;
    this.work = this.spot(0xdfeaff, 1100, work.position, work.position.clone().addScaledVector(work.direction, 10), { distance: 24, angle: 0.62, penumbra: 0.6 });
    this.add(this.work);
    this.fogLights.push({ light: this.work, strength: 0.8 });

    // 各分区报上来的灯：{ pos, aim, color, intensity, distance, angle, penumbra, fog }，按分区名存着给分区自己做闪烁
    this.zoneLights = {};
    for (const z of spec.zones || []) {
      const max = LIGHT_BUDGET[z.name] ?? 4;
      if (z.lights.length > max) console.warn(`[lighting] 分区 ${z.name} 报了 ${z.lights.length} 盏灯，只取前 ${max} 盏`);
      this.zoneLights[z.name] = z.lights.slice(0, max).map((s) => {
        const l = this.spot(s.color ?? 0xffffff, s.intensity ?? 400, new THREE.Vector3(...s.pos), new THREE.Vector3(...s.aim),
          { distance: s.distance ?? 12, angle: s.angle ?? 1, penumbra: s.penumbra ?? 0.7 });
        this.add(l);
        if (s.fog) this.fogLights.push({ light: l, strength: s.fog });
        return l;
      });
    }

    this.exit = new THREE.PointLight(0x36ff7c, 2.4, 2.8, 2);
    this.exit.position.copy(spec.exitSign);
    scene.add(this.exit);
    this.lamps.push({ light: this.exit, base: this.exit.color.clone(), indoor: false, scale: 1 });

    // 天光补光：半球光，不投影也不占贴图单元。启动时强度为 0（什么都不改变），由时段给值
    this.fill = new THREE.HemisphereLight(0xffffff, 0x000000, 0);
    scene.add(this.fill);

    // 室内补光（房间盒、门窗洞、各房间的环境照度）：只写 uniform，出错也不拦着开局
    try { this.indoor = new IndoorLight(this.lamps); } catch (e) { console.warn('[indoor]', e); this.indoor = null; }
  }

  // indoor 不传就按位置判断
  spot(color, intensity, position, target, { distance, angle, penumbra }, indoor) {
    const l = new THREE.SpotLight(color, intensity, distance, angle, penumbra, 2);
    l.position.copy(position);
    l.target.position.copy(target);
    this.lamps.push({ light: l, base: l.color.clone(), indoor: indoor ?? indoorAt(position.x, position.y, position.z), scale: 1 });
    return l;
  }

  add(light, shadowed = false) {
    this.scene.add(light);
    if (light.target) this.scene.add(light.target);
    if (shadowed) {
      light.shadow.autoUpdate = false;
      light.shadow.needsUpdate = true;
      this.shadowed.push(light);
      this.reweigh();
    }
  }

  // 追加动态灯（无人机探照灯）进体积雾
  addFogLights(lights, strength = 1) {
    for (const light of lights) this.fogLights.push({ light, strength });
  }

  refreshAllShadows() {
    for (const l of this.shadowed) l.shadow.needsUpdate = true;
  }

  // 月光这盏平行光到了白天就是太阳。o：{ position 或 dir, color, intensity, radius（纹素）或 soft（半影宽度，米）,
  // bias, normalBias, shadow（影子有多实）, weight（阴影刷新的优先级） }。改的全是 uniform，不会触发着色器重编译
  setSun(o) {
    const m = this.moon, s = m.shadow;
    if (o.position) m.position.copy(o.position);
    else m.position.copy(o.dir).normalize().multiplyScalar(SUN_DIST).add(m.target.position);
    m.color.copy(o.color);
    m.intensity = o.intensity;
    // soft 按米给，换算成纹素：省内存档阴影图小一半，半影看上去还是一样宽
    s.radius = o.radius ?? (o.soft * s.mapSize.x) / SHADOW_SPAN;
    s.bias = o.bias;
    s.normalBias = o.normalBias;
    s.intensity = o.shadow ?? 1;
    this.sunWeight = o.weight ?? 1;
    this.reweigh();
    this.refreshAllShadows();
  }

  // 按时段调人造灯，分室外、室内两档。乘在灯的颜色上（渲染用的是 颜色 × 强度）：
  // 强度留给各分区的 update 和这里的频闪去写，两边互不覆盖
  setLamps(outdoor = 1, indoor = 1) {
    for (const e of this.lamps) {
      e.scale = e.indoor ? indoor : outdoor;
      e.light.color.copy(e.base).multiplyScalar(e.scale);
    }
    if (this.indoor) this.indoor.scale = indoor;
    this.reweigh();
  }

  // 阴影刷新的权重：调得很暗的灯不值得每轮都重画阴影，省下的名额给太阳。全是 1 时就是原来的轮流刷新
  reweigh() {
    const list = this.shadowed;
    if (this.weight.length !== list.length) {
      this.debt = new Float32Array(list.length);
      this.weight = new Float32Array(list.length);
    }
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (l === this.moon) { this.weight[i] = this.sunWeight; continue; }
      let k = 1;
      for (const e of this.lamps) if (e.light === l) { k = e.scale; break; }
      this.weight[i] = Math.max(0.02, k);
    }
  }

  // 阴影分帧刷新：每盏灯按权重有自己的刷新率，只有投影范围里有东西在动的灯才重画（shadow_sched.js）。
  // __dbg.perf.shadow = false 退回原来的做法：每帧固定重画 perFrame 张，按权重攒欠账、挑欠得最多的
  update(dt) {
    this.time += dt;
    if (this.dynamicShadows && PERF.shadow) {
      this.sched.update(dt, this.shadowed, this.weight, this.perFrame, !!this.mirror?.heavy(dt));
    } else if (this.dynamicShadows) {
      const list = this.shadowed, debt = this.debt, n = Math.min(list.length, debt.length);
      for (let i = 0; i < n; i++) debt[i] += this.weight[i];
      for (let k = 0; k < this.perFrame; k++) {
        let best = -1, most = 0;
        for (let i = 0; i < n; i++) if (debt[i] > most) { most = debt[i]; best = i; }
        if (best < 0) break;
        list[best].shadow.needsUpdate = true;
        debt[best] = 0;
      }
    }
    // 箱内日光灯：偶尔频闪
    const t = this.time;
    const flick = Math.sin(t * 37) * Math.sin(t * 5.3) > 0.82 || Math.sin(t * 0.6) > 0.985 ? 0.25 : 1;
    this.boxLight.intensity = 150 * flick;
    this.indoor?.update();
  }
}
