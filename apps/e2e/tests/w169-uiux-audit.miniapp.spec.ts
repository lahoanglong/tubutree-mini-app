import { mkdirSync, appendFileSync } from 'fs';
import path from 'path';
import { expect, test, mockSession } from './support/mock-api';
import { tourEntries } from './support/tour';
import { mockTourWorld, seedCatalog, tourUser, TOUR_PRODUCT_SLUG } from './support/tour-world';
import { installVisualMode, settle } from './support/visual';
import { BANK_QR } from './support/checkout-mocks';
import { probe, screenReady } from './support/uiux-probe';

const QR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 24 24"><rect width="24" height="24" fill="#fff"/>${Array.from({ length: 144 }, (_, i) => ((i * 7 + (i >> 3) * 3) % 5 < 2 ? `<rect x="${(i % 12) * 2}" y="${Math.floor(i / 12) * 2}" width="2" height="2"/>` : '')).join('')}</svg>`;
const QR_URI = `data:image/svg+xml;utf8,${encodeURIComponent(QR_SVG)}`;

/**
 * W169: kiểm toán 375x812 và 320x568 cho PDP, Đơn hàng, Chi tiết đơn, Chuyển khoản, Tài khoản, Sổ địa chỉ của Mini App.
 * Mỗi màn: không tràn ngang, nút/link nhìn thấy >= 44px (cả hai chiều, tính cả vùng chạm mở rộng bằng ::after không đo được nên chỉ đếm hộp thật),
 * và chụp ảnh khi có W169_SHOTS (thư mục).
 */
const SHOTS = process.env.W169_SHOTS;

const SCREENS = [
  { key: '/product/:slug', file: 'pdp' },
  { key: '/orders', file: 'orders' },
  { key: '/orders', file: 'orders-empty' },
  { key: '/order/:code', file: 'order-detail' },
  { key: '/bank-payment/:code', file: 'bank' },
  { key: '/profile', file: 'account' },
  { key: '/addresses', file: 'addresses' },
] as const;

const SIZES = [
  { name: '375', width: 375, height: 812 },
  { name: '320', width: 320, height: 568 },
] as const;

for (const size of SIZES) {
  for (const screen of SCREENS) {
    test(`${screen.file} ${size.name}: không tràn ngang, vùng chạm đủ 44px`, async ({ page, api }) => {
      const entry = tourEntries().find((e) => e.key === screen.key)!;
      const user = tourUser(entry.role);
      mockSession(api, user);
      mockTourWorld(api, user);
      entry.setup?.(api);
      api.get('/auth/me', () => ({ id: user.id, ownsBrand: false }));
      if (screen.file === 'orders-empty') api.get('/orders', { data: [], meta: { page: 1, limit: 20, total: 0 } });
      if (screen.file === 'pdp') {
        const x = seedCatalog().find((c) => c.slug === TOUR_PRODUCT_SLUG)!;
        const variation = (n: number, name: string, retail: number, sale: number | null) => ({ id: `var-${x.id}-${n}`, sku: `SKU-${n}`, name, attributes: {}, retailPrice: retail, salePrice: sale, stock: 40 });
        api.get('/products/:slug', {
          id: x.id, slug: x.slug, brand: x.brand, name: x.name, shortDesc: `${x.name} — lành tính, nguồn gốc rõ ràng.`,
          description: '<p>Sản phẩm thiên nhiên được tuyển chọn bởi Tubu Tree.</p>', images: [], thumbnail: null, basePrice: x.basePrice,
          salePrice: x.salePrice, certifications: ['Vegan'], ingredients: null, sold: 12,
          variations: [variation(1, '30ml', x.retailPrice, x.salePrice), variation(2, '50ml', x.retailPrice * 1.5, null)],
        });
      }
      if (screen.file === 'bank') api.get('/payments/bank-qr/:code', { ...BANK_QR, amount: 578_000, qrImageUrl: QR_URI });
      await page.addInitScript(() => window.localStorage.setItem('tubu_garden_hint_seen', '1'));
      await installVisualMode(page);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(entry.miniapp);
      await expect
        .poll(() => api.callsTo('POST', '/auth/guest').length + api.callsTo('POST', '/auth/zalo-mini-app').length + api.callsTo('POST', '/auth/refresh').length, { timeout: 8000 })
        .toBeGreaterThan(0)
        .catch(() => {});
      await expect(screenReady(page, screen.file), `màn ${screen.file} chưa dựng xong`).toBeVisible({ timeout: 20_000 });
      await settle(page);
      await page.waitForTimeout(600);

      const p = await probe(page);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `tubu-w169-${screen.file}-${size.name}.png`), scale: 'css' });
        await page.screenshot({ path: path.join(SHOTS, `tubu-w169-${screen.file}-${size.name}-full.png`), scale: 'css', fullPage: true });
        for (let i = 1; i <= 3; i += 1) {
          const moved = await page.evaluate((step) => {
            const el = (document.querySelector('.zaui-page') as HTMLElement | null) ?? document.scrollingElement!;
            const before = el.scrollTop;
            el.scrollTop = before + step;
            return el.scrollTop > before;
          }, size.height - 150);
          if (!moved) break;
          await page.waitForTimeout(250);
          await page.screenshot({ path: path.join(SHOTS, `tubu-w169-${screen.file}-${size.name}-s${i}.png`), scale: 'css' });
        }
        appendFileSync(path.join(SHOTS, 'probe.jsonl'), `${JSON.stringify({ screen: screen.file, size: size.name, ...p })}\n`);
      }
      expect(p.overflowX, `tràn ngang ${JSON.stringify(p.rightOverflow)}`).toBeLessThanOrEqual(0);
      expect(p.small, `vùng chạm nhỏ ${JSON.stringify(p.small)}`).toEqual([]);
      expect(p.primaryGreen, 'tối đa một nút xanh đặc rộng trên một màn').toBeLessThanOrEqual(1);
    });
  }
}
