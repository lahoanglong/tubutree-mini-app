// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductSuggestion } from '@tubutree/app-core/api/catalog';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets } from '@/test-utils/a11y';

// Chép ý product-picker.spec.tsx (Mini App): gợi ý có tên và giá, bỏ sản phẩm đã chọn, chọn thì xoá ô tìm, trần 5 sản phẩm,
// gỡ chip, không có kết quả, chỉ gợi ý từ 2 ký tự (chữ có dấu gấp về 1 ký tự vẫn chưa đủ).

const mocks = vi.hoisted(() => ({ get: vi.fn(), flash: [] as unknown[] }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => mocks.flash }));
vi.mock('./use-debounced', () => ({ useDebounced: <T,>(v: T) => v }));

import { ProductPicker } from './product-picker';

const A: ProductSuggestion = { slug: 'nuoc-rua-chen', name: 'Nước rửa chén sinh học', thumbnail: 'https://img/a.jpg', basePrice: 89_000 };
const B: ProductSuggestion = { slug: 'xit-phong', name: 'Xịt phòng tinh dầu', thumbnail: null, basePrice: 120_000 };
const C: ProductSuggestion = { slug: 'tui-vai', name: 'Túi vải tái chế', thumbnail: null, basePrice: 45_000 };

let mounted: Rendered[] = [];
function mountPicker(props: { value?: ProductSuggestion[]; max?: number } = {}) {
  const onChange = vi.fn();
  const r = render(<ProductPicker value={props.value ?? []} onChange={onChange} max={props.max} />);
  mounted.push(r);
  return { c: r.container, onChange };
}
const input = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type="search"], input')!;
const search = async (c: HTMLElement, text: string) => {
  typeInto(input(c), text);
  await flush(4);
};

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue([A, B]);
  mocks.flash = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('ProductPicker', () => {
  it('đang Giờ vàng: gợi ý ghi giá khách trả, khớp thẻ sản phẩm', async () => {
    mocks.flash = [{ itemId: 'f1', variationId: 'v1', productSlug: 'xit-phong', flashPrice: 90_000, retailPrice: 120_000, salePrice: null, soldCount: 0, quota: 5, endAt: '2099-01-01T00:00:00.000Z' }];
    const { c } = mountPicker();
    await search(c, 'xịt');
    expect(c.textContent).toContain('90.000đ');
    expect(c.textContent).not.toContain('120.000đ');
  });

  it('gõ từ khoá gọi /search/suggest, hiện tên và giá, bỏ sản phẩm đã chọn', async () => {
    const { c } = mountPicker({ value: [A] });
    await search(c, 'rửa');
    expect(mocks.get).toHaveBeenCalledWith('/search/suggest', { query: { q: 'rửa' } });
    expect(c.textContent).toContain('Xịt phòng tinh dầu');
    expect(c.textContent).toContain('120.000đ');
    expect(c.querySelectorAll('[data-testid="suggestion"]')).toHaveLength(1);
  });

  it('chọn một gợi ý: onChange nhận danh sách có thêm sản phẩm đó và ô tìm được xoá', async () => {
    const { c, onChange } = mountPicker();
    await search(c, 'xịt');
    click(c.querySelector('[data-testid="suggestion"]'));
    expect(onChange).toHaveBeenCalledWith([A]);
    expect(input(c).value).toBe('');
  });

  it('đã đủ số tối đa: báo "Chỉ gắn tối đa 5 sản phẩm", không gọi onChange', async () => {
    const { c, onChange } = mountPicker({ value: [A, B, C], max: 3 });
    mocks.get.mockResolvedValue([{ slug: 'khac', name: 'Sản phẩm khác', thumbnail: null, basePrice: 1000 }]);
    await search(c, 'khác');
    click(c.querySelector('[data-testid="suggestion"]'));
    expect(onChange).not.toHaveBeenCalled();
    expect(c.textContent).toContain('Chỉ gắn tối đa 5 sản phẩm');
  });

  it('nút gỡ trên chip bỏ đúng sản phẩm', () => {
    const { c, onChange } = mountPicker({ value: [A, B] });
    click(c.querySelector('button[aria-label="Gỡ Xịt phòng tinh dầu"]'));
    expect(onChange).toHaveBeenCalledWith([A]);
  });

  it('không có kết quả: "Không tìm thấy sản phẩm phù hợp"', async () => {
    mocks.get.mockResolvedValue([]);
    const { c } = mountPicker();
    await search(c, 'zzz');
    expect(c.textContent).toContain('Không tìm thấy sản phẩm phù hợp');
  });

  it('1 ký tự (kể cả "đ" gấp về "d" và khoảng trắng thừa): không gọi API, báo "Nhập ít nhất 2 ký tự"', async () => {
    const { c } = mountPicker();
    await search(c, 'đ ');
    expect(mocks.get).not.toHaveBeenCalled();
    expect(c.textContent).toContain('Nhập ít nhất 2 ký tự');
    expect(c.textContent).not.toContain('Không tìm thấy');
  });

  it('ô trống: không có câu báo nào', () => {
    const { c } = mountPicker();
    expect(c.textContent).not.toContain('Nhập ít nhất 2 ký tự');
  });

  it('vùng chạm 44px và ô tìm có tên truy cập', () => {
    const { c } = mountPicker({ value: [A] });
    expect(smallTouchTargets(c)).toEqual([]);
    expect(input(c).getAttribute('aria-label') ?? input(c).placeholder).toBeTruthy();
  });
});
