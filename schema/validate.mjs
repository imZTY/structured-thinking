/**
 * 内容校验（标准的机器可读形态）：JSON Schema + 语义规则。
 * 被两处共用：`npm run validate`（scripts/validate-content.mjs）与 dev 服务的写回接口。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseExpr, normalizeTerm } from './formula.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, f), 'utf-8'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schemaManifest = ajv.compile(load('manifest.schema.json'));
const schemaTopic = ajv.compile(load('topic.schema.json'));

function schemaErrors(validator) {
  return (validator.errors ?? []).map((e) => `${e.message}${e.instancePath ? ` at ${e.instancePath}` : ''}`);
}

export function validateManifestData(manifest) {
  return schemaManifest(manifest) ? [] : schemaErrors(schemaManifest);
}

/** 返回 { errors: string[], stats: { nodes, depth } }。expectedId 给出时校验 topic.id 与目录一致 */
export function validateTopicData(topic, expectedId) {
  if (!schemaTopic(topic)) return { errors: schemaErrors(schemaTopic), stats: { nodes: 0, depth: 0 } };

  const errors = [];
  const ids = new Map();
  const links = [];
  let nodes = 0;
  let depth = 0;

  if (expectedId !== undefined && topic.id !== expectedId) {
    errors.push(`topic.id (${topic.id}) 与目录名 (${expectedId}) 不一致`);
  }
  if (!topic.root.expr) errors.push('根节点必须有 expr（主题的核心公式）');

  const walk = (node, label, path, level) => {
    nodes++;
    const where = path.length ? path.join(' › ') : '根';
    if (node.id) {
      if (ids.has(node.id)) errors.push(`节点 id 重复: ${node.id}（${ids.get(node.id)} 与 ${where}）`);
      else ids.set(node.id, where);
    }
    for (const l of node.links ?? []) links.push({ to: l.to, from: where });
    for (const r of node.refs ?? []) {
      if (r.url && !/^(https?:\/\/|mailto:)/.test(r.url)) errors.push(`refs.url 疑似非法: ${r.url}（${where}）`);
    }

    let allowed = [];
    if (node.expr !== undefined) {
      depth = Math.max(depth, level);
      const p = parseExpr(node.expr);
      if (!p.ok) {
        errors.push(`公式无法解析: ${p.error}（${where}：${node.expr}）`);
      } else {
        if (label !== null && p.lhs !== label) {
          errors.push(`公式左边「${p.lhs}」必须等于它在父公式里的词「${label}」（${where}）`);
        }
        allowed = p.terms;
      }
    } else if (node.terms && Object.keys(node.terms).length) {
      errors.push(`没有 expr 的节点不能有 terms（${where}）`);
    }

    for (const [key, child] of Object.entries(node.terms ?? {})) {
      if (key !== normalizeTerm(key)) errors.push(`terms 的键含多余空白: 「${key}」（${where}）`);
      if (!allowed.includes(key)) errors.push(`terms 的键「${key}」没有出现在公式右边（${where}：${node.expr ?? '无公式'}）`);
      walk(child, key, [...path, key], level + 1);
    }
  };
  walk(topic.root, null, [], 1);

  for (const l of links) {
    if (!ids.has(l.to)) errors.push(`links.to 指向不存在的 id: ${l.to}（来自 ${l.from}）`);
  }
  if (topic.expandDepth && topic.expandDepth > depth) {
    errors.push(`expandDepth=${topic.expandDepth} 超过实际公式层数 ${depth}`);
  }
  return { errors, stats: { nodes, depth } };
}
