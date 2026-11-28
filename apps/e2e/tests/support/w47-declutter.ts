import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Số đo nghiệm thu gói gọn Trang chủ, Duyệt và Chi tiết đơn (W47) dùng chung cho Mini App và web khổ điện thoại. Mỗi hàm trả danh sách lỗi (rỗng = đúng).
 */

/** Cả trang lẫn khung cuộn của Mini App (`.zaui-page`) không cuộn ngang. */
export async function overflowProblems(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [document.documentElement, ...document.querySelectorAll<HTMLElement>('.zaui-page')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.className || el.tagName} cuộn ngang ${el.scrollWidth} > ${el.clientWidth}`),
  );
}

/** Lưới "Gợi ý cho bạn" (khối cuối Trang chủ) xếp 2 cột ở khổ điện thoại; thẻ chen (nếu có) trải hết bề ngang. */
export async function suggestGridProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('[data-testid="home-suggest"] [data-testid="catalog-grid"]');
    if (!grid) return ['không có lưới Gợi ý cho bạn'];
    const tiles = Array.from(grid.children).filter((el) => el.getAttribute('data-testid') !== 'suggest-interleave');
    if (tiles.length < 2) return [`lưới Gợi ý chỉ có ${tiles.length} thẻ`];
    const lefts = new Set(tiles.slice(0, 6).map((el) => Math.round(el.getBoundingClientRect().left)));
    return lefts.size === 2 ? [] : [`lưới Gợi ý ${lefts.size} cột (cần 2)`];
  });
}

/** Sắp xếp và Lọc nằm chung MỘT thanh cao 44px (±1), dính khi cuộn (Mini dính ở chính thanh, web ở khung bọc để cha cao bằng cả danh sách). */
export async function sortBarProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const group = document.querySelector<HTMLElement>('[role="group"][aria-label="Sắp xếp"]');
    const bar = group?.parentElement;
    if (!group || !bar) return ['không có thanh Sắp xếp'];
    const problems: string[] = [];
    const h = bar.getBoundingClientRect().height;
    if (Math.abs(h - 44) > 1) problems.push(`thanh Sắp xếp cao ${Math.round(h)}px (cần 44px)`);
    let sticky = false;
    for (let el: HTMLElement | null = bar, i = 0; el && i < 3 && !sticky; el = el.parentElement, i++) sticky = getComputedStyle(el).position === 'sticky';
    if (!sticky) problems.push('thanh Sắp xếp không dính');
    const filter = Array.from(bar.querySelectorAll('button')).find((b) => !group.contains(b));
    if (!filter) problems.push('nút Lọc không nằm cùng thanh Sắp xếp');
    return problems;
  });
}

/**
 * Chi tiết đơn: hero tối đa 3 phần; ngay dưới là MỘT thẻ Vận chuyển gồm hành trình, viên chép mã vận đơn và địa chỉ; sản phẩm nằm dưới thẻ đó.
 * `firstItem` là tên món đầu của đơn.
 */
export async function orderDetailProblems(page: Page, firstItem: string): Promise<string[]> {
  return page.evaluate((firstItem) => {
    const hero = document.querySelector<HTMLElement>('[data-testid="status-hero"]');
    const ship = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="order-shipping"]')).find((el) => el.getBoundingClientRect().height > 0);
    if (!hero || !ship) return [`thiếu ${hero ? 'thẻ Vận chuyển' : 'hero'}`];
    const problems: string[] = [];
    if (hero.children.length > 3) problems.push(`hero có ${hero.children.length} phần (tối đa 3)`);
    if (!ship.querySelector('[data-testid="order-tracking-pill"]')) problems.push('viên mã vận đơn không nằm trong thẻ Vận chuyển');
    if (!ship.querySelector('[data-testid="order-shipping-address"], [data-testid="order-address"]')) problems.push('địa chỉ không nằm trong thẻ Vận chuyển');
    if (!ship.querySelector('[aria-label="Hành trình đơn hàng"]')) problems.push('hành trình không nằm trong thẻ Vận chuyển');
    const heroBox = hero.getBoundingClientRect();
    const shipBox = ship.getBoundingClientRect();
    if (heroBox.bottom > shipBox.top + 1) problems.push('thẻ Vận chuyển không nằm dưới hero');
    let item: DOMRect | undefined;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (!item && walker.nextNode()) {
      const box = walker.currentNode.parentElement?.getBoundingClientRect();
      if (walker.currentNode.textContent?.includes(firstItem) && box && box.height > 0) item = box;
    }
    if (!item) problems.push(`không thấy món "${firstItem}"`);
    else if (item.top < shipBox.bottom - 1) problems.push('sản phẩm đứng trên thẻ Vận chuyển');
    return problems;
  }, firstItem);
}

/**
 * Có W47_SHOT_DIR thì chụp khung nhìn vào `<W47_SHOT_DIR>/<app>-<khổ>-<màn>.png`. Không dùng VISUAL_DIR: biến đó bật chế độ chụp (tắt chuyển động,
 * kéo visual-tour) cho MỌI spec cùng lượt nên spec đo chuyển động hay khổ màn đỏ giả.
 */
export async function shootW47(page: Page, app: 'miniapp' | 'web', width: number, key: string): Promise<void> {
  const out = process.env.W47_SHOT_DIR;
  if (!out) return;
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, `${app}-${width}-${key}.png`), animations: 'disabled', caret: 'hide' });
}
