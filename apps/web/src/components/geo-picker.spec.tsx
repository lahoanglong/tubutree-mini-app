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

  it('API địa giới lỗi (Pancake trục trặc) → báo rõ + nút "Thử lại" gọi lại được, không đứng im ở ô trống', async () => {
    let ok = false;
    const api = mockFetch({
      '/geo/provinces': () =>
        ok ? { body: [{ code: '84_VN01', name: 'Hà Nội' }] } : { status: 503, body: { message: 'Chưa tải được danh sách tỉnh/thành' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<GeoPicker value={EMPTY_GEO} onChange={() => {}} />);
    await flush();
    expect(container.textContent).toContain('Không tải được danh sách tỉnh/thành.');
    const retry = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Thử lại');
    expect(retry).toBeTruthy();
    ok = true;
    retry!.click();
    await flush();
    expect(container.textContent).not.toContain('Không tải được');
    expect(container.querySelector('option[value="84_VN01"]')?.textContent).toBe('Hà Nội');
  });

  it('phường/xã lỗi → báo lỗi + "Thử lại" riêng cho phường/xã', async () => {
    const api = mockFetch({
      '/geo/provinces': { body: [{ code: '84_VN01', name: 'Hà Nội' }] },
      '/geo/communes': { status: 503, body: { message: 'x' } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const value = { province: 'Hà Nội', provinceCode: '84_VN01', ward: '', wardCode: '' };
    const { container } = mount(<GeoPicker value={value} onChange={() => {}} />);
    await flush();
    expect(container.textContent).toContain('Không tải được danh sách phường/xã.');
    expect(Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === 'Thử lại')).toHaveLength(1);
  });

  it('không lỗi thì không có dòng thông báo', async () => {
    const api = mockFetch({ '/geo/provinces': { body: [] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<GeoPicker value={EMPTY_GEO} onChange={() => {}} />);
    await flush();
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });
});
