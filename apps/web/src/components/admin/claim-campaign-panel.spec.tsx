// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import type { CouponBatchSummary } from '@/lib/admin-client';

const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('@/lib/export-csv', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadCsvFile: mocks.download,
}));

import { ClaimCampaignPanel, claimLink, offerLabel } from './claim-campaign-panel';
import { generateClaimCodesCsv } from '@/lib/export-csv';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});
beforeEach(() => mocks.download.mockClear());

const BASE = 'https://zalo.me/s/123456';
const batch = (over: Partial<CouponBatchSummary> = {}): CouponBatchSummary => ({
  batch: 'SHOPEE11',
  total: 500,
  claimed: 37,
  used: 12,
  active: 500,
  type: 'AMOUNT',
  value: 30000,
  minOrder: 99000,
  maxDiscount: null,
  newCustomerOnly: true,
  mine: true,
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2026-12-31T16:59:59.000Z',
  link: { page: 'scan', src: 'shopee', card: '2611' },
  ...over,
});
const configRoute = (value: string) => ({ body: { claimUrlBase: value.replace(/\/+$/, '') || null } });
const input = (r: Rendered, label: string) => r.container.querySelector(`[aria-label="${label}"]`);
const bodyOf = (call: { init?: RequestInit } | undefined) => JSON.parse(String(call?.init?.body ?? '{}')) as Record<string, unknown>;

function mount(routes: Parameters<typeof mockFetch>[0]) {
  const api = mockFetch(routes);
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(<ClaimCampaignPanel />);
  mounted.push(r);
  return { r, api };
}

describe('ClaimCampaignPanel — đợt thẻ hộp hàng sàn (D2-03)', () => {
  it('chưa đặt link Mini App: cảnh báo trước khi in thẻ', async () => {
    const { r } = mount({ '/admin/coupon-batches/claim-url-base': configRoute(''), '/admin/coupon-batches': { body: [] } });
    await flush();
    expect(r.container.textContent).toContain('Chưa đặt link Mini App');
    expect(r.container.textContent).toContain('Chưa có lô nào.');
  });

  it('tạo lô: gửi đúng cấu hình (tiền tố HOA, chỉ khách mới mặc định bật) rồi tải CSV mã + link', async () => {
    const created = {
      batch: 'SHOPEE11',
      created: 2,
      claimUrlBase: BASE,
      codes: [
        { code: 'SHOPEE11-AAAA2222', url: `${BASE}/?claim=SHOPEE11-AAAA2222`, claimed: false, used: false, isActive: true },
        { code: 'SHOPEE11-BBBB3333', url: `${BASE}/?claim=SHOPEE11-BBBB3333`, claimed: false, used: false, isActive: true },
      ],
    };
    const { r, api } = mount({
      '/admin/coupon-batches/claim-url-base': configRoute(BASE),
      '/admin/coupon-batches': (init) => (init?.method === 'POST' ? { body: created } : { body: [] }),
    });
    await flush();
    expect(r.container.textContent).not.toContain('Chưa đặt link Mini App');
    const submit = byText(r.container, 'button', 'Tạo lô và tải CSV') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    typeInto(input(r, 'Tiền tố lô'), 'shopee 11');
    typeInto(input(r, 'Số thẻ'), '2');
    typeInto(input(r, 'Mức giảm'), '30000');
    typeInto(input(r, 'Đơn tối thiểu'), '99000');
    expect(submit.disabled).toBe(false);
    click(submit);
    await flush();
    const post = api.calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toContain('/admin/coupon-batches');
    expect(bodyOf(post)).toMatchObject({ prefix: 'SHOPEE11', quantity: 2, type: 'AMOUNT', value: 30000, minOrder: 99000, newCustomerOnly: true });
    expect(mocks.download).toHaveBeenCalledWith(
      ['code,url', `SHOPEE11-AAAA2222,${BASE}/?claim=SHOPEE11-AAAA2222`, `SHOPEE11-BBBB3333,${BASE}/?claim=SHOPEE11-BBBB3333`].join('\r\n'),
      'the-hop-hang-SHOPEE11.csv',
    );
    expect(r.container.textContent).toContain('Đã tạo 2 mã lô SHOPEE11');
  });

  // U5-B05: luật đã chốt thẻ hộp hàng sàn có hạn 60 ngày; thẻ còn nằm trong kho trước khi tới tay khách nên 30 ngày dễ hết sớm.
  it('U5-B05: để trống "Hết hạn ngày" thì hạn thẻ là 60 ngày kể từ hôm nay, và gợi ý ghi 60 ngày', async () => {
    const { r, api } = mount({
      '/admin/coupon-batches/claim-url-base': configRoute(BASE),
      '/admin/coupon-batches': (init) => (init?.method === 'POST' ? { body: { batch: 'HOA', created: 1, claimUrlBase: BASE, codes: [] } } : { body: [] }),
    });
    await flush();
    expect(r.container.textContent).toContain('Bỏ trống = 60 ngày');
    typeInto(input(r, 'Tiền tố lô'), 'hoa');
    typeInto(input(r, 'Số thẻ'), '1');
    typeInto(input(r, 'Mức giảm'), '30000');
    const before = Date.now();
    click(byText(r.container, 'button', 'Tạo lô và tải CSV'));
    await flush();
    const days = (Date.parse(String(bodyOf(api.calls.find((c) => c.init?.method === 'POST')).endAt)) - before) / 864e5;
    expect(days).toBeGreaterThan(59.99);
    expect(days).toBeLessThan(60.01);
  });

  it('lô đã tạo: hiện số thẻ đã nhận/đã dùng; tải lại CSV; tắt lô phải xác nhận', async () => {
    const { r, api } = mount({
      '/admin/coupon-batches/claim-url-base': configRoute(BASE),
      '/admin/coupon-batches/SHOPEE11/codes': { body: { batch: 'SHOPEE11', claimUrlBase: BASE, codes: [{ code: 'SHOPEE11-AAAA2222', url: `${BASE}/?claim=SHOPEE11-AAAA2222`, claimed: true, used: false, isActive: true }] } },
      '/admin/coupon-batches/SHOPEE11': { body: { batch: 'SHOPEE11', updated: 500 } },
      '/admin/coupon-batches': { body: [batch()] },
    });
    await flush();
    const row = r.container.querySelector('[data-testid="claim-batch-SHOPEE11"]')!;
    expect(row.textContent).toContain('500 thẻ · Đã nhận 37 · Đã dùng 12');
    expect(row.textContent).toContain('Giảm 30.000');
    expect(row.textContent).toContain('Chỉ khách mới');

    click(byText(row, 'button', 'Tải lại CSV'));
    await flush();
    expect(mocks.download).toHaveBeenCalledWith(`code,url\r\nSHOPEE11-AAAA2222,${BASE}/?claim=SHOPEE11-AAAA2222`, 'the-hop-hang-SHOPEE11.csv');

    click(byText(row, 'button', 'Tắt lô'));
    await flush();
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(true);
    await flush();
    const patch = api.calls.find((c) => c.init?.method === 'PATCH');
    expect(patch?.url).toContain('/admin/coupon-batches/SHOPEE11');
    expect(bodyOf(patch)).toEqual({ isActive: false });
  });

  it('lô do người khác tạo (mine=false): không tải được CSV, có gợi ý tiếng Việt, không gọi API mã', async () => {
    const { r, api } = mount({
      '/admin/coupon-batches/claim-url-base': configRoute(BASE),
      '/admin/coupon-batches': { body: [batch({ mine: false })] },
    });
    await flush();
    const row = r.container.querySelector('[data-testid="claim-batch-SHOPEE11"]')!;
    expect(row.textContent).toContain('Lô do người khác tạo');
    const btn = byText(row, 'button', 'Tải lại CSV') as HTMLButtonElement | null;
    if (btn) {
      expect(btn.disabled).toBe(true);
      click(btn);
      await flush();
    }
    expect(api.calls.some((c) => c.url.includes('/codes'))).toBe(false);
  });

  it('bật lại lô đã tắt: cảnh báo mã tắt riêng cũng bật lại, phải xác nhận', async () => {
    const { r, api } = mount({
      '/admin/coupon-batches/claim-url-base': configRoute(BASE),
      '/admin/coupon-batches/SHOPEE11': { body: { batch: 'SHOPEE11', updated: 500 } },
      '/admin/coupon-batches': { body: [batch({ active: 0 })] },
    });
    await flush();
    const row = r.container.querySelector('[data-testid="claim-batch-SHOPEE11"]')!;
    expect(row.textContent).toContain('Đã tắt');
    click(byText(row, 'button', 'Bật lại lô'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('kể cả mã đã tắt riêng');
    answerConfirm(false);
    await flush();
    expect(api.calls.some((c) => c.init?.method === 'PATCH')).toBe(false);
    click(byText(row, 'button', 'Bật lại lô'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(bodyOf(api.calls.find((c) => c.init?.method === 'PATCH'))).toEqual({ isActive: true });
  });

  it('mã chung: tạo mã CLAIM, mỗi khách 1 lượt, tổng lượt nhận theo ô nhập; báo link in QR', async () => {
    const { r, api } = mount({
      '/admin/coupon-batches/claim-url-base': configRoute(`${BASE}/`),
      '/admin/coupon-batches': { body: [] },
      '/admin/coupons': { body: { id: 'c1' } },
    });
    await flush();
    click(byText(r.container, 'button', 'Một mã chung cho cả đợt'));
    typeInto(input(r, 'Mã chung'), 'shopee thang11');
    typeInto(input(r, 'Tổng lượt nhận'), '300');
    typeInto(input(r, 'Mức giảm'), '20000');
    click(byText(r.container, 'button', 'Tạo mã chung'));
    await flush();
    const post = api.calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toContain('/admin/coupons');
    expect(bodyOf(post)).toMatchObject({ code: 'SHOPEETHANG11', scope: 'CLAIM', usageLimit: 300, perUserLimit: 1, newCustomerOnly: true, value: 20000 });
    expect(r.container.textContent).toContain(`Link in QR: ${BASE}/points/scan?claim=SHOPEETHANG11`);
  });

  it('mã chung: chưa nhập Tổng lượt nhận hoặc < 1 thì không tạo được (mã lộ ra ngoài không có trần)', async () => {
    const { r, api } = mount({
      '/admin/coupon-batches/claim-url-base': configRoute(BASE),
      '/admin/coupon-batches': { body: [] },
      '/admin/coupons': { body: { id: 'c1' } },
    });
    await flush();
    click(byText(r.container, 'button', 'Một mã chung cho cả đợt'));
    typeInto(input(r, 'Mã chung'), 'SHOPEE11');
    typeInto(input(r, 'Mức giảm'), '20000');
    const submit = () => byText(r.container, 'button', 'Tạo mã chung') as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    for (const bad of ['0', '-5', '1.5']) {
      typeInto(input(r, 'Tổng lượt nhận'), bad);
      expect(submit().disabled).toBe(true);
    }
    expect(r.container.textContent).not.toContain('không giới hạn');
    typeInto(input(r, 'Tổng lượt nhận'), '1');
    expect(submit().disabled).toBe(false);
    click(submit());
    await flush();
    expect(bodyOf(api.calls.find((c) => c.init?.method === 'POST'))).toMatchObject({ scope: 'CLAIM', usageLimit: 1 });
  });

  it('link trong CSV: chọn trang đích, nguồn, đợt thẻ; gửi khi tạo lô, xem trước link mẫu; tải lại không gửi tham số (API dùng link đã lưu)', async () => {
    const created = { batch: 'HOA', created: 1, claimUrlBase: BASE, link: null, codes: [] };
    const { r, api } = mount({
      '/admin/coupon-batches/claim-url-base': configRoute(BASE),
      '/admin/coupon-batches/SHOPEE11/codes': { body: { batch: 'SHOPEE11', claimUrlBase: BASE, link: batch().link, codes: [] } },
      '/admin/coupon-batches': (init) => (init?.method === 'POST' ? { body: created } : { body: [batch()] }),
    });
    await flush();
    const sel = (label: string) => input(r, label) as HTMLSelectElement;
    expect(sel('Trang mở khi quét').value).toBe('scan');
    selectValue(sel('Trang mở khi quét'), 'home');
    selectValue(sel('Nguồn trên link'), 'shopee');
    typeInto(input(r, 'Đợt thẻ trên link'), '2611');
    typeInto(input(r, 'Tiền tố lô'), 'hoa');
    typeInto(input(r, 'Số thẻ'), '1');
    typeInto(input(r, 'Mức giảm'), '30000');
    expect(r.container.querySelector('[data-testid="link-preview"]')!.textContent).toContain(`${BASE}/?src=shopee&card=2611&claim=HOA-XXXXXXXX`);
    click(byText(r.container, 'button', 'Tạo lô và tải CSV'));
    await flush();
    const post = api.calls.find((c) => c.init?.method === 'POST');
    expect(bodyOf(post).link).toEqual({ page: 'home', src: 'shopee', card: '2611' });
    click(byText(r.container.querySelector('[data-testid="claim-batch-SHOPEE11"]')!, 'button', 'Tải lại CSV'));
    await flush();
    expect(api.calls.some((c) => c.url.endsWith('/SHOPEE11/codes'))).toBe(true);
    expect(r.container.querySelector('[data-testid="claim-batch-SHOPEE11"] [data-testid="batch-link"]')!.textContent).toBe('Link: Tích điểm đơn sàn · nguồn shopee · đợt 2611');
  });

  it('lô cũ chưa lưu link: ghi chú trong danh sách và khi tải lại CSV', async () => {
    const { r } = mount({
      '/admin/coupon-batches/claim-url-base': configRoute(BASE),
      '/admin/coupon-batches/SHOPEE11/codes': { body: { batch: 'SHOPEE11', claimUrlBase: BASE, link: null, codes: [] } },
      '/admin/coupon-batches': { body: [batch({ link: null })] },
    });
    await flush();
    expect(r.container.querySelector('[data-testid="batch-link"]')!.textContent).toContain('Lô cũ');
    click(byText(r.container.querySelector('[data-testid="claim-batch-SHOPEE11"]')!, 'button', 'Tải lại CSV'));
    await flush();
    expect(r.container.textContent).toContain('tạo trước khi lưu link');
  });

  it('đợt thẻ sai khuôn: báo và chặn nút tạo', async () => {
    const { r } = mount({ '/admin/coupon-batches/claim-url-base': configRoute(BASE), '/admin/coupon-batches': { body: [] } });
    await flush();
    typeInto(input(r, 'Tiền tố lô'), 'hoa');
    typeInto(input(r, 'Số thẻ'), '1');
    typeInto(input(r, 'Mức giảm'), '30000');
    typeInto(input(r, 'Đợt thẻ trên link'), '26 11');
    expect((byText(r.container, 'button', 'Tạo lô và tải CSV') as HTMLButtonElement).disabled).toBe(true);
    expect(r.container.textContent).toContain('Chỉ chữ thường không dấu');
  });

  it('danh sách lô nằm trước form tạo (không phải cuộn qua form mới thấy mã đang chạy)', async () => {
    const { r } = mount({ '/admin/coupon-batches/claim-url-base': configRoute(BASE), '/admin/coupon-batches': { body: [batch()] } });
    await flush();
    const list = r.container.querySelector('[data-testid="claim-batch-SHOPEE11"]')!;
    const form = input(r, 'Tiền tố lô')!;
    expect(list.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('nhãn ưu đãi và link nhận dùng chung cho danh sách lô', () => {
    expect(claimLink('https://zalo.me/s/1', 'A-B', { page: 'scan', src: 'shopee', card: '2611' })).toBe('https://zalo.me/s/1/points/scan?src=shopee&card=2611&claim=A-B');
    expect(offerLabel({ type: 'PERCENT', value: 10, maxDiscount: 50000, minOrder: null })).toBe('Giảm 10%, tối đa 50.000đ');
    expect(offerLabel({ type: 'FREESHIP', value: 0, minOrder: 150000 })).toBe('Miễn phí ship · đơn từ 150.000đ');
    expect(claimLink('https://zalo.me/s/1//', 'A-B')).toBe('https://zalo.me/s/1/?claim=A-B');
    expect(generateClaimCodesCsv([{ code: '=EVIL', url: 'u' }])).toBe("code,url\r\n'=EVIL,u");
  });
});
