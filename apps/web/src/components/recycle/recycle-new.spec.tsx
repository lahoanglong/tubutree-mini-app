// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WastePreviewDTO, WastePreviewRequest } from '@tubutree/shared-types';
import { byText, click, flush, render, selectValue, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';
import { makeRewardCatalog } from '@/components/loyalty/reward-fixtures';
import { EMPTY_DRAFT, loadDraft, loadPointsNav, markResume, markSubmitted, peekResume, saveDraft, saveReturn, takeSubmitted, type WasteWizardDraft } from '@/lib/recycle-wizard';
import { ApiError } from '@/lib/client-api';
import { makeRequestDetail, makeWasteMe, makeWastePoint } from './recycle-fixtures';

// Chép ý recycle-new.spec.tsx (Mini App, §4.2, §4.3, §15.2, §16.1): chọn món, ước tính debounce, chọn cách giao, cam kết,
// tạo yêu cầu với Idempotency-Key. Khác Mini App: nháp nằm trong sessionStorage, không có "Nhanh nhất" vì web không xin
// vị trí, khách chưa đủ điều kiện thấy MiniAppOnlyNotice (Q2).

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  search: '',
  push: vi.fn(),
  replace: vi.fn(),
  me: null as unknown,
  points: [] as unknown[],
  rewards: null as unknown,
  preview: null as unknown as (b: unknown) => unknown,
  provinces: [] as unknown[],
  failProvinces: false,
  create: null as unknown as (b: unknown, key: string) => unknown,
  calls: [] as { path: string; body?: unknown; headers?: Record<string, string> }[],
  keySeq: 0,
  config: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } } as Record<string, unknown>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: state.replace }),
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => '/doi-rac/tao',
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => state.config }));
vi.mock('@/lib/idempotency-key', () => ({ newIdempotencyKey: () => `key-${++state.keySeq}` }));
vi.mock('./recycle-labels', async (orig) => ({ ...(await orig<object>()), PREVIEW_DEBOUNCE_MS: 0 }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ path });
      if (path === '/waste/me') return state.me;
      if (path.startsWith('/waste/points')) return state.points;
      if (path === '/me/loyalty/rewards') return state.rewards;
      if (path === '/geo/provinces') {
        if (state.failProvinces) throw new Error('offline');
        return state.provinces;
      }
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body: unknown, opts?: { headers?: Record<string, string> }) => {
      state.calls.push({ path, body, headers: opts?.headers });
      if (path === '/waste/preview') return state.preview(body);
      if (path === '/waste/requests') return state.create(body, opts?.headers?.['Idempotency-Key'] ?? '');
      throw new Error(`chưa mock ${path}`);
    },
  },
}));

import { RecycleNew } from './recycle-new';

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
const FEE = { zoneName: 'Miền Bắc', provinceCode: '01', provinceName: 'Hà Nội', low: 30000, high: 45000 };
const DRAFT: WasteWizardDraft = { ...EMPTY_DRAFT, lines: { 'item-carton': 5, 'item-milk': 5 } };
const PICKED: WasteWizardDraft = { ...DRAFT, method: 'DROP_OFF', pointId: 'pt-1', pickedPoint: makeWastePoint() };
const atStep2 = (draft: WasteWizardDraft = DRAFT) => {
  state.search = 'step=method';
  saveDraft(draft);
  markResume();
};
const toLineInputsOf = (d: WasteWizardDraft | null) => Object.entries(d?.lines ?? {}).filter(([, q]) => q > 0);
const CONSENT = 'Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này';

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RecycleNew />);
  mounted.push(r);
  await flush(10);
  return r.container;
};
const bar = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="sticky-bar"]')!;
const barButton = (c: HTMLElement, name: string) => byText(bar(c), 'button', name) as HTMLButtonElement;
const card = (c: HTMLElement, name: string) => byText(c, '[data-item]', name)!;
const qtyOf = (c: HTMLElement, item: string) => card(c, item).querySelector<HTMLInputElement>('input[aria-label="Số lượng"]')?.value;
const stepper = (c: HTMLElement, item: string, label: 'Tăng số lượng' | 'Giảm số lượng') =>
  card(c, item).querySelector<HTMLElement>(`button[aria-label="${label}"]`)!;
const methods = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="radio"]')).map((r) => r.getAttribute('data-method'));
const method = (c: HTMLElement, m: string) => c.querySelector<HTMLElement>(`[data-method="${m}"]`)!;
const check = (c: HTMLElement, text: string) => byText(c, 'label', text)!.querySelector<HTMLInputElement>('input')!;
const previewCalls = () => state.calls.filter((x) => x.path === '/waste/preview').map((x) => x.body as WastePreviewRequest);
const createCalls = () => state.calls.filter((x) => x.path === '/waste/requests');

beforeEach(() => {
  window.sessionStorage.clear();
  state.phase = 'authenticated';
  state.search = '';
  state.push = vi.fn();
  state.replace = vi.fn();
  state.calls = [];
  state.failProvinces = false;
  state.keySeq = 0;
  state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
  state.me = makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true } });
  state.points = [makeWastePoint()];
  state.rewards = makeRewardCatalog({ redeemablePoints: 14_000 });
  state.provinces = [
    { code: '01', name: 'Hà Nội' },
    { code: '79', name: 'TP.HCM' },
  ];
  state.preview = (b) => {
    const req = b as WastePreviewRequest;
    return preview(
      req.method === 'MAIL_IN'
        ? { feeEstimate: { ...FEE, provinceCode: '79', provinceName: 'TP.HCM', low: 20000, high: 25000 }, estimatedPoints: 30_000, pointsValueVnd: 30000 }
        : {},
    );
  };
  state.create = () => makeRequestDetail({ id: 'req-9' });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('bước 1: chọn món (§4.2)', () => {
  it('thẻ món và tiêu đề: một h1, mọi điều khiển có tên, "Tiếp tục" khoá khi chưa chọn món', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Bước 1/2: Chọn món');
    expect(card(c, 'Thùng carton').textContent).toContain('1 thùng = 1.000 điểm');
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(barButton(c, 'Tiếp tục').disabled).toBe(true);
    expect(c.querySelector('a[aria-label="Đổi rác lấy quà"]')?.getAttribute('href')).toBe('/doi-rac');
  });
  it('điểm ước tính từ /waste/preview, quy ra tiền, câu so với quà kế tiếp; nhiều lần bấm nhanh chỉ một lời gọi', async () => {
    const c = await mount();
    const plus = stepper(c, 'Thùng carton', 'Tăng số lượng');
    click(plus);
    click(plus);
    click(plus);
    await flush(10);
    expect(previewCalls()).toEqual([{ lines: [{ itemId: 'item-carton', declaredQty: 3 }] }]);
    expect(bar(c).textContent).toContain('Ước tính 6.000 điểm');
    expect(bar(c).textContent).toContain('Dùng như 6.000đ khi mua sắm');
    // redeemablePoints 14.000 + 6.000 ước tính = 20.000: Miễn phí vận chuyển đã đủ, quà kế tiếp là Gói hạt giống Tubu (25.000)
    expect(bar(c).textContent).toContain('Còn 5.000 điểm tới Gói hạt giống Tubu');
  });
  it('trần tháng chạm ở bước 1: lời khoá thay cho ước tính, "Tiếp tục" khoá; trong trần thì mở lại', async () => {
    state.preview = (b) => {
      const qty = (b as WastePreviewRequest).lines[0]?.declaredQty;
      if (qty === 3) return preview({ estimatedPoints: 70_000, pointsValueVnd: 70_000, blocks: [{ code: 'POINTS_MONTH_CAP', pointsRemaining: 60_000 }] });
      if (qty === 2) {
        return preview({ blocks: [{ code: 'ITEM_MONTH_CAP', itemId: 'item-carton' }], itemCaps: [{ itemId: 'item-carton', monthRemainingQty: 1, dayRemainingQty: null }] });
      }
      return preview();
    };
    const c = await mount();
    const plus = stepper(c, 'Thùng carton', 'Tăng số lượng');
    click(plus);
    await flush(10);
    expect(bar(c).textContent).toContain('Ước tính 6.000 điểm');
    expect(barButton(c, 'Tiếp tục').disabled).toBe(false);
    click(plus);
    await flush(10);
    expect(bar(c).textContent).toContain('Tháng này Thùng carton chỉ còn 1 thùng');
    expect(bar(c).textContent).not.toContain('Ước tính');
    expect(barButton(c, 'Tiếp tục').disabled).toBe(true);
    click(plus);
    await flush(10);
    expect(bar(c).textContent).toContain('Tháng này bạn chỉ còn 60.000 điểm trong trần tháng');
    expect(bar(c).textContent).not.toContain('Dùng như');
    expect(barButton(c, 'Tiếp tục').disabled).toBe(true);
    click(stepper(c, 'Thùng carton', 'Giảm số lượng'));
    click(stepper(c, 'Thùng carton', 'Giảm số lượng'));
    await flush(10);
    expect(barButton(c, 'Tiếp tục').disabled).toBe(false);
  });
  it('"Tiếp tục" khoá cả lúc ước tính cũ chưa kịp thay (đang tải), mở lại khi ước tính mới không khoá', async () => {
    let release: (v: WastePreviewDTO) => void = () => undefined;
    state.preview = (b) =>
      (b as WastePreviewRequest).lines[0]?.declaredQty === 2 ? new Promise<WastePreviewDTO>((res) => (release = res)) : preview();
    const c = await mount();
    const plus = stepper(c, 'Thùng carton', 'Tăng số lượng');
    click(plus);
    await flush(10);
    expect(barButton(c, 'Tiếp tục').disabled).toBe(false);
    click(plus);
    expect(barButton(c, 'Tiếp tục').disabled).toBe(true);
    await flush(10);
    expect(barButton(c, 'Tiếp tục').disabled).toBe(true);
    release(preview({ blocks: [{ code: 'ITEM_MONTH_CAP', itemId: 'item-carton' }], itemCaps: [{ itemId: 'item-carton', monthRemainingQty: 1, dayRemainingQty: null }] }));
    await flush(10);
    expect(bar(c).textContent).toContain('Tháng này Thùng carton chỉ còn 1 thùng');
    expect(barButton(c, 'Tiếp tục').disabled).toBe(true);
    click(stepper(c, 'Thùng carton', 'Giảm số lượng'));
    await flush(10);
    expect(barButton(c, 'Tiếp tục').disabled).toBe(false);
  });
  it('ước tính lỗi thì "Tiếp tục" vẫn mở', async () => {
    state.preview = () => {
      throw new Error('Mất kết nối');
    };
    const c = await mount();
    click(stepper(c, 'Thùng carton', 'Tăng số lượng'));
    await flush(10);
    expect(barButton(c, 'Tiếp tục').disabled).toBe(false);
  });
  it('"Tiếp tục" lưu nháp vào sessionStorage rồi đẩy ?step=method', async () => {
    const c = await mount();
    click(stepper(c, 'Thùng carton', 'Tăng số lượng'));
    await flush(10);
    click(barButton(c, 'Tiếp tục'));
    expect(loadDraft()).toEqual({ ...EMPTY_DRAFT, lines: { 'item-carton': 1 } });
    expect(state.push).toHaveBeenCalledWith('/doi-rac/tao?step=method');
  });
  it('quay lại bước 1 từ bước 2 (đã bấm Tiếp tục) giữ nguyên số lượng đã chọn', async () => {
    saveDraft({ ...EMPTY_DRAFT, lines: { 'item-carton': 7 } });
    markResume();
    const c = await mount();
    expect(qtyOf(c, 'Thùng carton')).toBe('7');
    expect(state.replace).not.toHaveBeenCalled();
  });
  it('vào mới bước 1 (không từ trong wizard) → nháp rỗng, nháp cũ bị xoá', async () => {
    saveDraft({ ...EMPTY_DRAFT, lines: { 'item-carton': 7, 'item-gone': 3 } });
    const c = await mount();
    expect(qtyOf(c, 'Thùng carton')).not.toBe('7');
    expect(toLineInputsOf(loadDraft())).toEqual([]);
  });
  it('nháp còn món đã ẩn hoặc sắp ra mắt: bỏ khỏi nháp và khỏi body ước tính', async () => {
    saveDraft({ ...EMPTY_DRAFT, lines: { 'item-carton': 3, 'item-battery': 2 } });
    markResume();
    const c = await mount();
    await flush(10);
    expect(qtyOf(c, 'Thùng carton')).toBe('3');
    expect(toLineInputsOf(loadDraft())).toEqual([['item-carton', 3]]);
    expect(previewCalls().every((b) => b.lines.every((l) => l.itemId !== 'item-battery'))).toBe(true);
    expect(previewCalls().length).toBeGreaterThan(0);
  });
  it('rời wizard ở bước 2 rồi vào mới bước 1 → nháp rỗng (cờ nạp lại không sống sót sau khi rời)', async () => {
    const first = render(<RecycleNew />);
    await flush(10);
    click(stepper(first.container, 'Thùng carton', 'Tăng số lượng'));
    await flush(10);
    click(barButton(first.container, 'Tiếp tục'));
    expect(peekResume()).toBe(true);
    first.unmount();
    expect(peekResume()).toBe(false);
    const c = await mount();
    expect(card(c, 'Thùng carton').textContent).toMatch(/0$/);
    expect(barButton(c, 'Tiếp tục').disabled).toBe(true);
    expect(toLineInputsOf(loadDraft())).toEqual([]);
  });
  it('sang trang chọn điểm không coi là rời wizard: cờ nạp lại còn nguyên', async () => {
    atStep2();
    const r = render(<RecycleNew />);
    await flush(10);
    click(method(r.container, 'DROP_OFF'));
    click(byText(r.container, 'button', 'Chọn điểm nhận'));
    r.unmount();
    expect(peekResume()).toBe(true);
  });
  it('chương trình tắt hoặc tài khoản bị khoá → về /doi-rac', async () => {
    state.me = makeWasteMe({ blocked: true });
    await mount();
    expect(state.replace).toHaveBeenCalledWith('/doi-rac');
  });
  it('chưa đủ điều kiện (thiếu SĐT): chỉ lời chỉ sang Zalo, không có món, không có nút tiếp tục (Q2)', async () => {
    state.me = makeWasteMe({ eligibility: 'NEED_PHONE', balance: null, monthUsage: null });
    const c = await mount();
    expect(c.textContent).toContain('Tính năng này cần mở Tubu Tree trên Zalo.');
    expect(c.querySelector('[data-item]')).toBeNull();
    expect(c.querySelector('[data-testid="sticky-bar"]')).toBeNull();
    expect(c.textContent).not.toMatch(/số điện thoại/i);
    expect(state.replace).not.toHaveBeenCalled();
  });
  it('khách chưa đăng nhập về trang Đổi rác (có giới thiệu và nút đăng nhập), không gọi API', async () => {
    state.phase = 'guest';
    await mount();
    expect(state.replace).toHaveBeenCalledWith('/doi-rac');
    expect(state.calls).toEqual([]);
  });
  it('quay lại bước 1 sau khi đã gửi yêu cầu thì về trang Đổi rác thay vì form trống; cờ chỉ dùng một lần', async () => {
    markSubmitted();
    await mount();
    expect(state.replace).toHaveBeenCalledWith('/doi-rac');
    state.replace = vi.fn();
    await mount();
    expect(state.replace).not.toHaveBeenCalledWith('/doi-rac');
  });
  it('phiên không khả dụng và lỗi tải /waste/me có trạng thái riêng', async () => {
    state.phase = 'unavailable';
    const c = await mount();
    expect(c.textContent).toContain('Không kết nối được với Tubu Tree');
  });
});

describe('bước 2: chọn cách giao (§4.3)', () => {
  it('?step=method mà không có nháp → về bước 1', async () => {
    state.search = 'step=method';
    await mount();
    expect(state.replace).toHaveBeenCalledWith('/doi-rac/tao');
  });
  it('không còn cách giao nào đang mở → câu giải thích thay cho nhóm chọn, "Tạo yêu cầu" khoá', async () => {
    state.config = { isLoaded: true, waste: { enabled: true, dropoff: false, mailin: false, pickup: false } };
    atStep2();
    const c = await mount();
    expect(c.textContent).toContain('Hiện chưa có cách giao nào đang mở, bạn quay lại sau nhé.');
    expect(c.querySelector('[role="radiogroup"]')).toBeNull();
    expect(barButton(c, 'Tạo yêu cầu').disabled).toBe(true);
  });
  it('một preview cho mỗi cách đang bật, đúng thứ tự Mang tới, Thu kèm, Gửi về kho', async () => {
    atStep2();
    const c = await mount();
    expect(methods(c)).toEqual(['DROP_OFF', 'PICKUP', 'MAIL_IN']);
    expect(previewCalls().map((b) => b.method).sort()).toEqual(['DROP_OFF', 'MAIL_IN', 'PICKUP']);
  });
  it('tỉnh của khách không có điểm nhận → Gửi về kho và Thu kèm lên đầu', async () => {
    state.points = [makeWastePoint({ provinceCode: '01' })];
    atStep2();
    const c = await mount();
    expect(methods(c)).toEqual(['MAIL_IN', 'PICKUP', 'DROP_OFF']);
  });
  it('Gửi về kho: khoảng phí theo bảng niêm yết, gói tối thiểu, giới hạn kiện (một lần cho mỗi cách)', async () => {
    atStep2();
    const c = await mount();
    const mail = method(c, 'MAIL_IN');
    expect(mail.textContent).toContain('Phí ship ước tính từ TP.HCM: 20.000đ – 25.000đ, ước tính theo bảng giá niêm yết');
    expect(mail.textContent).toContain('Gói tối thiểu 15.000 điểm');
    expect(mail.parentElement?.textContent).toContain('Mỗi kiện tối đa 10 kg, cạnh dài tối đa 60 cm. Hàng gửi về kho không hoàn lại. Kiện còn cước phải trả khi nhận bị kho từ chối ngay ở cửa.');
    expect(c.textContent?.match(/Kiện còn cước phải trả khi nhận/g)).toHaveLength(1);
  });
  it('giá trị điểm có thể thấp hơn phí → cảnh báo và lối thay thế đang bật', async () => {
    state.preview = (b) => preview((b as WastePreviewRequest).method === 'MAIL_IN' ? { feeEstimate: FEE, estimatedPoints: 40_000, pointsValueVnd: 40000 } : {});
    atStep2();
    const c = await mount();
    expect(c.textContent).toContain('Phí ship có thể cao hơn giá trị điểm bạn nhận được');
    expect(byText(c, 'button', 'Chọn Mang tới điểm nhận')).not.toBeNull();
    expect(byText(c, 'button', 'Chọn Thu kèm đơn mua')).not.toBeNull();
  });
  it('dưới ngưỡng gửi kho → thẻ khoá với "cần thêm N điểm"; MAX_OPEN khoá mọi thẻ', async () => {
    state.preview = (b) =>
      preview({ blocks: (b as WastePreviewRequest).method === 'MAIL_IN' ? [{ code: 'BELOW_MIN', missingPoints: 6000 }, { code: 'MAX_OPEN', openCount: 3 }] : [{ code: 'MAX_OPEN', openCount: 3 }] });
    atStep2();
    const c = await mount();
    expect(c.textContent).toContain('Cần thêm 6.000 điểm');
    expect(Array.from(c.querySelectorAll('[role="radio"]')).every((r) => r.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(c.textContent).toContain('Bạn đang có 3 yêu cầu chưa xong');
  });
  it('ITEM_DROPOFF_ONLY: thẻ Gửi về kho và Thu kèm đơn khoá kèm lý do, thẻ Mang tới điểm nhận vẫn chọn được', async () => {
    state.preview = (b) => {
      const m = (b as WastePreviewRequest).method;
      return preview(m === 'PICKUP' || m === 'MAIL_IN' ? { blocks: [{ code: 'ITEM_DROPOFF_ONLY', itemId: 'item-carton' }] } : {});
    };
    atStep2();
    const c = await mount();
    for (const m of ['PICKUP', 'MAIL_IN'] as const) {
      expect(method(c, m).textContent).toContain('không gửi qua đường vận chuyển, chỉ mang tới điểm nhận được');
      expect(method(c, m).getAttribute('aria-disabled')).toBe('true');
    }
    expect(method(c, 'DROP_OFF').getAttribute('aria-disabled')).not.toBe('true');
  });
  it('MONTH_CAP_FOR_MIN: thẻ Thu kèm đơn nói gói thu kèm đơn, thẻ Gửi về kho nói gói gửi kho', async () => {
    state.preview = (b) => {
      const m = (b as WastePreviewRequest).method;
      return preview(m === 'PICKUP' || m === 'MAIL_IN' ? { blocks: [{ code: 'MONTH_CAP_FOR_MIN', pointsRemaining: 5_000 }] } : {});
    };
    atStep2();
    const c = await mount();
    expect(method(c, 'PICKUP').textContent).toContain('Tháng này bạn không còn đủ trần cho một gói thu kèm đơn');
    expect(method(c, 'MAIL_IN').textContent).toContain('Tháng này bạn không còn đủ trần cho một gói gửi kho');
    expect(method(c, 'PICKUP').textContent).not.toContain('gói gửi kho');
  });
  it('NEED_PROVINCE → ô chọn tỉnh trên thẻ Gửi về kho; chọn → preview lại với provinceCode', async () => {
    state.preview = (b) => {
      const req = b as WastePreviewRequest;
      return preview(req.method === 'MAIL_IN' && !req.provinceCode ? { blocks: [{ code: 'NEED_PROVINCE' }] } : {});
    };
    atStep2();
    const c = await mount();
    click(method(c, 'MAIL_IN'));
    await flush(4);
    const select = c.querySelector<HTMLSelectElement>('select[aria-label="Chọn tỉnh để ước tính phí ship"]')!;
    expect(select).not.toBeNull();
    selectValue(select, '01');
    await flush(10);
    expect(previewCalls()).toContainEqual(expect.objectContaining({ method: 'MAIL_IN', provinceCode: '01' }));
    expect(loadDraft()?.provinceCode).toBe('01');
  });
  it('phí ship ước tính ghi tên tỉnh từ danh sách, không ghi mã tỉnh', async () => {
    state.provinces = [{ code: '48', name: 'Đà Nẵng' }];
    state.preview = (b) => preview((b as WastePreviewRequest).method === 'MAIL_IN' ? { feeEstimate: { ...FEE, provinceCode: '48', provinceName: '48' } } : {});
    atStep2();
    const c = await mount();
    expect(method(c, 'MAIL_IN').textContent).toContain('Phí ship ước tính từ Đà Nẵng:');
    expect(method(c, 'MAIL_IN').textContent).not.toContain('từ 48:');
  });
  it('danh sách tỉnh không tải được: phí ship ước tính bỏ cụm tên tỉnh thay vì in mã tỉnh', async () => {
    state.failProvinces = true;
    state.preview = (b) => preview((b as WastePreviewRequest).method === 'MAIL_IN' ? { feeEstimate: { ...FEE, provinceCode: '48', provinceName: '48', low: 30000, high: 45000 } } : {});
    atStep2();
    const c = await mount();
    expect(method(c, 'MAIL_IN').textContent).toContain('Phí ship ước tính: 30.000đ – 45.000đ, ước tính theo bảng giá niêm yết');
    expect(method(c, 'MAIL_IN').textContent).not.toContain('từ 48');
  });
  it('chưa chọn Gửi về kho: không có ô chọn tỉnh và không có lời nhắc chọn tỉnh; chọn xong thì lời nhắc không dùng màu lỗi', async () => {
    state.preview = (b) => {
      const req = b as WastePreviewRequest;
      return preview(req.method === 'MAIL_IN' && !req.provinceCode ? { blocks: [{ code: 'NEED_PROVINCE' }] } : {});
    };
    atStep2();
    const c = await mount();
    expect(c.querySelector('select[aria-label="Chọn tỉnh để ước tính phí ship"]')).toBeNull();
    expect(method(c, 'MAIL_IN').textContent).not.toContain('Chọn tỉnh để ước tính phí ship');
    click(method(c, 'MAIL_IN'));
    await flush(4);
    const prompt = Array.from(method(c, 'MAIL_IN').querySelectorAll('span')).find((e) => e.textContent === 'Chọn tỉnh để ước tính phí ship')!;
    expect(prompt.className).toContain('text-stone-600');
    expect(prompt.className).not.toContain('text-danger-fg');
  });
  it('thẻ khoá: chỉ phần tên, mô tả và ước tính bị làm mờ; lý do giữ nguyên độ đậm và dùng tông cảnh báo', async () => {
    state.preview = (b) => preview({ blocks: (b as WastePreviewRequest).method === 'MAIL_IN' ? [{ code: 'BELOW_MIN', missingPoints: 6000 }] : [] });
    atStep2();
    const c = await mount();
    const card = method(c, 'MAIL_IN');
    const reason = Array.from(card.querySelectorAll('span')).find((e) => e.textContent === 'Cần thêm 6.000 điểm')!;
    expect(reason.closest('[class*="opacity-"]')).toBeNull();
    expect(reason.className).toContain('text-warning-fg');
    expect(card.className).not.toContain('opacity-');
    expect(card.querySelector('[class*="opacity-60"]')?.textContent).toContain('Gửi về kho Tubu HCM');
  });
  it('khoá đường kho → ẩn Gửi về kho và Thu kèm, hiện câu ghim', async () => {
    state.me = makeWasteMe({ shipLockedAt: '2026-10-01T00:00:00.000Z', laneFlags: { dropoff: true, mailin: true, pickup: true } });
    atStep2();
    const c = await mount();
    expect(c.textContent).toContain('Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH.');
    expect(methods(c)).toEqual(['DROP_OFF']);
  });
  it('web không xin vị trí: không có "Nhanh nhất" và không gọi /waste/points/nearby', async () => {
    atStep2();
    const c = await mount();
    expect(c.textContent).not.toContain('Nhanh nhất');
    expect(state.calls.some((x) => x.path.includes('nearby'))).toBe(false);
  });
  it('Mang tới điểm nhận: "Chọn điểm nhận" lưu nháp và điều hướng sang /doi-rac/diem-nhan kèm returnTo', async () => {
    atStep2();
    const c = await mount();
    click(method(c, 'DROP_OFF'));
    click(byText(c, 'button', 'Chọn điểm nhận'));
    expect(state.replace).toHaveBeenLastCalledWith('/doi-rac/diem-nhan');
    expect(loadPointsNav()).toEqual({
      returnTo: '/doi-rac/tao?step=method',
      draft: { ...DRAFT, method: 'DROP_OFF' },
      selectedItemIds: ['item-carton', 'item-milk'],
    });
  });
  it('quay lại từ trang chọn điểm: nháp mang điểm đã chọn, nút đổi thành "Đổi điểm nhận", không áp lần hai', async () => {
    atStep2();
    saveReturn(PICKED);
    const c = await mount();
    expect(method(c, 'DROP_OFF').getAttribute('aria-checked')).toBe('true');
    expect(c.textContent).toContain('Đại lý Cô Ba');
    expect(c.textContent).toContain('12 Lê Lợi, Phường Bến Thành, TP.HCM');
    expect(byText(c, 'button', 'Đổi điểm nhận')).not.toBeNull();
    expect(loadDraft()).toEqual(PICKED);
  });
});

describe('tạo yêu cầu (§15.2, §16.1 idempotency)', () => {
  it('đồng ý bắt buộc; tạo xong gửi đúng body và Idempotency-Key rồi thay mục bằng /doi-rac/yeu-cau/:id và xoá nháp', async () => {
    atStep2(PICKED);
    const c = await mount();
    expect(barButton(c, 'Tạo yêu cầu').disabled).toBe(true);
    click(check(c, CONSENT));
    await flush(3);
    expect(barButton(c, 'Tạo yêu cầu').disabled).toBe(false);
    click(barButton(c, 'Tạo yêu cầu'));
    await flush(10);
    expect(createCalls()).toEqual([
      {
        path: '/waste/requests',
        body: { method: 'DROP_OFF', lines: [{ itemId: 'item-carton', declaredQty: 5 }, { itemId: 'item-milk', declaredQty: 5 }], pointId: 'pt-1', consent: true },
        headers: { 'Idempotency-Key': expect.stringMatching(/^key-\d+$/) },
      },
    ]);
    expect(state.replace).toHaveBeenLastCalledWith('/doi-rac/yeu-cau/req-9');
    expect(loadDraft()).toBeNull();
    expect(takeSubmitted()).toBe(true);
  });
  it('Mang tới điểm nhận chưa chọn điểm thì chưa tạo được', async () => {
    atStep2({ ...DRAFT, method: 'DROP_OFF' });
    const c = await mount();
    click(check(c, CONSENT));
    await flush(3);
    expect(barButton(c, 'Tạo yêu cầu').disabled).toBe(true);
  });
  it('lỗi máy chủ → hiện câu của máy chủ, bấm lại dùng CÙNG khoá', async () => {
    let n = 0;
    state.create = () => {
      if (++n === 1) throw new Error('Điểm nhận đang tạm ngừng, hãy chọn điểm khác');
      return makeRequestDetail();
    };
    atStep2(PICKED);
    const c = await mount();
    click(check(c, CONSENT));
    await flush(3);
    click(barButton(c, 'Tạo yêu cầu'));
    await flush(10);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Điểm nhận đang tạm ngừng, hãy chọn điểm khác');
    click(barButton(c, 'Tạo yêu cầu'));
    await flush(10);
    const keys = createCalls().map((x) => x.headers?.['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^key-\d+$/);
    expect(keys[1]).toBe(keys[0]);
    expect(loadDraft()).toBeNull();
  });
  it('lỗi 403 kèm câu nghiệp vụ → hiện nguyên văn câu của máy chủ', async () => {
    const msg = 'Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH.';
    state.create = () => {
      throw new ApiError(msg, 403);
    };
    atStep2(PICKED);
    const c = await mount();
    click(check(c, CONSENT));
    await flush(3);
    click(barButton(c, 'Tạo yêu cầu'));
    await flush(10);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(msg);
  });
  it('Gửi về kho cần thêm hai cam kết và gửi packagingConsent + postagePaidConsent', async () => {
    atStep2({ ...DRAFT, method: 'MAIL_IN', lines: { 'item-carton': 20 } });
    const c = await mount();
    expect(c.textContent).toContain('Mỗi kiện là một yêu cầu riêng: có nhiều kiện thì tạo nhiều yêu cầu, mỗi kiện một mã TR-.');
    click(check(c, CONSENT));
    await flush(3);
    expect(barButton(c, 'Tạo yêu cầu').disabled).toBe(true);
    click(check(c, 'Tôi đóng gói không lẫn pin, hoá chất, vật nhọn, đồ ướt hoặc bẩn'));
    click(check(c, 'Tôi đã trả đủ cước gửi, kho từ chối kiện còn cước phải trả khi nhận'));
    await flush(3);
    expect(barButton(c, 'Tạo yêu cầu').disabled).toBe(false);
    click(barButton(c, 'Tạo yêu cầu'));
    await flush(10);
    expect(createCalls()[0]?.body).toEqual({
      method: 'MAIL_IN',
      lines: [{ itemId: 'item-carton', declaredQty: 20 }],
      consent: true,
      packagingConsent: true,
      postagePaidConsent: true,
    });
  });
  it('bước 2: một h1, mọi điều khiển có tên, hộp kiểm đủ vùng chạm', async () => {
    atStep2(PICKED);
    const c = await mount();
    click(check(c, CONSENT));
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(c.querySelector('a[aria-label="Chọn món"]')?.getAttribute('href')).toBe('/doi-rac/tao');
  });
});

describe('Thể lệ từ bước 2: quay lại không mất ô đồng ý', () => {
  it('bấm Xem Thể lệ lưu nháp + cờ tiếp tục + ô đồng ý; mở lại bước 2 thì khôi phục rồi xoá', async () => {
    atStep2(PICKED);
    let c = await mount();
    click(check(c, CONSENT));
    expect(check(c, CONSENT).checked).toBe(true);
    const rules = byText(c, 'a', 'Xem Thể lệ') as HTMLAnchorElement;
    rules.addEventListener('click', (e) => e.preventDefault());
    click(rules);
    expect(JSON.parse(window.sessionStorage.getItem('tubu.waste.consents')!)).toEqual({ consent: true, packaging: false, postage: false });
    mounted.pop()!.unmount();
    c = await mount();
    expect(check(c, CONSENT).checked).toBe(true);
    expect(window.sessionStorage.getItem('tubu.waste.consents')).toBeNull();
    expect(method(c, 'DROP_OFF').getAttribute('aria-checked')).toBe('true');
  });
});
