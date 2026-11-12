// 菜单里的设置区：文本框（名字）、分段单选（画质、时段、动态效果、爪刀涂装）和带读数的滑杆（灵敏度、视野、亮度、音量）。
// 控件按 SETTING_DEFS 生成，改动立刻写回 settings；settings 从别处变了也同步回控件。
import { SETTING_DEFS } from '../game/settings.js';

const STEP_KEYS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

// 读数格式：亮度和音量按百分比，视野按度，其余按步长的小数位
const percent = (v) => `${Math.round(v * 100)}%`;
const FORMAT = { brightness: percent, volume: percent, fov: (v) => `${Math.round(v)}°` };
const decimals = (step) => Math.max(0, Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)));

// 单选组：只占一个 Tab 停靠点，组内用方向键，移到哪项就选中哪项
export class Segmented {
  constructor(el, options, onPick) {
    this.el = el;
    this.options = options;
    this.onPick = onPick;
    this.value = undefined;
    el.innerHTML = options.map(([value, label]) => `<button type="button" role="radio" data-value="${value}">${label}</button>`).join('');
    this.radios = [...el.children];
    el.addEventListener('click', (e) => {
      const radio = e.target.closest('button');
      if (radio) this.pick(radio.dataset.value, true);
    });
    el.addEventListener('keydown', (e) => this.onKey(e));
  }

  pick(value, fromUser) {
    if (value === this.value || !this.options.some(([v]) => v === value)) return;
    this.value = value;
    for (const radio of this.radios) {
      const checked = radio.dataset.value === value;
      radio.setAttribute('aria-checked', checked);
      radio.tabIndex = checked ? 0 : -1;
    }
    if (fromUser) this.onPick(value);
  }

  onKey(e) {
    const step = STEP_KEYS[e.key];
    if (!step) return;
    e.preventDefault();
    const n = this.options.length;
    const index = this.options.findIndex(([v]) => v === this.value);
    const next = (index + step + n) % n;
    this.pick(this.options[next][0], true);
    this.radios[next].focus();
  }
}

// 原生 range 输入本身就支持方向键、PageUp/PageDown、Home/End
class Slider {
  constructor(row, key, def, id, onInput) {
    this.key = key;
    this.def = def;
    this.digits = decimals(def.step);
    row.innerHTML = `
      <label class="hud-field-name" for="${id}">${def.label}</label>
      <input class="hud-slider" id="${id}" type="range" min="${def.min}" max="${def.max}" step="${def.step}">
      <output class="hud-readout" for="${id}"></output>`;
    this.input = row.querySelector('input');
    this.out = row.querySelector('output');
    this.input.addEventListener('input', () => onInput(key, Number(this.input.value)));
  }

  show(value) {
    const { def } = this;
    if (String(value) !== this.input.value) this.input.value = value;
    this.input.style.setProperty('--fill', ((value - def.min) / (def.max - def.min)).toFixed(4));
    this.out.textContent = FORMAT[this.key] ? FORMAT[this.key](value) : Number(value).toFixed(this.digits);
  }
}

class Choice {
  constructor(row, key, def, id, onInput) {
    row.innerHTML = `<span class="hud-field-name" id="${id}">${def.label}</span><div class="hud-seg" role="radiogroup" aria-labelledby="${id}"></div>`;
    this.seg = new Segmented(row.lastElementChild, def.options, (v) => onInput(key, v));
  }

  show(value) { this.seg.pick(value, false); }
}

// 文本框（名字）：失焦或回车才写回，输入途中不规整，免得中间的空格打不出来。maxlength 按 UTF-16 码元算，
// 放宽到两倍，字数由 settings 的规整来卡（按码点）
export class TextField {
  constructor(row, key, def, id, onInput) {
    row.innerHTML = `<label class="hud-field-name" for="${id}">${def.label}</label><input class="hud-input" id="${id}" type="text" maxlength="${def.max * 2}" placeholder="${def.hint || ''}" autocomplete="off" spellcheck="false">`;
    this.input = row.querySelector('input');
    this.input.addEventListener('change', () => onInput(key, this.input.value));
    // 输入法选字时的回车不算
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) this.input.blur(); });
  }

  show(value) { if (value !== this.input.value) this.input.value = value; }
}

// 行的顺序就是 SETTING_DEFS 的顺序
export function buildSettings(container, settings, idPrefix) {
  const controls = {};
  // 写回以后按规整过的值重画一次：值没变（比如只多打了空格）时 settings 不通知
  const set = (key, value) => { settings.set(key, value); controls[key]?.show(settings.get(key)); };
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    const row = document.createElement('div');
    row.className = 'hud-field';
    row.dataset.key = key;
    const id = `${idPrefix}-set-${key}`;
    const Control = def.text ? TextField : def.options ? Choice : Slider;
    const control = new Control(row, key, def, id, set);
    control.show(settings.get(key));
    controls[key] = control;
    container.append(row);
  }
  settings.onChange?.((key, value) => controls[key]?.show(value));
  return controls;
}
