// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WastePreviewDTO } from '@tubutree/shared-types';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';
import { loadPointsNav, saveReturn } from '@/lib/recycle-wizard';
import { ITEM_CARTON, ITEM_MILK, makeRequestDetail, makeWasteMe, makeWastePoint } from './recycle-fixtures';

// Chép ý recycle-edit.spec.tsx (Mini App, §4.5, §7.4, §15.2): sửa món giữ nguyên hạn giữ chỗ, ước tính mới debounce,
// đổi điểm nhận qua trang chọn điểm rồi quay về nháp, PATCH. Khác Mini App: nháp quay về nằm trong sessionStorage.

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  replace: vi.fn(),
  request: null as unknown,
  me: null as unknown,
  meFail: false,
  config: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } } as Record<string, unknown>,
  preview: null as unknown as (b: unknown) => unknown,
  edit: null as unknown as (b: unknown) => unknown,
  calls: [] as { method: string; path: string; body?: unknown }[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
  usePathname: () => '/doi-rac/yeu-cau/req-1/sua',
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => state.config }));
vi.mock('./recycle-labels', async (orig) => ({ ...(await orig<object>()), PREVIEW_DEBOUNCE_MS: 0 }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ method: 'GET', path });
      if (path === '/waste/requests/req-1') return state.request;
      if (path === '/waste/me') {
        if (state.meFail) {
          state.meFail = false;
          throw new Error('Máy chủ bận');
        }
        return state.me;
      }
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'POST', path, body });
      if (path === '/waste/preview') return state.preview(body);
      throw new Error(`chưa mock ${path}`);
    },
    patch: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'PATCH', path, body });
      if (path === '/waste/requests/req-1') return state.edit(body);
      throw new Error(`chưa mock ${path}`);
    },
  },
}));

import { RecycleEdit } from './recycle-edit';

const preview = (over: Partial<WastePreviewDTO> = {}): WastePreviewDTO => ({
  estimatedPoints: 6000,
  estimatedDrops: 0,
  estimatedGrams: null,
  pointsValueVnd: 6000,
  blocks: [],
  feeEstimate: null,
  itemCaps: [],
  pointsMonthRemaining: 190_000,
  ...over,
});
const DETAIL = '/doi-rac/yeu-cau/req-1';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RecycleEdit id="req-1" />);
  mounted.push(r);
  await flush(10);
  return r.container;
};
const card = (c: HTMLElement, name: string) => byText(c, '[data-item]', name)!;
const stepper = (c: HTMLElement, item: string, label: 'Tăng số lượng' | 'Giảm số lượng') =>
  card(c, item).querySelector<HTMLElement>(`button[aria-label="${label}"]`)!;
const button = (c: ParentNode, name: string) => byText(c, 'button', name) as HTMLButtonElement | null;
const calls = (method: string) => state.calls.filter((x) => x.method === method);

beforeEach(() => {
  window.sessionStorage.clear();
  state.phase = 'authenticated';
  state.replace = vi.fn();
  state.request = makeRequestDetail();
  state.me = makeWasteMe();
  state.meFail = false;
  state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
  state.calls = [];
  state.preview = () => preview();
  state.edit = () => makeRequestDetail();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('/doi-rac/yeu-cau/[id]/sua (§4.5, §7.4)', () => {
  it('không sửa được: về trang yêu cầu', async () => {
    state.request = makeRequestDetail({ editable: false });
    await mount();
    expect(state.replace).toHaveBeenCalledWith(DETAIL);
  });

  it('khách bị khoá chương trình: về trang yêu cầu (sửa bị chặn, §15.1)', async () => {
    state.me = makeWasteMe({ blocked: true });
    await mount();
    expect(state.replace).toHaveBeenCalledWith(DETAIL);
  });

  it('chương trình tạm dừng: về trang yêu cầu', async () => {
    state.config = { isLoaded: true, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } };
    await mount();
    expect(state.replace).toHaveBeenCalledWith(DETAIL);
  });

  it('/waste/me lỗi: câu lỗi + "Thử lại", bấm thì tải lại', async () => {
    state.meFail = true;
    const c = await mount();
    expect(c.textContent).toContain('Máy chủ bận');
    click(button(c, 'Thử lại'));
    await flush(8);
    expect(card(c, 'Thùng carton')).not.toBeNull();
    expect(calls('GET').filter((x) => x.path === '/waste/me')).toHaveLength(2);
  });

  it('bộ đếm lấy số đã khai; trần cộng thêm phần đang giữ của chính yêu cầu', async () => {
    state.me = makeWasteMe({ items: [{ ...ITEM_CARTON, monthRemainingQty: 0 }, ITEM_MILK] });
    const c = await mount();
    const carton = card(c, 'Thùng carton');
    expect(carton.querySelector<HTMLInputElement>('input[aria-label="Số lượng"]')?.value).toBe('5');
    expect(carton.querySelector('button[aria-label="Tăng số lượng"]')?.getAttribute('aria-disabled')).toBe('true');
    expect(carton.querySelector('button[aria-label="Giảm số lượng"]')?.getAttribute('aria-disabled')).toBe('false');
  });

  it('nói rõ điểm ước tính có thể đổi và hạn giữ chỗ không đổi; ước tính mới từ /waste/preview', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Điểm ước tính có thể thay đổi theo mức quy đổi hiện hành');
    expect(c.textContent).toContain('Hạn giữ chỗ không đổi: 25/10/2026');
    expect(c.textContent).toContain('Ước tính mới 6.000 điểm');
    expect(calls('POST')[0]).toEqual({
      method: 'POST',
      path: '/waste/preview',
      body: { lines: [{ itemId: 'item-carton', declaredQty: 5 }], method: 'DROP_OFF', pointId: 'pt-1' },
    });
  });

  it('Mang tới điểm nhận: "Đổi điểm nhận" lưu nháp + nơi quay về rồi sang trang chọn điểm', async () => {
    const c = await mount();
    click(button(c, 'Đổi điểm nhận'));
    expect(loadPointsNav()).toEqual({
      returnTo: `${DETAIL}/sua`,
      selectedItemIds: ['item-carton'],
      draft: expect.objectContaining({ method: 'DROP_OFF', pointId: 'pt-1', lines: { 'item-carton': 5 } }),
    });
    expect(state.replace).toHaveBeenCalledWith('/doi-rac/diem-nhan');
  });

  it('quay về từ trang chọn điểm: dùng nháp (món + điểm mới), lưu gửi PATCH rồi về trang yêu cầu', async () => {
    saveReturn({
      lines: { 'item-carton': 3 },
      method: 'DROP_OFF',
      pointId: 'pt-2',
      pickedPoint: makeWastePoint({ id: 'pt-2', name: 'Đại lý Mới' }),
      provinceCode: null,
    });
    const c = await mount();
    expect(c.textContent).toContain('Đại lý Mới');
    click(button(c, 'Lưu thay đổi'));
    await flush(8);
    expect(calls('PATCH')).toEqual([
      { method: 'PATCH', path: '/waste/requests/req-1', body: { lines: [{ itemId: 'item-carton', declaredQty: 3 }], pointId: 'pt-2' } },
    ]);
    expect(state.replace).toHaveBeenLastCalledWith(DETAIL);
  });

  it('Gửi về kho: không có bộ chọn điểm, body không có pointId; lỗi hiện câu máy chủ', async () => {
    state.request = makeRequestDetail({ method: 'MAIL_IN', point: null });
    state.edit = () => {
      throw new Error('Món này hiện chưa nhận, hãy bỏ khỏi danh sách');
    };
    const c = await mount();
    click(button(c, 'Lưu thay đổi'));
    await flush(8);
    expect(calls('PATCH')[0]?.body).toEqual({ lines: [{ itemId: 'item-carton', declaredQty: 5 }] });
    expect(button(c, 'Đổi điểm nhận')).toBeNull();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Món này hiện chưa nhận, hãy bỏ khỏi danh sách');
    expect(state.replace).not.toHaveBeenCalledWith(DETAIL);
  });

  it('đổi số lượng gửi đúng số mới, bỏ hết món thì không lưu được', async () => {
    const c = await mount();
    click(stepper(c, 'Thùng carton', 'Giảm số lượng'));
    await flush(4);
    click(button(c, 'Lưu thay đổi'));
    await flush(8);
    expect(calls('PATCH')[0]?.body).toEqual({ lines: [{ itemId: 'item-carton', declaredQty: 4 }], pointId: 'pt-1' });
    for (let i = 0; i < 4; i++) click(stepper(c, 'Thùng carton', 'Giảm số lượng'));
    await flush(4);
    expect(button(c, 'Lưu thay đổi')?.disabled).toBe(true);
  });

  it('dòng của món không còn nhận: phải bỏ được trước khi lưu (§15.2 PATCH)', async () => {
    const base = makeRequestDetail();
    state.request = makeRequestDetail({
      lines: [...base.lines, { ...base.lines[0]!, itemId: 'item-battery', itemName: 'Pin đã dùng', unitLabel: 'viên', declaredQty: 2 }],
    });
    const c = await mount();
    expect(c.textContent).toContain('Món này hiện chưa nhận');
    const save = button(c, 'Lưu thay đổi')!;
    expect(save.disabled).toBe(true);
    click(button(c, 'Bỏ món này'));
    await flush(4);
    expect(save.disabled).toBe(false);
    click(save);
    await flush(8);
    expect(calls('PATCH')[0]?.body).toEqual({ lines: [{ itemId: 'item-carton', declaredQty: 5 }], pointId: 'pt-1' });
  });

  it('khách chưa đăng nhập: mời đăng nhập quay lại đúng trang, không gọi API đổi rác', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent(`${DETAIL}/sua`)}`);
    expect(state.calls).toEqual([]);
  });

  it('phiên không khôi phục được: không gọi API đổi rác', async () => {
    state.phase = 'unavailable';
    await mount();
    expect(state.calls).toEqual([]);
  });

  it('một h1, thứ tự heading đúng, điều khiển có tên', async () => {
    const c = await mount();
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });
});

describe('/doi-rac/yeu-cau/[id]/sua — diện mạo Mini App ở điện thoại', () => {
  it('thanh dính đáy xếp dọc: chú thích ở trên, nút Lưu thay đổi full-width bên dưới', async () => {
    await mount();
    const bar = document.querySelector('[data-testid="sticky-bar"]')!;
    const row = bar.firstElementChild!;
    expect(row.className).toContain('max-md:flex-col');
    expect(row.lastElementChild!.className).toContain('max-md:w-full');
  });
});
