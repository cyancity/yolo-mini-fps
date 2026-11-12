// 绿宝石涂装：整把刀当成一块切磨过的祖母绿来画，不透射、不加贴图，全在标准材质的着色器上打补丁。
//   表面：一层光滑的清漆（clearcoat）出干净的白色高光和掠射角的菲涅尔反光；
//   内部：按折射后的视线往里走一段再取样，所以里面的刻面会随视角错动（视差）。浅层是三角刻面，
//         每个刻面朝向不同，各自映着灯和环境，转刀时闪点一片片亮过去；深层是更碎的包裹体，只映环境；
//   颜色：按光在宝石里走的路程做吸收，厚的地方深绿，刃口这样薄的地方发亮发青；
//   自发光：里面一点微光加一圈亮刃，亮度够泛光拾到，但不盖住形状。
// 模型坐标：刀身平面是 YZ，X 是厚度方向，所以 |x| 就是这一点的半厚，法线的 x 分量大就是板面、小就是侧壁。
import * as THREE from 'three';
import { patchMaterial, inject } from '../gfx/materials.js';

// gear 里的材质如果打了第一人称补丁（独立投影 + 压深度），给新材质照样打一份；预览页的 gear 没打，这里就什么都不做
export function likeGear(gear, mat) {
  const vm = (gear.blade.userData.patches || []).find((p) => p.key === 'vm');
  if (vm) {
    patchMaterial(mat, vm.key, vm.fn);
    mat.userData.viewModel = true;
  } else if (gear.blade.userData.viewModel) {
    console.warn('[knife] gear 材质的第一人称补丁没找到，绿宝石涂装会按世界投影画');
  }
  return mat;
}

const VERT_HEAD = /* glsl */ `
varying vec3 vGemPos;
varying vec3 vGemNor;
varying vec3 vGemEye;
`;

// 镜头在模型空间的位置：模型视图矩阵是刚体变换，逆就是转置
const VERT_BODY = /* glsl */ `
  vGemPos = position;
  vGemNor = normal;
  vec3 gemT = modelViewMatrix[3].xyz;
  vGemEye = -vec3(dot(modelViewMatrix[0].xyz, gemT), dot(modelViewMatrix[1].xyz, gemT), dot(modelViewMatrix[2].xyz, gemT)) - position;`;

const FRAG_HEAD = /* glsl */ `
uniform float uGemTime;
uniform float uGemFlash;
uniform mat3 normalMatrix;
varying vec3 vGemPos;
varying vec3 vGemNor;
varying vec3 vGemEye;

// Hash without Sine，Dave Hoskins，MIT，见 THIRD_PARTY_NOTICES.md（下面两个函数）
float gemHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 gemHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// 三角格（单形网格）：xy = 这一格的编号，z = 到最近一条格边的距离
vec3 gemTri(vec2 p) {
  vec2 s = p + (p.x + p.y) * 0.366025404;
  vec2 i = floor(s), f = fract(s);
  float lo = step(f.y, f.x);
  float d = min(abs(f.x - f.y), mix(min(f.x, 1.0 - f.y), min(1.0 - f.x, f.y), lo));
  return vec3(i * 2.0 + vec2(lo, 0.0), d);
}
// 胞格（边是直的多边形）：返回到最近胞心的距离，id = 胞的编号，edge = 离胞边多远（近似）
float gemCell(vec2 p, out vec2 id, out float edge) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  id = i;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 r = g + gemHash2(i + g) - f;
      float dd = dot(r, r);
      if (dd < d1) { d2 = d1; d1 = dd; id = i + g; } else if (dd < d2) { d2 = dd; }
    }
  }
  d1 = sqrt(d1);
  edge = (sqrt(d2) - d1) * 0.5;
  return d1;
}
`;

// 接在 <normal_fragment_maps> 后面：这时 normal（视图空间）、diffuseColor、roughnessFactor、metalnessFactor 都已经有了。
// 这里把 normal 换成内部刻面的朝向（清漆层仍用原来的光滑法线），底色换成吸收后的颜色，其余的光加进 totalEmissiveRadiance
const FRAG_BODY = /* glsl */ `
{
  vec3 gV = normalize(vGemEye), gN = normalize(vGemNor), gP = vGemPos * 1000.0;
  float gFlat = abs(gN.x), gHalf = abs(gP.x);
  // 折进宝石里的视线；沿它走到垂直深度 d 的地方取样
  vec3 gR = refract(-gV, gN, 0.637);
  float gC = max(-dot(gR, gN), 0.4);
  // 这一点底下宝石有多厚（毫米）：板面上是两倍半厚，侧壁上取个固定值
  float gDepth = mix(7.0, 2.0 * gHalf, gFlat);
  float gLen = gDepth / gC;
  // 刻面的虚像比实际厚度深（宝石里光来回反射，看进去比它本身厚）；薄的地方收回到表面
  float gDeepen = clamp(gDepth / 3.8, 0.15, 1.5);
  vec3 gT1 = normalize(cross(gN, gFlat > 0.6 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 gT2 = cross(gN, gT1);

  // 浅层：大块的多边形刻面，各有各的朝向；一部分是暗的“窗口”，从那里看得到深层
  vec2 idA;
  float seamA;
  gemCell((gP + gR * (2.4 * gDeepen / gC)).yz * vec2(0.125, 0.09) + 4.2, idA, seamA);
  vec2 hA = gemHash2(idA + 3.1) - 0.5;
  float kA = gemHash(idA + 1.7);
  float wA = smoothstep(0.1, 0.62, kA);
  float seam = 1.0 - smoothstep(0.0, 0.035, seamA);
  normal = normalize(normalMatrix * normalize(gN + (gT1 * hA.x + gT2 * hA.y) * 0.72));

  // 深层：细碎的三角刻面，只映环境
  vec3 fB = gemTri((gP + gR * (7.5 * gDeepen / gC)).yz * vec2(0.3, 0.21) + 9.3);
  vec2 hB = gemHash2(fB.xy) - 0.5;
  float kB = gemHash(fB.xy + 7.31);
  vec3 nB = normalize(normalMatrix * normalize(gN + (gT1 * hB.x + gT2 * hB.y) * 1.4));

  // 吸收：红光和紫光走不远，路程越长越绿越深
  const vec3 gAbs = vec3(0.72, 0.075, 0.3);
  vec3 tintA = exp(-gAbs * (5.0 + gLen * 0.9));
  vec3 tintB = exp(-gAbs * (9.0 + gLen * 1.6));
  // 二色性：换个方向看，颜色在偏蓝的绿和偏黄的绿之间挪一点
  float pleo = 0.5 + 0.5 * dot(gV, normalize(vec3(0.3, 0.8, 0.52)));
  tintA *= mix(vec3(0.75, 1.0, 1.15), vec3(1.2, 1.0, 0.75), pleo);

  vec3 gNv = nonPerturbedNormal, gVv = normalize(vViewPosition);
  float gFres = pow(1.0 - saturate(dot(gNv, gVv)), 4.0);
  float thin = 1.0 - smoothstep(0.3, 1.7, gHalf);
  float flash = 1.0 + 2.2 * uGemFlash;
  // gFront = 这一面朝外能收到多少环境光，gAmb 再加上从背面透过来的
  #ifdef USE_ENVMAP
    vec3 gDeep = getIBLRadiance(gVv, nB, 0.12);
    vec3 gFront = getIBLIrradiance(gNv) * RECIPROCAL_PI;
    vec3 gAmb = gFront + getIBLIrradiance(-gNv) * RECIPROCAL_PI * (0.35 + 0.65 * thin * gFlat);
  #else
    vec3 gDeep = vec3(0.0), gFront = vec3(0.15), gAmb = vec3(0.2);
  #endif

  // 刻面当成带颜色的镜子：不照到灯的面是暗的，照到的那一片亮得很纯。
  // 环境越亮反射率压得越低：白天（和预览页的摄影棚光）整片天都是亮的，不压的话每个刻面都映着天，
  // 整把刀发白发浅，像绿色的镀铬；夜里几乎不受影响
  diffuseColor.rgb = tintA * mix(0.07, 1.0, wA) / (1.0 + 2.0 * gFront.g);
  metalnessFactor = 1.0;
  roughnessFactor = mix(0.22, 0.07, wA);

  // 深层刻面映出的环境 + 体内散射（跟着环境光走，白天不会发灰）；两项同样随环境亮度封顶
  vec3 gem = gDeep * tintB * (1.25 - 0.95 * wA) * (0.35 + 1.3 * kB) / (1.0 + 3.0 * gAmb.g)
    + gAmb * tintB * 0.25 / (1.0 + 0.5 * gAmb.g);
  // 微光：沿刀身慢慢起伏；深层少数几个刻面自己亮着，浅层刻面的棱线带一点光
  float along = -(gP.y + gP.z);
  float pulse = 0.8 + 0.2 * sin(uGemTime * 1.6 - along * 0.045);
  gem += vec3(0.004, 0.36, 0.1) * (0.035 + 0.4 * smoothstep(0.72, 1.0, kB) + 0.1 * seam) * pulse * flash;
  // 亮刃：刃口那一条薄的斜面，以及往里渐渐淡掉的透光
  float edge = (1.0 - smoothstep(0.1, 0.42, gHalf)) * smoothstep(0.5, 0.9, gFlat);
  gem += vec3(0.2, 1.0, 0.55) * (edge * 1.1 + thin * gFlat * 0.06) * flash;
  // 菲涅尔边缘：跟着环境光变亮，但有上限，白天不会把整圈边漂成浅色
  gem += vec3(0.03, 0.6, 0.22) * gFres * (0.22 + 2.0 * gAmb.g / (1.0 + 2.5 * gAmb.g)) * flash;
  // 闪点：两盏跟着镜头走的假想灯，哪个刻面正好把灯反进眼睛，哪个就整片亮起来。转刀、挥刀时闪点一片片换过去；
  // 手不动时灯自己慢慢晃，闪点跟着轻轻眨。有了它，走到没灯的角落里刀也还有宝石的火彩
  vec3 gL1 = normalize(vec3(-0.45 + 0.25 * sin(uGemTime * 0.7), 0.75, 0.5 + 0.2 * cos(uGemTime * 0.53)));
  vec3 gL2 = normalize(vec3(0.55 + 0.2 * cos(uGemTime * 0.61), 0.3 + 0.2 * sin(uGemTime * 0.47), 0.78));
  float gl1 = pow(saturate(dot(reflect(-gVv, normal), gL1)), 70.0) * wA;
  float gl2 = pow(saturate(dot(reflect(-gVv, nB), gL2)), 110.0) * (1.0 - 0.6 * wA);
  gem += (vec3(0.5, 1.0, 0.7) * gl1 * 1.6 + vec3(0.25, 1.0, 0.55) * gl2 * 1.2) * (0.6 + 3.0 * gAmb.g / (1.0 + 0.6 * gAmb.g)) * flash;
  // 流光：一道亮带顺着刀走，位置跟视角挂钩，转刀或转头时它就扫过去；落在刻面上碎成一串闪点
  float at = 82.0 + 130.0 * sin(uGemTime * 0.33 + dot(gV, vec3(2.9, 2.1, 1.7)));
  float band = exp(-pow((along + gP.x * 2.0 - at) / 6.5, 2.0));
  gem += vec3(0.45, 1.0, 0.7) * band * (0.08 + 0.55 * wA * kA + 0.5 * seam) * (0.5 + 1.6 * uGemFlash);
  totalEmissiveRadiance += gem;
}`;

// 返回 { material, uniforms }。uniforms.uGemTime 每帧累加，uGemFlash 是掏刀、出刀、转刀时的那一下亮（0..1，外面负责衰减）
export function makeEmerald(gear) {
  const uniforms = { uGemTime: { value: 0 }, uGemFlash: { value: 0 } };
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.15, metalness: 0.8, clearcoat: 0.75, clearcoatRoughness: 0.03,
  });
  likeGear(gear, material);
  patchMaterial(material, 'gem', (shader) => {
    shader.uniforms.uGemTime = uniforms.uGemTime;
    shader.uniforms.uGemFlash = uniforms.uGemFlash;
    shader.vertexShader = inject(VERT_HEAD + shader.vertexShader, '#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader = inject(FRAG_HEAD + shader.fragmentShader, '#include <normal_fragment_maps>', FRAG_BODY);
  });
  return { material, uniforms };
}
