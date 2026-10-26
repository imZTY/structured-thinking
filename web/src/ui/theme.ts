/**
 * ui/theme.ts —— 认知 / 行动模式 = 白天 / 黑夜主题。
 * 画面本身就是模式提示：白天只能改公式，黑夜只能往词上挂抓手 / 想法。
 */

import type { Mode } from '../core/types';

const KEY = 'st-mode';

export function loadMode(): Mode {
  return localStorage.getItem(KEY) === 'action' ? 'action' : 'cognition';
}

export function applyMode(mode: Mode): void {
  document.documentElement.dataset.theme = mode === 'action' ? 'dark' : 'light';
  localStorage.setItem(KEY, mode);
}
