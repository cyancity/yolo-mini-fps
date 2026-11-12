import * as THREE from 'three';
import { daySkyGLSL, dayUniforms } from './sky_day.js';

// 程序化天空。夜里是蓝调时刻：天顶深蓝、地平线残留的橙色余晖、被余晖从下方照亮的云、星星和月亮；
// 下午和白天换成 sky_day.js 那套（uNight 为 0）。同一个着色器既画天空球，也用来烘焙环境反射。
// 下雨（uRain）时换成压低的云层：云盖满天、星月和余晖收掉，云底映着城市的橙色灯光。
const skyFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uIntensity;
uniform float uTime;
uniform float uNight;
uniform float uRain;
varying vec3 vDir;

// Hash without Sine，Dave Hoskins，MIT，见 THIRD_PARTY_NOTICES.md
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
${daySkyGLSL}

vec3 nightSky(vec3 d) {
  float y = d.y;
  float t = clamp(y, 0.0, 1.0);
  float az = dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz));
  float warm = pow(clamp(az * 0.5 + 0.5, 0.0, 1.0), 2.2) * (1.0 - 0.85 * uRain);

  vec3 zenith = vec3(0.007, 0.017, 0.05);
  vec3 mid = vec3(0.026, 0.066, 0.145);
  vec3 col = mix(mid, zenith, pow(t, 0.42));
  vec3 horizon = mix(vec3(0.05, 0.085, 0.14), vec3(1.25, 0.46, 0.13), warm);
  col = mix(col, horizon, exp(-t * 6.5));
  col += vec3(0.42, 0.11, 0.17) * warm * exp(-t * 2.6) * 0.42;
  // 城市光害贴着地平线一圈
  col += vec3(0.16, 0.09, 0.045) * exp(-t * 16.0);

  // 星星
  vec2 sp = d.xz / (abs(y) + 0.35) * 190.0;
  float star = smoothstep(0.985, 1.0, hash(floor(sp))) * smoothstep(0.15, 0.5, y);
  vec2 sf = fract(sp) - 0.5;
  col += vec3(0.8, 0.9, 1.0) * star * smoothstep(0.35, 0.0, length(sf)) * 0.5 * (1.0 - warm * 0.8) * (1.0 - uRain);

  // 月亮
  float md = dot(d, normalize(uMoonDir));
  col += vec3(0.75, 0.86, 1.0) * (1.0 - uRain) * (smoothstep(0.99985, 0.99992, md) * 14.0 + pow(max(md, 0.0), 900.0) * 0.5 + pow(max(md, 0.0), 60.0) * 0.045);

  // 云：投影到一个平面上取噪声
  if (y > 0.0) {
    vec2 cp = d.xz / (y + 0.14) * 0.9 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(cp * 1.3) * 0.65 + fbm(cp * 3.7 + 9.0) * 0.35;
    float cov = smoothstep(mix(0.42, 0.1, uRain), mix(0.78, 0.46, uRain), n) * smoothstep(0.0, mix(0.12, 0.02, uRain), y);
    float under = pow(clamp(1.0 - y * 1.6, 0.0, 1.0), 2.0);
    vec3 cloud = mix(vec3(0.014, 0.021, 0.042), vec3(0.6, 0.2, 0.085), warm * under * (0.35 + 0.65 * smoothstep(0.45, 0.75, n)));
    cloud += vec3(0.035, 0.05, 0.075) * (1.0 - warm) * under;
    // 雨云的底面：城市灯光从下面照上来，越靠地平线越亮越橙；云厚的地方（n 大）更暗，看得出云团的起伏。
    // 天顶那一端偏冷：仰视时无人机的橙色识别色要落在冷色背景上才跳得出来
    vec3 city = mix(vec3(0.027, 0.034, 0.05), vec3(0.19, 0.11, 0.065), under) * (1.15 - 0.6 * smoothstep(0.3, 0.8, n));
    cloud = mix(cloud, city, uRain);
    col = mix(col, cloud, cov * mix(0.88, 1.0, uRain));
  } else {
    // 地平线以下：湿地面的暗色反光，给环境贴图下半球用
    col = mix(col, vec3(0.012, 0.014, 0.018), smoothstep(0.0, -0.12, y));
  }
  return col;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col;
  if (uNight > 0.5) col = nightSky(d);
  else col = daySky(d);
  gl_FragColor = vec4(col * uIntensity, 1.0);
}`;

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = p.xyww;
}`;

const _disc = new THREE.Vector3();

export class Sky {
  constructor() {
    // 夜里 sunDir 是余晖的方位；白天是太阳的方向（时段切换时改写）
    this.sunDir = new THREE.Vector3(-0.45, 0.02, 0.89).normalize();
    this.moonDir = new THREE.Vector3(0.55, 0.62, -0.5).normalize();
    this.material = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uMoonDir: { value: this.moonDir },
        uIntensity: { value: 1 },
        uTime: { value: 0 },
        uNight: { value: 1 },
        uRain: { value: 0 },
        ...dayUniforms(),
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    // 顶点着色器把天空钉在远平面上（z = w），半径只要不被近平面裁掉即可
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.envTarget = null;
    this.probe = null; // 反射探针拍过之后记下位置，换时段时在原地重拍
    // 雨量由时段给；rainShown 回答这一档画质下有没有雨（省内存档不下雨，夜空就保持晴天）。
    // 看得见的雨量变了要重烤环境贴图，onRainChange 由时段模块接上
    this.rain = 0;
    this.rainShown = () => true;
    this.onRainChange = null;
  }

  update(dt) {
    this.material.uniforms.uTime.value += dt;
    // 切画质不经过时段模块，在这里补上
    if (this.syncRain()) this.onRainChange?.();
  }

  setRain(amount) {
    this.rain = amount;
    return this.syncRain();
  }

  // 把看得见的雨量写进着色器，变了返回 true
  syncRain() {
    const u = this.material.uniforms.uRain, v = this.rainShown() ? this.rain : 0;
    if (u.value === v) return false;
    u.value = v;
    return true;
  }

  // 换时段。look：{ night, sunDir }，白天再加 zenith、horizon、glow、disc、cloudLit、cloudDark、below（Vector3）和 cloud（Vector4）
  setLook(look) {
    const u = this.material.uniforms;
    u.uNight.value = look.night ? 1 : 0;
    this.sunDir.copy(look.sunDir).normalize();
    if (look.night) return;
    u.uZenith.value.copy(look.zenith);
    u.uHorizon.value.copy(look.horizon);
    u.uGlow.value.copy(look.glow);
    u.uDisc.value.copy(look.disc);
    u.uCloudLit.value.copy(look.cloudLit);
    u.uCloudDark.value.copy(look.cloudDark);
    u.uBelow.value.copy(look.below);
    u.uCloud.value.copy(look.cloud);
  }

  // 只含天空的环境贴图（关卡建好前的环境光）
  bakeEnvironment(renderer, scene) {
    const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.1, 100, cubeRT);
    const skyScene = new THREE.Scene();
    const dome = new THREE.Mesh(this.mesh.geometry, this.material);
    dome.frustumCulled = false;
    skyScene.add(dome);
    this.capture(renderer, cam, skyScene);
    this.applyEnvironment(renderer, scene, cubeRT);
    cubeRT.dispose();
  }

  // 在关卡中心拍一张带灯光的反射探针，金属和水面才有灯可映
  // 启动时 main.js 的天空贴图烤在时段模块接上雨量之前：这里先把雨量对齐（游戏这时已按存档设好画质），
  // 变了就先补烤天空，免得第一帧 update 发现雨量变了又整套重烤一遍
  bakeProbe(renderer, scene, position, hide = []) {
    if (this.syncRain()) this.bakeEnvironment(renderer, scene);
    this.probe = { position: position.clone(), hide };
    const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.2, 300, cubeRT);
    cam.position.copy(position);
    cam.layers.set(0);
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    this.capture(renderer, cam, scene);
    hide.forEach((o, i) => { o.visible = vis[i]; });
    this.applyEnvironment(renderer, scene, cubeRT);
    cubeRT.dispose();
  }

  // 换了时段之后重烤，步骤和启动时一样：先烤只有天空的环境贴图，再在它的照明下拍探针。
  // 直接重拍探针的话，场景是被上一张探针照着的，每换一次时段环境光就叠亮一点。
  // 探针还没拍过（启动途中）就只烤天空，main.js 随后会拍
  rebake(renderer, scene) {
    this.bakeEnvironment(renderer, scene);
    if (this.probe) this.bakeProbe(renderer, scene, this.probe.position, this.probe.hide);
  }

  // 管线平时关着 autoClear，拍立方体贴图时要临时打开，否则六个面的深度缓冲没清
  capture(renderer, cam, scene) {
    const auto = renderer.autoClear, disc = this.material.uniforms.uDisc.value;
    renderer.autoClear = true;
    // 日面不进环境贴图（见 sky_day.js）
    _disc.copy(disc);
    disc.set(0, 0, 0);
    cam.update(renderer, scene);
    disc.copy(_disc);
    renderer.autoClear = auto;
  }

  applyEnvironment(renderer, scene, cubeRT) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromCubemap(cubeRT.texture);
    pmrem.dispose();
    this.envTarget?.dispose();
    this.envTarget = target;
    scene.environment = target.texture;
    renderer.setRenderTarget(null);
  }
}
