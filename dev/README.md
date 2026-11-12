# dev 预览页

模型和特效单独看效果用，不进游戏。开发服务器跑着时打开 `http://localhost:5183/dev/<名字>.html`。

每个预览页是一对文件：`dev/<名字>.html` 引入 `dev/<名字>.js`，后者调用 `startHarness(setup)`：

```js
import { startHarness } from './harness.js';
startHarness(async ({ THREE, scene, mats, gear, view }) => {
  // mats：场景材质（Materials 实例）；gear：武器材质（未加第一人称补丁）
  // scene.add(...)
  view(30, 15, 1.2); // 偏航、俯仰（度）、距离（米）、目标点 xyz
});
```

控制台里 `__h.view(yaw, pitch, dist, tx, ty, tz)` 换视角，`__h.onFrame = (dt, t) => {}` 做动画。 标签页在后台时 rAF 不跑，用 `__h.frame(n, dt)` 手动推进再截图。

## 游戏页的调试接口

不带热更新的服务在 5184 端口（`.claude/launch.json` 的 `game-nohmr`），改完文件手动刷新。控制台里用 `__dbg`：

- `play()` 不要指针锁定直接开局，`god(true)` 无敌，`view(x, z, 偏航度, 俯仰度, y)` 传送并摆视角（偏航 0 朝北即 -Z，正值左转）。
- `frame(n, dt)` 同步跑 n 帧（更新加渲染），后台标签页里截图前先调它。`freeze(true)` 加 `step(秒)` 冻结后逐帧推进。
- 冻结时 `frame()` 只渲染不更新，相机也不跟：`view()` 之后先 `step(1/60)` 让相机跟到新机位，再 `frame(4)`，等 300 毫秒再截图。`step` 会让敌人也走一小步。隐藏第一人称武器用 `__dbg.camera.children[0].visible = false`。
- `walkTo(x, z, 秒)` 对准目标按住 W 自动走过去，返回 `{ reached, t, pos }`，验收门洞和楼梯用。
- `bench(n)` 连跑 n 帧，返回每帧毫秒数、draw call 和三角形数。
- `input.press(code)` / `input.release(code)` 模拟按键，`game`、`player`、`level`、`scene`、`camera`、`pipeline`、`mats`、`audio`、`hud` 直接可用。

## 分区模块

堆场以外的区域各是一个模块：`src/world/zones/<名>.js` 导出 `build(ctx)`，`level.js` 建完堆场后依次调用，某个模块抛错只会少掉那一块。总平面、标高、门洞、哪道墙归谁建都在 `src/world/plan.js`。

`ctx` 里有：

- `batch`：`batch.add(material, geometry, matrix, { tile })`，同材质的几何体最后合并成一个网格，所以材质实例要共用。`tile` 是一张贴图覆盖的米数（混凝土 3，涂装金属 5.2，镀锌件 1.2），不传就保留几何体自带的 UV。
- `decals` 和 `atlas`：喷字、标牌。`atlas.add(w, h, draw)` 或 `atlas.cached(key, w, h, draw)` 返回 UV 矩形，配 `labels.js` 的 `decalQuad` 贴到墙上。
- `phys`：`addBox(cx, cy, cz, hx, hy, hz, yaw, surface)`、`addCyl(x, z, r, y0, y1, surface)`。返回值上设 `playerOnly = true` 就只挡人不挡子弹。没有斜面，上下楼全靠台阶。
- `mats`：共享材质（`concrete`、`galv`、`steelDark`、`rubber`、`glass`，室内版 `concreteIn`、`concreteInDark`、`woodIn`、`galvIn`、`steelIn`），`mats.paint(color, { wear, dirt, rough, wet, indoor })` 涂装金属，`mats.pbr(set, { color, rough, metal, wet, indoor })`，`mats.emissive(color, intensity)` 发光体。自己的贴图用 `mats.set(name, glsl, opts)`（配方写法见 `src/gfx/recipes_world.js`），自己的材质用 `mats.one(key, make)`，都按名字缓存。
- `rand`：带种子的随机数。`scene`：只给必须单独成网格的东西用。

墙、楼板、楼梯、坡道、栏杆用 `src/world/build.js`：`wallX`、`wallZ`（带门洞、窗洞、玻璃和门框）、`slab`（带楼梯口）、`stairs`、`ramp`、`railing`，一次调用同时出几何体和碰撞体。

`build` 返回 `{ lights, spawns, paint, update }`：

- `lights`：`[{ pos: [x, y, z], aim: [x, y, z], color, intensity, distance, angle, penumbra, fog }]`。都是不投影的聚光灯，每个分区的上限在 `plan.js` 的 `LIGHT_BUDGET`。不投影的灯会穿墙穿楼板，靠 `distance` 收住。`fog` 大于 0 的灯会在体积雾里出光柱。
- `spawns`：`[{ x, y, z }]`，敌人出生点（脚底位置）。
- `paint(ctx2d, toPx, ppm)`：往室外地面（y = 0 的湿沥青）上画标线和喷字，`toPx(x, z)` 把世界坐标换成画布像素。
- `update(dt, time, lights)`：每帧调用，`lights` 是这个分区的灯（顺序同上），只许改亮度做闪烁，不许增删。

地面材质名（脚步声和弹着点效果按它分）：`asphalt`、`concrete`、`metal`、`wood`、`carpet`、`gravel`、`glass`。

## 玩法模块的接口（2026-11-12 新增）

- 玩法：`game.mode` 是 `waves` 或 `range`（练习场，没有敌人、只有靶子、弹药不限）。菜单发 `hud.emit('start', mode)`，调试用 `__dbg.play('range')`。
- 设置：`src/game/settings.js` 的 `SETTING_DEFS` 和 `Settings`（`get / set / onChange`，存 localStorage）。界面用 `hud.bindSettings(settings)` 拿到它，调试用 `__dbg.settings`。
- HUD 新增（游戏都用可选链调用）：`hud.kill({ kind, headshot, points, dist })`、`hud.setAbility('dash' | 'smoke', ready01)`、`hud.setRange({ shots, hits, kills, headshots })`、`hud.setMode(mode)`。
- 喷气：V 或 `Mouse4`。`player.dashing / dash / dashF / dashS / dashX / dashZ / dashCool`，回调 `player.onDash`。0.32 秒、约 6.4 米，结束后 0.25 秒内下落只吃三成重力。画面效果在 `post_final.js`（`uDash`、`uDashDir`）。
- 下蹲和冲刺：`player.crouchLatch`（C 切换）、Ctrl 按住；`player.sprintMode`（`'toggle'` 或 `'hold'`，设置项 `sprintMode`）、`player.sprintLatch`、`player.cancelSprint()`（步枪开火和开镜时由 `weapons.js` 调用，两种模式都把这一帧的 `sprinting` 置 false）。
- 跳：`JUMP` 6.4（原地，脚底到 1.2 米）到 `JUMP_RUN` 7.05（冲刺或滑铲的速度，1.46 米）；跳跃键有 0.12 秒缓冲；落地后 0.25 秒内再跳，水平速度封顶在落地速度的九成。落地按这一帧起点的高度找台面，低帧率也不会穿楼板。
- 副手投掷：`weapons.throwOffhand(onRelease)`，武器实现 `offhandThrow()` 返回 `{ release, total }`（秒）或 `null`（左手腾不出来）；没实现的武器 0.1 秒后直接出手。G 键被拒时保留 1 秒重试。步枪的动作在 `rifle_act_throw.js`（轨迹写在相机坐标里）；持刀时 `knife_throw.js` 给同一套动作配一只平时在画面外的左手。
- 步枪的 `offhandThrow()`：正在收枪、已经在扔时返回 `null`；换弹到弹匣离枪前 0.1 秒以后返回 `null`（战术换弹 0.42 秒，空仓换弹 0.28 秒，按 `CUES` 的第一个节点算），更早则取消换弹再扔。扔的过程中 `rifle.throwing` 为真，不能开火和开镜，已开镜的会退回、扔完恢复。
- 检视：`~` 键，步枪 2.5 秒（`rifle.inspectT`，-1 = 没在检视；`startInspect()` / `stopInspect()`），开火、开镜、换弹、扔雷、切枪、冲刺、喷气都会打断（切换式冲刺中按 `~` 会先退出冲刺）；爪刀是 `MOVES.inspect`。
- 激光点：`rifle.laser`（`rifle_act_laser.js`），字段 `opacity`、`dist`（米）、`offLine`（枪口偏离归零线的角度，度），`hide()` 立刻关掉。腰射才画，开镜、收枪、喷气、左手离枪时淡掉；网格在 `fxScene`，名字 `rifle.laserDot`。
- 瞄具的布局都在 `rifle_optics.js`：`EYE_RELIEF`（开镜眼距，决定镜片在画面里多大）、`OPTIC`（两层增高架的高度、镜片和立柱的尺寸）。改完在 `dev/rifle.html` 里跑 `__measure()` 和 `__transit()` 看取景和枪托有没有入画。
- 切枪（`src/weapons/weapons.js`）：各武器实现 `unequip()`（返回从当前姿态收到底要多久）、`cancelUnequip(min)`（从收到一半的位置举回来，`min` 是至少要沉到的程度，0 到 1）、`equip({ instant })`（不播举枪动作）。`env.state.tuck` 是喷气时枪收在身前的程度。喷气途中切枪瞬间完成，并解除喷气后的收枪硬直。
- 摇枪：1、3、1 连按得再快（同一帧里按完也算），枪也至少沉下去全程的 11% 再回来（`weapons.js` 的 `WIGGLE_MIN`，`anim.js` 的 `dipKick` 给下沉补一个初速度）；这一小段下沉不挡开火。同一帧里的切枪键按 `input.seq`（本帧按下的键，按先后排）依次处理，`input.hit` 是集合，不分先后。左手的烟雾弹还没出手时按切枪键会先排队（`weapons.queued`），出手后再切。
- 命中标记：准星上只有四道斜线围成的空心 X，命中白色、击倒黄色，出现时从外面向中心收 `--hit-in`。尺寸在 `tokens.css` 的 `--hit-len`、`--hit-gap`、`--hit-w`。击倒时准星上没有别的框，分数在准星下方的加分条（`hud_kill.js`）。
- HUD 的备弹在练习场固定显示 ∞（`hud.js` 的 `setAmmo` 按 mode 决定，调用方传什么数都一样）；`hud.kill` 的 `bonus` 是爆头加分（含波次倍率），不传时 HUD 按 `points` 反推。
- `tokens.css` 由页面用 `<link>` 在 `hud.css` 前面引入（`index.html`、`dev/hud.html`），`hud.css` 里不再 `@import`。罗盘、波次、得分和练习场统计共用一层暗底 `--hud-scrim`，朝天看时压在亮云上也读得清。
- 靶场：`src/enemies/targets.js` 的 `TargetRange`（`kind = 'target'`，`setActive / reset / update / raycast / hit / stats / onKill`）。
- 烟雾弹：G。`src/game/smoke.js` 的 `SmokeGrenades`（`ready`、`throw(camera, player)`、`update`、`clear`）。烟团登记在 `phys.smokes`（`{ x, y, z, r }`），`phys.blocked()` 的视线会被它挡住，子弹和人不受影响。
- 时段：`src/world/timeofday.js` 的 `TimeOfDay`（`names`、`set(name)`、`exposure`、`rain`、`ambient`），`level.setTime(name)`，调试用 `__dbg.tod`。
- 新音效名：`weaponSwitch`、`dash`、`smokeThrow`、`smokeBounce`、`smokeBurst`、`targetHit`、`targetDown`、`killHeadshot`。新特效：`fx.smokeCloud(point, { radius, life })`、`fx.dashJet(position, dirX, dirZ, grounded)`。
- 省内存档：5184 端口、后台标签页或地址带 `?lite` 启动时，贴图和阴影图边长减半、画质从「低」起步（不下雨、不画海面和倒影），`__dbg.lite` 为 true。地址带 `?full` 强制完整画面；`__dbg.game.setQuality('high')` 只恢复画质，贴图仍是减半的。
- 敌人调试：`game.soldiers.debugInfo()` 返回存活数、状态分布、开火人数、`updateMs` 和寻路网格统计；地址带 `?standin` 强制用胶囊小人，用来区分是 AI 还是模型的问题；`dev/soldiers.html` 是寻路网格俯视图，控制台有 `__nav.path / floor / rebuild`。
- 敌方识别色：无人机和武装人员共用一套橙色。无人机是橙色装甲板加机腹、侧甲、机臂下的灯条（`drone_model.js` 的 `HOSTILE`）；武装人员是橙色的前后插板、袖标、头盔（软帽）一圈识别带、胸前识别板，加上肩带、胸前、后背、上臂外侧的小灯条（配色在 `soldier_mesh.js` 的 `mark`、`markHard`、`plate`、`light`）。识别色带一点自发光打底，背光和夜里也认得出；`soldier_mat.js` 的 `soldierGlow` 是自发光总开关，尸体那套材质恒为 0。
- 无人机的受击体是压扁的椭球，比外形大 15%（`drones.js` 的 `HIT_SCALE`）。`DroneManager.warmup()` 和士兵的做法一样：启动时把池底的一架放到地下画几遍，第一波不再现编着色器。
- 敌人轮廓光：`soldier_mat.js` 导出 `soldierRim`（夜晚 4、下午 0.05、白天 0，由 `TimeOfDay.apply` 按预设的 `rim` 字段写入）。颜色取半球补光的天空色，菲涅尔六次方，用没叠法线贴图的法线。`createSoldierMaterials` 返回 `{ soft, hard, dead: { soft, hard } }`；`attachSoldierMesh` 的返回值有 `setDead(on)`，`SoldierRig.die()` 换尸体材质，`reset()` 换回，两套材质共用着色器程序。
- `SoldierManager.warmup()`：身体建好后自动调用，把 0 号身体放到地下画几遍预编着色器，第一波刷人不再现编。`soldier_ai.js` 的 `TWIST`（0.9 弧度）：瞄准方向和身体朝向差得比它多时全身跟转，开火判定也用它。`SOLDIER.crouchEye` 是 1.1。
- 后处理：最后一遍（`post_final.js`）也拿主场景深度 `tDepth`，`onWorld(uv)` 返回 1 是世界、0 是第一人称武器。喷气的模糊、速度线和加强色差只作用在世界像素上。最后一遍共 4 个采样器。
- 视图模型：喷气的位移、转角和侧移倾斜用 `knife_anim.js` 的 `follow` 做临界阻尼跟随。验收时逐帧看 `__dbg.game.weapons.vm.root.position` 的变化量，喷气第一帧不应明显大于后几帧。
- 物理：`phys.blocked(a, b)` 和 `phys.rayDist(o, d, max)` 不分配内存，每帧多次调用的视线判定用它们；`phys.raycast` 会新建命中点和法线。
- 步枪预览页 `dev/rifle.html`：`__ads(fov = 55)` 把相机放到开镜眼位，`__arms(on)` 挂上双手，`__reload(t, empty)` 把手和弹匣摆到换弹第 t 秒。

## 照片贴图

- `src/gfx/photo_tex.js` 在 `mats.build()` 里加载 `public/assets/tex/polyhaven` 的图并烘成游戏用的贴图，`__dbg.mats.photo` 为 true 表示用上了。地址带 `?nophoto` 跳过照片、全部用程序化贴图（前后对比用），可以和 `?full`、`?lite` 一起写。加载失败只 `console.warn` 一次（`[photo]` 开头）并退回程序化。
- 省内存档下照片在解码时缩到 512；`setQuality('high')` 不恢复贴图尺寸，要看 1024 的用 `?full`。
- `mats.tex.asphalt` 带 `tile`（一张图的米数，照片 2.5，程序化按 3）和 `normal`（法线强度），`ground.js` 按它铺。
- `mats.tex.concrete` 用上照片时带 `floor`：凡是 `mats.pbr(mats.tex.concrete, …)` 建的材质，朝上的面自动用地面那套图，其余面用墙面那套；UV 仍按 `tile: 3` 给。
- `mats.paint(color, { photo: false })`：不叠照片细节的涂装金属（默认叠）。细节图是 `mats.tex.paintDetail`。`texgen.free(texture)` 释放生成的贴图和它的渲染目标。
- 采样器现状（上限 16）：地面 13，混凝土 12，涂装金属 11。往这三种材质上加贴图前先数一遍。

## 性能测量

- `bench` 的毫秒数在多个 agent 共用机器时有三成上下的波动：比较改动要在同一个页面里 A、B 交替测，不拿两次启动的数直接比。
- 分遍的 GPU 耗时：后台标签页里用 `EXT_disjoint_timer_query_webgl2` 包住 `pipeline.render` 和 `renderer.shadowMap.render`，分别得到整帧和阴影遍的毫秒数。
- 已量过的占比（高画质，堆场中央）：阴影加合批约一成；地面倒影那一遍（`src/world/ground.js`）占 25% 到 30%，约 227 次 draw call、105 万三角形。
- 阴影调度每帧固定重画 `perFrame` 张阴影图（低 1、高 2、超高 3）。`Lighting.reweigh` 的权重只决定画哪几张，改权重不省性能。
- 性能探针 `dev/perf_probe.js`（游戏页里 `await import('/dev/perf_probe.js?v=' + Date.now())`，用 `?full` 开）：`__perf.stage(5)` 放一波敌人；`__perf.run({ w, h, quality, spot })` 不限帧连跑，返回每帧毫秒数（四个朝向的平均和最差）；`__perf.single(...)` 一帧一帧隔开量，分出 JS 自己的时间和 GPU 进程的时间；`__perf.census(...)` 各遍的 draw call、三角形和 JS 耗时，加场景里的对象、材质、程序数；`__perf.passes(...)` 各遍的 GPU 计时；`__perf.glCalls(...)` 一帧里各种 GL 调用的次数；`__perf.restore()` 回到窗口尺寸。内部分辨率直接设成 `w × h`，和面板多大无关。`spot` 是分区名（取该区第一个出生点）或 `[x, z, y]`。
- 计时查询 `TIME_ELAPSED` 量的是 GPU 进程里两条命令之间的墙上时间：这一遍如果卡在 CPU 提交上，量到的其实是 CPU 时间。判断瓶颈看 `single` 的 js 和 gpu 哪个大，再用 320×180 量一次分出与分辨率无关的部分。
- 2026-11-12 的基线（RTX 3070，2560×1440 输出，堆场中央，7 个武装人员加 3 架无人机，其他 agent 同时在用机器）：低 6.3 毫秒（内部 1587×893）、中 9.6（2048×1152）、高 11.6；高画质仓库里 11.9，办公楼和屋面量到 17 到 19（受干扰，偏大）。高画质一帧约 900 次 draw call、360 万三角形：主场景 256 次、倒影 232 次、阴影重画 402 次。逐项关掉：倒影约占 GPU 4 毫秒、JS 3 到 4 毫秒，阴影重画 GPU 约 2 毫秒，体积雾 1.5，AO 0.6；填充成本约每百万像素 1.6 毫秒，与分辨率无关的部分约 3.4 毫秒。
- 灯光着色器块的两处早退在 `src/gfx/light_loop.js`（模块加载时改 three 的全局着色器块，`materials.js` 引入）：照不到的灯不算 BRDF；照不到的灯不采阴影图（`getShadow` 里的 `texture()` 换成 `textureLod(..., 0.0)`，三目改成 `if`，否则 ANGLE 转出的 HLSL 会把分支摊平、每个像素对每张阴影图都采满 5 次）。画面不变（逐像素最大差 1）。第一处在 3840×2160 只画主通道时 GPU 时间少 12%；第二处的收益还没量。`__perf.lightSkip(false)` 换回 three 原来的两个着色器块做对比。
- 优化开关 `src/engine/perf_flags.js`（`__dbg.perf`）：`merge` 合批、`mirror` 倒影、`shadow` 阴影调度、`submit` 提交开销、`step` 帧率无关，默认全开。这五项优化还没落地（2026-11-12 做到一半按用户要求延后到机器空闲时，改动已全部撤回），目前没有代码读这些开关；落地以后每一项都要受对应的开关控制。网址加 `?perfoff=merge,shadow` 关掉几项，`?perfoff=all` 全关；除 `merge` 外运行中改 `__dbg.perf.mirror = false` 立即生效，可以在同一个页面里 A、B 交替量。
- 定标表 `await __perf.table()`：中、高两档 × 五个机位（堆场中央、仓库、办公楼、楼顶、街道），2560×1440，放第 5 波敌人，四个朝向取平均，返回每行的 js、gpu 毫秒数、draw call 和按两者较大值算的帧率，大约 25 秒。`__perf.census()` 的 draw call 和三角形、`__perf.glCalls()` 的 GL 调用数不受机器负载影响，比较改动优先看它们。
- 逐像素对比 `dev/perf_snap.js`（装在 `__perf` 里）：`await __perf.snap('名字')` 在 13 个固定机位（`__perf.SNAP_POSES`，可以在运行中往里加）× 下午和夜晚各截一张存进 IndexedDB，刷新或换了代码以后 `await __perf.diff('名字')` 逐机位返回 `[最大差, 平均差, 差大于 2 的通道数]`。截图时游戏冻结、清空敌人、藏起武器和粒子层、关掉雨和 TAA、钉住云和闪烁灯的时间并重烤环境探针，内部分辨率 1280×720，连画三帧取最后一帧；同一份代码刷新前后最大差是 1。`__perf.showDiff('night:yardN')` 把上一次 diff 的差值放大贴在画面上，`__perf.dropSnap('名字')` 删掉一套（每套约 96 兆）。截完页面停在冻结状态，要继续量性能就刷新页面。
- 着色开销拆解 `dev/perf_ablate.js`（`const a = await import('/dev/perf_ablate.js?v=' + Date.now())`）：`a.set({ spots: 5 })` 让聚光灯循环只算前 5 盏（带阴影的那 5 盏），`a.set({ noShadow: true })` 不采阴影图，`a.set()` 还原；每次都要重新编译全部受光着色器（十几秒），量完刷新页面。2026-11-12 在 3840×2160、关掉倒影、阴影重画、雾和 AO 时量到（堆场、办公楼、仓库四个机位，其他 agent 同时占着机器，波动一成）：整帧 9 到 11 毫秒，其中 23 盏不带阴影的聚光灯约 2.3 毫秒，5 盏带阴影的聚光灯约 0.8 毫秒，采阴影图约 1 到 1.5 毫秒，剩下 5.7 到 6.2 毫秒是不算聚光灯的着色加后处理。换算到 2560×1440 灯光合计约 2 毫秒。
- 验证阴影没有丢、没有漏光：`__dbg.freeze(true)`，藏起靶子，`Lighting.refreshAllShadows()` 后 `frame(1)`，用 `renderer.properties.get(light.shadow.map.depthTexture).__webglTexture` 拿到深度纹理；临时把 `TEXTURE_COMPARE_MODE` 设成 `NONE`，用全屏三角形读出来，读完恢复成 `COMPARE_REF_TO_TEXTURE` 并调用 `renderer.resetState()`。同一份代码重复读两次差异为 0，改动前后逐字节比。

## 手感（2026-11-12 打磨）

- 冲刺和开火：`player.sprintBlock` 由 `weapons.js` 每帧写，步枪开火（含缓冲）、开镜、检视期间为真，这时不许冲刺；按住式松开后 Shift 还按着就接着跑，检视中新按下 Shift 由冲刺打断检视。冲刺姿态 `run.weight` 降到 `RUN_READY`（0.2）以下才出膛，60Hz 下第 6 帧出第一发。
- 射速不跟帧率走：`cooldown` 不截断，一帧里欠的发数照补，卡顿那一帧最多补 `CATCH_UP`（3）发；30 到 240Hz 都是 720 RPM。
- 输入缓冲（`rifle.buf`）：动作锁定（掏枪、扔雷、喷气收枪、冲刺收枪）期间按的 R、B 留 `BUF_KEY`（0.75 秒，比掏枪全程略长），左键留 `BUF`（0.2 秒）；爪刀右键重击 `knife.heavyBuf` 留 0.2 秒。只在 `input.active` 时记，阵亡、切枪、reset 时清。
- 开镜：`rifle.runK`（二阶跟随 `1 - smoothstep(ads)`，ω 30）乘在冲刺姿态的混合、晃动和肩膀转动上，冲刺中开镜不甩枪；滑铲姿态仍乘 hip。
- 后坐力：开火走 `env.fireKick`（`weapons.shotKick`，`Spring(2, 300, 60)` 过阻尼，第 2 帧到顶）和 `vm.firePunch`；刀、受击、拍匣仍走 `kickView` 和 `punch`。横向是按发数取值的值噪声 `rifle.sideDrift(n)`，每串第一发重抽。开镜时枪口上抬的冲量乘 `1 - 0.8·ads`。
- 空仓换弹是单独的时间线（`rifle.js` 的 `CUES`、`rifle_reload.js`）：0.38 秒旧弹匣脱落并交给世界道具，1.12 入匣，1.70 放枪机，2.5 结束；战术换弹 0.52、1.40、2.1 不变。`rifle.magGone` 为真表示旧匣已掉、新匣未入（被切枪打断时保持），这时第一人称弹匣藏起来，下次换弹不再掉第二个。
- 掉落弹匣：`fx.mags`（`src/fx/mags.js` 的 `MagDrops`，池子 4 个，用 `mats.rubber`，不新编着色器），外形来自 `rifle_magdrop.js` 的 `magShape`（匣体加底板）。交接时按 `tan(vmFov/2) / tan(fov/2)` 换算深度，屏幕上的位置和大小与第一人称一致。
- 落地：`player.land`（下沉）和 `player.landP`（低头）都是二阶，ω 是 `LAND_W`（15），最低点在落地后约 67 毫秒；低头只在落地速度超过 8 m/s 时出现，开镜乘 0.2。`stepSmooth` 只记真的上下台阶，站立眼高不随帧率变。
- 滚转：`player.roll = rollS.x + rollD.x`，侧移那项 ω 10，喷气侧倾 `ROLL_DASH_W`（17）、系数 0.06。
- 回血：脱战 `REGEN_DELAY`（4 秒）后每秒回 `REGEN_RATE`（25）。
- 命中钩子：`weapons.onHit({ kind, part, killed, headshot })`，子弹和刀每次命中调用一次，`kind` 是 `soldier`、`drone`、`target`。`onShot` 按每帧少掉的子弹数逐发调用。
- 量手感的方法：60Hz 推进用 `game.update(1/60, true)` 加 `input.endFrame()`，`__dbg.step` 是 120Hz 子步；比较后坐力时把 `Math.random` 换成带种子的 LCG，多个种子取平均。

## HUD 与设置（2026-11-12 打磨）

- 设置项新增 `fov`（60 到 95，默认 72，写 `player.baseFov`）、`quality`、`motion`（`full` 或 `reduced`；玩家没亲手改过时跟系统的 prefers-reduced-motion，不写进存档，见 `settings.js` 的 `FOLLOW_SYSTEM`）、`volume`（接 `audio.setMaster`）。只应用不存档用 `game.applySetting(key, value)`。5184 端口的存档是各 agent 共用的，验收前先看一眼 `__dbg.settings.values`。
- 减弱动效：`player.motion` 为 0.3，乘在冲刺、滑铲、喷气的视野拉伸和喷气滚转上；`game.reducedMotion` 为真时 `uDash` 恒为 0，低血红晕不脉动；HUD 的 CSS 挂在 `.hud[data-motion="reduced"]`。
- 开局淡入：`game.newRun` 把 `uFade` 置 0，`FADE_IN`（0.35 秒）内升到 1；阵亡后 1.6 秒内压暗。刚 `play()` 就冻结会截到黑屏，先推进 60 帧。
- 受击方向：`player.onDamage(angle, amount, from)` 交给 `hud.damage(angle, fromX, fromZ)`，`hud.updateArcs(px, pz, yaw)` 每帧让弧跟着来源转；`hud.resetRun` 清掉上一局的弧。
- 战绩：`game.stats()` 返回 `{ mode, wave, kills, score, shots, hits, headshots, time, death }`（`src/game/run_stats.js`），命中只算步枪；暂停菜单、阵亡结算和练习场右上角同一口径（`targets.stats` 是靶子自己的计数，刀砍也算）。
- 波次和罗盘：`hud.setWave(wave, remaining, nextIn)`，给了 `nextIn` 就显示下一波倒计时；`hud.setCompassMarks(degs)` 画最后几个敌人的方位，视野外的钉在 17% 和 83%。`hud.kill` 带 `time`（游戏时间），连杀窗口按它算。右上的击杀信息栏（`hud.feed`）已删。
- 暂停菜单：左边本局战绩，右边设置；波次模式打过第 1 波以后，「重新开始」和切玩法要点第二次确认。
- 字阶、透明度都在 `tokens.css`（caption 0.875、label 1、body 1.125 个单位）。`dev/hud.html` 有「波次」一组按钮。
- 看细节：预览面板窄，1440 的视口会被缩小，给画布或 `document.body` 设 `transform: scale(N)` 加 `transform-origin` 放大。后台标签页里 CSS 动画不按游戏时间走，要看某一刻就把那个元素的 `animation-play-state` 设成 `paused`，或者读 `getComputedStyle`。

## 掩体（2026-11-12 打磨）

- 堆场补的掩体都在 `src/world/yard_cover.js` 的 `buildYardCover(ctx)`，`level.js` 在摆件之后调用，用自己的随机数 `mulberry32(4471)`；街上的送货车和货堆在 `street_layout.js` 的 `roadside()`（`mulberry32(7411)`）。增减这两处不会让别处摆件和远景的随机结果跟着变。
- 高度约定：矮掩体顶高 1.07 到 1.1 米（蹲姿眼高 1.02，原地能跳上去），高掩体 1.8 米以上，1.15 到 1.35 米之间不用。`palletStack({ n: 5, load: 0.22 })` 是 5 层托盘压一托薄货（顶高 1.084）；7 层托盘只有 1.008 米，蹲着露头，不当掩体用。
- 防攀爬：矮件挨着 1.8 米左右的高件会变成台阶。`props.js` 的 `noPerch(ctx, { x, z, yaw, hw, hd, top })` 在高件顶上罩一块只挡玩家的空气盒（到 5 米），站立判定不把它当地面，射线和敌人寻路忽略它。南围栏只挡玩家的碰撞体高 4 米（网栏外观 2.5 米）。
- 省三角形的简版：`palletStack / crate / tarpCargo / addContainer` 都有 `lean: true`，默认不开。
- 量法 `dev/cover_measure.js`（游戏页里 `await import('/dev/cover_measure.js?v=' + Date.now())`，先 `__dbg.play('waves')`）：`__cover.run({ save: 'base' })`、`__cover.run({ cmp: 'base' })` 给出到最近掩体的距离、暴露度、各区最长视线和最差 15 处；`__cover.heat(ppm, only)` 叠俯视热力图；`__cover.paths()` 是各敌人出生点到玩家出生点的步行米数。当前数（矮掩体判定线 1.05 米）：地面到最近掩体 90 分位 2.9 米、最大 5.8 米，暴露最高一成的平均暴露度 0.35，出生点 1.9 米内有高掩体。
- 摆掩体后的核对清单：练习场靶子视线 `auditLayout` 为 0；新碰撞体之间的缝要么小于 0.3 米、要么不小于 1.3 米；敌人出生点 1.5 米内不放东西；`__cover.paths()` 的步行距离变化不超过 15%；`dev/jump_test.js` 的 `__scanRun` 对每件矮件 16 个方向试跳，落脚不高于 1.1 米、不出围栏；堆场中央 (0, 2) 朝北、朝西的三角形增加不超过 3%。
- 已知：玩家出生点一带仍是全图暴露度最高的地方（练习场 14 个靶子的视线扇面里不能放高东西）。出生点的选法（`soldiers_spawn.js`）不用玩家 12 米内和看得见的点，开局不会贴脸刷人。

## 音效接线（2026-11-12 打磨）

- 游戏和音频之间的接线都在 `src/game/game_audio.js`：`wireAudio(game)` 挂玩家动作的拟音（`player.onStep / onJump / onLand / onSlide / onCrouch / onLean / onSlideEnd / onRegen`）、弹壳落地（`fx.onShellBounce`，材质用 `surfaceAt(phys, p)` 查）、界面声和灯具嗡声；`updateAudio(game, dt, low)` 每帧管心跳、低血闷音和室内程度。
- 界面声：`src/ui/hud_sound.js` 的 `bindUiSounds(hud, keyGuardMs)` 在 HUD 层上做事件委托，发 `uiHover`、`uiClick`。开始菜单时音频上下文还没建，`wireAudio` 在捕获阶段的 `pointerdown`、`keydown` 里先解锁，紧接着的那下点击才响得出来。
- 暂停：`audio.setWorldPaused(on)` 只停世界声，界面声照响；切到别的标签页是整个上下文挂起，两者互不影响。
- 室内程度 `game.indoor`（0 到 1）和 `game.indoorKind`（`hall` 或 `room`）每 0.2 秒按头顶净空和所在分区算一次：仓库里算大厅（长混响），办公楼里净空小于 6 米算全室内，月台雨棚、街边雨篷这类头顶有东西的室外是 0.6（雨声只闷一半）。
- 换弹的拟音跟 `rifle.js` 的 `CUES` 走，`rifle_reload.js` 的关键帧改了要一起改；`MAG_DROP_T` 对着空仓换弹的 `magOut`。
- 喷气的音色（`sounds_kit.js` 的 `dash`）是一声爆发：3 毫秒到顶，前 80 毫秒占九成以上能量；开头两侧喷口一口亮的气，随后噪声过三个共振峰（`DASH_FORMANTS`，中心从 u 滑到 a），再叠一声 460 到 300 赫兹往下掉的空腔共振。要更亮就加大共振峰那一路，要更闷就加大空腔那两行。
- 量一个音：`dev/audio.html` 里 `await __audio.measureSound('dash')`（峰值、最响 50 毫秒、A 计权、时长、频谱重心），`__audio.decay(buf, 0.45)` 看衰减；`__audio.renderOffline((a) => a.play(name), { seconds, raw: true })` 拿到波形自己分窗看频谱。改了音色以后「最响 50 毫秒」要和改前接近，不然去调 `table.js` 里的 `gain`。
- 没接的：`boltRack` 没有地方用；移动靶没有电机声；被顶住起不来的强制下蹲没有装具声。

## 室内灯光（2026-11-12 打磨）

- `withIndoor(mat, k)`（`src/gfx/materials.js`）按世界坐标起作用：片元落在房间盒里时，天光（半球补光和环境贴图）只剩门窗洞附近那些，另加这个房间自己的环境照度；房间盒外和没打补丁时一样，所以室内外都会摆的材质也能用。`k` 是环境贴图的保留比例（场景材质 0.3，第一人称武器 1）。
- 数据：房间盒 `ROOMS`、通天的门洞 `SKY_DOORS`、房间之间的门 `ROOM_DOORS` 都在 `src/world/plan.js`；`src/world/indoor.js` 的 `IndoorLight` 把它们和办公楼的窗、灯板密度表填进 `src/gfx/indoor_light.js` 的 uniform，每帧按各房间里灯的亮度更新房间照度。全是 uniform，不占纹理单元。
- 前后对比：`__dbg.level.lighting.indoor` 是 `IndoorLight` 实例；控制台里 `(await import('/src/gfx/indoor_light.js')).indoorUniforms.uIndoorOn.value = 0` 关掉补丁，设回 1 打开。
- 第一人称武器和手（`Materials.gear` 里受光的材质）也打了这个补丁：进屋以后跟着房间的照度走，不再吃满天光。镜片、发光件、贴花不打。敌人不打，在屋里仍然吃全量半球光，为的是看得清。
- 传送验收时注意标高：仓库和办公楼一层的地面在 y 1.1，用 `__dbg.level.spawns` 里对应分区的点最稳。
- 没做的：仓库里几种室内外共用的材质（车辆、货物、卷帘门内侧）还是室外版，在屋里偏亮。

## 室外远景和屋面（2026-11-12 打磨）

- `geo.js` 的 `extrude(pts, depth, bevel, holes, { inset })`：默认倒角会把侧壁往外推 `bevel`；按轮廓尺寸贴附件的车壳（面包车）传 `inset: true`，侧壁正好落在轮廓上。叉车还没开。
- 最靠围栏的两排远景箱堆用 `yard.js` 的 `backdropBox`（波纹侧板、角柱、上下梁、箱门和锁杆），后排还是平盒子。远景新加的件只用本来就铺得很开的材质：往一个只在局部用的材质上加远处的几何体，会把它合批后的包围球撑大，多出 draw call。
- 仓库屋面的补丁按世界坐标摆，清单在 `rooftop_shell.js` 的 `PATCHES`。卷材贴图 `MEMBRANE` 的幅面是 4 米，里面不要加低频或成格子的图案，会按 4 米周期重复。
- 核对碰撞体没变：两次加载各对 `phys.boxes` 的 `cx/cy/cz/hx/hy/hz`（`q` 字段会随查询变化，不算）加 `phys.cyls` 的数值字段算哈希，比较是否一致。

## 雨夜（2026-11-12 打磨）

- 夜空：`Sky` 有 `rain`、`rainShown()`、`onRainChange`、`setRain(amount)`、`syncRain()`。着色器里的 `uRain` 等于雨量乘这一档画质有没有雨（`rainShown` 由 `TimeOfDay` 接成 `level.ground.enabled`）。下雨时云盖满天，星星、月亮和余晖收掉，云底映城市光：近地平线偏橙，天顶偏冷灰（让无人机的橙色识别色仰视时还跳得出来）。省内存档和低画质下 `uRain` 为 0，夜空是晴的。
- 看得见的雨量一变（切时段、切画质），`sky.update` 调 `onRainChange`（即 `tod.bake()`）重烤环境贴图，一次约 50 毫秒。`Sky.bakeProbe` 拍探针前先 `syncRain()`，启动时不会多烤一遍；省内存档在 `main.js` 拍探针前先把 `ground.enabled` 关掉，原因相同。
- 地面：`ground.setWet(wetness, puddle, rain, rainPuddle)`，`ground.wet` 存这四个值，`syncWet()` 每帧按 `enabled` 算出 `uWetRain`（看得见的雨）和 `uPuddle = puddle + rainPuddle × uWetRain`。夜晚的参数是 `timeofday_presets.js` 的 `NIGHT_GROUND`。
- 湿路面上的灯带：地面着色器用 `inject` 展开了 three 的 `lights_physical_pars_fragment`，把 `RE_Direct_Physical` 里的 `BRDF_GGX` 换成 `groundGGX`。`uWetRain` 大于 0 时直射高光沿视线方向拉长（`aT = alpha·(1 + 2·uWetRain)`），平面倒影的竖向拉伸也加长。升级 three 后控制台出现 `[shader]` 找不到锚点，先查这里。地面的采样器还是 13 个。
- 量法 `dev/rain_measure.js`：`__rm.setup('night')` 进练习场并切时段，`__rm.shot(x, z, yaw, pitch, y)` 返回整帧均值、画面下部 40% 的均值和最亮的几列，`__rm.col(px)` 是某一列从中线往下的亮度，`__rm.sky()` 是天空平均色；`__ab(true)` 在同一页面退回不下雨的样子，`__ab(false)` 换回来。
- 没看过的：前台连续运行加镜头移动时，倒影竖条在 TAA 下会不会闪；中画质没有单独截图。

## 敌人和难度（2026-11-12 第二轮）

- 数字都在 `src/enemies/tuning.js` 的 `TUNE`，`game.soldiers.tune` 和 `game.drones.tune` 指向它，控制台里改了立刻生效。
- 交战分工（`soldiers_roles.js`）：每个士兵的 `role` 是 `assault` 或 `support`。突击手人数按波次取 `TUNE.assault`（1、1、2、2、2、3，之后都是 3），往前压、绕侧翼，最近到 `keepDist` 8 米。其余是压制手，各自在 `supportDist` 13 到 18 米里取一个交战距离，守在能打到玩家最后位置的掩体后探头点射；蹲守 4 到 7 秒轮不到开火名额就在附近换掩体，方位变化不超过 40 度。全队 6 秒看不见玩家，压制手的交战距离每秒收 1 米，收到 8 米后再等 4 秒转入搜索。突击手全死 8 秒后提最近的压制手补上。`soldiers.debugInfo()` 里有 `roles` 计数。
- 被冲脸不后撤：只在玩家自己冲过来时放宽最近距离，依据是 `s.holdDist`（选点时记下的所守掩体离玩家最后位置的距离，不少于 `keepDist` 才算）。自己走近的人照常退回交战距离。
- 开火名额：第 1 波 1 个，之后 2 个，第 7 波起 3 个；第 3 波起玩家连续 2 秒站在明处多放一个，加上以后不超过 `shootersCap` 3。突击手没掩体时最多站 3.5 秒就挪。
- 无人机：全队相邻两次点射的间隔乘 `droneInterval` 1.8。悬停点离目标水平不少于 6 米（`drone_ai.js` 的 `NEAR_MIN`），不堵在集装箱口和门口往里打。全队连续 `droneLeave` 40 秒看不见玩家就撤离：爬高飞出地图后回收，不算击杀、不加分、不留残骸。
- `hit` 的选项：`soldiers.hit(target, dmg, point, dir, part, { silent })` 和 `drones.hit(drone, dmg, point, dir, part, { silent })`，`silent` 时不放受击声（刀砍用）。
- 敌人音效：士兵换弹放 `npcMagOut`、`npcMagIn`（按换弹进度现放，中途死亡或清场后不再响）；敌方子弹落在玩家 10 米内放着弹声，金属面 3 米内三成放跳弹声；无人机残骸落地放 `droneCrash`，落定后 `droneSpark` 循环 6 秒，清场时也会停。
- 士兵移动（`soldiers_move.js`）：身体台阶 0.48 米，比寻路网格的 0.42 宽一点，用来吸收网格采样误差；卡住按 0.7 秒里往当前路点靠近不到 0.15 米判断，先侧挤，再重新寻路，第 4 次吸附到最近的网格点。
- 手感目标：站桩挨到 100 点伤害 7 到 9 秒；横向跑动 15 秒挨的伤害中位不超过 40；在高掩体后探头，躲着时 30 秒挨的伤害中位不超过 20，头 0.6 秒不中弹的比例不低于 0.9；躲好以后到第一次被看见中位不少于 12 秒；第 6 波站桩不少于 4.5 秒，第 7 波以后不少于 4 秒；无人机每秒伤害第 3 波 2 架站着不超过 4、跑动不超过 2，第 6 波 3 架站着不超过 7、跑动不超过 3.5。量法是 `tune_measure.js` 和 `tune_cover.js`，结果噪声大，判断要 30 局以上。
- 量法的坑：`t2` 和 `t5n` 的跑动档会留下 `__tuneState.mv.fn`，之后在同一页面跑 `review_waves.js` 前先设成 `null`，不然玩家会被拖走。
- 已知的场地漏点：街上送货车正南约 19 米处能直接看见车后的躲藏位；堆场中部那只集装箱朝西开口，无人机能从西边隔着箱口打进去。

## 量法脚本一览

都在游戏页里用 `await import('/dev/<名字>?v=' + Date.now())` 加载，先 `__dbg.play('waves')`：

- `tune_measure.js`：敌人强度。`__tune.t1` 到 `t5`、`t5n(n, level, run, count)`、`check()`、`waves.start() / run(60) / report()`。
- `tune_cover.js`：掩体可靠度。`__tune.cover(n, site, level, count)`，`site` 是 `yard`、`west`、`van`；每局返回 `see`（躲好到第一次被看见的秒数）、`los`、`who`，`void` 的局不算。
- `cover_measure.js`：掩体覆盖，见「掩体」一节。
- `review_waves.js`：`__rw.start(x, y, z) / run(40) / report()`，站在一点上挨一整波，看谁在打、从哪打。
- `jump_test.js`：`__jt(x, y, z, yaw, { sprint, jumpAt, frames, dashAt })` 试一次跳，`__scanRun` 对矮件 16 个方向试跳。
- `rain_measure.js`：雨夜的亮度统计和同页面 A/B，见「雨夜」一节。
- `perf_probe.js`：性能，见「性能测量」一节。

