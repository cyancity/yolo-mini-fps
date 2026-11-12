// 开发预览用的简易场景：真实材质 + 摄影棚式灯光 + 可脚本控制的环绕相机。
// 用法见 dev/README.md。只给模型/特效开发时看效果，不进游戏。
import * as THREE from 'three';
import { TexGen } from '../src/gfx/texgen.js';
import { Materials } from '../src/gfx/materials.js';
import { Sky } from '../src/gfx/sky.js';

export async function startHarness(setup, { exposure = 1.0, studio = true } = {}) {
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100vw;height:100vh';
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.005, 300);
  const mats = new Materials(new TexGen(renderer), { vmProjection: { value: new THREE.Matrix4() } });
  await mats.build();
  const sky = new Sky();
  scene.add(sky.mesh);
  sky.bakeEnvironment(renderer, scene);
  if (studio) {
    scene.environmentIntensity = 3;
    const key = new THREE.DirectionalLight(0xffe2c4, 2.4);
    key.position.set(1.5, 2.5, 2);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.6);
    rim.position.set(-2, 1.2, -2.5);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1.5, -0.5, 2);
    scene.add(key, rim, fill);
  }
  const target = new THREE.Vector3();
  const api = {
    THREE, scene, camera, renderer, mats, gear: mats.gear(false), sky, onFrame: null, time: 0,
    // 环绕视角：偏航、俯仰（度），距离（米），目标点
    view(yaw = 30, pitch = 15, dist = 1, tx = 0, ty = 0, tz = 0) {
      target.set(tx, ty, tz);
      const y = THREE.MathUtils.degToRad(yaw), p = THREE.MathUtils.degToRad(pitch);
      camera.position.set(tx + Math.sin(y) * Math.cos(p) * dist, ty + Math.sin(p) * dist, tz + Math.cos(y) * Math.cos(p) * dist);
      camera.lookAt(target);
    },
  };
  window.__h = api;
  api.view();
  await setup(api);
  // 画一帧。后台标签页里 rAF 不跑，用 __h.frame(n) 手动推进后再截图
  const step = (dt) => {
    api.time += dt;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    api.onFrame?.(dt, api.time);
    renderer.render(scene, camera);
  };
  api.frame = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) step(dt); };
  let last = performance.now();
  const tick = (now) => {
    step(Math.min(0.1, (now - last) / 1000));
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return api;
}
