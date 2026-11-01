/**
 * ui/annotations.ts —— 画在公式推导之上的标注层（目前只有红圈）。
 * 标注依赖排版结果，必须在 DOM 已挂载、布局完成后调用；屏幕和图片导出走同一个入口。
 */

import type { ViewState } from '../core/appState';
import { el } from './dom';

const NS = 'http://www.w3.org/2000/svg';
const CONTENT = '.term, .rel, .op, .num, .formula__raw, .rhs-empty';
const PAD_BLOCK = 8;
const PAD_TERM_X = 5;
const PAD_TERM_Y = 4;
const BIG = 100000;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

let seq = 0;

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function rectEl(r: Rect, extra: Record<string, string | number>): SVGElement {
  return svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 16, ...extra });
}

/**
 * 在 container（.derive__inner）里重画标注层。
 * 红圈 = 词本身 ∪ 它已展开的子公式，画成这两块区域的并集轮廓：
 * 不会把父公式同一行的其他词圈进来，也不会切到左边的词。子公式没展开时只圈词，词不可见则不画。
 */
export function applyAnnotations(container: HTMLElement, view: Pick<ViewState, 'circled'>): void {
  container.querySelector(':scope > .annot-layer')?.remove();
  if (!view.circled.size) return;

  const origin = container.getBoundingClientRect();
  const anchors = new Map<string, HTMLElement>();
  const blocks = new Map<string, HTMLElement>();
  for (const t of container.querySelectorAll<HTMLElement>('.term')) {
    const key = t.dataset.key;
    if (key === undefined) continue;
    if (t.classList.contains('term--lhs')) {
      const block = t.closest<HTMLElement>('.formula');
      if (block) blocks.set(key, block);
      if (key === '') anchors.set(key, t);
    } else if (!anchors.has(key)) {
      anchors.set(key, t);
    }
  }

  // 描边属性直接写在元素上：导出时样式表不会跟着进 SVG，靠 CSS 类会退化成默认的黑色实心
  const ring = {
    class: 'annot-ring',
    fill: 'none',
    stroke: getComputedStyle(container).getPropertyValue('--circle').trim() || '#e03131',
    'stroke-width': 3,
  };
  const svg = svgEl('svg', { class: 'annot-svg', width: 1, height: 1 });
  const defs = svgEl('defs', {});
  svg.appendChild(defs);

  for (const key of view.circled) {
    const anchor = anchors.get(key);
    if (!anchor) continue;
    const term = measure([anchor], origin);
    if (!term) continue;
    const a = grow(term, PAD_TERM_X, PAD_TERM_Y);

    const block = blocks.get(key);
    const content = block ? measure([...block.querySelectorAll(CONTENT)], origin) : null;
    if (!content) {
      svg.appendChild(rectEl(a, ring));
      continue;
    }
    const b = grow(content, PAD_BLOCK, PAD_BLOCK);
    // 两块区域必须有重叠，描出来的才是一个连通的轮廓
    a.h = Math.max(a.h, b.y + 3 - a.y);
    drawUnion(svg, defs, a, b, ring);
  }

  if (!svg.querySelector('.annot-ring')) return;
  const layer = el('div', 'annot-layer');
  layer.setAttribute('aria-hidden', 'true');
  layer.appendChild(svg);
  container.appendChild(layer);
}

/** 两个矩形并集的外轮廓：各描自己的边框，并遮掉落在对方内部的那一段 */
function drawUnion(
  svg: SVGElement,
  defs: SVGElement,
  a: Rect,
  b: Rect,
  ring: Record<string, string | number>,
): void {
  const id = ++seq;
  const draw = (own: Rect, other: Rect, tag: string) => {
    const maskId = `annot-mask-${id}-${tag}`;
    const mask = svgEl('mask', {
      id: maskId,
      maskUnits: 'userSpaceOnUse',
      x: -BIG,
      y: -BIG,
      width: BIG * 2,
      height: BIG * 2,
    });
    mask.append(
      svgEl('rect', { x: -BIG, y: -BIG, width: BIG * 2, height: BIG * 2, fill: '#fff' }),
      rectEl(other, { fill: '#000' }),
    );
    defs.appendChild(mask);
    svg.appendChild(rectEl(own, { ...ring, mask: `url(#${maskId})` }));
  };
  draw(a, b, 'a');
  draw(b, a, 'b');
}

function grow(r: Rect, px: number, py: number): Rect {
  return { x: r.x - px, y: r.y - py, w: r.w + px * 2, h: r.h + py * 2 };
}

function measure(els: Element[], origin: DOMRect): Rect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const e of els) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    left = Math.min(left, r.left - origin.left);
    top = Math.min(top, r.top - origin.top);
    right = Math.max(right, r.right - origin.left);
    bottom = Math.max(bottom, r.bottom - origin.top);
  }
  return left === Infinity ? null : { x: left, y: top, w: right - left, h: bottom - top };
}
