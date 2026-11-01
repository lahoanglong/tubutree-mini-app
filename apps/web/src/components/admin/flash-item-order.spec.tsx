// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import { FlashItemOrder, parseSortOrder } from './flash-item-order';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const bodyOf = (call: { init?: RequestInit } | undefined) => JSON.parse(String(call?.init?.body ?? '{}')) as Record<string, unknown>;

function mount(routes: Parameters<typeof mockFetch>[0], props: { sortOrder?: number } = {}) {
  const api = mockFetch(routes);
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const onSaved = vi.fn();
  const r = render(<FlashItemOrder itemId="i1" sortOrder={props.sortOrder} label="Sữa hạt 1L" onSaved={onSaved} />);
  mounted.push(r);
  const input = () => r.container.querySelector<HTMLInputElement>('[aria-label="Thứ tự của Sữa hạt 1L"]')!;
  const save = () => byText(r.container, 'button', 'Lưu') as HTMLButtonElement;
  return { r, api, onSaved, input, save };
}

describe('parseSortOrder', () => {
  it('nhận số nguyên trong biên của API, từ chối chuỗi rỗng, số lẻ, chữ và ngoài biên', () => {
    expect(parseSortOrder('0')).toBe(0);
    expect(parseSortOrder(' 7 ')).toBe(7);
    expect(parseSortOrder('-1000')).toBe(-1000);
    expect(parseSortOrder('1000')).toBe(1000);
    for (const bad of ['', ' ', '1.5', 'abc', '1001', '-1001', '1e2']) expect(parseSortOrder(bad)).toBeNull();
  });
});

describe('FlashItemOrder (ô Thứ tự của tab Giờ vàng)', () => {
  it('hiện thứ tự đang lưu (mặc định 0) và khoá nút Lưu tới khi gõ số khác', async () => {
    const { input, save } = mount({ '/admin/flash-sales/items/i1': { body: {} } });
    expect(input().value).toBe('0');
    expect(save().disabled).toBe(true);
    typeInto(input(), '0');
    expect(save().disabled).toBe(true);
    typeInto(input(), '2');
    expect(save().disabled).toBe(false);
  });

  it('lưu: PATCH đúng món với số nguyên, rồi báo cho bảng nạp lại', async () => {
    const { api, onSaved, input, save } = mount({ '/admin/flash-sales/items/i1': { body: { id: 'i1', sortOrder: 3 } } }, { sortOrder: 1 });
    expect(input().value).toBe('1');
    typeInto(input(), '3');
    click(save());
    await flush();
    const patch = api.calls.find((c) => c.init?.method === 'PATCH');
    expect(patch?.url).toContain('/admin/flash-sales/items/i1');
    expect(bodyOf(patch)).toEqual({ sortOrder: 3 });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('số âm được nhận (ghim lên trước các món mặc định 0)', async () => {
    const { api, input, save } = mount({ '/admin/flash-sales/items/i1': { body: {} } });
    typeInto(input(), '-1');
    click(save());
    await flush();
    expect(bodyOf(api.calls.find((c) => c.init?.method === 'PATCH'))).toEqual({ sortOrder: -1 });
  });

  it('ô trống, số lẻ hay ngoài biên: nút khoá, có chữ báo và không gọi API', async () => {
    const { r, api, input, save } = mount({ '/admin/flash-sales/items/i1': { body: {} } });
    // 'abc' không vào được ô type=number (trình duyệt và jsdom đều bỏ), nên chỉ thử số lẻ và ngoài biên.
    for (const bad of ['1.5', '5000', '-1001']) {
      typeInto(input(), bad);
      expect(save().disabled).toBe(true);
      expect(r.container.textContent).toContain('Nhập số nguyên từ -1000 đến 1000.');
    }
    typeInto(input(), '');
    expect(save().disabled).toBe(true);
    expect(r.container.textContent).not.toContain('Nhập số nguyên');
    click(save());
    await flush();
    expect(api.calls).toEqual([]);
  });

  it('API từ chối: hiện câu lỗi bằng chữ, không báo đã lưu', async () => {
    const { r, onSaved, input, save } = mount({ '/admin/flash-sales/items/i1': { status: 400, body: { message: 'Không tìm thấy sản phẩm flash.' } } });
    typeInto(input(), '4');
    click(save());
    await flush();
    expect(r.container.querySelector('[role="alert"]')?.textContent).toContain('Không tìm thấy sản phẩm flash.');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
