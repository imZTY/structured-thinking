/**
 * core/types.ts —— 内容标准 v1（公式模型）的类型定义，与 schema/topic.schema.json 同源。
 * core 层零 DOM：可被 web / 未来 3D / 转换器等任何投影仪消费。
 */

export interface Manifest {
  standard: 1;
  title: string;
  topics: ManifestTopic[];
}

export interface ManifestTopic {
  id: string;
  title: string;
  path: string;
  order?: number;
}

export interface Topic {
  standard: 1;
  id: string;
  title: string;
  subtitle?: string;
  summary?: string;
  tags?: string[];
  expandDepth?: number;
  meta?: Record<string, unknown>;
  /** 根节点必须有 expr：主题的核心公式 */
  root: TermNode;
}

/**
 * 一个词。有 expr = 它被展开成了自己的公式「词 = 右边」；
 * terms 以词为键，键必须出现在本节点 expr 的右边。
 */
export interface TermNode {
  id?: string;
  expr?: string;
  question?: string;
  note?: string;
  details?: string;
  actions?: Action[];
  refs?: NodeRef[];
  links?: NodeLink[];
  meta?: Record<string, unknown>;
  terms?: Record<string, TermNode>;
}

export interface Action {
  /** 开放词汇。约定：action（抓手）| idea（想法） */
  kind: string;
  text: string;
  /** 开放词汇。约定：todo | doing | done */
  status?: string;
}

export interface NodeRef {
  label: string;
  url?: string;
}

export interface NodeLink {
  to: string;
  rel?: string;
}

/** 从根到某个词的词链；空数组 = 根 */
export type Path = string[];

/** 认知模式：只改公式；行动模式：公式只读，只往词上挂抓手 / 想法 */
export type Mode = 'cognition' | 'action';
