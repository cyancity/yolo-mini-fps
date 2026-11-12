import * as THREE from 'three';
import { patchMaterial, inject, withWorldPos, withIndoor } from '../../gfx/materials.js';
import { boxUV } from '../../gfx/geo.js';
import { whMats } from './warehouse_kit.js';

// 办公楼的贴图配方（三套）和材质。幅面：地毯 2 m，塑胶地板 2.4 m，墙面乳胶漆 3 m。

// 方块地毯：4×4 块 0.5 m 的方毯，相邻两块绒向转 90°，接缝和走道磨损压暗
const CARPET = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  vec2 g = uv * 4.0, cell = floor(g), f = fract(g);
  float turn = mod(cell.x + cell.y, 2.0);
  vec2 q = mix(uv, uv.yx, turn);
  gSalt = 1.0; float rows = fbm2(q, vec2(256.0, 32.0), 3);
  gSalt = 2.0; float loops = fbm(uv, 320.0, 2);
  gSalt = 3.0; vec3 fl = voronoi(uv, 200.0);
  gSalt = 4.0; float traffic = fbm(uv, 3.0, 4);
  float fleck = smoothstep(0.32, 0.08, fl.x) * step(0.78, fl.z);
  float seam = smoothstep(0.01, 0.0, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
  float tone = 0.9 + 0.2 * h21(cell + 17.0);
  vec3 col = vec3(0.145, 0.16, 0.18) * tone * (0.72 + 0.56 * loops) * (0.86 + 0.28 * rows);
  col = mix(col, vec3(0.3, 0.31, 0.33), fleck * 0.55);
  col *= 1.0 - 0.2 * smoothstep(0.45, 0.75, traffic);
  col *= 1.0 - 0.45 * seam;
  s.albedo = col;
  s.height = 0.5 + 0.25 * loops + 0.15 * rows - 0.4 * seam;
  s.rough = 0.95;
  return s;
}`;

// 一层的塑胶地板（PVC 片材拼块）：浅灰底撒深浅两种碎点，块缝、拖痕和积灰
const VINYL = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  vec2 g = uv * 4.0, cell = floor(g), f = fract(g);
  gSalt = 1.0; vec3 c1 = voronoi(uv, 160.0);
  gSalt = 2.0; vec3 c2 = voronoi(uv, 80.0);
  gSalt = 3.0; float mottle = fbm(uv, 16.0, 4);
  gSalt = 4.0; float scuff = fbm2(uv, vec2(8.0, 96.0), 3);
  gSalt = 5.0; float grime = fbm(uv, 4.0, 4);
  float chipA = smoothstep(0.3, 0.15, c1.x) * step(0.55, c1.z);
  float chipB = smoothstep(0.25, 0.1, c2.x) * step(0.8, c2.z);
  float seam = smoothstep(0.005, 0.0, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
  float tone = 0.93 + 0.12 * h21(cell + 5.0);
  vec3 col = vec3(0.47, 0.465, 0.44) * tone * (0.92 + 0.16 * mottle);
  col = mix(col, vec3(0.26, 0.26, 0.25), chipA * 0.55);
  col = mix(col, vec3(0.64, 0.62, 0.58), chipB * 0.5);
  float dirt = smoothstep(0.5, 0.8, grime) * 0.25 + smoothstep(0.7, 0.9, scuff) * 0.3;
  col *= 1.0 - dirt;
  col *= 1.0 - 0.5 * seam;
  s.albedo = col;
  s.height = 0.5 - 0.5 * seam + 0.04 * mottle;
  s.rough = sat(0.36 + 0.3 * dirt + 0.1 * mottle + 0.3 * seam);
  return s;
}`;

// 乳胶漆墙面：大块的深浅起伏、滚筒竖纹、细颗粒，偶尔几处蹭脏
const PLASTER = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; float macro = fbm(uv, 3.0, 5);
  gSalt = 2.0; float stipple = fbm(uv, 300.0, 2);
  gSalt = 3.0; float roll = fbm2(uv, vec2(14.0, 2.0), 3);
  gSalt = 4.0; float smudge = fbm(uv, 9.0, 4);
  vec3 col = vec3(0.8, 0.79, 0.76) * (0.94 + 0.08 * macro + 0.03 * roll);
  col *= 1.0 - 0.14 * smoothstep(0.62, 0.86, smudge);
  s.albedo = col;
  s.height = 0.5 + 0.2 * stipple + 0.06 * roll;
  s.rough = 0.8 + 0.12 * stipple;
  return s;
}`;

// 矿棉吸音板：一张图一块（0.6 m，UV 对齐龙骨）。细密针孔、不规则的虫蛀纹、四边倒角压暗
const TILE = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; vec3 pin = voronoi(uv, 72.0);
  gSalt = 2.0; float worm = fbm(uv, 10.0, 4);
  gSalt = 3.0; float mask = fbm(uv, 6.0, 3);
  gSalt = 4.0; float macro = fbm(uv, 2.0, 3);
  gSalt = 5.0; float grain = fbm(uv, 160.0, 2);
  float hole = smoothstep(0.16, 0.06, pin.x) * step(0.35, pin.z);
  float fiss = smoothstep(0.035, 0.0, abs(worm - 0.5)) * smoothstep(0.42, 0.62, mask);
  vec2 e = min(uv, 1.0 - uv);
  float bevel = smoothstep(0.0, 0.03, min(e.x, e.y));
  vec3 col = vec3(0.87, 0.86, 0.83) * (0.95 + 0.06 * macro + 0.04 * grain);
  col *= 1.0 - 0.38 * hole - 0.18 * fiss;
  col *= mix(0.7, 1.0, bevel);
  s.albedo = col;
  s.height = 0.6 + 0.05 * grain - 0.25 * hole - 0.12 * fiss - 0.35 * (1.0 - bevel);
  s.rough = 0.96;
  s.ao = 1.0 - 0.3 * hole;
  return s;
}`;

// 家具的三聚氰胺饰面板：一张图 1.2 m，印刷的橡木直纹沿 u 走，没有板缝和风化；
// 只有低频的色差、细密的导管纹和很浅的压纹，粗糙度压在 0.35 到 0.45 的半哑光
const LAMINATE = /* glsl */ `
Surf surface(vec2 uv) {
  Surf s = newSurf();
  gSalt = 1.0; float warp = fbm(uv, 3.0, 4);
  vec2 q = vec2(uv.x, uv.y + 0.05 * (warp - 0.5));
  gSalt = 2.0; float band = fbm2(q, vec2(2.0, 14.0), 4);
  gSalt = 3.0; float fine = fbm2(q, vec2(4.0, 160.0), 3);
  gSalt = 4.0; float pore = fbm2(q, vec2(48.0, 640.0), 2);
  gSalt = 5.0; float tone = fbm(uv, 2.0, 3);
  float p = smoothstep(0.62, 0.86, pore);
  vec3 col = mix(vec3(0.43, 0.31, 0.2), vec3(0.6, 0.46, 0.31), sat(0.2 + 0.8 * band));
  col *= 0.92 + 0.12 * (fine - 0.5) + 0.08 * (tone - 0.5);
  col *= 1.0 - 0.14 * p;
  s.albedo = col;
  s.height = 0.5 + 0.03 * (fine - 0.5) - 0.06 * p;
  s.rough = 0.36 + 0.06 * tone + 0.05 * p;
  return s;
}`;

// 每件家具、每个纸箱各取一个随机偏移，免得全楼的木纹和纸箱一模一样。不动关卡共用的 rand，别的摆件位置才不会跟着变
let nPiece = 0;
const hash = (n) => {
  let t = (n * 0x6d2b79f5 + 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// 饰面板的 UV：在家具自己的坐标里投影（按世界坐标投的话，转了角度的桌子木纹会横着走）。
// 加到 batch 时不要再传 tile，否则会被按世界坐标重算。vertical：纹路竖着走（门扇）
export function veneer(geo, tile = 1.2, vertical = false) {
  const k = nPiece++;
  boxUV(geo, tile, hash(k * 2), hash(k * 2 + 1));
  if (vertical) {
    const uv = geo.attributes.uv.array;
    for (let i = 0; i < uv.length; i += 2) { const u = uv[i]; uv[i] = uv[i + 1]; uv[i + 1] = u; }
  }
  return geo;
}

// 单个纸箱：复用仓库码垛那张纸箱图（3 × 4 格、隔行错半格），整箱只取同一格，颜色才不会一面一个样。
// 前后两面（z）用整格，带面单和竖着的封箱带；两头（x）只取格子右边没有面单和胶带的那一截；
// 顶面取格子上半截，封箱带正好沿 z 横穿顶面接上前后两面。同样不要再传 tile
export function cartonUV(geo) {
  const k = nPiece++;
  const ix = Math.floor(hash(k * 3) * 3), iy = Math.floor(hash(k * 3 + 1) * 4);
  const u0 = (ix - 0.5 * (iy % 2)) / 3, v0 = iy / 4;
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const sx = max.x - min.x, sy = max.y - min.y, sz = max.z - min.z;
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
    const fx = (pos.getX(i) - min.x) / sx, fy = (pos.getY(i) - min.y) / sy, fz = (pos.getZ(i) - min.z) / sz;
    let fu, fv;
    if (ay >= ax && ay >= az) { fu = 0.03 + 0.94 * fx; fv = 0.62 + 0.35 * fz; }
    else if (ax >= az) { fu = 0.6 + 0.37 * fz; fv = 0.03 + 0.94 * fy; }
    else { fu = 0.03 + 0.94 * fx; fv = 0.03 + 0.94 * fy; }
    uv[i * 2] = u0 + fu / 3;
    uv[i * 2 + 1] = v0 + fv / 4;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// 机柜指示灯闪烁用的时间
export const ledTime = { value: 0 };

// 全楼的材质表。只建一次，各模块共用同一批实例
export function officeMats(mats) {
  return mats.one('office|palette', () => {
    const IN = { wet: false, indoor: 0.3 };
    const carpetSet = mats.set('officeCarpet', CARPET, { size: 1024, normal: 0.004, seed: 41 });
    const vinylSet = mats.set('officeVinyl', VINYL, { size: 1024, normal: 0.003, seed: 43 });
    const plasterSet = mats.set('officePlaster', PLASTER, { size: 1024, normal: 0.0025, seed: 45 });
    const tileSet = mats.set('officeTile', TILE, { size: 512, normal: 0.006, seed: 47 });
    const laminateSet = mats.set('officeLaminate', LAMINATE, { size: 1024, normal: 0.002, seed: 49 });
    // 室内的涂装件和塑料件：不要锈，不要雨水
    const plain = (color, rough, metal, normalMap) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...(normalMap && { normalMap }) });
      m.normalScale.set(0.5, 0.5);
      return withIndoor(m, 0.3);
    };
    const led = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xffffff, emissiveIntensity: 10, roughness: 0.4 });
    withWorldPos(led);
    // 每颗灯按所在的 4 cm 格子取随机数：颜色、频率、相位都不一样，一个材质就能各闪各的
    patchMaterial(led, 'officeLed', (shader) => {
      shader.uniforms.uLedTime = ledTime;
      shader.fragmentShader = inject(`uniform float uLedTime;\n${shader.fragmentShader}`, '#include <emissivemap_fragment>', /* glsl */ `
        {
          vec3 cell = floor(vWPos * 25.0);
          float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float on = step(0.3 + 0.4 * fract(h * 13.0), fract(uLedTime * (0.4 + h * 4.0) + h * 7.0));
          vec3 tint = h < 0.68 ? vec3(0.25, 1.0, 0.35) : (h < 0.9 ? vec3(1.0, 0.55, 0.12) : vec3(0.3, 0.55, 1.0));
          totalEmissiveRadiance *= tint * mix(0.06, 1.0, on);
        }`);
    });
    return {
      carpet: mats.pbr(carpetSet, IN),
      vinyl: mats.pbr(vinylSet, IN),
      wall: mats.pbr(plasterSet, { color: 0xd9e2df, ...IN }),
      // 吊顶：灯都朝下打，天花板靠地面和桌面反上来的光照亮，这一项由室内补光的房间照度给（朝下的面三分之一）。
      // 矿棉板按 0.6 m 一块铺（tile 0.6，UV 对齐龙骨），大堂的平吊顶是乳胶漆
      ceiling: mats.pbr(tileSet, { color: 0xf4f2ec, ...IN }),
      ceilingPlain: mats.pbr(plasterSet, { color: 0xeeebe4, ...IN }),
      // 吊顶龙骨：白色烤漆
      tbar: plain(0xe6e6e2, 0.4, 0),
      accent: mats.pbr(plasterSet, { color: 0x3b4855, ...IN }),
      // 纸箱和仓库共用一个材质实例（贴图按名字缓存，不多建）；公告栏的软木板还是染色的乳胶漆
      cardboard: whMats(mats).carton,
      cork: mats.pbr(plasterSet, { color: 0xa98457, ...IN }),
      // 桌面、台面、门扇的饰面板（和 woodIn 同一套着色器，只换贴图）；前台台面深一档
      laminate: mats.pbr(laminateSet, IN),
      laminateDark: mats.pbr(laminateSet, { color: 0x8a7766, ...IN }),
      fabric: mats.pbr(mats.tex.fabric, { color: 0x56626e, normal: 1.2, ...IN }),
      furn: plain(0x5c6166, 0.48, 0.25, mats.tex.wearNormal),
      // 室内的黑塑料（键盘、显示器、椅子脚、机柜）：共享的 plasticBlack 带雨水补丁，朝上的面在屋里会反出一层金色亮斑
      plastic: plain(0x111214, 0.5, 0, mats.tex.polymer.normalMap),
      // 消防红：参数和仓库的消防红完全一样，命中同一个缓存实例，不算新材质
      red: mats.paint(0xa3170f, { wear: 0.25, dirt: 0.35, rough: 0.4, ...IN }),
      // 室外：浅灰纤维水泥板 + 深灰腰线（腰线和仓库的收边同一个材质）
      facade: mats.paint(0x9a9c97, { wear: 0.12, dirt: 0.7, rough: 0.6 }),
      band: mats.paint(0x2b3238, { wear: 0.35, dirt: 0.6 }),
      yellow: mats.paint(0xc79a12, { wear: 0.6, dirt: 0.6 }),
      screen: mats.emissive(0x9cc2ff, 2.6),
      panel: mats.emissive(0xf1f4ff, 4.5),
      exit: mats.emissive(0x36ff7c, 5),
      warm: mats.emissive(0xffe2b8, 30),
      // 会闪的那几块灯板：单独一个实例，update 里改亮度
      panelBad: mats.one('office|panelBad', () => new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xf1f4ff, emissiveIntensity: 4.5, roughness: 0.4 })),
      led,
    };
  });
}
