import { describe, it, expect } from 'vitest';
import type { TermNode, Topic } from '../src/core/types';
import { displayOp, parseExpr, tokenizeRhs } from '../src/core/formula';
import {
  addAction,
  expandedToDepth,
  expandTerm,
  findPathById,
  getNode,
  isValidPath,
  pathKey,
  removeAction,
  removeFormula,
  resolvePath,
  setFields,
  setRhs,
  setRootLhs,
  updateAction,
} from '../src/core/model';
import * as S from '../src/core/appState';
import { buildHash, parseHash } from '../src/core/router';
// @ts-expect-error 校验器是 .mjs，类型声明在 schema/validate.d.mts
import { validateTopicData } from '../../schema/validate.mjs';

const mkRoot = (): TermNode => ({
  expr: 'S = a + b',
  terms: {
    a: { id: 'node-a', expr: 'a = x + y', terms: { x: { note: 'n' } } },
  },
});

const mkTopic = (root: TermNode): Topic => ({ standard: 1, id: 't', title: 'T', root });

describe('formula 解析', () => {
  it('按运算符切词，去重并保持出现顺序', () => {
    const p = parseExpr('MTTR = 感知 + 响应 + 止损 + 感知');
    expect(p.ok).toBe(true);
    expect(p.lhs).toBe('MTTR');
    expect(p.terms).toEqual(['感知', '响应', '止损']);
  });

  it('括号与带空格的 / 是运算符', () => {
    const p = parseExpr('可用性 ≈ MTBF / (MTBF + MTTR)');
    expect(p.terms).toEqual(['MTBF', 'MTTR']);
    expect(p.rel).toBe('≈');
  });

  it('连字符与斜杠紧贴字符时属于词的一部分', () => {
    expect(parseExpr('x = a-b').terms).toEqual(['a-b']);
    expect(parseExpr('x = I/O').terms).toEqual(['I/O']);
    expect(parseExpr('x = a - b').terms).toEqual(['a', 'b']);
  });

  it('数字常量不成词', () => {
    const p = parseExpr('x = 成本 × 60% + 0.5');
    expect(p.terms).toEqual(['成本']);
    expect(p.segments.filter((s) => s.kind === 'num').map((s) => s.text)).toEqual(['60%', '0.5']);
  });

  it('方括号手动成词', () => {
    expect(parseExpr('x = [A + B] + C').terms).toEqual(['A + B', 'C']);
  });

  it('全角运算符与 * 的展示归一', () => {
    expect(tokenizeRhs('甲＋乙').map((s) => s.text)).toEqual(['甲', '＋', '乙']);
    expect(displayOp('*')).toBe('×');
    expect(displayOp('＋')).toBe('+');
  });

  it('缺等号或左边为空时 ok=false', () => {
    expect(parseExpr('没有等号').ok).toBe(false);
    expect(parseExpr(' = a').ok).toBe(false);
  });

  it('等号右边为空是合法的草稿（刚展开的词）', () => {
    const p = parseExpr('词 =');
    expect(p.ok).toBe(true);
    expect(p.terms).toEqual([]);
  });
});

describe('model 编辑', () => {
  it('expandTerm 生成「词 =」，且已有公式时原样返回', () => {
    const r = expandTerm(mkRoot(), [], 'b');
    expect(r.ok).toBe(true);
    expect(getNode(r.root, ['b'])?.expr).toBe('b =');
    const again = expandTerm(r.root, [], 'b');
    expect(getNode(again.root, ['b'])?.expr).toBe('b =');
  });

  it('expandTerm 拒绝不在公式右边的词', () => {
    expect(expandTerm(mkRoot(), [], 'zzz').ok).toBe(false);
  });

  it('不修改入参（不可变）', () => {
    const root = mkRoot();
    const snapshot = JSON.stringify(root);
    setRhs(root, [], 'b + c');
    expandTerm(root, [], 'b');
    addAction(root, ['a'], { kind: 'action', text: 'x' });
    expect(JSON.stringify(root)).toBe(snapshot);
  });

  it('只改一个词的名字时视为改名，子树跟着走且子公式左边同步', () => {
    const r = setRhs(mkRoot(), [], 'a2 + b');
    expect(r.ok).toBe(true);
    expect(r.renamed).toEqual({ parent: [], from: 'a', to: 'a2' });
    expect(r.dropped).toBeUndefined();
    expect(getNode(r.root, ['a'])).toBeUndefined();
    expect(getNode(r.root, ['a2'])?.expr).toBe('a2 = x + y');
    expect(getNode(r.root, ['a2', 'x'])?.note).toBe('n');
  });

  it('词被替换成多个不同的词时丢弃子树并报告数量', () => {
    const r = setRhs(mkRoot(), [], 'b + c');
    expect(r.ok).toBe(true);
    expect(r.renamed).toBeUndefined();
    expect(r.dropped).toBe(2);
    expect(getNode(r.root, ['a'])).toBeUndefined();
  });

  it('右边没变时是空操作', () => {
    const root = mkRoot();
    const r = setRhs(root, [], 'a + b');
    expect(r.ok).toBe(true);
    expect(r.root).toBe(root);
  });

  it('右边不能出现等号；没有公式的词不能改右边', () => {
    expect(setRhs(mkRoot(), [], 'a = b').ok).toBe(false);
    expect(setRhs(mkRoot(), ['a', 'x'], 'p + q').ok).toBe(false);
  });

  it('setRootLhs 只改根的左边', () => {
    const r = setRootLhs(mkRoot(), '稳定性');
    expect(r.root.expr).toBe('稳定性 = a + b');
    expect(setRootLhs(mkRoot(), 'a = b').ok).toBe(false);
    expect(setRootLhs(mkRoot(), '  ').ok).toBe(false);
  });

  it('removeFormula 只删公式与子树，保留说明；变空壳则整个清掉', () => {
    const root = mkRoot();
    root.terms!.a.note = '保留我';
    const r = removeFormula(root, ['a']);
    expect(getNode(r.root, ['a'])).toEqual({ id: 'node-a', note: '保留我' });
    expect(r.dropped).toBe(1);

    const bare = removeFormula(mkRoot(), ['a']);
    expect(getNode(bare.root, ['a'])?.expr).toBeUndefined();
    expect(removeFormula(mkRoot(), []).ok).toBe(false);
  });

  it('setFields 写入与清空文本字段，清空后不留空壳', () => {
    const w = setFields(mkRoot(), ['b'], { note: '说明' });
    expect(getNode(w.root, ['b'])?.note).toBe('说明');
    const c = setFields(w.root, ['b'], { note: '  ' });
    expect(getNode(c.root, ['b'])).toBeUndefined();
    expect(c.root.terms && 'b' in c.root.terms).toBe(false);
  });

  it('行动的增 / 改 / 删', () => {
    const a1 = addAction(mkRoot(), ['b'], { kind: 'action', text: ' 做这件事 ' });
    expect(getNode(a1.root, ['b'])?.actions).toEqual([{ kind: 'action', text: '做这件事' }]);

    const a2 = updateAction(a1.root, ['b'], 0, { status: 'doing' });
    expect(getNode(a2.root, ['b'])?.actions?.[0].status).toBe('doing');

    const a3 = updateAction(a2.root, ['b'], 0, { status: undefined });
    expect(getNode(a3.root, ['b'])?.actions?.[0]).not.toHaveProperty('status');

    const a4 = removeAction(a3.root, ['b'], 0);
    expect(getNode(a4.root, ['b'])).toBeUndefined();

    expect(addAction(mkRoot(), ['b'], { kind: 'idea', text: '  ' }).ok).toBe(false);
    expect(addAction(mkRoot(), ['nope'], { kind: 'idea', text: 'x' }).ok).toBe(false);
  });

  it('terms 的键顺序跟随公式右边', () => {
    let root = mkRoot();
    root = expandTerm(root, [], 'b').root;
    expect(Object.keys(root.terms!)).toEqual(['a', 'b']);
    root = setRhs(root, [], 'b + a').root;
    expect(Object.keys(root.terms!)).toEqual(['b', 'a']);
  });
});

describe('model 路径', () => {
  it('isValidPath / resolvePath 只认公式右边真实存在的词', () => {
    const root = mkRoot();
    expect(isValidPath(root, ['a', 'x'])).toBe(true);
    expect(isValidPath(root, ['a', 'zzz'])).toBe(false);
    expect(resolvePath(root, ['a', 'zzz'])).toEqual(['a']);
    expect(resolvePath(root, ['zzz'])).toEqual([]);
  });

  it('expandedToDepth 只含带公式的词，根不入集合', () => {
    const root = mkRoot();
    root.terms!.a.terms!.x = { expr: 'x = p + q' };
    expect([...expandedToDepth(root, 1)]).toEqual([]);
    expect([...expandedToDepth(root, 2)]).toEqual([pathKey(['a'])]);
    expect(expandedToDepth(root, 3)).toEqual(new Set([pathKey(['a']), pathKey(['a', 'x'])]));
  });

  it('findPathById 把 links.to 解析成词链', () => {
    expect(findPathById(mkRoot(), 'node-a')).toEqual(['a']);
    expect(findPathById(mkRoot(), 'missing')).toBeNull();
  });
});

describe('appState', () => {
  it('withTopic 按 expandDepth 初始展开，并展开路由所指词的祖先', () => {
    const topic = mkTopic(mkRoot());
    const s = S.withTopic(S.initialAppState, topic, ['a', 'x']);
    expect(s.selected).toEqual(['a', 'x']);
    expect(s.expanded.has(pathKey(['a']))).toBe(true);
    expect(S.withTopic(S.initialAppState, topic, ['zzz']).selected).toBeNull();
  });

  it('收起一个词不会误伤名字有相同前缀的兄弟', () => {
    const root: TermNode = {
      expr: 'S = a + ab',
      terms: {
        a: { expr: 'a = x + y', terms: { x: { expr: 'x = p + q' } } },
        ab: { expr: 'ab = m + n' },
      },
    };
    let s = S.withTopic(S.initialAppState, mkTopic(root), null);
    s = S.expandToDepth(s, 5);
    expect(s.expanded.size).toBe(3);
    s = S.toggleExpand(s, ['a']);
    expect([...s.expanded]).toEqual([pathKey(['ab'])]);
    s = S.toggleExpand(s, ['a']);
    expect(s.expanded.has(pathKey(['a']))).toBe(true);
    expect(s.expanded.has(pathKey(['a', 'x']))).toBe(false);
  });

  it('改名时展开与选中路径跟着重映射', () => {
    let s = S.withTopic(S.initialAppState, mkTopic(mkRoot()), null);
    s = S.select(s, ['a', 'x']);
    const res = setRhs(s.topic!.root, [], 'a2 + b');
    s = S.applyEdit(s, res);
    expect(s.selected).toEqual(['a2', 'x']);
    expect(s.expanded.has(pathKey(['a2']))).toBe(true);
    expect(s.expanded.has(pathKey(['a']))).toBe(false);
  });

  it('被删掉的词不再留在展开 / 选中里', () => {
    let s = S.withTopic(S.initialAppState, mkTopic(mkRoot()), null);
    s = S.select(s, ['a', 'x']);
    s = S.applyEdit(s, setRhs(s.topic!.root, [], 'b + c'));
    expect(s.selected).toBeNull();
    expect(s.expanded.size).toBe(0);
  });

  it('失败的编辑原样返回状态', () => {
    const s = S.withTopic(S.initialAppState, mkTopic(mkRoot()), null);
    expect(S.applyEdit(s, setRhs(s.topic!.root, [], 'a = b'))).toBe(s);
  });

  it('startFormula 为没有公式的词生成「词 =」并展开', () => {
    const s0 = S.withTopic(S.initialAppState, mkTopic(mkRoot()), null);
    const [s1, res] = S.startFormula(s0, ['b']);
    expect(res?.ok).toBe(true);
    expect(getNode(s1.topic!.root, ['b'])?.expr).toBe('b =');
    expect(s1.expanded.has(pathKey(['b']))).toBe(true);
  });
});

describe('router', () => {
  it('中文词链来回编码不丢失', () => {
    const hash = buildHash('stability-governance', ['结果指标', 'MTTR']);
    expect(parseHash(hash)).toEqual({ topicId: 'stability-governance', path: ['结果指标', 'MTTR'] });
  });

  it('空 hash 与坏编码都不抛错', () => {
    expect(parseHash('')).toEqual({ topicId: null, path: [] });
    expect(() => parseHash('#/t/%E0%A4%A')).not.toThrow();
    expect(buildHash(null)).toBe('#/');
  });
});

describe('校验器（schema/validate.mjs）', () => {
  const base = (): Topic => mkTopic(mkRoot());

  it('合法主题通过，并统计词数与层数', () => {
    const r = validateTopicData(base(), 't');
    expect(r.errors).toEqual([]);
    expect(r.stats).toEqual({ nodes: 3, depth: 2 });
  });

  it('拒绝：terms 的键不在公式右边', () => {
    const t = base();
    t.root.terms!.ghost = { note: 'x' };
    expect(validateTopicData(t, 't').errors.join('\n')).toMatch(/ghost.*没有出现在公式右边/);
  });

  it('拒绝：子公式左边与父公式里的词不一致', () => {
    const t = base();
    t.root.terms!.a.expr = 'wrong = x + y';
    expect(validateTopicData(t, 't').errors.join('\n')).toMatch(/必须等于/);
  });

  it('拒绝：根没有公式、id 重复、links 悬空、expandDepth 过大、id 与目录不一致', () => {
    const noExpr = base();
    delete noExpr.root.expr;
    expect(validateTopicData(noExpr, 't').errors.join('\n')).toMatch(/根节点必须有 expr/);

    const dup = base();
    dup.root.terms!.b = { id: 'node-a' };
    expect(validateTopicData(dup, 't').errors.join('\n')).toMatch(/id 重复/);

    const dangling = base();
    dangling.root.links = [{ to: 'nowhere' }];
    expect(validateTopicData(dangling, 't').errors.join('\n')).toMatch(/links.to/);

    const deep = base();
    deep.expandDepth = 9;
    expect(validateTopicData(deep, 't').errors.join('\n')).toMatch(/expandDepth/);

    expect(validateTopicData(base(), 'other').errors.join('\n')).toMatch(/不一致/);
  });

  it('拒绝：公式无法解析', () => {
    const t = base();
    t.root.expr = '没有等号的公式';
    expect(validateTopicData(t, 't').errors.join('\n')).toMatch(/公式无法解析/);
  });
});
