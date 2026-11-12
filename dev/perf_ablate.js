// 着色开销拆解，只用来定方向：换一份改过的灯光着色器块，逼受光材质重新编译，再量主通道的 GPU 时间。
//   const a = await import('/dev/perf_ablate.js?v=' + Date.now());
//   a.set({ spots: 5 })        聚光灯循环只留前 5 盏（带阴影的排在最前面）；0 是一盏不算
//   a.set({ noShadow: true })  灯照算，不采阴影图
//   a.set()                    还原
// set 之后第一次渲染要重新编译几十个着色器（十几秒），用 setTimeout 包起来等。画面会跟着变，量完刷新页面。
import * as THREE from 'three';
import { LIGHT_LOOP } from '../src/gfx/light_loop.js';

const d = window.__dbg;
const base = LIGHT_LOOP.patched || THREE.ShaderChunk.lights_fragment_begin;
const SPOT_FOR = 'for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {';
const LOOP_END = '#pragma unroll_loop_end';

// three 编译时会把灯光循环展开，所以不能在循环里 break，用预处理条件把循环体整个包住
function capSpots(src) {
  const a = src.indexOf(SPOT_FOR);
  const b = src.indexOf(LOOP_END, a);
  const close = src.lastIndexOf('}', b);
  if (a < 0 || b < 0 || close < a) throw new Error('聚光灯循环的锚点没找到');
  const head = a + SPOT_FOR.length;
  return `${src.slice(0, head)}\n#if ( UNROLLED_LOOP_INDEX < SPOT_CAP )\n${src.slice(head, close)}\n#endif\n${src.slice(close)}`;
}

export function set(o = {}) {
  let src = base;
  if (o.spots != null) src = capSpots(src);
  if (o.noShadow) src = src.replaceAll('defined( USE_SHADOWMAP ) && (', 'defined( USE_SHADOWMAP ) && !defined( ABL_NO_SHADOW ) && (');
  THREE.ShaderChunk.lights_fragment_begin = src;
  const seen = new Set();
  for (const root of [d.scene, d.fxScene]) root.traverse((x) => { for (const m of [].concat(x.material || [])) seen.add(m); });
  let n = 0;
  for (const m of seen) {
    if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial)) continue;
    const def = { ...(m.defines || {}) };
    delete def.SPOT_CAP;
    delete def.ABL_NO_SHADOW;
    if (o.spots != null) def.SPOT_CAP = o.spots;
    if (o.noShadow) def.ABL_NO_SHADOW = 1;
    m.defines = def;
    m.needsUpdate = true;
    n++;
  }
  return n;
}
