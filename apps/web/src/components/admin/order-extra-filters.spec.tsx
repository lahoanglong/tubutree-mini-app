// @vitest-environment jsdom
import { act } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OrderExtraFilters } from './order-extra-filters';
import { byText, click, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { listOrders, downloadOrdersCsv } from '@/lib/admin-client';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
const sel = (c: HTMLElement, label: string) => c.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);

describe('OrderExtraFilters (D1-17)', () => {
  it('chọn loại đơn, thanh toán, nền tảng và thứ tự gọi onChange với giá trị API', () => {
    const onChange = vi.fn();
    const { container } = mount(<OrderExtraFilters value={{}} onChange={onChange} />);
    selectValue(sel(container, 'Lọc đơn theo loại đơn'), 'dealer');
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'dealer' });
    selectValue(sel(container, 'Lọc đơn theo tình trạng thanh toán'), 'PAID');
    expect(onChange).toHaveBeenLastCalledWith({ payment: 'PAID' });
    selectValue(sel(container, 'Lọc đơn theo nền tảng đặt'), 'web');
    expect(onChange).toHaveBeenLastCalledWith({ platform: 'web' });
    selectValue(sel(container, 'Thứ tự sắp xếp theo ngày đặt'), 'asc');
    expect(onChange).toHaveBeenLastCalledWith({ order: 'asc' });
  });

  it('có đủ năm loại đơn bằng tiếng Việt và bốn tình trạng thanh toán; chọn "tất cả" bỏ lọc', () => {
    const onChange = vi.fn();
    const { container } = mount(<OrderExtraFilters value={{ kind: 'ctv', payment: 'UNPAID' }} onChange={onChange} />);
    const kind = sel(container, 'Lọc đơn theo loại đơn')!;
    expect(Array.from(kind.options).map((o) => o.textContent)).toEqual([
      'Mọi loại đơn',
      'Đơn lẻ',
      'Qua CTV',
      'Đơn đại lý',
      'CTV lên đơn hộ',
      'Qua gian hàng',
    ]);
    expect(kind.value).toBe('ctv');
    const pay = sel(container, 'Lọc đơn theo tình trạng thanh toán')!;
    expect(Array.from(pay.options).map((o) => o.textContent)).toEqual(['Mọi tình trạng thanh toán', 'Chưa thanh toán', 'Đã thanh toán', 'Đã hoàn tiền', 'Thanh toán thất bại']);
    selectValue(kind, '');
    expect(onChange).toHaveBeenLastCalledWith({ payment: 'UNPAID' });
  });

  it('gian hàng: nhập slug rồi bấm Lọc; để trống rồi bấm Lọc thì bỏ lọc', () => {
    const onChange = vi.fn();
    const { container } = mount(<OrderExtraFilters value={{}} onChange={onChange} />);
    typeInto(container.querySelector('input[aria-label="Lọc đơn theo gian hàng (tên ngắn trong link)"]'), '  Tubu-Hoa ');
    click(byText(container, 'button', 'Lọc gian hàng'));
    expect(onChange).toHaveBeenLastCalledWith({ storefront: 'Tubu-Hoa' });
    typeInto(container.querySelector('input[aria-label="Lọc đơn theo gian hàng (tên ngắn trong link)"]'), '');
    click(byText(container, 'button', 'Lọc gian hàng'));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('CTV: gõ SĐT/tên tìm khách, chọn một người thì lọc theo id người đó', async () => {
    const api = mockFetch({
      '/admin/users': { body: { data: [{ id: 'u-ctv', fullName: 'Chị Hoa', phone: '0911222333', role: 'AFFILIATE' }], meta: { page: 1, limit: 8, total: 1 } } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const onChange = vi.fn();
    const { container } = mount(<OrderExtraFilters value={{ kind: 'ctv' }} onChange={onChange} />);
    typeInto(container.querySelector('input[aria-label="Lọc đơn theo CTV giới thiệu"]'), '0911');
    // Ô chọn trì hoãn 250ms trước khi gọi API.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    await flush();
    expect(api.calls.some((c) => c.url.includes('/admin/users') && c.url.includes('search=0911'))).toBe(true);
    click(container.querySelector('[role="option"]'));
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'ctv', referrerUserId: 'u-ctv' });
  });

  it('"Xoá bộ lọc" chỉ hiện khi có lọc, bỏ mọi lọc nhưng GIỮ thứ tự sắp xếp', () => {
    const onChange = vi.fn();
    const none = mount(<OrderExtraFilters value={{ order: 'asc' }} onChange={onChange} />);
    expect(byText(none.container, 'button', 'Xoá bộ lọc')).toBeNull();
    const some = mount(<OrderExtraFilters value={{ kind: 'dealer', payment: 'PAID', platform: 'web', referrerUserId: 'u1', storefront: 's', order: 'asc' }} onChange={onChange} />);
    click(byText(some.container, 'button', 'Xoá bộ lọc'));
    expect(onChange).toHaveBeenLastCalledWith({ order: 'asc' });
  });

  it('mọi ô chọn có vùng chạm ≥ 44px trên điện thoại', () => {
    const { container } = mount(<OrderExtraFilters value={{ kind: 'dealer' }} onChange={() => undefined} />);
    container.querySelectorAll('select, button, input').forEach((el) => expect(el.className).toContain('min-h-[44px]'));
  });

  it('mỗi loại đơn có một dòng giải thích khi đang chọn (CTV nói rõ gồm cả khách chia sẻ link)', () => {
    const { container } = mount(<OrderExtraFilters value={{ kind: 'ctv' }} onChange={() => undefined} />);
    expect(container.textContent).toMatch(/mã người giới thiệu/);
  });
});

describe('admin-client — truyền bộ lọc mới xuống API', () => {
  it('listOrders thêm kind, payment, platform, referrerUserId, storefront, order vào query; bộ lọc cũ giữ nguyên', async () => {
    const api = mockFetch({ '/admin/orders': { body: { data: [], meta: { page: 1, limit: 20, total: 0 } } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    await listOrders(2, 'CONFIRMED', 'abc', undefined, 20, undefined, undefined, undefined, undefined, {
      kind: 'ctv_assisted',
      payment: 'PAID',
      platform: 'web',
      referrerUserId: 'u 1',
      storefront: 'Tubu Hoa',
      order: 'asc',
    });
    const url = api.calls[0]!.url;
    expect(url).toContain('page=2');
    expect(url).toContain('status=CONFIRMED');
    expect(url).toContain('search=abc');
    expect(url).toContain('kind=ctv_assisted');
    expect(url).toContain('payment=PAID');
    expect(url).toContain('platform=web');
    expect(url).toContain('referrerUserId=u%201');
    expect(url).toContain('storefront=Tubu%20Hoa');
    expect(url).toContain('order=asc');
  });

  it('listOrders không gửi tham số mới khi không chọn', async () => {
    const api = mockFetch({ '/admin/orders': { body: { data: [], meta: { page: 1, limit: 20, total: 0 } } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    await listOrders(1);
    expect(api.calls[0]!.url).not.toMatch(/kind=|payment=|platform=|referrerUserId=|storefront=|order=/);
  });

  it('downloadOrdersCsv chuyển cùng bộ lọc (CSV = tập đang xem)', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response('x', { status: 200, headers: { 'content-type': 'text/csv' } });
      }),
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    await downloadOrdersCsv({ kind: 'dealer', payment: 'PAID', platform: 'web', referrerUserId: 'u1', storefront: 'a' }).catch(() => undefined);
    expect(urls[0]).toContain('/admin/orders/export');
    expect(urls[0]).toMatch(/kind=dealer/);
    expect(urls[0]).toMatch(/storefront=a/);
  });
});
