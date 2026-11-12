// 开放式红点：矮平的镜座，前端一个顶上敞开的 U 形镜框夹着一片镀膜镜片，两侧薄薄的护翼从柱顶斜到镜座后端，
// 中间降下去的后平台上是朝前打光的发光管。没有顶梁、遮光檐和镜筒，镜片上沿也不描边：开镜时顶上什么线都没有
import * as THREE from 'three';
import { box, rbox, cylBetween, xf } from '../gfx/geo.js';
import { patchMaterial } from '../gfx/materials.js';
import { ex, SIDE, arc, screw } from './rifle_kit.js';
import { markSide } from './rifle_marks.js';
import { OPTIC } from './rifle_optics.js';

const Z = OPTIC.z, Y0 = OPTIC.deck, SILL = Y0 + OPTIC.base;
const HW = 0.015; // 镜座半宽
const T_LENS = 0.0026, R_LENS = 0.06; // 镜片厚度；反光用的球面半径（比真实的小，渐变才看得出来）
// 侧视轮廓 [z, y]：z 相对镜片后表面（朝射手为正），y 相对镜座底面
const at = (pts) => pts.map(([z, y]) => [Z + z, Y0 + y]);

// 视线和镜面法线的夹角：g = 0 正对，越大越斜
const GRAZE = /* glsl */ `float g = 1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);`;
// 朝射手的一面分两遍画。第一遍是滤色：正对着看只压掉一点红（镀膜把红光反回去了），镜片里的画面比外面略冷，
// 看得出隔着一片玻璃；视线越斜压得越多
const FILTER = /* glsl */ `{
  ${GRAZE}
  gl_FragColor = vec4(mix(vec3(0.93, 0.97, 0.985), vec3(0.8, 0.73, 0.6), smoothstep(0.03, 0.5, g)), 1.0);
}`;
// 第二遍把反光加上去：正对时只有淡淡一层暖色，斜着看是蓝紫色的膜光
const SHEEN = /* glsl */ `{
  ${GRAZE}
  vec3 tint = mix(vec3(1.0, 0.84, 0.66), vec3(0.4, 0.34, 1.0), smoothstep(0.0, 0.28, g));
  gl_FragColor = vec4(totalSpecular * tint * mix(0.035, 0.7, smoothstep(0.01, 0.5, g)), 1.0);
}`;
// 朝枪口的一面是镜面膜：正对是橙红，越斜越偏紫、偏蓝。膜色写进金属的底色，高光和环境反射都跟着染色
const FILM = /* glsl */ `{
  ${GRAZE}
  vec3 film = mix(vec3(1.0, 0.27, 0.06), vec3(0.86, 0.1, 0.42), smoothstep(0.02, 0.2, g));
  diffuseColor.rgb = mix(film, vec3(0.26, 0.2, 1.0), smoothstep(0.15, 0.48, g));
}`;
const MIRROR = /* glsl */ `{
  ${GRAZE}
  float a = mix(0.82, 0.97, smoothstep(0.0, 0.5, g));
  gl_FragColor = vec4((totalSpecular + diffuseColor.rgb * (irradiance + iblIrradiance) * (0.3 * RECIPROCAL_PI)) * a, a);
}`;

// 镜片的三种材质：T 滤色、R 反光（都朝射手），F 朝枪口的镜面膜。底子是带第一人称投影补丁的空白标准材质
export function lensMaterials(gear) {
  const make = (key, props, out, before = '') => {
    const m = Object.assign(gear.glow(0x000000, 0), { metalness: 1, roughness: 0.1, ...props });
    m.color.set(0xffffff);
    if (!out) return m;
    return patchMaterial(m, key, (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <lights_physical_fragment>', `${before}\n#include <lights_physical_fragment>`)
        .replace('#include <opaque_fragment>', out)
        .replace('#include <premultiplied_alpha_fragment>', '');
    });
  };
  const pane = { transparent: true, depthWrite: false, blending: THREE.CustomBlending };
  return {
    glassT: make('lensFilter', { ...pane, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor }, FILTER),
    glassR: make('lensSheen', { ...pane, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }, SHEEN),
    glassF: make('lensMirror', { ...pane, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }, MIRROR, FILM),
  };
}

// 镜片轮廓 [x, y]：下边压进下槛是直的，上边两个角是圆的；d 是往里收多少，bot 是下边的高度
function lensOutline(d, bot) {
  const w = OPTIC.hw - d, top = SILL + OPTIC.glass - d, r = 0.004 - d;
  return [[w, bot], ...arc(w - r, top - r, r, 0, 90, 6), ...arc(-w + r, top - r, r, 90, 180, 6), [-w, bot]];
}

// 一片单面镜片：轮廓在 z 处，朝 face（+1 朝射手，-1 朝枪口）。法线按球面弯一点：朝射手的一面是凹的，朝枪口的一面是凸的
function pane(outline, z, face) {
  const cy = SILL + OPTIC.glass / 2, pos = [], nor = [];
  for (const t of THREE.ShapeUtils.triangulateShape(outline.map(([x, y]) => new THREE.Vector2(x, y)), [])) {
    const a = outline[t[0]], b = outline[t[1]], c = outline[t[2]];
    const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
    for (const p of ccw === face > 0 ? [a, b, c] : [a, c, b]) {
      const nx = (-face * p[0]) / R_LENS, ny = (-face * (p[1] - cy)) / R_LENS, l = Math.hypot(nx, ny, 1);
      pos.push(p[0], p[1], z);
      nor.push(nx / l, ny / l, face / l);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

// 镜片露在立柱以上的那一段（两侧上段、圆角、上沿）的断面：沿轮廓拉一条带子，法线朝外，只画正面。
// 从上面和侧面看得出镜片有厚度；开镜时眼睛在镜片轮廓里面，看到的是它的背面，不画，所以镜片上沿没有任何线
function rim(path, z0, z1) {
  const n = path.length, seg = [], pos = [], nor = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = path[i + 1][0] - path[i][0], dy = path[i + 1][1] - path[i][1], l = Math.hypot(dx, dy) || 1;
    seg.push([dy / l, -dx / l]); // 轮廓是逆时针走的（从射手这边看），线段右手边是外面
  }
  const at = (i) => {
    const a = seg[Math.max(0, i - 1)], b = seg[Math.min(n - 2, i)], l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
    return [(a[0] + b[0]) / l, (a[1] + b[1]) / l];
  };
  const put = (i, z) => { const p = path[i], q = at(i); pos.push(p[0], p[1], z); nor.push(q[0], q[1], 0); };
  for (let i = 0; i < n - 1; i++) {
    put(i, z1); put(i, z0); put(i + 1, z0);
    put(i, z1); put(i + 1, z0); put(i + 1, z1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

function lens(k) {
  // 镜面铺满整个轮廓：两侧插在立柱里，下边埋在下槛里，顶上没有框也没有描边，镜片到上沿就结束
  const face = lensOutline(0, SILL - 0.001);
  k.glassT(pane(face, Z - 0.0004, 1));
  k.glassR(pane(face, Z - 0.0004, 1));
  k.glassF(pane(face, Z - T_LENS + 0.0004, -1));
  // 断面从柱顶往下 2 毫米处起（藏在立柱里），绕过上沿到另一侧
  const top = lensOutline(0, SILL + OPTIC.post - 0.002);
  k.glassT(rim(top, Z - T_LENS, Z));
  k.glassR(rim(top, Z - T_LENS, Z));
}

export function buildSight(k) {
  // 镜座中段：前段的顶面就是镜框的下槛，往后一道斜坡降到后平台
  const base = at([[-0.0055, 0], [-0.0055, 0.0082], [-0.0047, 0.009], [0.0042, 0.009], [0.0072, 0.0055], [0.0388, 0.0055],
    [0.0405, 0.0038], [0.0405, 0.0015], [0.039, 0]]);
  k.metal(ex(base, 2 * OPTIC.postX + 0.0004, 0.0005), SIDE());
  // 两侧各一片：立柱连着护翼，和镜座侧面是一个平面。柱顶比镜片矮，护翼从柱顶斜下去，过了镜座中段就贴着后平台走，
  // 开镜时从后面看到的护翼内侧只有立柱旁边一小块三角
  const wing = at([[-0.0055, 0], [-0.0055, OPTIC.base + OPTIC.post - 0.0011], [-0.0044, OPTIC.base + OPTIC.post],
    [0.0022, OPTIC.base + OPTIC.post], [0.0034, OPTIC.base + OPTIC.post - 0.0008], [0.0235, 0.0072], [0.0386, 0.0061], [0.0405, 0.0042], [0.0405, 0.0015], [0.039, 0]]);
  for (const s of [-1, 1]) k.metal(ex(wing, HW - OPTIC.postX, 0.0005), SIDE(s * (HW + OPTIC.postX) / 2));
  lens(k);

  // 发光管：后平台上一个矮座，前脸的窗口朝着镜片。座顶低于眼睛到下槛的视线，开镜时不挡镜片
  k.metal(ex(at([[0.0268, 0.0053], [0.0274, 0.0085], [0.0306, 0.0085], [0.0366, 0.006], [0.0366, 0.0053]]), 0.009, 0.0005), SIDE());
  k.black(box(0.005, 0.0017, 0.0005), xf(0, Y0 + 0.0071, Z + 0.027));
  k.ledR(box(0.0013, 0.0007, 0.0003), xf(0, Y0 + 0.0071, Z + 0.0267));
  // 后平台上两颗把镜座锁在增高架上的螺丝
  for (const z of [0.0125, 0.0215]) screw(k, 0, Y0 + 0.0049, Z + z, 0, Y0 + 0.006, Z + z, 0.0023);

  // 左侧两个亮度键（加、减号是凸起的筋），底下一块垫板
  const by = Y0 + 0.003;
  k.metal(rbox(0.0008, 0.0056, 0.0215, 0.0003, 1), xf(-HW - 0.0002, by, Z + 0.0185));
  [0.0135, 0.0235].forEach((z, i) => {
    k.rubber(rbox(0.0016, 0.0042, 0.0075, 0.0007, 1), xf(-HW - 0.0009, by, Z + z));
    k.steel(box(0.0003, 0.0006, 0.003), xf(-HW - 0.0018, by, Z + z));
    if (i === 0) k.steel(box(0.0003, 0.003, 0.0006), xf(-HW - 0.0018, by, Z + z));
  });
  // 右侧靠后的电池仓盖（带硬币槽）和前面的风偏螺丝
  const cy = Y0 + 0.0048, cz = Z + 0.0275;
  k.metal(cylBetween(HW - 0.0004, cy, cz, HW + 0.0012, cy, cz, 0.0042, 24));
  k.black(box(0.0004, 0.001, 0.0062), xf(HW + 0.0013, cy, cz, 0.5, 0, 0));
  screw(k, HW - 0.0002, Y0 + 0.0045, Z + 0.006, HW + 0.0007, Y0 + 0.0045, Z + 0.006, 0.0017);
  markSide(k, 'optic', 0.0024, -HW, Y0 + 0.0105, Z + 0.0115);
  markSide(k, 'bat', 0.0018, HW, cy, Z + 0.0165);
}
