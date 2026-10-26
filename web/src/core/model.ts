/**
 * core/model.ts —— 对词树（TermNode）的纯函数编辑。全部不可变：返回新根，不改入参。
 *
 * 约定：
 * - Path 是从根到某个词的词链；空数组 = 根。
 * - 一个词不一定有节点（没展开过、没挂过内容的词只是公式里的文字）。
 * - 编辑后自动清掉「空壳节点」，保证 JSON 里不留垃圾。
 */

import type { Action, Path, TermNode } from './types';
import { RELATIONS, buildExpr, parseExpr, withLhs, type Segment } from './formula';

export const KEY_SEP = "\u001f";
export const pathKey = (p: Path): string => p.join(KEY_SEP);
export const keyToPath = (k: string): Path => (k === '' ? [] : k.split(KEY_SEP));

export interface EditResult {
  ok: boolean;
  root: TermNode;
  error?: string;
  /** 因公式改动被丢弃的节点数（含更深层），用于提示 */
  dropped?: number;
  /** 一次改名：parent 公式里的 from 被改成了 to；调用方据此重映射展开 / 选中路径 */
  renamed?: { parent: Path; from: string; to: string };
}

const fail = (root: TermNode, error: string): EditResult => ({ ok: false, root, error });

// ---------- 读 ----------

export function getNode(root: TermNode, path: Path): TermNode | undefined {
  let n: TermNode | undefined = root;
  for (const k of path) {
    n = n?.terms?.[k];
    if (!n) return undefined;
  }
  return n;
}

/** 某节点公式右边的词（无公式 = 空） */
export function termsOf(node: TermNode | undefined): string[] {
  if (!node?.expr) return [];
  const p = parseExpr(node.expr);
  return p.ok ? p.terms : [];
}

/** path 是否指向一个真实存在的词：每一级的键都出现在上一级公式的右边 */
export function isValidPath(root: TermNode, path: Path): boolean {
  let n: TermNode | undefined = root;
  for (const k of path) {
    if (!termsOf(n).includes(k)) return false;
    n = n?.terms?.[k];
  }
  return true;
}

/** path 的最长合法前缀 */
export function resolvePath(root: TermNode, path: Path): Path {
  let n: TermNode | undefined = root;
  const out: Path = [];
  for (const k of path) {
    if (!termsOf(n).includes(k)) break;
    out.push(k);
    n = n?.terms?.[k];
  }
  return out;
}

/** 按 id（links 的目标）反查词链；找不到返回 null */
export function findPathById(root: TermNode, id: string): Path | null {
  const visit = (node: TermNode, path: Path): Path | null => {
    if (node.id === id) return path;
    for (const [k, c] of Object.entries(node.terms ?? {})) {
      const hit = visit(c, [...path, k]);
      if (hit) return hit;
    }
    return null;
  };
  return visit(root, []);
}

export function countNodes(node: TermNode): number {
  let c = 1;
  for (const child of Object.values(node.terms ?? {})) c += countNodes(child);
  return c;
}

/** 展开到第 depth 层公式时需要展开的键集合（根公式算第 1 层，根自身不入集合） */
export function expandedToDepth(root: TermNode, depth: number): Set<string> {
  const out = new Set<string>();
  const visit = (node: TermNode, path: Path, level: number) => {
    if (level >= depth) return;
    for (const t of termsOf(node)) {
      const child = node.terms?.[t];
      if (!child?.expr) continue;
      const p = [...path, t];
      out.add(pathKey(p));
      visit(child, p, level + 1);
    }
  };
  visit(root, [], 1);
  return out;
}

// ---------- 写（内部） ----------

function isBlank(n: TermNode): boolean {
  return Object.keys(n).length === 0;
}

function prune(node: TermNode): TermNode {
  if (!node.terms) return node;
  const terms: Record<string, TermNode> = {};
  let changed = false;
  for (const [k, c] of Object.entries(node.terms)) {
    const pc = prune(c);
    if (isBlank(pc)) {
      changed = true;
      continue;
    }
    if (pc !== c) changed = true;
    terms[k] = pc;
  }
  if (!changed) return node;
  const next = { ...node };
  if (Object.keys(terms).length) next.terms = terms;
  else delete next.terms;
  return next;
}

/** 让 terms 的键顺序与公式右边出现的顺序一致，输出的 JSON 才稳定可读 */
function orderTerms(node: TermNode, terms: Record<string, TermNode>): Record<string, TermNode> {
  const order = termsOf(node);
  const sorted: Record<string, TermNode> = {};
  for (const k of order) if (k in terms) sorted[k] = terms[k];
  for (const k of Object.keys(terms)) if (!(k in sorted)) sorted[k] = terms[k];
  return sorted;
}

/** 在 path 处替换节点；fn 返回 undefined = 删除（根不可删） */
function mapNode(node: TermNode, path: Path, fn: (n: TermNode | undefined) => TermNode | undefined): TermNode {
  if (path.length === 0) return fn(node) ?? node;
  const [k, ...rest] = path;
  const child = node.terms?.[k];
  let nextChild: TermNode | undefined;
  if (rest.length === 0) nextChild = fn(child);
  else if (child) nextChild = mapNode(child, rest, fn);
  else return node;
  const terms = { ...(node.terms ?? {}) };
  if (nextChild === undefined) delete terms[k];
  else terms[k] = nextChild;
  const next = { ...node };
  if (Object.keys(terms).length) next.terms = orderTerms(node, terms);
  else delete next.terms;
  return next;
}

function commit(root: TermNode, extra: Partial<EditResult> = {}): EditResult {
  return { ok: true, root: prune(root), ...extra };
}

// ---------- 公式 ----------

/** 把 parent 公式里的一个词展开成它自己的公式（已有公式则原样返回） */
export function expandTerm(root: TermNode, parent: Path, term: string): EditResult {
  const pn = getNode(root, parent);
  if (!termsOf(pn).includes(term)) return fail(root, '这个词不在公式右边');
  const next = mapNode(root, [...parent, term], (n) => (n?.expr ? n : { ...(n ?? {}), expr: buildExpr(term, '') }));
  return commit(next);
}

/** 改写某条公式的右边。左边不动，保证子公式左边始终等于它在父公式里的词 */
export function setRhs(root: TermNode, path: Path, rhs: string): EditResult {
  const node = getNode(root, path);
  if (!node?.expr) return fail(root, '这个词还没有公式');
  const old = parseExpr(node.expr);
  if (!old.ok) return fail(root, old.error ?? '公式无法解析');
  if (RELATIONS.some((r) => rhs.includes(r))) return fail(root, '右边不能再出现等号');

  const expr = buildExpr(old.lhs, rhs.trim(), old.rel);
  const np = parseExpr(expr);
  if (!np.ok) return fail(root, np.error ?? '公式无法解析');
  if (expr === node.expr) return { ok: true, root };

  const rename = detectRename(old.segments, np.segments, old.terms, np.terms);
  const terms: Record<string, TermNode> = { ...(node.terms ?? {}) };
  if (rename) {
    const [from, to] = rename;
    const moved = terms[from];
    if (moved) {
      delete terms[from];
      terms[to] = moved.expr ? { ...moved, expr: withLhs(moved.expr, to) } : moved;
    }
  }
  let dropped = 0;
  for (const k of Object.keys(terms)) {
    if (!np.terms.includes(k)) {
      dropped += countNodes(terms[k]);
      delete terms[k];
    }
  }
  const nextNode: TermNode = { ...node, expr };
  if (Object.keys(terms).length) nextNode.terms = orderTerms(nextNode, terms);
  else delete nextNode.terms;

  return commit(mapNode(root, path, () => nextNode), {
    dropped: dropped || undefined,
    renamed: rename ? { parent: path, from: rename[0], to: rename[1] } : undefined,
  });
}

/** 改根公式的左边（主题的核心命题名）。非根节点的左边由父公式决定，不可改 */
export function setRootLhs(root: TermNode, lhs: string): EditResult {
  const l = lhs.trim();
  if (!root.expr) return fail(root, '根节点没有公式');
  if (!l) return fail(root, '左边不能为空');
  if (RELATIONS.some((r) => l.includes(r))) return fail(root, '左边不能出现等号');
  return commit({ ...root, expr: withLhs(root.expr, l) });
}

/** 取消展开：删掉这个词的公式及其下所有子公式，保留它自己的说明与行动 */
export function removeFormula(root: TermNode, path: Path): EditResult {
  if (path.length === 0) return fail(root, '根公式不能删除');
  const node = getNode(root, path);
  if (!node?.expr) return { ok: true, root };
  let dropped = 0;
  for (const c of Object.values(node.terms ?? {})) dropped += countNodes(c);
  const next = mapNode(root, path, (n) => {
    const { expr: _e, terms: _t, ...rest } = n ?? {};
    return rest;
  });
  return commit(next, { dropped: dropped || undefined });
}

/** 只有一个词被整体改名时视为改名（保住它的子树）；其余情况按新增 / 删除处理 */
function detectRename(
  oldSegs: Segment[],
  newSegs: Segment[],
  oldTerms: string[],
  newTerms: string[],
): [string, string] | null {
  const a = oldSegs.filter((s) => s.kind === 'term').map((s) => s.text);
  const b = newSegs.filter((s) => s.kind === 'term').map((s) => s.text);
  if (a.length !== b.length) return null;
  const diffs = new Map<string, string>();
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const prev = diffs.get(a[i]);
    if (prev !== undefined && prev !== b[i]) return null;
    diffs.set(a[i], b[i]);
  }
  if (diffs.size !== 1) return null;
  const [from, to] = [...diffs][0];
  if (newTerms.includes(from)) return null;
  if (oldTerms.includes(to)) return null;
  return [from, to];
}

// ---------- 认知字段 ----------

export type TextField = 'question' | 'note' | 'details';

export function setFields(root: TermNode, path: Path, patch: Partial<Record<TextField, string>>): EditResult {
  if (!isValidPath(root, path)) return fail(root, '这个词不存在');
  const next = mapNode(root, path, (n) => {
    const out: TermNode = { ...(n ?? {}) };
    for (const [k, v] of Object.entries(patch) as [TextField, string][]) {
      if (v.trim()) out[k] = v;
      else delete out[k];
    }
    return out;
  });
  return commit(next);
}

// ---------- 行动层 ----------

export function addAction(root: TermNode, path: Path, action: Action): EditResult {
  if (!isValidPath(root, path)) return fail(root, '这个词不存在');
  const text = action.text.trim();
  if (!text) return fail(root, '内容不能为空');
  const next = mapNode(root, path, (n) => ({ ...(n ?? {}), actions: [...(n?.actions ?? []), { ...action, text }] }));
  return commit(next);
}

export function updateAction(root: TermNode, path: Path, index: number, patch: Partial<Action>): EditResult {
  const node = getNode(root, path);
  const cur = node?.actions?.[index];
  if (!node || !cur) return fail(root, '这条行动不存在');
  if (patch.text !== undefined && !patch.text.trim()) return removeAction(root, path, index);
  const merged: Action = { ...cur, ...patch };
  if (patch.text !== undefined) merged.text = patch.text.trim();
  if ('status' in patch && patch.status === undefined) delete merged.status;
  const actions = node.actions!.map((a, i) => (i === index ? merged : a));
  return commit(mapNode(root, path, (n) => ({ ...n!, actions })));
}

export function removeAction(root: TermNode, path: Path, index: number): EditResult {
  const node = getNode(root, path);
  if (!node?.actions?.[index]) return fail(root, '这条行动不存在');
  const actions = node.actions.filter((_, i) => i !== index);
  const next = mapNode(root, path, (n) => {
    const out = { ...n! };
    if (actions.length) out.actions = actions;
    else delete out.actions;
    return out;
  });
  return commit(next);
}
