/**
 * ui/md.ts —— markdown 渲染。内容来自 JSON（可能经 PR 合入），所以不信任其中的原始 HTML：
 * 原始 HTML 一律转义，链接只放行 http(s) / mailto / 锚点，图片退化为替代文字。
 */

import { Marked } from 'marked';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const md = new Marked({
  renderer: {
    html: ({ text }) => esc(text),
    image: ({ text }) => esc(text),
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens);
      if (!/^(https?:|mailto:|#)/i.test(href)) return inner;
      return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''} target="_blank" rel="noopener noreferrer">${inner}</a>`;
    },
  },
});

export function renderMd(src: string): string {
  return md.parse(src, { async: false }) as string;
}
