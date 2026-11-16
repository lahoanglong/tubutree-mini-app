import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, reply, type MockApi } from './support/mock-api';

// Khai lại dạng của `GET /admin/catalog/category-suggestions`: file kiểu ở web (catalog-quality-api.ts) kéo alias `@/` mà tsconfig e2e không có.
interface CategorySuggestionRow {
  id: string;
  name: string;
  slug: string;
  brand: string;
  thumbnail: string | null;
  hasImage: boolean;
  onSale: boolean;
  updatedAt: string;
  suggestion: {
    categoryIds: string[];
    confidence: number;
    matches: Array<{ categoryId: string; confidence: number; ruleId: string; rule: string }>;
  };
}
interface CategorySuggestionList {
  categories: Array<{ id: string; name: string }>;
  items: CategorySuggestionRow[];
  autoMin: number;
  summary: {
    total: number;
    onSale: number;
    autoReady: number;
    needsReview: number;
    autoReadyOnSale: number;
    needsReviewOnSale: number;
  };
  truncated: boolean;
}

/**
 * Admin, tab "Kiểm tra catalog", thẻ "Gán danh mục hàng loạt" ở 1440px: mở bảng gợi ý, chọn mọi gợi ý từ 90%, sửa chip một dòng cần xem,
 * bấm "Áp dụng N sản phẩm" và kiểm đúng thân POST; nhánh 409 tải lại bảng. Mọi lệnh gọi /api/ được giả, không đụng DB.
 * `CATEGORY_BULK_SCREENS_DIR=<thư mục>` thì chụp ảnh các trạng thái vào đó.
 */

const SCREENS = process.env.CATEGORY_BULK_SCREENS_DIR
  ? resolve(process.env.CATEGORY_BULK_SCREENS_DIR)
  : null;

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: {
    id: 'admin-1',
    role: 'ADMIN',
    fullName: 'Test Admin',
    avatarUrl: null,
    pointsBalance: 0,
    walletBalance: 0,
    referralCode: 'ADMIN1',
  },
};

const T = '2026-11-16T10:00:00.000Z';
const CATEGORIES = [
  { id: 'cat-skincare', name: 'Mỹ phẩm thiên nhiên' },
  { id: 'cat-cleaning', name: 'Tẩy rửa sinh học' },
  { id: 'cat-baby', name: 'Cho bé' },
  { id: 'cat-personal', name: 'Chăm sóc cá nhân' },
  { id: 'cat-food', name: 'Nông sản & Thực phẩm' },
];

const item = (
  id: string,
  name: string,
  brand: string,
  categoryIds: string[],
  confidence: number,
  rule: string,
  over: Partial<CategorySuggestionRow> = {},
): CategorySuggestionRow => ({
  id,
  name,
  slug: id,
  brand,
  thumbnail: null,
  hasImage: false,
  onSale: true,
  updatedAt: T,
  suggestion: {
    categoryIds,
    confidence,
    matches: categoryIds.map((categoryId) => ({ categoryId, confidence, ruleId: rule, rule })),
  },
  ...over,
});

const ITEMS: CategorySuggestionRow[] = [
  item(
    'p1',
    'Nước rửa chén Fuwa3e hương chanh 500ml',
    'Fuwa3e',
    ['cat-cleaning'],
    0.97,
    'Fuwa3e + từ khoá tẩy rửa',
  ),
  item(
    'p2',
    'Sữa rửa mặt PƠ LANG 100ml',
    'Pơ Lang',
    ['cat-skincare'],
    0.97,
    'Pơ Lang/Visante + từ khoá da',
  ),
  item(
    'p3',
    'Bọt rửa tay cho bé Pineboo 250ml',
    'Pineboo',
    ['cat-baby', 'cat-personal'],
    0.8,
    'Tên có "cho bé"',
  ),
  item(
    'p4',
    'Bánh mầm hạt yến mạch BH.NONG',
    'BH.Nong',
    ['cat-food'],
    0.95,
    'BH.Nong/Sokfarm + từ khoá thực phẩm',
    { onSale: false },
  ),
  item('p5', 'Quà tặng bí ẩn', 'Tubu Tree', [], 0, ''),
];

function listOf(items: CategorySuggestionRow[]): CategorySuggestionList {
  const auto = items.filter(
    (r) => r.suggestion.categoryIds.length > 0 && r.suggestion.confidence >= 0.9,
  );
  const onSale = items.filter((r) => r.onSale);
  return {
    categories: CATEGORIES,
    items,
    autoMin: 0.9,
    summary: {
      total: items.length,
      onSale: onSale.length,
      autoReady: auto.length,
      needsReview: items.length - auto.length,
      autoReadyOnSale: auto.filter((r) => r.onSale).length,
      needsReviewOnSale: onSale.length - auto.filter((r) => r.onSale).length,
    },
    truncated: false,
  };
}

/** Giả máy chủ có trạng thái: áp dụng xong thì sản phẩm đã gán rời danh sách, như `categoryIds isEmpty` ở apps/api. */
function mockCatalog(api: MockApi) {
  let items = ITEMS;
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', {
    items: [],
    couponCode: null,
    subtotal: 0,
    discount: 0,
    freeship: false,
    freeshipThreshold: 0,
    itemCount: 0,
  });
  api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
  api.get('/admin/config', []);
  api.get('/admin/ops/inbox', { generatedAt: T, items: [] });
  api.get('/admin/ops/health', { generatedAt: T, problems: [], cronJobs: [] });
  api.get('/admin/catalog-quality/audit', { products: [], truncated: false });
  api.get('/admin/catalog-quality/pancake-zero-price', {
    scope: 'FULL',
    updatedAt: T,
    count: 0,
    keptCount: 0,
    newCount: 0,
    skus: [],
    truncated: false,
  });
  api.get('/admin/ai-advisor/stats', reply(404, { message: 'Không có' }));
  api.allowUnmocked('GET /me/loyalty/member-card', 'GET /me/notifications');
  api.get('/admin/catalog/category-suggestions', () => listOf(items));
  api.post('/admin/catalog/category-suggestions/apply', ({ call }) => {
    const body = call.body as { items: Array<{ productId: string; categoryIds: string[] }> };
    const done = new Set(body.items.map((i) => i.productId));
    items = items.filter((r) => !done.has(r.id));
    return {
      applied: body.items.length,
      items: body.items.map(({ productId, categoryIds }) => ({ productId, categoryIds })),
    };
  });
}

const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (!SCREENS) return;
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: resolve(SCREENS, name), fullPage: true });
};

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('Admin: gán danh mục hàng loạt theo gợi ý (1440px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('tubu_web_session', '1'));
  });

  test('mở bảng, chọn mọi gợi ý từ 90%, sửa chip dòng cần xem, áp dụng gửi đúng lô và bảng chỉ còn dòng chưa gán', async ({
    page,
    api,
  }) => {
    mockCatalog(api);
    await page.goto('/admin?tab=catalogQuality');
    const card = page.getByRole('region', { name: 'Gán danh mục hàng loạt' });
    await expect(card).toBeVisible();
    // Chưa mở bảng thì không đọc gợi ý.
    expect(api.callsTo('GET', '/admin/catalog/category-suggestions')).toHaveLength(0);
    await shot(page, 'admin-1440-truoc-mo.png');

    await card.getByRole('button', { name: 'Mở bảng gợi ý' }).click();
    await expect(card.getByTestId('category-bulk-summary')).toContainText(
      '5 sản phẩm chưa có danh mục (4 đang bán): 3 gợi ý chắc chắn (từ 90%), 2 cần xem.',
    );
    await expect(card.getByTestId('category-row-p1')).toContainText('Chắc chắn 97%');
    await expect(card.getByTestId('category-row-p4')).toContainText('Đang ẩn');
    await expect(card.getByTestId('category-chosen-p5')).toHaveText('Chưa chọn danh mục');

    const apply = card.getByRole('button', { name: /^Áp dụng \d+ sản phẩm$/ });
    await expect(apply).toHaveText('Áp dụng 0 sản phẩm');
    await expect(apply).toHaveAttribute('aria-disabled', 'true');

    await card.getByRole('button', { name: /Chọn mọi gợi ý từ 90%/ }).click();
    await expect(apply).toHaveText('Áp dụng 3 sản phẩm');
    await expect(
      card.getByRole('checkbox', { name: 'Chọn Bọt rửa tay cho bé Pineboo 250ml' }),
    ).not.toBeChecked();

    // Dòng cần xem: bỏ "Chăm sóc cá nhân", giữ "Cho bé"; sửa chip tự chọn dòng.
    const p3 = card.getByTestId('category-row-p3');
    await p3.getByText('Sửa danh mục').click();
    await p3
      .getByRole('group', { name: /Danh mục của/ })
      .getByRole('button', { name: 'Chăm sóc cá nhân' })
      .click();
    await expect(card.getByTestId('category-chosen-p3')).toHaveText('Cho bé');
    await expect(apply).toHaveText('Áp dụng 4 sản phẩm');
    await shot(page, 'admin-1440-da-chon.png');

    const post = api.waitForCall('POST', '/admin/catalog/category-suggestions/apply');
    await apply.click();
    const sent = (await post).body as {
      items: Array<{ productId: string; categoryIds: string[]; expectedUpdatedAt: string }>;
    };
    expect(sent.items).toEqual([
      { productId: 'p1', categoryIds: ['cat-cleaning'], expectedUpdatedAt: T },
      { productId: 'p2', categoryIds: ['cat-skincare'], expectedUpdatedAt: T },
      { productId: 'p3', categoryIds: ['cat-baby'], expectedUpdatedAt: T },
      { productId: 'p4', categoryIds: ['cat-food'], expectedUpdatedAt: T },
    ]);
    // Thành công báo bằng toast của khung admin (ngoài thẻ).
    await expect(page.getByText('Đã gán danh mục cho 4 sản phẩm').first()).toBeVisible();
    await expect(card.locator('[data-testid^="category-row-"]')).toHaveCount(1);
    await expect(card.getByTestId('category-row-p5')).toBeVisible();
    await expect(apply).toHaveText('Áp dụng 0 sản phẩm');
    await shot(page, 'admin-1440-sau-ap-dung.png');
  });

  test('409 (sản phẩm vừa có danh mục ở nơi khác): báo lời máy chủ, tải lại bảng, không có dòng nào bị ghi', async ({
    page,
    api,
  }) => {
    mockCatalog(api);
    api.post(
      '/admin/catalog/category-suggestions/apply',
      reply(409, {
        statusCode: 409,
        error: 'Conflict',
        code: 'CATEGORY_APPLY_STALE',
        message:
          '1 sản phẩm vừa thay đổi từ lúc bạn mở danh sách (đã có danh mục, vừa được sửa hoặc đã xoá). Chưa ghi sản phẩm nào: tải lại danh sách rồi áp dụng lại.',
        conflicts: [
          {
            productId: 'p1',
            name: 'Nước rửa chén Fuwa3e hương chanh 500ml',
            reason: 'categorized',
          },
        ],
      }),
    );
    await page.goto('/admin?tab=catalogQuality');
    const card = page.getByRole('region', { name: 'Gán danh mục hàng loạt' });
    await card.getByRole('button', { name: 'Mở bảng gợi ý' }).click();
    await card.getByRole('button', { name: /Chọn mọi gợi ý từ 90%/ }).click();
    const reload = api.waitForCall('GET', '/admin/catalog/category-suggestions');
    await card.getByRole('button', { name: 'Áp dụng 3 sản phẩm' }).click();
    await reload;
    // Lỗi đứng ngay trong thẻ, cạnh bảng cần xem lại.
    const alert = card.getByRole('alert');
    await expect(alert).toContainText('Chưa ghi sản phẩm nào');
    await expect(alert).toContainText('Bảng đã tải lại');
    await expect(card.locator('[data-testid^="category-row-"]')).toHaveCount(5);
    await expect(card.getByRole('button', { name: 'Áp dụng 3 sản phẩm' })).toBeVisible();
  });

  test.describe('360px', () => {
    test.use({ viewport: { width: 360, height: 800 } });

    test('thẻ không làm trang tràn ngang; dòng mở sửa danh mục vẫn nằm trong khung và áp dụng được', async ({
      page,
      api,
    }) => {
      mockCatalog(api);
      await page.goto('/admin?tab=catalogQuality');
      const card = page.getByRole('region', { name: 'Gán danh mục hàng loạt' });
      await card.scrollIntoViewIfNeeded();
      await shot(page, 'admin-360-truoc.png');
      await card.getByRole('button', { name: 'Mở bảng gợi ý' }).click();
      await card.getByRole('button', { name: /Chọn mọi gợi ý từ 90%/ }).click();
      const p3 = card.getByTestId('category-row-p3');
      await p3.getByText('Sửa danh mục').click();
      await expect(p3.getByRole('group', { name: /Danh mục của/ })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const box = await p3.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(360);
      await card.scrollIntoViewIfNeeded();
      await shot(page, 'admin-360-sau.png');
      const post = api.waitForCall('POST', '/admin/catalog/category-suggestions/apply');
      await card.getByRole('button', { name: 'Áp dụng 3 sản phẩm' }).click();
      expect(((await post).body as { items: unknown[] }).items).toHaveLength(3);
    });
  });
});
