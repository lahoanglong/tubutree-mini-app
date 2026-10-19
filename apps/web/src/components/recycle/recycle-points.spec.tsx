// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';
import { EMPTY_DRAFT, savePointsNav, takeReturn, type WasteWizardDraft } from '@/lib/recycle-wizard';
import { makeWasteMe, makeWastePoint } from './recycle-fixtures';

// Chép ý recycle-points.spec.tsx (Mini App, §4.4): tab theo tỉnh, tìm không phân biệt dấu, chọn điểm và trả nháp về trang
// gọi, khoá điểm hết hạn mức hoặc không nhận đủ món, khối "Chưa có điểm gần bạn?". Khác Mini App: không có "Gần tôi" và
// không xin vị trí (web giữ Permissions-Policy geolocation=()), nháp trả về qua sessionStorage.

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  replace: vi.fn(),
  me: null as unknown,
  points: [] as unknown[],
  calls: [] as string[],
  config: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } } as Record<string, unknown>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
  usePathname: () => '/doi-rac/diem-nhan',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => state.config }));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { callPhone: vi.fn(), openExternal: vi.fn() } }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push(path);
      if (path === '/waste/me') return state.me;
      if (path.startsWith('/waste/points')) return state.points;
      throw new Error(`chưa mock ${path}`);
    },
    post: async () => {
      throw new Error('trang này không ghi dữ liệu');
    },
  },
}));

import { RecyclePoints, filterPointsByText } from './recycle-points';

const DRAFT: WasteWizardDraft = { ...EMPTY_DRAFT, lines: { 'item-carton': 5, 'item-milk': 5 }, method: 'DROP_OFF' };
const SELECTED = ['item-carton', 'item-milk'];
const HCM = makeWastePoint({ id: 'pt-hcm', name: 'Đại lý Cô Ba' });
const HCM2 = makeWastePoint({ id: 'pt-hcm2', name: 'Đại lý Tân Định', addressLine: '5 Hai Bà Trưng', communeName: 'Phường Tân Định' });
const HN = makeWastePoint({ id: 'pt-hn', name: 'Đại lý Hồ Gươm', provinceCode: '01', provinceName: 'Hà Nội', communeName: 'Phường Hoàn Kiếm' });

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RecyclePoints />);
  mounted.push(r);
  await flush(10);
  return r.container;
};
const seedNav = (returnTo = '/doi-rac/tao?step=method') => savePointsNav({ returnTo, draft: DRAFT, selectedItemIds: SELECTED });
const radios = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="radio"]'));
const tabs = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
const radio = (c: HTMLElement, name: string) => byText(c, '[role="radio"]', name)!;
const choose = (c: HTMLElement) => byText(c.querySelector('[data-testid="sticky-bar"]')!, 'button', 'Chọn điểm này') as HTMLButtonElement;
const section = (c: HTMLElement) => byText(c, 'h2', 'Chưa có điểm gần bạn?')!.closest('section')!;

beforeEach(() => {
  window.sessionStorage.clear();
  state.phase = 'authenticated';
  state.replace = vi.fn();
  state.calls = [];
  state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
  state.me = makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true } });
  state.points = [HCM, HCM2, HN];
  seedNav();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/doi-rac/diem-nhan (§4.4)', () => {
  it('không có nav (mở thẳng) → về /doi-rac/tao', async () => {
    window.sessionStorage.clear();
    await mount();
    expect(state.replace).toHaveBeenCalledWith('/doi-rac/tao');
  });
  it('khách chưa đăng nhập thấy lời mời đăng nhập, không bị đẩy đi', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.querySelector('a[href^="/dang-nhap"]')).not.toBeNull();
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.calls).toEqual([]);
  });
  it('chưa đủ điều kiện (thiếu SĐT): chỉ lời chỉ sang Zalo (Q2)', async () => {
    state.me = makeWasteMe({ eligibility: 'NEED_PHONE', balance: null, monthUsage: null });
    const c = await mount();
    expect(c.textContent).toContain('Tính năng này cần mở Tubu Tree trên Zalo.');
    expect(radios(c)).toHaveLength(0);
  });
  it('tab theo tỉnh có điểm; đổi tab lọc danh sách', async () => {
    const c = await mount();
    expect(tabs(c)).toEqual(['TP.HCM', 'Hà Nội']);
    expect(radios(c)).toHaveLength(2);
    click(byText(c, '[role="tab"]', 'Hà Nội'));
    expect(radios(c)).toHaveLength(1);
    expect(radios(c)[0]?.textContent).toContain('Đại lý Hồ Gươm');
  });
  it('tìm theo tên, phường/xã hoặc tên đường, không phân biệt dấu', async () => {
    const c = await mount();
    typeInto(c.querySelector('input[type="search"]'), 'tan dinh');
    expect(radios(c).map((r) => r.textContent)).toEqual([expect.stringContaining('Đại lý Tân Định')]);
    expect(filterPointsByText([HCM, HCM2], 'hai bà').map((p) => p.id)).toEqual(['pt-hcm2']);
    expect(filterPointsByText([HCM, HCM2, HN], 'hoan kiem').map((p) => p.id)).toEqual(['pt-hn']);
    expect(filterPointsByText([HCM], '  ').map((p) => p.id)).toEqual(['pt-hcm']);
  });
  it('không khớp điểm nào → câu rỗng', async () => {
    const c = await mount();
    typeInto(c.querySelector('input[type="search"]'), 'zzz');
    expect(c.textContent).toContain('Không tìm thấy điểm nhận nào');
  });
  it('không có "Gần tôi" và không xin vị trí; có lời giải thích ngắn', async () => {
    const c = await mount();
    expect(tabs(c)).not.toContain('Gần tôi');
    expect(byText(c, 'button', 'Dùng vị trí của tôi')).toBeNull();
    expect(c.textContent).toContain('Web không dùng vị trí của bạn');
    expect(state.calls.some((p) => p.includes('nearby'))).toBe(false);
  });
  it('"Chọn điểm này" khoá tới khi chọn; chọn → trả nháp về trang gọi bằng replace', async () => {
    const c = await mount();
    expect(choose(c).disabled).toBe(true);
    click(radio(c, 'Đại lý Cô Ba'));
    expect(choose(c).disabled).toBe(false);
    click(choose(c));
    expect(state.replace).toHaveBeenLastCalledWith('/doi-rac/tao?step=method');
    expect(takeReturn()).toEqual({ ...DRAFT, method: 'DROP_OFF', pointId: 'pt-hcm', pickedPoint: HCM });
  });
  it('điểm hết hạn mức không chọn được nên "Chọn điểm này" vẫn khoá', async () => {
    state.points = [{ ...HCM, quotaFull: true }];
    const c = await mount();
    click(radio(c, 'Đại lý Cô Ba'));
    expect(choose(c).disabled).toBe(true);
  });
  it('điểm không nhận đủ món đã chọn nên "Chọn điểm này" vẫn khoá và nói rõ món thiếu', async () => {
    state.points = [{ ...HCM, acceptedItemIds: [] }];
    const c = await mount();
    click(radio(c, 'Đại lý Cô Ba'));
    expect(choose(c).disabled).toBe(true);
    expect(c.textContent).toContain('Điểm này không nhận: Thùng carton, Vỏ hộp sữa');
  });
  it('khối "Chưa có điểm gần bạn?" nói thật về phí và dẫn tới cách còn lại đang bật', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Gửi gói nhỏ qua hãng vận chuyển thường tốn hơn giá trị điểm.');
    click(byText(section(c), 'button', 'Gửi về kho Tubu HCM'));
    expect(state.replace).toHaveBeenLastCalledWith('/doi-rac/tao?step=method');
    expect(takeReturn()).toEqual({ ...DRAFT, method: 'MAIL_IN' });
    expect(byText(section(c), 'button', 'Thu kèm đơn mua')).not.toBeNull();
  });
  it('khoá đường kho, cờ tắt hoặc lần sửa món → khối không có nút nào', async () => {
    state.me = makeWasteMe({ shipLockedAt: '2026-10-01T00:00:00.000Z' });
    let c = await mount();
    expect(section(c).querySelectorAll('button')).toHaveLength(0);
    state.me = makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: false } });
    state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: false, pickup: true } };
    c = await mount();
    expect(section(c).querySelectorAll('button')).toHaveLength(0);
    state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
    state.me = makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true } });
    seedNav('/doi-rac/yeu-cau/req-1/sua');
    c = await mount();
    expect(section(c).querySelectorAll('button')).toHaveLength(0);
  });
  it('một h1, mọi điều khiển có tên, nút quay lại trỏ về trang gọi', async () => {
    const c = await mount();
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(c.querySelector('a[aria-label="Quay lại"]')?.getAttribute('href')).toBe('/doi-rac/tao?step=method');
  });
});
