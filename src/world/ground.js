import * as THREE from 'three';
import { patchMaterial, inject, withWorldPos } from '../gfx/materials.js';
import { canvasTexture } from '../gfx/geo.js';

// 地面网格的边长，和积水宏观图覆盖的边长（宏观图镜像平铺，网格比它大也不会拉丝）
export const GROUND_SIZE = 220;
export const MACRO_SIZE = 120;
// 地面喷涂图覆盖的方形范围（罩住全图）和分辨率
export const PAINT = { x0: -32, z0: -50, size: 76, res: 2560 };
// 每帧都要用的临时量，不在渲染路径上现分配
const _pos = new THREE.Vector3(), _look = new THREE.Vector3(), _up = new THREE.Vector3(), _rot = new THREE.Matrix4();

// 平面反射：把相机沿地面镜像再渲染一遍。带 mip 链，粗糙的湿沥青用高层 mip 加竖向多次采样拉出光带。
class PlanarReflection {
  constructor() {
    this.camera = new THREE.PerspectiveCamera();
    this.matrix = new THREE.Matrix4();
    this.rt = null;
    this.lods = 1;
  }

  resize(w, h) {
    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    this.lods = Math.floor(Math.log2(Math.max(w, h)));
  }

  render(renderer, scene, camera) {
    const vc = this.camera;
    const pos = _pos.setFromMatrixPosition(camera.matrixWorld);
    if (pos.y <= 0.01) return false;
    const rot = _rot.extractRotation(camera.matrixWorld);
    const look = _look.set(0, 0, -1).applyMatrix4(rot).add(pos);
    const up = _up.set(0, 1, 0).applyMatrix4(rot);
    vc.position.set(pos.x, -pos.y, pos.z);
    vc.up.set(up.x, -up.y, up.z);
    vc.lookAt(look.x, -look.y, look.z);
    vc.updateMatrixWorld(true);
    vc.projectionMatrix.copy(camera.projectionMatrix);
    vc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.matrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, vc);
    return true;
  }
}

// 湿沥青的直射高光，替换 RE_Direct_Physical 里的 BRDF_GGX，所以要插在 three 的光照函数中间。
// 下雨时 GGX 沿地面上朝向相机的方向拉长（各向异性，横向不变），路灯照在路面上的高光拉成一条朝向玩家的竖带
const wetSpecular = /* glsl */ `
uniform float uWetRain;   // 看得见的雨（雨量，画质关了倒影和雨时为 0）：湿沥青更滑，高光和倒影拉成竖条
vec3 groundGGX(const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
  if (uWetRain <= 0.0) return BRDF_GGX(lightDir, viewDir, normal, material);
  float alpha = pow2(max(material.roughness, 0.045));
  vec3 t = viewDir - normal * dot(normal, viewDir);
  t = dot(t, t) > 1e-8 ? normalize(t) : vec3(1.0, 0.0, 0.0);
  vec3 b = cross(normal, t);
  vec3 h = normalize(lightDir + viewDir);
  float dotNL = saturate(dot(normal, lightDir));
  float dotNV = saturate(dot(normal, viewDir));
  float dotNH = saturate(dot(normal, h));
  float aT = alpha * (1.0 + 2.0 * uWetRain), aB = alpha;
  float th = dot(t, h) / aT, bh = dot(b, h) / aB;
  float d = th * th + bh * bh + dotNH * dotNH;
  vec3 F = F_Schlick(material.specularColorBlended, material.specularF90, saturate(dot(viewDir, h)));
  // 拉长后峰值按能量守恒会掉到三分之一，路面反而发灰；只让它掉到六成（水膜比粗糙的沥青亮，不严格守恒）
  float boost = sqrt(aT / alpha);
  return F * (V_GGX_SmithCorrelated(alpha, dotNL, dotNV) * RECIPROCAL_PI * boost / (aT * aB * d * d));
}`;

const header = /* glsl */ `
uniform sampler2D tMacro;
uniform sampler2D tPaint;
uniform sampler2D tPlanar;
uniform float uPlanarOn;
uniform float uPlanarLods;
uniform float uFovY;
uniform float uTime;
uniform float uFrame;
uniform float uRain;
uniform float uWetness;   // 整体潮湿程度：1 = 刚下过雨（夜景原样），越小越干、越粗糙、颜色越浅
uniform float uPuddle;    // 积水水位的偏移：负值把水洼收小
uniform float uMacroSize;
uniform vec3 uPaintRect;  // minX, minZ, 1/size
varying vec4 vPlanar;
float gWater = 0.0;
// Hash without Sine，Dave Hoskins，MIT，见 THIRD_PARTY_NOTICES.md
float gHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Interleaved Gradient Noise，Jorge Jimenez
float gIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
// 雨滴涟漪：每个格子周期性落一滴，圆环向外扩散并衰减
vec2 rippleLayer(vec2 p, float t) {
  vec2 cell = floor(p), f = fract(p);
  vec2 acc = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 c = cell + o;
      float h = gHash(c);
      float life = fract(t * (0.55 + 0.5 * gHash(c + 5.3)) + h);
      vec2 d = o + vec2(gHash(c + 3.1), gHash(c + 7.7)) - f;
      float dist = length(d);
      float radius = life * 0.95;
      float ring = sin((dist - radius) * 30.0) * smoothstep(0.11, 0.0, abs(dist - radius)) * (1.0 - life) * (1.0 - life);
      acc += d / max(dist, 1e-4) * ring;
    }
  }
  return acc;
}
vec3 groundRadiance(vec3 viewDir, vec3 normal, float roughness) {
  #ifdef USE_ENVMAP
    vec3 ibl = getIBLRadiance(viewDir, normal, roughness);
  #else
    vec3 ibl = vec3(0.0);
  #endif
  if (uPlanarOn < 0.5) return ibl;
  vec2 uv = vPlanar.xy / vPlanar.w;
  vec3 wN = inverseTransformDirection(normal, viewMatrix);
  vec3 toCam = normalize(cameraPosition - vWPos);
  vec2 fwd = normalize(-toCam.xz + 1e-5);
  vec2 lat = vec2(-fwd.y, fwd.x);
  float sinE = clamp(toCam.y, 0.0, 1.0);
  // 法线倾斜 → 反射光线偏转：朝向观察者的倾斜在掠射角下被拉长成竖向光带
  vec2 defl = vec2(dot(wN.xz, lat) * sinE, dot(wN.xz, fwd)) * (2.0 / uFovY) * 0.5;
  float lod = clamp(roughness * 8.0, 0.0, uPlanarLods - 2.0);
  // 下雨时倒影的长度另加一截，宽度（mip 层）仍跟着粗糙度走：灯在湿沥青上拉成窄长的竖条；积水（很光滑）不受影响
  float sRough = roughness + uWetRain * 0.36 * smoothstep(0.06, 0.18, roughness);
  float streak = sRough * (0.25 + 0.75 * (1.0 - sinE)) * mix(0.42, 0.66, uWetRain) / uFovY;
  float jit = gIgn(gl_FragCoord.xy + uFrame * 5.588238);
  vec3 acc = vec3(0.0), peak = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 6; i++) {
    float o = (float(i) + jit) / 6.0 * 2.0 - 1.0;
    float w = exp(-o * o * 2.2);
    vec3 c = textureLod(tPlanar, uv + defl + vec2(0.0, o * streak), lod).rgb;
    acc += c * w;
    peak = max(peak, c * w);
    wsum += w;
  }
  vec3 refl = acc / wsum;
  // 真实的灯头比周围亮上千倍，倒影是一整条亮带；这里的灯没那么亮，沿竖线平均开就只剩一片暗光。
  // 下雨时把竖线上最亮的那个采样补回大半，再整体提一点（水膜），倒影才成条
  refl = (refl + max(peak - refl, 0.0) * 0.8 * uWetRain) * (1.0 + 0.25 * uWetRain);
  return mix(ibl, refl, smoothstep(0.8, 0.5, roughness));
}`;

export class Ground {
  // paintDraw(ctx, toPx, pxPerMeter)：关卡把地面标线、喷字画进一张俯视图
  constructor(materials, paintDraw) {
    const t = materials.tex;
    this.reflection = new PlanarReflection();
    this.uniforms = {
      tMacro: { value: t.groundMacro },
      tPaint: { value: null },
      tPlanar: { value: null },
      uPlanarOn: { value: 0 },
      uPlanarLods: { value: 1 },
      uPlanarMat: { value: this.reflection.matrix },
      uFovY: { value: 1.2 },
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uRain: { value: 1 },
      uWetness: { value: 1 },
      uPuddle: { value: 0 },
      uWetRain: { value: 0 },
      uMacroSize: { value: MACRO_SIZE },
      uPaintRect: { value: new THREE.Vector3(PAINT.x0, PAINT.z0, 1 / PAINT.size) },
    };
    t.groundMacro.wrapS = t.groundMacro.wrapT = THREE.MirroredRepeatWrapping;
    const res = PAINT.res, ppm = res / PAINT.size;
    const paint = canvasTexture(res, res, (ctx) => {
      ctx.clearRect(0, 0, res, res);
      paintDraw?.(ctx, (x, z) => [(x - PAINT.x0) * ppm, (z - PAINT.z0) * ppm], ppm);
    });
    paint.flipY = false;
    paint.wrapS = paint.wrapT = THREE.ClampToEdgeWrapping;
    this.uniforms.tPaint.value = paint;

    // 沥青一张图铺多大、法线多强跟着贴图走：程序化的是 3 米，照片（photo_tex.js）自己带 tile 和 normal
    const tile = t.asphalt.tile || 3, nrm = t.asphalt.normal || 0.75;
    // 第二层采样（明度起伏、水位）在世界里的周期保持 13 米不变
    const uvB = (0.231 * tile / 3).toFixed(4);
    const mat = new THREE.MeshStandardMaterial({ map: t.asphalt.map, normalMap: t.asphalt.normalMap, roughness: 1, metalness: 0 });
    mat.normalScale.set(nrm, nrm);
    withWorldPos(mat);
    patchMaterial(mat, 'ground', (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = inject(`uniform mat4 uPlanarMat;\nvarying vec4 vPlanar;\n${shader.vertexShader}`,
        '#include <fog_vertex>', 'vPlanar = uPlanarMat * vec4(vWPos, 1.0);');
      let f = shader.fragmentShader;
      f = inject(f, '#include <lights_physical_pars_fragment>', header);
      let phys = inject(THREE.ShaderChunk.lights_physical_pars_fragment, 'void RE_Direct_Physical(', wetSpecular, 'before');
      phys = inject(phys, 'vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );',
        'vec3 specularBRDF = groundGGX( directLight.direction, geometryViewDir, geometryNormal, material );', 'replace');
      f = f.replace('#include <lights_physical_pars_fragment>', phys);
      f = inject(f, '#include <map_fragment>', /* glsl */ `
        vec4 macro = texture2D(tMacro, vWPos.xz / uMacroSize + 0.5);
        vec4 paintS = texture2D(tPaint, clamp((vWPos.xz - uPaintRect.xy) * uPaintRect.z, 0.0, 1.0));
        vec4 asph = texture2D(map, vMapUv);
        vec4 asphB = texture2D(map, vMapUv * ${uvB} + 0.37);
        float hgt = asph.a;
        float waterLevel = macro.r * 1.2 + (macro.a - 0.5) * 0.25 + (asphB.a - 0.5) * 0.12 + uPuddle;
        gWater = smoothstep(0.5, 0.66, waterLevel - hgt * 0.34);
        float damp = clamp(0.5 + macro.r * 0.7, 0.0, 1.0) * uWetness;
        vec3 alb = asph.rgb * (0.55 + 0.9 * asphB.g * 4.0) * (0.45 + 1.1 * macro.a);
        alb = mix(alb, alb * 0.35, macro.b * 0.7);
        alb *= 1.0 - 0.85 * macro.g;
        float paintA = smoothstep(0.3, 0.62, paintS.a * (0.5 + 0.7 * hgt + 0.5 * asphB.a) - macro.b * 0.2);
        alb = mix(alb, paintS.rgb * (0.55 + 0.45 * hgt), paintA * 0.92);
        alb *= mix(1.0, 0.5, damp);
        alb *= mix(1.0, 0.55, gWater);
        diffuseColor.rgb = alb;`, 'replace');
      f = inject(f, '#include <roughnessmap_fragment>', /* glsl */ `
        float roughnessFactor = mix(0.9, mix(0.36, 0.24, uWetRain), damp) + (0.5 - hgt) * 0.2;
        roughnessFactor = mix(roughnessFactor, mix(0.5, 0.26, uWetRain), paintA * 0.6);
        roughnessFactor = mix(roughnessFactor, 0.3, macro.b * 0.6);
        roughnessFactor = clamp(mix(roughnessFactor, 0.03, gWater), 0.03, 1.0);`, 'replace');
      f = inject(f, '#include <normal_fragment_maps>', /* glsl */ `
        {
          vec3 flat_ = nonPerturbedNormal;
          if (gWater > 0.01 && uRain > 0.0) {
            vec2 rp = rippleLayer(vWPos.xz * 2.6, uTime * 0.9) + rippleLayer(vWPos.xz * 4.7 + 13.0, uTime * 1.2 + 0.5) * 0.6;
            float fade = exp(-length(vViewPosition) * 0.035);
            vec3 rn = normalize(vec3(rp.x * 0.22 * uRain * fade, 1.0, rp.y * 0.22 * uRain * fade));
            flat_ = normalize((viewMatrix * vec4(rn, 0.0)).xyz);
          }
          normal = normalize(mix(normal, flat_, gWater));
        }`);
      f = f.replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps);
      f = inject(f, 'vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
        'vec3 iblRadiance = groundRadiance( geometryViewDir, geometryNormal, material.roughness );', 'replace');
      shader.fragmentShader = f;
    });
    this.material = mat;

    const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.enabled = true;
    // rainPuddle：雨看得见时积水水位再抬多少（省内存档不下雨，地面保持原样）
    this.wet = { wetness: 1, puddle: 0, rain: 1, rainPuddle: 0 };
    this.syncWet();
  }

  resize(w, h) {
    this.reflection.resize(Math.max(2, w >> 1), Math.max(2, h >> 1));
  }

  // 时段用：潮湿程度、水洼大小、雨量（涟漪）、下雨时积水多涨多少。默认值就是夜景下着雨的样子
  setWet(wetness = 1, puddle = 0, rain = 1, rainPuddle = 0) {
    Object.assign(this.wet, { wetness, puddle, rain, rainPuddle });
    this.syncWet();
  }

  // 画质随时会关掉倒影和雨（enabled），每帧按它重算一遍
  syncWet() {
    const u = this.uniforms, w = this.wet, shown = this.enabled ? w.rain : 0;
    u.uWetness.value = w.wetness;
    u.uRain.value = w.rain;
    u.uWetRain.value = shown;
    u.uPuddle.value = w.puddle + w.rainPuddle * shown;
  }

  // 拍反射探针之前调用：倒影贴图是按主相机投影的，换个机位就对不上，探针里只用环境贴图
  planarOff() {
    this.uniforms.uPlanarOn.value = 0;
  }

  // 主通道之前调用：渲染镜像画面并更新地面材质参数
  update(renderer, scene, camera, time, frame) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uFrame.value = frame % 64;
    u.uFovY.value = THREE.MathUtils.degToRad(camera.fov);
    this.syncWet();
    if (!this.enabled) { u.uPlanarOn.value = 0; return; }
    this.mesh.visible = false;
    const ok = this.reflection.render(renderer, scene, camera);
    this.mesh.visible = true;
    u.tPlanar.value = this.reflection.rt.texture;
    u.uPlanarLods.value = this.reflection.lods;
    u.uPlanarOn.value = ok ? 1 : 0;
  }
}
