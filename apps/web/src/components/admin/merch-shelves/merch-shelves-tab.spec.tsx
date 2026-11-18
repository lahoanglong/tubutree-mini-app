// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { byText, click, flush, render, selectValue, type Rendered } from '@/test-utils/dom';
import { unlabeledFields, unnamedControls } from '@/test-utils/a11y';
import { ApiError } from '@/lib/client-api';
import type { MerchPinView, MerchProductView, MerchShelfView } from './api';
import { MerchShelvesTab } from './merch-shelves-tab';

const api = vi.hoisted(() => ({ overview: vi.fn(), shelf: vi.fn(), save: vi.fn(), suggest: vi.fn(), product: vi.fn(), empty: vi.fn() }));
vi.mock('./api', () => ({
  getMerchOverview: api.overview,
  getMerchShelf: api.shelf,
  saveMerchShelf: api.save,
  suggestMerchPins: api.suggest,
  getMerchProduct: api.product,
  getEmptyEntrances: api.empty,
}));
// Ô tìm thật gõ chữ rồi chờ máy chủ; ở đây bấm là chọn món `picked.id`.
const picked = vi.hoisted(() => ({ id: 'p9' }));
vi.mock('@/components/admin/product-picker', () => ({
  ProductPicker: ({ onChange, label }: { onChange: (v: { id: string; label: string } | null) => void; label: string }) => (
    <button type="button" onClick={() => onChange({ id: picked.id, label: picked.id })}>
      {`Chọn: ${label}`}
    </button>
  ),
}));
// Thẻ cửa hàng thật đọc Giờ vàng, phí ship qua mạng; ở đây chỉ cần biết thẻ nào hiện, kiểu nào, có số hạng không.
vi.mock('@/components/mini/product-card', () => ({
  ProductCard: ({ product, variant, rank }: { product: { id: string; name: string }; variant: string; rank?: number }) => (
    <div data-testid="card" data-id={product.id} data-variant={variant} data-rank={rank === undefined ? '' : String(rank)}>
      {product.name}
    </div>
  ),
}));

// Thẻ rút gọn: thẻ giả ở trên chỉ đọc id và tên.
const card = (id: string) => ({ id, slug: id, name: `Món ${id}` }) as unknown as ProductCard;
const product = (id: string, over: Partial<MerchProductView> = {}): MerchProductView => ({
  productId: id,
  name: `Món ${id}`,
  brand: 'Tubu',
  slug: id,
  thumbnail: `https://img/${id}.jpg`,
  warnings: [],
  card: card(id),
  ...over,
});
const pinView = (id: string, position: number, over: Partial<MerchPinView> = {}): MerchPinView => ({
  ...product(id),
  position,
  startsAt: null,
  endsAt: null,
  note: null,
  live: true,
  ...over,
});
const shelfView = (key: string, pins: MerchPinView[], over: Partial<MerchShelfView> = {}): MerchShelfView => ({
  key,
  label: key === 'best_sellers' ? 'Bán chạy nhất' : 'Trang chủ: Gợi ý hôm nay',
  version: 'v1',
  maxPins: 12,
  status: { enabled: false, curated: true },
  pins,
  ...over,
});
const homePins = () => [pinView('a', 0), pinView('b', 1, { warnings: ['OUT_OF_STOCK'], live: false }), pinView('c', 2, { warnings: ['NO_SHORT_DESC'] })];

let mounted: Rendered | null = null;
beforeEach(() => {
  picked.id = 'p9';
  api.overview.mockResolvedValue({
    status: { enabled: false, curated: true },
    shelves: [
      { key: 'home_featured', label: 'Trang chủ: Gợi ý hôm nay', kind: 'home', pinCount: 3 },
      { key: 'best_sellers', label: 'Bán chạy nhất', kind: 'best_sellers', pinCount: 1 },
      { key: 'category:son', label: 'Danh mục: Son', kind: 'category', pinCount: 0 },
    ],
  });
  api.shelf.mockImplementation(async (key: string) => (key === 'best_sellers' ? shelfView('best_sellers', [pinView('r1', 0)]) : shelfView('home_featured', homePins())));
  api.empty.mockResolvedValue({
    checkedAt: '2026-11-18T03:00:00.000Z',
    entrances: [
      { key: 'flash', label: 'Giờ vàng', detail: 'Không có suất nào đang chạy', adminTab: 'flashSales' },
      { key: 'groupBuys', label: 'Mua chung', detail: 'Không có nhóm nào đang mở', adminTab: null },
    ],
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.clearAllMocks();
});

async function mount() {
  mounted = render(<MerchShelvesTab />);
  await flush();
  return mounted.container;
}
const rows = (c: ParentNode) => Array.from(c.querySelectorAll('[data-testid="merch-pin"]')).map((e) => e.getAttribute('data-product-id'));
const btn = (c: ParentNode, text: string) => byText(c, 'button', text) as HTMLButtonElement | null;
const handle = (c: ParentNode, id: string) => c.querySelector<HTMLButtonElement>(`[data-product-id="${id}"] button[draggable]`);
const previewIds = (c: ParentNode) => Array.from(c.querySelectorAll('[data-testid="merch-preview-phone"] [data-testid="card"]')).map((e) => e.getAttribute('data-id'));
const pressKey = (el: Element | null, key: string) =>
  act(() => {
    el!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });

describe('MerchShelvesTab', () => {
  it('tải kệ: đúng thứ tự đã lưu, cảnh báo theo món, cờ tắt thì nhắc, xem trước bỏ món hết hàng, lối vào trống dẫn sang tab; mọi điều khiển có tên', async () => {
    const c = await mount();
    expect(api.shelf).toHaveBeenCalledWith('home_featured');
    expect(rows(c)).toEqual(['a', 'b', 'c']);
    expect(c.textContent).toContain('Hết hàng: tự rơi khỏi kệ tới khi có hàng');
    expect(c.textContent).toContain('Thiếu mô tả ngắn');
    expect(c.textContent).toContain('Cờ Xếp kệ (merch.shelves_enabled) đang tắt');
    expect(c.textContent).toContain('Tubu chọn cho bạn');
    expect(previewIds(c)).toEqual(['a', 'c']);
    expect(Array.from(c.querySelectorAll('[data-testid="merch-preview-phone"] [data-testid="card"]')).map((e) => e.getAttribute('data-variant'))).toEqual(['grid', 'grid']);
    expect(c.querySelectorAll('[data-testid="merch-preview-desktop"] [data-testid="card"]')).toHaveLength(2);
    expect(c.querySelector('a[href="/admin?tab=flashSales"]')?.textContent).toBe('Mở tab');
    expect(c.textContent).toContain('Mua chung');
    expect(c.querySelectorAll('a[href^="/admin?tab="]')).toHaveLength(1);
    expect(btn(c, 'Lưu kệ')!.disabled).toBe(true);
    expect(btn(c, 'Bỏ thay đổi')!.disabled).toBe(true);
    expect(unnamedControls(c)).toEqual([]);
    expect(unlabeledFields(c)).toEqual([]);
  });

  it('thêm món qua ô tìm: hỏi máy chủ món đó theo kệ đang mở, thêm cuối, khoá đổi kệ; Lưu gửi đúng thứ tự và phiên bản; thêm trùng thì báo', async () => {
    api.product.mockResolvedValue(product('p9'));
    const c = await mount();
    click(btn(c, 'Chọn: Thêm món vào kệ'));
    await flush();
    expect(api.product).toHaveBeenCalledWith('p9', 'home_featured');
    expect(rows(c)).toEqual(['a', 'b', 'c', 'p9']);
    expect(c.querySelector('select')!.disabled).toBe(true);
    expect(c.textContent).toContain('Lưu hoặc bỏ thay đổi trước khi đổi kệ.');

    api.save.mockImplementation(async (key: string, _v: string, pins: { productId: string }[]) =>
      shelfView(key, pins.map((p, i) => pinView(p.productId, i)), { version: 'v2' }),
    );
    click(btn(c, 'Lưu kệ'));
    await flush();
    expect(api.save).toHaveBeenCalledWith('home_featured', 'v1', [
      { productId: 'a', startsAt: null, endsAt: null, note: null },
      { productId: 'b', startsAt: null, endsAt: null, note: null },
      { productId: 'c', startsAt: null, endsAt: null, note: null },
      { productId: 'p9', startsAt: null, endsAt: null, note: null },
    ]);
    expect(c.textContent).toContain('Đã lưu kệ. Cờ Xếp kệ đang tắt nên khách chưa thấy thay đổi.');
    expect(c.querySelector('select')!.disabled).toBe(false);
    expect(btn(c, 'Lưu kệ')!.disabled).toBe(true);

    click(btn(c, 'Chọn: Thêm món vào kệ'));
    await flush();
    expect(rows(c)).toEqual(['a', 'b', 'c', 'p9']);
    expect(c.textContent).toContain('"Món p9" đã có trên kệ.');
  });

  it('bàn phím: mũi tên trên nút số đổi chỗ, nút giữ focus theo món, đọc vị trí mới; Bỏ thay đổi về bản đã lưu', async () => {
    const c = await mount();
    handle(c, 'c')!.focus();
    pressKey(handle(c, 'c'), 'ArrowUp');
    expect(rows(c)).toEqual(['a', 'c', 'b']);
    expect(document.activeElement).toBe(handle(c, 'c'));
    expect(handle(c, 'c')!.getAttribute('aria-label')).toContain('vị trí 2 trên 3');
    expect(c.querySelector('[aria-live="polite"]')!.textContent).toBe('Đã chuyển "Món c" tới vị trí 2 trên 3.');
    pressKey(handle(c, 'c'), 'ArrowUp');
    pressKey(handle(c, 'c'), 'ArrowUp');
    expect(rows(c)).toEqual(['c', 'a', 'b']);
    expect(document.activeElement).toBe(handle(c, 'c'));
    pressKey(handle(c, 'a'), 'ArrowDown');
    expect(rows(c)).toEqual(['c', 'b', 'a']);
    click(btn(c, 'Bỏ thay đổi'));
    expect(rows(c)).toEqual(['a', 'b', 'c']);
    expect(btn(c, 'Lưu kệ')!.disabled).toBe(true);
  });

  it('nút ↑/↓ và Gỡ sửa bản nháp; chưa bấm Lưu thì không ghi gì', async () => {
    const c = await mount();
    click(c.querySelector('[aria-label="Đưa \\"Món a\\" xuống"]'));
    expect(rows(c)).toEqual(['b', 'a', 'c']);
    expect((c.querySelector('[aria-label="Đưa \\"Món b\\" lên"]') as HTMLButtonElement).disabled).toBe(true);
    click(c.querySelector('[aria-label="Gỡ \\"Món c\\" khỏi kệ"]'));
    expect(rows(c)).toEqual(['b', 'a']);
    expect(api.save).not.toHaveBeenCalled();
  });

  it('Gợi ý chỉ đọc: gửi các món đang có để loại trừ, Thêm tất cả vào bản nháp, không gọi Lưu', async () => {
    api.suggest.mockResolvedValue({ items: [product('s1'), product('s2')] });
    const c = await mount();
    click(btn(c, 'Gợi ý 8 món sẵn sàng'));
    await flush();
    expect(api.suggest).toHaveBeenCalledWith('home_featured', ['a', 'b', 'c']);
    expect(c.querySelectorAll('[data-testid="merch-suggestion"]')).toHaveLength(2);
    expect(c.textContent).toContain('Chỉ thêm vào bản nháp; bấm Lưu kệ thì khách mới thấy.');
    click(btn(c, 'Thêm tất cả'));
    expect(rows(c)).toEqual(['a', 'b', 'c', 's1', 's2']);
    expect(c.textContent).toContain('Không còn món nào đủ điều kiện ngoài các món đã ghim.');
    expect(api.save).not.toHaveBeenCalled();
  });

  it('kệ đã bị người khác lưu (409): báo, khoá Lưu, Tải lại kệ thay bản nháp bằng bản mới nhất', async () => {
    api.product.mockResolvedValue(product('p9'));
    api.save.mockRejectedValue(new ApiError('Kệ đã đổi', 409, 'SHELF_CHANGED'));
    const c = await mount();
    click(btn(c, 'Chọn: Thêm món vào kệ'));
    await flush();
    click(btn(c, 'Lưu kệ'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Kệ vừa được người khác lưu');
    expect(btn(c, 'Lưu kệ')!.disabled).toBe(true);

    api.shelf.mockResolvedValueOnce(shelfView('home_featured', [pinView('x', 0)], { version: 'v2' }));
    click(btn(c, 'Tải lại kệ'));
    await flush();
    expect(rows(c)).toEqual(['x']);
    expect(c.textContent).not.toContain('Kệ vừa được người khác lưu');
    expect(btn(c, 'Lưu kệ')!.disabled).toBe(true);
  });

  it('món chưa có ảnh: báo ngay trên màn và khoá Lưu (máy chủ cũng chặn)', async () => {
    api.product.mockResolvedValue(product('p9', { thumbnail: null, warnings: ['NO_IMAGE'] }));
    const c = await mount();
    click(btn(c, 'Chọn: Thêm món vào kệ'));
    await flush();
    expect(c.textContent).toContain('"Món p9" chưa có ảnh: thêm ảnh ở tab Sản phẩm hoặc gỡ khỏi kệ.');
    expect(btn(c, 'Lưu kệ')!.disabled).toBe(true);
    expect(previewIds(c)).toEqual(['a', 'c']);
  });

  it('kệ Bán chạy: xem trước dùng thẻ hạng nhưng không đánh số', async () => {
    const c = await mount();
    selectValue(c.querySelector('select'), 'best_sellers');
    await flush();
    expect(api.shelf).toHaveBeenLastCalledWith('best_sellers');
    expect(rows(c)).toEqual(['r1']);
    const cards = Array.from(c.querySelectorAll('[data-testid="merch-preview-phone"] [data-testid="card"]'));
    expect(cards.map((e) => [e.getAttribute('data-variant'), e.getAttribute('data-rank')])).toEqual([['rank', '']]);
  });

  it('kệ trống: nói rõ khách thấy như hôm nay', async () => {
    api.shelf.mockImplementation(async (key: string) => shelfView(key, []));
    const c = await mount();
    expect(c.querySelector('[data-testid="merch-empty"]')?.textContent).toContain('khách thấy thứ tự như hôm nay');
    expect(c.querySelector('[data-testid="merch-preview-empty"]')).not.toBeNull();
  });
});
