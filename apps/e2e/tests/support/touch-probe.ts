import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Bộ dò công thái học chạm ở khổ hẹp (320 / 360 / 375px) dùng chung cho Mini App và web (W39A): vùng chạm thật của mọi điều khiển, phản hồi khi nhấn,
 * và chỗ chừa vùng an toàn đáy của thanh dính. Chạy trong trình duyệt; trả danh sách lỗi dạng chữ để `expect(...).toEqual([])` in đúng chỗ hỏng.
 */
export const MIN_TAP = 44;

/** Phần tử bấm được mà trình duyệt coi là một điều khiển. `label` có mặt vì ô chọn tự vẽ (Checkbox, Radio) để input thật trong suốt dưới nhãn. */
const INTERACTIVE = 'button, a[href], [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="link"], input:not([type="hidden"]), select, textarea, summary, label';

export interface TapProbeOptions {
  /** Chỉ dò trong phần tử khớp bộ chọn này (mặc định cả trang). */
  scope?: string;
  /** Phần tử khớp (hoặc nằm trong phần tử khớp) bộ chọn này được miễn, kèm lý do ở chỗ gọi. */
  ignore?: string[];
}

/**
 * Vùng chạm thật của từng điều khiển: từ tâm phần tử, đi từng 1px về bốn phía bằng `elementFromPoint` cho tới khi gặp một thứ không còn thuộc điều khiển đó.
 * Cách này tính cả vùng `::after` giãn ra (`.tubu-hit-44`, liên kết phủ cả thẻ), và tính đúng khi hàng cuộn ngang hay phần tử bên cạnh cắt mất phần giãn.
 * Điều khiển phải đo được ≥ 44 × 44px. Miễn: liên kết nằm giữa câu chữ (WCAG 2.5.8, ngoại lệ "inline"), điều khiển bị che tại tâm (không bấm được ở trạng thái
 * này nên không đo), và điều khiển ẩn khỏi trình đọc.
 */
export async function probeTapTargets(page: Page, options: TapProbeOptions = {}): Promise<string[]> {
  return page.evaluate(
    ({ scope, ignore, selector, min }) => {
      const root = (scope ? document.querySelector(scope) : document.body) ?? document.body;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const label = (el: Element): string => {
        const id = el.getAttribute('data-testid');
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28);
        const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).slice(0, 2).join('.');
        return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}${cls ? `.${cls}` : ''}${name ? ` "${name}"` : ''}`;
      };
      const visible = (el: Element): boolean => {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      // Ô chọn của Mini App: khung `*-hit-area` (cao ≥ 44px) chuyển cú chạm vào đệm sang ô nhập bên trong (form.tsx, forwardPaddingTap), nên đệm cũng là vùng chạm của ô.
      // Ô nhập nằm trong `label` thì cả nhãn là một điều khiển: chạm nhãn hay chạm ô đều bật tắt cùng một ô.
      const ownerOf = (x: number, y: number): Element | null => {
        if (x < 0 || y < 0 || x >= vw || y >= vh) return null;
        const hit = document.elementFromPoint(x, y);
        if (!hit) return null;
        let own: Element | null = hit.closest(selector);
        if (!own) own = hit.closest('[data-testid$="-hit-area"]')?.querySelector(selector) ?? null;
        if (own && own.tagName === 'INPUT') own = own.closest('label') ?? own;
        return own;
      };
      const inlineInText = (el: Element): boolean => {
        if (el.tagName !== 'A' || getComputedStyle(el).display !== 'inline') return false;
        const parent = el.parentElement;
        if (!parent) return false;
        return Array.from(parent.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0);
      };
      const extent = (el: Element, cx: number, cy: number, dx: number, dy: number): number => {
        let n = 0;
        for (let i = 1; i <= 60; i++) {
          if (ownerOf(cx + dx * i, cy + dy * i) !== el) break;
          n = i;
        }
        return n;
      };

      const problems: string[] = [];
      for (const el of Array.from(root.querySelectorAll(selector))) {
        if (!visible(el)) continue;
        if (el.closest('[aria-hidden="true"], [hidden], [inert], [data-probe-ignore]')) continue;
        if (ignore.some((sel) => el.closest(sel))) continue;
        if (inlineInText(el)) continue;
        // label chỉ tính khi nó bọc một ô nhập thật: nhãn chữ trơn không phải điều khiển.
        if (el.tagName === 'LABEL' && !el.querySelector('input, select, textarea') && !el.getAttribute('for')) continue;
        (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.round(r.top + r.height / 2);
        if (ownerOf(cx, cy) !== el) continue;
        const w = extent(el, cx, cy, -1, 0) + extent(el, cx, cy, 1, 0) + 1;
        const h = extent(el, cx, cy, 0, -1) + extent(el, cx, cy, 0, 1) + 1;
        if (w < min - 0.5 || h < min - 0.5) problems.push(`${label(el)}: vùng chạm ${w}×${h}px (khung nhìn ${Math.round(r.width)}×${Math.round(r.height)}px)`);
      }
      return problems;
    },
    { scope: options.scope ?? null, ignore: options.ignore ?? [], selector: INTERACTIVE, min: MIN_TAP },
  );
}

/**
 * Giữ chuột xuống trên `target` (không nhả trên nó) rồi đọc hệ số co `scale` của CHÍNH `readFrom` (mặc định `target`), sau đó nhả chuột ở chỗ khác.
 * Chỉ đọc đúng một phần tử: lấy cả tổ tiên thì nút nằm trong thẻ bấm được sẽ đọc nhầm hệ số của thẻ (nhấn nút cũng làm thẻ `:active`), và ca "nút mất
 * hiệu ứng co" vẫn qua. Muốn đo thẻ thì nhấn một điều khiển trong thẻ và truyền chính thẻ vào `readFrom`.
 * Chặn `click` ở pha bắt của `window` trước khi nhả để lần thử không kích hoạt hành động thật. Trả hệ số co: 1 = không co.
 */
export async function pressScale(page: Page, target: Locator, readFrom: Locator = target): Promise<number> {
  await target.evaluate((el) => (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' }));
  const box = (await target.boundingBox())!;
  await page.evaluate(() => {
    const block = (e: Event) => {
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    window.addEventListener('click', block, { capture: true, once: true });
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // `:active` phải bật thật thì phép đo mới có nghĩa: ca "không co khi giảm chuyển động" mà `:active` chưa bật sẽ qua nhầm.
  await target.evaluate(
    (el) =>
      new Promise<void>((resolve, reject) => {
        const t0 = performance.now();
        const tick = () => {
          if (el.matches(':active')) resolve();
          else if (performance.now() - t0 > 3000) reject(new Error('nhấn giữ nhưng :active không bật'));
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  const read = () =>
    readFrom.evaluate((el) => {
      const t = getComputedStyle(el).transform;
      if (!t || t === 'none') return 1;
      const m = new DOMMatrixReadOnly(t);
      return Math.round(Math.hypot(m.a, m.b) * 1000) / 1000;
    });
  // Chuyển tiếp 80ms chạy theo khung hình: chờ tới khi hệ số thôi đổi (tối đa ~1,2 giây), thay vì một mốc thời gian cứng.
  let scale = await read();
  for (let i = 0, stable = 0; i < 24 && stable < 3; i++) {
    await page.waitForTimeout(50);
    const next = await read();
    stable = next === scale ? stable + 1 : 0;
    scale = next;
  }
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await page.waitForTimeout(60);
  return scale;
}

/**
 * Chừa vùng an toàn đáy: sau khi ép `--safe-bottom` (Mini App) hoặc đặt độ lệch an toàn bằng CDP (web, Chromium), đo mép dưới của điều khiển thấp nhất trong thanh
 * dính so với đáy khung nhìn. Trả khoảng còn dư sau khi trừ vùng an toàn (âm = nút chui xuống dưới thanh home của iPhone), hoặc null khi trang không có thanh dính.
 */
export async function stickyBarBottomClearance(page: Page, inset: number): Promise<number | null> {
  return page.evaluate((px) => {
    const bar = document.querySelector('[data-testid="sticky-bar"]');
    if (!bar) return null;
    const vh = window.innerHeight;
    let lowest = 0;
    for (const el of Array.from(bar.querySelectorAll('button, a[href], [role="button"], input, [data-bar-item]'))) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      lowest = Math.max(lowest, r.bottom);
    }
    return Math.round((vh - px - lowest) * 10) / 10;
  }, inset);
}

/** Nút bấm của DS co 0,97 khi nhấn, thẻ co 0,985: mọi điều khiển phải rơi vào khoảng 0,97..0,99 (cùng khoảng `tokens.css` ở hai app chặn). */
export const PRESS_MIN = 0.97;
export const PRESS_MAX = 0.99;

/** Nhấn giữ `target` và đòi `readFrom` (mặc định chính nó) co trong 0,97..0,99; `what` là tên điều khiển để báo lỗi đúng chỗ. */
export async function expectPressFeedback(page: Page, target: Locator, what: string, readFrom?: Locator): Promise<void> {
  const scale = await pressScale(page, target, readFrom);
  expect.soft(scale, `${what}: co khi nhấn (đo được ${scale})`).toBeGreaterThanOrEqual(PRESS_MIN);
  expect.soft(scale, `${what}: co khi nhấn (đo được ${scale})`).toBeLessThanOrEqual(PRESS_MAX);
}

/** Khách chọn giảm chuyển động: nhấn giữ không co (hệ số đúng 1). */
export async function expectNoPressMotion(page: Page, target: Locator, what: string, readFrom?: Locator): Promise<void> {
  expect.soft(await pressScale(page, target, readFrom), `${what}: giảm chuyển động thì không co`).toBe(1);
}
