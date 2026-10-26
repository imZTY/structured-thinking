/**
 * ui/app.ts —— 应用编排：状态 → 渲染 → 事件接线。
 *
 *   界面三块：推导式公式视图（主）/ 检查器（右）/ 主题 tab（左下）
 *   两种模式：认知（白天，只改公式）/ 行动（黑夜，公式只读，只挂抓手和想法）
 *   写回：仅本地 dev 服务在场时可编辑，改动 500ms 内自动保存到 content/
 */

import type { Action, Mode, Path, TermNode } from '../core/types';
import type { AppState } from '../core/appState';
import * as S from '../core/appState';
import { ContentStore, HttpContentSource } from '../core/source';
import { buildHash, parseHash } from '../core/router';
import * as M from '../core/model';
import { parseExpr } from '../core/formula';
import { renderDerive, type EditingState } from './derive';
import { renderInspector } from './inspector';
import { Tabs, toast } from './panels';
import { applyMode, loadMode } from './theme';
import { btn, el } from './dom';

type Editing = EditingState & { baseRoot?: TermNode };
type Pending = { kind: 'edit' } | { kind: 'reveal'; path: Path } | { kind: 'act-add' };

const HISTORY_LIMIT = 200;
const SAVE_DELAY = 500;

const selKey = (p: Path | null): string | null => (p === null ? null : M.pathKey(p));
const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const isTextField = (n: Element | null): n is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
  n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement || n instanceof HTMLSelectElement;

export class App {
  private state: AppState = { ...S.initialAppState, mode: loadMode() };
  private store = new ContentStore(new HttpContentSource());
  private editable = false;

  /** 正在编辑的公式右边；baseRoot 仅在「刚点开一个空词」时存在，取消时据此还原 */
  private editing: Editing | null = null;
  private undoStack: TermNode[] = [];
  private redoStack: TermNode[] = [];
  private pending: Pending | null = null;
  private keepInspector = false;
  private deriveHtml = '';
  private inspKey = '';
  private loadToken = 0;

  private dirty = false;
  private flushing: Promise<void> | null = null;
  private saveTimer = 0;

  private tabs = new Tabs();
  private titleEl = el('h1', 'topbar__title');
  private subEl = el('span', 'topbar__sub');
  private deriveEl = el('main', 'derive');
  private inspEl = el('aside', 'inspector');
  private statusEl = el('span', 'status');
  private modeBtns!: Record<Mode, HTMLButtonElement>;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;

  constructor(private host: HTMLElement) {
    applyMode(this.state.mode);
    this.buildDom();
    this.bindGlobalEvents();
    void this.boot();
  }

  // ---------- 启动与路由 ----------

  private async boot() {
    try {
      this.editable = await this.store.canEdit();
      const manifest = await this.store.getManifest();
      this.state = S.withManifest(this.state, manifest);
      const route = parseHash(location.hash);
      const wanted = manifest.topics.find((t) => t.id === route.topicId)?.id ?? manifest.topics[0]?.id ?? null;
      if (wanted) await this.openTopic(wanted, wanted === route.topicId ? route.path : [], 'replace');
      else this.renderAll();
    } catch (e) {
      this.update(S.withError(this.state, msgOf(e)));
    }
  }

  private async openTopic(id: string, path: Path, nav: 'push' | 'replace' | 'none') {
    const token = ++this.loadToken;
    this.cancelEditingSilently();
    await this.flushSave();
    try {
      const topic = await this.store.getTopic(id);
      if (token !== this.loadToken) return;
      this.undoStack = [];
      this.redoStack = [];
      this.dirty = false;
      this.deriveHtml = '';
      const next = S.withTopic(this.state, topic, path);
      if (next.selected) this.pending = { kind: 'reveal', path: next.selected };
      this.update(next);
      this.syncHash(nav);
    } catch (e) {
      if (token === this.loadToken) this.update(S.withError(this.state, msgOf(e)));
    }
  }

  private syncHash(nav: 'push' | 'replace' | 'none') {
    const t = this.state.topic;
    if (nav === 'none' || !t) return;
    const hash = buildHash(t.id, this.state.selected ?? []);
    if (location.hash === hash) return;
    if (nav === 'push') location.hash = hash;
    else history.replaceState(null, '', hash);
  }

  private async onHashChange() {
    const r = parseHash(location.hash);
    const topicId = r.topicId ?? this.state.manifest?.topics[0]?.id ?? null;
    if (!topicId) return;
    if (topicId !== this.state.topic?.id) {
      await this.openTopic(topicId, r.path, 'none');
      return;
    }
    if (selKey(r.path.length ? r.path : null) === selKey(this.state.selected)) return;
    this.flush();
    if (r.path.length) {
      this.pending = { kind: 'reveal', path: r.path };
      this.update(S.reveal(this.state, r.path));
    } else {
      this.update(S.select(this.state, null));
    }
  }

  // ---------- 全局事件 ----------

  private bindGlobalEvents() {
    window.addEventListener('hashchange', () => void this.onHashChange());

    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (isTextField(t) || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && key === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) this.redoOp();
        else this.undoOp();
      } else if (mod && !e.altKey && key === 'y' && !typing) {
        e.preventDefault();
        this.redoOp();
      } else if (e.key === 'Escape' && !typing && this.state.selected) {
        this.update(S.select(this.state, null));
      }
    });

    // 正在写公式时点别处：别让 mousedown 抢走焦点，否则输入框先 blur→提交→重绘，随后的 click 会落空。
    // 改由下面的捕获 click 统一先提交，再让目标自己的处理函数跑。
    this.host.addEventListener(
      'mousedown',
      (e) => {
        const a = document.activeElement;
        const t = e.target as Node | null;
        if (a instanceof HTMLInputElement && a.classList.contains('rhs-input') && t && !a.contains(t)) {
          if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) {
            e.preventDefault();
          }
        }
      },
      true,
    );
    this.host.addEventListener(
      'click',
      (e) => {
        const a = document.activeElement;
        const t = e.target as Node | null;
        if (isTextField(a) && this.host.contains(a) && t && a !== t && !a.contains(t)) a.blur();
      },
      true,
    );

    // 页面关闭前把没写完的改动用 keepalive 请求送出去
    const flushOnLeave = () => {
      if (this.dirty) void this.flushSave(true);
    };
    window.addEventListener('pagehide', flushOnLeave);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushOnLeave();
    });
  }

  /** 让当前聚焦的输入框失焦，从而触发它自己的提交（change / blur） */
  private flush() {
    const a = document.activeElement;
    if (isTextField(a) && this.host.contains(a)) a.blur();
  }

  // ---------- 状态更新与渲染 ----------

  private update(next: AppState) {
    const prev = this.state;
    this.state = next;
    this.renderAll(prev);
    if (next.topic && next.topic.id === prev.topic?.id && selKey(next.selected) !== selKey(prev.selected)) {
      this.syncHash('replace');
    }
  }

  private renderAll(prev?: AppState) {
    const s = this.state;
    this.renderChrome(s);
    this.renderDerivePane(s);
    const changed =
      !prev ||
      prev.topic?.id !== s.topic?.id ||
      prev.topic?.root !== s.topic?.root ||
      prev.selected !== s.selected ||
      prev.mode !== s.mode;
    if (changed && !this.keepInspector) this.renderInspectorPane(s);
    this.keepInspector = false;
    this.afterRender();
  }

  private renderChrome(s: AppState) {
    this.titleEl.textContent = s.topic?.title ?? 'structured-thinking';
    this.subEl.textContent = s.topic?.subtitle ?? '';
    document.title = s.topic ? `${s.topic.title} · structured-thinking` : 'structured-thinking';
    for (const m of ['cognition', 'action'] as const) {
      const on = s.mode === m;
      this.modeBtns[m].classList.toggle('seg__item--on', on);
      this.modeBtns[m].setAttribute('aria-pressed', String(on));
    }
    this.undoBtn.disabled = !this.editable || this.undoStack.length === 0;
    this.redoBtn.disabled = !this.editable || this.redoStack.length === 0;
    this.tabs.render(s.manifest, s.topic?.id ?? null, this.editable, {
      onSelect: (id) => {
        if (id !== this.state.topic?.id) void this.openTopic(id, [], 'push');
      },
      onCreate: (title) => void this.createTopic(title),
    });
    this.syncStatus();
  }

  private syncStatus() {
    const st = this.state.save;
    const text = !this.editable
      ? '只读'
      : st === 'saving'
        ? '保存中…'
        : st === 'saved'
          ? '已保存'
          : st === 'error'
            ? '保存失败'
            : '';
    this.statusEl.textContent = text;
    this.statusEl.dataset.state = this.editable ? st : 'readonly';
    this.statusEl.title = this.editable ? '' : '这是只读部署。用 npm run dev 在本地编辑，改动会写回 content/';
  }

  private renderDerivePane(s: AppState) {
    const inner = el('div', 'derive__inner');
    if (s.error) {
      inner.appendChild(el('p', 'state-msg state-msg--error', `加载失败：${s.error}`));
    } else if (!s.topic) {
      const empty = s.manifest && s.manifest.topics.length === 0;
      inner.appendChild(el('p', 'state-msg', empty ? '还没有主题。在 content/ 里添加，或点左下角 ＋ 新建。' : '加载中…'));
    } else {
      inner.appendChild(
        renderDerive({
          root: s.topic.root,
          expanded: s.expanded,
          selected: s.selected,
          mode: s.mode,
          canEditFormula: this.canEditFormula(),
          editing: this.editing,
          on: {
            clickTerm: (p, isLhs) => this.clickTerm(p, isLhs),
            startEdit: (p) => this.startEdit(p),
            commitEdit: (p, v, via) => this.commitEdit(p, v, via),
            cancelEdit: (p) => this.cancelEdit(p),
          },
        }),
      );
    }
    // 结构没变就不换 DOM：避免打断正在进行的点击 / 输入
    const html = inner.outerHTML;
    if (html === this.deriveHtml) return;
    this.deriveHtml = html;
    this.deriveEl.replaceChildren(inner);
  }

  private renderInspectorPane(s: AppState) {
    if (!s.topic) {
      this.inspEl.replaceChildren();
      this.inspKey = '';
      return;
    }
    const key = `${s.topic.id}|${selKey(s.selected)}|${s.mode}`;
    const scroll = key === this.inspKey ? this.inspEl.scrollTop : 0;
    this.inspKey = key;
    this.inspEl.replaceChildren(
      renderInspector({
        topic: s.topic,
        selected: s.selected,
        mode: s.mode,
        editable: this.editable,
        on: {
          select: (p) => this.update(S.select(this.state, p)),
          jump: (p) => this.jump(p),
          expandAsFormula: (p) => this.beginFormula(p),
          removeFormula: (p) => void this.apply(M.removeFormula(this.rootNode(), p), 'cognition'),
          setFields: (p, patch) => void this.apply(M.setFields(this.rootNode(), p, patch), 'cognition', undefined, true),
          setRootLhs: (v) => void this.apply(M.setRootLhs(this.rootNode(), v), 'cognition', undefined, true),
          addAction: (p, kind, text) => {
            const action: Action = kind === 'action' ? { kind, text, status: 'todo' } : { kind, text };
            this.pending = { kind: 'act-add' };
            void this.apply(M.addAction(this.rootNode(), p, action), 'action');
          },
          updateAction: (p, i, patch) =>
            void this.apply(M.updateAction(this.rootNode(), p, i, patch), 'action', undefined, patch.text !== undefined),
          removeAction: (p, i) => void this.apply(M.removeAction(this.rootNode(), p, i), 'action'),
        },
      }),
    );
    this.inspEl.scrollTop = scroll;
  }

  private afterRender() {
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    if (p.kind === 'edit') {
      // 放到下一个宏任务：此刻浏览器可能还要处理触发本次渲染的那次点击的默认聚焦
      setTimeout(() => {
        const input = this.deriveEl.querySelector<HTMLInputElement>('.rhs-input');
        if (!input) return;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        input.scrollIntoView({ block: 'nearest' });
      }, 0);
    } else if (p.kind === 'reveal') {
      const key = M.pathKey(p.path);
      const target = [...this.deriveEl.querySelectorAll<HTMLElement>('.term')].find((b) => b.dataset.key === key);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      this.inspEl.querySelector<HTMLInputElement>('.act-add__text')?.focus();
    }
  }

  // ---------- 读辅助 ----------

  private rootNode(): TermNode {
    return this.state.topic!.root;
  }

  private canEditFormula(): boolean {
    return this.editable && this.state.mode === 'cognition';
  }

  // ---------- 交互：公式视图 ----------

  private clickTerm(path: Path, isLhs: boolean) {
    const s = this.state;
    if (!s.topic) return;
    const key = M.pathKey(path);
    const node = M.getNode(s.topic.root, path);
    const already = selKey(s.selected) === key;

    // 公式左边 / 根：只选中，不动展开状态
    if (isLhs || path.length === 0) {
      this.update(S.select(s, path));
      return;
    }
    if (node?.expr) {
      // 第一次点：选中并确保展开；再点已选中的：收起 / 展开切换
      let next = S.select(s, path);
      if (!s.expanded.has(key) || already) next = S.toggleExpand(next, path);
      this.update(next);
      return;
    }
    if (this.canEditFormula()) {
      this.beginFormula(path);
      return;
    }
    this.update(S.select(s, path));
  }

  /** 给一个还没有公式的词开始写公式（生成「词 = 」并进入编辑；空着取消则整体还原） */
  private beginFormula(path: Path) {
    const s = this.state;
    if (!s.topic || !this.canEditFormula() || path.length === 0) return;
    if (M.getNode(s.topic.root, path)?.expr) {
      this.startEdit(path);
      return;
    }
    const [next, res] = S.startFormula(s, path);
    if (!res?.ok) {
      if (res?.error) toast(res.error, 'error');
      return;
    }
    this.editing = { key: M.pathKey(path), draft: '', baseRoot: s.topic.root };
    this.pending = { kind: 'edit' };
    this.update(S.select(next, path));
  }

  private startEdit(path: Path) {
    const s = this.state;
    if (!s.topic || !this.canEditFormula()) return;
    const node = M.getNode(s.topic.root, path);
    if (!node?.expr) return;
    this.flush();
    this.editing = { key: M.pathKey(path), draft: parseExpr(node.expr).rhs };
    this.pending = { kind: 'edit' };
    this.deriveHtml = '';
    this.renderAll(this.state);
  }

  private commitEdit(path: Path, value: string, via: 'enter' | 'blur') {
    const ed = this.editing;
    if (!ed || ed.key !== M.pathKey(path) || !this.state.topic) return;
    const v = value.trim();
    if (!v && ed.baseRoot) {
      this.cancelEdit(path);
      return;
    }
    const res = M.setRhs(this.rootNode(), path, v);
    if (!res.ok) {
      toast(res.error ?? '公式无法解析', 'error');
      ed.draft = value;
      if (via === 'enter') this.pending = { kind: 'edit' };
      this.deriveHtml = '';
      this.renderAll(this.state);
      return;
    }
    this.editing = null;
    this.apply(res, 'cognition', ed.baseRoot);
  }

  private cancelEdit(path: Path) {
    const ed = this.editing;
    if (!ed || ed.key !== M.pathKey(path)) return;
    this.editing = null;
    if (ed.baseRoot && this.state.topic) {
      this.update(S.applyEdit(this.state, { ok: true, root: ed.baseRoot }));
    } else {
      this.renderAll(this.state);
    }
  }

  /** 切主题等场景：丢弃进行中的编辑态（不提交，不重绘） */
  private cancelEditingSilently() {
    this.editing = null;
  }

  private jump(path: Path) {
    this.pending = { kind: 'reveal', path };
    this.update(S.reveal(this.state, path));
  }

  // ---------- 编辑落地：历史 + 保存 ----------

  /**
   * 应用一次模型编辑。need 限定必须处于哪种模式；base 给出时，历史记的是它而不是当前根
   * （「刚点开的空公式」取消 / 提交时，撤销点要回到点开之前）。
   * keepInspector：来自检查器自己的输入框，不要重绘检查器（否则正在聚焦的输入会被换掉）。
   */
  private apply(res: M.EditResult, need?: Mode, base?: TermNode, keepInspector = false): boolean {
    const topic = this.state.topic;
    if (!topic || (need && this.state.mode !== need)) return false;
    if (!res.ok) {
      toast(res.error ?? '无法修改', 'error');
      return false;
    }
    const before = base ?? topic.root;
    if (JSON.stringify(res.root) === JSON.stringify(before)) {
      this.renderAll(this.state);
      return false;
    }
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.keepInspector = keepInspector;
    this.update(S.applyEdit(this.state, res));
    if (res.dropped) toast(`已移除 ${res.dropped} 个下层词，可用 ⌘Z 撤销`);
    this.scheduleSave();
    return true;
  }

  private undoOp() {
    this.flush();
    const prev = this.undoStack.pop();
    if (prev === undefined || !this.state.topic) return;
    this.redoStack.push(this.rootNode());
    this.update(S.applyEdit(this.state, { ok: true, root: prev }));
    this.scheduleSave();
  }

  private redoOp() {
    this.flush();
    const next = this.redoStack.pop();
    if (next === undefined || !this.state.topic) return;
    this.undoStack.push(this.rootNode());
    this.update(S.applyEdit(this.state, { ok: true, root: next }));
    this.scheduleSave();
  }

  private scheduleSave() {
    this.dirty = true;
    this.state = S.withSave(this.state, 'saving');
    this.syncStatus();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flushSave(), SAVE_DELAY);
  }

  private flushSave(keepalive = false): Promise<void> {
    clearTimeout(this.saveTimer);
    if (this.flushing) return this.flushing;
    const run = (async () => {
      while (this.dirty) {
        const topic = this.state.topic;
        if (!topic) break;
        this.dirty = false;
        this.state = S.withSave(this.state, 'saving');
        this.syncStatus();
        try {
          await this.store.saveTopic(topic, { keepalive });
        } catch (e) {
          this.dirty = true;
          this.state = S.withSave(this.state, 'error');
          this.syncStatus();
          toast(msgOf(e), 'error');
          return;
        }
      }
      if (this.editable && this.state.save === 'saving') {
        this.state = S.withSave(this.state, 'saved');
        this.syncStatus();
      }
    })();
    this.flushing = run;
    // 在赋值之后清理：run 可能同步结束（没有脏数据），放在 async 体内的 finally 会先于赋值执行
    void run.finally(() => {
      if (this.flushing === run) this.flushing = null;
    });
    return run;
  }

  private async createTopic(title: string) {
    try {
      const topic = await this.store.createTopic(title);
      const manifest = await this.store.reloadManifest();
      this.state = S.withManifest(this.state, manifest);
      await this.openTopic(topic.id, [], 'push');
      if (this.state.mode !== 'cognition') this.setMode('cognition');
      this.startEdit([]);
    } catch (e) {
      toast(msgOf(e), 'error');
    }
  }

  private setMode(mode: Mode) {
    if (mode === this.state.mode) return;
    this.flush();
    this.cancelEditingSilently();
    applyMode(mode);
    this.deriveHtml = '';
    this.update(S.setMode(this.state, mode));
  }

  // ---------- DOM 骨架 ----------

  private buildToolbar(): HTMLElement {
    const bar = el('div', 'toolbar');

    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', '模式');
    this.modeBtns = {
      cognition: btn('seg__item', '☀ 认知', '认知模式：只能展开和编辑公式', () => this.setMode('cognition')),
      action: btn('seg__item', '☾ 行动', '行动模式：公式只读，只往词上挂抓手和想法', () => this.setMode('action')),
    };
    seg.append(this.modeBtns.cognition, this.modeBtns.action);

    const hist = el('div', 'group');
    this.undoBtn = btn('btn btn--icon', '↶', '撤销 (⌘Z)', () => this.undoOp());
    this.redoBtn = btn('btn btn--icon', '↷', '重做 (⇧⌘Z)', () => this.redoOp());
    hist.append(this.undoBtn, this.redoBtn);

    const depth = el('div', 'group');
    depth.appendChild(el('span', 'group__label', '展开'));
    for (const [label, d] of [['2', 2], ['3', 3], ['全部', Infinity]] as const) {
      depth.appendChild(btn('btn btn--icon', label, `展开到第 ${label} 层`, () => this.update(S.expandToDepth(this.state, d))));
    }
    depth.appendChild(btn('btn btn--icon', '收起', '只留根公式', () => this.update(S.collapseAll(this.state))));

    bar.append(seg, hist, depth, this.statusEl);
    return bar;
  }

  private buildDom() {
    this.host.className = 'app';
    const top = el('header', 'topbar');
    const heading = el('div', 'topbar__heading');
    heading.append(this.titleEl, this.subEl);
    top.append(heading, this.buildToolbar());

    this.deriveEl.setAttribute('aria-label', '公式推导');
    this.deriveEl.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.term, .formula__edit, .rhs-input, .rhs-empty') && this.state.selected) {
        this.update(S.select(this.state, null));
      }
    });
    this.inspEl.setAttribute('aria-label', '检查器');

    const main = el('div', 'main');
    main.append(this.deriveEl, this.inspEl);
    this.host.replaceChildren(top, main, this.tabs.el);
  }
}
