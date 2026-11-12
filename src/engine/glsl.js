// 后处理着色器共用片段。视图模型（第一人称武器）把深度压进 [0, VM_DEPTH)，
// 这样它永远画在世界前面，后处理也能靠深度认出它。
export const VM_DEPTH = 0.1;

export const fsVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const depthLib = /* glsl */ `
#define VM_DEPTH ${VM_DEPTH.toFixed(3)}
uniform sampler2D tDepth;
uniform mat4 uInvProj;
float rawDepth(vec2 uv) { return texture2D(tDepth, uv).r; }
float decodeDepth(float d) { return d < VM_DEPTH ? d / VM_DEPTH : d; }
float fetchDepth(vec2 uv) { return decodeDepth(rawDepth(uv)); }
vec3 viewPos(vec2 uv, float d) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
// Interleaved Gradient Noise，Jorge Jimenez
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

// 半分辨率缓冲（rgb + a 存线性深度）按深度加权上采样，避免前景边缘出现光晕
export const upsampleLib = /* glsl */ `
vec4 depthUpsample(sampler2D tex, vec2 uv, float z, vec2 texel) {
  vec2 f = uv / texel - 0.5;
  vec2 base = (floor(f) + 0.5) * texel;
  vec2 fr = fract(f);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec4 s = texture2D(tex, base + vec2(float(i), float(j)) * texel);
      float wb = (i == 0 ? 1.0 - fr.x : fr.x) * (j == 0 ? 1.0 - fr.y : fr.y);
      float wz = 1.0 / (1.0 + 60.0 * abs(s.a - z) / max(z, 0.05));
      float w = (wb + 0.02) * wz;
      acc += s * w;
      wsum += w;
    }
  }
  return acc / wsum;
}`;
