import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// 程序化贴图：所有表面细节都在 GPU 上用可平铺噪声算出来，不加载任何外部图片。
// 配方是一段 GLSL，实现 `Surf surface(vec2 uv)`（PBR 三件套）或 `vec4 pixel(vec2 uv)`（单张）。
const noiseLib = /* glsl */ `
precision highp float;
uniform float uSeed;
float gSalt = 0.0;
// PCG 哈希，写法见 Jarzynski 和 Olano 的 Hash Functions for GPU Rendering
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
uint hashU(vec2 p) {
  ivec2 i = ivec2(floor(p));
  return pcg(uint(i.x) + pcg(uint(i.y) + pcg(uint(uSeed + gSalt * 131.0))));
}
float h21(vec2 p) { return float(hashU(p)) / 4294967295.0; }
vec2 h22(vec2 p) { uint a = hashU(p); return vec2(float(a), float(pcg(a))) / 4294967295.0; }
float sat(float x) { return clamp(x, 0.0, 1.0); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// 梯度噪声，周期 per（整数）；返回约 [0,1]
float gnoise(vec2 p, float per) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 g00 = h22(mod(i, per)) * 2.0 - 1.0;
  vec2 g10 = h22(mod(i + vec2(1.0, 0.0), per)) * 2.0 - 1.0;
  vec2 g01 = h22(mod(i + vec2(0.0, 1.0), per)) * 2.0 - 1.0;
  vec2 g11 = h22(mod(i + vec2(1.0, 1.0), per)) * 2.0 - 1.0;
  float a = dot(g00, f), b = dot(g10, f - vec2(1.0, 0.0));
  float c = dot(g01, f - vec2(0.0, 1.0)), d = dot(g11, f - vec2(1.0, 1.0));
  return clamp(0.5 + 0.72 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0.0, 1.0);
}
float fbm(vec2 uv, float freq, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < oct; i++) {
    s += a * gnoise(uv * freq, freq);
    n += a;
    freq *= 2.0;
    a *= 0.5;
  }
  return s / n;
}
// 各向异性 fbm：fx、fy 两个方向频率不同，用来做拉丝、木纹、流痕
float fbm2(vec2 uv, vec2 freq, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < oct; i++) {
    vec2 p = uv * freq;
    vec2 ip = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float v00 = h21(mod(ip, freq)), v10 = h21(mod(ip + vec2(1.0, 0.0), freq));
    float v01 = h21(mod(ip + vec2(0.0, 1.0), freq)), v11 = h21(mod(ip + vec2(1.0, 1.0), freq));
    s += a * mix(mix(v00, v10, u.x), mix(v01, v11, u.x), u.y);
    n += a;
    freq *= 2.0;
    a *= 0.5;
  }
  return s / n;
}
// Voronoi：x = F1，y = F2，z = 单元随机值
vec3 voronoi(vec2 uv, float freq) {
  vec2 p = uv * freq;
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 c = mod(i + g, freq);
      vec2 r = g + h22(c) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = h21(c + 71.0); }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
struct Surf { vec3 albedo; float height; float rough; float metal; float ao; float alpha; };
Surf newSurf() { return Surf(vec3(0.5), 0.5, 0.6, 0.0, 1.0, 1.0); }
`;

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const mains = {
  albedo: `void main() { Surf s = surface(vUv); gl_FragColor = vec4(s.albedo, s.alpha); }`,
  orm: `void main() { Surf s = surface(vUv); gl_FragColor = vec4(s.ao, s.rough, s.metal, 1.0); }`,
  normal: `uniform vec2 uTexel; uniform float uStrength;
void main() {
  float hx = surface(vUv + vec2(uTexel.x, 0.0)).height - surface(vUv - vec2(uTexel.x, 0.0)).height;
  float hy = surface(vUv + vec2(0.0, uTexel.y)).height - surface(vUv - vec2(0.0, uTexel.y)).height;
  vec3 n = normalize(vec3(-hx * uStrength / (2.0 * uTexel.x), -hy * uStrength / (2.0 * uTexel.y), 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}`,
  pixel: `void main() { gl_FragColor = pixel(vUv); }`,
};

export class TexGen {
  constructor(renderer) {
    this.renderer = renderer;
    this.quad = new FullScreenQuad();
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  run(code, main, { width, height, srgb = false, seed = 1, uniforms = {}, repeat = true, aniso = 8, mips = true }) {
    const rt = new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: false,
      generateMipmaps: mips,
      minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
      wrapT: repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
      anisotropy: Math.min(aniso, this.maxAniso),
    });
    const material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: `${noiseLib}\nvarying vec2 vUv;\n${code}\n${main}`,
      uniforms: {
        uSeed: { value: seed },
        uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
        uStrength: { value: 1 },
        ...uniforms,
      },
      depthTest: false,
      depthWrite: false,
    });
    const prev = this.renderer.getRenderTarget();
    this.quad.material = material;
    this.renderer.setRenderTarget(rt);
    this.quad.render(this.renderer);
    this.renderer.setRenderTarget(prev);
    material.dispose();
    rt.texture.userData.rt = rt;
    return rt.texture;
  }

  // 生成出来的贴图不再用时，连同它的渲染目标一起释放
  free(texture) { texture?.userData.rt?.dispose(); }

  // PBR 三件套：map(sRGB，a = alpha)、normalMap、ormMap(r = ao，g = 粗糙度，b = 金属度)
  pbr(code, opts = {}) {
    const { normal = 0.01, seed = 1, orm = true, uniforms } = opts, { width, height } = this.dims(opts);
    const o = { width, height, seed, uniforms, aniso: opts.aniso };
    const map = this.run(code, mains.albedo, { ...o, srgb: true });
    const normalMap = this.run(code, mains.normal, { ...o, uniforms: { ...uniforms, uStrength: { value: normal } } });
    const ormMap = orm ? this.run(code, mains.orm, o) : null;
    return { map, normalMap, ormMap };
  }

  // 只要法线（高度来自 surface().height）
  normal(code, opts = {}) {
    const { normal = 0.01, seed = 1, uniforms } = opts, { width, height } = this.dims(opts);
    return this.run(code, mains.normal, { width, height, seed, aniso: opts.aniso, uniforms: { ...uniforms, uStrength: { value: normal } } });
  }

  // 单张贴图：配方实现 vec4 pixel(vec2 uv)
  tex(code, opts = {}) {
    const { width, height } = this.dims(opts);
    return this.run(code, mains.pixel, { ...opts, width, height });
  }

  // 贴图边长：this.scale 是整体缩放，省内存档把所有贴图减半（不小于 64）
  dims(opts) {
    const { size = 1024, width = size, height = size } = opts, k = this.scale || 1;
    return { width: Math.max(64, Math.round(width * k)), height: Math.max(64, Math.round(height * k)) };
  }
}
