import type { Page } from '@playwright/test';

/**
 * Bộ dò thêm cho khổ hẹp (320 / 360px) của web khách, dùng cùng `probeLayout` và `probeTapTargets`: điều khiển không có tên đọc được, hai phần tử `position: fixed`
 * (header, thanh dưới, thanh dính của trang) chồng lên nhau, ảnh khai báo `sizes` rộng hơn khung thật, và điều khiển nhận focus bàn phím mà không đổi gì nhìn thấy được.
 * Chạy trong trình duyệt; trả danh sách lỗi dạng chữ để `expect(...).toEqual([])` in đúng chỗ hỏng.
 */

/** Điều khiển nhìn thấy mà trình đọc màn hình không đọc ra tên (nút chỉ có biểu tượng thiếu `aria-label`). */
export async function probeUnnamedControls(page: Page, scope?: string): Promise<string[]> {
  return page.evaluate((scopeSel) => {
    const root = (scopeSel ? document.querySelector(scopeSel) : document.body) ?? document.body;
    const nameOf = (el: Element): string => {
      const aria = el.getAttribute('aria-label')?.trim();
      if (aria) return aria;
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const t = by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        if (t) return t;
      }
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        if (el.labels && Array.from(el.labels).some((l) => (l.textContent ?? '').trim())) return 'label';
        if ((el as HTMLInputElement).placeholder?.trim()) return 'placeholder';
        if (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(el.type) && el.value) return 'value';
      }
      if ((el.textContent ?? '').replace(/\s+/g, '').length > 0) return 'text';
      if (el.querySelector('img[alt]:not([alt=""])')) return 'img';
      if (el.querySelector('svg title')) return 'svg-title';
      if (el.getAttribute('title')?.trim()) return 'title';
      return '';
    };
    const out: string[] = [];
    for (const el of Array.from(root.querySelectorAll('button, a[href], [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], input:not([type="hidden"]), select, textarea'))) {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (s.display === 'none' || s.visibility === 'hidden' || r.width < 2 || r.height < 2) continue;
      if (el.closest('[aria-hidden="true"], [hidden], [inert]')) continue;
      if (nameOf(el)) continue;
      const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).slice(0, 2).join('.');
      out.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}: không có tên đọc được (${Math.round(r.width)}×${Math.round(r.height)}px)`);
    }
    return out;
  }, scope ?? null);
}

/** Hai phần tử `position: fixed` đang hiện ở khung nhìn hiện tại chồng lên nhau (không phải cha–con). Phần tử `pointer-events: none` được bỏ qua. */
export async function probeFixedOverlap(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const label = (el: Element): string => {
      const id = el.getAttribute('data-testid');
      const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).slice(0, 2).join('.');
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${cls ? `.${cls}` : ''}`;
    };
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const fixed: { el: Element; r: DOMRect }[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const s = getComputedStyle(el);
      if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none' || Number(s.opacity) === 0) continue;
      if (el.closest('[aria-hidden="true"], [data-probe-ignore]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 16 || r.height < 16 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      // Lớp phủ che cả khung (nền mờ của tấm) không phải phần tử để so.
      if (r.width >= vw - 1 && r.height >= vh - 1) continue;
      fixed.push({ el, r });
    }
    const out: string[] = [];
    for (let i = 0; i < fixed.length; i++) {
      for (let j = i + 1; j < fixed.length; j++) {
        const a = fixed[i]!;
        const b = fixed[j]!;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 1 && h > 1) out.push(`${label(a.el)} chồng ${label(b.el)}: ${Math.round(w)}×${Math.round(h)}px`);
      }
    }
    return out;
  });
}

/**
 * Ảnh có `srcset` mà `sizes` thiếu hoặc là 100vw trong khi khung thật hẹp hơn 60% khung nhìn: trình duyệt tải bản ảnh to hơn cần (LCP chậm, tốn dữ liệu di động).
 * Ảnh không hiện không tính.
 */
export async function probeImageSizes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const img of Array.from(document.querySelectorAll('img[srcset]'))) {
      const r = img.getBoundingClientRect();
      const s = getComputedStyle(img);
      if (s.display === 'none' || s.visibility === 'hidden' || r.width < 2 || r.height < 2) continue;
      if (img.closest('[aria-hidden="true"]')) continue;
      const sizes = (img.getAttribute('sizes') ?? '').trim();
      if ((sizes === '' || sizes === '100vw') && r.width < vw * 0.6) {
        out.push(`img ${(img.getAttribute('alt') ?? '').slice(0, 24) || img.getAttribute('src')?.slice(-30)}: sizes="${sizes || '(thiếu)'}" nhưng khung chỉ rộng ${Math.round(r.width)}px/${vw}px`);
      }
    }
    return out;
  });
}

/**
 * Bấm Tab `steps` lần; mỗi điều khiển nhận focus bàn phím phải đổi được thứ gì đó nhìn thấy (outline, bóng, màu viền hoặc nền) trên chính nó, trên `::after` phủ cả thẻ,
 * hoặc trên khung bọc `:focus-within` (ô tìm kiếm). So giá trị lúc có focus với lúc vừa `blur`, nên bóng trang trí có sẵn (thanh dưới) không bị tính là vòng focus.
 * Tắt transition trong lúc đo để giá trị sau `blur` là giá trị cuối, không phải giá trị đang chuyển. Trả điều khiển không đổi gì.
 */
export async function probeFocusRing(page: Page, steps = 30): Promise<string[]> {
  const out = new Set<string>();
  const style = await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    const problem = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || !el.matches(':focus-visible')) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      const signature = (s: CSSStyleDeclaration): string => [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.backgroundColor].join('|');
      const nodes: [Element, string | null][] = [
        [el, null],
        [el, '::after'],
      ];
      for (let p = el.parentElement, depth = 0; p && depth < 3; p = p.parentElement, depth++) {
        if (p.matches(':focus-within')) nodes.push([p, null]);
      }
      const read = (): string => nodes.map(([n, pseudo]) => signature(getComputedStyle(n, pseudo))).join('#');
      const focused = read();
      el.blur();
      const blurred = read();
      el.focus();
      if (focused !== blurred) return null;
      const id = el.getAttribute('data-testid');
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28);
      const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).slice(0, 2).join('.');
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${cls ? `.${cls}` : ''}${name ? ` "${name}"` : ''}: nhận focus bàn phím mà không đổi gì nhìn thấy được`;
    });
    if (problem) out.add(problem);
  }
  await style.evaluate((n) => (n as Element).remove());
  return [...out];
}
