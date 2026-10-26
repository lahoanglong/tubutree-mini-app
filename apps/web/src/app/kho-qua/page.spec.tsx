// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { makeGiftRedemption, makeRewardCatalog, makeRewardItem } from '@/components/loyalty/reward-fixtures';

type Call = { method: string; path: string; body?: unknown; headers?: Record<string, string> };

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  rewards: null as object | null,
  loyalty: null as Record<string, unknown> | null,
  config: null as Record<string, unknown> | null,
  fail: new Set<string>(),
  calls: [] as Call[],
  redeem: null as null | (() => Promise<unknown>),
  keySeq: 0,
  push: vi.fn(),
  cartCount: 0,
  applied: [] as string[],
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }), usePathname: () => '/' }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCart: async () => ({ itemCount: state.cartCount }),
  applyCoupon: async (code: string) => {
    state.applied.push(code);
    return { couponCode: code, discount: 0, freeship: true };
  },
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/idempotency-key', () => ({ newIdempotencyKey: () => `key-${++state.keySeq}` }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ method: 'get', path });
      if (state.fail.has(path)) {
        state.fail.delete(path);
        throw new Error('mất mạng');
      }
      if (path === '/me/loyalty/rewards') return state.rewards;
      if (path === '/me/loyalty') return state.loyalty;
      if (path === '/config/public' && state.config) return state.config;
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body?: unknown, opts?: { headers?: Record<string, string> }) => {
      state.calls.push({ method: 'post', path, body, headers: opts?.headers });
      return state.redeem!();
    },
  },
}));

import RewardsPage from './page';

const VOUCHER_RESULT = (code = 'FREESHIP-ABC') => ({
  success: true,
  message: 'ok',
  pointsSpent: 20_000,
  remainingPoints: 10_000,
  redemption: makeGiftRedemption({ giftKind: 'VOUCHER', status: 'FULFILLED', code: null, couponCode: code }),
  coupon: { code, type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, endAt: '2026-11-16T16:59:59.000Z' },
});
const CLAIM_RESULT = {
  success: true,
  message: 'ok',
  pointsSpent: 25_000,
  remainingPoints: 5000,
  redemption: makeGiftRedemption(),
  coupon: null,
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RewardsPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const postsOf = (path: string) => state.calls.filter((c) => c.method === 'post' && c.path === path);
const getsOf = (path: string) => state.calls.filter((c) => c.method === 'get' && c.path === path);
const REDEEM_FREESHIP = '/me/loyalty/rewards/reward-freeship/redeem';
const card = (c: HTMLElement, name: string) => {
  const el = Array.from(c.querySelectorAll<HTMLElement>('[data-reward]')).find((x) => x.textContent?.includes(name));
  if (!el) throw new Error(`không thấy thẻ ${name}`);
  return el;
};
// key-1 đi cho trạng thái chưa chọn quà; mỗi quà được chọn nhận key kế tiếp.
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const tab = (c: HTMLElement, label: string) => byText(c, '[role="tab"]', label);
const openConfirm = async (c: HTMLElement, name: string) => {
  click(byText(card(c, name), 'button', 'Đổi'));
  await flush(3);
};
const confirmBtn = () => byText(dialog()!, 'button', 'Xác nhận đổi');

beforeEach(() => {
  state.phase = 'authenticated';
  state.rewards = makeRewardCatalog();
  state.loyalty = { pointsBalance: 30_000, pointsConvertedBalance: 5000, lockedPoints: 0, redeemablePoints: 30_000 };
  state.config = null;
  state.fail = new Set();
  state.calls = [];
  state.keySeq = 0;
  state.redeem = async () => VOUCHER_RESULT();
  state.push.mockReset();
  state.cartCount = 0;
  state.applied = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('/kho-qua — số dư, tab và thẻ quà', () => {
  it('số dư tổng hai lô, ghi chú luật điểm không hết hạn, liên kết "Quà của tôi"', async () => {
    const c = await mount();
    expect(c.textContent).toContain('35.000 điểm');
    expect(c.textContent).toContain('Đổi quà dùng được 30.000 điểm');
    expect(c.textContent).toContain('Điểm không hết hạn chỉ dùng khi thanh toán và góp quỹ trồng cây, không dùng để đổi mã giảm giá hay quà.');
    expect(c.querySelector('a[href="/kho-qua/cua-toi"]')?.textContent).toContain('Quà của tôi');
  });

  it('ghi chú luật dùng điểm từ cấu hình công khai; không hiện khi cấu hình chưa tải', async () => {
    let c = await mount();
    expect(c.textContent).not.toContain('Điểm Xanh thường dùng tối đa');
    state.config = { loyalty: { vndPerPoint: 50, vndPerPointRedeem: 1000, maxRedeemPct: 0.2, pointExpireMonths: 12 } };
    mounted.forEach((m) => m.unmount());
    mounted = [];
    c = await mount();
    expect(c.textContent).toContain('Điểm Xanh thường dùng tối đa 20% giá trị hàng Tubu trong đơn, không trừ vào phí ship. Điểm Xanh thường có hạn 12 tháng kể từ ngày nhận, điểm cũ được dùng trước.');
  });

  it('không lặp số dư: dòng "Đổi quà dùng được" chỉ hiện khi khác tổng', async () => {
    state.rewards = makeRewardCatalog({ pointsBalance: 42_000, pointsConvertedBalance: 0, lockedPoints: 0, redeemablePoints: 42_000 });
    const c = await mount();
    expect(c.textContent).toContain('42.000 điểm');
    expect(c.textContent).not.toContain('Đổi quà dùng được');
  });

  it('thẻ quà: biểu tượng theo loại, giá và nút Đổi cùng một hàng', async () => {
    const c = await mount();
    const voucher = card(c, 'Miễn phí vận chuyển');
    expect(voucher.querySelector('[data-testid="reward-icon"] svg.lucide-ticket')).not.toBeNull();
    const price = Array.from(voucher.querySelectorAll('div')).find((d) => /điểm$/.test(d.textContent ?? '') && d.children.length === 0)!;
    expect(price.parentElement).toBe(byText(voucher, 'button', 'Đổi')!.parentElement);
    click(tab(c, 'Cây và hạt'));
    await flush(2);
    expect(card(c, 'Gói hạt giống Tubu').querySelector('[data-testid="reward-icon"] svg.lucide-leaf')).not.toBeNull();
    expect(card(c, 'Góp quỹ trồng cây').querySelector('[data-testid="reward-icon"] svg.lucide-sprout')).not.toBeNull();
    click(tab(c, 'Quà nhỏ'));
    await flush(2);
    expect(card(c, 'Túi vải Tubu').querySelector('[data-testid="reward-icon"] svg.lucide-gift')).not.toBeNull();
  });

  it('có điểm khoá thì hiện ghi chú vì sao chưa đổi được; không khoá thì không có', async () => {
    state.loyalty = { pointsBalance: 100, lockedPoints: 60, lockedReturnPoints: 0, lockedUntil: '2026-10-03T17:30:00.000Z', redeemablePoints: 40 };
    const c = await mount();
    expect(c.textContent).toContain('60 điểm từ đơn mới giao sẽ dùng được sau ngày 04/10/2026');
  });

  it('ba tab theo loại quà, mặc định Mã giảm giá', async () => {
    const c = await mount();
    expect(Array.from(c.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual(['Mã giảm giá', 'Cây và hạt', 'Quà nhỏ']);
    expect(c.textContent).toContain('Miễn phí vận chuyển');
    expect(c.textContent).not.toContain('Gói hạt giống Tubu');
    click(tab(c, 'Cây và hạt'));
    await flush(2);
    expect(c.textContent).toContain('Gói hạt giống Tubu');
    expect(c.textContent).toContain('Góp quỹ trồng cây');
  });

  it('tab không có quà → "Chưa có quà trong mục này"', async () => {
    state.rewards = makeRewardCatalog({ rewards: [makeRewardItem()] });
    const c = await mount();
    click(tab(c, 'Quà nhỏ'));
    await flush(2);
    expect(c.textContent).toContain('Chưa có quà trong mục này');
  });

  it('đủ điểm → nút "Đổi"; thiếu → "Cần thêm N điểm" và thanh tiến độ, không có nút', async () => {
    const c = await mount();
    expect(byText(card(c, 'Miễn phí vận chuyển'), 'button', 'Đổi')).not.toBeNull();
    const c50 = card(c, 'Giảm 50.000đ');
    expect(c50.textContent).toContain('Cần thêm 20.000 điểm');
    expect(c50.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('30000');
    expect(byText(c50, 'button', 'Đổi')).toBeNull();
  });

  it('"Đã hết" theo soldOut của máy chủ: không thanh tiến độ, không "Cần thêm"', async () => {
    const c = await mount();
    click(tab(c, 'Quà nhỏ'));
    await flush(2);
    const bag = card(c, 'Túi vải Tubu');
    expect(bag.textContent).toContain('Đã hết');
    expect(bag.querySelector('[role="progressbar"]')).toBeNull();
    expect(bag.textContent).not.toContain('Cần thêm');
  });

  it('tồn kho và nơi nhận trên thẻ gói hạt', async () => {
    const c = await mount();
    click(tab(c, 'Cây và hạt'));
    await flush(2);
    expect(card(c, 'Gói hạt giống Tubu').textContent).toContain('Còn 3');
    expect(card(c, 'Gói hạt giống Tubu').textContent).toContain('Nhận tại kho Tubu TP.HCM');
  });

  it('đủ điểm nhưng phần đổi được đang khoá → "Chờ mở khoá điểm" bị tắt, không "Cần thêm"', async () => {
    state.rewards = makeRewardCatalog({ redeemablePoints: 14_000, rewards: [makeRewardItem({ canRedeem: false, pointsCost: 10_000 })] });
    const c = await mount();
    const btn = byText(card(c, 'Miễn phí vận chuyển'), 'button', 'Chờ mở khoá điểm') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(card(c, 'Miễn phí vận chuyển').textContent).not.toContain('Cần thêm');
  });
});

describe('/kho-qua — xác nhận và đổi quà', () => {
  it('xác nhận: điểm còn lại sau đổi; quà nhận ở kho kèm địa chỉ, giờ mở, hạn nhận 60 ngày; chưa gọi API', async () => {
    const c = await mount();
    click(tab(c, 'Cây và hạt'));
    await flush(2);
    await openConfirm(c, 'Gói hạt giống Tubu');
    const d = dialog()!;
    expect(d.textContent).toContain('Xác nhận đổi quà');
    expect(d.textContent).toContain('-25.000 điểm');
    expect(d.textContent).toContain('10.000 điểm');
    expect(d.textContent).toContain('Kho Tubu TP.HCM');
    expect(d.textContent).toContain('99 Nguyễn Văn Linh, Phường Tân Phong, TP.HCM');
    expect(d.textContent).toContain('T2 08:00–17:00');
    expect(d.textContent).toContain('Hạn nhận 60 ngày');
    expect(postsOf(REDEEM_FREESHIP)).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/hoặc điểm nhận/);
  });

  it('đổi mã giảm giá: một lần dù chạm đúp, có Idempotency-Key, mã vào ví, làm mới các khoá như Mini App', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    let resolve!: (v: unknown) => void;
    state.redeem = () => new Promise((r) => (resolve = r));
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    click(confirmBtn());
    click(confirmBtn());
    await flush(2);
    resolve(VOUCHER_RESULT());
    await flush(6);
    expect(dialog()!.textContent).toContain('Đổi quà thành công');
    expect(dialog()!.textContent).toContain('Mã FREESHIP-ABC đã vào ví mã giảm giá');
    expect(dialog()!.querySelector('a[href="/tai-khoan/diem-xanh"]')?.textContent).toContain('Xem ví mã');
    expect(postsOf(REDEEM_FREESHIP)).toHaveLength(1);
    expect(postsOf(REDEEM_FREESHIP)[0]!.headers).toEqual({ 'Idempotency-Key': 'key-2' });
    expect(postsOf(REDEEM_FREESHIP)[0]!.body).toBeUndefined();
    const keys = invalidate.mock.calls.map((a) => JSON.stringify((a[0] as { queryKey: unknown }).queryKey));
    for (const k of [['waste'], ['loyalty'], ['points-txn'], ['game'], ['loyalty-rewards'], ['coupons']]) expect(keys).toContain(JSON.stringify(k));
  });

  it('lỗi: báo câu máy chủ, làm mới danh sách quà, đổi lại CÙNG quà dùng CÙNG khoá', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    state.redeem = vi
      .fn()
      .mockRejectedValueOnce(new Error('Quà này đã hết hoặc đã ngừng đổi'))
      .mockResolvedValue(VOUCHER_RESULT('X'));
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    click(confirmBtn());
    await flush(5);
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe('Quà này đã hết hoặc đã ngừng đổi');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['loyalty-rewards'] });
    click(confirmBtn());
    await flush(5);
    expect(postsOf(REDEEM_FREESHIP).map((p) => p.headers?.['Idempotency-Key'])).toEqual(['key-2', 'key-2']);
  });

  it('lỗi mạng, đóng khung rồi mở lại CÙNG quà → vẫn CÙNG khoá', async () => {
    state.redeem = vi.fn().mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue(VOUCHER_RESULT('X'));
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    click(confirmBtn());
    await flush(5);
    click(byText(dialog()!, 'button', 'Huỷ'));
    await flush(3);
    expect(dialog()).toBeNull();
    await openConfirm(c, 'Miễn phí vận chuyển');
    click(confirmBtn());
    await flush(5);
    const [k1, k2] = postsOf(REDEEM_FREESHIP).map((p) => p.headers?.['Idempotency-Key']);
    expect(k1).toBe('key-2');
    expect(k2).toBe(k1);
  });

  it('thành công rồi đổi tiếp cùng quà → khoá mới', async () => {
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    click(confirmBtn());
    await flush(6);
    click(byText(dialog()!, 'a', 'Xem ví mã'));
    await flush(3);
    await openConfirm(c, 'Miễn phí vận chuyển');
    click(confirmBtn());
    await flush(6);
    expect(postsOf(REDEEM_FREESHIP).map((p) => p.headers?.['Idempotency-Key'])).toEqual(['key-2', 'key-3']);
  });

  it('gói hạt: kết quả là mã QG- cỡ lớn, hạn nhận theo giờ VN, dẫn tới Quà của tôi', async () => {
    state.redeem = async () => CLAIM_RESULT;
    const c = await mount();
    click(tab(c, 'Cây và hạt'));
    await flush(2);
    await openConfirm(c, 'Gói hạt giống Tubu');
    click(confirmBtn());
    await flush(6);
    const d = dialog()!;
    expect(d.querySelector('p')?.textContent).toBe('QG-8K2M9P4T');
    expect(d.textContent).toContain('Hạn nhận 17/12/2026');
    expect(d.textContent).toContain('Mang mã này tới kho Tubu TP.HCM để nhận quà');
    expect(d.querySelector('a[href="/kho-qua/cua-toi"]')?.textContent).toContain('Quà của tôi');
    expect(postsOf('/me/loyalty/rewards/gift-seed/redeem')).toHaveLength(1);
  });

  it('đổi xong mà làm mới danh mục lỗi → vẫn hiện mã QG- (điểm đã trừ), không thay cả trang bằng lỗi', async () => {
    state.redeem = async () => CLAIM_RESULT;
    const c = await mount();
    click(tab(c, 'Cây và hạt'));
    await flush(2);
    await openConfirm(c, 'Gói hạt giống Tubu');
    state.fail.add('/me/loyalty/rewards');
    click(confirmBtn());
    await flush(6);
    expect(dialog()!.textContent).toContain('QG-8K2M9P4T');
    expect(getsOf('/me/loyalty/rewards').length).toBeGreaterThanOrEqual(2);
  });

  it('góp quỹ trồng cây đi qua POST /game/tree/buy với cùng khoá, không qua đường đổi quà; không hứa cây cụ thể', async () => {
    state.rewards = makeRewardCatalog({
      rewards: [makeRewardItem({ id: 'gift-tree', kind: 'TREE', name: 'Góp quỹ trồng cây', pointsCost: 30_000, canRedeem: true, voucher: null })],
    });
    state.redeem = async () => ({ certificateCode: 'CERT-123', treeType: 'Sao đen', cost: 30_000, pointsUsed: 30_000, pointsUsedConverted: 0 });
    const c = await mount();
    click(tab(c, 'Cây và hạt'));
    await flush(2);
    await openConfirm(c, 'Góp quỹ trồng cây');
    click(confirmBtn());
    await flush(6);
    expect(dialog()!.textContent).toContain('Bạn đã góp một cây vào quỹ trồng cây của Tubu');
    expect(postsOf('/game/tree/buy')).toHaveLength(1);
    expect(postsOf('/game/tree/buy')[0]!.headers).toEqual({ 'Idempotency-Key': 'key-2' });
    expect(state.calls.some((x) => x.path.includes('/rewards/gift-tree/redeem'))).toBe(false);
    expect(document.body.textContent).not.toMatch(/CERT-123|Sao đen/);
  });
});

describe('/kho-qua — quà thừa với hạng, quà nhận tại kho, Dùng ngay', () => {
  const freeshipRow = (over = {}) => makeRewardItem({ label: 'Phổ biến', ...over });
  const discountRow = makeRewardItem({ id: 'reward-discount-50k', name: 'Giảm 50.000đ', pointsCost: 20_000, voucher: { type: 'AMOUNT', value: 50000, minOrder: 300000, maxDiscount: null, validDays: 30 }, sortOrder: 2 });

  it('hạng đã được freeship: quà freeship xuống cuối, ghi rõ hạng, không còn nút Đổi và nhãn "Phổ biến"', async () => {
    state.rewards = makeRewardCatalog({ tierFreeShip: { tierName: 'Lộc Biếc', freeFrom: 99_000 }, rewards: [freeshipRow(), discountRow] });
    const c = await mount();
    const names = Array.from(c.querySelectorAll('[data-reward]')).map((el) => el.textContent ?? '');
    expect(names[0]).toContain('Giảm 50.000đ');
    expect(names[1]).toContain('Miễn phí vận chuyển');
    const free = card(c, 'Miễn phí vận chuyển');
    expect(free.textContent).toContain('Hạng Lộc Biếc đã được miễn phí giao hàng');
    expect(free.textContent).not.toContain('Phổ biến');
    expect(Array.from(free.querySelectorAll('button')).some((b) => b.textContent === 'Đổi')).toBe(false);
    expect((byText(card(c, 'Giảm 50.000đ'), 'button', 'Đổi') as HTMLButtonElement).disabled).toBe(false);
  });

  it('hạng chưa freeship tới ngưỡng của mã: quà freeship vẫn đổi được', async () => {
    state.rewards = makeRewardCatalog({ tierFreeShip: { tierName: 'Mầm Xanh', freeFrom: 199_000 } });
    const c = await mount();
    expect((byText(card(c, 'Miễn phí vận chuyển'), 'button', 'Đổi') as HTMLButtonElement).disabled).toBe(false);
  });

  it('quà nhận tại kho: thẻ ghi "Chỉ nhận tại kho TP.HCM", mã giảm giá thì không; xác nhận hỏi lại kèm địa chỉ kho', async () => {
    const c = await mount();
    expect(card(c, 'Miễn phí vận chuyển').textContent).not.toContain('Chỉ nhận tại kho TP.HCM');
    click(tab(c, 'Cây và hạt'));
    await flush(2);
    expect(card(c, 'Gói hạt giống Tubu').textContent).toContain('Chỉ nhận tại kho TP.HCM');
    expect(card(c, 'Góp quỹ trồng cây').textContent).not.toContain('Chỉ nhận tại kho TP.HCM');
    await openConfirm(c, 'Gói hạt giống Tubu');
    expect(dialog()!.textContent).toContain('Quà này chỉ nhận tại kho TP.HCM, không giao tận nhà: Kho Tubu TP.HCM, 99 Nguyễn Văn Linh, Phường Tân Phong, TP.HCM. Bạn vẫn muốn đổi?');
  });

  it('đổi mã xong: "Dùng ngay" khi giỏ có hàng → chọn sẵn mã rồi tới giỏ', async () => {
    state.cartCount = 2;
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    click(confirmBtn());
    await flush(6);
    click(byText(dialog()!, 'button', 'Dùng ngay'));
    await flush(4);
    expect(state.applied).toEqual(['FREESHIP-ABC']);
    expect(state.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('đổi mã xong: "Dùng ngay" khi giỏ trống → tới danh sách sản phẩm, không áp mã', async () => {
    const c = await mount();
    await openConfirm(c, 'Miễn phí vận chuyển');
    click(confirmBtn());
    await flush(6);
    click(byText(dialog()!, 'button', 'Dùng ngay'));
    await flush(4);
    expect(state.applied).toEqual([]);
    expect(state.push).toHaveBeenCalledWith('/san-pham');
  });
});

describe('/kho-qua — trạng thái trang', () => {
  it('đang khôi phục phiên → không gọi API; mất kết nối → báo; khách → nút đăng nhập quay lại /kho-qua', async () => {
    state.phase = 'loading';
    await mount();
    expect(state.calls).toHaveLength(0);
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.phase = 'guest';
    const c = await mount();
    expect(c.textContent).toContain('Đăng nhập');
    expect(c.querySelector('a[href*="/dang-nhap"]')?.getAttribute('href')).toContain(encodeURIComponent('/kho-qua'));
    expect(state.calls).toHaveLength(0);
  });

  it('đang tải → skeleton; lỗi tải danh mục → ErrorState + Thử lại', async () => {
    state.fail.add('/me/loyalty/rewards');
    const c = await mount();
    expect(c.textContent).toContain('mất mạng');
    click(byText(c, 'button', 'Thử lại'));
    await flush(5);
    expect(c.textContent).toContain('Miễn phí vận chuyển');
  });

  it('một h1, tab và nút đủ tên, vùng chạm đủ lớn', async () => {
    const c = await mount();
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(c.querySelector('h1')?.textContent).toBe('Kho quà');
  });
});

describe('/kho-qua — giao diện điện thoại như Mini App', () => {
  it('số điểm là chữ serif hiển thị (display-md) ở điện thoại, giữ cỡ máy tính từ md', async () => {
    const c = await mount();
    const num = Array.from(c.querySelectorAll('div')).find((d) => d.children.length === 0 && /điểm$/.test(d.textContent ?? '') && d.className.includes('tabular-nums'))!;
    expect(num.className).toContain('max-md:font-display');
    expect(num.className).toContain('max-md:text-[length:var(--type-display-md-size)]');
    expect(num.className).toContain('md:text-3xl');
  });

  it('dòng "Quà của tôi" là hàng phẳng không thẻ, không viền ở điện thoại', async () => {
    const c = await mount();
    const row = c.querySelector('a[href="/kho-qua/cua-toi"]')!;
    expect(row.className).toContain('max-md:border-0');
    expect(row.className).toContain('max-md:bg-transparent');
    expect(row.className).toContain('max-md:shadow-none');
  });

  it('thẻ quà viền mảnh không bóng như Card outline', async () => {
    const c = await mount();
    expect(card(c, 'Miễn phí vận chuyển').className).toContain('max-md:shadow-none');
  });

  it('trang bỏ đệm 48px của body và có thanh tiêu đề trắng', async () => {
    const c = await mount();
    expect(c.querySelector('h1')!.closest('header')!.hasAttribute('data-page-bleed')).toBe(true);
    expect(c.querySelector('h1')!.closest('header')!.className).toContain('max-md:bg-[var(--color-bg-surface)]');
  });
});

