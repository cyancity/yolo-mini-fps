// HUD 的静态结构：常量、图标和整块 DOM 模板。hud.js 构造时一次性插入，之后只改文本和属性。

// 第一列是身体动作和系统键，第二列是武器；hud.css 里按 10 行一列排。
// 冲刺那一行的说明跟着设置变（hud.js 的 bindSettings），这里写的是默认的切换式
const CONTROLS = [
  ['W A S D', '移动'], ['Shift', '切换冲刺'], ['C', '切换下蹲 / 滑铲'], ['Ctrl', '按住下蹲 / 滑铲'], ['空格', '跳'],
  ['Q E', '左右探头'], ['V / 侧键', '喷气'], ['F11', '全屏'], ['F3', '帧率'], ['Esc', '暂停'],
  ['左键', '开火 / 挥砍'], ['右键', '瞄准 / 重击'], ['R', '换弹'], ['B', '射击模式'],
  ['1', '主武器'], ['3', '近战'], ['滚轮', '切换武器'], ['G', '烟雾弹'], ['~', '检视'],
];

// 两种玩法在暂停菜单里互相切换时按钮上的字
export const MODE_SWITCH = { waves: '开始实战', range: '练习场' };

// 罗盘轨道从 -90° 铺到 450°，可视 120°：朝向在 0~360 之间怎么转，两侧都有内容，不用首尾拼接。
// 540° / 5° = 108 格，hud.css 里轨道的列数和 450% 宽度跟这几个数对应。
export const COMPASS_FROM = -90;
export const COMPASS_SPAN = 540;
export const COMPASS_VIEW = 120;
const COMPASS_STEP = 5;
const COMPASS_LABEL_EVERY = 15;
const CARDINALS = { 0: '北', 45: '东北', 90: '东', 135: '东南', 180: '南', 225: '西南', 270: '西', 315: '西北' };

export const DAMAGE_ARCS = 4;
// 罗盘上最多标几个敌人（剩余不多于这个数时才标）
export const COMPASS_MARKS = 2;

// parts：菜单里显示哪些区块。again 是「重新开始」；alt 是最后一个按钮：'range' 固定进练习场，'other' 切到当前玩法以外的那个
export const MENUS = {
  loading: { title: '零号码头', parts: ['keys', 'load'], button: '开始实战', disabled: true },
  start: { title: '零号码头', parts: ['keys', 'settings', 'alt'], button: '开始实战', event: 'start', arg: 'waves', alt: 'range', focus: true },
  paused: { title: '暂停', parts: ['stats', 'settings', 'again', 'alt'], button: '继续', event: 'resume', again: '重新开始', alt: 'other', focus: true },
  // 阵亡时不聚焦按钮：玩家多半还在乱按，免得一个空格就重开
  dead: { title: '阵亡', parts: ['stats', 'alt'], button: '重新开始', event: 'restart', alt: 'range' },
};
export const MENU_PARTS = ['keys', 'stats', 'settings', 'load', 'again', 'alt'];

// 实战里第一个目标出现以后，暂停里的「重新开始」和切玩法会丢掉本局：第一次点只把按钮换成这句话
export const CONFIRM = { again: '放弃本局，重新开始', range: '放弃本局，去练习场' };

// 战绩栏：实战六项（三列两行），练习场三项，多出来的格子藏起来；hud.js 按玩法换名称和数值
export const STATS = {
  waves: ['肃清区域', '击倒', '得分', '命中率', '爆头', '存活'],
  range: ['命中率', '击倒', '爆头率'],
};
// 阵亡页标题下的死因：player.takeDamage 的第三个参数
export const KILLER = { soldier: '武装人员', drone: '无人机' };

// 技能栏图标：24 格的线稿，颜色跟随 currentColor
const ICONS = {
  // 喷气：两道前冲的折线，后面拖着气流
  dash: '<path d="M10 6l6 6-6 6M15 6l6 6-6 6M2.5 12h5M4 8.5h3M4 15.5h3"/>',
  // 烟雾弹：罐体加一团烟
  smoke: '<rect x="4" y="12.5" width="8" height="9" rx="1.5"/><path d="M6 12.5V10h4v2.5M12.5 10.5h7.5a2.5 2.5 0 0 0 0-5 3.5 3.5 0 0 0-6.6-1A2.8 2.8 0 0 0 12.5 10.5z"/>',
};
export const ABILITIES = [['dash', 'V'], ['smoke', 'G']];

function compassLabels() {
  let html = '';
  const end = COMPASS_FROM + COMPASS_SPAN;
  for (let d = COMPASS_FROM + COMPASS_LABEL_EVERY; d < end; d += COMPASS_LABEL_EVERY) {
    const deg = ((d % 360) + 360) % 360;
    const column = (d - COMPASS_FROM) / COMPASS_STEP + 1;
    const name = CARDINALS[deg];
    html += `<span style="grid-column:${column}"${name ? ' data-cardinal' : ''}>${name || deg}</span>`;
  }
  return html;
}

const ability = ([name, key]) => `
    <div class="hud-ability" data-ability="${name}" data-ready>
      <span class="hud-ability-tile"><svg viewBox="0 0 24 24">${ICONS[name]}</svg><b class="hud-ability-cd"></b></span><kbd>${key}</kbd>
    </div>`;

export const TEMPLATE = `
<div class="hud-fps" data-ref="fps"></div>
<div class="hud-top">
  <div class="hud-compass" aria-hidden="true">
    <div class="hud-compass-track" data-ref="track">${compassLabels()}</div>
    <div class="hud-compass-marks hud-compass-goal" data-ref="goal"><i></i></div>
    <div class="hud-compass-marks" data-ref="marks">${'<i></i>'.repeat(COMPASS_MARKS)}</div>
    <i class="hud-compass-caret"></i>
  </div>
  <div class="hud-objective" data-ref="objective">
    <b data-ref="zone"></b>
    <span class="hud-objective-left">剩余 <b data-ref="left">0</b></span>
  </div>
</div>
<div class="hud-notice" data-ref="notice" role="status" aria-live="polite"></div>
<div class="hud-tr">
  <div class="hud-score"><span data-ref="score">0</span><small>分</small></div>
  <dl class="hud-range" data-ref="range">
    <div><dt>命中率</dt><dd data-ref="rangeAcc">—</dd></div>
    <div><dt>击倒</dt><dd data-ref="rangeKills">0</dd></div>
    <div><dt>爆头率</dt><dd data-ref="rangeHead">—</dd></div>
  </dl>
</div>
<div class="hud-center" aria-hidden="true">
  <div class="hud-dmg" data-ref="dmg">${'<i></i>'.repeat(DAMAGE_ARCS)}</div>
  <svg class="hud-reload" data-ref="reload" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="47" /><circle cx="50" cy="50" r="47" pathLength="100" />
  </svg>
  <div class="hud-cross" data-ref="cross"><i></i><i></i><i></i><i></i><b></b></div>
  <div class="hud-hit" data-ref="hit"><i></i><i></i><i></i><i></i></div>
</div>
<div class="hud-ticker" data-ref="ticker" aria-hidden="true">
  <div class="hud-ticker-head" data-ref="tickHead"><b data-ref="tickTotal"></b><span data-ref="tickCount"></span></div>
  <ul data-ref="tickLines"></ul>
</div>
<div class="hud-health" data-ref="health">
  <i class="hud-plus"></i>
  <span class="hud-hp" data-ref="hp">100</span>
  <div class="hud-bar"><i class="hud-bar-trail" data-ref="hpTrail"></i><i data-ref="hpBar"></i></div>
</div>
<div class="hud-br">
  <div class="hud-abilities" data-ref="abilities" aria-hidden="true">${ABILITIES.map(ability).join('')}
  </div>
  <div class="hud-weapon" data-ref="weapon">
    <div class="hud-ammo">
      <span class="hud-mag" data-ref="mag">0</span><span class="hud-reserve" data-ref="reserve">0</span>
    </div>
    <div class="hud-wline"><span class="hud-wname" data-ref="wname"></span><span class="hud-mode" data-ref="mode"></span></div>
    <div class="hud-slots" data-ref="slots">
      <span class="hud-slot" data-slot="1"><kbd>1</kbd>主武器</span>
      <span class="hud-slot" data-slot="3"><kbd>3</kbd>近战</span>
    </div>
  </div>
</div>
<div class="hud-menu" data-ref="menu" role="dialog" aria-modal="true">
  <div class="hud-panel" data-ref="panel" tabindex="-1">
    <header class="hud-title"><h1 data-ref="title">零号码头</h1><p data-ref="subtitle">DOCK ZERO</p></header>
    <div class="hud-body">
      <dl class="hud-keys" data-ref="keys">
        ${CONTROLS.map(([key, action]) => `<div><dt><kbd>${key}</kbd></dt><dd${key === 'Shift' ? ' data-ref="sprintKey"' : ''}>${action}</dd></div>`).join('')}
      </dl>
      <dl class="hud-stats" data-ref="stats">
        ${STATS.waves.map((name) => `<div><dt>${name}</dt><dd>0</dd></div>`).join('')}
      </dl>
      <div class="hud-settings" data-ref="settings"></div>
    </div>
    <div class="hud-actions">
      <button class="hud-btn" data-ref="button" type="button"></button>
      <button class="hud-btn hud-btn-alt" data-ref="again" type="button"></button>
      <button class="hud-btn hud-btn-alt" data-ref="alt" type="button"></button>
      <div class="hud-load" data-ref="load" role="progressbar" aria-label="加载进度" aria-valuemin="0" aria-valuemax="100">
        <div class="hud-load-bar"><i data-ref="loadBar"></i></div>
        <span class="hud-load-pct" data-ref="loadPct">0%</span>
      </div>
    </div>
  </div>
</div>`;
