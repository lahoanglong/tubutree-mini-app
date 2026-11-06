import { expect, test, type APIRequestContext } from '@playwright/test';
import { OVER_QTY, REAL, removeStockWorld, seedStockWorld, type StockWorld } from './support/public-stock-db';

/**
 * W31: API khách không gửi tồn thật trên 20 (Smart Stock). Gọi API thật trên DB tạm của web-gate/CI, không mock:
 * - tồn 1..20 đúng số, 21..99.999 là 99, tồn ảo là 100.000 (dấu "Sẵn sàng giao ngay");
 * - dòng giỏ vượt tồn gửi số lượng − 1 để app vẫn nhận ra dòng vượt mà không biết tồn thật;
 * - trang sản phẩm web dựng phía máy chủ cũng không nhúng tồn thật vào HTML.
 */
const API = `http://localhost:${process.env.E2E_API_PORT}/api`;
const FORBIDDEN = [REAL.mid, REAL.over, REAL.virtual];

function stocksIn(value: unknown, out: number[] = []): number[] {
  if (Array.isArray(value)) value.forEach((v) => stocksIn(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'stock' && typeof v === 'number') out.push(v);
      else stocksIn(v, out);
    }
  }
  return out;
}

async function getJson(request: APIRequestContext, path: string, token?: string): Promise<unknown> {
  const res = await request.get(`${API}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  expect(res.status(), `GET ${path}`).toBe(200);
  return res.json();
}

function expectNoRealStock(body: unknown, where: string): void {
  const stocks = stocksIn(body);
  for (const real of FORBIDDEN) expect(stocks, `${where}: tồn thật ${real}`).not.toContain(real);
}

const byVariation = (rows: { variationId: string; stock: number }[]) => Object.fromEntries(rows.map((r) => [r.variationId, r.stock]));

test.describe('API khách không lộ tồn thật trên 20 (W31)', () => {
  let world: StockWorld | null = null;

  test.beforeAll(async ({}, testInfo) => {
    if (testInfo.project.name !== 'Web Customer') return;
    world = await seedStockWorld();
    if (process.env.GITHUB_ACTIONS === 'true' && !world) throw new Error('Không gieo được dữ liệu W31 vào DB CI: ca tồn công khai không được bỏ qua');
  });

  test.afterAll(async () => {
    if (world) await removeStockWorld(world);
  });

  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'Web Customer', 'gọi API thật, chạy một lần ở project Web Customer');
    test.skip(!world, 'DB không phải DB tạm hoặc thiếu JWT_ACCESS_SECRET');
  });

  test('trang chi tiết sản phẩm: 57 → 99, 25 → 99, 8 giữ số, tồn ảo → 100.000', async ({ request }) => {
    const w = world!;
    const detail = (await getJson(request, `/products/${w.slug}`)) as { variations: { id: string; stock: number }[] };
    expect(Object.fromEntries(detail.variations.map((v) => [v.id, v.stock]))).toEqual({
      [w.ids.mid]: 99, [w.ids.low]: REAL.low, [w.ids.over]: 99, [w.ids.virtual]: 100_000,
    });
    expectNoRealStock(detail, 'GET /products/:slug');
  });

  test('giỏ: dòng vượt tồn (30 trên tồn 25) gửi 29, vẫn là dòng vượt; dòng khác 99 hoặc đúng số khi tồn thấp', async ({ request }) => {
    const w = world!;
    const cart = (await getJson(request, '/cart', w.token)) as { items: { variationId: string; quantity: number; stock: number }[] };
    expect(byVariation(cart.items)).toEqual({ [w.ids.mid]: 99, [w.ids.low]: REAL.low, [w.ids.over]: OVER_QTY - 1, [w.ids.virtual]: 99 });
    const over = cart.items.find((i) => i.variationId === w.ids.over)!;
    expect(over.quantity).toBeGreaterThan(over.stock);
    expectNoRealStock(cart, 'GET /cart');
  });

  test('đơn hàng (Mua lại) và sản phẩm đã mua: 99 thay cho tồn thật, tồn thấp đúng số', async ({ request }) => {
    const w = world!;
    const expected = { [w.ids.mid]: 99, [w.ids.over]: 99, [w.ids.low]: REAL.low };

    const list = (await getJson(request, '/orders', w.token)) as { data: { code: string; items: { variationId: string; stock: number }[] }[] };
    const mine = list.data.find((o) => o.code === w.orderCode);
    expect(mine, 'đơn vừa gieo có trong danh sách').toBeTruthy();
    expect(byVariation(mine!.items)).toEqual(expected);
    expectNoRealStock(list, 'GET /orders');

    const detail = (await getJson(request, `/orders/${w.orderCode}`, w.token)) as { items: { variationId: string; stock: number }[] };
    expect(byVariation(detail.items)).toEqual(expected);
    expectNoRealStock(detail, 'GET /orders/:code');

    const purchased = (await getJson(request, '/me/purchased-items', w.token)) as { items: { variationId: string; stock: number }[] };
    expect(byVariation(purchased.items)).toEqual(expected);
    expectNoRealStock(purchased, 'GET /me/purchased-items');

    expectNoRealStock(await getJson(request, '/home/me', w.token), 'GET /home/me');
  });

  test('HTML trang sản phẩm web (dựng phía máy chủ) không nhúng tồn thật', async ({ request }) => {
    const w = world!;
    const res = await request.get(`/san-pham/${w.slug}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    const embedded = [...html.matchAll(/stock\\?"\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(embedded, 'trang có nhúng tồn phân loại').toContain(99);
    expect(embedded).toContain(REAL.low);
    for (const real of FORBIDDEN) expect(embedded, `HTML: tồn thật ${real}`).not.toContain(real);
  });
});
