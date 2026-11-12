import * as THREE from 'three';
import { setFogSun } from '../engine/post_fog.js';
import { PRESETS, NIGHT_FILL, NIGHT_GROUND } from './timeofday_presets.js';
import { collectGlows, collectCityLights, scaleGlows } from './timeofday_glow.js';
import { soldierRim } from '../enemies/soldier_mat.js';

// 时段：夜晚（启动时的样子，原样保留）、下午、白天。只在菜单里切换时调用 set()，不是每帧的事。
// 月光那盏带阴影的平行光到白天当太阳用；天空、补光、雾、曝光、雨量、海面、地面干湿、人造灯的强弱都跟着预设走，
// 切完重烤环境贴图和反射探针。改的全是 uniform、灯的颜色和强度：不增删灯，不动 visible，不触发着色器重编译。
export class TimeOfDay {
  constructor({ renderer, scene, camera, sky, level, pipeline, mats }) {
    Object.assign(this, { renderer, scene, camera, sky, level, pipeline, mats });
    this.names = ['afternoon', 'day', 'night'];
    this.name = 'night';
    this.exposure = 1;                       // 这个时段的基准曝光，游戏再乘上玩家调的亮度
    this.rain = 1;                           // 雨量 0..1
    this.ambient = new THREE.Color(0.035, 0.05, 0.085); // 烟尘和雨丝用的环境光（线性值）
    this.base = null;                        // 启动时的夜景，第一次 set() 时原样记下
    this.sea = scene.getObjectByName('sea') || null;
    // 这时武器和敌人还没进场，收到的只有关卡自己的发光材质和远处的灯火
    this.glows = collectGlows(scene, level.phys);
    this.cityLights = collectCityLights(scene);
    const fill = level.lighting.fill;
    fill.color.copy(NIGHT_FILL.sky);
    fill.groundColor.copy(NIGHT_FILL.ground);
    fill.intensity = NIGHT_FILL.intensity;
    level.ground?.setWet?.(NIGHT_GROUND.wetness, NIGHT_GROUND.puddle, this.rain, NIGHT_GROUND.rainPuddle);
    // 夜空的雨云跟着雨量走；省内存档（画质关了倒影和雨）不下雨，夜空保持晴天。看得见的雨量变了就重烤环境贴图
    sky.rain = this.rain;
    sky.rainShown = () => level.ground?.enabled !== false;
    sky.onRainChange = () => this.bake();
  }

  // 把现在的状态记成一份预设。只在第一次 set() 时调用：这时 main.js 已经把雾和泛光设好了，记下来的就是原本的夜景
  capture() {
    const { scene, sky, mats } = this, L = this.level.lighting, m = L.moon;
    const f = this.pipeline?.final, v = this.pipeline?.mat.fog.uniforms;
    return {
      sun: {
        position: m.position.clone(), color: m.color.clone(), intensity: m.intensity,
        radius: m.shadow.radius, bias: m.shadow.bias, normalBias: m.shadow.normalBias, shadow: m.shadow.intensity, weight: 1,
      },
      sky: { night: true, sunDir: sky.sunDir.clone() },
      fill: { sky: L.fill.color.clone(), ground: L.fill.groundColor.clone(), intensity: L.fill.intensity },
      env: scene.environmentIntensity,
      fog: scene.fog ? { color: scene.fog.color.clone(), density: scene.fog.density } : null,
      vol: { density: v ? v.uDensity.value : 0.008, maxDist: v ? v.uMaxDist.value : 80, sun: 0, cutoff: 1e-3 },
      exposure: this.exposure, bloom: f ? f.uBloom.value : 0.06, dirt: f ? f.uDirt.value : 0,
      rain: this.rain,
      ambient: this.ambient.clone(),
      sea: this.sea ? this.sea.material.color.clone() : null,
      ground: { ...NIGHT_GROUND },
      wet: mats?.wet ? mats.wet.value : null,
      lamps: { outdoor: 1, indoor: 1 },
      glow: { outdoor: 1, indoor: 1 },
      city: true,
      rim: soldierRim.value,
    };
  }

  // 立即切到某个时段；不认识的名字不理会
  set(name) {
    if (!Object.hasOwn(PRESETS, name)) return;
    if (!this.base) this.base = this.capture();
    if (name === this.name) return;
    this.name = name;
    this.apply({ ...this.base, ...PRESETS[name] });
  }

  apply(s) {
    const { scene, sky, level, pipeline, mats } = this, L = level.lighting, ground = level.ground;
    L.setSun(s.sun);
    L.fill.color.copy(s.fill.sky);
    L.fill.groundColor.copy(s.fill.ground);
    L.fill.intensity = s.fill.intensity;
    L.setLamps(s.lamps.outdoor, s.lamps.indoor);
    scaleGlows(this.glows, s.glow.outdoor, s.glow.indoor);
    for (const p of this.cityLights) p.visible = s.city;

    // 白天的天空跟着太阳走；夜空用它自己记着的余晖方位
    sky.setLook(s.sky.night ? s.sky : { ...s.sky, sunDir: s.sun.dir });
    sky.setRain(s.rain);
    scene.environmentIntensity = s.env;
    if (scene.fog && s.fog) {
      scene.fog.color.copy(s.fog.color);
      scene.fog.density = s.fog.density;
    }
    if (this.sea && s.sea) this.sea.material.color.copy(s.sea);
    ground?.setWet?.(s.ground.wetness, s.ground.puddle, s.rain, s.ground.rainPuddle);
    if (mats?.wet && s.wet != null) mats.wet.value = s.wet;
    soldierRim.value = s.rim;

    if (pipeline) {
      const v = pipeline.mat.fog.uniforms, f = pipeline.final;
      v.uDensity.value = s.vol.density;
      v.uMaxDist.value = s.vol.maxDist;
      setFogSun(pipeline.mat.fog, L.moon, s.vol.sun, s.vol.cutoff);
      f.uBloom.value = s.bloom;
      f.uDirt.value = s.dirt;
      // 游戏随后会按 基准 × 亮度 重写曝光；这里先按比例带过去，直接调 set() 的地方（调试、预览页）也是对的
      if (this.exposure > 0) f.uExposure.value *= s.exposure / this.exposure;
      pipeline.historyValid = false; // 整个画面都变了，TAA 的历史不能再混进来
    }
    this.exposure = s.exposure;
    this.rain = s.rain;
    this.ambient.copy(s.ambient);
    this.bake();
  }

  // 环境贴图和反射探针里烤的是上一个时段的天空和灯光，换完重烤一次（和启动时 main.js 做的一样）
  bake() {
    const { renderer, scene, sky, sea } = this;
    this.level.ground?.planarOff?.();
    // 启动时探针是带着海面拍的，低画质把海面藏起来之后重拍也照这个来
    const seaVisible = sea ? sea.visible : false;
    if (sea) sea.visible = true;
    sky.rebake(renderer, scene);
    if (sea) sea.visible = seaVisible;
  }
}
