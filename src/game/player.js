import * as THREE from 'three';

const WALK = 4.4, SPRINT = 6.3, CROUCH_SPEED = 2.1;
const RADIUS = 0.34, HEIGHT = 1.8, EYE = 1.64, CROUCH_HEIGHT = 1.2, CROUCH_EYE = 1.02;
const STEP = 0.42, GRAVITY = 17;
// 跳：原地起跳脚底到 1.2 米，助跑（冲刺或滑铲的速度）到 1.46 米。空中只认比脚底高 0.05 米以内的台面，
// 所以原地能跳上 1.1 米（月台），助跑能上 1.35 米。没有攀爬，想让人上去的台面不要高过这两个数
const JUMP = 6.4, JUMP_RUN = 7.05, JUMP_BUFFER = 0.12;
// 连跳（兔子跳、滑铲跳）：落地后这么短时间内又起跳，不吃地面摩擦，但水平速度只留落地时的 HOP_KEEP，越跳越慢，
// 最慢降到 HOP_FLOOR。落地后多等一会儿再跳就不扣
const HOP_WINDOW = 0.25, HOP_KEEP = 0.9, HOP_FLOOR = 3.5;
// 世界相机的基准视野（竖直，度），设置里可改成 60~95，存在 player.baseFov
const BASE_FOV = 72;
// 开镜时的移速倍率（滑铲不受影响）
const ADS_SPEED = 0.5;
// 切换式冲刺：没有前进输入这么久就退出
const SPRINT_DROP = 0.25;
// 滑铲：冲刺中按下蹲键。起步给一个初速，之后只靠摩擦减速，最长 SLIDE_TIME 秒
const SLIDE_SPEED = 8.6, SLIDE_FRICTION = 5.2, SLIDE_TIME = 1.05, SLIDE_END = 3.2, SLIDE_COOLDOWN = 0.45, SLIDE_EYE = 0.86;
// 探头：按住 Q / E，镜头横移并侧倾，身体不动
const LEAN_X = 0.38, LEAN_ROLL = 0.19, LEAN_DROP = 0.05, HEAD_R = 0.2;
// 脱战回血：这么多秒没挨打后开始回
const REGEN_DELAY = 4, REGEN_RATE = 25;
// 喷气：V 或鼠标侧键。朝移动输入的方向（八向，没有输入就朝正前）平推一段，空中也能用。
// 速度从 DASH_PEAK 按 1 - u² 落到 DASH_EXIT，一次约 6.4 米；结束后 DASH_HANG 秒内下落只吃 HANG_GRAVITY 倍重力
const DASH_PEAK = 27, DASH_TIME = 0.32, DASH_EXIT = 7.5, DASH_COOLDOWN = 1.6;
const DASH_HANG = 0.25, HANG_GRAVITY = 0.3, DASH_FOV = 13;
// 喷气的画面效果（视野拉开、模糊、速度线，都乘 player.dash）跟着速度走：前三分之二全开，之后随减速一起收，
// 结束后按 DASH_FADE 收完，视野按 DASH_FOV_BACK 跟回去。喷完马上大角度转向时画面已经基本回到正常视野
const DASH_EASE = 1.8, DASH_FADE = 16, DASH_FOV_BACK = 30;
export const DASH = { time: DASH_TIME, cooldown: DASH_COOLDOWN };
// 落地：镜头先往下压再弹回（二阶，最低点在落地后 1/LAND_W 秒，约 67 毫秒）。下沉深度随落地速度涨，
// 平地起跳落下约 2 厘米，6 米落差封顶 6.5 厘米；落差超过两米左右才带一点低头，最多 LAND_PITCH
const LAND_W = 15, LAND_DIP_MAX = 0.065, LAND_PITCH = 0.7 * Math.PI / 180;
// 侧移滚转的二阶跟随速度：起步不跳，走路、冲刺侧移的稳态幅度和原来一样
const ROLL_W = 10;
// 喷气侧倾单独用更快的跟随，峰值和喷气结束（0.32 秒）对上，起步那一帧仍然不跳；跟得快了幅度系数从 0.065 降到 0.06，峰值不变大
const ROLL_DASH_W = 17;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
// 临界阻尼跟随：s = { x, v } 朝 target 靠，起步没有速度突变
const follow = (s, target, w, dt) => {
  const d = s.x - target, e = Math.exp(-w * dt), j = (s.v + w * d) * dt;
  s.x = target + (d + j) * e;
  s.v = (s.v - w * j) * e;
};
const _o = new THREE.Vector3(), _d = new THREE.Vector3();

// 第一人称角色：Quake 式加速/摩擦，圆柱体对关卡碰撞体，可上台阶、跳箱子、下蹲、滑铲、左右探头
export class Player {
  constructor(camera, phys, input) {
    this.camera = camera;
    this.phys = phys;
    this.input = input;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.sensitivity = 0.0021;
    this.adsScale = 0.55; // 开镜时的灵敏度倍率
    this.baseFov = BASE_FOV;
    this.motion = 1; // 动态效果：减弱档 0.3，乘在冲刺、滑铲、喷气的视野拉伸和喷气滚转上
    this.lastHit = null; // 最后一次挨打：{ kind, dist }，阵亡结算写死因
    this.health = 100;
    this.alive = true;
    this.invulnerable = false; // 调试用
    this.grounded = true;
    this.crouch = 0;
    this.crouchLatch = false; // C 切换出来的下蹲；Ctrl 是按住
    this.sprinting = false;
    this.sprintMode = 'toggle'; // 'toggle' 按一下 Shift 切换，'hold' 按住
    this.sprintLatch = false;
    this.sprintBlock = false; // 武器要开火、开镜、检视，这一帧不许冲刺（weapons.js 每帧写）
    this.noFwdT = 0;
    this.jumpBuf = 0; // 跳跃键的缓冲：落地前一瞬间按下也算
    this.groundT = 1; // 落地多久了
    this.landSpeed = 0; // 落地那一刻的水平速度
    this.radius = RADIUS;
    // 滑铲和探头：sliding 是开关，slide / lean 是平滑后的程度（lean：-1 左，+1 右），给视图模型和敌人读
    this.sliding = false;
    this.slide = 0;
    this.slideT = 0;
    this.slideCool = 0;
    this.lean = 0;
    this.leanX = 0;
    // 喷气：dashing 是开关，dash 是平滑后的程度，dashF / dashS 是相对视线的方向（前、右为正），dashX / dashZ 是世界方向，dashCool 是剩余冷却
    this.dashing = false;
    this.dash = 0;
    this.dashT = 0;
    this.dashCool = 0;
    this.hangT = 0;
    this.dashF = this.dashS = this.dashX = this.dashZ = 0;
    // 武器系统写入：移速倍率、开镜程度、后坐力造成的视角偏移
    this.speedScale = 1;
    this.ads = 0;
    this.canSprint = true;
    this.kick = { pitch: 0, yaw: 0 };
    // 给视图模型读：步态相位、移动强度、本帧视角变化、落地冲击
    this.stride = 0;
    this.moveAmount = 0;
    this.look = { dx: 0, dy: 0 };
    this.landImpulse = 0;
    this.surface = 'asphalt';
    this.stepSmooth = 0;
    this.land = { x: 0, v: 0 };  // 落地下沉（米，负值往下）
    this.landP = { x: 0, v: 0 }; // 落地低头（弧度）
    this.roll = 0;
    this.rollS = { x: 0, v: 0 };
    this.rollD = { x: 0, v: 0 }; // 喷气那一项的侧倾
    this.lastDamage = -10;
    this.time = 0;
    this.deathT = 0;
    this.onStep = null;
    this.onJump = null;
    this.onLand = null;
    this.onSlide = null;
    this.onDash = null;
    this.onDamage = null;
    this.onDeath = null;
    // 拟音用：下蹲（true 蹲下）、开始探头（-1 左 / 1 右）、滑铲自然结束、开始回血（参数是当时的血量）
    this.onCrouch = this.onLean = this.onSlideEnd = this.onRegen = null;
    this.crouchPrev = 0;
    this.leanPrev = 0;
    this.regenning = false;
    this._prev = new THREE.Vector3();
  }

  // 当前碰撞体高度（脚底到头顶）
  get height() { return HEIGHT + (CROUCH_HEIGHT - HEIGHT) * this.crouch; }

  respawn(spawn) {
    this.position.set(spawn.x, spawn.y || 0, spawn.z);
    this.velocity.set(0, 0, 0);
    this.yaw = spawn.yaw || 0;
    this.pitch = 0;
    this.health = 100;
    this.alive = true;
    this.grounded = true;
    this.crouch = 0;
    this.deathT = 0;
    this.sliding = this.dashing = this.crouchLatch = this.sprintLatch = this.sprintBlock = false;
    this.slide = this.lean = this.leanX = this.dash = this.dashCool = this.hangT = this.jumpBuf = 0;
    this.land.x = this.land.v = this.landP.x = this.landP.v = 0;
    this.roll = this.rollS.x = this.rollS.v = this.rollD.x = this.rollD.v = 0;
    this.groundT = 1;
    this.crouchPrev = this.leanPrev = 0;
    this.regenning = false;
    this.kick.pitch = this.kick.yaw = 0;
    this.lastHit = null;
    // 视野直接设到位：不从菜单镜头的 46 度拉过来
    this.ads = 0;
    this.sprinting = false;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.apply(0);
  }

  // kind：'soldier' 或 'drone'（敌人传进来，阵亡结算写死因），没传就不记
  takeDamage(amount, from, kind) {
    if (!this.alive || this.invulnerable) return;
    this.health = Math.max(0, this.health - amount);
    this.lastDamage = this.time;
    let angle = 0, dist = NaN;
    if (from) {
      const dx = from.x - this.position.x, dz = from.z - this.position.z;
      // 相对视线的方位，0 = 正前，顺时针为正
      angle = Math.atan2(dx, -dz) + this.yaw;
      dist = Math.hypot(dx, dz);
    }
    this.lastHit = kind ? { kind, dist } : null;
    this.onDamage?.(angle, amount, from);
    if (this.health <= 0) {
      this.alive = false;
      this.onDeath?.();
    }
  }

  update(dt) {
    this.time += dt;
    const inp = this.input, v = this.velocity;
    if (!this.alive) {
      this.deathT = Math.min(1, this.deathT + dt * 1.6);
      v.x *= Math.exp(-6 * dt);
      v.z *= Math.exp(-6 * dt);
      this.look.dx = this.look.dy = 0;
      this.moveAmount = 0;
      this.sliding = this.dashing = this.crouchLatch = this.sprintLatch = false;
      this.slide = damp(this.slide, 0, 10, dt);
      this.dash = damp(this.dash, 0, 10, dt);
      this.lean = damp(this.lean, 0, 6, dt);
      this.leanX = this.lean * LEAN_X;
      this.integrate(dt, false);
      this.apply(dt);
      return;
    }
    const regen = this.time - this.lastDamage > REGEN_DELAY && this.health < 100;
    if (regen && !this.regenning) this.onRegen?.(this.health);
    this.regenning = regen;
    if (regen) this.health = Math.min(100, this.health + REGEN_RATE * dt);

    const active = inp.active;
    this.look.dx = active ? inp.dx : 0;
    this.look.dy = active ? inp.dy : 0;
    const sens = this.sensitivity * (1 + (this.adsScale - 1) * this.ads);
    this.yaw -= this.look.dx * sens;
    this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch - this.look.dy * sens));

    const f = active ? inp.axis('KeyS', 'KeyW') : 0, s = active ? inp.axis('KeyA', 'KeyD') : 0;
    // 下蹲：C 切换，Ctrl 按住。Ctrl+W 只有全屏锁了键盘才不会关掉页面（见 input.js）
    const crouchHold = active && (inp.down('ControlLeft') || inp.down('ControlRight'));
    const crouchHit = active && (inp.pressed('KeyC') || inp.pressed('ControlLeft') || inp.pressed('ControlRight'));
    this.slideCool -= dt;
    this.dashCool -= dt;
    this.hangT -= dt;
    this.jumpBuf -= dt;
    this.groundT += dt;
    if (active && inp.pressed('Space')) this.jumpBuf = JUMP_BUFFER;
    if (active && this.dashCool <= 0 && (inp.pressed('KeyV') || inp.pressed('Mouse4'))) this.startDash(f, s);
    if (crouchHit && this.sprinting && this.grounded && this.slideCool <= 0) {
      const sp = Math.hypot(v.x, v.z) || 1, k = Math.max(sp, SLIDE_SPEED) / sp;
      v.x *= k; v.z *= k;
      this.sliding = true;
      this.slideT = 0;
      this.crouchLatch = false;
      this.onSlide?.(this.surface);
    } else if (active && inp.pressed('KeyC')) {
      this.crouchLatch = !this.crouchLatch;
    }
    // 冲刺的意图。切换式：再按一次、停下不往前走、蹲下都会退出；滑铲、喷气和腾空期间保留，落地接着跑
    let wantSprint = active && inp.down('ShiftLeft');
    if (this.sprintMode === 'toggle') {
      if (active && inp.pressed('ShiftLeft')) this.sprintLatch = !this.sprintLatch;
      const moving = f > 0 || this.sliding || this.dashing || !this.grounded;
      this.noFwdT = moving ? 0 : this.noFwdT + dt;
      if (this.noFwdT > SPRINT_DROP || this.crouchLatch || (crouchHold && !this.sliding)) this.sprintLatch = false;
      wantSprint = this.sprintLatch;
    }
    // 想跑就先站起来
    if (wantSprint && f > 0) this.crouchLatch = false;
    const wantCrouch = crouchHold || this.crouchLatch;
    const wasSliding = this.sliding;
    if (this.sliding) {
      this.slideT += dt;
      if (this.slideT > SLIDE_TIME || Math.hypot(v.x, v.z) < SLIDE_END || (!this.grounded && this.slideT > 0.15)) {
        this.sliding = false;
        this.slideCool = SLIDE_COOLDOWN;
        if (this.grounded) this.onSlideEnd?.(); // 冲出台面那一支在空中，落地另有落地声
      }
    }
    this.slide = damp(this.slide, this.sliding ? 1 : 0, this.sliding ? 14 : 8, dt);
    const du = Math.min(1, this.dashT / DASH_TIME);
    this.dash = damp(this.dash, this.dashing ? Math.min(1, DASH_EASE * (1 - du * du)) : 0, this.dashing ? 30 : DASH_FADE, dt);
    const headroom = this.phys.ceilingHeight(this.position.x, this.position.z, RADIUS * 0.8, this.position.y + CROUCH_HEIGHT) - this.position.y;
    const crouchTarget = wantCrouch || this.sliding || headroom < HEIGHT ? 1 : 0;
    // 滑铲起止那一帧的蹲起已经有滑铲自己的声音，不再叠一下
    if (crouchTarget !== this.crouchPrev) {
      if (!this.sliding && !wasSliding && this.grounded) this.onCrouch?.(crouchTarget === 1);
      this.crouchPrev = crouchTarget;
    }
    this.crouch = damp(this.crouch, crouchTarget, this.sliding ? 18 : 12, dt);
    this.sprinting = active && wantSprint && f > 0 && this.crouch < 0.3 && this.ads < 0.3 && this.canSprint && this.grounded && !this.dashing && !this.sprintBlock;
    const leanWant = active && !this.sprinting && !this.sliding && !this.dashing ? inp.axis('KeyQ', 'KeyE') : 0;
    if (leanWant !== this.leanPrev) {
      if (leanWant) this.onLean?.(leanWant);
      this.leanPrev = leanWant;
    }
    this.lean = damp(this.lean, leanWant, 11, dt);

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // 喷气方向相对视线的分量跟着当前视角走：喷的途中、喷完转了身，模糊和速度线的方向跟着转
    if (this.dash > 1e-3) {
      this.dashF = -sy * this.dashX - cy * this.dashZ;
      this.dashS = cy * this.dashX - sy * this.dashZ;
    }
    let wx = -sy * f + cy * s, wz = -cy * f - sy * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-5) { wx /= wl; wz /= wl; }
    let wish = this.sprinting ? SPRINT : WALK;
    wish = wish * (1 - this.crouch) + CROUCH_SPEED * this.crouch;
    wish *= this.speedScale * (1 - (1 - ADS_SPEED) * this.ads);
    if (wl < 1e-5) wish = 0;

    if (this.dashing) {
      // 喷气中速度锁在喷气方向上，不吃摩擦、输入和重力；结束时留一截余速
      this.dashT += dt;
      const u = Math.min(1, this.dashT / DASH_TIME), sp = DASH_EXIT + (DASH_PEAK - DASH_EXIT) * (1 - u * u);
      v.x = this.dashX * sp;
      v.z = this.dashZ * sp;
      if (u >= 1) this.dashing = false;
    } else if (this.sliding && this.grounded) {
      // 滑铲中不吃移动输入，只有地面摩擦；跳可以打断
      const sp = Math.hypot(v.x, v.z);
      if (sp > 1e-4) {
        const k = Math.max(sp - SLIDE_FRICTION * dt, 0) / sp;
        v.x *= k; v.z *= k;
      }
      if (this.jumpBuf > 0 && headroom >= HEIGHT) {
        this.sliding = false;
        this.slideCool = SLIDE_COOLDOWN;
        this.jump();
      }
    } else if (this.grounded) {
      // 切换下蹲时按跳：先站起来，站到一半以上才起跳（跳跃键有缓冲，按一下就够）
      if (this.jumpBuf > 0 && this.crouchLatch && headroom >= HEIGHT) this.crouchLatch = false;
      const hop = this.jumpBuf > 0 && this.crouch < 0.5 && this.groundT < HOP_WINDOW;
      const sp = Math.hypot(v.x, v.z);
      if (hop) {
        // 连跳：跳过这一帧的摩擦，速度封顶在落地速度的 HOP_KEEP
        const cap = Math.max(this.landSpeed * HOP_KEEP, HOP_FLOOR);
        if (sp > cap && sp > 1e-4) { v.x *= cap / sp; v.z *= cap / sp; }
      } else {
        if (sp > 1e-4) {
          const k = Math.max(sp - Math.max(sp, 1.6) * 9 * dt, 0) / sp;
          v.x *= k; v.z *= k;
        }
        this.accelerate(wx, wz, wish, 11, dt);
      }
      if (this.jumpBuf > 0 && this.crouch < 0.5) this.jump();
    } else {
      this.accelerate(wx, wz, Math.min(wish, 1.4), 9, dt);
    }
    this.integrate(dt, true);

    const speed = Math.hypot(v.x, v.z);
    this.moveAmount = damp(this.moveAmount, this.grounded && !this.dashing ? Math.min(speed / WALK, 1.5) : 0, 10, dt);
    if (this.grounded && speed > 0.6 && !this.sliding && !this.dashing) {
      const before = Math.floor(this.stride);
      // 一步的长度：冲刺 1.9 米（每秒约 3.3 步），走 1.45 米，蹲走 1 米。再短步频就碎，镜头和枪跟着抖
      this.stride += (speed * dt) / (this.sprinting ? 1.9 : 1.45 - 0.45 * this.crouch);
      if (Math.floor(this.stride) !== before) this.onStep?.(this.surface, speed / SPRINT);
    }
    // 侧移滚转：横移速度按冲刺速度封顶（喷气的横移快得多，那一下的侧倾只由 dashS 那一项给），二阶跟随
    const lateral = Math.max(-SPRINT, Math.min(SPRINT, v.x * cy - v.z * sy));
    follow(this.rollS, -lateral * 0.0045, ROLL_W, dt);
    follow(this.rollD, -this.dashS * 0.06 * this.dash * this.motion, ROLL_DASH_W, dt);
    this.roll = this.rollS.x + this.rollD.x;
    this.leanX = this.leanOffset(cy, sy);
    this.apply(dt);
  }

  // 起跳：水平速度从走到冲刺之间，跳得从 JUMP 到 JUMP_RUN
  jump() {
    const v = this.velocity, k = Math.min(1, Math.max(0, (Math.hypot(v.x, v.z) - WALK) / (SPRINT - WALK)));
    v.y = JUMP + (JUMP_RUN - JUMP) * k;
    this.grounded = false;
    this.jumpBuf = 0;
    this.onJump?.();
  }

  // 武器开火、开镜时调用：这一帧就退出冲刺，切换式顺手关掉开关。按住式之后几帧由 sprintBlock 挡着
  cancelSprint() {
    if (this.sprintMode === 'toggle') this.sprintLatch = false;
    this.sprinting = false;
  }

  // f / s 是当前的前后、左右输入：八个方向里取一个，没有输入就朝正前
  startDash(f, s) {
    if (!f && !s) f = 1;
    const l = Math.hypot(f, s), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.dashF = f / l;
    this.dashS = s / l;
    this.dashX = -sy * this.dashF + cy * this.dashS;
    this.dashZ = -cy * this.dashF - sy * this.dashS;
    this.dashing = true;
    this.dashT = 0;
    this.dashCool = DASH_COOLDOWN;
    this.hangT = DASH_TIME + DASH_HANG;
    this.sliding = false;
    this.onDash?.(this.dashF, this.dashS);
  }

  // 探头的横移量（米）：头往侧面探之前先看那边有没有墙，贴墙时探不出去
  leanOffset(cy, sy) {
    const want = this.lean * LEAN_X;
    if (Math.abs(want) < 1e-3) return 0;
    const sign = Math.sign(want), eyeH = EYE + (CROUCH_EYE - EYE) * this.crouch;
    _o.set(this.position.x, this.position.y + eyeH, this.position.z);
    _d.set(cy * sign, 0, -sy * sign);
    const hit = this.phys.raycast(_o, _d, Math.abs(want) + HEAD_R);
    return hit ? sign * Math.max(0, Math.min(Math.abs(want), hit.dist - HEAD_R)) : want;
  }

  accelerate(wx, wz, wish, accel, dt) {
    const v = this.velocity;
    const add = wish - (v.x * wx + v.z * wz);
    if (add <= 0) return;
    const a = Math.min(accel * wish * dt, add);
    v.x += wx * a;
    v.z += wz * a;
  }

  integrate(dt, collide) {
    const p = this.position, v = this.velocity, phys = this.phys;
    const height = this.height;
    // 喷气托着人：不下坠，上升的势头慢慢收掉；喷完还飘一小会儿（只在下落时减重力，不给起跳加高度）
    if (this.dashing) v.y = Math.max(v.y, 0) * Math.exp(-7 * dt);
    else v.y -= GRAVITY * (this.hangT > 0 && v.y <= 0 ? HANG_GRAVITY : 1) * dt;
    const ceil = phys.ceilingHeight(p.x, p.z, RADIUS * 0.8, p.y + height);
    if (v.y > 0 && p.y + height + v.y * dt > ceil) v.y = 0;
    const steps = Math.max(1, Math.ceil((Math.hypot(v.x, v.z) * dt) / 0.12));
    const h = dt / steps;
    this._prev.copy(p);
    for (let i = 0; i < steps; i++) {
      p.x += v.x * h;
      p.z += v.z * h;
      if (collide) phys.resolve(p, RADIUS, p.y, p.y + height, this.grounded ? STEP : 0.12);
    }
    if (collide && dt > 0) {
      // 贴墙滑动：速度取碰撞修正后的实际位移
      v.x = (p.x - this._prev.x) / dt;
      v.z = (p.z - this._prev.z) / dt;
    }
    // 落得快的时候一帧能掉过一层楼板：台面按这一帧起点的脚底高度找，中间穿过的也算落上去了
    const fromY = p.y;
    p.y += v.y * dt;
    const g = phys.groundHeight(p.x, p.z, RADIUS * 0.75, Math.max(p.y, fromY), this.grounded ? STEP : 0.05);
    if (p.y <= g + 1e-3 && v.y <= 0) {
      if (!this.grounded) {
        const impact = -v.y;
        this.groundT = 0;
        this.landSpeed = Math.hypot(v.x, v.z);
        // 给下沉和低头一个向下的初速度，峰值 = 初速度 / (LAND_W·e)
        const dip = Math.min(LAND_DIP_MAX, Math.max(0, impact * 0.0057 - 0.0164));
        const u = Math.min(1, Math.max(0, (impact - 8) / 6.3)), nod = LAND_PITCH * u * u * (3 - 2 * u);
        this.land.v -= dip * LAND_W * Math.E;
        this.landP.v -= nod * LAND_W * Math.E;
        this.landImpulse = Math.min(1, impact / 9);
        this.surface = phys.groundSurface; // 落地声要按落上去的这块地面，不是起跳前那块
        this.onLand?.(impact);
      } else if (g > fromY + 1e-3) {
        // 走上台阶，镜头平滑跟上去。跟这一帧起点的脚底比：站着时重力那一小段下坠不算台阶，
        // 不然每帧都记一点，站着的眼高比空中低一两厘米（帧率越低越多），落地时还会慢慢再沉一截
        this.stepSmooth -= g - fromY;
      }
      p.y = g;
      v.y = 0;
      this.grounded = true;
      this.surface = phys.groundSurface;
    } else if (this.grounded && v.y <= 0 && p.y - g <= STEP) {
      this.stepSmooth += fromY - g;
      p.y = g;
      v.y = 0;
      this.surface = phys.groundSurface;
    } else {
      this.grounded = false;
    }
  }

  apply(dt) {
    const cam = this.camera;
    this.stepSmooth = damp(this.stepSmooth, 0, 14, dt);
    follow(this.land, 0, LAND_W, dt);
    follow(this.landP, 0, LAND_W, dt);
    this.landImpulse = damp(this.landImpulse, 0, 7, dt);
    const eyeH = EYE + (CROUCH_EYE - EYE) * this.crouch + (SLIDE_EYE - CROUCH_EYE) * this.slide;
    const amp = (this.sprinting ? 0.034 : 0.014) * Math.min(this.moveAmount, 1.3) * (1 - 0.7 * this.ads) * (1 - this.slide);
    const bobY = -Math.abs(Math.sin(Math.PI * this.stride)) * amp;
    const bobX = Math.sin(Math.PI * this.stride) * amp * 0.6;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const leanK = this.leanX / LEAN_X, lx = bobX + this.leanX;
    let y = this.position.y + eyeH + bobY + this.stepSmooth + this.land.x - LEAN_DROP * Math.abs(leanK) - 0.03 * this.dash;
    // 喷气：往喷的那一侧压一点（在 roll 里），再叠一层很细的抖动。只动滚转，准心指的地方不变
    let roll = this.roll - leanK * LEAN_ROLL + this.slide * 0.025 - Math.sin(this.time * 88) * 0.004 * this.dash * this.motion;
    // 落地低头回正后为 0，准心指的地方不变；开镜时只留两成
    let pitch = this.pitch + this.kick.pitch + this.landP.x * (1 - 0.8 * this.ads);
    if (!this.alive) {
      const t = this.deathT * this.deathT * (3 - 2 * this.deathT);
      y = this.position.y + eyeH * (1 - t) + 0.28 * t;
      roll += t * 1.15;
      pitch = pitch * (1 - t) + 0.1 * t;
    }
    cam.position.set(this.position.x + cy * lx, y, this.position.z - sy * lx);
    cam.rotation.set(pitch, this.yaw + this.kick.yaw, roll, 'YXZ');
    const fov = this.baseFov * (1 - 0.26 * this.ads) + ((this.sprinting ? 3 : 0) + (6 * this.slide + DASH_FOV * this.dash) * (1 - this.ads)) * this.motion;
    if (Math.abs(cam.fov - fov) > 0.01) {
      const back = this.dash > 0.01 && fov < cam.fov; // 喷气的视野正在往回收
      cam.fov = damp(cam.fov, fov, back ? DASH_FOV_BACK : this.dashing ? 24 : 14, dt || 0.016);
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    this.eye.copy(cam.position);
  }
}
