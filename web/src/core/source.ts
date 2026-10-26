/**
 * core/source.ts —— 数据源抽象。
 * 「换源不换标准」：v2/v3 换成 API 或本地目录时，只需替换本模块。
 * 读：fetch 静态 JSON（线上 / dev 通用）。写：仅 dev 服务提供（canEdit 探测）。
 */

import type { Manifest, Topic } from './types';

export interface ContentSource {
  getManifest(): Promise<Manifest>;
  getTopic(id: string): Promise<Topic>;
  /** 是否可写（dev 服务在场） */
  canEdit(): Promise<boolean>;
  saveTopic(topic: Topic, opts?: { keepalive?: boolean }): Promise<void>;
  /** 新建一个空主题，返回它（id 由服务端生成） */
  createTopic(title: string): Promise<Topic>;
}

export class HttpContentSource implements ContentSource {
  private base: string;
  private api: string;

  constructor(baseUrl?: string) {
    const viteBase = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    this.base = baseUrl ?? joinUrl(viteBase, 'content');
    this.api = joinUrl(viteBase, 'api');
  }

  async getManifest(): Promise<Manifest> {
    const res = await fetch(`${this.base}/manifest.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`manifest 加载失败: ${res.status}`);
    return res.json() as Promise<Manifest>;
  }

  async getTopic(id: string): Promise<Topic> {
    const res = await fetch(`${this.base}/topics/${id}/topic.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`主题 ${id} 加载失败: ${res.status}`);
    return res.json() as Promise<Topic>;
  }

  async canEdit(): Promise<boolean> {
    try {
      const res = await fetch(`${this.api}/ping`, { cache: 'no-store' });
      if (!res.ok) return false;
      const body = (await res.json()) as { writable?: boolean };
      return body.writable === true;
    } catch {
      return false;
    }
  }

  async saveTopic(topic: Topic, opts: { keepalive?: boolean } = {}): Promise<void> {
    const res = await fetch(`${this.api}/topics/${encodeURIComponent(topic.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(topic),
      keepalive: opts.keepalive,
    });
    if (!res.ok) throw new Error(await errorText(res, '保存失败'));
  }

  async createTopic(title: string): Promise<Topic> {
    const res = await fetch(`${this.api}/topics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error(await errorText(res, '新建失败'));
    return res.json() as Promise<Topic>;
  }
}

async function errorText(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; errors?: string[] };
    return body.errors?.join('；') ?? body.error ?? `${fallback}: ${res.status}`;
  } catch {
    return `${fallback}: ${res.status}`;
  }
}

function joinUrl(a: string, b: string): string {
  return `${a.replace(/\/$/, '')}/${b.replace(/^\//, '')}`;
}

/** 带缓存的懒加载门面：切 tab 才 fetch，每个主题只 fetch 一次；保存成功后缓存同步为最新 */
export class ContentStore {
  private manifest?: Promise<Manifest>;
  private topics = new Map<string, Promise<Topic>>();

  constructor(private source: ContentSource) {}

  getManifest(): Promise<Manifest> {
    this.manifest ??= this.source.getManifest();
    return this.manifest;
  }

  reloadManifest(): Promise<Manifest> {
    this.manifest = undefined;
    return this.getManifest();
  }

  getTopic(id: string): Promise<Topic> {
    let p = this.topics.get(id);
    if (!p) {
      p = this.source.getTopic(id);
      p.catch(() => this.topics.delete(id));
      this.topics.set(id, p);
    }
    return p;
  }

  canEdit(): Promise<boolean> {
    return this.source.canEdit();
  }

  async saveTopic(topic: Topic, opts?: { keepalive?: boolean }): Promise<void> {
    await this.source.saveTopic(topic, opts);
    this.topics.set(topic.id, Promise.resolve(topic));
  }

  async createTopic(title: string): Promise<Topic> {
    const topic = await this.source.createTopic(title);
    this.topics.set(topic.id, Promise.resolve(topic));
    this.manifest = undefined;
    return topic;
  }
}
