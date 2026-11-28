// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { REFILL_LANDING_PATH } from '@tubutree/app-core/refill/refill-landing';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Giỏ khách chưa đăng nhập (tubu-w20-01): dải mua thêm ghi vào giỏ trong máy, và hai dòng gọn dưới danh sách món (lời mời trang Refill, gợi ý giao định kỳ).
const state = vi.hoisted(() => ({
  picked: [] as unknown[],
  addResult: { ok: true } as { ok: boolean; reason?: string },
  addCalls: [] as unknown[],
  refillOn: true,
  landing: vi.fn(),
  edu: vi.fn(),
  suggestion: vi.fn(),
}));
vi.mock('./freeship-addons-pick', () => ({ pickFreeshipAddonItems: () => state.picked }));
vi.mock('@/lib/guest-cart/store', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  addGuestLine: (input: unknown) => {
    state.addCalls.push(input);
    return state.addResult;
  },
}));
vi.mock('@/lib/use-public-config', async (importOriginal) => ({ ...(await importOriginal<object>()), usePublicConfig: () => ({ isLoaded: true }) }));
vi.mock('@tubutree/app-core/refill/refill-api', async (importOriginal) => ({ ...(await importOriginal<object>()), refillFirstOn: () => state.refillOn }));
vi.mock('@tubutree/app-core/refill/refill-landing', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refillLandingQuery: () => ({ queryKey: ['refill-landing-test'], queryFn: state.landing }),
  refillCartEducation: state.edu,
}));
vi.mock('@/components/reorder/subscription-suggestion', () => ({
  useSubscriptionSuggestion: state.suggestion,
  SubscriptionSuggestionRow: (p: { suggestion: { variationId: string }; onAccept: (s: unknown) => void }) => (
    <button type="button" data-testid="subscription-suggestion" onClick={() => p.onAccept(p.suggestion)}>
      gợi ý
    </button>
  ),
  SuggestedSubscribe: (p: { suggestion: { variationId: string } }) => <div data-testid="suggested-subscribe">{p.suggestion.variationId}</div>,
}));

import { GUEST_CART_MAX_LINES } from '@/lib/guest-cart/store';
import { GuestFreeshipAddonsView } from './guest-freeship-addons-view';
import { CartNudges } from './cart-nudges';

const GOAL = { kind: 'freeship', stage: 'far', shortfall: 60_000, headline: 'Mua thêm 60.000đ để được Miễn phí giao hàng' } as never;
const ITEM = (slug: string, price: number) => ({ slug, name: `Món ${slug}`, thumbnail: null, price, compareAt: null, variationId: `v-${slug}`, inStock: true });
const LINES = [{ slug: 'nuoc-rua-chen-500ml', variationId: 'v-chai' }];

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
const mount = async (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  await flush(6);
  return r.container;
};
const firstAdd = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-testid="freeship-add"]')!;
/** Dải gập sẵn (w47-01): mở dòng "Gợi ý thêm để được Miễn phí giao hàng ▾" rồi mới thấy nút "+ Thêm". */
const openRail = (c: HTMLElement) => {
  const toggle = c.querySelector<HTMLButtonElement>('[data-testid="freeship-addons-toggle"]')!;
  if (toggle.getAttribute('aria-expanded') !== 'true') click(toggle);
};

describe('GuestFreeshipAddonsView: dải mua thêm của giỏ khách', () => {
  beforeEach(() => {
    state.picked = [ITEM('khan-tre', 45_000), ITEM('xa-bong', 39_000)];
    state.addResult = { ok: true };
    state.addCalls = [];
  });
  const source = { cards: [], pending: false, booster: true } as never;
  const pricing = (() => ({})) as never;

  it('"+ Thêm" ghi đúng phân loại, số lượng 1 vào giỏ khách trong máy, không lời lỗi', async () => {
    const c = await mount(<GuestFreeshipAddonsView goal={GOAL} lines={LINES} source={source} pricing={pricing} guest />);
    expect(c.querySelector('[data-testid="freeship-addons"]')!.getAttribute('aria-label')).toContain('Mua thêm 60.000đ để được Miễn phí giao hàng');
    expect(c.querySelector('[data-testid="freeship-addons-toggle"]')!.textContent).toBe('Gợi ý thêm để được Miễn phí giao hàng');
    openRail(c);
    click(firstAdd(c));
    expect(state.addCalls).toEqual([{ variationId: 'v-khan-tre', slug: 'khan-tre', quantity: 1 }]);
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it('giỏ khách đầy / phân loại đã tới trần: báo đúng câu của nút "Thêm vào giỏ"', async () => {
    const c = await mount(<GuestFreeshipAddonsView goal={GOAL} lines={LINES} source={source} pricing={pricing} guest />);
    openRail(c);
    state.addResult = { ok: false, reason: 'full' };
    click(firstAdd(c));
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(fillCopy('guestCart.full', { n: GUEST_CART_MAX_LINES }));
    state.addResult = { ok: false, reason: 'max' };
    click(firstAdd(c));
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(fillCopy('guestCart.atMax'));
    state.addResult = { ok: true };
    click(firstAdd(c));
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it('dưới 2 món hợp lệ: không vẽ dải, báo Giỏ là dải không hiện', async () => {
    state.picked = [];
    const shown = vi.fn();
    const c = await mount(<GuestFreeshipAddonsView goal={GOAL} lines={LINES} source={source} pricing={pricing} onShownChange={shown} guest />);
    expect(c.textContent).toBe('');
    expect(shown).toHaveBeenLastCalledWith(false);
  });
});

describe('CartNudges (web): lời mời trang Refill + gợi ý giao định kỳ dưới các dòng giỏ', () => {
  beforeEach(() => {
    state.refillOn = true;
    state.landing.mockReset().mockResolvedValue({ enabled: true, pairs: [] });
    state.edu.mockReset().mockReturnValue(null);
    state.suggestion.mockReset().mockReturnValue({ suggestion: null, discountFraction: 0 });
  });

  it('giỏ có chai ghép cặp: liên kết sang /tiet-kiem-refill, câu do app-core dựng; chai đã có lối đổi một chạm truyền xuống để loại', async () => {
    state.edu.mockImplementation((dto: unknown) => (dto ? { pct: 34, text: 'Đã có chai sẵn? Xem gói Refill tiết kiệm tới 34%' } : null));
    const swap = new Set(['khac']);
    const c = await mount(<CartNudges lines={LINES} swapSlugs={swap} />);
    const link = c.querySelector<HTMLAnchorElement>('[data-testid="cart-refill-edu"]')!;
    expect(link.getAttribute('href')).toBe(REFILL_LANDING_PATH.web);
    expect(link.textContent).toContain('Đã có chai sẵn? Xem gói Refill tiết kiệm tới 34%');
    expect(link.tagName).toBe('A');
    expect(state.edu).toHaveBeenLastCalledWith({ enabled: true, pairs: [] }, ['nuoc-rua-chen-500ml'], swap);
  });

  it('giỏ khách (không account): không hỏi gợi ý định kỳ; cờ Refill tắt thì không hỏi trang Refill và không vẽ gì', async () => {
    state.refillOn = false;
    const c = await mount(<CartNudges lines={LINES} />);
    expect(state.suggestion).toHaveBeenCalledWith(false, ['v-chai']);
    expect(state.landing).not.toHaveBeenCalled();
    expect(c.textContent).toBe('');
  });

  it('giỏ tài khoản: gợi ý giao định kỳ cho các phân loại trong giỏ, chạm mở sheet Đặt định kỳ', async () => {
    state.suggestion.mockReturnValue({ suggestion: { variationId: 'v-chai', intervalWeeks: 6 }, discountFraction: 0.12 });
    const c = await mount(<CartNudges lines={LINES} account />);
    expect(state.suggestion).toHaveBeenCalledWith(true, ['v-chai']);
    click(c.querySelector('[data-testid="subscription-suggestion"]'));
    await flush(2);
    expect(c.querySelector('[data-testid="suggested-subscribe"]')?.textContent).toBe('v-chai');
  });
});
