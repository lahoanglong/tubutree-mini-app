// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfigItem } from './config-item';
import { byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { ConfigRow } from '@/lib/admin-client';

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

const row = (over: Partial<ConfigRow> = {}): ConfigRow => ({
  key: 'shipping.free_threshold',
  value: 200000,
  description: 'Đơn ≥ 200k được freeship',
  category: 'shipping',
  ...over,
});

function setup(r: ConfigRow) {
  const puts: { key: string; value: unknown }[] = [];
  const api = mockFetch({
    '/admin/config': (init) => {
      if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
      return { body: { ok: true } };
    },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const onSaved = vi.fn();
  return { puts, onSaved, ...mount(<ConfigItem row={r} onSaved={onSaved} />) };
}

describe('ConfigItem (tab Cấu hình)', () => {
  it('khoá đang dùng: sửa JSON rồi Lưu → gửi PUT đúng giá trị đã parse', async () => {
    const { container, puts, onSaved } = setup(row());
    typeInto(container.querySelector('input'), '150000');
    click(byText(container, 'button', 'Lưu'));
    await flush();
    expect(puts).toEqual([{ key: 'shipping.free_threshold', value: 150000 }]);
    expect(onSaved).toHaveBeenCalled();
  });

  it('JSON sai → báo lỗi, không gửi PUT', async () => {
    const { container, puts } = setup(row());
    typeInto(container.querySelector('input'), '{oops');
    click(byText(container, 'button', 'Lưu'));
    await flush();
    expect(puts).toHaveLength(0);
    expect(container.textContent).toContain('JSON không hợp lệ');
  });

  // C-054 (A1-032): admin tưởng đã tắt COD / đặt trần COD mà không code nào đọc khoá.
  it('khoá chết (deprecated): nhãn "Không dùng", ô nhập khoá, không có nút Lưu', async () => {
    const { container, puts } = setup(row({ key: 'payment.cod_max_amount', value: 5000000, description: 'Max đơn cho COD', deprecated: true }));
    expect(container.textContent).toContain('Không dùng');
    expect(container.textContent).toMatch(/sửa sẽ không có tác dụng/i);
    expect(container.querySelector('input')?.disabled).toBe(true);
    expect(byText(container, 'button', 'Lưu')).toBeNull();
    await flush();
    expect(puts).toHaveLength(0);
  });

  it('khoá null (chưa đặt, vd ETA giao hàng) hiện "null" và đặt được số đầu tiên', async () => {
    const { container, puts } = setup(row({ key: 'shipping.eta_min_days', value: null, description: 'Giao dự kiến: số ngày tối thiểu' }));
    expect(container.querySelector('input')?.value).toBe('null');
    typeInto(container.querySelector('input'), '2');
    click(byText(container, 'button', 'Lưu'));
    await flush();
    expect(puts).toEqual([{ key: 'shipping.eta_min_days', value: 2 }]);
  });
});
