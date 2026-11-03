// @vitest-environment jsdom
import { act } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DealerTierSelect } from './dealer-tier-select';
import { ProductPicker, useVariationLabels } from './product-picker';
import { UserPicker } from './user-picker';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';

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
  vi.restoreAllMocks();
});

const PRODUCTS = [
  {
    id: 'p1',
    name: 'Nước rửa chén Lá Sả',
    slug: 'nuoc-rua-chen-la-sa',
    brand: 'Tubu',
    thumbnail: null,
    isActive: true,
    variations: [
      { id: 'v1', name: 'Chai 500ml', sku: 'NRC-500', price: 80_000, stock: 5, isActive: true },
      { id: 'v2', name: 'Can 5L', sku: 'NRC-5L', price: 350_000, stock: 0, isActive: true },
    ],
  },
  { id: 'p2', name: 'Nước lau sàn', slug: 'nuoc-lau-san', brand: null, thumbnail: null, isActive: false, variations: [{ id: 'v3', name: 'Chai 1L', sku: 'NLS-1', price: 60_000, stock: 9, isActive: true }] },
];

const choose = (select: HTMLSelectElement, value: string) =>
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
const search = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[type="search"]');
const options = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));

// C-092 (A1-031): Flash Sale / Content Kit bắt admin dán Variation ID / Product ID thô.
describe('ProductPicker', () => {
  it('chưa đủ 2 ký tự → chỉ gợi ý, KHÔNG gọi API', async () => {
    const api = mockFetch({ '/admin/products/search': { body: PRODUCTS } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<ProductPicker mode="variation" value={null} onChange={() => {}} label="Chọn biến thể" debounceMs={0} />);
    typeInto(search(container), 'n');
    await flush();
    expect(api.calls).toHaveLength(0);
    expect(container.textContent).toMatch(/ít nhất 2 ký tự/i);
  });

  it('chế độ biến thể: gõ tên → GET products/search, nhóm theo sản phẩm, mỗi biến thể một dòng kèm SKU, giá, tồn; SP ẩn có nhãn', async () => {
    const api = mockFetch({ '/admin/products/search': { body: PRODUCTS } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<ProductPicker mode="variation" value={null} onChange={() => {}} label="Chọn biến thể" debounceMs={0} />);
    typeInto(search(container), 'nuoc');
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/products/search?q=nuoc');
    const t = container.textContent ?? '';
    expect(t).toContain('Nước rửa chén Lá Sả');
    expect(t).toContain('Chai 500ml · NRC-500 · 80.000đ · tồn 5');
    expect(t).toContain('Can 5L · NRC-5L · 350.000đ · hết hàng');
    expect(t).toContain('Nước lau sàn · đang ẩn');
    expect(options(container)).toHaveLength(3);
  });

  it('chọn một biến thể → onChange({ id, label "Sản phẩm · Biến thể (SKU)" })', async () => {
    const api = mockFetch({ '/admin/products/search': { body: PRODUCTS } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const onChange = vi.fn();
    const { container } = mount(<ProductPicker mode="variation" value={null} onChange={onChange} label="Chọn biến thể" debounceMs={0} />);
    typeInto(search(container), 'nuoc');
    await flush();
    click(options(container)[0]!);
    expect(onChange).toHaveBeenCalledWith({ id: 'v1', label: 'Nước rửa chén Lá Sả · Chai 500ml (NRC-500)' });
  });

  it('chế độ sản phẩm: mỗi sản phẩm một dòng, chọn trả id sản phẩm', async () => {
    const api = mockFetch({ '/admin/products/search': { body: PRODUCTS } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const onChange = vi.fn();
    const { container } = mount(<ProductPicker mode="product" value={null} onChange={onChange} label="Chọn sản phẩm" debounceMs={0} />);
    typeInto(search(container), 'nuoc');
    await flush();
    expect(options(container)).toHaveLength(2);
    click(options(container)[1]!);
    expect(onChange).toHaveBeenCalledWith({ id: 'p2', label: 'Nước lau sàn' });
  });

  it('đã chọn → hiện nhãn đã chọn (không còn ô gõ), bấm "Đổi" → onChange(null)', () => {
    const onChange = vi.fn();
    const { container } = mount(<ProductPicker mode="product" value={{ id: 'p1', label: 'Nước rửa chén Lá Sả' }} onChange={onChange} label="Chọn sản phẩm" />);
    expect(container.textContent).toContain('Nước rửa chén Lá Sả');
    expect(search(container)).toBeNull();
    click(byText(container, 'button', 'Đổi'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('không có kết quả → nói rõ; API lỗi → báo lỗi role=alert', async () => {
    const none = mockFetch({ '/admin/products/search': { body: [] } });
    vi.stubGlobal('fetch', vi.fn(none.fn));
    const a = mount(<ProductPicker mode="product" value={null} onChange={() => {}} label="Chọn sản phẩm" debounceMs={0} />);
    typeInto(search(a.container), 'zzz');
    await flush();
    expect(a.container.textContent).toMatch(/không thấy kết quả nào khớp/i);

    const bad = mockFetch({ '/admin/products/search': { status: 500, body: { message: 'Lỗi máy chủ' } } });
    vi.stubGlobal('fetch', vi.fn(bad.fn));
    const b = mount(<ProductPicker mode="product" value={null} onChange={() => {}} label="Chọn sản phẩm" debounceMs={0} />);
    typeInto(search(b.container), 'nuoc');
    await flush();
    expect(b.container.querySelector('[role="alert"]')?.textContent).toContain('Lỗi máy chủ');
  });

  it('ô gõ có aria-label và cao tối thiểu 44px trên điện thoại', () => {
    const { container } = mount(<ProductPicker mode="product" value={null} onChange={() => {}} label="Chọn sản phẩm" />);
    const input = search(container)!;
    expect(input.getAttribute('aria-label')).toBe('Chọn sản phẩm');
    expect(input.className).toContain('min-h-[44px]');
  });
});

describe('UserPicker', () => {
  const USERS = {
    data: [
      { id: 'u1', fullName: 'Nguyễn An', phone: '0900000001', role: 'AFFILIATE', pointsBalance: 0, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'u2', fullName: null, phone: '0900000002', role: 'CUSTOMER', pointsBalance: 0, createdAt: '2026-01-02T00:00:00.000Z' },
    ],
    meta: { page: 1, limit: 8, total: 2 },
  };

  it('gõ SĐT/tên → GET users?search=, hiện tên + SĐT + vai trò, chọn trả id khách', async () => {
    const api = mockFetch({ '/admin/users': { body: USERS } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const onChange = vi.fn();
    const { container } = mount(<UserPicker value={null} onChange={onChange} label="Chọn đối tác" debounceMs={0} />);
    typeInto(search(container), '0900');
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/users?page=1&limit=8&search=0900');
    const t = container.textContent ?? '';
    expect(t).toContain('Nguyễn An · 0900000001');
    expect(t).toContain('Chưa có tên · 0900000002');
    expect(t).toContain('AFFILIATE');
    click(options(container)[0]!);
    expect(onChange).toHaveBeenCalledWith({ id: 'u1', label: 'Nguyễn An · 0900000001' });
  });

  it('còn nhiều kết quả hơn số hiện → nhắc gõ cụ thể hơn', async () => {
    const api = mockFetch({ '/admin/users': { body: { ...USERS, meta: { page: 1, limit: 8, total: 31 } } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<UserPicker value={null} onChange={() => {}} label="Chọn đối tác" debounceMs={0} />);
    typeInto(search(container), '09');
    await flush();
    expect(container.textContent).toMatch(/còn 29 kết quả khác/i);
  });
});

describe('DealerTierSelect', () => {
  const TIERS = [
    { id: 'dealer_l1', name: 'Đại lý cấp 1', minOrderVolume: 0, creditLimit: 0, paymentTerms: null },
    { id: 'dealer_l3', name: 'Đại lý cấp 3', minOrderVolume: 50_000_000, creditLimit: 20_000_000, paymentTerms: 'NET30' },
  ];

  it('nạp bậc từ API, chọn → onChange(id)', async () => {
    const api = mockFetch({ '/admin/dealer-tiers': { body: TIERS } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const onChange = vi.fn();
    const { container } = mount(<DealerTierSelect value="" onChange={onChange} />);
    await flush();
    const select = container.querySelector('select')!;
    expect(select.getAttribute('aria-label')).toBe('Bậc đại lý');
    expect(select.className).toContain('min-h-[44px]');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'dealer_l1', 'dealer_l3']);
    expect(select.options[2]!.textContent).toContain('Đại lý cấp 3 · từ 50.000.000đ · hạn mức công nợ 20.000.000đ · NET30');
    choose(select, 'dealer_l3');
    expect(onChange).toHaveBeenCalledWith('dealer_l3');
  });

  it('chưa có bậc nào → nói rõ cần tạo bậc; lỗi → báo lỗi + thử lại', async () => {
    const empty = mockFetch({ '/admin/dealer-tiers': { body: [] } });
    vi.stubGlobal('fetch', vi.fn(empty.fn));
    const a = mount(<DealerTierSelect value="" onChange={() => {}} />);
    await flush();
    expect(a.container.textContent).toMatch(/chưa có bậc đại lý nào/i);

    const bad = mockFetch({ '/admin/dealer-tiers': { status: 500, body: { message: 'Lỗi máy chủ' } } });
    vi.stubGlobal('fetch', vi.fn(bad.fn));
    const b = mount(<DealerTierSelect value="" onChange={() => {}} />);
    await flush();
    expect(b.container.querySelector('[role="alert"]')?.textContent).toContain('Không tải được');
    expect(byText(b.container, 'button', 'Thử lại')).not.toBeNull();
  });
});

describe('useVariationLabels', () => {
  function Probe({ ids }: { ids: string[] }) {
    const labels = useVariationLabels(ids);
    return (
      <ul>
        {ids.map((id) => (
          <li key={id} data-id={id}>{labels.labelFor(id)}</li>
        ))}
      </ul>
    );
  }

  it('một lượt lookup cho mọi id (không N+1); id không tra được hiện "không còn tồn tại"', async () => {
    const api = mockFetch({
      '/admin/variations/lookup': { body: [{ id: 'v1', name: 'Chai 500ml', sku: 'NRC-500', productId: 'p1', productName: 'Nước rửa chén' }] },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<Probe ids={['v1', 'v9']} />);
    expect(container.querySelector('[data-id="v1"]')?.textContent).toBe('Đang tải tên…');
    await flush();
    expect(api.calls).toHaveLength(1);
    expect(decodeURIComponent(api.calls[0]!.url)).toContain('/admin/variations/lookup?ids=v1,v9');
    expect(container.querySelector('[data-id="v1"]')?.textContent).toBe('Nước rửa chén · Chai 500ml (NRC-500)');
    expect(container.querySelector('[data-id="v9"]')?.textContent).toBe('Biến thể không còn tồn tại (v9)');
  });

  it('lookup lỗi → quay về hiện id thô thay vì làm hỏng danh sách', async () => {
    const api = mockFetch({ '/admin/variations/lookup': { status: 500, body: { message: 'x' } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<Probe ids={['v1']} />);
    await flush();
    expect(container.querySelector('[data-id="v1"]')?.textContent).toBe('Biến thể v1');
  });
});
