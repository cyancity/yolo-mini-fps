import * as THREE from 'three';

// 灯光循环早退：three 的 lights_fragment_begin 对每盏灯都无条件调用 RE_Direct，照不到这个像素的灯
// （超出距离、在聚光锥外、亮度为 0）也要算一遍 BRDF。场景里有三十来盏灯，一个像素真正照得到的只有几盏，
// 包一层 if 以后片元着色省一成多；照不到时灯的颜色本来就是 0，所以画面不变。
// 模块加载时改一次全局的着色器块，之后编译的材质（包括 withIndoor 内联的那一份）都带上它。
// original 留着给 dev/perf_probe.js 做前后对比
const RE_DIRECT = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const GUARDED = `if ( directLight.visible ) { ${RE_DIRECT} }`;

// 阴影采样早退：同样的道理用在阴影图上。three 写的是三目运算（照不到时乘 1），getShadow 里用的又是要算梯度的 texture()；
// Windows 上 ANGLE 把着色器转成 HLSL，带梯度的采样不能放进动态分支，编译器会把分支摊平：
// 每个像素对每张阴影图都采满 5 次，照不到也采。换成指定层级的 textureLod（阴影图没有 mip，结果一样），
// 再把三目改成 if，照不到的灯就真的不采了。
const SHADOW_CALL = /directLight\.color \*= \( directLight\.visible && receiveShadow \) \? (getShadow\( [^;]+? \)) : 1\.0;/g;
const SHADOW_TAP = /texture\( shadowMap, (vec3\( shadowCoord\.xy \+ vogelDiskSample\( \d, 5, phi \) \* radius, shadowCoord\.z \)) \)/g;

const begin = THREE.ShaderChunk.lights_fragment_begin, pars = THREE.ShaderChunk.shadowmap_pars_fragment;
const already = begin.includes(GUARDED);

// begin、pars：three 原来的两个着色器块；patched 是改过的，没改成的那一项是 null
export const LIGHT_LOOP = { original: begin, patched: null, shadowOriginal: pars, shadowPatched: null };

if (!already) {
  let b = begin;
  if (b.includes(RE_DIRECT)) b = b.replaceAll(RE_DIRECT, GUARDED);
  else console.warn('[shader] 灯光循环早退找不到锚点，没有生效');
  const taps = pars.match(SHADOW_TAP)?.length ?? 0, calls = b.match(SHADOW_CALL)?.length ?? 0;
  if (taps === 5 && calls > 0) {
    LIGHT_LOOP.shadowPatched = pars.replace(SHADOW_TAP, 'textureLod( shadowMap, $1, 0.0 )');
    b = b.replace(SHADOW_CALL, 'if ( directLight.visible && receiveShadow ) directLight.color *= $1;');
    THREE.ShaderChunk.shadowmap_pars_fragment = LIGHT_LOOP.shadowPatched;
  } else {
    console.warn('[shader] 阴影采样早退找不到锚点，没有生效', taps, calls);
  }
  if (b !== begin) {
    LIGHT_LOOP.patched = b;
    THREE.ShaderChunk.lights_fragment_begin = b;
  }
}
