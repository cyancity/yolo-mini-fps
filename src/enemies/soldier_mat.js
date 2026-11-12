import * as THREE from 'three';
import { patchMaterial, inject, withWet } from '../gfx/materials.js';

// 士兵只有两种材质：soft（织物）和 hard（头盔、枪、扣具、鞋底、镜片、信号灯）。
// 颜色来自顶点色，每个顶点的 aSurf = [粗糙度, 金属度, 自发光倍数, 第四通道]：
// soft 的第四通道是迷彩斑块强度，hard 的第四通道是法线贴图强度。所有士兵、所有变体共用这两个实例。

// 轮廓光强度：夜里暗背景前认得出人。活人材质直接用这个 uniform，时段切换时由 timeofday.js 改写，启动是夜晚。
// 尸体换成另一套轮廓光恒为 0 的材质（同一个着色器程序，不重编译），见 soldier_mesh.js 的 setDead
export const soldierRim = { value: 4 };
// 自发光总开关：识别色的底光和各处的小灯都乘它。活人是 1，尸体那套材质是 0（倒下就灭）
export const soldierGlow = { value: 1 };

// 掠射角才亮（菲涅尔六次方，四次方时暗处近看大半个身子都泛蓝），朝上的边比朝下的亮：像是天光从头顶擦过轮廓。用没叠法线贴图的法线，
// 不然织物的起伏会让正面也冒出一片细碎的亮点。
// 颜色就是半球补光的天空色（夜里是冷蓝），本身已经乘过补光强度；不乘反照率，迷彩再黑边也亮得出来。
// 正对镜头的面几乎为零，所以全黑的地方也只有一圈细边，不会整个人发亮
const RIM_GLSL = /* glsl */ `
  #if NUM_HEMI_LIGHTS > 0
    vec3 rimSky = hemisphereLights[ 0 ].skyColor;
  #else
    vec3 rimSky = vec3( 0.05, 0.08, 0.16 );
  #endif
  float rimF = 1.0 - saturate( dot( nonPerturbedNormal, geometryViewDir ) );
  rimF *= rimF * rimF;
  rimF *= rimF;
  float rimUp = 0.3 + 0.7 * saturate( dot( nonPerturbedNormal, ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) * 0.5 + 0.5 );
  totalEmissiveRadiance += rimSky * ( uRim * rimF * rimUp );`;

function surfPatch(mat, key, u, frag) {
  return patchMaterial(mat, key, (shader) => {
    shader.uniforms.uRim = u.rim;
    shader.uniforms.uGlow = u.glow;
    shader.vertexShader = inject(`attribute vec4 aSurf;\nvarying vec4 vSurf;\n${shader.vertexShader}`,
      '#include <color_vertex>', 'vSurf = aSurf;');
    let f = `uniform float uRim;\nuniform float uGlow;\nvarying vec4 vSurf;\n${shader.fragmentShader}`;
    f = inject(f, '#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;', 'replace');
    f = inject(f, '#include <emissivemap_fragment>', 'totalEmissiveRadiance += vColor.rgb * ( vSurf.z * uGlow );');
    f = inject(f, '#include <lights_fragment_end>', RIM_GLSL);
    shader.fragmentShader = frag(f, shader);
  });
}

// 返回 { soft, hard, dead: { soft, hard } }：dead 是给尸体的，除了没有轮廓光和自发光以外完全一样
export function createSoldierMaterials(mats) {
  return {
    ...makePair(mats, { rim: soldierRim, glow: soldierGlow }),
    dead: makePair(mats, { rim: { value: 0 }, glow: { value: 0 } }),
  };
}

function makePair(mats, u) {
  const t = mats.tex;
  // 织物：平纹贴图给起伏和明暗，迷彩贴图只取明暗和一点色相，叠在顶点色上成同色系迷彩
  const soft = new THREE.MeshStandardMaterial({ map: t.fabric.map, normalMap: t.fabric.normalMap, vertexColors: true });
  soft.normalScale.set(0.7, 0.7);
  withWet(soft);
  surfPatch(soft, 'soldierSoft', u, (f, shader) => {
    shader.uniforms.uCamo = { value: t.camo.map };
    f = `uniform sampler2D uCamo;\n${f}`;
    f = inject(f, '#include <map_fragment>', /* glsl */ `
      vec4 fab = texture2D(map, vMapUv);
      vec3 cm = texture2D(uCamo, vMapUv * 0.3).rgb;
      float cl = dot(cm, vec3(0.3333));
      vec3 tone = clamp(mix(vec3(cl), cm, 0.25) / 0.19, 0.55, 1.45);
      diffuseColor.rgb *= fab.rgb * 1.47 * mix(vec3(1.0), tone, vSurf.w);`, 'replace');
    return inject(f, '#include <roughnessmap_fragment>',
      'float roughnessFactor = clamp(vSurf.x + (0.68 - dot(fab.rgb, vec3(0.3333))) * 0.25, 0.04, 1.0);', 'replace');
  });

  // 硬表面：点状防滑纹法线，强度按顶点给（金属件几乎没有，头盔涂层、握把明显）
  const hard = new THREE.MeshStandardMaterial({ normalMap: t.polymer.normalMap, vertexColors: true });
  withWet(hard);
  surfPatch(hard, 'soldierHard', u, (f) => {
    f = inject(f, '#include <roughnessmap_fragment>', 'float roughnessFactor = vSurf.x;', 'replace');
    const chunk = THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * vSurf.w;');
    return f.replace('#include <normal_fragment_maps>', chunk);
  });
  return { soft, hard };
}
