// @vitest-environment jsdom
import { act, cloneElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ status: 'authenticated', touch: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ status: mocks.status }) }));
vi.mock('@/lib/shop-client', () => ({ recordReferralTouch: mocks.touch }));

import { ApiError, NetworkError } from '@/lib/client-api';
import { clearPendingRef, clearStorefrontContext, getStorefrontContext, PENDING_REF_TTL_DAYS, readPendingRefs } from '@/lib/storefront-context';
import { ReferralCapture, resetCtvTouched, StorefrontTracker } from './storefront-tracker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ReferralCapture />));
  await act(async () => root.unmount());
  host.remove();
}

describe('ReferralCapture ghi nguồn gian hàng ?s= như Mini App', () => {
  beforeEach(() => {
    resetCtvTouched();
    mocks.status = 'authenticated';
    mocks.touch.mockReset().mockResolvedValue({ ok: true });
    clearStorefrontContext();
    clearPendingRef();
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    clearStorefrontContext();
    clearPendingRef();
  });

  it('?s=slug: nhớ gian hàng CTV và ghi chạm lấy slug làm mã giới thiệu', async () => {
    window.history.replaceState({}, '', '/san-pham/a?s=an-shop');
    await mount();
    expect(getStorefrontContext()).toMatchObject({ slug: 'an-shop', kind: 'CTV' });
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'an-shop', storefrontSlug: 'an-shop', kind: 'ctv' });
  });

  it('?s=slug&ref=CODE: mã giới thiệu là ref, vẫn gắn slug CTV', async () => {
    window.history.replaceState({}, '', '/?s=an-shop&ref=abc123');
    await mount();
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'ABC123', storefrontSlug: 'an-shop', kind: 'ctv' });
  });

  it('chỉ ?ref=: không có storefrontSlug, kind mặc định ctv như Mini App', async () => {
    window.history.replaceState({}, '', '/?ref=abc123');
    await mount();
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'ABC123', kind: 'ctv' });
  });

  it('?ref= sau khi đã ở gian hàng khác: xoá slug cũ, không gán nhầm storefrontSlug', async () => {
    window.history.replaceState({}, '', '/?s=cu');
    await mount();
    mocks.touch.mockClear();
    window.history.replaceState({}, '', '/?ref=moi');
    await mount();
    expect(getStorefrontContext().slug).toBeNull();
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'MOI', kind: 'ctv' });
  });

  it('chưa đăng nhập: chỉ nhớ, không gọi server', async () => {
    mocks.status = 'anonymous';
    window.history.replaceState({}, '', '/?s=an-shop');
    await mount();
    expect(getStorefrontContext().slug).toBe('an-shop');
    expect(mocks.touch).not.toHaveBeenCalled();
  });

  it('không có s hay ref: không làm gì', async () => {
    await mount();
    expect(mocks.touch).not.toHaveBeenCalled();
  });
});

/** Mount giữ lại để đổi trạng thái đăng nhập giữa chừng như khách vừa đăng nhập xong. */
async function mountKept(node: React.ReactElement = <ReferralCapture />) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    // Phần tử mới mỗi lần: cùng một phần tử thì React bỏ qua lần vẽ lại và hook đăng nhập không được đọc lại.
    rerender: (n: React.ReactElement = node) => act(async () => root.render(cloneElement(n))),
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe('ReferralCapture: nguồn giới thiệu sống qua đóng tab khi chưa đăng nhập', () => {
  const DAY = 24 * 60 * 60 * 1000;
  beforeEach(() => {
    resetCtvTouched();
    mocks.status = 'anonymous';
    mocks.touch.mockReset().mockResolvedValue({ ok: true });
    sessionStorage.clear();
    clearStorefrontContext();
    clearPendingRef();
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    clearStorefrontContext();
    clearPendingRef();
    vi.restoreAllMocks();
  });

  /** Mở link rồi "đóng tab": quên hết sessionStorage nhưng localStorage còn. */
  async function openLinkThenCloseTab(url: string) {
    window.history.replaceState({}, '', url);
    const m = await mountKept();
    await m.unmount();
    window.history.replaceState({}, '', '/');
    sessionStorage.clear();
  }

  it('mở /?ref=ABC khi chưa đăng nhập, đóng tab, hôm sau đăng nhập → chạm giới thiệu với ABC rồi xoá bản chờ', async () => {
    await openLinkThenCloseTab('/?ref=ABC');
    expect(mocks.touch).not.toHaveBeenCalled();
    expect(getStorefrontContext().referralCode).toBeNull();
    const m = await mountKept();
    mocks.status = 'authenticated';
    await m.rerender();
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'ABC', kind: 'ctv' });
    expect(readPendingRefs()).toEqual([]);
    await m.unmount();
  });

  it('link gian hàng ?s=slug: bản chờ chạm với slug làm mã và gắn storefrontSlug như trong phiên', async () => {
    await openLinkThenCloseTab('/?s=an-shop');
    const m = await mountKept();
    mocks.status = 'authenticated';
    await m.rerender();
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'an-shop', storefrontSlug: 'an-shop', kind: 'ctv' });
    await m.unmount();
  });

  it('chạm trả ok:false (mã không phải CTV) vẫn xoá bản chờ, không chạm lại lần sau', async () => {
    mocks.touch.mockResolvedValue({ ok: false });
    await openLinkThenCloseTab('/?ref=KHACH01');
    const m = await mountKept();
    mocks.status = 'authenticated';
    await m.rerender();
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    expect(readPendingRefs()).toEqual([]);
    await m.unmount();
  });

  it('lỗi mạng khi chạm bù: giữ bản chờ để lần sau thử lại (trong hạn 7 ngày)', async () => {
    mocks.touch.mockRejectedValue(new Error('offline'));
    await openLinkThenCloseTab('/?ref=ABC');
    const m = await mountKept();
    mocks.status = 'authenticated';
    await m.rerender();
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    expect(readPendingRefs()).toMatchObject([{ referralCode: 'ABC' }]);
    await m.unmount();
  });

  it.each([
    ['400 (mã sai dạng: gửi lại y hệt cũng bị từ chối)', new ApiError('Mã quá dài', 400)],
    ['404', new ApiError('Không thấy', 404)],
  ])('chạm bù bị máy chủ từ chối %s: bỏ bản chờ, không kẹt nhiều ngày', async (_label, err) => {
    mocks.touch.mockRejectedValue(err);
    await openLinkThenCloseTab('/?ref=ABC');
    const m = await mountKept();
    mocks.status = 'authenticated';
    await m.rerender();
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    expect(readPendingRefs()).toEqual([]);
    await m.unmount();
  });

  it.each([
    ['mất mạng', () => new NetworkError(false)],
    ['hết thời gian chờ', () => new NetworkError(true)],
    ['máy chủ lỗi 500', () => new ApiError('Lỗi', 500)],
    ['phiên hết hạn 401', () => new ApiError('Hết phiên', 401)],
    ['quá nhiều yêu cầu 429', () => new ApiError('Chậm lại', 429)],
  ])('chạm bù gặp %s: giữ bản chờ để lần sau thử lại', async (_label, makeErr) => {
    mocks.touch.mockRejectedValue(makeErr());
    await openLinkThenCloseTab('/?ref=ABC');
    const m = await mountKept();
    mocks.status = 'authenticated';
    await m.rerender();
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    expect(readPendingRefs()).toMatchObject([{ referralCode: 'ABC' }]);
    await m.unmount();
  });

  it(`bản chờ quá ${PENDING_REF_TTL_DAYS} ngày → không chạm, dọn bản chờ`, async () => {
    await openLinkThenCloseTab('/?ref=ABC');
    const real = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(real + (PENDING_REF_TTL_DAYS + 1) * DAY);
    const m = await mountKept();
    mocks.status = 'authenticated';
    await m.rerender();
    expect(mocks.touch).not.toHaveBeenCalled();
    expect(readPendingRefs()).toEqual([]);
    await m.unmount();
  });

  /** Mở link trong cùng một tab (sessionStorage còn nguyên: nguồn trong phiên là link mở sau cùng). */
  async function openLinkInSameTab(url: string) {
    window.history.replaceState({}, '', url);
    const m = await mountKept();
    await m.unmount();
    window.history.replaceState({}, '', '/');
  }

  const touchByCode = (okCodes: string[]) =>
    mocks.touch.mockImplementation(async (dto: { referralCode: string }) => ({ ok: okCodes.includes(dto.referralCode) }));

  it('link CTV rồi link mã khách thường (đóng tab giữa hai lần): đăng nhập chạm cả hai, CTV trước, mã khách thường sau cùng', async () => {
    touchByCode(['an-shop']);
    await openLinkThenCloseTab('/?s=an-shop');
    await openLinkThenCloseTab('/?ref=KHACH01');
    expect(readPendingRefs()).toHaveLength(2);
    const m = await mountKept();
    mocks.status = 'authenticated';
    await m.rerender();
    expect(mocks.touch.mock.calls.map(([dto]) => dto)).toEqual([
      { referralCode: 'an-shop', storefrontSlug: 'an-shop', kind: 'ctv' },
      { referralCode: 'KHACH01', kind: 'ctv' },
    ]);
    expect(readPendingRefs()).toEqual([]);
    await m.unmount();
  });

  it('cùng một tab: link CTV rồi link mã khách thường (nguồn trong phiên chỉ còn mã khách thường), đăng nhập vẫn chạm cả hai theo thứ tự', async () => {
    touchByCode(['an-shop']);
    await openLinkInSameTab('/?s=an-shop');
    await openLinkInSameTab('/?ref=KHACH01');
    expect(getStorefrontContext()).toMatchObject({ referralCode: 'KHACH01', slug: null });
    const m = await mountKept();
    mocks.status = 'authenticated';
    await m.rerender();
    expect(mocks.touch.mock.calls.map(([dto]) => dto.referralCode)).toEqual(['an-shop', 'KHACH01']);
    expect(getStorefrontContext().referralEligible).toBe(false);
    expect(readPendingRefs()).toEqual([]);
    await m.unmount();
  });

  it('một lần chạm bù gặp lỗi mạng: giữ cả danh sách bản chờ để lần sau chạm lại', async () => {
    mocks.touch.mockImplementation(async (dto: { referralCode: string }) => {
      if (dto.referralCode === 'an-shop') throw new Error('offline');
      return { ok: true };
    });
    await openLinkThenCloseTab('/?s=an-shop');
    await openLinkThenCloseTab('/?ref=ABC');
    const m = await mountKept();
    mocks.status = 'authenticated';
    await m.rerender();
    expect(mocks.touch).toHaveBeenCalledTimes(2);
    expect(readPendingRefs().map((p) => p.referralCode ?? p.slug)).toEqual(['an-shop', 'ABC']);
    await m.unmount();
  });

  it('sessionStorage còn nguồn thì ưu tiên bản trong phiên (một lần chạm), và bản chờ cùng nguồn được dọn', async () => {
    window.history.replaceState({}, '', '/?ref=ABC');
    const m = await mountKept();
    window.history.replaceState({}, '', '/');
    mocks.status = 'authenticated';
    await m.rerender();
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'ABC', kind: 'ctv' });
    expect(readPendingRefs()).toEqual([]);
    await m.unmount();
  });

  it('localStorage ném lỗi: trang không vỡ, vẫn nhớ và chạm theo sessionStorage', async () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
    const boom = () => {
      throw new Error('blocked');
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: boom, setItem: boom, removeItem: boom } });
    try {
      mocks.status = 'authenticated';
      window.history.replaceState({}, '', '/?ref=ABC');
      const m = await mountKept();
      expect(getStorefrontContext().referralCode).toBe('ABC');
      expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'ABC', kind: 'ctv' });
      mocks.touch.mockClear();
      window.history.replaceState({}, '', '/');
      sessionStorage.clear();
      await m.unmount();
      const again = await mountKept();
      expect(mocks.touch).not.toHaveBeenCalled();
      await again.unmount();
    } finally {
      Object.defineProperty(window, 'localStorage', real);
    }
  });
});

describe('chạm giới thiệu trả kết quả thì ngữ cảnh nhớ mã có phải của CTV không', () => {
  beforeEach(() => {
    resetCtvTouched();
    mocks.status = 'authenticated';
    mocks.touch.mockReset();
    sessionStorage.clear();
    clearStorefrontContext();
    clearPendingRef();
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    clearStorefrontContext();
    clearPendingRef();
  });

  it('ReferralCapture: ok:false → referralEligible false; ok:true → true', async () => {
    mocks.touch.mockResolvedValue({ ok: false });
    window.history.replaceState({}, '', '/?ref=KHACH01');
    await mount();
    expect(getStorefrontContext()).toMatchObject({ referralCode: 'KHACH01', referralEligible: false });
    clearStorefrontContext();
    mocks.touch.mockResolvedValue({ ok: true });
    window.history.replaceState({}, '', '/?ref=CTV0001');
    await mount();
    expect(getStorefrontContext()).toMatchObject({ referralCode: 'CTV0001', referralEligible: true });
  });

  it('chạm lỗi mạng: chưa biết (null), không vỡ', async () => {
    mocks.touch.mockRejectedValue(new Error('offline'));
    window.history.replaceState({}, '', '/?ref=ABC');
    await mount();
    expect(getStorefrontContext()).toMatchObject({ referralCode: 'ABC', referralEligible: null });
  });

  it('StorefrontTracker (trang gian hàng CTV): ghi gian hàng hợp lệ, chạm xong giữ kết quả máy chủ', async () => {
    mocks.touch.mockResolvedValue({ ok: false });
    const m = await mountKept(<StorefrontTracker slug="an" type="CTV" referralCode="AN123" />);
    expect(getStorefrontContext()).toMatchObject({ slug: 'an', referralCode: 'AN123', kind: 'CTV', referralEligible: false });
    await m.unmount();
  });

  it('StorefrontTracker: chạm bù cả link CTV mở trước khi chưa đăng nhập, trước nguồn đang dùng trong phiên', async () => {
    mocks.status = 'anonymous';
    mocks.touch.mockReset().mockImplementation(async (dto: { referralCode: string }) => ({ ok: dto.referralCode === 'ANHA' }));
    for (const url of ['/?ref=ANHA', '/?ref=KHACH01']) {
      window.history.replaceState({}, '', url);
      const m = await mountKept();
      await m.unmount();
    }
    window.history.replaceState({}, '', '/');
    mocks.status = 'authenticated';
    const t = await mountKept(<StorefrontTracker slug="doi-tac" type="MERCHANT" referralCode={null} />);
    expect(mocks.touch.mock.calls.map(([dto]) => dto)).toEqual([
      { referralCode: 'ANHA', kind: 'ctv' },
      { referralCode: 'KHACH01', storefrontSlug: 'doi-tac', kind: 'brand' },
    ]);
    expect(readPendingRefs()).toEqual([]);
    await t.unmount();
  });

  it('StorefrontTracker với gian hàng đối tác: không ghi bản chờ, không đổi mã đang có', async () => {
    mocks.touch.mockResolvedValue({ ok: true });
    window.history.replaceState({}, '', '/?ref=CTV0001');
    await mount();
    clearPendingRef();
    const m = await mountKept(<StorefrontTracker slug="doi-tac" type="MERCHANT" referralCode={null} />);
    expect(getStorefrontContext()).toMatchObject({ slug: 'doi-tac', referralCode: 'CTV0001', kind: 'MERCHANT', referralEligible: true });
    expect(readPendingRefs()).toEqual([]);
    await m.unmount();
  });
  it('đã ghi công mã CTV rồi mở gian hàng đối tác (cùng mã): không chạm lại kiểu brand, kẻo máy chủ xoá slug gian hàng CTV khỏi chạm', async () => {
    mocks.touch.mockResolvedValue({ ok: true });
    window.history.replaceState({}, '', '/?s=an-shop&ref=AN123');
    await mount();
    expect(mocks.touch).toHaveBeenCalledTimes(1);
    mocks.touch.mockClear();
    const t = await mountKept(<StorefrontTracker slug="doi-tac" type="MERCHANT" referralCode={null} />);
    expect(mocks.touch).not.toHaveBeenCalled();
    await t.unmount();
  });

  it('gian hàng đối tác mà mã chưa từng được ghi công như CTV: vẫn chạm kiểu brand', async () => {
    mocks.touch.mockResolvedValue({ ok: true });
    window.history.replaceState({}, '', '/?ref=KHAC99');
    mocks.status = 'anonymous';
    await mount();
    window.history.replaceState({}, '', '/');
    mocks.status = 'authenticated';
    const t = await mountKept(<StorefrontTracker slug="doi-tac" type="MERCHANT" referralCode={null} />);
    expect(mocks.touch).toHaveBeenCalledWith({ referralCode: 'KHAC99', storefrontSlug: 'doi-tac', kind: 'brand' });
    await t.unmount();
  });
});
