import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { probeLayout } from './layout-probe';

/**
 * tubu-w3-04: bộ dò chuyển khổ (điện thoại 360/390, máy tính bảng 768, máy tính 1024/1440) cho các màn khách của web và Mini App.
 * Đo những gì W182 (tràn, chữ đè, vùng chạm) chưa đo: số cột và độ thẳng hàng của lưới thẻ sản phẩm, khung trang có bị kéo giãn,
 * danh sách một cột kéo dài cả màn máy tính, khối dính trong khung nội dung, các thanh cố định/dính chồng nhau, thanh đáy che chân trang,
 * và chữ tiếng Việt quá nhỏ hoặc dòng quá sát làm dấu chồng lên nhau. Chỉ đo; spec quyết lỗi nào làm đỏ.
 */

export type SweepKind = 'phone' | 'tablet' | 'desktop';

export interface SweepSize {
  width: number;
  height: number;
  kind: SweepKind;
}

export const SWEEP_SIZES: SweepSize[] = [
  { width: 1440, height: 900, kind: 'desktop' },
  { width: 1024, height: 768, kind: 'desktop' },
  { width: 768, height: 1024, kind: 'tablet' },
  { width: 390, height: 844, kind: 'phone' },
  { width: 360, height: 800, kind: 'phone' },
];

/** Bề rộng tối đa của khung trang web (`max-w-frame` ở tailwind.config.ts). */
export const FRAME_MAX = 1200;

/**
 * Máy tính Windows/Linux dùng thanh cuộn chiếm chỗ (~15–17px), còn headless Chromium ẩn thanh cuộn: phần tử rộng `100vw` hay lưới vừa khít
 * chỉ tràn trên máy thật. Kiểu `::-webkit-scrollbar` có bề rộng làm Chromium vẽ thanh cuộn cổ điển chiếm chỗ, như Windows.
 */
export const CLASSIC_SCROLLBAR_CSS = '::-webkit-scrollbar{width:15px;height:15px;background:#eee}::-webkit-scrollbar-thumb{background:#bbb}';

export interface GridRow {
  label: string;
  cols: number;
  tiles: number;
  tileW: number;
  /** Lệch chiều cao lớn nhất giữa các thẻ cùng hàng (px). */
  heightSpread: number;
  /** Lệch mép trên của dòng giá giữa các thẻ cùng hàng (px). */
  priceSpread: number;
  /** Lệch mép trên của nút thêm nhanh giữa các thẻ cùng hàng (px); null khi thẻ không có nút. */
  ctaSpread: number | null;
}

export interface StickyBox {
  label: string;
  left: number;
  width: number;
  /** Mép trên trong tài liệu lúc đầu trang. */
  top: number;
  /** Mép trên trong khung nhìn sau khi cuộn nửa trang. */
  scrolledTop: number;
  /** Giá trị `top` của CSS (px); null khi dính theo `bottom`. */
  cssTop: number | null;
}

export interface ResponsiveFindings {
  vw: number;
  vh: number;
  docH: number;
  overflowX: number;
  overflow: string[];
  /** Khung trang: phần tử đầu tiên trong `#main-content` có `max-width` tính bằng px và rộng ít nhất nửa khung nhìn (PAGE_WIDE, khung tài khoản); `inner` = bề rộng trừ lề trong. */
  frame: { left: number; right: number; width: number; inner: number } | null;
  /** Khung của hàng logo ở header (cùng cách tìm): trang rộng phải thẳng mép với nó từ md. */
  headerFrame: { left: number; right: number } | null;
  grids: GridRow[];
  stretched: string[];
  sticky: StickyBox[];
  fixedOverlap: string[];
  bottomBars: string[];
  /** Mép trên thanh đáy cố định trừ mép dưới nội dung thấp nhất (gồm chân trang) khi đã cuộn hết trang: âm = thanh che nội dung. */
  bottomClearance: number | null;
  /** Nội dung bị phần nhô lên của thanh đáy (nút tròn giữa thanh tab) che khi đã cuộn hết trang. */
  bottomCovered: string[];
  smallText: { count: number; sample: string[] };
  tightLines: string[];
}

export async function probeResponsive(page: Page): Promise<ResponsiveFindings> {
  const layout = await probeLayout(page, {});
  const base = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const label = (el: Element): string => {
      const id = el.getAttribute('data-testid') ?? el.getAttribute('data-ds') ?? el.getAttribute('data-ds-part');
      const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${cls ? `.${cls}` : ''}`;
    };
    const shown = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
    };
    const hidden = (el: Element): boolean => !!el.closest('[aria-hidden="true"], [hidden], [inert], script, style, noscript, [data-probe-ignore], [role="dialog"]');
    const all = Array.from(document.body.querySelectorAll('*'));
    const main = document.querySelector('#main-content main') ?? document.querySelector('main');
    const root = document.getElementById('main-content') ?? main;
    const framed = (el: Element) => getComputedStyle(el).maxWidth.endsWith('px') && shown(el) && el.getBoundingClientRect().width >= vw * 0.5;
    const frameEl = (root ? [root, ...Array.from(root.querySelectorAll('*'))] : []).find(framed) ?? main;
    const headerEl = Array.from(document.querySelectorAll('header *')).find(framed);
    const hr = headerEl?.getBoundingClientRect();
    const headerFrame = hr ? { left: Math.round(hr.left), right: Math.round(hr.right) } : null;
    let frame: { left: number; right: number; width: number; inner: number } | null = null;
    if (frameEl) {
      const fr = frameEl.getBoundingClientRect();
      const fs = getComputedStyle(frameEl);
      frame = { left: Math.round(fr.left), right: Math.round(fr.right), width: Math.round(fr.width), inner: Math.round(fr.width - parseFloat(fs.paddingLeft) - parseFloat(fs.paddingRight)) };
    }

    // Lưới thẻ sản phẩm: cha của >= 2 thẻ `data-ds="product-tile"` (thẻ có thể nằm trong <li>). Gom theo hàng (mép trên làm tròn 4px).
    const grids: { label: string; cols: number; tiles: number; tileW: number; heightSpread: number; priceSpread: number; ctaSpread: number | null }[] = [];
    const tiles = Array.from(document.querySelectorAll('[data-ds="product-tile"]')).filter((t) => shown(t) && !hidden(t));
    const cellOf = (t: Element): Element => {
      let cell: Element = t;
      while (cell.parentElement && cell.parentElement.children.length === 1 && cell.parentElement !== document.body) cell = cell.parentElement;
      return cell;
    };
    const byContainer = new Map<Element, Element[]>();
    for (const t of tiles) {
      const parent = cellOf(t).parentElement;
      if (!parent) continue;
      const s = getComputedStyle(parent);
      // Kệ ngang cuộn được (rail) không phải lưới.
      if (s.display === 'flex' && s.flexWrap === 'nowrap') continue;
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') continue;
      byContainer.set(parent, [...(byContainer.get(parent) ?? []), t]);
    }
    const spread = (xs: number[]) => (xs.length < 2 ? 0 : Math.max(...xs) - Math.min(...xs));
    for (const [container, list] of byContainer) {
      if (list.length < 2) continue;
      const rows = new Map<number, Element[]>();
      for (const t of list) {
        const top = Math.round(cellOf(t).getBoundingClientRect().top / 4);
        rows.set(top, [...(rows.get(top) ?? []), t]);
      }
      let cols = 0;
      let heightSpread = 0;
      let priceSpread = 0;
      let ctaSpread: number | null = null;
      for (const row of rows.values()) {
        cols = Math.max(cols, row.length);
        heightSpread = Math.max(heightSpread, spread(row.map((t) => t.getBoundingClientRect().height)));
        const prices = row.map((t) => t.querySelector('[data-ds-part="price"]')?.getBoundingClientRect().top).filter((x): x is number => typeof x === 'number');
        priceSpread = Math.max(priceSpread, spread(prices));
        const ctas = row.map((t) => cellOf(t).querySelector('button')?.getBoundingClientRect().top).filter((x): x is number => typeof x === 'number');
        if (ctas.length >= 2) ctaSpread = Math.max(ctaSpread ?? 0, spread(ctas));
      }
      grids.push({
        label: label(container),
        cols,
        tiles: list.length,
        tileW: Math.round(list[0]!.getBoundingClientRect().width),
        heightSpread: Math.round(heightSpread * 10) / 10,
        priceSpread: Math.round(priceSpread * 10) / 10,
        ctaSpread: ctaSpread === null ? null : Math.round(ctaSpread * 10) / 10,
      });
    }

    // Danh sách một cột kéo giãn trên máy tính: >= 2 thẻ CÙNG KIỂU (cùng thẻ HTML + class, có nền, viền hoặc bóng) cùng mép trái, cùng bề rộng,
    // xếp dọc, rộng hơn 760px và chiếm từ 3/4 bề rộng trong của khung trang (cột trái của trang hai cột như Thanh toán không tính). Các khối
    // toàn chiều ngang khác kiểu nhau (hero + thanh tab, hàng liên kết + bộ chọn) không phải danh sách nên không tính.
    const stretched: string[] = [];
    const wideMin = Math.max(760, (frame?.inner ?? vw) * 0.75);
    if (vw >= 1024) {
      const looksLikeCard = (el: Element): boolean => {
        const s = getComputedStyle(el);
        const bg = s.backgroundColor;
        const hasBg = bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== getComputedStyle(document.body).backgroundColor;
        const hasBorder = parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderLeftWidth) > 0;
        return hasBg || hasBorder || s.boxShadow !== 'none';
      };
      for (const el of all) {
        if (!shown(el) || hidden(el) || el.closest('header, footer, nav')) continue;
        const kids = Array.from(el.children).filter((k) => shown(k));
        if (kids.length < 2) continue;
        const rects = kids.map((k) => k.getBoundingClientRect());
        const w0 = rects[0]!.width;
        const l0 = rects[0]!.left;
        if (w0 < wideMin) continue;
        if (!rects.every((r) => Math.abs(r.width - w0) <= 4 && Math.abs(r.left - l0) <= 4)) continue;
        const bySig = new Map<string, number>();
        for (const k of kids) if (looksLikeCard(k)) { const sig = `${k.tagName}.${k.getAttribute('class') ?? ''}`; bySig.set(sig, (bySig.get(sig) ?? 0) + 1); }
        const cards = Math.max(0, ...bySig.values());
        if (cards < 2) continue;
        stretched.push(`${label(el)} ${cards} thẻ × ${Math.round(w0)}px`);
      }
    }

    // Phần tử dính trong khung nội dung (cột tóm tắt, ô ảnh PDP): ghi vị trí lúc đầu trang; đo lại sau khi cuộn.
    const stickyEls = all.filter((el) => shown(el) && !hidden(el) && getComputedStyle(el).position === 'sticky' && !!main?.contains(el));
    const sticky = stickyEls
      .filter((el) => !stickyEls.some((o) => o !== el && o.contains(el)))
      .map((el) => {
        const r = el.getBoundingClientRect();
        el.setAttribute('data-sweep-sticky', '');
        const t = parseFloat(getComputedStyle(el).top);
        return { label: label(el), left: Math.round(r.left), width: Math.round(r.width), top: Math.round(r.top + window.scrollY), scrolledTop: Math.round(r.top), cssTop: Number.isFinite(t) ? Math.round(t) : null };
      });

    // Chữ nhỏ và dòng sát. Bỏ qua chân trang (chữ pháp lý nhỏ là chủ ý).
    const viet = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    const smallSample: string[] = [];
    let smallCount = 0;
    const tightLines: string[] = [];
    for (const el of all) {
      if (hidden(el) || !shown(el) || el.closest('footer')) continue;
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      const s = getComputedStyle(el);
      const fs = parseFloat(s.fontSize);
      if (fs < 12) {
        smallCount += 1;
        if (smallSample.length < 8) smallSample.push(`${label(el)} ${fs}px "${own.slice(0, 20)}"`);
      }
      if (!viet.test(own)) continue;
      const lh = s.lineHeight === 'normal' ? fs * 1.2 : parseFloat(s.lineHeight);
      const ratio = lh / fs;
      const r = el.getBoundingClientRect();
      const multiLine = r.height >= lh * 1.8;
      const clipsY = s.overflowY === 'hidden' || s.overflowY === 'clip';
      if (((multiLine && ratio < 1.2) || (clipsY && ratio < 1.15)) && tightLines.length < 8) {
        tightLines.push(`${label(el)} ${fs}px/${Math.round(lh * 10) / 10}px "${own.slice(0, 20)}"`);
      }
    }

    return { vw, vh, frame, headerFrame, grids, stretched, sticky, smallText: { count: smallCount, sample: smallSample }, tightLines };
  });

  // Cuộn nửa trang: phần tử dính còn bám đỉnh không, và các thanh cố định/dính có chồng nhau không.
  const docH = await page.evaluate(() => {
    // Mini App cuộn trong `.zaui-page`, web cuộn cả tài liệu.
    const p = document.querySelector<HTMLElement>('.zaui-page');
    const sc = p && p.scrollHeight > p.clientHeight + 1 ? p : (document.scrollingElement as HTMLElement);
    sc.scrollTop = Math.max(0, Math.round((sc.scrollHeight - sc.clientHeight) / 2));
    return sc.scrollHeight;
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const scrolled = await page.evaluate(() => {
    const label = (el: Element): string => {
      const id = el.getAttribute('data-testid') ?? el.getAttribute('data-ds');
      const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${cls ? `.${cls}` : ''}`;
    };
    const shown = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 && s.pointerEvents !== 'none';
    };
    const vh = window.innerHeight;
    const stickyTops = Array.from(document.querySelectorAll('[data-sweep-sticky]')).map((el) => Math.round(el.getBoundingClientRect().top));
    const pinned = Array.from(document.body.querySelectorAll('*')).filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
      if (!shown(el) || el.closest('[aria-hidden="true"], [hidden], [inert], [data-probe-ignore]')) return false;
      const r = el.getBoundingClientRect();
      if (cs.position === 'sticky') {
        // Phần tử dính chỉ là "thanh" khi đang bám mép trên hoặc mép dưới khung nhìn.
        const top = parseFloat(cs.top);
        const bottom = parseFloat(cs.bottom);
        const stuckTop = Number.isFinite(top) && Math.abs(r.top - top) <= 1;
        const stuckBottom = Number.isFinite(bottom) && Math.abs(vh - r.bottom - bottom) <= 1;
        if (!stuckTop && !stuckBottom) return false;
      }
      return r.bottom > 0 && r.top < vh;
    });
    const outer = pinned.filter((el) => !pinned.some((o) => o !== el && o.contains(el)));
    const fixedOverlap: string[] = [];
    for (let i = 0; i < outer.length; i += 1) {
      for (let j = i + 1; j < outer.length; j += 1) {
        const a = outer[i]!.getBoundingClientRect();
        const b = outer[j]!.getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 4 && h > 4) fixedOverlap.push(`${label(outer[i]!)} × ${label(outer[j]!)} (${Math.round(w)}×${Math.round(h)})`);
      }
    }
    return { stickyTops, fixedOverlap: fixedOverlap.slice(0, 6) };
  });

  // Cuối trang: thanh đáy cố định (thanh 5 tab, thanh mua dính) không được che nội dung hay chân trang. Lưới Gợi ý tải thêm khi chạm đáy, nên cuộn
  // tới khi chiều cao trang đứng yên hai lần liền (đo lúc trang còn đang dài ra thì món mới nằm dưới thanh là chuyện cuộn bình thường, không phải lỗi).
  const toEnd = () =>
    page.evaluate(() => {
      const p = document.querySelector<HTMLElement>('.zaui-page');
      const sc = p && p.scrollHeight > p.clientHeight + 1 ? p : (document.scrollingElement as HTMLElement);
      sc.scrollTop = sc.scrollHeight;
      return sc.scrollHeight;
    });
  let lastH = await toEnd();
  for (let i = 0, still = 0; i < 12 && still < 2; i += 1) {
    await page.waitForTimeout(500);
    const h = await toEnd();
    still = h === lastH ? still + 1 : 0;
    lastH = h;
  }
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const end = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const label = (el: Element): string => {
      const id = el.getAttribute('data-testid');
      const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${cls ? `.${cls}` : ''}`;
    };
    const shown = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
    };
    const fixedAncestor = (el: Element): boolean => {
      for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return true;
      return false;
    };
    const all = Array.from(document.body.querySelectorAll('*'));
    const bars = all.filter((el) => {
      if (getComputedStyle(el).position !== 'fixed' || !shown(el) || el.closest('[aria-hidden="true"], [data-probe-ignore], [role="dialog"]')) return false;
      const r = el.getBoundingClientRect();
      return r.width >= vw * 0.5 && r.bottom >= vh - 4 && r.top > vh * 0.5;
    });
    const outer = bars.filter((el) => !bars.some((o) => o !== el && o.contains(el)));
    if (outer.length === 0) return { bottomBars: [] as string[], bottomClearance: null as number | null, bottomCovered: [] as string[] };
    const barTop = Math.min(...outer.map((el) => el.getBoundingClientRect().top));
    // Phần nhô lên trên mép thanh (nút tròn Vườn Xanh của thanh tab).
    const bumps = outer
      .flatMap((b) => Array.from(b.querySelectorAll('*')))
      .filter((el) => shown(el) && el.getBoundingClientRect().top < barTop - 1)
      .map((el) => el.getBoundingClientRect());
    let lowest = 0;
    const bottomCovered: string[] = [];
    for (const el of all) {
      if (fixedAncestor(el) || !shown(el) || el.closest('[aria-hidden="true"], [data-probe-ignore]')) continue;
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
      if (!hasText && !el.matches('img, button, a[href], input, select, textarea')) continue;
      const r = el.getBoundingClientRect();
      if (r.top > vh) continue;
      lowest = Math.max(lowest, r.bottom);
      const hit = bumps.some((b) => Math.min(b.right, r.right) - Math.max(b.left, r.left) > 4 && Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 4);
      if (hit && bottomCovered.length < 4) bottomCovered.push(label(el));
    }
    return { bottomBars: outer.map(label), bottomClearance: Math.round((barTop - lowest) * 10) / 10, bottomCovered };
  });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll<HTMLElement>('.zaui-page').forEach((el) => {
      el.scrollTop = 0;
    });
  });
  const overflowX = await page.evaluate(() =>
    Math.max(...[document.documentElement, ...Array.from(document.querySelectorAll<HTMLElement>('.zaui-page'))].map((el) => el.scrollWidth - el.clientWidth)),
  );

  return {
    vw: base.vw,
    vh: base.vh,
    docH,
    overflowX,
    overflow: layout.overflow.slice(0, 6),
    frame: base.frame,
    headerFrame: base.headerFrame,
    grids: base.grids,
    stretched: base.stretched,
    sticky: base.sticky.map((s, i) => ({ ...s, scrolledTop: scrolled.stickyTops[i] ?? s.scrolledTop })),
    fixedOverlap: scrolled.fixedOverlap,
    bottomBars: end.bottomBars,
    bottomClearance: end.bottomClearance,
    bottomCovered: end.bottomCovered,
    smallText: base.smallText,
    tightLines: base.tightLines,
  };
}

/** Thẻ sản phẩm đầu tiên của lưới đổi dáng khi rê chuột (máy tính): so bóng, viền, nền, transform của thẻ, ảnh và tên trước/sau `hover`. */
export async function tileHoverChanges(page: Page): Promise<boolean | null> {
  const tile = page.locator('[data-ds="product-tile"][data-ds-variant="grid"]').first();
  if ((await tile.count()) === 0) return null;
  await tile.scrollIntoViewIfNeeded();
  const read = () =>
    tile.evaluate((el) => {
      const pick = (n: Element | null) => {
        if (!n) return '';
        const s = getComputedStyle(n);
        return [s.boxShadow, s.borderColor, s.backgroundColor, s.transform, s.color, s.textDecorationLine].join('|');
      };
      return [pick(el), pick(el.querySelector('img')), pick(el.querySelector('[data-ds-part="name"]')), pick(el.querySelector('[data-ds-part="media"]'))].join('#');
    });
  await page.mouse.move(1, 1);
  const before = await read();
  await tile.hover();
  await page.waitForTimeout(400);
  const after = await read();
  await page.mouse.move(1, 1);
  return before !== after;
}

export const SWEEP_DIR = process.env.RESP_SWEEP_DIR;
export const SWEEP_PHASE = process.env.RESP_SWEEP_PHASE ?? 'before';

export function recordSweep(app: 'web' | 'miniapp', key: string, size: SweepSize, row: object): void {
  if (!SWEEP_DIR) return;
  const dir = path.join(SWEEP_DIR, SWEEP_PHASE);
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, `${app}.jsonl`), `${JSON.stringify({ app, key, width: size.width, height: size.height, ...row })}\n`);
}

export function sweepShotPath(app: 'web' | 'miniapp', key: string, size: SweepSize): string {
  const dir = path.join(SWEEP_DIR!, SWEEP_PHASE, app);
  mkdirSync(dir, { recursive: true });
  const slug = key.replace(/^\/+|\/+$/g, '').replace(/[/?=&:]+/g, '_') || 'home';
  return path.join(dir, `${slug}__${size.width}.jpg`);
}
