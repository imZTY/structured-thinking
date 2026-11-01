/**
 * 公式表达式文法 —— 内容标准的一部分，也是它唯一的实现。
 * Node 校验器与 web/core 共同引用本文件，保证「标准 = 一份实现」。
 *
 *   expr := LHS REL RHS
 *   REL  := = | ＝ | ≈ | ≔          （取第一个出现者）
 *   RHS  := 词 / 运算符 / 数字 的序列，空白无语义
 *
 * 运算符（总是）：+ ＋ × * ÷ ( ) （ ） − － , ， 、 ; ；
 * 运算符（仅当前后均为空白或边界）：- /
 * 手动成词：[ ... ] 内的片段整体是一个词（方括号不显示）
 * 数字：1、0.5、60% 之类的常量不成词
 */

export const RELATIONS = ['=', '＝', '≈', '≔'];

const ALWAYS_OPS = new Set(['+', '＋', '×', '*', '÷', '(', ')', '（', '）', '−', '－', ',', '，', '、', ';', '；']);
const SPACED_OPS = new Set(['-', '/']);
const NUMBER = /^[+-]?\d+(\.\d+)?%?$/;
const DISPLAY = { '*': '×', '/': '÷', '-': '−', '＋': '+', '－': '−', '（': '(', '）': ')', '，': ',', '；': ';' };

const isBoundary = (c) => c === undefined || /\s/.test(c);

export function normalizeTerm(s) {
  return s.replace(/\s+/g, ' ').trim();
}

export function displayOp(op) {
  return DISPLAY[op] ?? op;
}

export function indexOfRelation(expr) {
  for (let i = 0; i < expr.length; i++) {
    if (RELATIONS.includes(expr[i])) return i;
  }
  return -1;
}

/** 把 RHS 文本切成 term / op / num 片段（空白被丢弃） */
export function tokenizeRhs(rhs) {
  const segments = [];
  let buf = '';
  const flush = () => {
    const t = normalizeTerm(buf);
    buf = '';
    if (!t) return;
    segments.push(NUMBER.test(t) ? { kind: 'num', text: t } : { kind: 'term', text: t });
  };
  for (let i = 0; i < rhs.length; i++) {
    const c = rhs[i];
    if (c === '[') {
      const j = rhs.indexOf(']', i + 1);
      if (j > i) {
        flush();
        const inner = normalizeTerm(rhs.slice(i + 1, j));
        if (inner) segments.push({ kind: 'term', text: inner });
        i = j;
        continue;
      }
    }
    if (ALWAYS_OPS.has(c) || (SPACED_OPS.has(c) && isBoundary(rhs[i - 1]) && isBoundary(rhs[i + 1]))) {
      flush();
      segments.push({ kind: 'op', text: c });
      continue;
    }
    buf += c;
  }
  flush();
  return segments;
}

function stripBrackets(s) {
  return s.startsWith('[') && s.endsWith(']') && s.length > 2 ? normalizeTerm(s.slice(1, -1)) : s;
}

/** 解析一条公式。ok=false 时 error 说明原因；terms 为 RHS 去重后的词（按出现顺序） */
export function parseExpr(expr) {
  const idx = indexOfRelation(expr);
  if (idx < 0) {
    return { ok: false, error: '缺少等号（= ＝ ≈ ≔）', lhs: normalizeTerm(expr), rel: '', rhs: '', segments: [], terms: [] };
  }
  const lhs = stripBrackets(normalizeTerm(expr.slice(0, idx)));
  const rel = expr[idx];
  const rhsRaw = expr.slice(idx + 1);
  if (!lhs) {
    return { ok: false, error: '等号左边不能为空', lhs, rel, rhs: rhsRaw.trim(), segments: [], terms: [] };
  }
  const segments = tokenizeRhs(rhsRaw);
  const terms = [...new Set(segments.filter((s) => s.kind === 'term').map((s) => s.text))];
  return { ok: true, lhs, rel, rhs: rhsRaw.trim(), segments, terms };
}

export function buildExpr(lhs, rhs, rel = '=') {
  return `${lhs} ${rel} ${rhs}`.trimEnd();
}

/** 换掉 LHS，保留原有的等号与右边 */
export function withLhs(expr, lhs) {
  const idx = indexOfRelation(expr);
  return idx < 0 ? buildExpr(lhs, '') : `${lhs} ${expr.slice(idx)}`;
}
