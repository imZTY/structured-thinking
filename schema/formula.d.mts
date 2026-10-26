export interface Segment {
  kind: 'term' | 'op' | 'num';
  text: string;
}

export interface ParsedExpr {
  ok: boolean;
  error?: string;
  lhs: string;
  rel: string;
  /** 等号右边的原文（已 trim） */
  rhs: string;
  segments: Segment[];
  /** RHS 中的词：去重，按首次出现顺序 */
  terms: string[];
}

export const RELATIONS: readonly string[];
export function normalizeTerm(s: string): string;
export function displayOp(op: string): string;
export function indexOfRelation(expr: string): number;
export function tokenizeRhs(rhs: string): Segment[];
export function parseExpr(expr: string): ParsedExpr;
export function buildExpr(lhs: string, rhs: string, rel?: string): string;
export function withLhs(expr: string, lhs: string): string;
