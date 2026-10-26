/**
 * ui/derive.ts —— 推导式视图：一条条公式自上而下堆叠。
 * 展开一个词，它自己的公式就铺在这条公式的正下方（缩进 + 左侧细线）；再展开再往下。
 *
 *   词的下划线语义：粗实线 = 已展开；点线 = 有公式但收起；无线 = 还没有公式
 */

import type { Mode, Path, TermNode } from '../core/types';
import { displayOp, parseExpr } from '../core/formula';
import { getNode, pathKey } from '../core/model';
import { btn, el } from './dom';

export interface EditingState {
  key: string;
  draft: string;
}

export interface DeriveCtx {
  root: TermNode;
  expanded: Set<string>;
  selected: Path | null;
  mode: Mode;
  /** 认知模式且可写：才显示公式编辑入口 */
  canEditFormula: boolean;
  editing: EditingState | null;
  on: {
    clickTerm(path: Path, isLhs: boolean): void;
    startEdit(path: Path): void;
    commitEdit(path: Path, value: string, via: 'enter' | 'blur'): void;
    cancelEdit(path: Path): void;
  };
}

export function renderDerive(ctx: DeriveCtx): HTMLElement {
  const stack = el('div', 'derive__stack');
  stack.appendChild(formulaBlock(ctx, ctx.root, []));
  return stack;
}

function formulaBlock(ctx: DeriveCtx, node: TermNode, path: Path): HTMLElement {
  const key = pathKey(path);
  const block = el('section', 'formula' + (path.length === 0 ? ' formula--root' : ''));
  const line = el('div', 'formula__line');
  block.appendChild(line);

  const parsed = parseExpr(node.expr ?? '');
  if (!parsed.ok) {
    line.classList.add('formula__line--bad');
    line.title = parsed.error ?? '公式无法解析';
    line.appendChild(el('span', 'formula__raw', node.expr ?? ''));
    return block;
  }

  line.appendChild(termButton(ctx, path, parsed.lhs, true));
  line.appendChild(el('span', 'rel', parsed.rel === '＝' ? '=' : parsed.rel));

  const editing = ctx.editing?.key === key;
  const rhs = el('span', 'formula__rhs');
  if (editing) {
    rhs.classList.add('formula__rhs--edit');
    rhs.appendChild(rhsEditor(ctx, path, ctx.editing!.draft));
  } else if (parsed.segments.length === 0) {
    rhs.appendChild(
      ctx.canEditFormula
        ? btn('rhs-empty', '点此填写公式右边', undefined, () => ctx.on.startEdit(path))
        : el('span', 'rhs-empty rhs-empty--ro', '（还没有展开）'),
    );
  } else {
    for (const seg of parsed.segments) {
      if (seg.kind === 'term') rhs.appendChild(termButton(ctx, [...path, seg.text], seg.text, false));
      else if (seg.kind === 'num') rhs.appendChild(el('span', 'num', seg.text));
      else rhs.appendChild(el('span', `op ${opClass(seg.text)}`, displayOp(seg.text)));
    }
  }
  line.appendChild(rhs);

  if (ctx.canEditFormula && !editing && parsed.segments.length > 0) {
    line.appendChild(btn('formula__edit', '✎', '编辑这条公式的右边', () => ctx.on.startEdit(path)));
  }

  const kids = el('div', 'formula__kids');
  for (const t of parsed.terms) {
    const child = node.terms?.[t];
    const childPath = [...path, t];
    if (child?.expr && ctx.expanded.has(pathKey(childPath))) kids.appendChild(formulaBlock(ctx, child, childPath));
  }
  if (kids.childElementCount) block.appendChild(kids);
  return block;
}

function opClass(op: string): string {
  if ('()（）'.includes(op)) return 'op--paren';
  if (',，、;；'.includes(op)) return 'op--sep';
  return 'op--math';
}

function termButton(ctx: DeriveCtx, path: Path, text: string, isLhs: boolean): HTMLButtonElement {
  const key = pathKey(path);
  const node = getNode(ctx.root, path);
  const hasFormula = !!node?.expr;
  const open = hasFormula && (path.length === 0 || ctx.expanded.has(key));

  const b = el('button', 'term', text);
  b.type = 'button';
  b.dataset.key = key;
  if (isLhs) b.classList.add('term--lhs');
  if (hasFormula && !open) b.classList.add('term--has');
  if (open && !isLhs) b.classList.add('term--open');
  if (ctx.selected && pathKey(ctx.selected) === key) b.classList.add('term--sel');
  if (hasFormula && path.length > 0) b.setAttribute('aria-expanded', String(open));

  const n = node?.actions?.length ?? 0;
  if (ctx.mode === 'action' && n > 0 && (!isLhs || path.length === 0)) {
    b.appendChild(el('span', 'term__n', String(n)));
    b.setAttribute('aria-label', `${text}，${n} 条行动`);
  }
  b.addEventListener('click', () => ctx.on.clickTerm(path, isLhs));
  return b;
}

function rhsEditor(ctx: DeriveCtx, path: Path, draft: string): HTMLInputElement {
  const input = el('input', 'rhs-input');
  input.type = 'text';
  input.value = draft;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = '例：感知 + 响应 + 止损（选中文字按 ⌘B / Ctrl+B 包成一个词）';
  input.setAttribute('aria-label', '公式右边');

  // 草稿同步回编辑态：即使界面被动重绘，输入也不会丢
  input.addEventListener('input', () => {
    if (ctx.editing) ctx.editing.draft = input.value;
  });

  // 提交只发生一次：Enter 之后输入框被移除会再触发 blur
  let done = false;
  const finish = (via: 'enter' | 'blur') => {
    if (done) return;
    done = true;
    ctx.on.commitEdit(path, input.value, via);
  };
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // 中文输入法选词的回车不是提交
    if (e.key === 'Enter') {
      e.preventDefault();
      finish('enter');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done = true;
      ctx.on.cancelEdit(path);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrapSelection(input);
    }
  });
  input.addEventListener('blur', () => finish('blur'));
  return input;
}

function wrapSelection(input: HTMLInputElement) {
  const s = input.selectionStart;
  const e = input.selectionEnd;
  if (s === null || e === null || s === e) return;
  const v = input.value;
  input.value = `${v.slice(0, s)}[${v.slice(s, e)}]${v.slice(e)}`;
  input.setSelectionRange(s, e + 2);
}
