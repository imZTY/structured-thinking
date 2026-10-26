/**
 * ui/panels.ts —— Tabs（Excel sheet 式，左下角）与 toast。
 */

import type { Manifest } from '../core/types';
import { btn, el } from './dom';

export interface TabsCallbacks {
  onSelect(id: string): void;
  onCreate(title: string): void;
}

export class Tabs {
  el: HTMLElement;
  private creating = false;
  private lastKey = '';

  constructor() {
    this.el = el('nav', 'tabs');
    this.el.setAttribute('aria-label', '主题');
  }

  render(manifest: Manifest | null, activeId: string | null, canCreate: boolean, cb: TabsCallbacks) {
    // 正在输入新主题名时不重建，否则输入框会丢焦点
    if (this.creating) return;
    const key = JSON.stringify([manifest?.topics.map((t) => [t.id, t.title]), activeId, canCreate]);
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.el.replaceChildren();
    for (const t of manifest?.topics ?? []) {
      const b = btn('tabs__item' + (t.id === activeId ? ' tabs__item--active' : ''), t.title, t.id, () =>
        cb.onSelect(t.id),
      );
      this.el.appendChild(b);
    }
    if (canCreate) {
      const add = btn('tabs__item tabs__add', '＋', '新建主题', () => this.startCreate(cb));
      this.el.appendChild(add);
    }
  }

  private startCreate(cb: TabsCallbacks) {
    this.creating = true;
    const input = el('input', 'tabs__input');
    input.type = 'text';
    input.placeholder = '主题名称，回车创建';
    input.setAttribute('aria-label', '新主题名称');
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const title = input.value.trim();
      this.creating = false;
      this.lastKey = '';
      if (commit && title) cb.onCreate(title);
      else input.replaceWith(btn('tabs__item tabs__add', '＋', '新建主题', () => this.startCreate(cb)));
    };
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(false));
    this.el.querySelector('.tabs__add')?.replaceWith(input);
    input.focus();
  }
}

export function toast(msg: string, kind: 'info' | 'error' = 'info', ms?: number): void {
  const t = el('div', `toast toast--${kind}`, msg);
  t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast--in'));
  setTimeout(() => {
    t.classList.remove('toast--in');
    setTimeout(() => t.remove(), 300);
  }, ms ?? (kind === 'error' ? 4500 : 2200));
}
