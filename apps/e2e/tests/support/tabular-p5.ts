import type { Page } from '@playwright/test';

/**
 * Dò số đều cho chữ có số xen câu mà `probeLayout.notTabular` bỏ qua (nó chỉ xét ô chỉ chứa một số tiền hay số đếm): đồng hồ đếm ngược, "Đã bán x/y",
 * mốc giờ của hành trình đơn ("14:05 07/11"), khoảng giá ("Từ 100k đến 500k"), số kết quả và mã vận đơn. Phần tử nào có chữ riêng khớp mà
 * `font-variant-numeric` không có `tabular-nums` thì bị báo; số thay đổi mỗi giây hay mỗi lần lọc làm chữ xung quanh rung nếu không đều.
 */
const WATCHED = [
  /(?:^|\s)Đã bán\s+\d/i,
  /(?:^|\s)Còn\s+\d/i,
  /^\d{1,3}\s*\/\s*\d{1,3}$/,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
  /\d+\s*(?:k|tr)\b/i,
  /\d+\s*(?:sản phẩm|đánh giá)/i,
  /\b[A-Z]{2,5}-?\d{8,}\b/,
  /^(?:Từ|Dưới|Trên)\s.*\d/i,
];

export async function probeTabularTexts(page: Page, scope = 'body'): Promise<string[]> {
  return page.evaluate(
    ({ scope: sel, sources }) => {
      const watched = sources.map((s) => new RegExp(s.source, s.flags));
      const root = document.querySelector(sel) ?? document.body;
      const out: string[] = [];
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (el.closest('script, style, svg, [data-probe-ignore]')) continue;
        const text = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? '')
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text || text.length > 48 || !watched.some((re) => re.test(text))) continue;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (s.display === 'none' || s.visibility === 'hidden' || r.width <= 1 || r.height <= 1) continue;
        if (!s.fontVariantNumeric.includes('tabular-nums')) {
          const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).slice(0, 2).join('.');
          out.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${text.slice(0, 40)}"`);
        }
      }
      return out;
    },
    { scope, sources: WATCHED.map((re) => ({ source: re.source, flags: re.flags })) },
  );
}
