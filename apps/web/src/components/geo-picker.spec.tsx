// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EMPTY_GEO, GeoPicker } from './geo-picker';
import { flush, mockFetch, render, type Rendered } from '@/test-utils/dom';

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

// C-097: ký tự ⚠ ở thông báo lỗi chuyển sang icon lucide; nội dung lỗi giữ nguyên.
describe('GeoPicker — thông báo lỗi', () => {
  it('lỗi tỉnh/phường: icon lucide aria-hidden + đúng chữ lỗi, tông danger-fg, không còn ký tự ⚠', async () => {
    const api = mockFetch({ '/geo/provinces': { body: [] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(
      <GeoPicker value={EMPTY_GEO} onChange={() => {}} errorProvince="Chọn tỉnh/thành" errorWard="Chọn phường/xã" />,
    );
    await flush();
    const msgs = Array.from(container.querySelectorAll('p'));
    expect(msgs.map((p) => p.textContent)).toEqual(['Chọn tỉnh/thành', 'Chọn phường/xã']);
    for (const p of msgs) {
      expect(p.className).toContain('text-danger-fg');
      expect(p.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(container.textContent).not.toContain('⚠');
    expect(container.querySelector('select[aria-label="Tỉnh/thành"]')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('không lỗi thì không có dòng thông báo', async () => {
    const api = mockFetch({ '/geo/provinces': { body: [] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<GeoPicker value={EMPTY_GEO} onChange={() => {}} />);
    await flush();
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });
});
