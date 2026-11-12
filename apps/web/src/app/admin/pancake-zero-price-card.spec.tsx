// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PancakeZeroPriceCard } from './pancake-zero-price-card';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const mount = () => {
  const r = render(<PancakeZeroPriceCard />);
  mounted.push(r);
  return r;
};

const URL_PART = '/admin/catalog-quality/pancake-zero-price';
const KEPT = { pancakeId: 'v1', sku: 'LAU-SAN-QUE-500', productName: 'Lau sàn quế 500ml', kind: 'PRICE_KEPT', keptPrice: 89_000 };
const NEWONE = { pancakeId: 'v2', sku: 'SKU-MOI-0D', productName: 'Sản phẩm mới chưa có giá', kind: 'NEW_AT_ZERO', keptPrice: null };
const body = (over: object = {}) => ({ scope: 'FULL', updatedAt: '2026-11-13T01:00:00.000Z', count: 2, keptCount: 1, newCount: 1, skus: [KEPT, NEWONE], truncated: false, ...over });
const rows = (r: Rendered) => Array.from(r.container.querySelectorAll('ul[aria-label="SKU Pancake báo giá 0đ"] > li'));

describe('PancakeZeroPriceCard (W131)', () => {
  it('hiện số đếm theo loại và từng SKU: tên, mã SKU, nhãn loại; giá cửa hàng chỉ khi đã giữ giá cũ', async () => {
    const m = mockFetch({ [URL_PART]: { body: body() } });
    vi.stubGlobal('fetch', m.fn);
    const r = mount();
    await flush(10);
    expect(m.calls.filter((c) => c.url.includes(URL_PART))).toHaveLength(1);
    const text = r.container.textContent!;
    expect(text).toContain('SKU Pancake báo giá 0đ');
    expect(text).toContain('2 SKU đang báo giá 0đ: 1 đã giữ giá cũ trên cửa hàng, 1 chưa có giá nên chưa mở bán');
    const [kept, fresh] = rows(r);
    expect(kept!.textContent).toContain('Lau sàn quế 500ml');
    expect(kept!.textContent).toContain('Mã SKU: LAU-SAN-QUE-500');
    expect(kept!.textContent).toContain('Đã giữ giá cũ');
    expect(kept!.textContent).toMatch(/Giá cửa hàng: 89\.000/);
    expect(fresh!.textContent).toContain('Chưa mở bán');
    expect(fresh!.textContent).not.toContain('Giá cửa hàng');
    expect(text).toContain('Cập nhật 08:00 13/11/2026');
  });

  it('số đếm và giá dùng chữ số đều nhau (tabular-nums)', async () => {
    vi.stubGlobal('fetch', mockFetch({ [URL_PART]: { body: body() } }).fn);
    const r = mount();
    await flush(10);
    const tab = Array.from(r.container.querySelectorAll('.tabular-nums')).map((e) => e.textContent);
    expect(tab).toEqual(expect.arrayContaining(['2', '1']));
    expect(tab.some((t) => t?.includes('Giá cửa hàng'))).toBe(true);
  });

  it('tên và mã SKU dài không đẩy tràn ngang ở 360px: cột chữ min-w-0, tên break-words, mã break-all', async () => {
    const long = { ...KEPT, sku: 'X'.repeat(80), productName: 'Tên-rất-dài-không-có-khoảng-trắng-'.repeat(4) };
    vi.stubGlobal('fetch', mockFetch({ [URL_PART]: { body: body({ count: 1, keptCount: 1, newCount: 0, skus: [long] }) } }).fn);
    const r = mount();
    await flush(10);
    const li = rows(r)[0]!;
    expect(li.querySelector('.min-w-0')).not.toBeNull();
    expect(li.querySelector('.break-words')?.textContent).toBe(long.productName);
    expect(li.querySelector('.break-all')?.textContent).toContain(long.sku);
    expect(li.className).toContain('flex-col');
  });

  it('không có SKU nào: báo rõ, không dựng danh sách', async () => {
    vi.stubGlobal('fetch', mockFetch({ [URL_PART]: { body: body({ count: 0, keptCount: 0, newCount: 0, skus: [] }) } }).fn);
    const r = mount();
    await flush(10);
    expect(r.container.textContent).toContain('Không có SKU nào đang báo giá 0đ trên Pancake.');
    expect(r.container.querySelector('ul')).toBeNull();
  });

  it('máy chủ chưa từng ghi danh sách (mốc 1970): nói chưa có lượt đồng bộ, không nói "không có SKU nào"', async () => {
    vi.stubGlobal('fetch', mockFetch({ [URL_PART]: { body: body({ count: 0, keptCount: 0, newCount: 0, skus: [], updatedAt: '1970-01-01T00:00:00.000Z' }) } }).fn);
    const r = mount();
    await flush(10);
    expect(r.container.textContent).toContain('Chưa có lượt đồng bộ Pancake nào ghi nhận danh sách này');
    expect(r.container.textContent).not.toContain('Không có SKU nào đang báo giá 0đ');
  });

  it('danh sách bị cắt ở máy chủ: nói chỉ hiện N trong tổng số', async () => {
    vi.stubGlobal('fetch', mockFetch({ [URL_PART]: { body: body({ count: 250, keptCount: 250, newCount: 0, skus: [KEPT], truncated: true }) } }).fn);
    const r = mount();
    await flush(10);
    expect(r.container.textContent).toContain('Chỉ hiện 1 SKU đầu tiên trong tổng số 250.');
  });

  it('lỗi tải: báo lỗi kèm Thử lại; thử lại thành công thì hiện danh sách', async () => {
    let fail = true;
    const m = mockFetch({ [URL_PART]: () => (fail ? { status: 500, body: { message: 'Lỗi máy chủ' } } : { body: body() }) });
    vi.stubGlobal('fetch', m.fn);
    const r = mount();
    await flush(20);
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Không tải được danh sách SKU giá 0đ');
    fail = false;
    click(byText(r.container, 'button', 'Thử lại'));
    await flush(20);
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
    expect(rows(r)).toHaveLength(2);
  });
});
