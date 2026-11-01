#!/usr/bin/env node
/**
 * 内容校验器：npm run validate
 * 校验 content/ 下全部内容（规则见 schema/validate.mjs），退出码 0 通过 / 1 有错误。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifestData, validateTopicData } from '../schema/validate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = join(root, 'content');

let errors = 0;
const fail = (file, msg) => { console.error(`  ✗ ${file}: ${msg}`); errors++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    fail(label, `JSON 解析失败: ${e.message}`);
    return null;
  }
}

// ---------- manifest ----------
console.log('manifest.json');
const manifestPath = join(contentDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail('manifest.json', '文件不存在');
  process.exit(1);
}
const manifest = readJson(manifestPath, 'manifest.json');
if (!manifest) process.exit(1);

const manifestErrors = validateManifestData(manifest);
for (const m of manifestErrors) fail('manifest.json', m);
if (!manifestErrors.length) ok('结构合法');

const topicIds = new Set();
const seen = (arr, key) => arr.filter((x, i) => arr.findIndex((y) => y[key] === x[key]) !== i);
for (const d of seen(manifest.topics ?? [], 'id')) fail('manifest.json', `主题 id 重复: ${d.id}`);
for (const d of seen(manifest.topics ?? [], 'path')) fail('manifest.json', `主题 path 重复: ${d.path}`);

for (const t of manifest.topics ?? []) {
  topicIds.add(t.id);
  const p = join(contentDir, t.path);
  if (!existsSync(p)) {
    fail('manifest.json', `主题 ${t.id} 的 path 不存在: ${t.path}`);
    continue;
  }
  const dirName = basename(dirname(p));
  if (dirName !== t.id) fail('manifest.json', `主题 ${t.id} 的目录名应为 ${t.id}，实际 ${dirName}`);
}

// ---------- topics ----------
console.log('topics/');
const topicsRoot = join(contentDir, 'topics');
const dirs = existsSync(topicsRoot)
  ? readdirSync(topicsRoot).filter((d) => statSync(join(topicsRoot, d)).isDirectory() && !d.startsWith('_'))
  : [];

for (const d of dirs) {
  const label = `topics/${d}/topic.json`;
  if (!topicIds.has(d)) fail(`topics/${d}`, '目录存在但未在 manifest.json 登记');
  const tf = join(topicsRoot, d, 'topic.json');
  if (!existsSync(tf)) {
    fail(`topics/${d}`, '缺少 topic.json');
    continue;
  }
  const topic = readJson(tf, label);
  if (!topic) continue;
  const result = validateTopicData(topic, d);
  if (result.errors.length) for (const m of result.errors) fail(label, m);
  else ok(`topics/${d}: 合法（${result.stats.nodes} 个词，公式 ${result.stats.depth} 层）`);
}

console.log(errors ? `\n${errors} 个错误` : '\n全部通过');
process.exit(errors ? 1 : 0);
