// @vitest-environment jsdom
import { useState } from 'react';
import { act } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EMPTY_GEO, GeoPicker, type GeoValue } from './geo-picker';
import { chooseGeo, click, flush, mockFetch, render, selectByLabel, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets } from '@/test-utils/a11y';

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
    expect(selectByLabel(container, 'Tỉnh/Thành phố')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('lỗi tỉnh/phường gắn vào ô bằng aria-describedby, nhãn bậc field-label (12px/500), lời báo 13px (bậc caption)', async () => {
    const api = mockFetch({ '/geo/provinces': { body: [] } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(
      <GeoPicker value={EMPTY_GEO} onChange={() => {}} errorProvince="Chọn tỉnh/thành" errorWard="Chọn phường/xã" />,
    );
    await flush();
    for (const [label, text] of [['Tỉnh/Thành phố', 'Chọn tỉnh/thành'], ['Phường/Xã', 'Chọn phường/xã']] as const) {
      const select = selectByLabel(container, label)!;
      const note = document.getElementById(select.getAttribute('aria-describedby') ?? '');
      expect(note?.textContent).toBe(text);
    }
    const labels = Array.from(container.querySelectorAll('label'));
    expect(labels.length).toBe(2);
    for (const l of labels) expect(l.className).toContain('text-field-label');
    for (const p of Array.from(container.querySelectorAll('p'))) expect(p.className).toContain('text-caption');
    expect(container.innerHTML).not.toContain('text-xs');
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
    click(selectByLabel(container, 'Tỉnh/Thành phố'));
    expect(document.querySelector('[role="option"][data-code="84_VN01"]')?.textContent).toBe('Hà Nội');
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

// W42B: AddressLocationSheet thay <select> — tìm không dấu tức thì, dòng ≥ 44px, dòng đang chọn có dấu, chọn tỉnh xong tự sang Phường/Xã.
describe('GeoPicker — sheet chọn địa giới (W42B)', () => {
  const PROVINCES = [
    { code: '84_VN01', name: 'Hà Nội' },
    { code: '84_VN79', name: 'Thành phố Hồ Chí Minh' },
    { code: '84_VN48', name: 'Thành phố Đà Nẵng' },
  ];
  const COMMUNES = [
    { code: 'c1', name: 'Phường Bình Thạnh' },
    { code: 'c2', name: 'Phường Thảo Điền' },
    { code: 'c3', name: 'Phường Bến Nghé' },
    { code: 'c4', name: 'Phường Đa Kao (Quận 1)' },
  ];

  function Host({ initial = EMPTY_GEO, spy }: { initial?: GeoValue; spy?: (v: GeoValue) => void }) {
    const [v, setV] = useState(initial);
    return (
      <GeoPicker
        value={v}
        onChange={(n) => {
          spy?.(n);
          setV(n);
        }}
      />
    );
  }
  const setup = async (initial?: GeoValue, spy?: (v: GeoValue) => void) => {
    const api = mockFetch({ '/geo/provinces': { body: PROVINCES }, '/geo/communes': { body: COMMUNES } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = mount(<Host initial={initial} spy={spy} />);
    await flush();
    return r.container;
  };
  const sheet = (label: string) => document.querySelector<HTMLElement>(`[role="listbox"][aria-label="${label}"]`);
  const names = (label: string) => Array.from(sheet(label)!.querySelectorAll('[role="option"]')).map((o) => o.textContent?.trim());
  const search = () => document.querySelector<HTMLInputElement>('[role="dialog"] input[type="search"]');
  const HCM: GeoValue = { province: 'Thành phố Hồ Chí Minh', provinceCode: '84_VN79', ward: '', wardCode: '' };

  it('ô tỉnh là nút combobox có nhãn, bấm mở sheet đúng tiêu đề với đủ danh sách; ô phường khoá tới khi chọn tỉnh', async () => {
    const c = await setup();
    const trigger = selectByLabel(c, 'Tỉnh/Thành phố')!;
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('role')).toBe('combobox');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.textContent).toContain('Chọn tỉnh/thành');
    expect((selectByLabel(c, 'Phường/Xã') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('Tỉnh/Thành phố');
    expect(names('Tỉnh/Thành phố')).toEqual(['Hà Nội', 'Thành phố Hồ Chí Minh', 'Thành phố Đà Nẵng']);
  });

  it('tìm không dấu, không phân biệt hoa thường: "ho chi minh", "HA NOI", "da nang"', async () => {
    const c = await setup();
    click(selectByLabel(c, 'Tỉnh/Thành phố'));
    typeInto(search(), 'ho chi minh');
    expect(names('Tỉnh/Thành phố')).toEqual(['Thành phố Hồ Chí Minh']);
    typeInto(search(), 'HA NOI');
    expect(names('Tỉnh/Thành phố')).toEqual(['Hà Nội']);
    typeInto(search(), 'da nang');
    expect(names('Tỉnh/Thành phố')).toEqual(['Thành phố Đà Nẵng']);
    typeInto(search(), '');
    expect(names('Tỉnh/Thành phố')).toHaveLength(3);
  });

  it('phường/xã: "binh thanh", "thao dien", "quan 1" ra đúng dòng; không khớp thì báo "Không tìm thấy kết quả phù hợp"', async () => {
    const c = await setup(HCM);
    click(selectByLabel(c, 'Phường/Xã'));
    expect(names('Phường/Xã')).toHaveLength(4);
    typeInto(search(), 'binh thanh');
    expect(names('Phường/Xã')).toEqual(['Phường Bình Thạnh']);
    typeInto(search(), 'thao dien');
    expect(names('Phường/Xã')).toEqual(['Phường Thảo Điền']);
    typeInto(search(), 'quan 1');
    expect(names('Phường/Xã')).toEqual(['Phường Đa Kao (Quận 1)']);
    typeInto(search(), 'zzzz');
    expect(sheet('Phường/Xã')!.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(sheet('Phường/Xã')!.textContent).toContain('Không tìm thấy kết quả phù hợp');
  });

  it('dòng cao ≥ 44px, nút có tên, dòng đang chọn có aria-selected và dấu tích', async () => {
    const c = await setup({ ...HCM, ward: 'Phường Thảo Điền', wardCode: 'c2' });
    click(selectByLabel(c, 'Phường/Xã'));
    const list = sheet('Phường/Xã')!;
    for (const o of Array.from(list.querySelectorAll('[role="option"]'))) expect(o.className).toContain('min-h-11');
    // Ô tìm là SearchField dùng chung (khung min-h 44px bọc ô nhập 42px) nên chỉ quét danh sách và nút Đóng.
    expect(smallTouchTargets(list)).toEqual([]);
    expect(smallTouchTargets(document.querySelector('[role="dialog"] h2')!.parentElement as HTMLElement)).toEqual([]);
    const selected = Array.from(list.querySelectorAll('[role="option"]')).filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected.map((o) => o.textContent?.trim())).toEqual(['Phường Thảo Điền']);
    expect(selected[0]!.querySelector('svg')).not.toBeNull();
    expect(list.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
  });

  it('chọn tỉnh: đặt tỉnh, xoá phường, đóng sheet tỉnh và tự mở sheet Phường/Xã (không bấm thêm)', async () => {
    const spy = vi.fn();
    const c = await setup({ province: 'Hà Nội', provinceCode: '84_VN01', ward: 'Cầu Giấy', wardCode: 'old' }, spy);
    chooseGeo(c, 'Tỉnh/Thành phố', 'Thành phố Hồ Chí Minh');
    await flush();
    expect(spy).toHaveBeenLastCalledWith({ province: 'Thành phố Hồ Chí Minh', provinceCode: '84_VN79', ward: '', wardCode: '' });
    expect(sheet('Tỉnh/Thành phố')).toBeNull();
    expect(sheet('Phường/Xã')).not.toBeNull();
    expect(names('Phường/Xã')).toHaveLength(4);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it('chọn phường: ghi tên + mã, đóng sheet, ô hiện tên phường; mở lại sheet thì ô tìm trống', async () => {
    const spy = vi.fn();
    const c = await setup(HCM, spy);
    click(selectByLabel(c, 'Phường/Xã'));
    typeInto(search(), 'ben nghe');
    chooseGeo(c, 'Phường/Xã', 'Phường Bến Nghé');
    await flush();
    expect(spy).toHaveBeenLastCalledWith({ ...HCM, ward: 'Phường Bến Nghé', wardCode: 'c3' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(selectByLabel(c, 'Phường/Xã')!.textContent).toContain('Phường Bến Nghé');
    expect(selectByLabel(c, 'Phường/Xã')!.getAttribute('data-value')).toBe('c3');
    click(selectByLabel(c, 'Phường/Xã'));
    expect(search()!.value).toBe('');
    expect(names('Phường/Xã')).toHaveLength(4);
  });

  it('chọn lại đúng tỉnh đang chọn không xoá phường; Esc đóng sheet không đổi gì', async () => {
    const spy = vi.fn();
    const c = await setup({ ...HCM, ward: 'Phường Bến Nghé', wardCode: 'c3' }, spy);
    chooseGeo(c, 'Tỉnh/Thành phố', 'Thành phố Hồ Chí Minh');
    await flush();
    expect(spy).not.toHaveBeenCalled();
    click(selectByLabel(c, 'Phường/Xã'));
    expect(sheet('Phường/Xã')).not.toBeNull();
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('Enter khi chỉ còn một kết quả chọn luôn dòng đó', async () => {
    const spy = vi.fn();
    const c = await setup(HCM, spy);
    click(selectByLabel(c, 'Phường/Xã'));
    typeInto(search(), 'thao dien');
    act(() => void search()!.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(spy).toHaveBeenLastCalledWith({ ...HCM, ward: 'Phường Thảo Điền', wardCode: 'c2' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Enter ở ô tìm trong sheet không gửi form địa chỉ bao ngoài (sự kiện submit nổi bọt qua portal bị chặn)', async () => {
    const outerSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    const api = mockFetch({ '/geo/provinces': { body: PROVINCES }, '/geo/communes': { body: COMMUNES } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    function InForm() {
      const [v, setV] = useState(HCM);
      return (
        <form onSubmit={outerSubmit}>
          <GeoPicker value={v} onChange={setV} />
        </form>
      );
    }
    const c = mount(<InForm />).container;
    await flush();
    click(selectByLabel(c, 'Phường/Xã'));
    typeInto(search(), 'thao dien');
    act(() => void search()!.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(selectByLabel(c, 'Phường/Xã')!.textContent).toContain('Phường Thảo Điền');
    expect(outerSubmit).not.toHaveBeenCalled();
  });

  it('đóng sheet Phường/Xã (chọn xong hoặc Esc) thì focus về ô Phường/Xã; sau chọn tỉnh tự mở sheet phường cũng vậy', async () => {
    const c = await setup(HCM);
    click(selectByLabel(c, 'Phường/Xã'));
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(selectByLabel(c, 'Phường/Xã'));

    chooseGeo(c, 'Tỉnh/Thành phố', 'Thành phố Đà Nẵng');
    await flush();
    expect(sheet('Phường/Xã')).not.toBeNull();
    chooseGeo(c, 'Phường/Xã', 'Phường Thảo Điền');
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(selectByLabel(c, 'Phường/Xã'));
  });
});

describe('GeoPicker — "Thử lại" khi tải tỉnh/phường lỗi (kiểm hồi quy, không có khoá riêng)', () => {
  it('chạm đúp cùng một khung hình vào mỗi nút Thử lại chỉ gọi lại API một lần (query-core gộp refetch của truy vấn chưa có dữ liệu, mà nút này chỉ hiện khi chưa có dữ liệu)', async () => {
    let provincesCalls = 0;
    let communesCalls = 0;
    let openProvinces: () => void = () => undefined;
    let openCommunes: () => void = () => undefined;
    const provincesGate = new Promise<void>((r) => (openProvinces = r));
    const communesGate = new Promise<void>((r) => (openCommunes = r));
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/geo/provinces')) {
          provincesCalls += 1;
          if (provincesCalls === 1) return reply(503, { message: 'x' });
          await provincesGate;
          return reply(200, [{ code: '84_VN01', name: 'Hà Nội' }]);
        }
        communesCalls += 1;
        if (communesCalls === 1) return reply(503, { message: 'x' });
        await communesGate;
        return reply(200, [{ code: '84_VN01_001', name: 'Cầu Giấy' }]);
      }),
    );
    const value = { province: 'Hà Nội', provinceCode: '84_VN01', ward: '', wardCode: '' };
    const { container } = mount(<GeoPicker value={value} onChange={() => {}} />);
    await flush();
    const retries = () => Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === 'Thử lại');
    expect(retries()).toHaveLength(2);
    const [provincesRetry, communesRetry] = retries();
    act(() => {
      provincesRetry!.click();
      provincesRetry!.click();
    });
    act(() => {
      communesRetry!.click();
      communesRetry!.click();
    });
    await flush(3);
    expect(provincesCalls).toBe(2);
    expect(communesCalls).toBe(2);
    await act(async () => {
      openProvinces();
      openCommunes();
    });
    await flush(4);
    expect(retries()).toHaveLength(0);
  });
});
