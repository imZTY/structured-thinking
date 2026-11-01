/**
 * core/appState.ts —— 顶层应用状态与派生动作（纯函数，不可变）。
 * ui 层订阅 render(state) 重绘；所有状态变更都走这里返回新 state。
 */

import type { Manifest, Mode, Path, Topic } from './types';
import {
  expandedToDepth,
  expandTerm,
  getNode,
  isValidPath,
  KEY_SEP,
  keyToPath,
  pathKey,
  resolvePath,
  type EditResult,
} from './model';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AppState {
  manifest: Manifest | null;
  topic: Topic | null;
  /** 已展开的词（pathKey）；只有带 expr 的词才会出现在这里 */
  expanded: Set<string>;
  /** 当前选中的词（检查器聚焦它）；null = 无选中 */
  selected: Path | null;
  /** 被红圈圈选的词（pathKey）；纯演示标注，不写回内容 */
  circled: Set<string>;
  /** 被高亮标注的词（pathKey）；纯演示标注，不写回内容 */
  highlighted: Set<string>;
  mode: Mode;
  /** 加载 / 保存的提示信息 */
  error: string | null;
  save: SaveStatus;
}

/**
 * 画面上看得见的状态：屏幕渲染和图片导出共用这一份。
 * 新增视图功能时把状态加进来，导出就会自动拿到。
 */
export type ViewState = Pick<AppState, 'expanded' | 'circled' | 'highlighted' | 'mode'>;

export const viewOf = (s: AppState): ViewState => ({
  expanded: s.expanded,
  circled: s.circled,
  highlighted: s.highlighted,
  mode: s.mode,
});

export const initialAppState: AppState = {
  manifest: null,
  topic: null,
  expanded: new Set(),
  selected: null,
  circled: new Set(),
  highlighted: new Set(),
  mode: 'cognition',
  error: null,
  save: 'idle',
};

export function withManifest(state: AppState, manifest: Manifest): AppState {
  return { ...state, manifest };
}

/** 载入主题：按 expandDepth 初始展开；selected 取路由里的词链（取最长合法前缀） */
export function withTopic(state: AppState, topic: Topic, selected: Path | null): AppState {
  const expanded = expandedToDepth(topic.root, topic.expandDepth ?? 2);
  let sel: Path | null = null;
  if (selected && selected.length) {
    sel = resolvePath(topic.root, selected);
    // 路由指向的词，其所有祖先公式必须展开才看得见
    for (let i = 1; i < sel.length; i++) expanded.add(pathKey(sel.slice(0, i)));
    if (sel.length === 0) sel = null;
  }
  return { ...state, topic, expanded, selected: sel, circled: new Set(), highlighted: new Set(), error: null, save: 'idle' };
}

export function withError(state: AppState, error: string | null): AppState {
  return { ...state, error };
}

export function withSave(state: AppState, save: SaveStatus): AppState {
  return { ...state, save };
}

export function setMode(state: AppState, mode: Mode): AppState {
  return { ...state, mode };
}

export function select(state: AppState, path: Path | null): AppState {
  return { ...state, selected: path };
}

/** 选中一个词，并把它的所有祖先公式展开，保证它在画面上可见（跳转 / 深链用） */
export function reveal(state: AppState, path: Path): AppState {
  if (!state.topic) return state;
  const sel = resolvePath(state.topic.root, path);
  const expanded = new Set(state.expanded);
  for (let i = 1; i < sel.length; i++) expanded.add(pathKey(sel.slice(0, i)));
  return { ...state, expanded, selected: sel };
}

/** 展开 / 收起一个已有公式的词 */
export function toggleExpand(state: AppState, path: Path): AppState {
  if (!state.topic || !getNode(state.topic.root, path)?.expr) return state;
  const key = pathKey(path);
  const expanded = new Set(state.expanded);
  if (expanded.has(key)) {
    // 收起时连带收起它下面的所有层，再展开时从干净状态开始
    for (const k of [...expanded]) if (k === key || k.startsWith(key + KEY_SEP)) expanded.delete(k);
  } else {
    expanded.add(key);
  }
  return { ...state, expanded };
}

/** 认知模式下展开一个还没有公式的词：先生成「词 = 」再展开。返回 [新状态, 编辑结果] */
export function startFormula(state: AppState, path: Path): [AppState, EditResult | null] {
  if (!state.topic || path.length === 0) return [state, null];
  const parent = path.slice(0, -1);
  const term = path[path.length - 1];
  const res = expandTerm(state.topic.root, parent, term);
  if (!res.ok) return [state, res];
  const expanded = new Set(state.expanded);
  expanded.add(pathKey(path));
  return [applyEdit({ ...state, expanded }, res), res];
}

export function expandToDepth(state: AppState, depth: number): AppState {
  if (!state.topic) return state;
  return { ...state, expanded: expandedToDepth(state.topic.root, depth) };
}

export function collapseAll(state: AppState): AppState {
  return { ...state, expanded: new Set() };
}

/** 切换一个词的红圈；路径无效时不动 */
export function toggleCircle(state: AppState, path: Path): AppState {
  if (!state.topic || !isValidPath(state.topic.root, path)) return state;
  const key = pathKey(path);
  const circled = new Set(state.circled);
  if (!circled.delete(key)) circled.add(key);
  return { ...state, circled };
}

/** 切换一个词的高亮；路径无效时不动 */
export function toggleHighlight(state: AppState, path: Path): AppState {
  if (!state.topic || !isValidPath(state.topic.root, path)) return state;
  const key = pathKey(path);
  const highlighted = new Set(state.highlighted);
  if (!highlighted.delete(key)) highlighted.add(key);
  return { ...state, highlighted };
}

export function clearCircles(state: AppState): AppState {
  return state.circled.size ? { ...state, circled: new Set() } : state;
}

export function clearHighlights(state: AppState): AppState {
  return state.highlighted.size ? { ...state, highlighted: new Set() } : state;
}

/**
 * 把一次编辑结果落到状态上：换根、改名时重映射展开 / 选中路径、清掉已失效的路径。
 * 失败的编辑（ok=false）原样返回，由调用方展示 error。
 */
export function applyEdit(state: AppState, res: EditResult): AppState {
  if (!state.topic || !res.ok) return state;
  const root = res.root;
  let expanded = state.expanded;
  let circled = state.circled;
  let highlighted = state.highlighted;
  let selected = state.selected;

  if (res.renamed) {
    const { parent, from, to } = res.renamed;
    const prefix = [...parent, from];
    const remap = (p: Path): Path =>
      p.length >= prefix.length && prefix.every((k, i) => p[i] === k)
        ? [...parent, to, ...p.slice(prefix.length)]
        : p;
    const remapKeys = (keys: Set<string>) => new Set([...keys].map((k) => pathKey(remap(keyToPath(k)))));
    expanded = remapKeys(expanded);
    circled = remapKeys(circled);
    highlighted = remapKeys(highlighted);
    if (selected) selected = remap(selected);
  }

  const kept = new Set<string>();
  for (const k of expanded) {
    const p = keyToPath(k);
    if (isValidPath(root, p) && getNode(root, p)?.expr) kept.add(k);
  }
  const keptCircled = new Set<string>();
  for (const k of circled) if (isValidPath(root, keyToPath(k))) keptCircled.add(k);
  const keptHighlighted = new Set<string>();
  for (const k of highlighted) if (isValidPath(root, keyToPath(k))) keptHighlighted.add(k);
  // [] = 根被选中，始终有效；其余取最长合法前缀，一个都不剩就取消选中
  if (selected && selected.length) {
    selected = resolvePath(root, selected);
    if (selected.length === 0) selected = null;
  }
  return {
    ...state,
    topic: { ...state.topic, root },
    expanded: kept,
    circled: keptCircled,
    highlighted: keptHighlighted,
    selected,
  };
}
