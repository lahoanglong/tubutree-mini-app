import { mkdirSync } from 'fs';
import path from 'path';
import { test as dbTest, type Page } from '@playwright/test';
import { expect, test, type MockApi, type MockCall } from './support/mock-api';
import { seedDatabaseUrl } from './support/a11y-db';
import { seedTourPublicData } from './support/tour-db';
import { productCard, seedCatalog } from './support/tour-world';
import { writableTempDb } from './support/waste-db';

/**
 * W4-06 Xếp kệ trên web.
 * - Admin `/admin?tab=merchShelves` (mock mọi /api/): đổi chỗ bằng bàn phím, thêm gợi ý, Lưu gửi đúng thứ tự; 1440 và 768px không tràn ngang.
 * - Khách `/ban-chay` qua DB tạm của web-gate (bản dựng máy chủ đọc API thật): bật cờ, ghim 3 món ở kệ best_sellers, ngưỡng số bán cao
 *   thì trang hiện "Tubu chọn cho bạn" đúng thứ tự ghim, không số hạng, không dòng thước đo ở 360/390/768/1440px.
 * Chỉ chạy ở project "Web Customer" (khổ máy tính, tự đặt kích thước). Có MERCH_SHOTS_DIR thì chụp ảnh vào thư mục đó.
 */
const SHOTS_DIR = process.env.MERCH_SHOTS_DIR;
const ONLY_PROJECT = 'Web Customer';

async function shoot(page: Page, name: string, fullPage = false) {
  if (!SHOTS_DIR) return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS_DIR, name), fullPage });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'ADMIN1' },
};

const CARDS = seedCatalog().slice(0, 5).map(productCard);
const card = (i: number) => CARDS[i]!;
const productView = (i: number) => ({ productId: card(i).id, name: card(i).name, brand: card(i).brand, slug: card(i).slug, thumbnail: card(i).thumbnail, warnings: [] as string[], card: card(i) });
const shelfView = (ids: string[], version: string) => ({
  key: 'home_featured',
  label: 'Trang chủ: Gợi ý hôm nay',
  version,
  maxPins: 12,
  status: { enabled: false, curated: true },
  pins: ids.map((id, position) => {
    const i = CARDS.findIndex((c) => c.id === id);
    const outOfStock = i === 2;
    return { ...productView(i), warnings: outOfStock ? ['OUT_OF_STOCK'] : [], position, startsAt: null, endsAt: null, note: null, live: !outOfStock };
  }),
});

function mockAdminMerch(api: MockApi) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
  api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
  api.get('/admin/config', []);
  api.get('/flash-sales/active', []);
  // Thanh bên admin và đầu trang gọi hộp việc, thẻ thành viên: ngoài phạm vi tab này, 404 không đổi gì trên màn Xếp kệ.
  api.allowUnmocked('GET /config/public', 'GET /admin/ops/inbox', 'GET /me/loyalty/member-card');
  api.get('/admin/merch-shelves', {
    status: { enabled: false, curated: true },
    shelves: [
      { key: 'home_featured', label: 'Trang chủ: Gợi ý hôm nay', kind: 'home', pinCount: 3 },
      { key: 'best_sellers', label: 'Bán chạy nhất', kind: 'best_sellers', pinCount: 0 },
      { key: 'category:cho-be', label: 'Danh mục: Cho bé', kind: 'category', pinCount: 0 },
    ],
  });
  api.get('/admin/merch-shelves/shelf', shelfView([card(0).id, card(1).id, card(2).id], 'v1'));
  api.get('/admin/merch-shelves/suggest', { items: [productView(3), productView(4)] });
  api.get('/admin/merch-shelves/empty-entrances', {
    checkedAt: '2026-11-18T03:00:00.000Z',
    entrances: [
      { key: 'flash', label: 'Giờ vàng', detail: 'Không có suất nào đang chạy', adminTab: 'flashSales' },
      { key: 'category:me-bau', label: 'Danh mục: Cho mẹ bầu', detail: 'Chưa có món nào đang bán', adminTab: 'productCategories' },
    ],
  });
  api.put('/admin/merch-shelves/shelf', ({ call }: { call: MockCall }) => {
    const body = call.body as { pins: { productId: string }[] };
    return shelfView(body.pins.map((p) => p.productId), 'v2');
  });
}

const pinIds = (page: Page) => page.getByTestId('merch-pin').evaluateAll((els) => els.map((e) => e.getAttribute('data-product-id')));

test.describe('Admin — Xếp kệ (mock API)', () => {
  test.beforeEach(async ({ page, api }, info) => {
    test.skip(info.project.name !== ONLY_PROJECT, 'chạy một lần ở project máy tính');
    mockAdminMerch(api);
    await page.addInitScript(() => {
      window.localStorage.setItem('tubu_web_session', '1');
    });
  });

  test('1440px: đổi chỗ bằng bàn phím, thêm gợi ý không tự lưu, Lưu kệ gửi đúng thứ tự; không tràn ngang', async ({ page, api }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin?tab=merchShelves');
    await expect(page.getByRole('heading', { level: 2, name: 'Xếp kệ' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('merch-pin')).toHaveCount(3, { timeout: 15_000 });
    await expect(page.getByText('Hết hàng: tự rơi khỏi kệ tới khi có hàng')).toBeVisible();
    await expect(page.getByTestId('merch-preview-phone').locator('a')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Mở tab' }).first()).toHaveAttribute('href', '/admin?tab=flashSales');

    const third = page.getByTestId('merch-pin').nth(2).locator('button[draggable]');
    await third.focus();
    await page.keyboard.press('ArrowUp');
    expect(await pinIds(page)).toEqual([card(0).id, card(2).id, card(1).id]);
    await expect(page.locator(':focus')).toHaveAttribute('aria-label', /vị trí 2 trên 3/);

    await page.getByRole('button', { name: 'Gợi ý 8 món sẵn sàng' }).click();
    await expect(page.getByTestId('merch-suggestion')).toHaveCount(2);
    await page.getByRole('button', { name: 'Thêm tất cả' }).click();
    await expect(page.getByTestId('merch-pin')).toHaveCount(5);
    expect(api.callsTo('PUT', '/admin/merch-shelves/shelf')).toHaveLength(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, 'admin-merch-shelves-1440-draft.png', true);

    await page.getByRole('button', { name: 'Lưu kệ' }).click();
    await expect(page.getByText('Đã lưu kệ. Cờ Xếp kệ đang tắt nên khách chưa thấy thay đổi.')).toBeVisible();
    const puts = api.callsTo('PUT', '/admin/merch-shelves/shelf');
    expect(puts).toHaveLength(1);
    const body = puts[0]!.body as { key: string; version: string; pins: { productId: string }[] };
    expect(body.key).toBe('home_featured');
    expect(body.version).toBe('v1');
    expect(body.pins.map((p) => p.productId)).toEqual([card(0).id, card(2).id, card(1).id, card(3).id, card(4).id]);
    await shoot(page, 'admin-merch-shelves-1440.png');
  });

  test('768px: danh sách, xem trước và lối vào trống không làm trang tràn ngang', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/admin?tab=merchShelves');
    await expect(page.getByTestId('merch-pin')).toHaveCount(3, { timeout: 15_000 });
    await expect(page.getByTestId('merch-preview-desktop')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lối vào đang trống' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, 'admin-merch-shelves-768.png', true);
  });
});

/** Ghi vào DB tạm của web-gate (writableTempDb), không bao giờ vào DB dùng chung. Trả null khi DB không phải DB tạm. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withTempDb<T>(fn: (prisma: any) => Promise<T>): Promise<T | null> {
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setConfig = (prisma: any, key: string, value: unknown) => prisma.systemConfig.upsert({ where: { key }, create: { key, value, category: 'merch' }, update: { value } });

dbTest.describe('Web khách — /ban-chay khi kệ Bán chạy chọn tay (DB tạm)', () => {
  dbTest.describe.configure({ mode: 'serial' });
  let pinned: { id: string; name: string }[] = [];

  dbTest.beforeAll(async ({}, info) => {
    if (info.project.name !== ONLY_PROJECT) return;
    await seedTourPublicData();
    pinned =
      (await withTempDb(async (prisma) => {
        const rows: { id: string; name: string }[] = await prisma.product.findMany({
          // Dữ liệu seed không có ảnh (images: []): phía đọc kệ không đòi ảnh, chỉ Lưu ở admin mới chặn món chưa có ảnh.
          where: { isActive: true, approvalStatus: 'APPROVED', variations: { some: { isActive: true, stock: { gt: 0 } } } },
          orderBy: { id: 'asc' },
          take: 3,
          select: { id: true, name: true },
        });
        const order = [...rows].reverse();
        await prisma.merchShelfPin.deleteMany({ where: { shelfKey: 'best_sellers' } });
        await prisma.merchShelfPin.createMany({ data: order.map((p, position) => ({ shelfKey: 'best_sellers', productId: p.id, position, createdById: 'e2e-merch' })) });
        await setConfig(prisma, 'merch.shelves_enabled', true);
        // Ngưỡng tối đa: DB tạm không có đủ 1000 món có số bán nên bảng Bán chạy luôn là kệ chọn tay.
        await setConfig(prisma, 'merch.best_seller_min_products', 1000);
        return order;
      })) ?? [];
  });

  dbTest.afterAll(async ({}, info) => {
    if (info.project.name !== ONLY_PROJECT) return;
    await withTempDb(async (prisma) => {
      await prisma.merchShelfPin.deleteMany({ where: { shelfKey: 'best_sellers' } });
      await setConfig(prisma, 'merch.shelves_enabled', false);
      await setConfig(prisma, 'merch.best_seller_min_products', 6);
    });
  });

  dbTest('360/390/768/1440px: "Tubu chọn cho bạn", đúng thứ tự ghim, không số hạng, không dòng thước đo, không tràn ngang', async ({ page, request }, info) => {
    dbTest.skip(info.project.name !== ONLY_PROJECT, 'chạy một lần ở project máy tính');
    dbTest.skip(pinned.length < 3, 'DB không phải DB tạm của web-gate hoặc thiếu món đang bán: không ghi');
    dbTest.setTimeout(240_000);
    const apiBase = `http://localhost:${process.env.E2E_API_PORT}/api`;
    // API nhớ ghim và ngưỡng 60 giây: chờ tới khi API đặt đúng các món ghim (có dấu) lên đầu, sau là xếp hạng thường (không dấu), rồi mới mở trang.
    let organicName = '';
    await expect
      .poll(
        async () => {
          const res = await request.get(`${apiBase}/products?sort=best_seller_30d&limit=20&page=1`);
          if (!res.ok()) return `HTTP ${res.status()}`;
          const body = (await res.json()) as { data: { id: string; name: string; curated?: boolean }[] };
          const lead = body.data.slice(0, pinned.length);
          const rest = body.data.slice(pinned.length);
          organicName = rest[0]?.name ?? '';
          return `${lead.map((c) => `${c.id}:${String(c.curated)}`).join(',')}|${rest.some((c) => c.curated !== undefined)}|${rest.length > 0}`;
        },
        { timeout: 120_000, intervals: [2_000, 5_000] },
      )
      .toBe(`${pinned.map((p) => `${p.id}:true`).join(',')}|false|true`);

    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width >= 768 ? 900 : 800 });
      await page.goto('/ban-chay');
      await expect(page.getByRole('heading', { level: 1, name: 'Tubu chọn cho bạn' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Theo lượt bán 30 ngày qua')).toHaveCount(0);
      await expect(page.locator('main [data-ds-part="rank"]')).toHaveCount(0);
      const text = await page.locator('main').innerText();
      const at = pinned.map((p) => text.indexOf(p.name));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      // Bảng thường sau món ghim không hiện ở trang này, không phân trang.
      expect(text.includes(organicName)).toBe(false);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await shoot(page, `web-ban-chay-curated-${width}.png`);
    }
  });
});
