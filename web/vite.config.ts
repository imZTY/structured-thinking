import { defineConfig, type Plugin } from 'vite';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateManifestData, validateTopicData } from '../schema/validate.mjs';
import { parseExpr } from '../schema/formula.mjs';

// 仓库根（web/ 的上一级）—— content/ 与 schema/ 都在那里
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const contentDir = join(repoRoot, 'content');
const topicsDir = join(contentDir, 'topics');
const manifestPath = join(contentDir, 'manifest.json');

const TOPIC_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_BODY = 2 * 1024 * 1024;

// build：把仓库根 content/ 原样拷到 web/dist/content/（保持 URL 空间
// {base}content/** 与仓库 content/** 一一对应；publicDir 会摊平目录，故不用）
function copyContent(): Plugin {
  return {
    name: 'copy-content',
    apply: 'build',
    closeBundle() {
      cpSync(contentDir, join(repoRoot, 'web/dist/content'), { recursive: true });
    },
  };
}

// dev：{base}content/** 与裸 /content/** 直接读仓库根文件返回（只读）
const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function serveContent(): Plugin {
  return {
    name: 'serve-content',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = decodeURIComponent(req.url ?? '').match(/^(?:\/structured-thinking)?\/content\/(.+?)(?:\?|$)/);
        if (!m) return next();
        const file = join(contentDir, m[1]);
        // 目录穿越防御：解析后必须仍在 contentDir 内
        if (!file.startsWith(contentDir)) { res.statusCode = 403; return res.end(); }
        if (!existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; return res.end('not found'); }
        res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(file));
      });
    },
  };
}

// ---------- dev 写回接口（仅 vite dev；生产构建里没有这些接口，页面自动只读） ----------

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

// 拒绝跨站请求：浏览器跨域写请求一定带 Origin；它必须与本服务同源
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

// 先写临时文件再 rename，写到一半崩溃也不会留下半截 JSON
function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}

function nextTopicId(taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `topic-${n}`;
    if (!taken.has(id) && !existsSync(join(topicsDir, id))) return id;
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, route: string) {
  if (req.method === 'GET' && route === '/ping') return send(res, 200, { writable: true });

  if (req.method !== 'PUT' && req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
  if (!sameOrigin(req)) return send(res, 403, { error: '拒绝跨站请求' });
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    return send(res, 415, { error: '需要 application/json' });
  }

  const put = req.method === 'PUT' && route.match(/^\/topics\/([^/]+)$/);
  if (put) {
    const id = decodeURIComponent(put[1]);
    if (!TOPIC_ID.test(id)) return send(res, 400, { error: '非法的主题 id' });
    const file = join(topicsDir, id, 'topic.json');
    if (!existsSync(file)) return send(res, 404, { error: `主题 ${id} 不存在` });
    const topic = await readBody(req);
    const { errors } = validateTopicData(topic, id);
    if (errors.length) return send(res, 422, { errors });
    writeJson(file, topic);
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && route === '/topics') {
    const body = (await readBody(req)) as { title?: unknown };
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return send(res, 400, { error: '主题名称不能为空' });
    // 主题名同时是根公式的左边，必须能被公式文法原样解析出来
    if (parseExpr(`${title} =`).lhs !== title) {
      return send(res, 400, { error: '主题名称不能包含等号或方括号' });
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      topics: { id: string; title: string; path: string }[];
    };
    const id = nextTopicId(new Set(manifest.topics.map((t) => t.id)));
    const topic = { standard: 1, id, title, root: { expr: `${title} =` } };
    const topicErrors = validateTopicData(topic, id).errors;
    if (topicErrors.length) return send(res, 422, { errors: topicErrors });

    const nextManifest = { ...manifest, topics: [...manifest.topics, { id, title, path: `topics/${id}/topic.json` }] };
    const manifestErrors = validateManifestData(nextManifest);
    if (manifestErrors.length) return send(res, 422, { errors: manifestErrors });

    writeJson(join(topicsDir, id, 'topic.json'), topic);
    writeJson(manifestPath, nextManifest);
    return send(res, 201, topic);
  }

  return send(res, 404, { error: 'not found' });
}

function writeApi(): Plugin {
  return {
    name: 'content-write-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = (req.url ?? '').split('?')[0].match(/^(?:\/structured-thinking)?\/api(\/.*)?$/);
        if (!m) return next();
        handleApi(req, res, m[1] ?? '/').catch((e: unknown) => {
          send(res, 500, { error: e instanceof Error ? e.message : String(e) });
        });
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages 项目页部署在 /structured-thinking/ 子路径下
  base: '/structured-thinking/',
  plugins: [copyContent(), serveContent(), writeApi()],
});
