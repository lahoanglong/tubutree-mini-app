// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { InvoiceFilterChips } from './invoice-filter-chips';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('InvoiceFilterChips (C-094)', () => {
  it('hiện số đơn VAT chờ xuất (đọc meta.total với invoice=pending&limit=1), chọn chip gọi onChange', async () => {
    const api = mockFetch({ '/admin/orders': { body: { data: [], meta: { page: 1, limit: 1, total: 7 } } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const onChange = vi.fn();
    const r = render(<InvoiceFilterChips value="" onChange={onChange} />);
    mounted.push(r);
    await flush();
    expect(api.calls[0]!.url).toContain('invoice=pending');
    expect(api.calls[0]!.url).toContain('limit=1');
    expect(r.container.textContent).toContain('VAT chờ xuất (7)');
    expect(byText(r.container, 'button', 'Mọi đơn')?.getAttribute('aria-selected')).toBe('true');

    click(byText(r.container, 'button', 'VAT chờ xuất'));
    expect(onChange).toHaveBeenCalledWith('pending');
    click(byText(r.container, 'button', 'VAT đã xuất'));
    expect(onChange).toHaveBeenCalledWith('issued');
    click(byText(r.container, 'button', 'Mọi đơn'));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('chip đang chọn có aria-selected; vùng chạm ≥ 44px trên điện thoại', async () => {
    const api = mockFetch({ '/admin/orders': { body: { data: [], meta: { page: 1, limit: 1, total: 0 } } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<InvoiceFilterChips value="all" onChange={() => undefined} />);
    mounted.push(r);
    await flush();
    expect(byText(r.container, 'button', 'Tất cả đơn VAT')?.getAttribute('aria-selected')).toBe('true');
    expect(byText(r.container, 'button', 'Mọi đơn')?.getAttribute('aria-selected')).toBe('false');
    r.container.querySelectorAll('button').forEach((b) => expect(b.className).toContain('min-h-[44px]'));
  });
});
