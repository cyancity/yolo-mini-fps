// 菜单的界面声：在 HUD 层上做事件委托，发 'uiHover'（指到按钮上）和 'uiClick'（点按钮、单选组用方向键换项、滑杆改完值）。
// 只在菜单打开、指针没锁定时发：游戏进行中鼠标锁在画布上，不会误响
export function bindUiSounds(hud, keyGuardMs) {
  const layer = hud.layer;
  let over = null;
  const live = () => !!layer.dataset.menu && !document.pointerLockElement;
  layer.addEventListener('pointerover', (e) => {
    const b = e.target.closest?.('button');
    if (b === over) return;
    over = b;
    if (b && !b.disabled && live()) hud.emit('uiHover');
  });
  layer.addEventListener('pointerout', (e) => {
    if (over && !over.contains(e.relatedTarget)) over = null;
  });
  // 捕获阶段：按钮自己的处理（开始、继续）会立刻收起菜单，冒泡回来时已经判断不出是菜单里的点击
  layer.addEventListener('click', (e) => {
    if (!e.target.closest?.('button') || !live()) return;
    // 菜单刚弹出时按住的空格落到按钮上的那下点击，按钮自己不认，这里也不响
    if (e.detail === 0 && performance.now() - hud.menuAt < keyGuardMs) return;
    hud.emit('uiClick');
  }, true);
  layer.addEventListener('keydown', (e) => {
    if (e.target.matches?.('[role=radio]') && e.key.startsWith('Arrow') && live()) hud.emit('uiClick');
  });
  layer.addEventListener('change', (e) => {
    if (e.target.matches?.('input[type=range]') && live()) hud.emit('uiClick');
  });
}
