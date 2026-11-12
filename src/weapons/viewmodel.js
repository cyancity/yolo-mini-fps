import * as THREE from 'three';
import { Spring, damp } from './anim.js';
import { follow } from './knife_anim.js';

// 喷气偏移的跟随速度（临界阻尼）：起步和收尾都从零速度开始，第一帧不跳
const DASH_OMEGA = 22;

// 第一人称武器的公共骨架，挂在相机下面：
// root（步态晃动 + 视角滞后）→ kick（后坐力弹簧）→ 各武器自己的 holder（姿态与动画）
export class ViewModel {
  constructor(camera, pipeline) {
    this.camera = camera;
    this.pipeline = pipeline;
    this.root = new THREE.Group();
    this.kick = new THREE.Group();
    this.root.add(this.kick);
    camera.add(this.root);
    // 0/1 视角滞后（偏航、俯仰），2 侧移倾斜，3 竖直速度
    this.lag = new Spring(4, 110, 15);
    // 0 后退，1 上跳，2 上抬角，3 偏转角，4 滚转（刀、受击、换弹拍匣、放枪机都走这根）
    this.recoil = new Spring(5, 210, 19);
    // 步枪开火单独两根更硬的弹簧：一发在 0.083 秒的射击间隔里基本回得来，连发时一下一下分得清。
    // 平移（0 后退，1 上跳）比转角（0 上抬角，1 偏转角，2 滚转）硬：枪往后顶得明显，红点在镜片里不多晃
    this.fireMove = new Spring(2, 700, 38);
    this.fireTurn = new Spring(3, 400, 28);
    this.time = 0;
    this.bobAmp = 0;
    this.swayScale = 1;
    // 喷气偏移：竖直下沉、前后、侧向三路，各自二阶平滑
    this.dashY = { x: 0, v: 0 };
    this.dashZ = { x: 0, v: 0 };
    this.dashX = { x: 0, v: 0 };
    // 侧移倾斜也用二阶跟随：喷气时横向速度一帧就到位，一阶平滑会让枪第一帧猛地一歪
    this.side = { x: 0, v: 0 };
  }

  // 视图模型网格：独立图层（不进倒影和反射探针）、不做视锥裁剪（投影不同）、不投影
  prepare(object) {
    object.traverse((o) => {
      o.layers.set(1);
      if (o.isMesh) {
        o.frustumCulled = false;
        o.castShadow = false;
        o.receiveShadow = true;
      }
    });
    return object;
  }

  punch(back, up, pitch, yaw, roll) {
    const r = this.recoil;
    r.kick(0, back); r.kick(1, up); r.kick(2, pitch); r.kick(3, yaw); r.kick(4, roll);
  }

  // 步枪开火的后坐，参数同 punch
  firePunch(back, up, pitch, yaw, roll) {
    const m = this.fireMove, t = this.fireTurn;
    m.kick(0, back); m.kick(1, up); t.kick(0, pitch); t.kick(1, yaw); t.kick(2, roll);
  }

  resetRecoil() {
    this.recoil.reset();
    this.fireMove.reset();
    this.fireTurn.reset();
  }

  // 把视图模型里的点换算到世界：视图模型用的 FOV 比世界窄，屏幕位置要对上得按比例拉开
  toWorld(object, out) {
    const cam = this.camera;
    object.getWorldPosition(out);
    cam.worldToLocal(out);
    const s = Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)) / Math.tan(THREE.MathUtils.degToRad(this.pipeline.vmFov * 0.5));
    out.x *= s;
    out.y *= s;
    return cam.localToWorld(out);
  }

  update(dt, player, ads) {
    this.time += dt;
    const t = this.time, calm = 1 - 0.86 * ads, lag = this.lag, rc = this.recoil;
    // 视角滞后：鼠标甩得越快，枪落后得越多
    lag.v[0] += THREE.MathUtils.clamp(player.look.dx, -120, 120) * 0.0105 * this.swayScale;
    lag.v[1] += THREE.MathUtils.clamp(player.look.dy, -120, 120) * 0.0105 * this.swayScale;
    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    const lateral = player.velocity.x * cy - player.velocity.z * sy;
    lag.x[2] = follow(this.side, lateral, 18, dt);
    lag.x[3] = damp(lag.x[3], player.grounded ? 0 : player.velocity.y, 10, dt);
    lag.v[2] = lag.v[3] = 0;
    lag.update(dt);
    rc.update(dt);
    const fm = this.fireMove, ft = this.fireTurn;
    fm.update(dt);
    ft.update(dt);

    // 步态：左右走 8 字，落脚时往下一顿
    const sprint = player.sprinting ? 1 : 0;
    this.bobAmp = damp(this.bobAmp, Math.min(player.moveAmount, 1.4) * (1 + 0.9 * sprint), 8, dt);
    const ph = Math.PI * player.stride, amp = this.bobAmp * calm;
    const bobX = Math.sin(ph) * 0.0085 * amp;
    const bobY = -Math.abs(Math.sin(ph)) * 0.0075 * amp + 0.004 * amp;
    const breathe = Math.sin(t * 1.35) * 0.0016 * calm, drift = Math.sin(t * 0.83 + 1.3) * 0.0012 * calm;

    // 跳起和落地只让枪轻轻一沉、不带转动：准心和枪口在空中、滑铲时都要稳
    // player.dash 是一阶平滑，起步那帧斜率突变，再过一道二阶跟随
    const land = player.landImpulse, dash = (player.dash || 0) * calm;
    const dy = follow(this.dashY, dash, DASH_OMEGA, dt);
    const dz = follow(this.dashZ, (player.dashF || 0) * dash, DASH_OMEGA, dt);
    const dx = follow(this.dashX, (player.dashS || 0) * dash, DASH_OMEGA, dt);
    this.root.position.set(
      bobX + drift - lag.x[0] * 0.012 * calm - lag.x[2] * 0.0016 * calm - dx * 0.022,
      bobY + breathe - lag.x[1] * 0.01 * calm - lag.x[3] * 0.0015 * calm - land * 0.01 * calm - 0.012 * dy,
      land * 0.004 * calm + dz * 0.03,
    );
    this.root.rotation.set(
      -lag.x[1] * 0.045 * calm + lag.x[3] * 0.002 * calm - land * 0.012 * calm + breathe * 1.5,
      -lag.x[0] * 0.055 * calm + bobX * 1.2 + dx * 0.05,
      -lag.x[0] * 0.07 * calm - lag.x[2] * 0.011 * calm + bobX * 2.2 - dx * 0.1,
      'YXZ',
    );
    this.kick.position.set(0, rc.x[1] + fm.x[1], rc.x[0] + fm.x[0]);
    this.kick.rotation.set(rc.x[2] + ft.x[0], rc.x[3] + ft.x[1], rc.x[4] + ft.x[2], 'YXZ');
  }

  // 世界空间里的瞄准线（屏幕正中）
  aim(origin, dir) {
    this.camera.getWorldPosition(origin);
    this.camera.getWorldDirection(dir);
  }

  // 视图空间方向（相机坐标）下的某个物体位置和朝向轴，给全息准星用
  viewSpace(object, pos, right, up, fwd) {
    object.updateWorldMatrix(true, false);
    const inv = this.camera.matrixWorldInverse;
    const e = _m.multiplyMatrices(inv, object.matrixWorld).elements;
    pos.set(e[12], e[13], e[14]);
    right.set(e[0], e[1], e[2]).normalize();
    up.set(e[4], e[5], e[6]).normalize();
    fwd.set(-e[8], -e[9], -e[10]).normalize();
  }
}

const _m = new THREE.Matrix4();
