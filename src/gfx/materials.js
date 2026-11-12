import * as THREE from 'three';
import './light_loop.js';
import * as W from './recipes_world.js';
import * as G from './recipes_gear.js';
import { VM_DEPTH } from '../engine/glsl.js';
import { loadPhotoSets, applyPhotoSets, PHOTO_TILE } from './photo_tex.js';
import { indoorUniforms, indoorPars, indoorApply } from './indoor_light.js';

// 在 three 的标准材质着色器上叠加补丁；多个补丁可以叠在同一个材质上
export function patchMaterial(mat, key, fn) {
  const list = (mat.userData.patches ??= []);
  list.push({ key, fn });
  mat.onBeforeCompile = (shader) => { for (const p of list) p.fn(shader); };
  mat.customProgramCacheKey = () => list.map((p) => p.key).join('|');
  mat.needsUpdate = true;
  return mat;
}

export function inject(src, anchor, code, mode = 'after') {
  if (!src.includes(anchor)) console.warn('[shader] 找不到锚点', anchor);
  const out = mode === 'after' ? `${anchor}\n${code}` : mode === 'before' ? `${code}\n${anchor}` : code;
  return src.replace(anchor, out);
}

// 片元里要用世界坐标时加这个补丁（vWPos）
export function withWorldPos(mat) {
  if (mat.userData.hasWPos) return mat;
  mat.userData.hasWPos = true;
  return patchMaterial(mat, 'wpos', (shader) => {
    shader.vertexShader = inject(`varying vec3 vWPos;\n${shader.vertexShader}`, '#include <project_vertex>', /* glsl */ `
      vec4 wp4 = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wp4 = instanceMatrix * wp4;
      #endif
      vWPos = (modelMatrix * wp4).xyz;`);
    shader.fragmentShader = `varying vec3 vWPos;\n${shader.fragmentShader}`;
  });
}

// 第一人称武器：换成独立 FOV 的投影，并把深度压到最前面一小段
export function asViewModel(mat, vmProjection) {
  mat.userData.viewModel = true;
  return patchMaterial(mat, 'vm', (shader) => {
    shader.uniforms.uVmProj = vmProjection;
    shader.vertexShader = inject(`uniform mat4 uVmProj;\n${shader.vertexShader}`, '#include <project_vertex>', /* glsl */ `
      gl_Position = uVmProj * mvPosition;
      gl_Position.z = (gl_Position.z + gl_Position.w) * ${VM_DEPTH.toFixed(3)} - gl_Position.w;`);
  });
}

// 雨后：朝上的面更亮更暗沉
const wetUniform = { value: 0.85 };
export function withWet(mat) {
  return patchMaterial(mat, 'wet', (shader) => {
    shader.uniforms.uWet = wetUniform;
    shader.fragmentShader = inject(`uniform float uWet;\n${shader.fragmentShader}`, '#include <normal_fragment_maps>', /* glsl */ `
      {
        vec3 wN = inverseTransformDirection(normal, viewMatrix);
        float wet = smoothstep(0.25, 0.85, wN.y) * uWet;
        roughnessFactor = mix(roughnessFactor, max(roughnessFactor * 0.35, 0.07), wet);
        diffuseColor.rgb *= mix(1.0, 0.72, wet);
      }`);
  });
}

// 室内：环境贴图是在露天堆场拍的，照进屋里会让地板反出不存在的高杆灯，按比例 k 压低。
// 再按世界坐标：房间盒里天光（半球补光和环境贴图）只剩门窗洞附近那些，另加房间自己的环境照度（indoor_light.js）。
// 房间盒外和原来一样，所以室内外都会摆的材质照常可以用
const HEMI = 'getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal )';
const INDOOR_ANCHORS = ['#include <envmap_physical_pars_fragment>', '#include <lights_fragment_begin>', '#include <lights_fragment_end>'];
export function withIndoor(mat, k = 0.3) {
  withWorldPos(mat);
  return patchMaterial(mat, `indoor${k}`, (shader) => {
    // 三处替换要么全做要么全不做：只插进 indoorShade 的调用而没插定义，着色器就编译不过了。
    // three 升级后锚点变了，就退回成普通材质，告警一次
    const miss = INDOOR_ANCHORS.filter((a) => !shader.fragmentShader.includes(a));
    if (!THREE.ShaderChunk.lights_fragment_begin.includes(HEMI)) miss.push(HEMI);
    if (miss.length) {
      if (!withIndoor.warned) console.warn('[shader] 室内补光找不到锚点，没有生效', miss);
      withIndoor.warned = true;
      return;
    }
    Object.assign(shader.uniforms, indoorUniforms);
    let f = shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>', indoorPars
      + THREE.ShaderChunk.envmap_physical_pars_fragment.replaceAll('envMapIntensity', `( envMapIntensity * ${k.toFixed(3)} * gSkyVis )`));
    f = f.replace('#include <lights_fragment_begin>', 'indoorShade(vWPos, inverseTransformDirection(normal, viewMatrix));\n'
      + THREE.ShaderChunk.lights_fragment_begin.replace(HEMI, `${HEMI} * gSkyVis`));
    shader.fragmentShader = inject(f, '#include <lights_fragment_end>', indoorApply, 'before');
  });
}

// 照片混凝土（photo_tex.js 烘的两套，rgb = 底色，a = 粗糙度）：map、normalMap 是墙面那套，
// 朝上的面在着色器里换成地面那套。墙和地共用同一个材质实例，调用方不用区分
const floorHead = /* glsl */ `
uniform sampler2D tFloorMap;
uniform sampler2D tFloorNor;
uniform float uFloorUv;
vec4 gPc;
vec2 gPcUvA, gPcUvB;
float gPcFloor, gPcMix;
// Hash without Sine，Dave Hoskins，MIT，见 THIRD_PARTY_NOTICES.md
float pcHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float pcNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pcHash(i), pcHash(i + vec2(1.0, 0.0)), u.x), mix(pcHash(i + vec2(0.0, 1.0)), pcHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;
function withFloorSet(mat, floor) {
  return patchMaterial(mat, 'floorset', (shader) => {
    shader.uniforms.tFloorMap = { value: floor.map };
    shader.uniforms.tFloorNor = { value: floor.normalMap };
    shader.uniforms.uFloorUv = { value: floor.uv };
    let f = floorHead + shader.fragmentShader;
    f = inject(f, '#include <map_fragment>', /* glsl */ `
      {
        gPcFloor = smoothstep(0.6, 0.85, inverseTransformDirection(normalize(vNormal), viewMatrix).y);
        // 地面那套换个位置、转 90 度再采一次，按米级的噪声混在一起，大片地面上看不出一张图一格的重复
        gPcUvA = vMapUv * uFloorUv;
        gPcUvB = gPcUvA.yx * 0.83 + vec2(0.37, 0.61);
        gPcMix = smoothstep(0.4, 0.6, pcNoise(vMapUv * 1.7 + 3.1) * 0.65 + pcNoise(vMapUv * 3.9 + 5.0) * 0.35);
        vec4 pcF = mix(texture2D(tFloorMap, gPcUvA), texture2D(tFloorMap, gPcUvB), gPcMix);
        gPc = mix(texture2D(map, vMapUv), pcF, gPcFloor);
        gPc.rgb *= 0.88 + 0.24 * pcNoise(vMapUv * 0.6 + 7.3);
        diffuseColor.rgb *= gPc.rgb;
      }`, 'replace');
    f = inject(f, '#include <roughnessmap_fragment>', 'roughnessFactor *= gPc.a;');
    f = inject(f, '#include <normal_fragment_maps>', /* glsl */ `
      {
        vec3 pcA = texture2D(tFloorNor, gPcUvA).xyz * 2.0 - 1.0;
        vec3 pcB = texture2D(tFloorNor, gPcUvB).xyz * 2.0 - 1.0;
        // 第二份的 u、v 对调过，法线的两个分量跟着对调
        vec3 pcN = mix(pcA, vec3(pcB.yx, pcB.z), gPcMix);
        pcN.xy *= normalScale;
        normal = normalize(mix(normal, normalize(tbn * pcN), gPcFloor));
      }`);
    shader.fragmentShader = f;
  });
}

// 涂装金属叠的照片细节（tex.paintDetail）：贴图密度相对磨损遮罩的倍数，和明度、粗糙度、法线各放大多少
const PAINT_DETAIL = { uv: 5.2 / PHOTO_TILE.paintDetail, albedo: 2, rough: 1.5, normal: 2 };

export class Materials {
  constructor(texgen, pipeline) {
    this.wet = wetUniform; // 墙面和箱体的潮湿程度，时段切换时改它的 value
    this.gen = texgen;
    this.pipeline = pipeline;
    this.tex = {};
    this.cache = new Map();
  }

  async build(onProgress = () => {}) {
    const g = this.gen, t = this.tex;
    // 照片贴图先发出去加载，图片在后台解码，这边同时生成程序化贴图；两边都好了才往下建材质，进游戏后不会再换图
    const photos = loadPhotoSets(g);
    const jobs = [
      ['asphalt', () => g.pbr(W.asphalt, { size: 2048, normal: 0.0035, orm: false, aniso: 16 })],
      ['concrete', () => g.pbr(W.concrete, { size: 1024, normal: 0.006, seed: 3 })],
      ['wearMask', () => g.tex(W.wearMask, { size: 2048, seed: 5 })],
      ['wearNormal', () => g.normal(W.wearNormal, { size: 2048, normal: 0.004, seed: 5 })],
      ['wood', () => g.pbr(W.wood, { size: 1024, normal: 0.006, seed: 7 })],
      ['galv', () => g.pbr(W.galv, { size: 1024, normal: 0.003, seed: 9 })],
      ['chainlink', () => g.pbr(W.chainlink, { size: 512, normal: 0.02 })],
      ['groundMacro', () => g.tex(W.groundMacro, { size: 2048, seed: 11, repeat: false })],
      ['fabric', () => g.pbr(G.fabric, { size: 512, normal: 0.012 })],
      ['camo', () => g.pbr(G.camo, { size: 1024, normal: 0.012, seed: 13, orm: false })],
      ['polymer', () => g.pbr(G.polymer, { size: 512, normal: 0.012, seed: 15 })],
      ['gunmetal', () => g.pbr(G.gunmetal, { size: 1024, normal: 0.0025, seed: 17, aniso: 16 })],
      ['blade', () => g.pbr(G.bladeSteel, { size: 1024, normal: 0.0015, seed: 19, aniso: 16 })],
      ['g10', () => g.pbr(G.g10, { size: 512, normal: 0.01, seed: 21 })],
      ['bullet', () => g.tex(G.bulletAtlas, { size: 512, srgb: true, seed: 23, repeat: false })],
      ['blob', () => g.tex(G.softBlob, { size: 128, repeat: false })],
      ['smoke', () => g.tex(G.smoke, { size: 512, seed: 25, repeat: false })],
      ['flash', () => g.tex(G.flash, { size: 512, seed: 27, repeat: false })],
      ['lensDirt', () => g.tex(G.lensDirt, { size: 1024, seed: 29, repeat: false, mips: false })],
    ];
    for (let i = 0; i < jobs.length; i++) {
      t[jobs[i][0]] = jobs[i][1]();
      onProgress((i + 1) / (jobs.length + 1), jobs[i][0]);
      await new Promise((r) => setTimeout(r, 0));
    }
    // 沥青、混凝土换成照片烘的版本（程序化的那份当亮度基准，换完释放）；没加载起来就原样用程序化的
    this.photo = applyPhotoSets(g, await photos, t);
    onProgress(1, 'photo');
    this.createShared();
  }

  // 分区模块自己的贴图：按名字缓存，第一次用到时才生成。code 是 texgen 的配方（GLSL）
  set(name, code, opts) { return (this.tex[name] ??= this.gen.pbr(code, opts)); }

  // 分区模块自己的材质：按 key 缓存，同一个 key 全场共用一个实例（合批靠它）
  one(key, make) {
    if (!this.cache.has(key)) this.cache.set(key, make());
    return this.cache.get(key);
  }

  // 由 PBR 三件套建标准材质。indoor：室内表面传 0.3 左右，压低环境反射（同时应当 wet: false）
  pbr(set, { color = 0xffffff, rough = 1, metal = 0, normal = 1, wet = true, indoor = 0, ...rest } = {}) {
    const m = new THREE.MeshStandardMaterial({
      map: set.map, normalMap: set.normalMap, color, roughness: rough, metalness: metal, ...rest,
    });
    m.normalScale.set(normal, normal);
    if (set.ormMap) {
      m.roughnessMap = set.ormMap;
      if (metal > 0) m.metalnessMap = set.ormMap;
    }
    if (set.floor) withFloorSet(m, set.floor);
    if (indoor) withIndoor(m, indoor);
    return wet ? withWet(m) : m;
  }

  // 涂装金属：颜色、锈、污垢、露底都由磨损遮罩在着色器里合成。photo: false 不叠照片细节
  paint(color, { wear = 0.45, dirt = 0.6, rough = 0.5, wet = true, side = THREE.FrontSide, indoor = 0, photo = true } = {}) {
    const key = `${color}|${wear}|${dirt}|${rough}|${wet}|${side}|${indoor}${photo ? '' : '|plain'}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const m = new THREE.MeshStandardMaterial({
      map: this.tex.wearMask, normalMap: this.tex.wearNormal, color, roughness: rough, metalness: 0, side,
    });
    m.normalScale.set(0.9, 0.9);
    withWorldPos(m);
    // 有照片细节时多采一张图：划痕和蹭脏叠在漆色上（不动漆色本身），凹坑进法线
    const detail = photo ? this.tex.paintDetail : null, D = PAINT_DETAIL;
    patchMaterial(m, detail ? 'paintD' : 'paint', (shader) => {
      shader.uniforms.uWear = { value: wear };
      shader.uniforms.uDirt = { value: dirt };
      if (detail) shader.uniforms.tPaintDetail = { value: detail };
      let f = `uniform float uWear;\nuniform float uDirt;\nuniform sampler2D tPaintDetail;\nvec4 gPd = vec4(0.5);\n${shader.fragmentShader}`;
      f = inject(f, '#include <map_fragment>', /* glsl */ `
        ${detail ? `gPd = texture2D(tPaintDetail, vMapUv * ${D.uv.toFixed(4)});
        diffuseColor.rgb *= max(1.0 + (gPd.b * 2.0 - 1.0) * ${D.albedo.toFixed(2)}, 0.0);` : ''}
        vec4 pm = texture2D(map, vMapUv);
        float lowBias = smoothstep(1.8, 0.0, vWPos.y);
        float rustT = mix(0.8, 0.5, uWear);
        float rust = smoothstep(rustT, rustT + 0.09, pm.r + lowBias * 0.06);
        float grime = clamp((pm.g - 0.3) * 1.7 * uDirt + lowBias * lowBias * 0.55 * uDirt, 0.0, 1.0);
        float bare = clamp(pm.a * (1.0 - rust) * uWear * 1.5, 0.0, 1.0);
        vec3 rustCol = mix(vec3(0.085, 0.03, 0.012), vec3(0.3, 0.12, 0.04), pm.b) * (0.6 + 0.8 * pm.g);
        vec3 pcol = diffuseColor.rgb * (0.74 + 0.5 * pm.b);
        pcol = mix(pcol, rustCol, rust);
        pcol = mix(pcol, pcol * vec3(0.3, 0.27, 0.24), grime);
        // 露底：底漆和浮锈为主，少量见到钢
        diffuseColor.rgb = mix(pcol, mix(vec3(0.2, 0.1, 0.06), vec3(0.4), pm.b * pm.b), bare);`, 'replace');
      f = inject(f, '#include <roughnessmap_fragment>', /* glsl */ `
        float roughnessFactor = roughness + (pm.b - 0.5) * 0.16 + (gPd.a - 0.5) * ${D.rough.toFixed(2)};
        roughnessFactor = mix(roughnessFactor, 0.93, rust);
        roughnessFactor = mix(roughnessFactor, 0.82, grime * 0.6);
        roughnessFactor = clamp(mix(roughnessFactor, 0.55, bare), 0.05, 1.0);`, 'replace');
      f = inject(f, '#include <metalnessmap_fragment>', 'float metalnessFactor = bare * pm.b * pm.b;', 'replace');
      if (detail) {
        f = inject(f, '#include <normal_fragment_maps>',
          `normal = normalize(normal + (tbn[0] * (gPd.r - 0.5) + tbn[1] * (gPd.g - 0.5)) * ${D.normal.toFixed(2)});`);
      }
      shader.fragmentShader = f;
    });
    if (wet) withWet(m);
    if (indoor) withIndoor(m, indoor);
    this.cache.set(key, m);
    return m;
  }

  emissive(color, intensity) {
    const key = `em|${color}|${intensity}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, new THREE.MeshStandardMaterial({
        color: 0x050505, emissive: color, emissiveIntensity: intensity, roughness: 0.4,
      }));
    }
    return this.cache.get(key);
  }

  // 武器、手套材质。viewModel 为 true 时加第一人称投影补丁（开发预览页传 false）。
  // 贴图幅面（boxUV 的 tile）：metal 0.25，steel/blade 0.12，polymer/rubber/gloveGrip 0.06，g10 0.08，glove 0.2，sleeve 0.6
  gear(viewModel = true) {
    const t = this.tex;
    const vm = (m) => (viewModel ? asViewModel(m, this.pipeline.vmProjection) : m);
    // 受光的材质再加室内补丁（k = 1：房间盒外不变）：进了屋，枪和手跟着房间的照度走，不再吃满天光
    const lit = (m) => vm(viewModel ? withIndoor(m, 1) : m);
    const std = (o) => lit(new THREE.MeshStandardMaterial(o));
    const raw = (o) => vm(new THREE.MeshStandardMaterial(o));
    const set = (s, o = {}) => lit(this.pbr(s, { wet: false, ...o }));
    return {
      metal: set(t.gunmetal, { metal: 1 }),
      steel: set(t.blade, { metal: 1, color: 0x8d9096 }),
      blade: set(t.blade, { metal: 1 }),
      polymer: set(t.polymer),
      g10: set(t.g10),
      glove: set(t.fabric, { color: 0x2c2d30 }),
      gloveGrip: std({ color: 0x0b0b0c, roughness: 0.62, normalMap: t.polymer.normalMap }),
      sleeve: set(t.camo),
      rubber: std({ color: 0x0c0c0d, roughness: 0.85, normalMap: t.polymer.normalMap }),
      brass: std({ color: 0xb08a3a, metalness: 1, roughness: 0.28 }),
      black: std({ color: 0x020202, roughness: 0.95 }),
      lens: raw({ color: 0x8fb5a8, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false }),
      glow: (color, intensity) => raw({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.5 }),
      decal: (map) => raw({
        map, transparent: true, depthWrite: false, roughness: 0.6, metalness: 0.2,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
    };
  }

  createShared() {
    const t = this.tex;
    this.concrete = this.pbr(t.concrete);
    this.concreteDark = this.pbr(t.concrete, { color: 0x8c8c88 });
    this.wood = this.pbr(t.wood);
    this.woodDark = this.pbr(t.wood, { color: 0x8a7a66 });
    this.galv = this.pbr(t.galv, { metal: 1 });
    this.steelDark = this.pbr(t.galv, { metal: 1, color: 0x50545a });
    this.rubber = withWet(new THREE.MeshStandardMaterial({
      color: 0x0c0c0d, roughness: 0.86, normalMap: t.polymer.normalMap,
    }));
    this.plasticOrange = withWet(new THREE.MeshStandardMaterial({
      color: 0xd9480f, roughness: 0.55, normalMap: t.polymer.normalMap,
    }));
    this.plasticBlack = withWet(new THREE.MeshStandardMaterial({
      color: 0x101113, roughness: 0.5, normalMap: t.polymer.normalMap,
    }));
    this.reflective = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.35, metalness: 0.3 });
    this.sandbag = this.pbr(t.fabric, { color: 0x9c8e70, wet: false, normal: 1.6 });
    this.tarp = this.pbr(t.fabric, { color: 0x3c4a38, rough: 0.75 });
    this.glassDark = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.08, metalness: 0.9 });
    this.black = new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.9 });
    // 室内用的几种底材：不湿，压低环境反射
    const IN = { wet: false, indoor: 0.3 };
    this.concreteIn = this.pbr(t.concrete, IN);
    this.concreteInDark = this.pbr(t.concrete, { color: 0x8c8c88, ...IN });
    this.woodIn = this.pbr(t.wood, IN);
    this.galvIn = this.pbr(t.galv, { metal: 1, ...IN });
    this.steelIn = this.pbr(t.galv, { metal: 1, color: 0x50545a, ...IN });
    // 窗玻璃：半透明，不投影（月光要能照进屋里）
    this.glass = new THREE.MeshStandardMaterial({ color: 0x9db3b6, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false });
    this.glass.userData.noShadow = true;
    this.chainlink = new THREE.MeshStandardMaterial({
      map: t.chainlink.map, normalMap: t.chainlink.normalMap, metalness: 0.9, roughness: 0.45,
      alphaHash: true, side: THREE.DoubleSide,
    });
  }
}
