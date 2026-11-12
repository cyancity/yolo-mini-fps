// 时段预览：一小块场地（湿地面、几只箱子、一堵墙、四盏高杆灯、30 / 40 / 50 米处的深色假人），
// 看太阳、天空、补光、地面干湿和灯的强弱跟着时段怎么变。这里没有后处理管线，体积雾和泛光看不到，
// 那两样到游戏页里用 __dbg.game.applySetting('timeOfDay', 名字) 看。
// 按 1 / 2 / 3 或点左上角切换，按住鼠标拖动转头。控制台：__h.tod.set('day')，__h.look(x, z, 偏航度, 俯仰度, 眼高)。
import * as THREE from 'three';
import { startHarness } from './harness.js';
import { Lighting } from '../src/world/lighting.js';
import { Ground } from '../src/world/ground.js';
import { TimeOfDay } from '../src/world/timeofday.js';

const LABEL = { afternoon: '下午', day: '白天', night: '夜晚' };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

startHarness(async (h) => {
  const { scene, camera, renderer, mats, sky } = h;
  camera.fov = 72;
  camera.far = 600;
  // 和 main.js 启动时一样的雾和环境光强度，时段把它们当夜景记下来
  scene.fog = new THREE.FogExp2(0x0c1a2e, 0.0045);
  scene.environmentIntensity = 1.5;

  const ground = new Ground(mats, null);
  scene.add(ground.mesh);

  const box = (mat, w, hgt, d, x, z, y = 0, yaw = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), mat);
    m.position.set(x, y + hgt / 2, z);
    m.rotation.y = yaw;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  // 集装箱：两侧各一摞，中间斜放一只
  const paints = [0xb23a2a, 0x2f6b4f, 0xd49a1e, 0x2a4f8a].map((c) => mats.paint(c));
  box(paints[0], 2.44, 2.59, 12.19, -11, 2);
  box(paints[1], 2.44, 2.59, 12.19, -11, 2, 2.59);
  box(paints[2], 2.44, 2.59, 6.06, 11, -6);
  box(paints[3], 2.44, 2.59, 6.06, 11, 4);
  box(paints[1], 6.06, 2.59, 2.44, 7, 14, 0, 0.5);
  // 假人身后的墙：站在墙影里和站在太阳地里各有一个
  box(mats.concrete, 30, 5, 0.4, 0, -24);

  // 假人用和敌人差不多深的布料色，分别在机位正前方 30、40、50 米
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2c3126, roughness: 1 });
  [[-3, 0], [3, -10], [0, -20]].forEach(([x, z]) => {
    box(cloth, 0.34, 0.85, 0.24, x, z);
    box(cloth, 0.5, 0.62, 0.28, x, z, 0.85);
    box(cloth, 0.24, 0.26, 0.24, x, z, 1.5);
  });

  const masts = [[-16, -10], [16, -10], [16, 20], [-16, 20]].map(([x, z]) => ({ position: V(x, 14, z), target: V(x * 0.35, 0, z * 0.35 + 3) }));
  const pole = mats.galv, head = mats.emissive(0xffd9a0, 6);
  for (const m of masts) {
    box(pole, 0.3, 14, 0.3, m.position.x, m.position.z);
    box(head, 0.9, 0.16, 0.5, m.position.x, m.position.z, 14);
  }
  const lighting = new Lighting(scene, sky, {
    lite: true, masts, zones: [],
    containerLight: { position: V(11, 2.4, -1), target: V(11, 0, -1) },
    workLight: { position: V(-8, 3, 12), direction: V(0.6, -0.5, -0.6).normalize() },
    exitSign: V(0, 3, -23.7),
  });

  const tod = new TimeOfDay({ renderer, scene, camera, sky, level: { lighting, ground, phys: null }, pipeline: null, mats });
  sky.bakeProbe(renderer, scene, V(0, 2.4, 8));

  let yaw = 0, pitch = 0;
  h.look = (x = 0, z = 30, yawDeg = 0, pitchDeg = 0, eye = 1.6) => {
    yaw = yawDeg;
    pitch = pitchDeg;
    camera.position.set(x, eye, z);
  };
  h.look();
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!e.buttons) return;
    yaw += e.movementX * 0.2;
    pitch = THREE.MathUtils.clamp(pitch + e.movementY * 0.2, -80, 80);
  });

  const bar = document.getElementById('tod');
  const buttons = tod.names.map((name) => {
    const b = document.createElement('button');
    b.textContent = LABEL[name] ?? name;
    b.onclick = () => pick(name);
    bar?.append(b);
    return b;
  });
  const pick = (name) => {
    tod.set(name);
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(tod.names[i] === tod.name)));
  };
  addEventListener('keydown', (e) => {
    const name = tod.names[Number(e.key) - 1];
    if (name) pick(name);
  });

  let frame = 0;
  h.onFrame = (dt, t) => {
    camera.rotation.set(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), 0, 'YXZ');
    camera.updateMatrixWorld();
    sky.update(dt);
    lighting.update(dt);
    renderer.toneMappingExposure = tod.exposure;
    // 地面的倒影：镜像画面先画进它自己的贴图，再回到屏幕
    ground.resize(renderer.domElement.width, renderer.domElement.height);
    ground.update(renderer, scene, camera, t, frame++);
    renderer.setRenderTarget(null);
  };
  Object.assign(h, { tod, lighting, ground, pick });
  pick('afternoon');
}, { studio: false });
