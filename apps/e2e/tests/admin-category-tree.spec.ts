import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AdminCategory, AdminCategoryList, CategoryProductsPage } from '../../web/src/lib/product-categories';
import { test, expect, reply, type MockApi } from './support/mock-api';

/**
 * Admin, tab Sản phẩm: cây danh mục hai tầng (≤8 gốc × ≤8 con), nút ↑↓ có tên mục, thêm/đổi tên/xoá, gán sản phẩm hàng loạt
 * chỉ vào mục lá, và thẻ hộp việc "SP đang bán chưa có danh mục" mở thẳng màn gán. Mọi lệnh gọi /api/ được giả.
 * `P16_SCREENS_DIR=<thư mục>` thì chụp ảnh các trạng thái vào đó.
 */

const SCREENS = process.env.P16_SCREENS_DIR ? resolve(process.env.P16_SCREENS_DIR) : null;

const ADMIN_LOGIN = {
  accessToken: 'mock-admin-access-token',
  refreshToken: 'mock-admin-refresh-token',
  user: { id: 'admin-1', role: 'ADMIN', fullName: 'Test Admin', avatarUrl: null, pointsBalance: 0, walletBalance: 0, referralCode: 'ADMIN1' },
};

const row = (id: string, name: string, parentId: string | null, sortOrder: number, productCount = 0, totalCount = productCount): AdminCategory => ({
  id,
  name,
  slug: id,
  parentId,
  sortOrder,
  productCount,
  totalCount,
});
const LIMITS = { maxRoots: 8, maxChildren: 8 };

const PRODUCTS = {
  items: [
    { id: 'p1', name: 'Nước rửa chén Tubu hương chanh 750ml', thumbnail: null, brand: 'Tubu Tree', pancakeId: 'pk1', isActive: true, categoryIds: [] },
    { id: 'p2', name: 'Xà phòng thiên nhiên', thumbnail: null, brand: 'Tubu Tree', pancakeId: 'pk2', isActive: true, categoryIds: ['chen'] },
    { id: 'p3', name: 'Bàn chải tre', thumbnail: null, brand: 'Tubu Tree', pancakeId: 'pk3', isActive: false, categoryIds: [] },
  ],
  total: 3,
  nextCursor: null,
} satisfies CategoryProductsPage;

function baseTree(): AdminCategoryList {
  return {
    items: [
      row('bep', 'Nhà bếp', null, 0, 1, 6),
      row('chen', 'Chén bát', 'bep', 0, 3),
      row('dao', 'Dao thớt', 'bep', 1, 2),
      row('giat', 'Giặt tẩy', null, 1, 4),
      row('ca-nhan', 'Chăm sóc cá nhân', null, 2, 0),
    ],
    limits: LIMITS,
  };
}

function fullParentTree(): AdminCategoryList {
  const kids = Array.from({ length: 8 }, (_, i) => row(`k${i}`, `Mục con ${i + 1}`, 'bep', i, i));
  return { items: [row('bep', 'Nhà bếp', null, 0, 0, 28), ...kids, row('giat', 'Giặt tẩy', null, 1, 4)], limits: LIMITS };
}

/** Giả `/admin/categories` có trạng thái: sắp xếp, thêm, đổi tên, xoá đổi dữ liệu trả về như máy chủ thật. */
function mockTree(api: MockApi, initial: AdminCategoryList) {
  let list = initial;
  const siblings = (parentId: string | null) => list.items.filter((c) => c.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  api.get('/admin/categories', () => list);
  api.put('/admin/categories/order', ({ call }) => {
    const b = call.body as { parentId: string | null; orderedIds: string[] };
    list = { ...list, items: list.items.map((c) => (b.orderedIds.includes(c.id) ? { ...c, sortOrder: b.orderedIds.indexOf(c.id) } : c)) };
    return list;
  });
  api.post('/admin/categories', ({ call }) => {
    const b = call.body as { name: string; parentId?: string | null };
    const created = row(`n${list.items.length}`, b.name, b.parentId ?? null, siblings(b.parentId ?? null).length);
    list = { ...list, items: [...list.items, created] };
    return created;
  });
  api.patch('/admin/categories/:id', ({ params, call }) => {
    const b = call.body as { name?: string };
    list = { ...list, items: list.items.map((c) => (c.id === params.id ? { ...c, ...(b.name ? { name: b.name } : {}) } : c)) };
    return list.items.find((c) => c.id === params.id);
  });
  api.delete('/admin/categories/:id', ({ params }) => {
    list = { ...list, items: list.items.filter((c) => c.id !== params.id) };
    return { id: params.id };
  });
  return () => list;
}

function mockAdmin(api: MockApi, tree: AdminCategoryList = baseTree(), inboxCount = 3) {
  api.post('/auth/refresh', ADMIN_LOGIN);
  api.get('/cart', { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 });
  api.get('/admin/customer-refunds', { data: [], meta: { page: 1, limit: 1, total: 0 } });
  api.get('/admin/config', []);
  api.get('/admin/ops/inbox', {
    generatedAt: '2026-11-01T03:00:00.000Z',
    items: [
      { key: 'productsUncategorized', count: inboxCount },
      { key: 'productsMissingImage', count: 2 },
    ],
  });
  api.get('/admin/dashboard/today', { orders: { today: 5, yesterday: 3, week: 20 }, revenue: { today: 1500000, yesterday: 2000000, week: 9000000 }, newUsers: { today: 2, yesterday: 2, week: 11 } });
  api.get('/admin/analytics/retention-daily', []);
  api.get('/admin/product-categories/products', PRODUCTS);
  api.get('/admin/pancake/categories', []);
  return mockTree(api, tree);
}

const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (!SCREENS) return;
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: resolve(SCREENS, name), fullPage: true });
};

test.describe('Admin: cây danh mục và gán sản phẩm', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('tubu_web_session', '1'));
  });

  test('↑↓ bằng bàn phím đổi thứ tự, báo vị trí mới và focus vẫn ở nút vừa bấm (375px)', async ({ page, api }) => {
    mockAdmin(api);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin?tab=productCategories');
    await expect(page.getByRole('heading', { name: 'Cây danh mục' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Tầng 1: 3/8 · tối đa 8 mục con mỗi mục')).toBeVisible();
    await shot(page, 'tree-375.png');

    // ↓ trên gốc đầu: dòng chứa nút này bị chuyển chỗ trong DOM, focus bàn phím phải vẫn ở nút đó.
    const down = page.getByRole('button', { name: 'Đưa "Nhà bếp" xuống dưới' });
    await down.focus();
    const put = api.waitForCall('PUT', '/admin/categories/order');
    await page.keyboard.press('Enter');
    expect((await put).body).toEqual({ parentId: null, orderedIds: ['giat', 'bep', 'ca-nhan'] });
    await expect(page.getByRole('status').filter({ hasText: 'Đã đưa "Nhà bếp" xuống vị trí 2/3.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đưa "Nhà bếp" xuống dưới' })).toBeFocused();
    const order = await page.locator('[data-cat-name]').allTextContents();
    expect(order).toEqual(['Giặt tẩy', 'Nhà bếp', 'Chén bát', 'Dao thớt', 'Chăm sóc cá nhân']);
    await shot(page, 'tree-moved-375.png');

    // Ở cuối danh sách nút vẫn focus được nhưng không gọi API.
    const last = page.getByRole('button', { name: 'Đưa "Chăm sóc cá nhân" xuống dưới' });
    await expect(last).toHaveAttribute('aria-disabled', 'true');
    await last.focus();
    await expect(last).toBeFocused();
  });

  test('đủ 8 mục con thì nút thêm của mục đó bị khoá kèm lý do; gốc khác vẫn thêm được (375px)', async ({ page, api }) => {
    mockAdmin(api, fullParentTree());
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin?tab=productCategories');
    await expect(page.getByRole('heading', { name: 'Cây danh mục' })).toBeVisible({ timeout: 20_000 });
    const add = page.getByRole('button', { name: 'Thêm mục con vào "Nhà bếp"' });
    await expect(add).toBeDisabled();
    await expect(page.getByText('Đã đủ 8 mục con.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thêm mục con vào "Giặt tẩy"' })).toBeEnabled();
    await shot(page, 'full-parent-375.png');
  });

  test('máy chủ chặn bằng 400: câu tiếng Việt hiện cạnh ô nhập, ô giữ lại tên đã gõ (375px)', async ({ page, api }) => {
    mockAdmin(api);
    const msg = 'Danh mục "Giặt tẩy" đã đủ 8 mục con. Xoá bớt một mục con trước khi thêm.';
    api.post('/admin/categories', reply(400, { message: msg }));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin?tab=productCategories');
    await expect(page.getByRole('heading', { name: 'Cây danh mục' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Thêm mục con vào "Giặt tẩy"' }).click();
    await page.getByRole('textbox', { name: 'Tên mục con mới của "Giặt tẩy"' }).fill('Nước giặt');
    await page.getByRole('button', { name: 'Thêm', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: msg })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Tên mục con mới của "Giặt tẩy"' })).toHaveValue('Nước giặt');
    await shot(page, 'error-400-375.png');
  });

  test('thêm gốc, đổi tên và xoá có hỏi xác nhận (1280px)', async ({ page, api }) => {
    const tree = mockAdmin(api);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/admin?tab=productCategories');
    await expect(page.getByRole('heading', { name: 'Cây danh mục' })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Thêm danh mục gốc' }).click();
    await page.getByRole('textbox', { name: 'Tên danh mục gốc mới' }).fill('Đồ chơi gỗ');
    const created = api.waitForCall('POST', '/admin/categories');
    await page.getByRole('button', { name: 'Thêm', exact: true }).click();
    expect((await created).body).toEqual({ name: 'Đồ chơi gỗ' });
    await expect(page.locator('[data-cat-name]', { hasText: 'Đồ chơi gỗ' })).toBeVisible();
    await expect(page.getByText('Tầng 1: 4/8')).toBeVisible();

    await page.getByRole('button', { name: 'Đổi tên "Giặt tẩy"' }).click();
    const field = page.getByRole('textbox', { name: 'Tên mới của "Giặt tẩy"' });
    await field.fill('Giặt giũ');
    await field.press('Enter');
    await expect(page.locator('[data-cat-name]', { hasText: 'Giặt giũ' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đổi tên "Giặt giũ"' })).toBeFocused();

    await page.getByRole('button', { name: 'Xoá "Chăm sóc cá nhân"' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: 'Xoá', exact: true }).click();
    await expect(page.locator('[data-cat-name]', { hasText: 'Chăm sóc cá nhân' })).toHaveCount(0);
    expect(tree().items.some((c) => c.id === 'ca-nhan')).toBe(false);
    await shot(page, 'tree-1280.png');
  });

  test('thẻ hộp việc "SP đang bán chưa có danh mục" mở thẳng màn gán: chip bật sẵn, cây thu gọn, mục cha có con không gán được (375px)', async ({ page, api }) => {
    mockAdmin(api);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin');
    const card = page.locator('[data-inbox="productsUncategorized"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Sản phẩm đang bán chưa có danh mục');
    await shot(page, 'inbox-card-375.png');
    const list = api.waitForCall('GET', '/admin/product-categories/products');
    await card.click();
    const call = await list;
    expect(call.query.get('uncategorized')).toBe('1');
    expect(call.query.get('onSale')).toBe('1');
    await expect(page).toHaveURL(/tab=productCategories/);
    await expect(page.getByRole('button', { name: /^Chưa có danh mục \(3\)$/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Mở rộng' })).toHaveAttribute('aria-expanded', 'false');

    await page.getByRole('checkbox', { name: 'Chọn Nước rửa chén Tubu hương chanh 750ml' }).check();
    await page.getByRole('combobox', { name: 'Danh mục', exact: true }).selectOption({ label: 'Nhà bếp (có mục con)' });
    await expect(page.getByRole('button', { name: 'Gán danh mục' })).toBeDisabled();
    await expect(page.getByText('Mục này có mục con. Chọn một mục con để gán.')).toBeVisible();
    await shot(page, 'assign-375.png');
  });
});
