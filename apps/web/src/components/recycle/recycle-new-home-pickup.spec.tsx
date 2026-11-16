// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WasteMeDTO, WastePickupQuoteResponse } from '@tubutree/shared-types';
import { HOME_PICKUP_BATTERY_TEXT } from '@tubutree/app-core/waste-copy';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { EMPTY_DRAFT, loadDraft, markResume, saveDraft, type WasteWizardDraft } from '@/lib/recycle-wizard';
import { ApiError } from '@/lib/client-api';
import { ITEM_BATTERY, ITEM_CARTON, ITEM_MILK, makeRequestDetail, makeWasteItem, makeWasteMe, makeWastePoint } from './recycle-fixtures';
import { makeAddress, makeQuote } from './recycle-home-pickup-fixtures';

// Cùng ý với recycle-new-home-pickup.spec.tsx của Mini App: thẻ thứ tư ở bước 2, báo phí, Pin cũ ngoài TP.HCM, tạo đơn kèm Idempotency-Key.

const state = vi.hoisted(() => ({
  search: '',
  push: vi.fn(),
  replace: vi.fn(),
  me: null as unknown as WasteMeDTO,
  addresses: [] as unknown[],
  addressesFail: false,
  quote: null as unknown as (b: unknown) => unknown,
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
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { id: 'u1' } }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => state.config }));
vi.mock('@/lib/idempotency-key', () => ({ newIdempotencyKey: () => `key-${++state.keySeq}` }));
vi.mock('@/lib/use-debounced', () => ({ useDebounced: <T,>(v: T) => v }));
vi.mock('./recycle-labels', async (orig) => ({ ...(await orig<object>()), PREVIEW_DEBOUNCE_MS: 0 }));
vi.mock('@/lib/shop-client', async (orig) => ({
  ...(await orig<object>()),
  getAddresses: async () => {
    if (state.addressesFail) throw new Error('mất mạng');
    return state.addresses;
  },
  createAddress: async () => state.addresses[0],
  updateAddress: async () => state.addresses[0],
}));
vi.mock('@/components/address-form', () => ({
  AddressForm: ({ title, onCancel }: { title: string; onCancel: () => void }) => (
    <div data-testid="address-form" data-title={title}>
      <button type="button" onClick={onCancel}>Đóng form</button>
    </div>
  ),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ path });
      if (path === '/waste/me') return state.me;
      if (path.startsWith('/waste/points')) return [makeWastePoint()];
      if (path === '/me/loyalty/rewards') return null;
      if (path === '/waste/rules') return { text: 'Thể lệ', version: 'v1' };
      if (path === '/geo/provinces') return [];
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body: unknown, opts?: { headers?: Record<string, string> }) => {
      state.calls.push({ path, body, headers: opts?.headers });
      if (path === '/waste/preview') return { estimatedPoints: 6000, estimatedDrops: 0, estimatedGrams: null, pointsValueVnd: 6000, blocks: [], feeEstimate: null, itemCaps: [], pointsMonthRemaining: 190_000 };
      if (path === '/waste/pickup-quote') return state.quote(body);
      if (path === '/waste/requests') return state.create(body, opts?.headers?.['Idempotency-Key'] ?? '');
      throw new Error(`chưa mock ${path}`);
    },
  },
}));

import { RecycleNew } from './recycle-new';

const SHORT_SENTENCE = 'Phí shipper lấy rác cần trả bằng Điểm Xanh, bạn còn thiếu 15.000 điểm. Hãy chọn mang tới điểm thu gom hoặc đổi rác kèm đơn mua nhé';
const FEE_UNAVAILABLE = 'Chưa báo được phí shipper lúc này, bạn thử lại sau ít phút nhé';
const CONSENT = 'Tôi đồng ý với Thể lệ Đổi rác và để Tubu Tree xử lý yêu cầu này';
// 5 thùng × 300g + 5 vỏ × 100g = 2.000g → chip mặc định 2 kg.
const ITEMS = [makeWasteItem({ gramsPerUnit: 300 }), { ...ITEM_MILK, gramsPerUnit: 100 }, ITEM_BATTERY];
const LINES = { 'item-carton': 5, 'item-milk': 5 };
const DRAFT: WasteWizardDraft = { ...EMPTY_DRAFT, lines: LINES, method: 'HOME_PICKUP' };
const quoteBody = (over: object = {}) => ({ addressId: 'addr-1', declaredWeightGrams: 2000, lines: [{ itemId: 'item-carton', declaredQty: 5 }, { itemId: 'item-milk', declaredQty: 5 }], ...over });
const short = (over: Partial<WastePickupQuoteResponse> = {}) => makeQuote({ pointsAvailable: 10_000, pointsApplicable: 10_000, remainingFeeVnd: 15_000, blocked: SHORT_SENTENCE, ...over });

const atStep2 = (draft: WasteWizardDraft = DRAFT) => {
  state.search = 'step=method';
  saveDraft(draft);
  markResume();
};
let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RecycleNew />);
  mounted.push(r);
  await flush(12);
  return r.container;
};
const bar = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="sticky-bar"]')!;
const createBtn = (c: HTMLElement) => byText(bar(c), 'button', 'Tạo đơn thu gom') as HTMLButtonElement;
const check = (c: HTMLElement) => byText(c, 'label', CONSENT)!.querySelector<HTMLInputElement>('input')!;
const testid = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const quoteCalls = () => state.calls.filter((x) => x.path === '/waste/pickup-quote');
const createCalls = () => state.calls.filter((x) => x.path === '/waste/requests');
const kg = (c: HTMLElement, label: string) => Array.from(c.querySelectorAll<HTMLButtonElement>('[role="group"] button[aria-pressed]')).find((b) => b.textContent === label)!;

beforeEach(() => {
  window.sessionStorage.clear();
  state.search = '';
  state.push = vi.fn();
  state.replace = vi.fn();
  state.calls = [];
  state.keySeq = 0;
  state.addressesFail = false;
  state.addresses = [makeAddress()];
  state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
  state.me = makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true }, items: ITEMS });
  state.quote = () => makeQuote();
  state.create = () => makeRequestDetail({ id: 'req-9', method: 'HOME_PICKUP' });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('Shipper lấy tận nhà (web): thẻ cách giao ở bước 2', () => {
  it('thẻ thứ tư khi cổng thu gom mở; ẩn khi cổng tắt hay khách bị khoá đường vận chuyển; không gọi /waste/preview cho thẻ này', async () => {
    atStep2({ ...DRAFT, method: null });
    let c = await mount();
    expect(Array.from(c.querySelectorAll('[role="radio"]')).map((r) => r.getAttribute('data-method'))).toEqual(['DROP_OFF', 'PICKUP', 'MAIL_IN', 'HOME_PICKUP']);
    const previewed = state.calls.filter((x) => x.path === '/waste/preview').map((x) => (x.body as { method?: string }).method);
    expect(previewed).not.toContain('HOME_PICKUP');
    expect(state.calls.filter((x) => x.path === '/me/addresses')).toHaveLength(0);
    mounted.pop()!.unmount();

    state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: false } };
    c = await mount();
    expect(c.querySelector('[data-method="HOME_PICKUP"]')).toBeNull();
    mounted.pop()!.unmount();

    state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
    state.me = makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true }, items: ITEMS, shipLockedAt: '2026-10-01T00:00:00.000Z' });
    c = await mount();
    expect(c.querySelector('[data-method="HOME_PICKUP"]')).toBeNull();
  });
});

describe('Shipper lấy tận nhà (web): báo phí', () => {
  it('chọn thẻ: địa chỉ mặc định chọn sẵn, số kg theo ước lượng món, đúng một lần báo phí, 6 chip kg', async () => {
    atStep2();
    const c = await mount();
    expect(quoteCalls()).toHaveLength(1);
    expect(quoteCalls()[0]!.body).toEqual(quoteBody());
    expect(c.querySelector('[role="radio"][data-address="addr-1"]')?.getAttribute('aria-checked')).toBe('true');
    expect(kg(c, '2 kg').getAttribute('aria-pressed')).toBe('true');
    expect(Array.from(c.querySelectorAll('[role="group"] button[aria-pressed]')).map((b) => b.textContent)).toEqual(['0,5 kg', '1 kg', '2 kg', '3 kg', '5 kg', '10 kg']);
  });

  it('báo phí thật: phí, điểm dùng được và điểm sẽ trừ, không công tắc, không nhãn "Ước tính" cạnh phí', async () => {
    atStep2();
    const c = await mount();
    expect(testid(c, 'home-pickup-fee-value')?.textContent).toBe('25.000đ');
    expect(testid(c, 'home-pickup-pay')?.textContent).toBe('Điểm Xanh dùng được 40.000 · sẽ trừ 25.000 điểm');
    expect(testid(c, 'home-pickup-points')?.textContent).toBe('Ước tính 6.000 điểm');
    expect(c.querySelector('[role="switch"]')).toBeNull();
    expect(testid(c, 'home-pickup-fee')!.textContent).not.toContain('Ước tính 6.000 điểm Ước tính');
    expect(testid(c, 'home-pickup-notice')).toBeNull();
  });

  it('không còn chữ thu hộ / COD / tiền mặt / "khi bưu tá tới" trong thẻ thu gom', async () => {
    state.quote = () => short();
    atStep2();
    const c = await mount();
    expect(testid(c, 'home-pickup')!.textContent).not.toMatch(/thu hộ|COD|tiền mặt|khi bưu tá|khi shipper/i);
  });

  it('thiếu Điểm Xanh: đúng câu của máy chủ một lần, không trừ gì, nút Tạo đơn khoá dù đã tick đồng ý', async () => {
    state.quote = () => short();
    atStep2();
    const c = await mount();
    expect(testid(c, 'home-pickup-notice')?.textContent).toBe(SHORT_SENTENCE);
    expect(c.textContent!.split(SHORT_SENTENCE).length - 1).toBe(1);
    expect(testid(c, 'home-pickup-pay')?.textContent).toBe('Điểm Xanh dùng được 10.000');
    click(check(c));
    await flush(3);
    expect(createBtn(c).disabled).toBe(true);
    expect(createCalls()).toHaveLength(0);
  });

  it('phí ước lượng: nhãn "Ước tính" cạnh phí, câu chưa báo được phí, nút Tạo đơn khoá dù đã tick đồng ý', async () => {
    state.quote = () => makeQuote({ estimated: true });
    atStep2();
    const c = await mount();
    expect(byText(testid(c, 'home-pickup-fee')!, 'span', 'Ước tính')).not.toBeNull();
    expect(testid(c, 'home-pickup-notice')?.textContent).toBe(FEE_UNAVAILABLE);
    click(check(c));
    await flush(3);
    expect(createBtn(c).disabled).toBe(true);
  });

  it('đổi số kg: báo phí lại với số kg mới và giữ nút khoá tới khi phí mới về', async () => {
    atStep2();
    const c = await mount();
    let release: (q: WastePickupQuoteResponse) => void = () => {};
    state.quote = () => new Promise((r) => { release = r as typeof release; });
    click(kg(c, '5 kg'));
    await flush(3);
    expect(quoteCalls().at(-1)!.body).toEqual(quoteBody({ declaredWeightGrams: 5000 }));
    expect(c.textContent).toContain('Đang tính phí ship…');
    click(check(c));
    await flush(2);
    expect(createBtn(c).disabled).toBe(true);
    release(makeQuote({ shipFeeVnd: 35_000, pointsApplicable: 35_000 }));
    await flush(4);
    expect(testid(c, 'home-pickup-fee-value')?.textContent).toBe('35.000đ');
    expect(createBtn(c).disabled).toBe(false);
  });

  it('dưới ngưỡng điểm: "Dự kiến X / Y điểm", nút khoá, không lặp câu "cần tối thiểu" của máy chủ', async () => {
    state.quote = () => makeQuote({ estimatedPoints: 3000, minPoints: 5000, blocked: 'Đơn thu gom cần tối thiểu 5.000 điểm ước tính' });
    atStep2();
    const c = await mount();
    expect(testid(c, 'home-pickup-points')?.textContent).toBe('Dự kiến 3.000 / 5.000 điểm');
    expect(testid(c, 'home-pickup-notice')).toBeNull();
    click(check(c));
    await flush(3);
    expect(createBtn(c).disabled).toBe(true);
  });

  it('địa chỉ không giao được: lời của máy chủ cùng nút "Sửa địa chỉ này"', async () => {
    state.quote = () => makeQuote({ addressOk: false, addressMessage: 'Đơn vị vận chuyển chưa nhận diện được địa chỉ này' });
    atStep2();
    const c = await mount();
    expect(testid(c, 'home-pickup-notice')?.textContent).toBe('Đơn vị vận chuyển chưa nhận diện được địa chỉ này');
    click(byText(c, 'button', 'Sửa địa chỉ này'));
    await flush(2);
    expect(c.querySelector('[data-testid="address-form"]')?.getAttribute('data-title')).toBe('Sửa địa chỉ này');
    click(check(c));
    await flush(3);
    expect(createBtn(c).disabled).toBe(true);
  });

  it('báo phí 503 kèm câu của máy chủ: hiện đúng câu đó, nút khoá; Thử lại thành công thì mở', async () => {
    let n = 0;
    state.quote = () => {
      if (++n === 1) throw new ApiError(FEE_UNAVAILABLE, 503);
      return makeQuote();
    };
    atStep2();
    const c = await mount();
    expect(c.textContent).toContain(FEE_UNAVAILABLE);
    expect(c.textContent).not.toContain('Chưa tính được phí ship, bạn thử lại nhé');
    expect(createBtn(c).disabled).toBe(true);
    click(byText(testid(c, 'home-pickup-fee')!, 'button', 'Thử lại'));
    await flush(6);
    expect(testid(c, 'home-pickup-fee-value')?.textContent).toBe('25.000đ');
  });
});

describe('Shipper lấy tận nhà (web): Pin cũ ngoài TP.HCM', () => {
  const withBattery = (province: string) => {
    state.me = makeWasteMe({ laneFlags: { dropoff: true, mailin: true, pickup: true }, items: [ITEM_CARTON, ITEM_MILK, { ...ITEM_BATTERY, status: 'ACTIVE' }] });
    state.addresses = [makeAddress({ province })];
    atStep2({ ...DRAFT, lines: { ...LINES, 'item-battery': 2 } });
  };
  it('địa chỉ ngoài TP.HCM: đúng câu cố định, nút khoá', async () => {
    withBattery('Hà Nội');
    const c = await mount();
    expect(testid(c, 'home-pickup-notice')?.textContent).toBe(HOME_PICKUP_BATTERY_TEXT);
    click(check(c));
    await flush(3);
    expect(createBtn(c).disabled).toBe(true);
  });
  it('địa chỉ ở TP.HCM: không có câu chặn, tạo được', async () => {
    withBattery('TP. Hồ Chí Minh');
    const c = await mount();
    expect(testid(c, 'home-pickup-notice')).toBeNull();
    click(check(c));
    await flush(3);
    expect(createBtn(c).disabled).toBe(false);
  });
});

describe('Shipper lấy tận nhà (web): sổ địa chỉ', () => {
  it('chưa có địa chỉ: câu mời thêm, "Thêm địa chỉ" mở form, nút Tạo đơn khoá và nhắc chọn địa chỉ', async () => {
    state.addresses = [];
    atStep2();
    const c = await mount();
    expect(c.textContent).toContain('Bạn chưa có địa chỉ nào');
    expect(c.textContent).toContain('Chọn địa chỉ lấy rác để tạo đơn thu gom');
    expect(quoteCalls()).toHaveLength(0);
    expect(createBtn(c).disabled).toBe(true);
    click(byText(c, 'button', 'Thêm địa chỉ'));
    await flush(2);
    expect(c.querySelector('[data-testid="address-form"]')?.getAttribute('data-title')).toBe('Thêm địa chỉ');
  });
  it('chọn địa chỉ khác: báo phí lại cho địa chỉ đó', async () => {
    state.addresses = [makeAddress(), makeAddress({ id: 'addr-2', street: '99 Hai Bà Trưng', isDefault: false })];
    atStep2();
    const c = await mount();
    click(c.querySelector('[role="radio"][data-address="addr-2"]'));
    await flush(4);
    expect(quoteCalls().at(-1)!.body).toEqual(quoteBody({ addressId: 'addr-2' }));
  });
  it('sổ địa chỉ không tải được: câu lỗi và nút Thử lại', async () => {
    state.addressesFail = true;
    atStep2();
    const c = await mount();
    expect(c.textContent).toContain('Chưa tải được sổ địa chỉ');
    expect(byText(c, 'button', 'Thử lại')).not.toBeNull();
  });
});

describe('Shipper lấy tận nhà (web): tạo đơn thu gom', () => {
  it('thân tạo đơn đủ trường kèm Idempotency-Key, một nút duy nhất, xong thì sang chi tiết yêu cầu và xoá nháp', async () => {
    atStep2();
    const c = await mount();
    expect(createBtn(c).disabled).toBe(true);
    expect(c.textContent).toContain('Tick ô đồng ý ở trên để tạo đơn thu gom');
    expect(byText(bar(c), 'button', 'Tạo yêu cầu')).toBeNull();
    click(check(c));
    await flush(3);
    expect(createBtn(c).disabled).toBe(false);
    click(createBtn(c));
    await flush(10);
    expect(createCalls()).toEqual([
      {
        path: '/waste/requests',
        body: {
          method: 'HOME_PICKUP',
          lines: [{ itemId: 'item-carton', declaredQty: 5 }, { itemId: 'item-milk', declaredQty: 5 }],
          consent: true,
          consentVersion: 'v1',
          pickupAddressId: 'addr-1',
          declaredWeightGrams: 2000,
          usePointsForShipFee: true,
        },
        headers: { 'Idempotency-Key': expect.stringMatching(/^key-\d+$/) },
      },
    ]);
    expect(state.replace).toHaveBeenLastCalledWith('/doi-rac/yeu-cau/req-9');
    expect(loadDraft()).toBeNull();
  });

  it('luôn gửi usePointsForShipFee=true, kể cả khi đổi số kg', async () => {
    atStep2();
    const c = await mount();
    click(kg(c, '5 kg'));
    await flush(6);
    click(check(c));
    await flush(3);
    click(createBtn(c));
    await flush(10);
    expect(createCalls()).toHaveLength(1);
    expect(createCalls()[0]!.body).toMatchObject({ declaredWeightGrams: 5000, usePointsForShipFee: true });
  });

  it('lỗi 400 của máy chủ (thiếu Điểm Xanh lúc tạo): hiện đúng câu, bấm lại dùng CÙNG khoá', async () => {
    let n = 0;
    state.create = () => {
      if (++n === 1) throw new ApiError(SHORT_SENTENCE, 400);
      return makeRequestDetail({ id: 'req-9', method: 'HOME_PICKUP' });
    };
    atStep2();
    const c = await mount();
    click(check(c));
    await flush(3);
    click(createBtn(c));
    await flush(10);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(SHORT_SENTENCE);
    click(createBtn(c));
    await flush(10);
    const keys = createCalls().map((x) => x.headers?.['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^key-\d+$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('503 chưa báo được phí khi tạo: hiện đúng câu của máy chủ, không câu chung "Máy chủ đang bận"', async () => {
    state.create = () => {
      throw new ApiError(FEE_UNAVAILABLE, 503);
    };
    atStep2();
    const c = await mount();
    click(check(c));
    await flush(3);
    click(createBtn(c));
    await flush(10);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(FEE_UNAVAILABLE);
    expect(c.textContent).not.toContain('Máy chủ đang bận');
    expect(createBtn(c).disabled).toBe(false);
  });

  it('nháp giữ lựa chọn thu gom khi mở Thể lệ rồi quay lại', async () => {
    atStep2({ ...DRAFT, homePickup: { addressId: 'addr-1', weightGrams: 5000 } });
    const c = await mount();
    expect(quoteCalls()[0]!.body).toEqual(quoteBody({ declaredWeightGrams: 5000 }));
    expect(kg(c, '5 kg').getAttribute('aria-pressed')).toBe('true');
  });

  it('W178 thiếu Điểm Xanh (NEED_FEE_PAYMENT): hiện "Miễn phí lấy rác 100%", trả phần thiếu bằng Ví Tubu, hoặc một chạm đổi sang PICKUP giữ nguyên món', async () => {
    state.quote = () =>
      short({
        pointsAvailable: 8_000,
        pointsApplicable: 8_000,
        remainingFeeVnd: 17_000,
        cashDueVnd: 17_000,
        blockedCode: 'NEED_FEE_PAYMENT',
        feePaths: {
          wallet: { balance: 40_000, enough: true },
          bankTransfer: { enabled: false },
          attachNextOrder: { available: true, reason: null, existingRequestId: null },
        },
      });
    atStep2();
    let c = await mount();
    const block = testid(c, 'home-pickup-fee-short')!;
    expect(block.textContent).toContain('Miễn phí lấy rác 100%');
    expect(block.textContent).toContain('Khuyên dùng');
    expect(testid(c, 'home-pickup-cash-due')?.textContent).toBe('17.000đ');
    click(check(c));
    await flush(3);

    const pickBtn = byText(bar(c), 'button', 'Chọn cách trả phí') as HTMLButtonElement;
    expect(pickBtn.disabled).toBe(true);

    click(c.querySelector('[data-testid="fee-path-wallet"]'));
    await flush(3);
    const payBtn = byText(bar(c), 'button', 'Trả 17.000đ từ Ví và đặt lấy rác') as HTMLButtonElement;
    expect(payBtn.disabled).toBe(false);
    click(payBtn);
    await flush(10);
    expect(createCalls()).toHaveLength(1);
    expect(createCalls()[0]!.body).toMatchObject({
      method: 'HOME_PICKUP',
      usePointsForShipFee: true,
      shipFeePayment: 'WALLET',
      expectedCashVnd: 17_000,
    });
    mounted.pop()!.unmount();

    // Một chạm "Gửi kèm đơn mua kế tiếp" đổi phương thức sang PICKUP, giữ nguyên món trong nháp
    state.calls = [];
    atStep2();
    c = await mount();
    click(testid(c, 'fee-path-attach'));
    await flush(4);
    expect(testid(c, 'home-pickup-fee-short')).toBeNull();
    expect(c.querySelector('[data-method="PICKUP"]')?.getAttribute('aria-checked')).toBe('true');
    expect(byText(bar(c), 'button', 'Tạo yêu cầu')).not.toBeNull();
  });
});
