import * as THREE from 'three';

// 红点：画在 TAA 之后的特效层里，所以始终锐利。红点在“无限远”处，位置只取决于光轴的方向；
// 只有视线穿过镜片露出来的那部分（立柱之间和柱顶以上）才看得见，于是腰射时自然看不到，开镜对正后才出现。
// 点芯先把背后的画面盖掉再上色，不是单纯叠加：对着白天的天空和亮墙也还是一颗实心的红点
const frag = /* glsl */ `
uniform vec3 uPos;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform vec4 uWin;   // 镜片通光口：半宽、光轴到上沿、光轴到下槛、上角的圆角
uniform vec2 uPost;  // 立柱内侧到光轴的距离、柱顶相对光轴的高度
uniform vec2 uTan;
uniform float uPx;
uniform float uOpacity;
uniform float uGain;
uniform vec3 uColor;
varying vec2 vUv;

void main() {
  vec3 ray = normalize(vec3((vUv * 2.0 - 1.0) * uTan, -1.0));
  float df = dot(ray, uFwd);
  if (df < 0.3) discard;
  // 相对光轴的角度（弧度）；光晕到 20 mrad 以外就没有了
  vec2 q = vec2(dot(ray, uRight), dot(ray, uUp)) / df;
  float r = length(q);
  if (r > 0.02) discard;

  // 视线和镜片平面的交点（相对光轴）到通光口边缘的有符号距离：上边两个角是圆的，下边压在下槛上是直的
  float t = dot(uPos, uFwd) / df;
  vec3 hit = ray * t - uPos;
  vec2 p = vec2(dot(hit, uRight), dot(hit, uUp));
  vec2 c = vec2(p.x, p.y - (uWin.y - uWin.z) * 0.5);
  float rr = c.y > 0.0 ? uWin.w : 0.0;
  vec2 l = abs(c) - vec2(uWin.x, (uWin.y + uWin.z) * 0.5) + rr;
  float sd = length(max(l, 0.0)) + min(max(l.x, l.y), 0.0) - rr;
  // 两根立柱挡住的部分：只有立柱之间和柱顶以上是通的
  sd = max(sd, min(abs(p.x) - uPost.x, uPost.y - p.y));
  float mask = clamp(0.5 - sd / (t * uPx), 0.0, 1.0) * uOpacity;
  if (mask <= 0.0) discard;

  // 实心点（半径 2 mrad，1080p 上直径 5 像素左右）加一圈很淡的光晕，没有外圈和刻线。
  // alpha 只算点芯：盖住背景的只有点芯，光晕是叠加上去的
  float core = clamp((0.002 - r) / uPx + 0.5, 0.0, 1.0) * mask;
  float halo = (exp(-r * r / 0.000009) * 0.2 + exp(-r * r / 0.00005) * 0.035) * mask;
  gl_FragColor = vec4(uColor * uGain * (core + halo), core);
}`;

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export class Reticle {
  constructor(pipeline) {
    this.pipeline = pipeline;
    this.uniforms = {
      uPos: { value: new THREE.Vector3() },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uFwd: { value: new THREE.Vector3(0, 0, -1) },
      uWin: { value: new THREE.Vector4(0.0118, 0.0106, 0.0092, 0.0028) },
      uPost: { value: new THREE.Vector2(0.0108, 0.0063) },
      uTan: { value: new THREE.Vector2(1, 1) },
      uPx: { value: 0.001 },
      uOpacity: { value: 1 },
      // 画面最后要乘曝光再过色调映射：这里先除掉曝光，红点在任何时段都是同一个亮度，不会被压成粉白色
      uGain: { value: 1 },
      uColor: { value: new THREE.Color(1.9, 0.045, 0.02) },
    };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      depthTest: false, depthWrite: false, transparent: true,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    this.mesh.visible = false;
  }

  // sight：光轴穿过镜片后表面的那个锚点（-Z 朝枪口）；win：rifle_optics.js 的 SIGHT（通光口和立柱的尺寸，都相对光轴）
  update(vm, sight, win, opacity) {
    const u = this.uniforms, cam = vm.camera;
    this.mesh.visible = opacity > 0.01;
    if (!this.mesh.visible) return;
    vm.viewSpace(sight, u.uPos.value, u.uRight.value, u.uUp.value, u.uFwd.value);
    const t = Math.tan(THREE.MathUtils.degToRad(this.pipeline.vmFov * 0.5));
    u.uTan.value.set(t * cam.aspect, t);
    u.uPx.value = (2 * t) / this.pipeline.size.y;
    u.uWin.value.set(win.w, win.up, win.down, win.r);
    u.uPost.value.set(win.postX, win.postY);
    u.uOpacity.value = opacity;
    u.uGain.value = 1 / Math.max(this.pipeline.final.uExposure.value, 0.05);
  }
}
