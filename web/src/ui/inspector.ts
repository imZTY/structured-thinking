/**
 * ui/inspector.ts —— 右侧检查器：围绕「选中的词」。
 *   认知模式：改本质问题 / 说明 / 详情，展开成公式或取消展开
 *   行动模式：公式与说明只读，只管理挂在这个词上的抓手 / 想法
 */

import type { Action, Mode, Path, TermNode, Topic } from '../core/types';
import { parseExpr } from '../core/formula';
import { findPathById, getNode, type TextField } from '../core/model';
import { btn, el } from './dom';
import { renderMd } from './md';

export interface InspectorCtx {
  topic: Topic;
  selected: Path | null;
  mode: Mode;
  /** 本地 dev 服务在场（可写回） */
  editable: boolean;
  /** 选中的词是否被红圈圈选 */
  circled: boolean;
  /** 选中的词是否被高亮标注 */
  highlighted: boolean;
  on: {
    select(path: Path | null): void;
    toggleCircle(path: Path): void;
    toggleHighlight(path: Path): void;
    jump(path: Path): void;
    expandAsFormula(path: Path): void;
    removeFormula(path: Path): void;
    setFields(path: Path, patch: Partial<Record<TextField, string>>): void;
    setRootLhs(lhs: string): void;
    addAction(path: Path, kind: string, text: string): void;
    updateAction(path: Path, index: number, patch: Partial<Action>): void;
    removeAction(path: Path, index: number): void;
  };
}

const KIND_LABEL: Record<string, string> = { action: '动作', idea: '想法' };
const STATUS_ORDER = ['todo', 'doing', 'done'];
const STATUS_LABEL: Record<string, string> = { todo: '待办', doing: '进行中', done: '完成' };
const STATUS_GLYPH: Record<string, string> = { todo: '○', doing: '◐', done: '●' };

let lastKind = 'action';

export function rootLhs(topic: Topic): string {
  return parseExpr(topic.root.expr ?? '').lhs || topic.title;
}

function labelOf(topic: Topic, path: Path): string {
  return path.length ? path[path.length - 1] : rootLhs(topic);
}

export function renderInspector(ctx: InspectorCtx): HTMLElement {
  const box = el('div', 'insp');
  if (!ctx.selected) {
    overview(ctx, box);
    return box;
  }
  const path = ctx.selected;
  const node = getNode(ctx.topic.root, path);
  const cognition = ctx.mode === 'cognition';

  box.appendChild(btn('insp__close', '×', '回到概述 (Esc)', () => ctx.on.select(null)));
  box.appendChild(crumbs(ctx, path));

  // 标题：根的名称在认知模式下可改（它是主题的核心命题名），其余由父公式决定
  if (path.length === 0 && cognition && ctx.editable) {
    const input = el('input', 'insp__name');
    input.type = 'text';
    input.value = rootLhs(ctx.topic);
    input.setAttribute('aria-label', '核心命题名');
    input.addEventListener('change', () => ctx.on.setRootLhs(input.value));
    box.appendChild(input);
  } else {
    box.appendChild(el('h2', 'insp__title', labelOf(ctx.topic, path)));
  }

  box.appendChild(tools(ctx, path));

  // 公式状态
  if (node?.expr) {
    box.appendChild(el('div', 'insp__expr', node.expr));
    if (cognition && ctx.editable && path.length > 0) {
      box.appendChild(
        btn('btn btn--ghost insp__danger', '取消展开（删除这条公式）', '删除这个词的公式和它下面所有层，可撤销', () =>
          ctx.on.removeFormula(path),
        ),
      );
    }
  } else if (cognition && ctx.editable) {
    box.appendChild(btn('btn', '展开成公式', '给这个词写它自己的公式', () => ctx.on.expandAsFormula(path)));
  } else {
    box.appendChild(el('p', 'insp__muted', '这个词还没有被展开成公式。'));
  }

  // 认知字段
  if (cognition && ctx.editable) {
    box.appendChild(
      textField('本质问题', node?.question ?? '', false, '它回答的是什么问题？', (v) =>
        ctx.on.setFields(path, { question: v }),
      ),
    );
    box.appendChild(
      textField('说明', node?.note ?? '', true, '一两句话，支持 markdown', (v) =>
        ctx.on.setFields(path, { note: v }),
      ),
    );
    box.appendChild(
      textField('详情', node?.details ?? '', true, '长文，支持 markdown', (v) =>
        ctx.on.setFields(path, { details: v }),
      ),
    );
  } else {
    box.appendChild(readonlyText(node));
  }

  // 跨词关联与参考资料（只读；在 topic.json 里直接维护）
  if (node?.links?.length) {
    const sec = section('关联');
    const chips = el('div', 'chips');
    for (const l of node.links) {
      const target = findPathById(ctx.topic.root, l.to);
      const text = `${target ? labelOf(ctx.topic, target) : l.to}${l.rel ? ` · ${l.rel}` : ''}`;
      const chip = btn('chip', text, target ? '跳转到它' : '目标不存在', () => target && ctx.on.jump(target));
      chip.disabled = !target;
      chips.appendChild(chip);
    }
    sec.appendChild(chips);
    box.appendChild(sec);
  }
  if (node?.refs?.length) {
    const sec = section('参考资料');
    const list = el('ul', 'insp__list');
    for (const r of node.refs) {
      const li = el('li');
      if (r.url && /^(https?:|mailto:)/i.test(r.url)) {
        const a = el('a', '', r.label);
        a.href = r.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        li.appendChild(a);
      } else {
        li.textContent = r.label;
      }
      list.appendChild(li);
    }
    sec.appendChild(list);
    box.appendChild(sec);
  }

  if (!cognition) box.appendChild(actionsSection(ctx, path, node));
  return box;
}

function overview(ctx: InspectorCtx, box: HTMLElement) {
  const t = ctx.topic;
  box.appendChild(el('h2', 'insp__title', t.title));
  if (t.subtitle) box.appendChild(el('p', 'insp__sub', t.subtitle));
  if (t.tags?.length) {
    const tags = el('div', 'tags');
    for (const tag of t.tags) tags.appendChild(el('span', 'tag', tag));
    box.appendChild(tags);
  }
  if (t.summary) {
    const md = el('div', 'md');
    md.innerHTML = renderMd(t.summary);
    box.appendChild(md);
  }
  box.appendChild(
    el(
      'p',
      'insp__hint',
      ctx.mode === 'cognition'
        ? '认知模式：点一个词展开它的公式。没有公式的词，点一下就开始写。'
        : '行动模式：公式只读。选中一个词，给它挂上抓手或想法。',
    ),
  );
}

function crumbs(ctx: InspectorCtx, path: Path): HTMLElement {
  const nav = el('nav', 'insp__crumb');
  nav.setAttribute('aria-label', '词的路径');
  const items: Path[] = [[]];
  for (let i = 1; i <= path.length; i++) items.push(path.slice(0, i));
  items.forEach((p, i) => {
    if (i > 0) nav.appendChild(el('span', 'insp__sep', '›'));
    const last = i === items.length - 1;
    if (last) nav.appendChild(el('span', 'insp__crumb-cur', labelOf(ctx.topic, p)));
    else nav.appendChild(btn('insp__crumb-item', labelOf(ctx.topic, p), undefined, () => ctx.on.select(p)));
  });
  return nav;
}

/** 选中词的通用操作：两种模式下都可用，只影响画面不改内容。后续的演示 / 标注类操作往这一行加按钮 */
function tools(ctx: InspectorCtx, path: Path): HTMLElement {
  const row = el('div', 'insp__tools');
  row.appendChild(el('span', 'insp__tools-label', '标注'));
  const circle = btn(
    'btn btn--tool' + (ctx.circled ? ' btn--on' : ''),
    ctx.circled ? '◯ 取消圈选' : '◯ 圈选',
    '用红圈标出它；已展开下层时一并圈住。导出图片会带上',
    () => ctx.on.toggleCircle(path),
  );
  circle.setAttribute('aria-pressed', String(ctx.circled));
  row.appendChild(circle);
  const highlight = btn(
    'btn btn--tool btn--tool-hl' + (ctx.highlighted ? ' btn--on btn--on-hl' : ''),
    ctx.highlighted ? '▮ 取消高亮' : '▮ 高亮',
    '用暖色底突出显示它。导出图片会带上',
    () => ctx.on.toggleHighlight(path),
  );
  highlight.setAttribute('aria-pressed', String(ctx.highlighted));
  row.appendChild(highlight);
  return row;
}

function readonlyText(node: TermNode | undefined): HTMLElement {
  const wrap = el('div', 'insp__ro');
  if (node?.question) wrap.appendChild(el('p', 'insp__question', node.question));
  const md = [node?.note, node?.details].filter(Boolean).join('\n\n');
  if (md) {
    const body = el('div', 'md');
    body.innerHTML = renderMd(md);
    wrap.appendChild(body);
  }
  return wrap;
}

function textField(
  label: string,
  value: string,
  multiline: boolean,
  placeholder: string,
  onCommit: (v: string) => void,
): HTMLElement {
  const wrap = el('label', 'field');
  wrap.appendChild(el('span', 'field__label', label));
  const input = multiline ? el('textarea', 'field__input') : el('input', 'field__input');
  if (input instanceof HTMLInputElement) input.type = 'text';
  if (input instanceof HTMLTextAreaElement) input.rows = 3;
  input.value = value;
  input.placeholder = placeholder;
  // change = 失焦且内容变了才提交；提交一次是一步撤销
  input.addEventListener('change', () => onCommit(input.value));
  wrap.appendChild(input);
  return wrap;
}

function section(title: string): HTMLElement {
  const s = el('section', 'insp__section');
  s.appendChild(el('h3', '', title));
  return s;
}

// ---------- 行动层 ----------

function actionsSection(ctx: InspectorCtx, path: Path, node: TermNode | undefined): HTMLElement {
  const actions = node?.actions ?? [];
  const sec = section(`行动层 · ${actions.length}`);
  sec.classList.add('insp__actions');

  if (!actions.length) {
    sec.appendChild(el('p', 'insp__muted', ctx.editable ? '还没有抓手或想法。在下面写第一条。' : '还没有抓手或想法。'));
  }
  const list = el('ul', 'acts');
  actions.forEach((a, i) => list.appendChild(actionRow(ctx, path, a, i)));
  if (actions.length) sec.appendChild(list);

  if (ctx.editable) sec.appendChild(addForm(ctx, path));
  return sec;
}

function actionRow(ctx: InspectorCtx, path: Path, a: Action, index: number): HTMLElement {
  const li = el('li', 'act' + (a.status === 'done' ? ' act--done' : ''));
  li.appendChild(el('span', 'act__kind', KIND_LABEL[a.kind] ?? a.kind));

  const hasStatus = a.kind === 'action';
  if (hasStatus) {
    const cur = a.status && STATUS_ORDER.includes(a.status) ? a.status : 'todo';
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(cur) + 1) % STATUS_ORDER.length];
    const st = el('button', 'act__status', STATUS_GLYPH[cur]);
    st.type = 'button';
    st.title = `${STATUS_LABEL[cur]}，点击改为「${STATUS_LABEL[next]}」`;
    st.setAttribute('aria-label', `状态：${STATUS_LABEL[cur]}`);
    if (ctx.editable) st.addEventListener('click', () => ctx.on.updateAction(path, index, { status: next }));
    else st.disabled = true;
    li.appendChild(st);
  }

  if (ctx.editable) {
    const input = el('input', 'act__text');
    input.type = 'text';
    input.value = a.text;
    input.setAttribute('aria-label', '内容');
    input.addEventListener('change', () => ctx.on.updateAction(path, index, { text: input.value }));
    li.appendChild(input);
    li.appendChild(btn('act__del', '×', '删除这一条', () => ctx.on.removeAction(path, index)));
  } else {
    li.appendChild(el('span', 'act__text act__text--ro', a.text));
  }
  return li;
}

function addForm(ctx: InspectorCtx, path: Path): HTMLElement {
  const form = el('form', 'act-add');
  const kind = el('select', 'act-add__kind');
  kind.setAttribute('aria-label', '类型');
  for (const [v, label] of Object.entries(KIND_LABEL)) {
    const o = el('option', '', label);
    o.value = v;
    kind.appendChild(o);
  }
  kind.value = lastKind;

  const text = el('input', 'act-add__text');
  text.type = 'text';
  text.placeholder = '抓手 / 想法……';
  text.setAttribute('aria-label', '内容');
  text.autocomplete = 'off';

  const add = el('button', 'btn', '添加');
  add.type = 'submit';

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = text.value.trim();
    if (!v) return;
    lastKind = kind.value;
    ctx.on.addAction(path, kind.value, v);
  });
  // 中文输入法选词的回车不能触发提交
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.isComposing) e.stopPropagation();
  });
  form.append(kind, text, add);
  return form;
}
