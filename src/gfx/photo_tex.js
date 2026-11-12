import * as THREE from 'three';

// Poly Haven 的照片贴图（public/assets/tex/polyhaven，来源和许可见 public/assets/README.md）。
// 这里负责加载、缩小、上传，再对着程序化贴图把亮度对齐，烘成游戏里实际用的几张图。
// 任何一步失败都只警告一次，材质继续用程序化贴图。地址带 ?nophoto 时整个跳过（前后对比用）。

const DIR = 'assets/tex/polyhaven';
const SRC = 1024; // 原图边长
const TIMEOUT = 8000; // 整批照片最多等这么久（毫秒），超时就按加载失败处理，不让启动卡在这里
// 实际接进游戏的几套。corrugated_iron_02 没有用上（原因见 README 的“状态”），所以不加载
const SETS = ['asphalt_04', 'concrete_wall_008', 'concrete_floor_damaged_01', 'container_side'];
const KINDS = { diff: true, nor_gl: false, arm: false }; // 值：是不是 sRGB
// 一张贴图铺到世界里的边长（米）
export const PHOTO_TILE = { asphalt: 2.5, concreteWall: 3.6, concreteFloor: 3, paintDetail: 3.1 };

let warned = false;
function warnOnce(e) {
  if (warned) return;
  warned = true;
  console.warn('[photo] 照片贴图没加载起来，改用程序化贴图', e);
}

async function decode(url, size, signal) {
  const res = await fetch(url, signal ? { signal } : undefined);
  const blob = res.ok ? await res.blob() : null;
  // 开发服务器对不存在的文件会回一份 index.html，所以还要看类型
  if (!blob || !blob.type.startsWith('image/')) throw new Error(`${url} ${res.status} ${blob?.type || ''}`);
  // 解码时就翻转、缩小：省内存档不把原图传上显卡
  const o = { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  if (size < SRC) Object.assign(o, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
  return createImageBitmap(blob, o);
}

function upload(renderer, bitmap, srgb, aniso) {
  const t = new THREE.Texture(bitmap);
  t.flipY = false; // 解码时已经翻过
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = aniso;
  t.userData.size = bitmap.width;
  t.needsUpdate = true;
  renderer.initTexture(t);
  bitmap.close(); // 显卡上已经有一份，解码出来的这份不留
  return t;
}

// 开始加载（不等它）：返回的 Promise 给出 { 名字: { diff, nor, arm } }，失败时是 null
export function loadPhotoSets(gen) {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('nophoto')) return Promise.resolve(null);
  const size = Math.max(64, Math.round(SRC * (gen.scale || 1)));
  const base = import.meta.env?.BASE_URL || '/';
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT) : null;
  const jobs = [];
  for (const name of SETS) for (const kind of Object.keys(KINDS)) jobs.push(decode(`${base}${DIR}/${name}/${name}_${kind}_1k.jpg`, size, signal));
  return Promise.allSettled(jobs).then((done) => {
    const bad = done.find((r) => r.status === 'rejected');
    if (bad) {
      // 有一张失败就整批不用，已经解码出来的当场释放
      for (const r of done) r.value?.close();
      throw bad.reason;
    }
    const bitmaps = done.map((r) => r.value);
    const out = {}, up = [];
    let i = 0;
    try {
      for (const name of SETS) {
        out[name] = {};
        for (const [kind, srgb] of Object.entries(KINDS)) {
          const t = upload(gen.renderer, bitmaps[i++], srgb, Math.min(kind === 'nor_gl' ? 16 : 4, gen.maxAniso));
          up.push(t);
          out[name][kind === 'nor_gl' ? 'nor' : kind] = t;
        }
      }
    } catch (e) {
      // 传到一半出错：已经上了显卡的和还没传的都放掉
      for (const t of up) t.dispose();
      for (const b of bitmaps) b.close();
      throw e;
    }
    return out;
  }).catch((e) => {
    warnOnce(e);
    return null;
  });
}

const head = /* glsl */ `
uniform sampler2D tDiff;
uniform sampler2D tNor;
uniform sampler2D tArm;
uniform sampler2D tRef;
uniform sampler2D tRefOrm;
uniform vec4 uK;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// 整张图的平均值：取最高一级 mip
vec4 meanOf(sampler2D t) { return textureLod(t, vec2(0.5), 20.0); }`;

// 沥青：rgb 是底色（平均亮度对到程序化沥青上），a 是骨料高度，地面着色器靠它决定积水先淹哪里。
// 照片没有高度图，用“石子亮、缝里暗”加上环境光遮蔽凑一个。uK：x 去云斑用的 mip 级，y、z 高度里明度和遮蔽各占多少，w 底色反差
const ASPHALT = /* glsl */ `${head}
vec4 pixel(vec2 uv) {
  vec3 d = texture2D(tDiff, uv).rgb, dMean = meanOf(tDiff).rgb;
  vec4 ref = meanOf(tRef);
  // 照片里几十厘米以上的明暗云斑去掉一多半：这一档起伏由地面的宏观图给，不然每隔一张图重复一次，远看是格子
  vec3 low = textureLod(tDiff, uv, uK.x).rgb;
  d = mix(d, d * dMean / max(low, vec3(1e-3)), 0.6);
  // 石子和沥青之间的反差略微拉开：远处缩小之后还看得出颗粒
  d = max(dMean + (d - dMean) * uK.w, vec3(0.0));
  float ao = texture2D(tArm, uv).r;
  float h = ref.a + (lum(d) / lum(dMean) - 1.0) * uK.y + (ao - meanOf(tArm).r) * uK.z;
  return vec4(d * (lum(ref.rgb) / lum(dMean)), sat(h));
}`;

// 混凝土：rgb 是底色，a 是粗糙度，平均值都对到程序化混凝土上（各处材质的 color、roughness 是按它调的）。
// uK：x 照片色偏保留多少，y 环境光遮蔽压进底色的比例，z 粗糙度起伏的倍数
const CONCRETE = /* glsl */ `${head}
vec4 pixel(vec2 uv) {
  vec3 d = texture2D(tDiff, uv).rgb, dMean = meanOf(tDiff).rgb;
  vec3 arm = texture2D(tArm, uv).rgb;
  vec3 ref = meanOf(tRef).rgb;
  vec3 alb = d * (lum(ref) / lum(dMean));
  alb = mix(lum(alb) * ref / lum(ref), alb, uK.x);
  alb *= mix(1.0, arm.r, uK.y);
  float rough = sat(meanOf(tRefOrm).g + (arm.g - meanOf(tArm).g) * uK.z);
  return vec4(alb, rough);
}`;

// 涂装金属的细节：集装箱侧板的照片沿波纹方向取列平均再减掉，波纹本身没了（几何体上已经有真的波纹，
// 间距也对不上），剩下凹坑、划痕、蹭脏。rg = 法线偏移，b = 明度比（0.5 是不变），a = 粗糙度偏移（0.5 是不变）
const PAINT_DETAIL = /* glsl */ `${head}
vec4 pixel(vec2 uv) {
  vec3 n = texture2D(tNor, uv).xyz, d = texture2D(tDiff, uv).rgb, a = texture2D(tArm, uv).rgb;
  vec3 nM = vec3(0.0), dM = vec3(0.0), aM = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    vec2 q = vec2(uv.x, (float(i) + 0.5) / 64.0);
    nM += textureLod(tNor, q, 2.0).xyz;
    dM += textureLod(tDiff, q, 2.0).rgb;
    aM += textureLod(tArm, q, 2.0).rgb;
  }
  nM /= 64.0; dM /= 64.0; aM /= 64.0;
  // 明度比截在 0.35~0.65：原图底边有两道喷字残留的深色短划，不截的话叠到漆面上是纯黑的小条，每张图重复一次
  return vec4(0.5 + (n.xy - nM.xy) * uK.x, clamp(0.5 * lum(d) / lum(dM), 0.35, 0.65), sat(0.5 + (a.g - aM.g) * uK.y));
}`;

// 把加载好的照片烘成游戏用的贴图，换掉 tex 里的程序化沥青和混凝土，顺带释放用不着的图。
// sets 是 null（没加载起来或被关掉）时什么都不做，返回 false
export function applyPhotoSets(gen, sets, tex) {
  if (!sets) return false;
  const made = [];
  // 烘焙着色器编译失败时 three 不抛异常，烘出来是黑图：挂上钩子记下来，当成失败处理
  const debug = gen.renderer.debug, prevHook = debug.onShaderError;
  let broken = false;
  debug.onShaderError = (...a) => { broken = true; prevHook?.(...a); };
  try {
    const bake = (code, uniforms, opts) => {
      const t = gen.tex(code, { size: SRC, ...opts, uniforms });
      made.push(t);
      return t;
    };
    const u = (set, ref, k) => ({
      tDiff: { value: set.diff }, tNor: { value: set.nor }, tArm: { value: set.arm },
      tRef: { value: ref?.map || null }, tRefOrm: { value: ref?.ormMap || null }, uK: { value: new THREE.Vector4(...k) },
    });
    const A = sets.asphalt_04, W = sets.concrete_wall_008, F = sets.concrete_floor_damaged_01, C = sets.container_side;
    const lowLod = Math.log2(A.diff.userData.size) - 3;
    const asphalt = bake(ASPHALT, u(A, tex.asphalt, [lowLod, 1.3, 1.5, 1.3]), { srgb: true, aniso: 16 });
    // 色偏只留三成左右：照片偏米黄，留多了整片地面和墙都发暖，和钢件、沥青的冷灰对不上
    const wall = bake(CONCRETE, u(W, tex.concrete, [0.3, 0.5, 1, 0]), { srgb: true });
    const floor = bake(CONCRETE, u(F, tex.concrete, [0.25, 0.5, 1, 0]), { srgb: true });
    const detail = bake(PAINT_DETAIL, u(C, null, [1, 1, 0, 0]), {});
    if (broken) throw new Error('烘焙着色器没编过');
    // 到这里都成了才换，免得换到一半
    for (const old of [tex.asphalt, tex.concrete]) for (const t of [old.map, old.normalMap, old.ormMap]) gen.free(t);
    for (const t of [A.diff, A.arm, W.diff, W.arm, F.diff, F.arm, C.diff, C.nor, C.arm]) t.dispose();
    const k = 3 / PHOTO_TILE.concreteWall; // 混凝土的 UV 是按 3 米一张铺的
    wall.repeat.set(k, k);
    W.nor.repeat.set(k, k);
    tex.asphalt = { map: asphalt, normalMap: A.nor, ormMap: null, tile: PHOTO_TILE.asphalt, normal: 1.4 };
    tex.concrete = {
      map: wall, normalMap: W.nor, ormMap: null,
      // 朝上的面换成地面那套；uv 是相对墙面那套的倍数
      floor: { map: floor, normalMap: F.nor, uv: PHOTO_TILE.concreteWall / PHOTO_TILE.concreteFloor },
    };
    tex.paintDetail = detail;
    return true;
  } catch (e) {
    for (const t of made) gen.free(t);
    // 照片本身也不留在显卡上
    for (const set of Object.values(sets)) for (const t of Object.values(set)) t.dispose();
    warnOnce(e);
    return false;
  } finally {
    debug.onShaderError = prevHook;
  }
}
