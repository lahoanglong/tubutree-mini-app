// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CommissionRatesTab } from './commission-rates-tab';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import type { CommissionRatesPage, RateImportPreview } from '@/lib/commission-rates';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const PAGE: CommissionRatesPage = {
  items: [
    {
      id: 'p1',
      name: 'Nước rửa chén',
      thumbnail: null,
      brand: 'Tubu Tree',
      isActive: true,
      affiliateBlocked: false,
      approvalStatus: 'APPROVED',
      isPartner: false,
      variations: [
        { id: 'v1', sku: 'NRC-500', name: '500ml', retailPrice: 100_000, salePrice: null, isActive: true, affiliateRate: null, dealerPrices: { t_gold: 80_000 } },
        { id: 'v2', sku: 'NRC-1L', name: '1L', retailPrice: 180_000, salePrice: 160_000, isActive: true, affiliateRate: 7.5, dealerPrices: null },
      ],
    },
    {
      id: 'p2',
      name: 'Xà phòng đối tác',
      thumbnail: null,
      brand: 'B',
      isActive: true,
      affiliateBlocked: true,
      approvalStatus: 'APPROVED',
      isPartner: true,
      variations: [{ id: 'v3', sku: 'XP-1', name: 'Mặc định', retailPrice: 50_000, salePrice: null, isActive: true, affiliateRate: null, dealerPrices: null }],
    },
  ],
  nextCursor: null,
  maxRate: 50,
  summary: { missing: 2, missingTubu: 1 },
};

const PREVIEW: RateImportPreview = {
  rows: [
    { line: 1, sku: 'NRC-500', input: '10', status: 'OK', rate: 10, currentRate: null, productName: 'Nước rửa chén', variationName: '500ml', message: null },
    { line: 2, sku: 'ZZZ', input: '5', status: 'NOT_FOUND', rate: 5, currentRate: null, productName: null, variationName: null, message: 'không có biến thể nào mang SKU này' },
  ],
  counts: { OK: 1, UNCHANGED: 0, NOT_FOUND: 1, INVALID: 0, OVER_CAP: 0, DUPLICATE: 0 },
  blocking: 0,
  maxRate: 50,
  canApply: true,
};

type Routes = Parameters<typeof mockFetch>[0];
function stub(extra: Routes = {}, page: CommissionRatesPage = PAGE) {
  const m = mockFetch({
    '/admin/dealer-tiers': { body: [{ id: 't_gold', name: 'Vàng', minOrderVolume: 0, creditLimit: 0, paymentTerms: null }] },
    ...extra,
    '/admin/commission-rates?': { body: page },
  });
  vi.stubGlobal('fetch', vi.fn(m.fn));
  return m;
}
const bodyOf = (m: ReturnType<typeof mockFetch>, part: string) => {
  const c = m.calls.find((x) => x.url.includes(part));
  return c ? JSON.parse(String(c.init?.body)) : undefined;
};

describe('CommissionRatesTab (Hoa hồng & giá sỉ, D1-01)', () => {
  it('trạng thái tải → danh sách: tóm tắt thiếu %, biến thể chưa có %, giá sỉ theo tên bậc, nhãn đối tác/chặn CTV', async () => {
    const m = stub();
    const { container } = mount(<CommissionRatesTab />);
    expect(container.textContent).toContain('Đang tải…');
    await flush();
    const t = container.textContent ?? '';
    expect(t).toContain('2 biến thể đang bán chưa có % (CTV nhận 0đ)');
    expect(t).toContain('10 nghĩa là 10%');
    expect(container.querySelectorAll('[data-commission-product]')).toHaveLength(2);
    const rows = container.querySelectorAll<HTMLElement>('[data-commission-variation]');
    expect(rows[0]!.textContent).toContain('Chưa có %');
    expect(rows[0]!.textContent).toContain('Giá sỉ: Vàng 80.000');
    expect(rows[1]!.textContent).toContain('7,5%');
    expect(t).toContain('Gian hàng đối tác');
    expect(t).toContain('Chặn CTV — luôn 0đ');
    // Mặc định lọc "chỉ chưa có %".
    expect(m.calls.some((c) => c.url.includes('/admin/commission-rates?') && c.url.includes('missing=1'))).toBe(true);
  });

  it('rỗng → câu rõ ràng; lỗi → thông báo + Thử lại', async () => {
    stub({}, { ...PAGE, items: [], summary: { missing: 0, missingTubu: 0 } });
    const { container } = mount(<CommissionRatesTab />);
    await flush();
    expect(container.textContent).toContain('Không còn sản phẩm nào thiếu % hoa hồng.');
    expect(container.textContent).toContain('Mọi biến thể đang bán đã có %');
    mounted.forEach((x) => x.unmount());
    mounted = [];

    vi.stubGlobal('fetch', vi.fn(mockFetch({ '/admin/commission-rates?': { status: 500, body: { message: 'Lỗi máy chủ' } }, '/admin/dealer-tiers': { body: [] } }).fn));
    const r = mount(<CommissionRatesTab />);
    await flush();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Thử lại');
  });

  it('sửa tại chỗ: gõ 7,5 → PUT rate 7.5; vượt trần → báo lỗi, không gọi API', async () => {
    const m = stub({ '/admin/commission-rates/variations/v1': { body: { id: 'v1', sku: 'NRC-500', affiliateRate: 7.5 } } });
    const { container } = mount(<CommissionRatesTab />);
    await flush();
    const input = container.querySelector('input[aria-label="% hoa hồng NRC-500"]');
    const row = input!.closest('[data-commission-variation]')!;
    typeInto(input, '60');
    click(byText(row, 'button', 'Lưu'));
    expect(row.textContent).toContain('Tối đa 50%');
    expect(m.calls.some((c) => c.url.includes('/variations/v1'))).toBe(false);

    typeInto(input, '7,5');
    click(byText(row, 'button', 'Lưu'));
    await flush();
    expect(bodyOf(m, '/variations/v1')).toEqual({ rate: 7.5 });
    expect(m.calls.find((c) => c.url.includes('/variations/v1'))?.init?.method).toBe('PUT');
  });

  it('áp cho biến thể chưa có %: hỏi xác nhận kèm số biến thể, huỷ thì không gọi, đồng ý thì POST', async () => {
    const m = stub({ '/admin/commission-rates/fill-missing': { body: { updated: 1, affiliateRate: 10 } } });
    const { container } = mount(<CommissionRatesTab />);
    await flush();
    typeInto(container.querySelector('input[aria-label="% áp cho biến thể chưa có %"]'), '10');
    click(byText(container, 'button', 'Áp dụng'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('1 biến thể đang bán chưa có % của hàng Tubu');
    answerConfirm(false);
    await flush();
    expect(m.calls.some((c) => c.url.includes('fill-missing'))).toBe(false);

    click(byText(container, 'button', 'Áp dụng'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(bodyOf(m, 'fill-missing')).toEqual({ rate: 10 });
    expect(container.textContent).toContain('Đã đặt 10% cho 1 biến thể.');
  });

  it('nhập CSV: xem trước hiện từng dòng theo trạng thái; áp dụng sau xác nhận; sửa nội dung thì phải xem trước lại', async () => {
    const m = stub({
      '/import/preview': { body: PREVIEW },
      '/import/apply': { body: { updated: 1, unchanged: 0, notFound: ['ZZZ'] } },
    });
    const { container } = mount(<CommissionRatesTab />);
    await flush();
    const ta = container.querySelector('textarea[aria-label="Nội dung CSV sku,% hoa hồng"]');
    typeInto(ta, 'NRC-500,10\nZZZ,5');
    click(byText(container, 'button', 'Xem trước'));
    await flush();
    expect(bodyOf(m, '/import/preview')).toEqual({ csv: 'NRC-500,10\nZZZ,5' });
    const rows = container.querySelectorAll<HTMLElement>('[data-import-row]');
    expect([...rows].map((r) => r.dataset.importRow)).toEqual(['NOT_FOUND', 'OK']);
    expect(rows[1]!.textContent).toContain('Chưa có % → 10%');

    typeInto(ta, 'NRC-500,10\nZZZ,6');
    expect(byText(container, 'button', 'Áp dụng 1 dòng')).toBeNull();
    typeInto(ta, 'NRC-500,10\nZZZ,5');
    click(byText(container, 'button', 'Xem trước'));
    await flush();
    click(byText(container, 'button', 'Áp dụng 1 dòng'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('bỏ qua 1 SKU không khớp');
    answerConfirm(true);
    await flush();
    expect(bodyOf(m, '/import/apply')).toEqual({ csv: 'NRC-500,10\nZZZ,5' });
    expect(container.textContent).toContain('Đã đổi % cho 1 biến thể');
    expect(container.textContent).toContain('ZZZ');
  });

  it('CSV còn dòng lỗi → nút áp dụng bị khoá, báo phải sửa file', async () => {
    stub({ '/import/preview': { body: { ...PREVIEW, blocking: 1, canApply: false, counts: { ...PREVIEW.counts, INVALID: 1 } } } });
    const { container } = mount(<CommissionRatesTab />);
    await flush();
    typeInto(container.querySelector('textarea[aria-label="Nội dung CSV sku,% hoa hồng"]'), 'X,abc');
    click(byText(container, 'button', 'Xem trước'));
    await flush();
    expect((byText(container, 'button', 'Áp dụng') as HTMLButtonElement | null)?.disabled).toBe(true);
    expect(container.textContent).toContain('Còn 1 dòng lỗi');
  });

  it('giá sỉ đại lý: chọn bậc → xem trước (giá đọc kiểu VN, giá lẻ) → xác nhận → ghi', async () => {
    const preview = {
      tierId: 't_gold',
      rows: [
        { line: 1, sku: 'NRC-500', input: '185.000', status: 'OK', price: 185_000, currentPrice: null, retailPrice: 200_000, productName: 'Nước rửa chén', variationName: '500ml', message: null },
        { line: 2, sku: 'ZZZ', input: '100.000', status: 'NOT_FOUND', price: 100_000, currentPrice: null, retailPrice: null, productName: null, variationName: null, message: 'không có biến thể nào mang SKU này' },
      ],
      counts: { OK: 1, UNCHANGED: 0, NOT_FOUND: 1, INVALID: 0, OUT_OF_RANGE: 0, DUPLICATE: 0 },
      blocking: 0,
      canApply: true,
    };
    const m = stub({
      '/admin/dealer-prices/import/preview': { body: preview },
      '/admin/dealer-prices/import': { body: { tierId: 't_gold', updated: 1, unchanged: 0, skipped: 1, notFound: ['ZZZ'] } },
    });
    const { container } = mount(<CommissionRatesTab />);
    await flush();
    const csv = 'NRC-500;185.000\nZZZ;100.000';
    typeInto(container.querySelector('textarea[aria-label="Nội dung CSV sku,giá sỉ"]'), csv);
    click(byText(container, 'button', 'Xem trước giá sỉ'));
    expect(container.textContent).toContain('Chọn bậc đại lý trước.');
    selectValue(container.querySelector('select[aria-label="Bậc đại lý"]'), 't_gold');
    click(byText(container, 'button', 'Xem trước giá sỉ'));
    await flush();
    expect(bodyOf(m, '/import/preview')).toEqual({ tierId: 't_gold', csv });
    const rows = container.querySelectorAll<HTMLElement>('[data-dealer-row]');
    expect([...rows].map((r) => r.dataset.dealerRow)).toEqual(['NOT_FOUND', 'OK']);
    expect(rows[1]!.textContent).toContain('chưa có → 185.000');
    expect(rows[1]!.textContent).toContain('giá lẻ 200.000');

    click(byText(container, 'button', 'Ghi 1 giá sỉ'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('bỏ qua 1 SKU không khớp');
    answerConfirm(true);
    await flush();
    const apply = m.calls.find((c) => c.url.endsWith('/admin/dealer-prices/import'));
    expect(JSON.parse(String(apply?.init?.body))).toEqual({ tierId: 't_gold', csv });
    expect(container.textContent).toContain('Đã cập nhật 1 giá sỉ');
  });

  it('giá sỉ còn dòng lỗi (ngoài khoảng giá lẻ) → không có nút ghi bật, báo sửa file', async () => {
    stub({
      '/admin/dealer-prices/import/preview': {
        body: {
          tierId: 't_gold',
          rows: [{ line: 1, sku: 'NRC-500', input: '185', status: 'OUT_OF_RANGE', price: 185, currentPrice: null, retailPrice: 200_000, productName: 'N', variationName: null, message: 'ngoài khoảng 10–100% giá lẻ (20.000–200.000đ)' }],
          counts: { OK: 0, UNCHANGED: 0, NOT_FOUND: 0, INVALID: 0, OUT_OF_RANGE: 1, DUPLICATE: 0 },
          blocking: 1,
          canApply: false,
        },
      },
    });
    const { container } = mount(<CommissionRatesTab />);
    await flush();
    selectValue(container.querySelector('select[aria-label="Bậc đại lý"]'), 't_gold');
    typeInto(container.querySelector('textarea[aria-label="Nội dung CSV sku,giá sỉ"]'), 'NRC-500,185');
    click(byText(container, 'button', 'Xem trước giá sỉ'));
    await flush();
    expect((byText(container, 'button', 'Ghi 0 giá sỉ') as HTMLButtonElement | null)?.disabled).toBe(true);
    expect(container.textContent).toContain('Ngoài khoảng giá lẻ');
    expect(container.textContent).toContain('Còn 1 dòng lỗi');
  });
});
