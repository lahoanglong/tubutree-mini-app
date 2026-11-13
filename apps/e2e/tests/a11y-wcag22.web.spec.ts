import { expect, test } from './support/mock-api';
import { mockCollectable } from './support/voucher-mocks';
import { BUYER_PUBLIC_CONFIG, mockBuyer, measureFocusRing, seedSession } from './support/a11y-buyer';

/**
 * Gói U (WCAG 2.2 AA) trên web khách: những điều chỉ trình duyệt thật đo được (jsdom không dàn trang, không có :focus-visible).
 * A11Y-01 vòng focus trên nền tối ≥ 3:1; A11Y-04 thanh dính không che phần tử đang focus (2.4.11); A11Y-09 thẻ địa chỉ có vòng focus;
 * A11Y-10 liên kết bỏ qua + nút Quay lại đứng trước nội dung. Chỉ chạy ở project "Web Customer Mobile" (tự đặt khổ từng ca).
 */
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Web Customer Mobile', 'tự đặt khổ từng ca, chỉ cần chạy một lần');
  await seedSession(page);
});

test.describe('A11Y-01: vòng focus đạt 3:1 trên nền tối', () => {
  test('nút Thử lại của hero Tài khoản', async ({ page, api }) => {
    mockBuyer(api, { loyaltyFails: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/tai-khoan');
    const retry = page.locator('[data-surface="inverse"]').getByRole('button', { name: 'Thử lại' });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    const ring = await measureFocusRing(retry);
    expect(ring.style).toBe('solid');
    expect(ring.width).toBeGreaterThanOrEqual(2);
    expect(ring.ratio, `viền ${ring.ring} trên ${ring.background}`).toBeGreaterThanOrEqual(3);
  });

  test('khối Điểm Xanh của Ưu đãi', async ({ page, api }) => {
    mockBuyer(api);
    mockCollectable(api);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/uu-dai');
    const strip = page.locator('[data-surface="inverse"] button').first();
    await expect(strip).toBeVisible({ timeout: 20_000 });
    const ring = await measureFocusRing(strip);
    expect(ring.ratio, `viền ${ring.ring} trên ${ring.background}`).toBeGreaterThanOrEqual(3);
  });

  test('nút Hoàn tác của thanh báo trong giỏ (xoá bằng bàn phím thì focus tự sang Hoàn tác)', async ({ page, api }) => {
    mockBuyer(api, { lines: 3 });
    api.delete('/cart/items/:id', () => ({ items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 500_000, itemCount: 0 }));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/gio-hang');
    const trash = page.getByRole('button', { name: 'Xoá Sản phẩm số 1 khỏi giỏ hàng' });
    await expect(trash).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Tab');
    await trash.focus();
    await page.keyboard.press('Enter');
    const undo = page.getByRole('button', { name: 'Hoàn tác' });
    await expect(undo).toBeFocused();
    const ring = await measureFocusRing(undo, { alreadyFocused: true });
    expect(ring.ratio, `viền ${ring.ring} trên ${ring.background}`).toBeGreaterThanOrEqual(3);
  });

  test('toàn bộ nền tối đều có vòng trắng (luật chung data-surface="inverse")', async ({ page, api }) => {
    mockBuyer(api, { loyaltyFails: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/tai-khoan');
    await expect(page.locator('[data-surface="inverse"]').first()).toBeVisible({ timeout: 20_000 });
    const color = await page.evaluate(() => {
      const probe = document.createElement('a');
      probe.href = '#';
      probe.textContent = 'x';
      document.querySelector('[data-surface="inverse"]')!.appendChild(probe);
      probe.focus();
      return getComputedStyle(probe).outlineColor;
    });
    expect(color).toBe('rgb(255, 255, 255)');
  });
});

test.describe('A11Y-04: thanh dính không che phần tử đang focus', () => {
  for (const width of [375, 800]) {
    test(`/gio-hang 8 dòng ở ${width}px: Tab qua từng phần tử, tâm phần tử không bị thanh/đầu trang đè`, async ({ page, api }) => {
      mockBuyer(api, { lines: 8 });
      await page.setViewportSize({ width, height: 720 });
      await page.goto('/gio-hang');
      await expect(page.getByTestId('cart-line')).toHaveCount(8, { timeout: 20_000 });
      await expect(page.getByTestId('sticky-bar')).toBeVisible();
      const covered: string[] = [];
      let steps = 0;
      const seen = new Set<string>();
      for (; steps < 90; steps++) {
        await page.keyboard.press('Tab');
        // Hàng điều hướng của thanh đầu cuộn ngang (từ md, 9 mục dài hơn khung 800px): phần tử vừa lấy nét có thể đang được cuộn vào tầm nhìn, nên đợi vị trí đứng yên (3 khung hình liền) rồi mới đo.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              const el = document.activeElement as HTMLElement | null;
              if (!el) return resolve();
              const started = performance.now();
              let last = '';
              let same = 0;
              const tick = () => {
                const b = el.getBoundingClientRect();
                const key = `${b.left}|${b.top}`;
                same = key === last ? same + 1 : 0;
                last = key;
                if (same >= 3 || performance.now() - started > 1500) resolve();
                else requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            }),
        );
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) return { id: 'ẩn', skip: true, name: '' };
          const x = b.left + b.width / 2;
          const y = b.top + b.height / 2;
          const top = document.elementFromPoint(x, y);
          const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40);
          const by = top ? `${top.tagName.toLowerCase()}.${String(top.className).slice(0, 50)}` : 'ngoài màn';
          return { id: `${el.tagName}:${name}:${Math.round(b.top)}`, skip: false, name, ok: !!top && (el === top || el.contains(top) || top.contains(el)), y, vh: window.innerHeight, by, x: Math.round(x) };
        });
        if (!r) break;
        if (r.skip) continue;
        if (seen.has(r.id)) break;
        seen.add(r.id);
        if (!r.ok) covered.push(`${r.name} (x=${r.x}, y=${Math.round(r.y!)}) bị ${r.by} đè`);
      }
      expect(seen.size, 'đã Tab qua đủ phần tử của giỏ').toBeGreaterThan(20);
      expect(covered).toEqual([]);
    });
  }

  test('800px: mục "Đổi rác" chèn vào hàng điều hướng sau khi focus đã ở "Cộng đồng" thì "Cộng đồng" vẫn nằm trọn trong khung', async ({ page, api }) => {
    mockBuyer(api, { lines: 2 });
    let release!: () => void;
    const configGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.get('/config/public', async () => {
      await configGate;
      return BUYER_PUBLIC_CONFIG;
    });
    await page.setViewportSize({ width: 800, height: 720 });
    await page.goto('/gio-hang');
    const navItems = page.locator('[data-desktop-nav] li');
    await expect(navItems).toHaveCount(8, { timeout: 20_000 });
    const community = page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Cộng đồng' });
    for (let i = 0; i < 20 && !(await community.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(community).toBeFocused();
    release();
    await expect(navItems).toHaveCount(9);
    await expect
      .poll(() =>
        community.evaluate((el) => {
          const b = el.getBoundingClientRect();
          const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          return b.left >= 0 && b.right <= window.innerWidth && !!top && (el === top || el.contains(top));
        }),
      )
      .toBe(true);
  });
});

test.describe('A11Y-09: thanh toán', () => {
  test('thẻ địa chỉ (radio sr-only ở điện thoại) có vòng focus khi tới bằng bàn phím; nhóm phương thức thanh toán là radiogroup có tên', async ({ page, api }) => {
    mockBuyer(api);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/thanh-toan');
    await expect(page.getByRole('radiogroup', { name: 'Phương thức thanh toán' })).toBeVisible({ timeout: 20_000 });
    let outline: { style: string; width: number } | null = null;
    for (let i = 0; i < 40 && !outline; i++) {
      await page.keyboard.press('Tab');
      outline = await page.evaluate(() => {
        const el = document.activeElement as HTMLInputElement | null;
        if (el?.name !== 'addr') return null;
        const s = getComputedStyle(el.closest('label')!);
        return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
      });
    }
    expect(outline, 'Tab tới được radio địa chỉ').not.toBeNull();
    expect(outline!.style).toBe('solid');
    expect(outline!.width).toBeGreaterThanOrEqual(2);
  });
});

test.describe('A11Y-10: liên kết bỏ qua và nút Quay lại', () => {
  test('375px, trang con: Tab 1 là "Bỏ qua đến nội dung", Tab 2 là Quay lại; nút đứng trước nội dung chính trong DOM', async ({ page, api }) => {
    mockBuyer(api);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/gio-hang');
    await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Bỏ qua đến nội dung' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Quay lại' })).toBeFocused();
    const order = await page.evaluate(() => {
      const main = document.getElementById('main-content');
      const back = document.querySelector('button[aria-label="Quay lại"]');
      return { backBeforeMain: !!back && !!main && !!(back.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING) };
    });
    expect(order.backBeforeMain).toBe(true);
  });

  test('1280px: Tab đầu tiên rơi vào liên kết bỏ qua (hiện ra khi focus); Enter chuyển focus vào nội dung chính', async ({ page, api }) => {
    mockBuyer(api);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/gio-hang');
    await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 20_000 });
    const skip = page.getByRole('link', { name: 'Bỏ qua đến nội dung' });
    const hidden = await skip.boundingBox();
    expect(hidden!.width).toBeLessThanOrEqual(1);
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    const shown = await skip.boundingBox();
    expect(shown!.width).toBeGreaterThan(40);
    expect(shown!.y).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('main-content');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#main-content'))).toBe(true);
  });

  test('bấm chuột vào chữ giữa trang rồi Tab: focus đi tiếp từ chỗ đã bấm, không nhảy về đầu vùng nội dung', async ({ page, api }) => {
    mockBuyer(api);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/gio-hang');
    await expect(page.getByTestId('cart-line').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('region', { name: 'Sản phẩm trong giỏ' }).click({ position: { x: 3, y: 3 } });
    expect(await page.evaluate(() => document.getElementById('main-content')?.hasAttribute('tabindex'))).toBe(false);
    await page.keyboard.press('Tab');
    const after = await page.evaluate(() => {
      const region = document.querySelector('section[aria-label="Sản phẩm trong giỏ"]')!;
      const active = document.activeElement!;
      return { inMain: !!active.closest('#main-content'), followsLine: region === active || !!(region.compareDocumentPosition(active) & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)) };
    });
    expect(after.inMain).toBe(true);
    expect(after.followsLine).toBe(true);
  });
});
