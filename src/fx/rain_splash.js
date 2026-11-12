import * as THREE from 'three';
import { VM_DEPTH } from '../engine/glsl.js';
import { depthGLSL, lightGLSL, cloudGLSL } from './common.js';

const CAP = 3200;
const BASE_COUNT = 2400; // intensity = 1 时的水花数（同一时刻亮着的约四分之一）
const LIFE = 0.17;       // 一朵水花从溅起到散掉的秒数
const VM = VM_DEPTH.toFixed(3);

const vert = /* glsl */ `
attribute vec4 aSeed;    // xy：盒内落点，z：多久溅一次，w：相位和杂项随机数
uniform float uPhase;
uniform float uPeriod;
uniform vec2 uCam;       // 镜头的 xz
uniform vec2 uFwd;       // 镜头朝向的水平分量（不归一化）
uniform float uBox;      // 远处那一盒的边长；一半的水花挤在近处的小盒里
uniform vec3 uGain;      // 环境底亮度、灯光散射系数、前向散射强度
uniform sampler2D tRoof;
uniform vec4 uRoofRect;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
varying vec3 vColor;
varying float vViewZ;
varying vec3 vPar;       // 生命进度、俯视程度、随机数
${lightGLSL}
${cloudGLSL}
// Hash without Sine，Dave Hoskins，MIT，见 THIRD_PARTY_NOTICES.md
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
void main() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  // 每个周期里溅 n 次（整数），时间回卷时不跳；每次换一个落点
  float n = floor(70.0 + aSeed.z * 70.0);
  float ph = n * uPhase + aSeed.w;
  float t = fract(ph) * uPeriod / (n * ${LIFE.toFixed(3)});
  if (t >= 1.0) return;
  float box = uBox * mix(1.0, 0.42, step(0.4, fract(aSeed.w * 3.17)));
  vec2 center = uCam + uFwd * (box * 0.3);
  vec2 f = fract(aSeed.xy + hash22(vec2(mod(floor(ph), n), aSeed.w * 97.0)));
  // 落点钉在世界里，只在跟随镜头的盒子边界回卷
  vec2 local = mod(f * box - center + box * 0.5, box) - box * 0.5;
  vec2 xz = center + local;
  vec2 e = 1.0 - abs(local) / (box * 0.5);
  float vis = smoothstep(0.0, 0.18, e.x) * smoothstep(0.0, 0.18, e.y);
  // 落在最上面那层顶面上：屋顶、箱顶、雨棚顶各在各的高度，屋里和棚下没有
  float land = texture2D(tRoof, (xz - uRoofRect.xy) * uRoofRect.zw).g;
  if (land < -100.0) return;
  vec3 base = vec3(xz.x, land, xz.y);
  vec4 bv = viewMatrix * vec4(base, 1.0);
  vec4 bc = projectionMatrix * bv;
  if (bc.w <= 0.0) return;
  // 落点得有东西接着：和主场景深度对不上（碰撞体比模型大、被挡住）就不画，免得水花悬在半空
  float d = texture2D(tDepth, bc.xy / bc.w * 0.5 + 0.5).r;
  d = d < ${VM} ? d / ${VM} : d;
  float dz = -bv.z;
  if (abs(uNear * uFar / (uFar - d * (uFar - uNear)) - dz) > 0.03 + 0.012 * dz) return;

  vec3 toCam = normalize(cameraPosition - base);
  float s = clamp(toCam.y, 0.0, 1.0);
  float size = mix(0.028, 0.05, fract(aSeed.w * 13.7));
  // 远处至少撑到一个多像素，亮度按比例压低
  float w = max(size, 1.3 * 2.0 * dz / (projectionMatrix[1][1] * uResolution.y));
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  // 平视时四边形立在落点上，俯视时以落点为中心摊开
  vec4 mv = viewMatrix * vec4(base + right * (position.x * w) + up * ((position.y + 1.0 - s) * w), 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
  // 白天环境光亮起来后压低环境光这一项，水花不会在地上闪成一片白点（同 rain.js）
  float day = smoothstep(0.08, 0.4, dot(uAmbient, vec3(0.2126, 0.7152, 0.0722)));
  vec3 light = uAmbient * (uGain.x * mix(1.0, 0.4, day)) + fxLight(base + vec3(0.0, 0.03, 0.0), toCam, uGain.z) * uGain.y;
  vColor = light * (vis * (size / w) * (0.6 + 0.8 * fract(aSeed.w * 7.31)) * cloudT(mv.xyz));
  vUv = position.xy;
  vPar = vec3(t, s, aSeed.w);
}`;

const frag = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vViewZ;
varying vec3 vPar;
${depthGLSL}
void main() {
  float t = vPar.x, s = vPar.y;
  // 水花贴着表面，深度比较留一点余量；贴脸的淡掉
  float soft = clamp((sceneViewZ() - vViewZ + 0.04) / 0.03, 0.0, 1.0) * smoothstep(0.3, 0.7, vViewZ);
  vec2 p = vec2(vUv.x, vUv.y + 1.0 - s); // 以落点为原点
  float r = 0.18 + 0.72 * (1.0 - (1.0 - t) * (1.0 - t));
  // 水面上扩开的一圈：俯视是圆，平视压成一条线
  float ring = 1.0 - smoothstep(0.0, 0.16, abs(length(vec2(p.x, p.y / max(s, 0.1))) - r));
  // 溅起的水冠：一圈薄水膜，亮的是两侧和参差的上沿，先窜高再落下
  float xr = clamp(p.x / r, -1.0, 1.0);
  float yb = r * s * sqrt(1.0 - xr * xr);
  float hc = (0.35 + 0.9 * sin(3.1416 * min(t * 1.5, 1.0))) * sqrt(1.0 - s * s) * (0.55 + 0.45 * sin(p.x * 19.0 + vPar.z * 40.0));
  float top = yb + hc;
  float film = step(abs(p.x), r) * smoothstep(-yb - 0.08, -yb, p.y) * (1.0 - smoothstep(top - 0.1, top, p.y));
  float wall = film * (0.1 + 0.55 * xr * xr * xr * xr + 0.8 * smoothstep(top - 0.45, top - 0.1, p.y));
  float a = max(ring * 0.5, wall) * smoothstep(0.0, 0.12, t) * pow(1.0 - t, 1.3);
  gl_FragColor = vec4(vColor * (a * soft), 0.0);
}`;

// 雨点打在地面和屋顶上的水花。位置、寿命、落点高度全在顶点着色器里算，CPU 每帧只更新几个 uniform。
export class RainSplash {
  constructor({ rig, roof, renderOrder = 0 }) {
    const seeds = new Float32Array(CAP * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = 0;
    this.geo = geo;
    this.uniforms = {
      ...rig.uniforms,
      uPhase: { value: 0 },
      uPeriod: { value: 64 },
      uCam: { value: new THREE.Vector2() },
      uFwd: { value: new THREE.Vector2(0, -1) },
      uBox: { value: 26 },
      uGain: { value: new THREE.Vector3(1.6, 0.03, 10) },
      tRoof: { value: roof.texture },
      uRoofRect: { value: roof.rect },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  // phase：0..1，和雨丝共用一个周期；intensity 为 0 时一朵也不画
  update(phase, period, camera, intensity) {
    this.geo.instanceCount = intensity > 0 ? Math.min(CAP, Math.floor(BASE_COUNT * intensity)) : 0;
    if (intensity <= 0 || !camera) return;
    const u = this.uniforms, e = camera.matrixWorld.elements;
    u.uPhase.value = phase;
    u.uPeriod.value = period;
    u.uCam.value.set(e[12], e[14]);
    // 朝向不归一化：越往下看水平分量越小，盒子自然收回到脚下
    u.uFwd.value.set(-e[8], -e[10]);
  }
}
