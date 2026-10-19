// Playwright loader (dùng bản cài trong apps/e2e) + viewport + đo đạc (tap target, font, axe).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../../../../..');
const req = createRequire(path.join(ROOT, 'apps/e2e/package.json'));
export const { chromium, webkit } = req('@playwright/test');

export const VIEWPORTS = {
  390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  1440: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
};

let axeSrc;
export function axeSource() {
  if (axeSrc) return axeSrc;
  const candidates = [
    path.join(ROOT, 'node_modules/.pnpm/axe-core@4.12.0/node_modules/axe-core/axe.min.js'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return (axeSrc = fs.readFileSync(c, 'utf8'));
  throw new Error('Không tìm thấy axe-core trong node_modules/.pnpm');
}

/** Chạy trong trang: đo kích thước vùng chạm, cỡ chữ, tiêu đề, tràn ngang, và lấy innerText. */
export function pageMetrics() {
  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const sel = 'a[href],button,[role="button"],[role="tab"],[role="link"],[role="switch"],[role="checkbox"],[role="menuitem"],input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])';
  const set = new Set(document.querySelectorAll(sel));
  // Phần tử bấm được kiểu React (div + onClick) chỉ nhận ra qua cursor:pointer — lấy phần tử NGOÀI CÙNG.
  document.querySelectorAll('body *').forEach((el) => {
    if (set.has(el)) return;
    if (getComputedStyle(el).cursor === 'pointer' && !el.closest(sel)) {
      const parentPointer = el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer';
      if (!parentPointer) set.add(el);
    }
  });
  const pseudo = (el, which) => {
    const cs = getComputedStyle(el, which);
    if (cs.content === 'none' || cs.position !== 'absolute') return null;
    const w = parseFloat(cs.width);
    const h = parseFloat(cs.height);
    return Number.isFinite(w) && Number.isFinite(h) ? { w, h } : null;
  };
  const taps = [];
  for (const el of set) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const inline = cs.display === 'inline' && !!el.closest('p,li,span,div') && el.tagName === 'A';
    let effW = r.width;
    let effH = r.height;
    for (const w of ['::after', '::before']) {
      const p = pseudo(el, w);
      if (p) {
        effW = Math.max(effW, p.w);
        effH = Math.max(effH, p.h);
      }
    }
    const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    taps.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      label,
      cls: (typeof el.className === 'string' ? el.className : '').split(/\s+/).slice(0, 3).join(' '),
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      effW: Math.round(effW * 10) / 10,
      effH: Math.round(effH * 10) / 10,
      inline,
      x: Math.round(r.left),
      y: Math.round(r.top + window.scrollY),
    });
  }
  const small = taps.filter((t) => !t.inline && (t.w < 44 || t.h < 44));
  const smallEff = taps.filter((t) => !t.inline && (t.effW < 44 || t.effH < 44));

  // Cỡ chữ & họ chữ
  const fontSizes = {};
  const families = {};
  let textEls = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || !isVisible(el)) continue;
    const cs = getComputedStyle(el);
    const fs = Math.round(parseFloat(cs.fontSize) * 10) / 10;
    fontSizes[fs] = (fontSizes[fs] || 0) + 1;
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    families[fam] = (families[fam] || 0) + 1;
    textEls++;
  }
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(isVisible).map((h) => `${h.tagName.toLowerCase()}:${h.textContent.trim().slice(0, 40)}`);
  const h1 = document.querySelectorAll('h1').length;
  const de = document.documentElement;
  const bodyText = (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 6000);
  const imgs = [...document.images].filter(isVisible);
  return {
    url: location.pathname + location.search,
    title: document.title,
    lang: de.lang,
    scrollW: de.scrollWidth,
    scrollH: Math.max(de.scrollHeight, document.body.scrollHeight),
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    hOverflow: de.scrollWidth > window.innerWidth + 1,
    tapTotal: taps.length,
    tapSmall: small.length,
    tapSmallEff: smallEff.length,
    tapSmallList: small.slice(0, 40),
    tapSmallEffList: smallEff.slice(0, 40),
    fontSizes,
    families,
    textEls,
    tinyText: Object.entries(fontSizes).filter(([k]) => Number(k) < 12).reduce((a, [, v]) => a + v, 0),
    h1,
    headings: headings.slice(0, 20),
    hasMain: !!document.querySelector('main,[role=main]'),
    images: imgs.length,
    imagesNoAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
    bodyText,
  };
}

export async function runAxe(page) {
  await page.addScriptTag({ content: axeSource() });
  return page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      count: v.nodes.length,
      nodes: v.nodes.slice(0, 4).map((n) => ({
        target: (n.target || []).join(' ').slice(0, 120),
        html: (n.html || '').slice(0, 140),
        data: v.id === 'color-contrast' ? (n.any[0] && n.any[0].data ? { fg: n.any[0].data.fgColor, bg: n.any[0].data.bgColor, ratio: n.any[0].data.contrastRatio, need: n.any[0].data.expectedContrastRatio, size: n.any[0].data.fontSize } : null) : undefined,
      })),
    }));
  });
}
