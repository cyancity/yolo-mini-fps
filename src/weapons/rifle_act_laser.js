// 激光指示器的绿点：腰射辅助。每帧从激光模块打一条射线，落点放一个加色的小圆点。
// 点画在特效层（TAA 之后），所以始终锐利；遮挡靠采样主场景深度，烟团按特效层同一套算法压暗。
// 光束按腰射姿态归零：静止腰射时在 ZERO 米处穿过准心，近处偏一点，远处几乎就在准心上
import * as THREE from 'three';
import { depthGLSL, cloudGLSL, MAX_CLOUDS } from '../fx/common.js';

const ZERO = 15, VM_FOV = 55, MAX = 150;
// 屏幕上的大小（按 900 像素高算，分辨率变了等比缩放）：实心点半径、外面一圈淡光的半径
const CORE_PX = 1.7, HALO_PX = 7;
// 枪口偏离归零线多少度开始淡、多少度完全看不见（换弹、检视、冲刺时枪口不在线上）
const OFF_A = 5, OFF_B = 11;
// 激光模块还没装上时的发射点（枪坐标）：枪管上方 60 毫米、枪口后 120 毫米
const FALLBACK_UP = 0.06, FALLBACK_BACK = 0.12;

const vert = /* glsl */ `
varying vec2 vUv;
varying vec3 vView;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
${depthGLSL}
${cloudGLSL}
uniform vec3 uColor;
uniform float uOpacity;
uniform float uCore;
uniform float uAA;
uniform float uDotZ;
uniform float uTol;
varying vec2 vUv;
varying vec3 vView;
void main() {
  // 主场景在这个像素上比点还近（墙角、枪、敌人挡住了）就不画
  if (sceneViewZ() < uDotZ - uTol) discard;
  float r = length(vUv);
  if (r > 1.0) discard;
  float core = clamp((uCore - r) / uAA + 0.5, 0.0, 1.0);
  float halo = exp(-r * r * 9.0) * 0.07 + exp(-r * r * 60.0) * 0.25;
  float a = (core + halo) * uOpacity * cloudT(vView);
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const _e = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Vector3();
const _f = new THREE.Vector3(), _q = new THREE.Quaternion(), _cq = new THREE.Quaternion(), _ci = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _h = new THREE.Matrix4(), _s = new THREE.Vector3(), _eq = new THREE.Quaternion();
const _E = new THREE.Euler(), _one = new THREE.Vector3(1, 1, 1);

export class LaserDot {
  // model：buildRifle 的返回值；hip：腰射时 holder 相对相机的姿态（归零用）
  constructor(env, model, hip) {
    this.env = env;
    this.model = model;
    // 发射点：模型给了 anchors.laser 就用它（-Z 是光束方向），没有就在枪管上方挂一个
    this.emit = model.anchors.laser || null;
    if (!this.emit) {
      this.emit = new THREE.Object3D();
      this.emit.name = 'rifle.laserFallback';
      const mz = model.anchors.muzzle.position.z;
      this.emit.position.set(0, FALLBACK_UP, mz + FALLBACK_BACK);
      model.root.add(this.emit);
    }
    this.beam = new THREE.Vector3(0, 0, -1); // 发射点坐标里的光束方向（归零后）
    this.rest = new THREE.Vector3(0, 0, -1); // 静止腰射时光束在相机坐标里的方向（判断枪口偏没偏）
    this.zero(hip);
    this.opacity = 0;
    this.offLine = 0;
    this.dist = 0;
    const fx = env.fx?.rig?.uniforms, fxu = env.pipeline?.fxUniforms;
    this.uniforms = {
      tDepth: fxu?.tDepth || { value: null },
      uResolution: fxu?.uResolution || { value: new THREE.Vector2(1, 1) },
      uNear: fxu?.uNear || { value: 0.03 },
      uFar: fxu?.uFar || { value: 600 },
      uClouds: fx?.uClouds || { value: Array.from({ length: MAX_CLOUDS }, () => new THREE.Vector4()) },
      uCloudK: fx?.uCloudK || { value: new Float32Array(MAX_CLOUDS) },
      uColor: { value: new THREE.Color(0.08, 1, 0.15).multiplyScalar(30) },
      uOpacity: { value: 0 },
      uCore: { value: CORE_PX / HALO_PX },
      uAA: { value: 1 / HALO_PX },
      uDotZ: { value: 1 },
      uTol: { value: 0.05 },
    };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    }));
    this.mesh.name = 'rifle.laserDot';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 45;
    this.mesh.visible = false;
    // 菜单、死亡时武器不更新：渲染前再看一眼枪还在不在画面里，不在就不画
    this.mesh.onBeforeRender = () => {
      const vm = env.vm;
      if (!vm?.root.visible || !this.holder?.visible) this.uniforms.uOpacity.value = 0;
    };
    env.fxScene?.add(this.mesh);
  }

  // 归零：静止腰射时光束在 ZERO 米处穿过准心。视图模型和世界的 FOV 不同：发射点按屏幕位置对应到世界是 x、y 乘 s，
  // update 里光束方向的 x、y 也乘同一个 s，所以在视图模型坐标里直接指向 (0, 0, -ZERO) 就行，和世界视野（设置里可调）无关
  zero(hip) {
    const root = this.model.root;
    root.updateWorldMatrix(true, true);
    _m.copy(root.matrixWorld).invert().multiply(this.emit.matrixWorld);
    _m.decompose(_p, _eq, _s);
    _h.compose(_c.set(hip[0], hip[1], hip[2]), _q.setFromEuler(_E.set(hip[3], hip[4], hip[5], 'YXZ')), _one);
    _p.applyMatrix4(_h);
    _eq.premultiply(_q);
    this.rest.set(-_p.x, -_p.y, -ZERO - _p.z).normalize();
    this.beam.copy(this.rest).applyQuaternion(_ci.copy(_eq).invert());
  }

  // vis：0..1，枪的状态允许显示多少（开镜、收枪、喷气、单手扔东西时为 0）
  update(vis, holder) {
    this.holder = holder;
    const { env } = this, cam = env.camera, vm = env.vm, u = this.uniforms;
    // 光束在视图模型的相机坐标里的方向
    this.emit.updateWorldMatrix(true, false);
    this.emit.getWorldQuaternion(_q);
    cam.getWorldQuaternion(_cq);
    _ci.copy(_cq).invert();
    _d.copy(this.beam).applyQuaternion(_q).applyQuaternion(_ci);
    // 枪口离归零线多远：超过 OFF_A 度开始淡，OFF_B 度看不见
    const ang = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(-1, _d.dot(this.rest)))));
    this.offLine = ang;
    const line = 1 - Math.min(1, Math.max(0, (ang - OFF_A) / (OFF_B - OFF_A)));
    const a = vis * line * line * (3 - 2 * line);
    this.opacity = a;
    if (a < 0.01 || !holder.visible) { this.mesh.visible = false; u.uOpacity.value = 0; return; }
    // 换到世界：视图模型里的点按屏幕位置对应到世界（vm.toWorld），方向同样把 x、y 拉开 s 倍
    const vmFov = env.pipeline?.vmFov || VM_FOV;
    const s = Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)) / Math.tan(THREE.MathUtils.degToRad(vmFov * 0.5));
    _d.x *= s; _d.y *= s;
    _d.normalize().applyQuaternion(_cq);
    vm.toWorld(this.emit, _e);
    let dist = env.phys ? env.phys.rayDist(_e, _d, MAX) : -1;
    if (dist < 0) dist = MAX;
    // 敌人和靶子：只有打中时各组的 raycast 才会新建对象
    const groups = env.enemies || [];
    for (let i = 0; i < groups.length; i++) {
      const h = groups[i].raycast(_e, _d, dist);
      if (h && h.dist < dist) dist = h.dist;
    }
    if (dist >= MAX) { this.mesh.visible = false; u.uOpacity.value = 0; return; }
    this.dist = dist;
    // 落点往镜头方向拉回一点，深度比较时不和墙面打架
    _p.copy(_e).addScaledVector(_d, dist);
    cam.getWorldPosition(_c);
    _f.copy(_c).sub(_p);
    const r = _f.length();
    _p.addScaledVector(_f.multiplyScalar(1 / Math.max(r, 1e-4)), Math.min(0.02 + 0.002 * r, r * 0.5));
    // 面向镜头的小方片，边长按像素算：远近都是同样大的一个点
    const H = env.pipeline?.size?.y || window.innerHeight;
    const px = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5))) / H, k = H / 900;
    _f.set(0, 0, -1).applyQuaternion(_cq);
    const z = _f.dot(_s.copy(_p).sub(_c));
    this.mesh.position.copy(_p);
    this.mesh.quaternion.copy(_cq);
    this.mesh.scale.setScalar(Math.max(z, 0.05) * px * HALO_PX * k);
    u.uDotZ.value = z;
    u.uTol.value = 0.02 + 0.004 * z;
    u.uOpacity.value = a;
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
    this.uniforms.uOpacity.value = 0;
    this.opacity = 0;
  }
}
