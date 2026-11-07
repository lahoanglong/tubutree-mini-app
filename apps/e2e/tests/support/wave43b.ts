import { expect, type Locator, type Page } from '@playwright/test';

/** Hai khổ của gói W43B: điện thoại và máy tính. Spec tự đặt khổ nên chạy được ở project nào cũng đủ cả hai. */
export const W43B_SIZES = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;

/** Thay clipboard của trình duyệt bằng bản ghi lại chữ được chép vào `window.__copied`. */
export async function stubClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t: string) => {
          (window as unknown as { __copied?: string }).__copied = t;
          return Promise.resolve();
        },
      },
    });
  });
}

export const copiedText = (page: Page): Promise<string | undefined> => page.evaluate(() => (window as unknown as { __copied?: string }).__copied);

/** Nút bấm được phải rộng và cao ít nhất 44px (đo thật sau khi cuộn tới). */
export async function expectTapTarget(target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box, 'không đo được vùng chạm').not.toBeNull();
  expect(box!.width, 'vùng chạm hẹp hơn 44px').toBeGreaterThanOrEqual(43.5);
  expect(box!.height, 'vùng chạm thấp hơn 44px').toBeGreaterThanOrEqual(43.5);
}

/** Trang (và vùng cuộn của Mini App) không rộng hơn khung nhìn. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => {
    const scrollers = [document.documentElement, ...document.querySelectorAll<HTMLElement>('.zaui-page')];
    return scrollers.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
  });
  expect(over, 'có vùng cuộn ngang').toEqual([]);
}

const STEP_LABELS = ['Đã tiếp nhận', 'Đang chuẩn bị', 'Đang giao hàng', 'Hoàn tất'];

/** Đơn đang giao: bốn bước đúng chữ và đúng trạng thái, một bước hiện tại, giờ số đều, nút Sao chép đủ 44px, không cuộn ngang. */
export async function expectOrderTimeline(page: Page): Promise<Locator> {
  const tracker = page.getByTestId('order-timeline-tracker');
  await expect(tracker).toBeVisible();
  await expect(tracker.getByRole('list', { name: 'Tiến trình đơn hàng' })).toBeVisible();
  const steps = tracker.locator('li[data-step]');
  await expect(steps).toHaveCount(4);
  for (let i = 0; i < STEP_LABELS.length; i += 1) await expect(steps.nth(i)).toContainText(STEP_LABELS[i]!);
  expect(await steps.evaluateAll((els) => els.map((e) => e.getAttribute('data-state')))).toEqual(['completed', 'completed', 'current', 'upcoming']);
  await expect(tracker.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(tracker.locator('[aria-current="step"]')).toContainText('Đang giao hàng');
  const stamp = steps.first().locator('span', { hasText: /\d{2}:\d{2}/ }).first();
  await expect(stamp).toBeVisible();
  expect(await stamp.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
  await expectTapTarget(tracker.getByRole('button', { name: 'Sao chép thông tin đơn' }));
  await expectNoHorizontalScroll(page);
  return tracker;
}

/** Chép thông tin đơn: chữ trong clipboard có mã đơn, tên món, tổng tiền; nhãn nút thành "Đã sao chép" rồi tự trả về sau 2 giây. */
export async function expectOrderCopy(page: Page, tracker: Locator, code: string): Promise<void> {
  const button = tracker.getByRole('button', { name: 'Sao chép thông tin đơn' });
  await button.click();
  await expect(tracker.getByRole('button', { name: 'Đã sao chép' })).toBeVisible();
  const text = (await copiedText(page)) ?? '';
  expect(text).toContain(`Đơn hàng Tubu Tree ${code}`);
  expect(text).toContain('Nước Rửa Chén Sinh Học Tubu 500ml');
  expect(text).toContain('× 2');
  expect(text).toContain('Tổng tiền: 299.000đ');
  expect(text).not.toContain('!');
  await expect(tracker.getByRole('button', { name: 'Sao chép thông tin đơn' })).toBeVisible({ timeout: 4_000 });
}

/** Mã CTV của phiên giả ở hai spec khối hoa hồng nổi bật. */
export const FEATURED_REF = 'TUBU88';

/** API `/storefront/me/products`: hai sản phẩm có hoa hồng và một sản phẩm không có (không được hiện trong khối). */
export const FEATURED_PICKER = [
  { id: 'p-a', name: 'Nước rửa chén hương chanh sả', slug: 'nuoc-rua-chen', thumbnail: null, basePrice: 120_000, salePrice: 99_000, maxAffiliateRate: 12 },
  { id: 'p-b', name: 'Dầu gội bồ kết', slug: 'dau-goi', thumbnail: null, basePrice: 150_000, salePrice: null, maxAffiliateRate: 20 },
  { id: 'p-c', name: 'Túi lưới tái sử dụng', slug: 'tui-luoi', thumbnail: null, basePrice: 40_000, salePrice: null, maxAffiliateRate: 0 },
];

/** Khối hoa hồng nổi bật: hai dòng xếp theo tiền hoa hồng (30.000đ rồi 11.880đ), dòng không có hoa hồng bị bỏ, mọi nút Chép link ≥ 44px, không cuộn ngang. */
export async function expectFeaturedBlock(page: Page): Promise<Locator> {
  const block = page.getByTestId('ctv-featured');
  await expect(block).toBeVisible({ timeout: 20_000 });
  await expect(block.getByRole('heading', { name: 'Sản phẩm hoa hồng nổi bật', level: 2 })).toBeVisible();
  const rows = block.getByTestId('ctv-featured-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Dầu gội bồ kết');
  await expect(rows.nth(0)).toContainText('Hoa hồng tới 20%');
  await expect(rows.nth(0)).toContainText('Dự kiến tới 30.000đ mỗi đơn');
  await expect(rows.nth(1)).toContainText('Nước rửa chén hương chanh sả');
  await expect(rows.nth(1)).toContainText('Hoa hồng tới 12%');
  await expect(rows.nth(1)).toContainText('Dự kiến tới 11.880đ mỗi đơn');
  await expect(block).not.toContainText('Túi lưới');
  for (let i = 0; i < 2; i += 1) await expectTapTarget(rows.nth(i).getByRole('button'));
  await expectNoHorizontalScroll(page);
  return block;
}

/** Chép link: lời giới thiệu có tên món và link `?ref=<mã CTV>`, không có "!"; nhãn "Đã chép link" rồi tự trả về. */
export async function expectFeaturedCopy(page: Page, block: Locator): Promise<void> {
  const row = block.getByTestId('ctv-featured-row').nth(0);
  await row.getByRole('button', { name: 'Chép link giới thiệu Dầu gội bồ kết', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Đã chép link giới thiệu Dầu gội bồ kết', exact: true })).toBeVisible();
  await expect(row.getByRole('button')).toContainText('Đã chép link');
  const text = (await copiedText(page)) ?? '';
  expect(text).toContain('Dầu gội bồ kết');
  expect(text).toMatch(new RegExp(`/(san-pham|product)/dau-goi\\?ref=${FEATURED_REF}\\b`));
  expect(text).not.toContain('!');
  await expect(row.getByRole('button', { name: 'Chép link giới thiệu Dầu gội bồ kết', exact: true })).toBeVisible({ timeout: 4_000 });
  await expect(block.getByTestId('ctv-featured-row').nth(1).getByRole('button', { name: 'Chép link giới thiệu Nước rửa chén hương chanh sả', exact: true })).toBeVisible();
}

/** Tên hoạt hoạ của chấm bước hiện tại: nhấp nhô khi cho phép chuyển động, "none" khi người dùng giảm chuyển động. */
export const glowAnimation = (page: Page): Promise<string> =>
  page.locator('.order-timeline__step[data-state="current"] .order-timeline__dot').first().evaluate((el) => getComputedStyle(el).animationName);
