/**
 * core/router.ts —— hash 路由（纯函数，不直接操作 location）。
 *
 * 形态：#/topicId/词1/词2/…（词链 = 选中的词；每段 encodeURIComponent）
 * 例：#/stability-governance/结果指标/MTTR
 */

import type { Path } from './types';

export interface Route {
  topicId: string | null;
  /** 选中的词链；空数组 = 无选中 */
  path: Path;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const parts = raw.split('/').filter(Boolean);
  if (parts.length === 0) return { topicId: null, path: [] };
  const dec = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  return { topicId: dec(parts[0]), path: parts.slice(1).map(dec) };
}

export function buildHash(topicId: string | null, path: Path = []): string {
  if (!topicId) return '#/';
  return `#/${[topicId, ...path].map(encodeURIComponent).join('/')}`;
}
