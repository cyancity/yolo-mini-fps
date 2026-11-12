// 游戏和音频之间的接线：玩家动作的拟音、弹壳、界面声、遮挡几何、灯具嗡声，以及每帧的心跳、闷音和室内混响
import { zoneAt } from '../world/plan.js';

// 回血时血量低于这个数才喘一口气：挨一两下擦伤就回血的时候不出声
const REGEN_BREATH_HP = 60;
const LAMP_ZONES = ['warehouse', 'office'];

// 弹壳、弹匣落地那一点的地面材质。groundHeight 会改写 phys.groundSurface，玩家和敌人都是调完自己的查询马上读，不冲突
export function surfaceAt(phys, p) {
  phys.groundHeight(p.x, p.z, 0.05, p.y + 0.05, 0.1);
  return phys.groundSurface;
}

export function wireAudio(game) {
  const { player, hud, audio, fx, level } = game, phys = level.phys;
  audio.setGeometry?.(phys);
  // 室内的灯（仓库、办公楼）挂灯具嗡声，引擎只挂离听者最近的两盏
  const lamps = (level.zones || []).filter((z) => LAMP_ZONES.includes(z.name))
    .flatMap((z) => z.lights.map((l) => ({ x: l.pos[0], y: l.pos[1], z: l.pos[2] })));
  audio.setLamps?.(lamps);

  player.onStep = (surface, speed) => audio.play('footstep', { surface, volume: (0.35 + 0.4 * speed) * (1 - 0.45 * player.crouch) });
  player.onJump = () => audio.play('jump', { volume: 0.5 });
  player.onLand = (impact) => audio.play('land', { surface: player.surface, volume: Math.min(1, impact / 8) });
  player.onSlide = (surface) => audio.play('slide', { surface, volume: 0.8 });
  player.onCrouch = (down) => audio.play('gear', { volume: down ? 0.7 : 0.55, pitch: down ? 0.95 : 1.05 });
  player.onLean = () => audio.play('gear', { volume: 0.45, pitch: 1.1 });
  player.onSlideEnd = () => audio.play('gear', { volume: 0.6, pitch: 0.9 });
  player.onRegen = (hp) => { if (hp < REGEN_BREATH_HP) audio.play('regenBreath', { volume: 0.7 }); };
  // 地毯上自动换成 shellSoft，沥青按地面湿度叠水声
  fx.onShellBounce = (position, speed = 1) => audio.play('shell', { position, surface: surfaceAt(phys, position), volume: Math.min(1, 0.3 + speed * 0.2) });

  // 开始菜单时还没有音频上下文：HUD 层上的按下和按键是浏览器认可的手势，捕获阶段就建好，紧接着那下 click 的 uiClick 才响得出来。
  // 第一下按下之前的悬停受自动播放策略限制，响不了。菜单里世界声先停着，进游戏时 enter() 放开
  const gesture = () => {
    if (!audio.ready && game.state === 'menu') audio.setWorldPaused(true);
    audio.unlock();
  };
  hud.layer.addEventListener('pointerdown', gesture, true);
  hud.layer.addEventListener('keydown', gesture, true);
  hud.on('uiHover', () => audio.play('uiHover', { volume: 0.6 }));
  hud.on('uiClick', () => audio.play('uiClick', { volume: 0.7 }));
  // 切到别的标签页：整个上下文挂起，回来接着跑。游戏暂停与否由 setWorldPaused 管，两者互不影响
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.suspend(); else audio.resume(); });
}

// 每帧：低血量的心跳和闷音、头顶有没有屋顶（室内混响）。low 是 0..1 的低血程度
export function updateAudio(game, dt, low) {
  const { player, audio } = game, playing = game.state === 'playing';
  // 看此刻的状态而不是帧开头取的：阵亡发生在这一帧的 player.update 里，同一帧不能再放心跳、也不能把阵亡的全闷改回去
  if (playing && player.alive && low > 0.2 && game.time > game.heartbeatAt) {
    audio.play('heartbeat', { volume: 0.35 + 0.5 * low });
    game.heartbeatAt = game.time + 1.05 - 0.35 * low;
  }
  if (playing) audio.setMuffle(low * 0.7);
  // 进了屋雨声变闷、混响变短；仓库是大厅（长混响），办公楼和楼梯间按净空走小房间
  if ((game.indoorT -= dt) <= 0) {
    game.indoorT = 0.2;
    const e = player.eye, cover = game.level.phys.ceilingHeight(e.x, e.z, 0.4, e.y) - e.y;
    const zone = zoneAt(e.x, e.z), hall = cover < 14 && zone === 'warehouse';
    // 只有仓库和办公楼里算全室内；月台雨棚、街边雨篷这类头顶有东西的室外是半露天，雨声只闷一半
    game.indoor = hall ? 1 : cover < 6 ? (zone === 'office' ? 1 : 0.6) : cover < 14 ? 0.6 : 0;
    game.indoorKind = hall ? 'hall' : 'room';
  }
  audio.setIndoor?.(game.state === 'menu' ? 0 : game.indoor, game.indoorKind);
}
