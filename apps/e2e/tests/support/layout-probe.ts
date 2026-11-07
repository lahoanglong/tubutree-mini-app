import type { Page } from '@playwright/test';

/**
 * Bộ dò bố cục ở khổ hẹp (320 / 360 / 375px) dùng chung cho Mini App và web: phần tử tràn ngang khỏi khung nhìn, thanh dính đáy
 * (`data-testid="sticky-bar"`) tràn khung hoặc có hai con chồng lên nhau, và số tiền / số đếm vẽ bằng số không đều (thiếu `tabular-nums`).
 * Chạy trong trình duyệt bằng `page.evaluate`; trả danh sách lỗi dạng chữ để `expect(...).toEqual([])` in ra đúng chỗ hỏng.
 */
export const NARROW_WIDTHS = [320, 360, 375] as const;

/**
 * Một ô chỉ chứa số tiền, điểm hoặc số đếm ngắn: "65.000đ", "-15.000đ", "Tiết kiệm 54.000đ", "120 điểm", "x3", "2". Câu dài có số
 * xen giữa ("Mua thêm 107.000đ để được miễn phí giao") không tính: nó căn trái nên số nhảy bề rộng không lộ ra. Phần trăm cũng không tính: "-12%"
 * hay "Nguyên chất 100%" là huy hiệu một mình, không xếp cột cạnh số khác.
 */
export const NUMERIC_TEXT = /^(?=.{1,28}$)(?:[^\d]{0,18}\d[\d.,]*\s*(?:đ|₫|k|tr|điểm)(?:\s.{0,8})?|\s*[x×]?\s*\d{1,6}\s*|[^\d]{0,12}\d{1,4}\s*(?:sản phẩm|mã|món|đánh giá))$/i;

export interface LayoutFindings {
  overflow: string[];
  stickyBar: string[];
  notTabular: string[];
}

interface ProbeOptions {
  /** Chỉ dò trong phần tử khớp bộ chọn này (mặc định cả trang). */
  scope?: string;
  /** Bộ chọn các phần tử số được phép không tabular (ví dụ chữ thường có chứa số trong câu). */
  ignoreNumeric?: string[];
}

/**
 * Cuộn mọi vùng cuộn (cả cửa sổ) tới đáy rồi đo khoảng giữa đáy nội dung thấp nhất và mép trên thanh dính:
 * dương hoặc 0 là nội dung nằm trên thanh, âm là thanh che nội dung. Trả null khi trang không có thanh dính.
 */
export async function stickyBarClearance(page: Page): Promise<number | null> {
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const s = getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) el.scrollTo(0, el.scrollHeight);
    }
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="sticky-bar"]');
    if (!bar) return null;
    const top = bar.getBoundingClientRect().top;
    let lowest = 0;
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (bar.contains(el) || el.closest('[data-probe-ignore]')) continue;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'fixed') continue;
      const leaf = el.children.length === 0 || ['IMG', 'INPUT', 'BUTTON', 'SVG'].includes(el.tagName.toUpperCase());
      if (!leaf) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.top > window.innerHeight) continue;
      if (el.children.length === 0 && !(el.textContent ?? '').trim() && !['IMG', 'INPUT'].includes(el.tagName.toUpperCase())) continue;
      lowest = Math.max(lowest, r.bottom);
    }
    return Math.round((top - lowest) * 10) / 10;
  });
}

export async function probeLayout(page: Page, options: ProbeOptions = {}): Promise<LayoutFindings> {
  return page.evaluate(
    ({ scope, ignoreNumeric, numericSource }) => {
      const root = (scope ? document.querySelector(scope) : document.body) ?? document.body;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const numeric = new RegExp(numericSource, 'i');
      const label = (el: Element): string => {
        const id = el.getAttribute('data-testid');
        const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).slice(0, 2).join('.');
        return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${cls ? `.${cls}` : ''}`;
      };
      const visible = (el: Element): boolean => {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      const clipsX = (el: Element): boolean => getComputedStyle(el).overflowX !== 'visible';

      const overflow: string[] = [];
      if (document.documentElement.scrollWidth > vw + 1) overflow.push(`trang cuộn ngang: scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (!visible(el)) continue;
        if (el.closest('[aria-hidden="true"], svg, [data-probe-ignore]')) continue;
        const r = el.getBoundingClientRect();
        if (r.right <= vw + 0.5 && r.left >= -0.5) continue;
        if (r.right <= 0.5) continue;
        let clipped = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') {
            clipped = true;
            break;
          }
          if (ox !== 'visible') {
            const pr = p.getBoundingClientRect();
            if (pr.right <= vw + 0.5 && pr.left >= -0.5) {
              clipped = true;
              break;
            }
          }
        }
        if (clipped) continue;
        overflow.push(`${label(el)} ra ngoài khung: trái ${Math.round(r.left)} phải ${Math.round(r.right)} (khung ${vw})`);
      }

      const stickyBar: string[] = [];
      const bar = document.querySelector('[data-testid="sticky-bar"]');
      if (bar && visible(bar)) {
        const br = bar.getBoundingClientRect();
        if (br.left < -0.5 || br.right > vw + 0.5) stickyBar.push(`thanh dính tràn ngang: ${Math.round(br.left)}..${Math.round(br.right)} (khung ${vw})`);
        if (br.bottom > vh + 0.5) stickyBar.push(`thanh dính tràn đáy: bottom ${Math.round(br.bottom)} > ${vh}`);
        const kids = Array.from(bar.querySelectorAll('button, a, [role="button"], input, [data-bar-item]')).filter(visible);
        const rects = kids.map((el) => ({ el, r: el.getBoundingClientRect() }));
        for (const { el, r } of rects) {
          if (r.left < br.left - 0.5 || r.right > br.right + 0.5) stickyBar.push(`${label(el)} tràn thanh dính: ${Math.round(r.left)}..${Math.round(r.right)} (thanh ${Math.round(br.left)}..${Math.round(br.right)})`);
          if (el.scrollWidth > el.clientWidth + 1 && clipsX(el) && getComputedStyle(el).textOverflow !== 'ellipsis') {
            stickyBar.push(`${label(el)} cắt chữ không có dấu …: scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
          }
        }
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i]!;
            const b = rects[j]!;
            if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
            const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
            const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
            if (w > 1 && h > 1) stickyBar.push(`${label(a.el)} chồng ${label(b.el)}: ${Math.round(w)}×${Math.round(h)}px`);
          }
        }
      }

      const notTabular: string[] = [];
      for (const el of Array.from(root.querySelectorAll('*'))) {
        const text = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? '')
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text || !numeric.test(text)) continue;
        if (!visible(el) || el.closest('script, style, [data-probe-ignore]')) continue;
        if (ignoreNumeric.some((sel) => el.closest(sel))) continue;
        if (!getComputedStyle(el).fontVariantNumeric.includes('tabular-nums')) notTabular.push(`${label(el)} "${text.slice(0, 40)}"`);
      }
      return { overflow, stickyBar, notTabular };
    },
    { scope: options.scope ?? null, ignoreNumeric: options.ignoreNumeric ?? [], numericSource: NUMERIC_TEXT.source },
  );
}

/**
 * Khoảng cách dọc giữa mép dưới khối nhìn thấy ngay trên dòng "Nhận … Điểm Xanh" (`.tubu-points-earn`, nút có vùng chạm dôi lên bằng lề âm) và mép trên
 * nội dung thật của nút (biểu tượng, chữ, mũi tên). Âm = chữ đè lên dòng giá, lỗi thật khi chữ xuống hai dòng ở 320px. null = trang không có dòng này.
 */
export async function pointsEarnClearance(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const btn = document.querySelector<HTMLElement>('.tubu-points-earn');
    if (!btn) return null;
    let above = btn.previousElementSibling;
    while (above && above.getBoundingClientRect().height < 1) above = above.previousElementSibling;
    if (!above) return null;
    const contentTop = Math.min(...Array.from(btn.children).map((c) => c.getBoundingClientRect().top));
    return Math.round((contentTop - above.getBoundingClientRect().bottom) * 10) / 10;
  });
}
