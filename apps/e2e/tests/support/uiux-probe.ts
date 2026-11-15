import type { Locator, Page } from '@playwright/test';

/** Mốc cho biết từng màn đã dựng xong (không phải khung chờ hay màn lỗi) trước khi đo; Mini và web dùng chung. */
export function screenReady(page: Page, file: string): Locator {
  switch (file) {
    case 'pdp':
      return page.getByRole('heading', { level: 1 }).first();
    case 'orders':
      return page.getByTestId('order-card').first();
    case 'orders-empty':
      return page.getByText(/chưa có đơn/).first();
    case 'order-detail':
      return page.getByTestId('status-hero');
    case 'bank':
      // Web có hai nút "Tôi đã chuyển khoản" (một ẩn theo cỡ màn): lấy nút đang hiện.
      return page.locator('button:visible', { hasText: /Tôi đã chuyển khoản/ }).first();
    case 'account':
      return page.getByText('Đơn của tôi').first();
    default:
      return page.getByText(/Thêm địa chỉ/).first();
  }
}

/** W169: đo tràn ngang, vùng chạm < 44px và số nút xanh đặc rộng của màn đang mở (Mini và web dùng chung). */
export interface Probe {
  overflowX: number;
  small: { tag: string; text: string; w: number; h: number; top: number }[];
  rightOverflow: { tag: string; text: string; right: number }[];
  primaryGreen: number;
}

export async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };
    const label = (el: Element) => ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const interactive = Array.from(
      document.querySelectorAll('button, a[href], [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="option"], input:not([type="hidden"]), select, textarea'),
    ).filter(visible);
    const small = interactive
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => {
        if ((el as HTMLElement).closest('[aria-hidden="true"]')) return false;
        if (r.width <= 2 && r.height <= 2) return false;
        // Vùng chạm mở rộng bằng ::after (tubu-hit-44*, liên kết kéo giãn phủ cả thẻ): tính hộp ::after thật, từng chiều.
        const after = getComputedStyle(el, '::after');
        const grows = after.content !== 'none' && after.position === 'absolute';
        const w = Math.max(r.width, grows ? parseFloat(after.width) || 0 : 0);
        const h = Math.max(r.height, grows ? parseFloat(after.height) || 0 : 0);
        return w < 44 || h < 44;
      })
      .map(({ el, r }) => ({ tag: el.tagName.toLowerCase(), text: label(el), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + window.scrollY) }));
    const rightOverflow = Array.from(document.querySelectorAll('body *'))
      .filter(visible)
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.right > vw + 1)
      .slice(0, 8)
      .map(({ el, r }) => ({ tag: el.tagName.toLowerCase(), text: label(el), right: Math.round(r.right) }));
    const greens = interactive.filter((el) => {
      const bg = getComputedStyle(el).backgroundColor;
      const m = /rgba?\((\d+), (\d+), (\d+)/.exec(bg);
      if (!m) return false;
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      return g > r + 20 && g > b + 10 && g < 160 && el.getBoundingClientRect().width > 80;
    });
    // Mini cuộn bên trong .zaui-page nên tràn ngang không đổi bề rộng tài liệu: lấy lớn nhất của tài liệu và mọi .zaui-page.
    const scrollers = [document.documentElement, ...Array.from(document.querySelectorAll<HTMLElement>('.zaui-page'))];
    const overflowX = Math.max(...scrollers.map((el) => el.scrollWidth - el.clientWidth));
    return { overflowX, small, rightOverflow, primaryGreen: greens.length };
  });
}
