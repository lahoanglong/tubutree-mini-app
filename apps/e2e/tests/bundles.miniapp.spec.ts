import type { Page } from '@playwright/test';
import { test, expect, reply } from './support/mock-api';
import { NRC, mockDiscovery } from './support/discovery-mocks';
import { COMBO_TITLE, HOME_COMBO_TITLES, PDP_SLUG, homeCombos, mockHomeCombos, mockPdpBundles, pdpAddon, pdpCombo } from './support/bundle-mocks';
import { EMPTY_CART } from './support/shop-page-mocks';

/**
 * Zalo Mini App E2E — Combo ưu đãi, Mua kèm deal sốc (trang sản phẩm) và Combo tiết kiệm (Trang chủ), gói P15, 375px.
 * API mock toàn bộ. Giá cuối luôn do giỏ tính: spec này kiểm khối hiện đúng, gửi đúng lệnh thêm giỏ và không làm trang xê dịch.
 */
test.use({ viewport: { width: 375, height: 812 } });

const VAR_NRC = `var-${NRC.id}`;
const addons = (page: Page) => page.getByTestId('pdp-addons');
const combos = (page: Page) => page.getByTestId('pdp-combos');

test.describe('Trang sản phẩm: Combo ưu đãi và Mua kèm', () => {
  test.beforeEach(({ api }) => mockDiscovery(api));

  test('có 1 combo và 2 món mua kèm: hiện cả hai mục, điều kiện "chỉ khi mua cùng", giá kèm và nhãn % giảm', async ({ page, api }) => {
    mockPdpBundles(api, { combos: [pdpCombo()], addons: [pdpAddon()] });
    await page.goto(`/product/${PDP_SLUG}`);
    await expect(combos(page).getByRole('heading', { level: 2, name: 'Combo ưu đãi' })).toBeVisible({ timeout: 15_000 });
    await expect(combos(page).getByText(COMBO_TITLE)).toBeVisible();
    await expect(addons(page).getByRole('heading', { level: 2, name: 'Mua kèm deal sốc' })).toBeVisible();
    await expect(addons(page).getByText(`Chỉ khi mua cùng ${NRC.name}`)).toBeVisible();
    await expect(addons(page).getByRole('checkbox')).toHaveCount(2);
    await expect(addons(page).getByText('-25%')).toBeVisible();
    await expect(addons(page).getByText('-30%')).toBeVisible();
    await expect(addons(page).getByRole('button', { name: 'Chọn món muốn mua kèm' })).toBeDisabled();
  });

  test('"Thêm cả combo": đúng một lệnh POST /cart/items/batch, mỗi món một đơn vị, báo đã thêm', async ({ page, api }) => {
    mockPdpBundles(api, { combos: [pdpCombo()], addons: [] });
    api.post('/cart/items/batch', { ...EMPTY_CART, itemCount: 2 });
    await page.goto(`/product/${PDP_SLUG}`);
    await combos(page).getByRole('button', { name: new RegExp(`^Thêm cả combo ${COMBO_TITLE}`) }).click();
    await expect(page.getByText('Đã thêm cả combo vào giỏ').first()).toBeVisible();
    const calls = api.callsTo('POST', '/cart/items/batch');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ items: [{ variationId: VAR_NRC, quantity: 1 }, { variationId: 'var-p-xp', quantity: 1 }] });
  });

  test('"Thêm cả combo" bị từ chối (hết hàng): đọc lời của máy chủ, không báo đã thêm', async ({ page, api }) => {
    mockPdpBundles(api, { combos: [pdpCombo()], addons: [] });
    api.post('/cart/items/batch', reply(400, { code: 'CART_BATCH_REJECTED', message: 'Sản phẩm Xà Phòng Thảo Mộc đã hết hàng.' }));
    await page.goto(`/product/${PDP_SLUG}`);
    await combos(page).getByRole('button', { name: new RegExp(`^Thêm cả combo ${COMBO_TITLE}`) }).click();
    await expect(page.getByText('Sản phẩm Xà Phòng Thảo Mộc đã hết hàng.').first()).toBeVisible();
    await expect(page.getByText('Đã thêm cả combo vào giỏ')).toHaveCount(0);
  });

  test('chọn món mua kèm đổi nhãn nút và dòng "Tiết kiệm"; bấm thêm chỉ gửi món đã chọn rồi bỏ chọn', async ({ page, api }) => {
    mockPdpBundles(api, { combos: [], addons: [pdpAddon()] });
    api.post('/cart/items/batch', { ...EMPTY_CART, itemCount: 1 });
    await page.goto(`/product/${PDP_SLUG}`);
    const rows = addons(page).getByRole('checkbox');
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(addons(page).getByTestId('addon-save')).toHaveText('Tiết kiệm 45.000đ');
    await addons(page).getByRole('button', { name: 'Thêm 1 món vào giỏ' }).click();
    await expect(addons(page).getByRole('button', { name: 'Đã thêm vào giỏ' })).toBeVisible();
    await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'false');
    const calls = api.callsTo('POST', '/cart/items/batch');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ items: [{ variationId: 'var-p-bs', quantity: 1 }] });
    expect((calls[0]!.body as { items: unknown[] }).items).toHaveLength(1);
  });

  test('không có bộ nào hoặc bộ đã hết hạn: không có khối, không giữ chỗ', async ({ page, api }) => {
    await page.goto(`/product/${PDP_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: NRC.name })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => api.callsTo('GET', '/products/:slug/bundles').length).toBe(1);
    await expect(page.getByTestId('pdp-bundle-slots')).toHaveCount(0);
    mockPdpBundles(api, { combos: [pdpCombo({ endAt: new Date(Date.now() - 1_000).toISOString() })], addons: [pdpAddon({ endAt: new Date(Date.now() - 1_000).toISOString() })] });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: NRC.name })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => api.callsTo('GET', '/products/:slug/bundles').length).toBe(2);
    await expect(page.getByTestId('pdp-bundle-slots')).toHaveCount(0);
  });

  test('API bộ lỗi: trang vẫn đủ nội dung chính, khối ẩn, không báo lỗi', async ({ page, api }) => {
    api.get('/products/:slug/bundles', reply(500, { message: 'Lỗi máy chủ' }));
    await page.goto(`/product/${PDP_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: NRC.name })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => api.callsTo('GET', '/products/:slug/bundles').length).toBeGreaterThan(0);
    await expect(page.getByTestId('pdp-bundle-slots')).toHaveCount(0);
    await expect(page.getByText('Combo ưu đãi')).toHaveCount(0);
  });
});

test.describe('Trang chủ: Combo tiết kiệm', () => {
  test.beforeEach(({ api }) => mockDiscovery(api));

  test('có 2 combo: kệ "Combo tiết kiệm" đứng sau Bán chạy nhất, mỗi thẻ một combo; thêm cả combo gửi đúng lệnh', async ({ page, api }) => {
    mockHomeCombos(api, homeCombos());
    api.post('/cart/items/batch', { ...EMPTY_CART, itemCount: 2 });
    await page.goto('/');
    const rail = page.getByRole('region', { name: 'Combo tiết kiệm', exact: true });
    await expect(rail).toBeVisible({ timeout: 15_000 });
    for (const t of HOME_COMBO_TITLES) await expect(rail.getByText(t)).toBeVisible();
    const best = (await page.getByRole('region', { name: 'Bán chạy nhất', exact: true }).boundingBox())!;
    const combo = (await rail.boundingBox())!;
    expect(combo.y).toBeGreaterThan(best.y + best.height - 1);
    await rail.getByRole('button', { name: new RegExp(`^Thêm cả combo ${HOME_COMBO_TITLES[0]}`) }).click();
    await expect(page.getByText('Đã thêm cả combo vào giỏ').first()).toBeVisible();
    const calls = api.callsTo('POST', '/cart/items/batch');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ items: [{ variationId: VAR_NRC, quantity: 1 }, { variationId: 'var-p-xp', quantity: 1 }] });
  });

  test('chỉ 1 combo (dưới mức tối thiểu của kệ): không hiện kệ, Bán chạy nhất vẫn có', async ({ page, api }) => {
    mockHomeCombos(api, homeCombos().slice(0, 1));
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Bán chạy nhất', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => api.callsTo('GET', '/bundles/combos').length).toBe(1);
    await expect(page.getByRole('region', { name: 'Combo tiết kiệm', exact: true })).toHaveCount(0);
  });
});
