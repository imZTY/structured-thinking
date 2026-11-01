/**
 * ui/exportImage.ts —— 把当前展开的公式推导导出成 PNG。
 * 不直接截屏幕上的节点：另起一份离屏渲染，去掉选中高亮和编辑态，宽度与屏幕上的推导区一致，
 * 这样换行位置和你看到的相同，长内容也不会被滚动区域截断。
 *
 * 画面上看得见的状态统一收在 ViewState 里，屏幕和导出吃同一份：
 * 新增视图功能时把状态加进 ViewState，再在 renderDerive（结构）或 applyAnnotations（依赖排版的标注）里实现，
 * 导出就会自动带上，这个文件不用改。
 */

import { toBlob } from 'html-to-image';
import type { ViewState } from '../core/appState';
import type { Mode, Topic } from '../core/types';
import { applyAnnotations } from './annotations';
import { renderDerive } from './derive';
import { el } from './dom';

const MAX_PIXELS = 16000;
const noop = () => {};

export interface ExportInput {
  topic: Topic;
  view: ViewState;
  /** 屏幕上推导区的内容宽度，导出图沿用它，保证换行一致 */
  width: number;
}

export function exportFileName(title: string, mode: Mode): string {
  const safe = title.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'topic';
  return `${safe}-${mode === 'action' ? '行动' : '认知'}.png`;
}

export async function exportAsImage({ topic, view, width }: ExportInput): Promise<string> {
  const stage = el('div', 'export-stage');
  const sheet = el('div', 'export-sheet');
  sheet.style.width = `${Math.max(320, Math.round(width))}px`;

  const head = el('header', 'export-sheet__head');
  head.appendChild(el('h1', 'export-sheet__title', topic.title));
  if (topic.subtitle) head.appendChild(el('p', 'export-sheet__sub', topic.subtitle));

  const inner = el('div', 'derive__inner');
  inner.appendChild(
    renderDerive({
      root: topic.root,
      view,
      selected: null,
      canEditFormula: false,
      editing: null,
      on: { clickTerm: noop, startEdit: noop, commitEdit: noop, cancelEdit: noop },
    }),
  );

  sheet.append(head, inner);
  stage.appendChild(sheet);
  document.body.appendChild(stage);

  try {
    await document.fonts?.ready;
    applyAnnotations(inner, view);

    // data-key 用 U+001F 拼路径，XML 1.0 不允许该控制字符，序列化进 SVG 时整张图会解析失败；
    // 标注已经画完，不再需要它
    inner.querySelectorAll('[data-key]').forEach((n) => n.removeAttribute('data-key'));

    const w = sheet.offsetWidth;
    const h = sheet.offsetHeight;
    const pixelRatio = Math.min(2, MAX_PIXELS / Math.max(w, h));
    const blob = await toBlob(sheet, {
      pixelRatio,
      backgroundColor: getComputedStyle(sheet).backgroundColor,
      cacheBust: false,
    }).catch((e: unknown) => {
      // html-to-image 在 SVG 渲染失败时抛的是 Event，没有 message
      throw e instanceof Error ? e : new Error('浏览器无法渲染导出内容');
    });
    if (!blob) throw new Error('图片生成失败');
    const name = exportFileName(topic.title, view.mode);
    download(blob, name);
    return name;
  } finally {
    stage.remove();
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
