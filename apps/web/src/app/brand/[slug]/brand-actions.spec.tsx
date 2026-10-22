// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Cùng ý nghĩa brand-view.tsx của Mini App: theo dõi/bỏ theo dõi (cần đăng nhập), chia sẻ, dải chia sẻ kiếm tiền cho CTV đủ điều kiện,
// khối đại lý theo trạng thái hồ sơ.

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading' | 'unavailable',
  push: vi.fn(),
  retrySession: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  share: vi.fn(),
  follow: { following: false, followerCount: 12 } as { following: boolean; followerCount: number },
  ste: { eligible: false } as unknown,
  steError: false,
  dealer: { isDealer: false } as unknown,
  dealerReady: true,
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: mocks.retrySession }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post, delete: mocks.del } }));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { share: mocks.share } }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => (p === '/dai-ly' ? mocks.dealerReady : true) }));

import { BrandActions, BrandDealerBlock, BrandPromoCode } from './brand-actions';

let mounted: Rendered[] = [];
const mount = async (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  await flush(5);
  return r.container;
};
const actions = () => <BrandActions slug="sachi" name="Sachi" followerCount={12} />;
const btn = (root: ParentNode, name: string | RegExp) =>
  Array.from(root.querySelectorAll('button')).find((b) => {
    const t = (b.getAttribute('aria-label') ?? b.textContent ?? '').trim();
    return typeof name === 'string' ? t === name : name.test(t);
  });

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.follow = { following: false, followerCount: 12 };
  mocks.ste = { eligible: false };
  mocks.steError = false;
  mocks.dealer = { isDealer: false };
  mocks.dealerReady = true;
  mocks.push.mockReset();
  mocks.retrySession.mockReset();
  mocks.share.mockReset().mockResolvedValue('shared');
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/brand/sachi/follow-state') return mocks.follow;
    if (path === '/brand/sachi/share-to-earn') {
      if (mocks.steError) throw new Error('403');
      return mocks.ste;
    }
    if (path === '/dealer/me') return mocks.dealer;
    throw new Error(`chưa mock ${path}`);
  });
  mocks.post.mockReset().mockResolvedValue({ following: true, followerCount: 13 });
  mocks.del.mockReset().mockResolvedValue({ following: false, followerCount: 12 });
  window.history.replaceState(null, '', '/brand/sachi');
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('/brand/[slug] — theo dõi nhãn', () => {
  it('hiện số người theo dõi; số theo dõi bằng 0 thì ẩn dòng', async () => {
    const c = await mount(actions());
    expect(c.textContent).toContain('12 người theo dõi');
    mounted.pop()!.unmount();
    mocks.follow = { following: false, followerCount: 0 };
    const c2 = await mount(<BrandActions slug="sachi" name="Sachi" followerCount={0} />);
    expect(c2.textContent).not.toContain('người theo dõi');
  });

  it('Theo dõi gửi POST /brand/:slug/follow, báo đã theo dõi và cập nhật số người ngay', async () => {
    const c = await mount(actions());
    click(btn(c, 'Theo dõi')!);
    await flush(5);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/brand/sachi/follow');
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Đã theo dõi nhãn');
    expect(btn(c, 'Đang theo dõi')).toBeDefined();
    expect(c.textContent).toContain('13 người theo dõi');
  });

  it('đang theo dõi thì bấm lại gửi DELETE /brand/:slug/follow', async () => {
    mocks.follow = { following: true, followerCount: 12 };
    const c = await mount(actions());
    expect(btn(c, 'Đang theo dõi')!.getAttribute('aria-pressed')).toBe('true');
    click(btn(c, 'Đang theo dõi')!);
    await flush(5);
    expect(mocks.del).toHaveBeenCalledWith('/brand/sachi/follow');
    expect(mocks.post).not.toHaveBeenCalled();
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Đã bỏ theo dõi');
  });

  it('theo dõi lỗi: báo cần đăng nhập, nút giữ nguyên', async () => {
    mocks.post.mockRejectedValue(new Error('401'));
    const c = await mount(actions());
    click(btn(c, 'Theo dõi')!);
    await flush(5);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Cần đăng nhập để theo dõi nhãn.');
    expect(btn(c, 'Theo dõi')).toBeDefined();
  });

  it('khách chưa đăng nhập: Theo dõi sang đăng nhập rồi quay lại trang nhãn, không gọi API theo dõi/kiếm tiền (tránh 401)', async () => {
    mocks.phase = 'guest';
    window.history.replaceState(null, '', '/brand/sachi?utm=zalo');
    const c = await mount(actions());
    click(btn(c, 'Theo dõi')!);
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fbrand%2Fsachi%3Futm%3Dzalo');
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(c.textContent).toContain('12 người theo dõi');
  });

  it('phiên chập chờn: Theo dõi thử khôi phục phiên, không đưa khách đi đăng nhập lại', async () => {
    mocks.phase = 'unavailable';
    const c = await mount(actions());
    click(btn(c, 'Theo dõi')!);
    expect(mocks.retrySession).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe('/brand/[slug] — chia sẻ', () => {
  it('Chia sẻ mở sheet có link nhãn (không mã giới thiệu), QR, nút chia sẻ và sao chép; không có bài mẫu', async () => {
    const c = await mount(actions());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    click(btn(c, 'Chia sẻ')!);
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dlg.querySelector('h2')?.textContent).toBe('Chia sẻ nhãn hàng');
    expect(dlg.textContent).toContain(`${window.location.origin}/brand/sachi`);
    expect(dlg.textContent).not.toContain('ref=');
    expect(dlg.querySelector('[data-qr-placeholder], img[alt="QR"]')).not.toBeNull();
    expect(dlg.textContent).not.toContain('Lời đăng gợi ý');
    expect(unnamedControls(dlg)).toEqual([]);
    expect(smallTouchTargets(dlg)).toEqual([]);
  });

  it('nút chia sẻ trong sheet gọi cầu nối với đường dẫn nhãn', async () => {
    const c = await mount(actions());
    click(btn(c, 'Chia sẻ')!);
    click(btn(document.body, 'Chia sẻ qua thiết bị')!);
    await flush(2);
    expect(mocks.share).toHaveBeenCalledWith({ title: 'Cửa hàng Sachi', path: '/brand/sachi' });
  });

  it('Sao chép link chép link tuyệt đối và báo đã sao chép; chép lỗi thì nói chép tay', async () => {
    const c = await mount(actions());
    click(btn(c, 'Chia sẻ')!);
    click(btn(document.body, 'Sao chép link')!);
    await flush(3);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/brand/sachi`);
    expect(document.querySelector('[role="dialog"] [role="status"]')?.textContent).toBe('Đã sao chép');
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('x'));
    click(btn(document.body, 'Sao chép link')!);
    await flush(3);
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Không sao chép được');
  });

  it('nút Đóng đóng sheet', async () => {
    const c = await mount(actions());
    click(btn(c, 'Chia sẻ')!);
    click(btn(document.body, 'Đóng')!);
    await flush(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('/brand/[slug] — dải chia sẻ kiếm tiền', () => {
  const eligible = { eligible: true, maxAffiliateRate: 15, referralCode: 'AFF1', brandSlug: 'sachi' };

  it('không đủ điều kiện hoặc API lỗi: không có dải', async () => {
    const c = await mount(actions());
    expect(c.textContent).not.toContain('hoa hồng');
    mounted.pop()!.unmount();
    mocks.steError = true;
    const c2 = await mount(actions());
    expect(c2.textContent).not.toContain('Bấm để lấy link');
  });

  it('CTV đủ điều kiện: dải nêu hoa hồng tối đa, bấm mở sheet với link và bài mẫu mang mã giới thiệu', async () => {
    mocks.ste = eligible;
    const c = await mount(actions());
    const strip = btn(c, /nhận tới 15% hoa hồng/)!;
    expect(strip.textContent).toContain('Bấm để lấy link + lời đăng gắn mã giới thiệu của bạn.');
    click(strip);
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const link = `${window.location.origin}/brand/sachi?ref=AFF1`;
    expect(dlg.textContent).toContain(link);
    expect(dlg.textContent).toContain('Lời đăng gợi ý (chạm để sao chép)');
    expect(dlg.textContent).toContain(`Mình tin dùng Sachi \u{1F33F} Ghé xem & ưu đãi nha ${link}`);
    expect(dlg.textContent).toContain(`Sachi — hàng chính hãng, sống xanh \u{1F49A} ${link}`);
    click(btn(dlg, /^Mình tin dùng Sachi/)!);
    await flush(3);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`Mình tin dùng Sachi \u{1F33F} Ghé xem & ưu đãi nha ${link}`);
  });

  it('chia sẻ của CTV đi cùng đường dẫn có ?ref=, kèm bài mẫu đầu', async () => {
    mocks.ste = eligible;
    const c = await mount(actions());
    click(btn(c, 'Chia sẻ')!);
    click(btn(document.body, 'Chia sẻ qua thiết bị')!);
    await flush(2);
    expect(mocks.share).toHaveBeenCalledWith({
      title: 'Cửa hàng Sachi',
      text: 'Mình tin dùng Sachi \u{1F33F} Ghé xem & ưu đãi nha',
      path: '/brand/sachi?ref=AFF1',
    });
  });

  it('nhãn chưa có tỉ lệ hoa hồng: dải vẫn chia sẻ được, không in "nhận tới % hoa hồng"', async () => {
    mocks.ste = { ...eligible, maxAffiliateRate: 0 };
    const c = await mount(actions());
    const strip = btn(c, /^Chia sẻ nhãn này/)!;
    expect(strip.textContent).not.toContain('%');
    click(strip);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

describe('/brand/[slug] — chương trình đại lý', () => {
  const REWARDS = [{ id: 'd1', type: 'TOUR', title: 'Thưởng quý', description: 'Đạt chỉ tiêu', threshold: 50_000_000, period: 'QUARTER' }];
  const block = () => <BrandDealerBlock rewards={REWARDS} />;

  it('khách chưa đăng nhập vẫn thấy chương trình và nút "Đăng ký đại lý" như Mini App, không gọi /dealer/me', async () => {
    mocks.phase = 'guest';
    const c = await mount(block());
    expect(c.querySelector('h2')?.textContent).toBe('Chương trình đại lý');
    expect(c.textContent).toContain('Thưởng quý');
    expect(c.querySelector('a[href="/dai-ly"]')?.textContent).toBe('Đăng ký đại lý');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('khách lẻ đã đăng nhập (chưa có hồ sơ): thấy chương trình, nút "Đăng ký đại lý" dẫn /dai-ly', async () => {
    const c = await mount(block());
    expect(c.textContent).toContain('Thưởng quý');
    expect(c.querySelector('a[href="/dai-ly"]')?.textContent).toBe('Đăng ký đại lý');
  });

  it('khách lẻ đã đăng nhập: gọi /dealer/me để chọn chữ nút, chưa có hồ sơ thì "Đăng ký đại lý"', async () => {
    const c = await mount(block());
    expect(mocks.get).toHaveBeenCalledWith('/dealer/me');
    expect(c.querySelector('a[href="/dai-ly"]')?.textContent).toBe('Đăng ký đại lý');
  });

  it('/dealer/me lỗi hoặc hồ sơ bị từ chối: vẫn thấy chương trình, nút "Đăng ký đại lý" như Mini App', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/dealer/me') throw new Error('500');
      throw new Error(`chưa mock ${path}`);
    });
    const c = await mount(block());
    expect(mocks.get).toHaveBeenCalledWith('/dealer/me');
    expect(c.textContent).toContain('Thưởng quý');
    expect(c.querySelector('a[href="/dai-ly"]')?.textContent).toBe('Đăng ký đại lý');
    mounted.pop()!.unmount();
    mocks.get.mockClear();
    mocks.get.mockImplementation(async () => ({ isDealer: false, status: 'REJECTED' }));
    const c2 = await mount(block());
    expect(mocks.get).toHaveBeenCalledWith('/dealer/me');
    expect(c2.textContent).toContain('Thưởng quý');
    expect(c2.querySelector('a[href="/dai-ly"]')?.textContent).toBe('Đăng ký đại lý');
  });

  it('đại lý đã duyệt: thấy thưởng, nút "Vào kênh đại lý" dẫn /dai-ly', async () => {
    mocks.dealer = { isDealer: true, status: 'APPROVED' };
    const c = await mount(block());
    expect(c.querySelector('h2')?.textContent).toBe('Chương trình đại lý');
    expect(c.textContent).toContain('Thưởng quý');
    expect(c.textContent).toContain('Đạt doanh số 50.000.000đ / quý');
    expect(c.querySelector('a[href="/dai-ly"]')?.textContent).toBe('Vào kênh đại lý');
  });

  it('hồ sơ đang chờ duyệt: nút "Xem hồ sơ đại lý"', async () => {
    mocks.dealer = { isDealer: false, status: 'PENDING' };
    const c = await mount(block());
    expect(c.querySelector('a[href="/dai-ly"]')?.textContent).toBe('Xem hồ sơ đại lý');
  });

  it('route /dai-ly chưa làm xong: ẩn nút nhưng vẫn thấy chương trình', async () => {
    mocks.dealerReady = false;
    mocks.dealer = { isDealer: true, status: 'APPROVED' };
    const c = await mount(block());
    expect(c.textContent).toContain('Thưởng quý');
    expect(c.querySelector('a[href="/dai-ly"]')).toBeNull();
  });

  it('nhãn không có chương trình đại lý: không dựng gì và không gọi API', async () => {
    const c = await mount(<BrandDealerBlock rewards={[]} />);
    expect(c.textContent).toBe('');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('/brand/[slug] — mã giảm giá của khuyến mãi', () => {
  it('chạm nút chép mã vào clipboard rồi báo dán ở bước thanh toán', async () => {
    const c = await mount(<BrandPromoCode code="XANH10" />);
    click(btn(c, 'Sao chép mã XANH10')!);
    await flush(3);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('XANH10');
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Đã chép mã XANH10 — dán ở bước thanh toán');
  });

  it('chép không được thì hiện mã để khách tự nhập', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const c = await mount(<BrandPromoCode code="XANH10" />);
    click(btn(c, 'Sao chép mã XANH10')!);
    await flush(3);
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Mã giảm giá: XANH10');
  });

  it('không có mã thì không vẽ gì', async () => {
    const c = await mount(<BrandPromoCode code={null} />);
    expect(c.querySelector('button')).toBeNull();
  });
});
