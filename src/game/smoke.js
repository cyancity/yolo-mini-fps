import * as THREE from 'three';
import { MAP } from '../world/plan.js';
import { makeCanister } from './smoke_model.js';
import { CLOUD, CLOUD_LIFT, visionRadius, feedCloud } from './smoke_cloud.js';

// 突破型烟雾弹（G）：第一次碰撞弹一下，第二次碰撞当场炸开，原地起一团 4.2 米的烟，6 秒散尽。
// 烟团登记在 phys.smokes 里，敌人的视线（phys.blocked）穿不过去；子弹和人不受影响。
const COOLDOWN = 8;
const POOL = 3;
const SPEED = 17;      // 出手速度
const INHERIT = 0.5;   // 带上玩家自身速度的比例
const INHERIT_MAX = 5; // 带上的速度最多这么大
const LOFT = 1.2;      // 出手点在镜头下方，略往上抛一点，近处的落点才贴着准心
const GRAVITY = 9.8;
const RAD = 0.045;     // 碰撞半径（罐体一半长度上下）
const KEEP_N = 0.4;    // 反弹保留的法向速度
const KEEP_T = 0.75;   // 反弹保留的切向速度
const FUSE = 3;        // 扔出去这么久还没第二次碰撞，直接炸开
const REST = 0.35;     // 弹过一次后慢到这个速度就算停住了
const STEP = 1 / 60;   // 飞行子步长
const WALL_TOP = 20;   // 地图四周隐形墙的高度：只挡人不挡射线，罐子在这里自己判
const OFF_WALL = 0.7;  // 撞墙炸开时烟团往墙外让的距离
const CLOUD_OPTS = Object.freeze({ radius: CLOUD.radius, life: CLOUD.life });
const DUST = { size: 0.3, life: 0.8, rise: 0.35, count: 4, color: 0x8b857d };
const SPARK = { speed: 4, color: 0xffc070 };

const IDLE = 0, FLY = 1, SMOKE = 2;
const _o = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const _d = new THREE.Vector3(), _t = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3();
const _q = new THREE.Quaternion();
const rand = (a, b) => a + Math.random() * (b - a);

export class SmokeGrenades {
  constructor({ scene, phys, mats, fx, audio }) {
    Object.assign(this, { scene, phys, fx, audio });
    this.ready = 1; // 0..1，1 = 可以扔
    this.cool = 0;
    this.slots = [];
    for (let i = 0; i < POOL; i++) {
      const mesh = makeCanister(mats);
      scene.add(mesh);
      // 烟团只登记一次，之后只改 r（0 = 还在飞或已散尽）
      const smoke = { x: 0, y: -100, z: 0, r: 0 };
      phys.smokes?.push(smoke);
      this.slots.push({
        mesh, smoke, state: IDLE, t: 0, contacts: 0,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(),
        cloud: { x: 0, y: 0, z: 0, t: 0, acc: 0 }, own: true,
      });
    }
  }

  get alive() {
    let n = 0;
    for (const g of this.slots) if (g.state !== IDLE) n++;
    return n;
  }

  // 左手扔的：从镜头左下方沿准心方向出手。冷却没好或者池子占满时返回 false
  throw(camera, player) {
    if (this.cool > 0) return false;
    let g = null;
    for (const s of this.slots) if (s.state === IDLE) { g = s; break; }
    if (!g) return false;
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    _o.set(e[12], e[13], e[14]);
    _r.set(e[0], e[1], e[2]).normalize();
    _u.set(e[4], e[5], e[6]).normalize();
    _f.set(-e[8], -e[9], -e[10]).normalize();
    // 出手点不能塞进墙里：从镜头往出手点扫一下，挡住了就退回到墙前
    const p = g.pos.copy(_o).addScaledVector(_r, -0.22).addScaledVector(_u, -0.15).addScaledVector(_f, 0.35);
    _d.subVectors(p, _o);
    const len = _d.length();
    _d.multiplyScalar(1 / len);
    const hit = this.phys.raycast(_o, _d, len + RAD);
    if (hit) p.copy(_o).addScaledVector(_d, Math.max(0, hit.dist - RAD - 0.01));
    g.vel.copy(_f).multiplyScalar(SPEED);
    g.vel.y += LOFT;
    // 带上的自身速度封顶：喷气冲刺或被碰撞体推出来的一瞬间速度很大，别把罐子甩飞
    if (player?.velocity) {
      _t.copy(player.velocity).multiplyScalar(INHERIT);
      const k = _t.length();
      if (k > INHERIT_MAX) _t.multiplyScalar(INHERIT_MAX / k);
      g.vel.add(_t);
    }
    // 举手过肩扔出去：绕镜头右轴往前翻，带一点随机的歪
    g.spin.copy(_r).multiplyScalar(-rand(11, 15)).addScaledVector(_f, rand(-3, 3));
    g.mesh.quaternion.copy(camera.quaternion);
    g.mesh.position.copy(p);
    g.mesh.visible = true;
    g.state = FLY;
    g.t = 0;
    g.contacts = 0;
    g.smoke.r = 0;
    this.cool = COOLDOWN;
    this.ready = 0;
    this.audio?.play?.('smokeThrow', { volume: 0.8 });
    return true;
  }

  update(dt) {
    if (!(dt > 0)) return;
    this.cool = Math.max(0, this.cool - dt);
    this.ready = 1 - this.cool / COOLDOWN;
    for (const g of this.slots) {
      if (g.state === FLY) this.fly(g, dt);
      else if (g.state === SMOKE) this.hold(g, dt);
    }
  }

  // 逐个子步长扫射线，飞得再快也穿不过薄墙
  fly(g, dt) {
    const p = g.pos, v = g.vel;
    for (let left = dt; left > 1e-6 && g.state === FLY;) {
      const h = Math.min(STEP, left);
      left -= h;
      g.t += h;
      v.y -= GRAVITY * h;
      const sp = v.length();
      if (sp > 1e-4) {
        const dist = sp * h;
        _d.copy(v).multiplyScalar(1 / sp);
        const hit = this.phys.raycast(p, _d, dist + RAD);
        if (hit) {
          p.copy(hit.point).addScaledVector(hit.normal, RAD);
          this.contact(g, hit.normal, hit.surface, sp);
          continue;
        }
        p.addScaledVector(_d, dist);
      }
      this.fence(g, sp);
      if (g.state !== FLY) break;
      if (g.t >= FUSE || (g.contacts > 0 && sp < REST)) this.burst(g, _n.set(0, 1, 0));
    }
    if (g.state !== FLY) return;
    // 翻滚
    const w = g.spin.length();
    if (w > 1e-4) {
      _a.copy(g.spin).multiplyScalar(1 / w);
      _q.setFromAxisAngle(_a, w * dt);
      g.mesh.quaternion.premultiply(_q);
    }
    g.mesh.position.copy(p);
  }

  // 地图边上的隐形墙只挡人，射线穿得过去，罐子在这里当墙处理；掉到地面以下也拉回来
  fence(g, sp) {
    const p = g.pos;
    if (p.y < -0.3) {
      p.y = RAD;
      this.contact(g, _n.set(0, 1, 0), 'asphalt', sp);
      return;
    }
    if (p.y > WALL_TOP) return;
    if (p.x < MAP.x0 + RAD) { p.x = MAP.x0 + RAD; this.contact(g, _n.set(1, 0, 0), 'metal', sp); }
    else if (p.x > MAP.x1 - RAD) { p.x = MAP.x1 - RAD; this.contact(g, _n.set(-1, 0, 0), 'metal', sp); }
    else if (p.z < MAP.z0 + RAD) { p.z = MAP.z0 + RAD; this.contact(g, _n.set(0, 0, 1), 'metal', sp); }
    else if (p.z > MAP.z1 - RAD) { p.z = MAP.z1 - RAD; this.contact(g, _n.set(0, 0, -1), 'metal', sp); }
  }

  // 第一次碰撞弹开，第二次当场炸开
  contact(g, n, surface, speed) {
    g.contacts++;
    if (g.contacts >= 2) { this.burst(g, n); return; }
    const v = g.vel, vn = v.dot(n);
    if (vn < 0) {
      _t.copy(n).multiplyScalar(vn);
      v.sub(_t).multiplyScalar(KEEP_T).addScaledVector(_t, -KEEP_N);
    }
    // 磕一下换个翻法：转速跟着弹开后的速度走
    _a.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
    g.spin.copy(_a).multiplyScalar(Math.min(22, 3 + v.length() * 1.6));
    const p = g.pos, fx = this.fx;
    this.audio?.play?.('smokeBounce', { position: p, surface, volume: Math.min(1, 0.35 + speed / 18) });
    if (!fx) return;
    _t.copy(p).addScaledVector(n, -RAD * 0.8);
    if (surface === 'metal' || surface === 'concrete') fx.sparks?.(_t, n, surface === 'metal' ? 8 : 4, SPARK);
    fx.smoke?.(_t, DUST);
  }

  burst(g, n) {
    const p = g.pos, c = g.cloud;
    g.state = SMOKE;
    g.mesh.visible = false;
    // 撞在墙上炸开：烟团往墙外让一点，别一半埋进墙里。
    // 烟团扣在炸点正下方的地面上（fx.smokeCloud 也是这么画的），引信在半空炸开时视线球才和看到的烟对得上
    const nh = Math.hypot(n.x, n.z);
    const k = nh > 0.3 ? OFF_WALL / nh : 0;
    c.x = p.x + n.x * k;
    c.z = p.z + n.z * k;
    c.y = this.phys.groundHeight(c.x, c.z, 0.05, p.y, 0.1);
    c.t = 0;
    c.acc = 0;
    const s = g.smoke;
    s.x = c.x; s.y = c.y + CLOUD_LIFT; s.z = c.z; s.r = 0;
    this.audio?.play?.('smokeBurst', { position: p, volume: 1 });
    // 有专门的烟团特效就交给它，没有（或者出错）就自己往 fx.smoke 里喂
    g.own = true;
    if (typeof this.fx?.smokeCloud === 'function') {
      try {
        _t.set(c.x, c.y, c.z);
        this.fx.smokeCloud(_t, CLOUD_OPTS);
        g.own = false;
      } catch (e) {
        console.warn('[smoke] fx.smokeCloud 出错，改用自带的烟', e);
      }
    }
  }

  hold(g, dt) {
    const c = g.cloud;
    if (g.own && this.fx?.smoke) feedCloud(this.fx, c, dt);
    else c.t += dt;
    g.smoke.r = visionRadius(c.t);
    if (c.t >= CLOUD.life) {
      g.state = IDLE;
      g.smoke.r = 0;
    }
  }

  clear() {
    for (const g of this.slots) {
      g.state = IDLE;
      g.mesh.visible = false;
      g.smoke.r = 0;
    }
    this.cool = 0;
    this.ready = 1;
  }
}
