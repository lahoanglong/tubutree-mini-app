// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import AdminPage from './page';
import { answerAsk, answerConfirm, click, confirmDialog, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';

// W96B (G3): khoá chạm đúp, hạn 4 giây và tải lại khi máy chủ từ chối (400/404/409) cho các lệnh ghi quyền/tiền của trang Quản trị:
// cấp vai trò, khoá/mở khoá tài khoản, duyệt/từ chối hồ sơ đại lý, tạo mã giảm giá, nhãn hàng. Mọi cú gọi API giả có thể giữ lại bằng một cổng.

const gate = <T = unknown,>() => {
  let resolve!: (v?: T) => void;
  const promise = new Promise<T>((r) => (resolve = r as (v?: T) => void));
  return { promise, resolve };
};
class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const USER = { id: 'u1', fullName: 'Nguyễn An', phone: '0944444444', role: 'CUSTOMER', pointsBalance: 12, createdAt: '2026-09-01T00:00:00.000Z', isBlocked: false };
const BLOCKED = { ...USER, id: 'u3', fullName: 'Trần Cường', phone: '0966666666', isBlocked: true, blockedReason: 'Farm voucher' };
const APP = {
  id: 'd1', businessName: 'Cửa hàng Xanh', ownerName: 'Lan', phone: '0911111111', address: '1 Lê Lợi', taxCode: null,
  hasCccdFront: false, hasCccdBack: false, hasStoreFront: false, applicantAffiliateRevoked: false, status: 'PENDING', createdAt: '2026-10-01T00:00:00.000Z',
};
const BRAND = {
  id: 'b1', slug: 'dua-ben-tre', name: 'Dừa Bến Tre', tagline: 'Ngọt thanh', logoUrl: null, coverUrl: null, story: null, origin: 'Bến Tre',
  certifications: [], isVerified: false, isPublished: false, followerCount: 5,
};

const mocks = vi.hoisted(() => ({
  users: [] as unknown[],
  dealerApps: [] as unknown[],
  dealerApps2: [] as unknown[],
  dealerTotal: 1,
  brands: [] as unknown[],
  brandProducts: [] as unknown[],
  promotions: [] as unknown[],
  calls: [] as string[],
  /** Cổng giữ lần gọi thứ n+ (đếm từ 1) của từng hàm đọc; không đặt thì trả ngay. */
  hold: {} as Record<string, { after: number; promise: Promise<unknown> } | undefined>,
  counts: {} as Record<string, number>,
  /** Lần gọi kế tiếp của hàm đọc này bị lỗi (một lần). */
  failNext: {} as Record<string, boolean>,
  setUserRole: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  reviewDealerApp: vi.fn(),
  createCoupon: vi.fn(),
  createBrand: vi.fn(),
  updateBrand: vi.fn(),
  verifyBrand: vi.fn(),
  linkBrandByName: vi.fn(),
  detachBrandProducts: vi.fn(),
  createPromotion: vi.fn(),
  deletePromotion: vi.fn(),
  searchAdminUsers: vi.fn(),
}));

/** Đếm lời gọi đọc và giữ lại từ lần thứ `after + 1` nếu có cổng. */
const read = async <T,>(name: string, value: () => T, args: unknown[] = []): Promise<T> => {
  mocks.calls.push(name);
  mocks.counts[name] = (mocks.counts[name] ?? 0) + 1;
  void args;
  if (mocks.failNext[name]) {
    mocks.failNext[name] = false;
    throw new HttpError('Máy chủ đang bận', 500);
  }
  const h = mocks.hold[name];
  if (h && mocks.counts[name]! > h.after) await h.promise;
  return value();
};

// Bọc useConfirm thật để đếm số lần `ask` được gọi: hộp lý do mở lại trên một hàng đã biến mất vô hình (dialog do thành phần đã unmount dựng) nên chỉ đếm lời gọi mới thấy.
vi.mock('@/components/admin/confirm-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/admin/confirm-dialog')>();
  return {
    ...actual,
    useConfirm: () => {
      const real = actual.useConfirm();
      return {
        ...real,
        ask: (...args: Parameters<typeof real.ask>) => {
          mocks.counts.ask = (mocks.counts.ask ?? 0) + 1;
          return real.ask(...args);
        },
      };
    },
  };
});
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { role: 'ADMIN' }, status: 'authenticated', initialized: true }),
  useViewerRole: () => 'ADMIN',
}));
vi.mock('@/lib/admin-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin-client')>();
  return {
    ...actual,
    getDashboardStats: async () => ({}),
    countRecyclingAttention: async () => 0,
    countPancakeAttention: async () => 0,
    listDealerRewardClaims: async () => ({ data: [], meta: { total: 0, page: 1, limit: 1 } }),
    listPayouts: async () => ({ data: [], meta: { total: 0, page: 1, limit: 1 } }),
    listCustomerRefunds: async () => ({ data: [], meta: { total: 0, page: 1, limit: 1 } }),
    getOpsInbox: async () => {
      mocks.counts.getOpsInbox = (mocks.counts.getOpsInbox ?? 0) + 1;
      const h = mocks.hold.getOpsInbox;
      if (h && mocks.counts.getOpsInbox > h.after) await h.promise;
      return { generatedAt: '2026-10-14T03:00:00.000Z', items: [{ key: 'dealerApplications', count: 1 }] };
    },
    getTodaySummary: async () => ({ orders: { today: 0, yesterday: 0, week: 0 }, revenue: { today: 0, yesterday: 0, week: 0 }, newUsers: { today: 0, yesterday: 0, week: 0 } }),
    getRetentionDaily: async () => [],
    getOpsAccess: async () => ({ role: 'ADMIN', staffPermissions: [] }),
    listUsers: (page: number, search?: string) => read('listUsers', () => ({ data: mocks.users, meta: { total: mocks.users.length, page: 1, limit: 20 }, guestCount: 0 }), [page, search]),
    listDealerApps: (...args: unknown[]) =>
      read(
        'listDealerApps',
        () =>
          args[1] === 2
            ? { data: mocks.dealerApps2, meta: { total: mocks.dealerTotal, page: 2, limit: 20 } }
            : { data: mocks.dealerApps, meta: { total: mocks.dealerTotal, page: 1, limit: 20 } },
        args,
      ),
    listDealerTiers: async () => [{ id: 't1', name: 'Bạc', minOrderVolume: 0, creditLimit: 0, paymentTerms: null }],
    listCoupons: (...args: unknown[]) => read('listCoupons', () => ({ data: [], meta: { total: 0, page: 1, limit: 20 } }), args),
    listReturnRequests: (...args: unknown[]) => read('listReturnRequests', () => ({ data: [], meta: { total: 45, page: 1, limit: 20 } }), args),
    listFlashSalesPage: (...args: unknown[]) => read('listFlashSalesPage', () => ({ items: [], nextCursor: 'cursor-1' }), args),
    listBrands: () => read('listBrands', () => mocks.brands),
    listBrandProducts: () => read('listBrandProducts', () => mocks.brandProducts),
    listPromotions: () => read('listPromotions', () => mocks.promotions),
    listDealerRewards: async () => [],
    searchAdminUsers: (...args: unknown[]) => mocks.searchAdminUsers(...args),
    setUserRole: (...args: unknown[]) => mocks.setUserRole(...args),
    blockUser: (...args: unknown[]) => mocks.blockUser(...args),
    unblockUser: (...args: unknown[]) => mocks.unblockUser(...args),
    reviewDealerApp: (...args: unknown[]) => mocks.reviewDealerApp(...args),
    createCoupon: (...args: unknown[]) => mocks.createCoupon(...args),
    createBrand: (...args: unknown[]) => mocks.createBrand(...args),
    updateBrand: (...args: unknown[]) => mocks.updateBrand(...args),
    verifyBrand: (...args: unknown[]) => mocks.verifyBrand(...args),
    linkBrandByName: (...args: unknown[]) => mocks.linkBrandByName(...args),
    detachBrandProducts: (...args: unknown[]) => mocks.detachBrandProducts(...args),
    createPromotion: (...args: unknown[]) => mocks.createPromotion(...args),
    deletePromotion: (...args: unknown[]) => mocks.deletePromotion(...args),
  };
});

let mounted: Rendered | null = null;
let client: QueryClient;
const mount = async (tab: string) => {
  window.history.replaceState(null, '', `/admin?tab=${tab}`);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mounted = render(<AdminPage />, client);
  await flush();
  return mounted.container;
};
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const reads = (name: string) => mocks.counts[name] ?? 0;
const btnByText = (root: ParentNode, label: RegExp | string) =>
  [...root.querySelectorAll('button')].find((b) => (typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? ''))) as HTMLButtonElement;
const byLabel = (root: ParentNode, label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const tap = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const el of els) el.click();
  });
};
const answer = async (text?: string) => {
  expect(confirmDialog()).not.toBeNull();
  if (text !== undefined) answerAsk(text);
  else answerConfirm(true);
  await flush();
};
const busy = (el: HTMLElement) => ({ busy: el.getAttribute('aria-busy'), disabled: el.getAttribute('aria-disabled'), real: (el as HTMLButtonElement).disabled });
const BUSY = { busy: 'true', disabled: 'true', real: false };

beforeEach(() => {
  mocks.users = [USER];
  mocks.dealerApps = [APP];
  mocks.dealerApps2 = [];
  mocks.dealerTotal = 1;
  mocks.brands = [BRAND];
  mocks.brandProducts = [{ id: 'p1', name: 'Dừa sáp', slug: 'dua-sap', thumbnail: null, brand: 'Dừa Bến Tre', isActive: true }];
  mocks.promotions = [{ id: 'pm1', title: 'MUA 2 TẶNG 1', subtitle: 'Hè', startAt: '', endAt: '', isActive: true }];
  mocks.calls = [];
  mocks.counts = {};
  mocks.hold = {};
  mocks.failNext = {};
  for (const fn of [
    mocks.setUserRole, mocks.blockUser, mocks.unblockUser, mocks.reviewDealerApp, mocks.createCoupon, mocks.createBrand, mocks.updateBrand,
    mocks.verifyBrand, mocks.linkBrandByName, mocks.detachBrandProducts, mocks.createPromotion, mocks.deletePromotion, mocks.searchAdminUsers,
  ]) fn.mockReset();
  window.localStorage.setItem(
    'tubu_admin_nav_open',
    JSON.stringify(['Hay dùng', 'Tổng quan', 'Bán hàng', 'Khách hàng', 'Khuyến mãi và điểm', 'Đổi rác và game', 'Đại lý và đối tác', 'Nội dung', 'Nhân sự', 'Cài đặt']),
  );
});
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.removeItem('tubu_admin_nav_open');
  mounted?.unmount();
  mounted = null;
});


const tick = async (n = 6) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};
const messageOf = (c: HTMLElement) => c.querySelector('p[role="status"]');

describe.each([
  { kind: 'khoá', user: USER, label: 'Khoá Nguyễn An', reason: 'Bom hàng COD', api: () => mocks.blockUser, done: 'Đã khoá Nguyễn An' },
  { kind: 'mở khoá', user: BLOCKED, label: 'Mở khoá Trần Cường', reason: 'Đã xác minh với khách', api: () => mocks.unblockUser, done: 'Đã mở khoá Trần Cường' },
])('Người dùng: $kind tài khoản', ({ user, label, reason, api, done }) => {
  const open = async () => {
    mocks.users = [user];
    return mount('users');
  };
  const start = async (c: HTMLElement) => {
    click(byLabel(c, label));
    await flush();
    await answer(reason);
  };
  const listGate = (after = 1) => {
    const g = gate();
    mocks.hold.listUsers = { after, promise: g.promise };
    return g;
  };

  it('xác nhận xong, chạm tiếp ngay trong cùng khung hình: không mở hộp xác nhận thứ hai và chỉ gửi một lệnh', async () => {
    const g = gate();
    api().mockReturnValue(g.promise);
    const c = await open();
    click(byLabel(c, label));
    await flush();
    typeInto(confirmDialog()!.querySelector('textarea'), reason);
    const accept = confirmDialog()!.querySelector<HTMLElement>('[data-confirm="accept"]')!;
    await act(async () => {
      accept.click();
      await tick();
      byLabel(c, label).click();
    });
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(api()).toHaveBeenCalledTimes(1);
    g.resolve({});
    await flush();
  });

  it('khoá admin khác (hộp việc) tải lại treo: khoá nút vẫn nhả khi danh sách người dùng về, không chờ hạn 4 giây', async () => {
    api().mockResolvedValue({});
    const c = await open();
    mocks.hold.getOpsInbox = { after: reads('getOpsInbox'), promise: new Promise(() => {}) };
    await start(c);
    await flush();
    expect(api()).toHaveBeenCalledTimes(1);
    expect(reads('getOpsInbox')).toBeGreaterThan(1);
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(false);
    await flush();
  });

  it('lệnh xong mà danh sách chưa làm mới về: báo thành công ngay, nút vẫn khoá, chạm không mở hộp hay gửi lệnh; về rồi mới nhả', async () => {
    api().mockResolvedValue({});
    const list = listGate();
    const c = await open();
    await start(c);
    expect(api()).toHaveBeenCalledTimes(1);
    expect(messageOf(c)?.textContent).toContain(done);
    expect(reads('listUsers')).toBe(2);
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(api()).toHaveBeenCalledTimes(1);
    list.resolve();
    await flush();
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).not.toBeNull();
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    api().mockResolvedValue({});
    listGate();
    const c = await open();
    await start(c);
    await advance(3_500);
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).toBeNull();
    await advance(600);
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).not.toBeNull();
  });

  it('bị từ chối 409: lời lỗi hiện ngay, tải lại danh sách và giữ khoá tới khi danh sách về', async () => {
    api().mockRejectedValue(new HttpError('Trạng thái tài khoản vừa đổi.', 409));
    const list = listGate();
    const c = await open();
    await start(c);
    const msg = messageOf(c)!;
    expect(msg.textContent).toBe('Trạng thái tài khoản vừa đổi.');
    expect(msg.className).toContain('text-danger-fg');
    expect(reads('listUsers')).toBe(2);
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).toBeNull();
    list.resolve();
    await flush();
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).not.toBeNull();
  });

  it('bị từ chối 404 (người dùng không còn): hiện lỗi, tải lại danh sách', async () => {
    api().mockRejectedValue(new HttpError('Không còn nữa.', 404));
    const c = await open();
    await start(c);
    expect(reads('listUsers')).toBe(2);
    expect(messageOf(c)?.textContent).toBe('Không còn nữa.');
  });

  // Lệnh có ô lý do do admin gõ (DTO MinLength 3 / MaxLength 500 sau khi cắt khoảng trắng và ký tự vô hình): 400 là lỗi nhập, tải lại danh sách không sửa được nó.
  it('bị từ chối 400 (lý do không hợp lệ): hiện lỗi ngay, KHÔNG tải lại danh sách, nhả khoá ngay', async () => {
    api().mockRejectedValue(new HttpError('Lý do cần ít nhất 3 ký tự.', 400));
    const c = await open();
    await start(c);
    expect(messageOf(c)?.textContent).toBe('Lý do cần ít nhất 3 ký tự.');
    expect(messageOf(c)?.className).toContain('text-danger-fg');
    expect(reads('listUsers')).toBe(1);
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).not.toBeNull();
  });

  // Máy chủ có thể đã ghi trước khi trả lỗi: skipAdminInvalidate tắt lần làm mới của MutationCache nên chính lệnh phải tải lại, nhưng không bắt khoá chờ.
  it.each([401, 403, 500, 503, 504])('lỗi %i: hiện lỗi, tải lại danh sách (không chờ), nhả khoá ngay', async (status) => {
    api().mockRejectedValue(new HttpError('Máy chủ từ chối.', status));
    const c = await open();
    await start(c);
    expect(messageOf(c)?.textContent).toBe('Máy chủ từ chối.');
    expect(reads('listUsers')).toBe(2);
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).not.toBeNull();
  });

  it('mất mạng: hiện lỗi, tải lại danh sách, nhả khoá ngay', async () => {
    api().mockRejectedValue(new TypeError('Failed to fetch'));
    const c = await open();
    await start(c);
    expect(messageOf(c)?.className).toContain('text-danger-fg');
    expect(reads('listUsers')).toBe(2);
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).not.toBeNull();
  });

  it('504 mà lần tải lại danh sách treo: khoá vẫn nhả ngay (không chờ lần tải lại), danh sách đã được hỏi lại', async () => {
    api().mockRejectedValue(new HttpError('Cổng máy chủ hết hạn.', 504));
    listGate();
    const c = await open();
    await start(c);
    await flush();
    expect(reads('listUsers')).toBe(2);
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(false);
    await flush();
  });

  it('tải lại sau khi bị từ chối cũng treo: nhả sau hạn 4 giây', async () => {
    useHangTimers();
    api().mockRejectedValue(new HttpError('Trạng thái tài khoản vừa đổi.', 409));
    listGate();
    const c = await open();
    await start(c);
    await advance(3_500);
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).toBeNull();
    await advance(600);
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).not.toBeNull();
  });

  it('huỷ hộp xác nhận thì không khoá: bấm lại mở được hộp', async () => {
    const c = await open();
    click(byLabel(c, label));
    await flush();
    answerConfirm(false);
    await flush();
    expect(api()).not.toHaveBeenCalled();
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).not.toBeNull();
  });

  it('lý do quá ngắn thì không khoá: báo lỗi rồi bấm lại mở được hộp', async () => {
    const c = await open();
    click(byLabel(c, label));
    await flush();
    await answer('ab');
    expect(api()).not.toHaveBeenCalled();
    expect(messageOf(c)?.textContent).toContain('cần ít nhất 3 ký tự');
    click(byLabel(c, label));
    await flush();
    expect(confirmDialog()).not.toBeNull();
  });
});

describe.each([
  { kind: 'khoá', user: USER, label: 'Khoá Nguyễn An', reason: 'Bom hàng COD', api: () => mocks.blockUser },
  { kind: 'mở khoá', user: BLOCKED, label: 'Mở khoá Trần Cường', reason: 'Đã xác minh với khách', api: () => mocks.unblockUser },
])('Người dùng: danh sách tải lại đúng một lần sau $kind với QueryClient của web', ({ user, label, reason, api }) => {
  it('một lần tải lại danh sách (lần của lệnh, không thêm lần từ MutationCache)', async () => {
    const { createQueryClient } = await import('@/lib/query-client');
    mocks.users = [user];
    api().mockResolvedValue({});
    window.history.replaceState(null, '', '/admin?tab=users');
    client = createQueryClient();
    mounted = render(<AdminPage />, client);
    await flush();
    const before = reads('listUsers');
    click(byLabel(mounted.container, label));
    await flush();
    await answer(reason);
    // MutationCache.onSettled (nếu không bị skipAdminInvalidate) làm mới SAU khi lần của lệnh xong: đợi cho hàng đợi yên rồi mới đếm.
    await new Promise((r) => setTimeout(r, 80));
    await flush();
    expect(reads('listUsers') - before).toBe(1);
  });

  it('vẫn làm mới các khoá admin khác như MutationCache toàn cục (hộp việc cũng tải lại)', async () => {
    const { createQueryClient } = await import('@/lib/query-client');
    mocks.users = [user];
    api().mockResolvedValue({});
    window.history.replaceState(null, '', '/admin?tab=users');
    client = createQueryClient();
    mounted = render(<AdminPage />, client);
    await flush();
    const before = reads('getOpsInbox');
    expect(before).toBeGreaterThan(0);
    click(byLabel(mounted.container, label));
    await flush();
    await answer(reason);
    expect(reads('getOpsInbox')).toBeGreaterThan(before);
  });
});

describe('Cấp / đổi vai trò theo SĐT', () => {
  const PHONE = '0955555555';
  const fill = (c: HTMLElement, role = 'CUSTOMER') => {
    typeInto(c.querySelector('input[placeholder^="SĐT"]'), PHONE);
    selectValue(c.querySelector('select[aria-label="Vai trò cần cấp"]'), role);
  };
  const grantBtn = (c: HTMLElement) => btnByText(c, /^(Cấp quyền|Đang lưu…)$/);
  const okRole = { id: 'u9', phone: PHONE, previousRole: 'CUSTOMER', role: 'STAFF' };
  /** Lần tải danh sách thứ 1 là lúc mở tab, lần 2 là tra vai trò theo SĐT, lần 3 là tải lại sau lệnh. */
  const refreshGate = () => {
    const g = gate();
    mocks.hold.listUsers = { after: 2, promise: g.promise };
    return g;
  };
  const submit = async (c: HTMLElement) => {
    click(grantBtn(c));
    await flush();
    await answer('Nhân viên mới');
  };

  it('chạm đúp "Cấp quyền" trong cùng khung hình: một lần tra vai trò, một hộp xác nhận, một lệnh', async () => {
    mocks.setUserRole.mockResolvedValue(okRole);
    const c = await mount('users');
    fill(c);
    const before = reads('listUsers');
    const b = grantBtn(c);
    await tap(b, b);
    await flush();
    expect(reads('listUsers') - before).toBe(1);
    expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    await answer('Nhân viên mới');
    expect(mocks.setUserRole).toHaveBeenCalledTimes(1);
    expect(mocks.setUserRole).toHaveBeenCalledWith(PHONE, 'CUSTOMER', 'Nhân viên mới', undefined);
  });

  it('đang tra vai trò theo SĐT (trước hộp lý do): nút đã báo bận, chạm tiếp không tra thêm', async () => {
    const g = gate();
    mocks.hold.listUsers = { after: 1, promise: g.promise };
    const c = await mount('users');
    fill(c);
    click(grantBtn(c));
    await flush();
    expect(reads('listUsers')).toBe(2);
    expect(busy(grantBtn(c))).toEqual(BUSY);
    await tap(grantBtn(c));
    await flush();
    expect(reads('listUsers')).toBe(2);
    g.resolve();
    await flush();
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(false);
    await flush();
  });

  it('đang đổi vai trò: nút báo bận bằng aria-busy + aria-disabled, không disabled', async () => {
    const g = gate();
    mocks.setUserRole.mockReturnValue(g.promise);
    const c = await mount('users');
    fill(c);
    await submit(c);
    expect(busy(grantBtn(c))).toEqual(BUSY);
    expect(grantBtn(c).textContent).toBe('Đang lưu…');
    g.resolve(okRole);
    await flush();
  });

  it('lệnh xong mà danh sách chưa về: form đã xoá nhưng nút vẫn bận (không disabled); nhập lại và chạm không tra, không mở hộp; về rồi mới nhả', async () => {
    mocks.setUserRole.mockResolvedValue(okRole);
    const list = refreshGate();
    const c = await mount('users');
    fill(c);
    await submit(c);
    expect(mocks.setUserRole).toHaveBeenCalledTimes(1);
    expect(c.textContent).toContain('Đã đổi 0955555555');
    expect(c.querySelector<HTMLInputElement>('input[placeholder^="SĐT"]')!.value).toBe('');
    expect(c.querySelector<HTMLSelectElement>('select[aria-label="Vai trò cần cấp"]')!.value).toBe('');
    expect(busy(grantBtn(c))).toEqual(BUSY);
    fill(c);
    const lookups = reads('listUsers');
    await tap(grantBtn(c));
    await flush();
    expect(reads('listUsers')).toBe(lookups);
    expect(confirmDialog()).toBeNull();
    list.resolve();
    await flush();
    expect(busy(grantBtn(c))).toEqual({ busy: null, disabled: null, real: false });
    click(grantBtn(c));
    await flush();
    expect(confirmDialog()).not.toBeNull();
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    mocks.setUserRole.mockResolvedValue(okRole);
    mocks.hold.listUsers = { after: 2, promise: new Promise(() => {}) };
    const c = await mount('users');
    fill(c);
    await submit(c);
    await advance(3_500);
    fill(c);
    const lookups = reads('listUsers');
    await tap(grantBtn(c));
    await flush();
    expect(reads('listUsers')).toBe(lookups);
    await advance(600);
    await tap(grantBtn(c));
    await flush();
    // Danh sách vẫn bị giữ nên lần tra vai trò này treo, nhưng nó chỉ chạy được khi khoá đã nhả.
    expect(reads('listUsers')).toBe(lookups + 1);
  });

  it.each([404, 409])('bị từ chối %i: lời lỗi hiện ngay, tải lại danh sách, giữ khoá tới khi danh sách về', async (status) => {
    mocks.setUserRole.mockRejectedValue(new HttpError('Không tìm thấy người dùng với SĐT này.', status));
    const list = refreshGate();
    const c = await mount('users');
    fill(c);
    await submit(c);
    const bad = [...c.querySelectorAll('p')].find((p) => p.textContent === 'Không tìm thấy người dùng với SĐT này.')!;
    expect(bad.className).toContain('text-danger-fg');
    expect(reads('listUsers')).toBe(3);
    expect(busy(grantBtn(c)).busy).toBe('true');
    await tap(grantBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    list.resolve();
    await flush();
    expect(busy(grantBtn(c)).busy).toBeNull();
  });

  // Lệnh có ô người dùng nhập (SĐT, vai trò, bậc, lý do): 400 là lỗi nhập, tải lại danh sách không sửa được và lời lỗi đã nằm ngay dưới form.
  it('bị từ chối 400 (SĐT không hợp lệ): lời lỗi hiện ngay dưới form, KHÔNG tải lại danh sách, nhả khoá ngay, form còn nguyên', async () => {
    mocks.setUserRole.mockRejectedValue(new HttpError('SĐT không hợp lệ.', 400));
    const c = await mount('users');
    fill(c);
    await submit(c);
    const bad = [...c.querySelectorAll('p')].find((p) => p.textContent === 'SĐT không hợp lệ.')!;
    expect(bad.className).toContain('text-danger-fg');
    expect(reads('listUsers')).toBe(2);
    expect(busy(grantBtn(c))).toEqual({ busy: null, disabled: null, real: false });
    expect(c.querySelector<HTMLInputElement>('input[placeholder^="SĐT"]')!.value).toBe(PHONE);
  });

  it.each([401, 403, 500])('lỗi %i: hiện lỗi, lệnh KHÔNG tự tải lại danh sách (QueryClient trần không có MutationCache; production vẫn làm cũ khoá admin-* ở lỗi này), nhả khoá ngay (form còn nguyên)', async (status) => {
    mocks.setUserRole.mockRejectedValue(new HttpError('Máy chủ từ chối.', status));
    const c = await mount('users');
    fill(c);
    await submit(c);
    expect([...c.querySelectorAll('p')].some((p) => p.textContent === 'Máy chủ từ chối.')).toBe(true);
    expect(reads('listUsers')).toBe(2);
    expect(busy(grantBtn(c))).toEqual({ busy: null, disabled: null, real: false });
  });

  it('tải lại sau khi bị từ chối cũng treo: nhả sau hạn 4 giây', async () => {
    useHangTimers();
    mocks.setUserRole.mockRejectedValue(new HttpError('Vai trò vừa đổi.', 409));
    mocks.hold.listUsers = { after: 2, promise: new Promise(() => {}) };
    const c = await mount('users');
    fill(c);
    await submit(c);
    await advance(3_500);
    expect(busy(grantBtn(c)).busy).toBe('true');
    await advance(600);
    expect(busy(grantBtn(c)).busy).toBeNull();
  });

  it('huỷ hộp lý do thì nhả khoá: bấm lại tra vai trò và mở hộp mới', async () => {
    const c = await mount('users');
    fill(c);
    click(grantBtn(c));
    await flush();
    answerConfirm(false);
    await flush();
    expect(mocks.setUserRole).not.toHaveBeenCalled();
    const before = reads('listUsers');
    click(grantBtn(c));
    await flush();
    expect(reads('listUsers') - before).toBe(1);
    expect(confirmDialog()).not.toBeNull();
  });

  it('lý do quá ngắn thì nhả khoá và báo lỗi', async () => {
    const c = await mount('users');
    fill(c);
    click(grantBtn(c));
    await flush();
    await answer('ab');
    expect(mocks.setUserRole).not.toHaveBeenCalled();
    expect(c.textContent).toContain('Lý do đổi vai trò cần ít nhất 3 ký tự.');
    click(grantBtn(c));
    await flush();
    expect(confirmDialog()).not.toBeNull();
  });

  it('form chưa hợp lệ vẫn disabled thật khi không bận', async () => {
    const c = await mount('users');
    expect(grantBtn(c).disabled).toBe(true);
    typeInto(c.querySelector('input[placeholder^="SĐT"]'), PHONE);
    expect(grantBtn(c).disabled).toBe(true);
    selectValue(c.querySelector('select[aria-label="Vai trò cần cấp"]'), 'CUSTOMER');
    expect(grantBtn(c).disabled).toBe(false);
  });
});


describe('Hồ sơ đại lý: duyệt / từ chối', () => {
  const approveBtn = (c: HTMLElement) => btnByText(c, 'Duyệt');
  const rejectBtn = (c: HTMLElement) => btnByText(c, 'Từ chối');
  const open = async () => {
    const c = await mount('dealers');
    selectValue(c.querySelector('select[aria-label="Bậc đại lý"]'), 't1');
    return c;
  };
  /** Lần tải 1 là lúc mở tab; các lần sau (tải lại sau lệnh) bị giữ. */
  const listGate = () => {
    const g = gate();
    mocks.hold.listDealerApps = { after: 1, promise: g.promise };
    return g;
  };
  const rowOf = (c: HTMLElement) => approveBtn(c).closest('div.rounded-card')!;
  const alertText = (c: HTMLElement) => [...c.querySelectorAll('[role="alert"]')].map((a) => a.textContent).join('|');
  const rejectWith = async (c: HTMLElement, reason = 'Ảnh CCCD bị mờ') => {
    click(rejectBtn(c));
    await flush();
    await answer(reason);
  };

  it('chạm đúp "Duyệt" trong cùng khung hình chỉ gửi một lệnh', async () => {
    mocks.reviewDealerApp.mockResolvedValue({});
    const c = await open();
    const b = approveBtn(c);
    await tap(b, b);
    await flush();
    expect(mocks.reviewDealerApp).toHaveBeenCalledTimes(1);
    expect(mocks.reviewDealerApp).toHaveBeenCalledWith('d1', true, 't1', undefined);
  });

  it('đang duyệt: Duyệt và Từ chối báo bận bằng aria-busy/aria-disabled (không disabled), chạm Từ chối không mở hộp', async () => {
    const g = gate();
    mocks.reviewDealerApp.mockReturnValue(g.promise);
    const c = await open();
    click(approveBtn(c));
    await flush();
    expect(busy(approveBtn(c))).toEqual(BUSY);
    expect(busy(rejectBtn(c)).disabled).toBe('true');
    expect(busy(rejectBtn(c)).real).toBe(false);
    click(rejectBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    g.resolve({});
    await flush();
  });

  it('duyệt xong mà danh sách chưa về: nút còn bận, chạm tiếp không gửi lệnh; về rồi mới nhả', async () => {
    mocks.reviewDealerApp.mockResolvedValue({});
    const list = listGate();
    const c = await open();
    click(approveBtn(c));
    await flush();
    expect(reads('listDealerApps')).toBe(2);
    expect(busy(approveBtn(c)).busy).toBe('true');
    await tap(approveBtn(c));
    await flush();
    expect(mocks.reviewDealerApp).toHaveBeenCalledTimes(1);
    list.resolve();
    await flush();
    expect(busy(approveBtn(c)).busy).toBeNull();
    click(approveBtn(c));
    await flush();
    expect(mocks.reviewDealerApp).toHaveBeenCalledTimes(2);
  });

  it('danh sách không bao giờ về: còn bận ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    mocks.reviewDealerApp.mockResolvedValue({});
    mocks.hold.listDealerApps = { after: 1, promise: new Promise(() => {}) };
    const c = await open();
    click(approveBtn(c));
    await flush();
    await advance(3_500);
    expect(busy(approveBtn(c)).busy).toBe('true');
    await advance(600);
    expect(busy(approveBtn(c)).busy).toBeNull();
  });

  it('duyệt bị từ chối 409 (hồ sơ đã được admin khác xử lý): lời lỗi hiện ngoài hàng, tải lại danh sách và lời lỗi không mất khi hàng biến mất', async () => {
    mocks.reviewDealerApp.mockImplementation(async () => {
      mocks.dealerApps = [];
      throw new HttpError('Hồ sơ đã được xử lý.', 409);
    });
    const c = await open();
    const row = rowOf(c);
    click(approveBtn(c));
    await flush();
    expect(reads('listDealerApps')).toBe(2);
    expect(c.textContent).not.toContain('Cửa hàng Xanh');
    expect(alertText(c)).toContain('Hồ sơ đã được xử lý.');
    expect(row.isConnected).toBe(false);
    expect(c.querySelector('[role="alert"]')?.className).toContain('text-danger-fg');
  });

  it('lỗi cũ của lần duyệt trước biến mất ngay khi lần duyệt mới bắt đầu', async () => {
    const g = gate();
    mocks.reviewDealerApp.mockRejectedValueOnce(new HttpError('Máy chủ đang bận', 500));
    mocks.reviewDealerApp.mockReturnValueOnce(g.promise);
    const c = await open();
    click(approveBtn(c));
    await flush();
    expect(alertText(c)).toBe('Máy chủ đang bận');
    click(approveBtn(c));
    await flush();
    expect(mocks.reviewDealerApp).toHaveBeenCalledTimes(2);
    expect(alertText(c)).toBe('');
    g.resolve({});
    await flush();
  });

  it('duyệt bị từ chối: giữ khoá tới khi danh sách tải lại về, kể cả khi lời lỗi đã hiện', async () => {
    mocks.reviewDealerApp.mockRejectedValue(new HttpError('Hồ sơ đã được xử lý.', 409));
    const list = listGate();
    const c = await open();
    click(approveBtn(c));
    await flush();
    expect(alertText(c)).toContain('Hồ sơ đã được xử lý.');
    expect(busy(approveBtn(c)).busy).toBe('true');
    await tap(approveBtn(c));
    await flush();
    expect(mocks.reviewDealerApp).toHaveBeenCalledTimes(1);
    list.resolve();
    await flush();
    expect(busy(approveBtn(c)).busy).toBeNull();
  });

  it('duyệt bị từ chối mà tải lại treo: nhả sau hạn 4 giây', async () => {
    useHangTimers();
    mocks.reviewDealerApp.mockRejectedValue(new HttpError('Hồ sơ đã được xử lý.', 404));
    mocks.hold.listDealerApps = { after: 1, promise: new Promise(() => {}) };
    const c = await open();
    click(approveBtn(c));
    await flush();
    await advance(3_500);
    expect(busy(approveBtn(c)).busy).toBe('true');
    await advance(600);
    expect(busy(approveBtn(c)).busy).toBeNull();
  });

  it.each([400, 404])('duyệt bị từ chối %i cũng tải lại danh sách', async (status) => {
    mocks.reviewDealerApp.mockRejectedValue(new HttpError('Hồ sơ không còn chờ duyệt.', status));
    const c = await open();
    click(approveBtn(c));
    await flush();
    expect(reads('listDealerApps')).toBe(2);
  });

  it.each([401, 403, 500])('duyệt lỗi %i: hiện lỗi, lệnh KHÔNG tự tải lại danh sách hồ sơ (QueryClient trần; production vẫn làm cũ khoá admin-* qua MutationCache), nhả khoá ngay', async (status) => {
    mocks.reviewDealerApp.mockRejectedValue(new HttpError('Máy chủ từ chối.', status));
    const c = await open();
    click(approveBtn(c));
    await flush();
    expect(alertText(c)).toContain('Máy chủ từ chối.');
    expect(reads('listDealerApps')).toBe(1);
    expect(busy(approveBtn(c)).busy).toBeNull();
  });

  it('duyệt lỗi vẫn hỏi lại hộp việc để số Chờ duyệt không cũ', async () => {
    mocks.reviewDealerApp.mockRejectedValue(new HttpError('Máy chủ từ chối.', 500));
    const c = await open();
    const before = reads('getOpsInbox');
    click(approveBtn(c));
    await flush();
    expect(reads('getOpsInbox')).toBeGreaterThan(before);
  });

  it('từ chối bị 409 mà hồ sơ vẫn còn: hộp lý do mở lại với lý do đã gõ và dòng lỗi, danh sách đã tải lại', async () => {
    mocks.reviewDealerApp.mockRejectedValueOnce(new HttpError('Hồ sơ vừa đổi.', 409));
    const c = await open();
    await rejectWith(c);
    expect(reads('listDealerApps')).toBe(2);
    const dialog = confirmDialog()!;
    expect(dialog.querySelector('textarea')!.value).toBe('Ảnh CCCD bị mờ');
    expect(dialog.querySelector('[data-input-error]')!.textContent).toBe('Hồ sơ vừa đổi.');
    mocks.reviewDealerApp.mockResolvedValueOnce({});
    answerConfirm(true);
    await flush();
    expect(mocks.reviewDealerApp).toHaveBeenCalledTimes(2);
  });

  it('từ chối bị 409 mà hồ sơ đã biến mất: không mở lại hộp, lời lỗi ở ngoài hàng', async () => {
    mocks.reviewDealerApp.mockImplementation(async () => {
      mocks.dealerApps = [];
      throw new HttpError('Hồ sơ đã được xử lý.', 409);
    });
    const c = await open();
    await rejectWith(c);
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(c.textContent).not.toContain('Cửa hàng Xanh');
    expect(alertText(c)).toContain('Hồ sơ đã được xử lý.');
    expect(mocks.reviewDealerApp).toHaveBeenCalledTimes(1);
  });

  it('hàng đã unmount (đổi bộ lọc) trong lúc lệnh từ chối còn bay: bị từ chối thì KHÔNG gọi ask lần hai (hộp sẽ do thành phần đã chết dựng, vô hình, lời hứa treo mãi)', async () => {
    let rejectNow!: (e: unknown) => void;
    mocks.reviewDealerApp.mockImplementation(() => new Promise((_, rej) => (rejectNow = rej)));
    const list = gate();
    mocks.hold.listDealerApps = { after: 1, promise: list.promise };
    const c = await open();
    await rejectWith(c);
    expect(reads('ask')).toBe(1);
    click(btnByText(c, 'Đã duyệt'));
    await flush();
    expect(c.textContent).not.toContain('Cửa hàng Xanh');
    rejectNow(new HttpError('Hồ sơ đã được xử lý.', 409));
    await flush();
    list.resolve();
    await flush();
    expect(reads('ask')).toBe(1);
    expect(confirmDialog()).toBeNull();
    expect(alertText(c)).toContain('Hồ sơ đã được xử lý.');
  });

  it('từ chối: chạm lại Từ chối trong lúc lệnh còn bay không mở hộp thứ hai', async () => {
    const g = gate();
    mocks.reviewDealerApp.mockReturnValue(g.promise);
    const c = await open();
    await rejectWith(c);
    expect(mocks.reviewDealerApp).toHaveBeenCalledTimes(1);
    expect(busy(rejectBtn(c)).disabled).toBe('true');
    click(rejectBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    g.resolve({});
    await flush();
  });

  it('từ chối xong mà danh sách chưa về: vẫn khoá; về rồi mới nhả', async () => {
    mocks.reviewDealerApp.mockResolvedValue({});
    const list = listGate();
    const c = await open();
    await rejectWith(c);
    expect(busy(rejectBtn(c)).disabled).toBe('true');
    click(rejectBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    list.resolve();
    await flush();
    expect(busy(rejectBtn(c)).disabled).toBeNull();
  });

  it('huỷ hộp lý do thì không khoá: chạm lại mở hộp mới', async () => {
    const c = await open();
    click(rejectBtn(c));
    await flush();
    answerConfirm(false);
    await flush();
    click(rejectBtn(c));
    await flush();
    expect(confirmDialog()).not.toBeNull();
  });

  it('Duyệt vẫn disabled thật khi chưa chọn bậc (không phải bận)', async () => {
    const c = await mount('dealers');
    expect(approveBtn(c).disabled).toBe(true);
    expect(approveBtn(c).title).toBe('Cần chọn bậc đại lý để duyệt');
    selectValue(c.querySelector('select[aria-label="Bậc đại lý"]'), 't1');
    expect(approveBtn(c).disabled).toBe(false);
  });
});

describe('Hồ sơ đại lý: Tải thêm và Thử lại', () => {
  const more = (c: HTMLElement) => btnByText(c, /^(Tải thêm|Đang tải…)$/);

  it('Tải thêm: chạm đúp trong cùng khung hình chỉ tải một trang; nút báo bận bằng aria-busy, không disabled', async () => {
    mocks.dealerTotal = 45;
    const g = gate();
    mocks.hold.listDealerApps = { after: 1, promise: g.promise };
    const c = await mount('dealers');
    const b = more(c);
    await tap(b, b);
    await flush();
    expect(reads('listDealerApps')).toBe(2);
    expect(busy(more(c))).toEqual({ busy: 'true', disabled: 'true', real: false });
    g.resolve();
    await flush();
  });

  it('Tải thêm: tải xong thì nhả, chạm lại tải trang kế', async () => {
    mocks.dealerTotal = 45;
    mocks.dealerApps2 = [{ ...APP, id: 'd2', businessName: 'Cửa hàng Vàng' }];
    const c = await mount('dealers');
    click(more(c));
    await flush();
    expect(c.textContent).toContain('Cửa hàng Vàng');
    expect(busy(more(c))).toEqual({ busy: null, disabled: null, real: false });
  });

  it('Tải thêm: màn dựng lại (usePressLock mất ref) lúc trang kế còn bay: chạm "Đang tải…" không gọi API lần hai', async () => {
    mocks.dealerTotal = 45;
    const g = gate();
    mocks.hold.listDealerApps = { after: 1, promise: g.promise };
    const first = await mount('dealers');
    click(more(first));
    await flush();
    expect(reads('listDealerApps')).toBe(2);
    // Cùng QueryClient: lần tải trang 2 vẫn bay trong cache khi màn mới dựng, nhưng nút mới có ref khoá rỗng.
    mounted!.unmount();
    mounted = render(<AdminPage />, client);
    await flush();
    const c = mounted.container;
    expect(more(c).textContent).toBe('Đang tải…');
    const base = reads('listDealerApps');
    click(more(c));
    await flush();
    expect(reads('listDealerApps')).toBe(base);
    g.resolve();
    await flush();
  });

  it('"Thử lại" khi lần làm mới lỗi mà danh sách cũ còn hiện: chạm đúp chỉ tải lại một lần (refetch lúc đang tải sẽ huỷ rồi gửi lại)', async () => {
    const c = await mount('dealers');
    mocks.failNext.listDealerApps = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['admin-dealers'] });
    });
    await flush();
    expect(c.textContent).toContain('Không tải được danh sách hồ sơ đại lý.');
    expect(c.textContent).toContain('Cửa hàng Xanh');
    const base = reads('listDealerApps');
    const g = gate();
    mocks.hold.listDealerApps = { after: base, promise: g.promise };
    const retry = btnByText(c, 'Thử lại');
    await tap(retry, retry);
    await flush();
    expect(reads('listDealerApps')).toBe(base + 1);
    g.resolve();
    await flush();
    expect(c.textContent).not.toContain('Không tải được danh sách hồ sơ đại lý.');
  });

  it('"Thử lại" khi tải hồ sơ lỗi: chạm đúp trong cùng khung hình chỉ tải lại một lần', async () => {
    const g = gate();
    mocks.failNext.listDealerApps = true;
    mocks.hold.listDealerApps = { after: 1, promise: g.promise };
    const c = await mount('dealers');
    const retry = btnByText(c, 'Thử lại');
    expect(c.textContent).toContain('Không tải được danh sách hồ sơ đại lý.');
    await tap(retry, retry);
    await flush();
    expect(reads('listDealerApps')).toBe(2);
    g.resolve();
    await flush();
    expect(c.textContent).toContain('Cửa hàng Xanh');
  });
});


describe.each([
  { tab: 'returns', api: 'listReturnRequests' },
  { tab: 'flashSales', api: 'listFlashSalesPage' },
])('Tải thêm ở tab $tab', ({ tab, api }) => {
  const more = (c: HTMLElement) => btnByText(c, /^(Tải thêm|Đang tải…)$/);

  it('chạm đúp trong cùng khung hình chỉ tải một trang; nút báo bận bằng aria-busy, không disabled; xong thì nhả', async () => {
    const g = gate();
    mocks.hold[api] = { after: 1, promise: g.promise };
    const c = await mount(tab);
    const b = more(c);
    await tap(b, b);
    await flush();
    expect(reads(api)).toBe(2);
    expect(busy(more(c))).toEqual(BUSY);
    g.resolve();
    await flush();
    expect(busy(more(c))).toEqual({ busy: null, disabled: null, real: false });
  });
});

describe('Tạo mã giảm giá', () => {
  const open = async () => {
    const c = await mount('coupons');
    click(btnByText(c, 'Tạo mã mới'));
    await flush();
    typeInto(c.querySelector('input[aria-label="Mã giảm giá"]'), 'WELCOME30');
    return c;
  };
  const create = (c: HTMLElement) => btnByText(c, 'Tạo mã giảm giá');
  const msg = (c: HTMLElement, text: string) => [...c.querySelectorAll('p')].find((p) => p.textContent === text);

  it('chạm đúp trong cùng khung hình chỉ tạo một mã', async () => {
    mocks.createCoupon.mockResolvedValue({});
    const c = await open();
    const b = create(c);
    await tap(b, b);
    await flush();
    expect(mocks.createCoupon).toHaveBeenCalledTimes(1);
    expect(msg(c, 'Đã tạo mã giảm giá!')?.className).toContain('text-success-fg');
  });

  it('đang tạo: nút báo bận bằng aria-busy/aria-disabled (không disabled), chạm tiếp không gửi thêm; xong thì nhả', async () => {
    const g = gate();
    mocks.createCoupon.mockReturnValue(g.promise);
    const c = await open();
    click(create(c));
    await flush();
    expect(busy(create(c))).toEqual(BUSY);
    await tap(create(c));
    await flush();
    expect(mocks.createCoupon).toHaveBeenCalledTimes(1);
    g.resolve({});
    await flush();
    expect(busy(create(c))).toEqual({ busy: null, disabled: null, real: false });
    click(create(c));
    await flush();
    expect(mocks.createCoupon).toHaveBeenCalledTimes(2);
  });

  it('lỗi hiện ngay bằng màu danger và nhả khoá để thử lại; thành công sau đó đổi sang màu success', async () => {
    mocks.createCoupon.mockRejectedValueOnce(new HttpError('Mã đã tồn tại', 409));
    const c = await open();
    click(create(c));
    await flush();
    expect(msg(c, 'Mã đã tồn tại')?.className).toContain('text-danger-fg');
    mocks.createCoupon.mockResolvedValueOnce({});
    click(create(c));
    await flush();
    expect(msg(c, 'Đã tạo mã giảm giá!')?.className).toContain('text-success-fg');
    expect(mocks.createCoupon).toHaveBeenCalledTimes(2);
  });

  it('lời báo lỗi của lần trước biến mất ngay khi lần tạo mới bắt đầu', async () => {
    const g = gate();
    mocks.createCoupon.mockRejectedValueOnce(new HttpError('Máy chủ đang bận', 500));
    mocks.createCoupon.mockReturnValueOnce(g.promise);
    const c = await open();
    click(create(c));
    await flush();
    expect(msg(c, 'Máy chủ đang bận')).toBeDefined();
    click(create(c));
    await flush();
    expect(mocks.createCoupon).toHaveBeenCalledTimes(2);
    expect(msg(c, 'Máy chủ đang bận')).toBeUndefined();
    g.resolve({});
    await flush();
  });

  /** Danh sách mã chỉ hiện ở chip "Mã đã tạo" nên khi đang ở form nó không có người xem: làm mới chỉ đánh dấu cũ. staleTime dài làm dấu đó thấy được khi quay lại. */
  const openFresh = async () => {
    window.history.replaceState(null, '', '/admin?tab=coupons');
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } } });
    mounted = render(<AdminPage />, client);
    await flush();
    const c = mounted.container;
    click(btnByText(c, 'Tạo mã mới'));
    await flush();
    typeInto(c.querySelector('input[aria-label="Mã giảm giá"]'), 'WELCOME30');
    return c;
  };
  const backToList = async (c: HTMLElement) => {
    click(btnByText(c, 'Mã đã tạo'));
    await flush();
  };

  it('tạo xong: danh sách mã bị làm cũ nên quay lại chip "Mã đã tạo" thì tải lại', async () => {
    mocks.createCoupon.mockResolvedValue({});
    const c = await openFresh();
    expect(reads('listCoupons')).toBe(1);
    click(create(c));
    await flush();
    await backToList(c);
    expect(reads('listCoupons')).toBe(2);
  });

  it.each([404, 409])('bị từ chối %i: danh sách mã cũng bị làm cũ (quay lại thì tải lại)', async (status) => {
    mocks.createCoupon.mockRejectedValue(new HttpError('Mã đã tồn tại', status));
    const c = await openFresh();
    click(create(c));
    await flush();
    await backToList(c);
    expect(reads('listCoupons')).toBe(2);
  });

  // Form có ô người dùng gõ (mã, giá trị, hạn, giới hạn): 400 là lỗi nhập ngay dưới form, danh sách mã không đổi nên không làm cũ.
  it('bị từ chối 400 (mã sai dạng): lời lỗi role=alert ngay dưới form, KHÔNG làm cũ danh sách mã, nhả khoá để sửa rồi gửi lại', async () => {
    mocks.createCoupon.mockRejectedValue(new HttpError('Mã chỉ gồm chữ, số và dấu gạch ngang.', 400));
    const c = await openFresh();
    click(create(c));
    await flush();
    expect(msg(c, 'Mã chỉ gồm chữ, số và dấu gạch ngang.')?.className).toContain('text-danger-fg');
    expect(busy(create(c))).toEqual({ busy: null, disabled: null, real: false });
    await backToList(c);
    expect(reads('listCoupons')).toBe(1);
  });

  it.each([401, 403, 500])('lỗi %i: lệnh KHÔNG làm cũ danh sách mã (quay lại vẫn dùng bản đã tải; production vẫn làm cũ khoá admin-* qua MutationCache)', async (status) => {
    mocks.createCoupon.mockRejectedValue(new HttpError('Máy chủ từ chối', status));
    const c = await openFresh();
    click(create(c));
    await flush();
    expect(msg(c, 'Máy chủ từ chối')?.getAttribute('role')).toBe('alert');
    await backToList(c);
    expect(reads('listCoupons')).toBe(1);
  });

  it('chưa có mã thì vẫn disabled thật (không phải bận)', async () => {
    const c = await mount('coupons');
    click(btnByText(c, 'Tạo mã mới'));
    await flush();
    expect(create(c).disabled).toBe(true);
    expect(create(c).getAttribute('aria-busy')).toBeNull();
  });
});

describe('Nhãn hàng: tạo nhãn', () => {
  const open = async () => {
    const c = await mount('brands');
    typeInto(c.querySelector('input[placeholder^="Tên nhãn"]'), 'Dừa Mới');
    return c;
  };
  const create = (c: HTMLElement) => btnByText(c, 'Tạo nhãn');
  const listGate = () => {
    const g = gate();
    mocks.hold.listBrands = { after: 1, promise: g.promise };
    return g;
  };

  it('chạm đúp trong cùng khung hình chỉ tạo một nhãn', async () => {
    mocks.createBrand.mockResolvedValue({});
    const c = await open();
    const b = create(c);
    await tap(b, b);
    await flush();
    expect(mocks.createBrand).toHaveBeenCalledTimes(1);
  });

  it('tạo xong mà danh sách nhãn chưa về: form đã xoá nhưng nút vẫn bận (không disabled), gõ lại và chạm không gửi; về rồi mới nhả', async () => {
    mocks.createBrand.mockResolvedValue({});
    const list = listGate();
    const c = await open();
    click(create(c));
    await flush();
    expect(reads('listBrands')).toBe(2);
    expect(busy(create(c))).toEqual(BUSY);
    typeInto(c.querySelector('input[placeholder^="Tên nhãn"]'), 'Dừa Khác');
    await tap(create(c));
    await flush();
    expect(mocks.createBrand).toHaveBeenCalledTimes(1);
    list.resolve();
    await flush();
    expect(busy(create(c))).toEqual({ busy: null, disabled: null, real: false });
  });

  it('danh sách không bao giờ về: nhả sau hạn 4 giây', async () => {
    useHangTimers();
    mocks.createBrand.mockResolvedValue({});
    mocks.hold.listBrands = { after: 1, promise: new Promise(() => {}) };
    const c = await open();
    click(create(c));
    await flush();
    await advance(3_500);
    expect(busy(create(c)).busy).toBe('true');
    await advance(600);
    expect(busy(create(c)).busy).toBeNull();
  });

  it('bị từ chối 409: lời lỗi hiện ngay (role alert), tải lại danh sách rồi mới nhả', async () => {
    mocks.createBrand.mockRejectedValue(new HttpError('Tên nhãn đã tồn tại.', 409));
    const list = listGate();
    const c = await open();
    click(create(c));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Tên nhãn đã tồn tại.');
    expect(reads('listBrands')).toBe(2);
    expect(busy(create(c)).busy).toBe('true');
    list.resolve();
    await flush();
    expect(busy(create(c)).busy).toBeNull();
  });

  it('bị từ chối 400 (tên nhãn không hợp lệ): lỗi nhập hiện ngay dưới form, KHÔNG tải lại danh sách, nhả ngay và giữ nguyên tên đã gõ', async () => {
    mocks.createBrand.mockRejectedValue(new HttpError('Tên nhãn tối đa 120 ký tự.', 400));
    const c = await open();
    click(create(c));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Tên nhãn tối đa 120 ký tự.');
    expect(reads('listBrands')).toBe(1);
    expect(busy(create(c)).busy).toBeNull();
    expect(c.querySelector<HTMLInputElement>('input[placeholder^="Tên nhãn"]')!.value).toBe('Dừa Mới');
  });

  it('lỗi 500: hiện lỗi, lệnh KHÔNG tự tải lại danh sách (QueryClient trần; production vẫn làm cũ khoá admin-* qua MutationCache), nhả ngay và giữ nguyên tên đã gõ', async () => {
    mocks.createBrand.mockRejectedValue(new HttpError('Máy chủ đang bận', 500));
    const c = await open();
    click(create(c));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Máy chủ đang bận');
    expect(reads('listBrands')).toBe(1);
    expect(busy(create(c)).busy).toBeNull();
    expect(c.querySelector<HTMLInputElement>('input[placeholder^="Tên nhãn"]')!.value).toBe('Dừa Mới');
  });

  it('lỗi cũ biến mất khi lần tạo mới bắt đầu', async () => {
    mocks.createBrand.mockRejectedValueOnce(new HttpError('Máy chủ đang bận', 500));
    mocks.createBrand.mockResolvedValue({});
    const c = await open();
    click(create(c));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Máy chủ đang bận');
    click(create(c));
    await flush();
    expect(mocks.createBrand).toHaveBeenCalledTimes(2);
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it('chưa có tên thì vẫn disabled thật', async () => {
    const c = await mount('brands');
    expect(create(c).disabled).toBe(true);
  });
});

describe('Nhãn hàng: khoá theo từng món và số liệu', () => {
  const twoProducts = [
    { id: 'p1', name: 'Dừa sáp', slug: 'dua-sap', thumbnail: null, brand: 'Dừa Bến Tre', isActive: true },
    { id: 'p2', name: 'Dừa xiêm', slug: 'dua-xiem', thumbnail: null, brand: 'Dừa Bến Tre', isActive: true },
  ];
  const twoPromos = [
    { id: 'pm1', title: 'MUA 2 TẶNG 1', subtitle: 'Hè', startAt: '', endAt: '', isActive: true },
    { id: 'pm2', title: 'FREESHIP', subtitle: 'Tết', startAt: '', endAt: '', isActive: true },
  ];
  const openRow = async () => {
    const c = await mount('brands');
    click(btnByText(c, 'Quản lý'));
    await flush();
    return c;
  };
  const rowOf = (c: HTMLElement, text: string) => [...c.querySelectorAll('span')].find((e) => e.textContent === text)!.parentElement as HTMLElement;
  const confirmAndFlush = async () => {
    answerConfirm(true);
    await flush();
  };

  it('gỡ hai sản phẩm khác nhau song song đều gửi lệnh; chạm lặp vào cùng một món chỉ gửi một lệnh', async () => {
    mocks.brandProducts = twoProducts;
    const g = gate();
    mocks.detachBrandProducts.mockReturnValue(g.promise);
    const c = await openRow();
    click(btnByText(rowOf(c, 'Dừa sáp'), 'Gỡ'));
    await flush();
    await confirmAndFlush();
    click(btnByText(rowOf(c, 'Dừa sáp'), 'Gỡ'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(busy(btnByText(rowOf(c, 'Dừa xiêm'), 'Gỡ')).busy).toBeNull();
    click(btnByText(rowOf(c, 'Dừa xiêm'), 'Gỡ'));
    await flush();
    await confirmAndFlush();
    expect(mocks.detachBrandProducts).toHaveBeenCalledTimes(2);
    expect(mocks.detachBrandProducts.mock.calls.map((x) => x[1])).toEqual([['p1'], ['p2']]);
    g.resolve({});
    await flush();
  });

  it('xoá hai khuyến mãi khác nhau song song đều gửi lệnh', async () => {
    mocks.promotions = twoPromos;
    const g = gate();
    mocks.deletePromotion.mockReturnValue(g.promise);
    const c = await openRow();
    click(btnByText(rowOf(c, 'MUA 2 TẶNG 1 · Hè'), 'Xoá'));
    await flush();
    await confirmAndFlush();
    click(btnByText(rowOf(c, 'FREESHIP · Tết'), 'Xoá'));
    await flush();
    await confirmAndFlush();
    expect(mocks.deletePromotion).toHaveBeenCalledTimes(2);
    g.resolve({});
    await flush();
  });

  it('"Đã gán N SP" của lần trước biến mất khi lần gán mới bắt đầu', async () => {
    const g = gate();
    mocks.linkBrandByName.mockResolvedValueOnce({ linked: 2 });
    mocks.linkBrandByName.mockReturnValueOnce(g.promise);
    const c = await openRow();
    click(btnByText(c, 'Gán SP theo tên nhãn'));
    await flush();
    expect(c.textContent).toContain('Đã gán 2 SP');
    click(btnByText(c, 'Gán SP theo tên nhãn'));
    await flush();
    expect(mocks.linkBrandByName).toHaveBeenCalledTimes(2);
    expect(c.textContent).not.toContain('Đã gán 2 SP');
    g.resolve({ linked: 3 });
    await flush();
    expect(c.textContent).toContain('Đã gán 3 SP');
  });

  it('số theo dõi, số sản phẩm và số SP vừa gán dùng chữ số đều (tabular-nums)', async () => {
    mocks.linkBrandByName.mockResolvedValue({ linked: 2 });
    const c = await openRow();
    const followers = [...c.querySelectorAll('div')].find((d) => d.textContent?.includes('theo dõi') && d.children.length === 0)!;
    expect(followers.className).toContain('tabular-nums');
    const count = [...c.querySelectorAll('div')].find((d) => /^Sản phẩm \(\d+\)$/.test(d.textContent ?? ''))!;
    expect(count.className).toContain('tabular-nums');
    click(btnByText(c, 'Gán SP theo tên nhãn'));
    await flush();
    const assigned = [...c.querySelectorAll('span')].find((e) => e.textContent === '2' && e.parentElement?.textContent === 'Đã gán 2 SP')!;
    expect(assigned.className).toContain('tabular-nums');
  });
});

type BrandAction = {
  name: string;
  api: () => ReturnType<typeof vi.fn>;
  refresh: 'listBrands' | 'listBrandProducts' | 'listPromotions';
  prepare?: (c: HTMLElement) => Promise<void> | void;
  trigger: (c: HTMLElement) => HTMLElement;
  confirm?: boolean;
  ok?: unknown;
  /** Lệnh có form người dùng gõ (DTO kiểm dữ liệu vào): 400 là lỗi nhập hiện trong form, không phải dữ liệu cũ. */
  input?: boolean;
};

const rowButton = (c: HTMLElement, rowText: string, label: string) => {
  const row = [...c.querySelectorAll('span')].find((e) => e.textContent === rowText)!.parentElement!;
  return btnByText(row, label);
};

const BRAND_ACTIONS: BrandAction[] = [
  { name: 'Đăng / Ẩn nhãn', api: () => mocks.updateBrand, refresh: 'listBrands', trigger: (c) => btnByText(c, 'Đăng') },
  { name: 'Cấp / bỏ chính hãng', api: () => mocks.verifyBrand, refresh: 'listBrands', trigger: (c) => btnByText(c, /^Cấp\s+chính hãng$/) },
  { name: 'Gán SP theo tên nhãn', api: () => mocks.linkBrandByName, refresh: 'listBrandProducts', ok: { linked: 2 }, trigger: (c) => btnByText(c, 'Gán SP theo tên nhãn') },
  { name: 'Gỡ sản phẩm khỏi nhãn', api: () => mocks.detachBrandProducts, refresh: 'listBrandProducts', confirm: true, trigger: (c) => btnByText(c, 'Gỡ') },
  {
    name: 'Thêm khuyến mãi',
    api: () => mocks.createPromotion,
    refresh: 'listPromotions',
    prepare: (c) => typeInto(c.querySelector('input[placeholder^="Tiêu đề (MUA"]'), 'Freeship'),
    trigger: (c) => btnByText(c, 'Thêm KM'),
    input: true,
  },
  { name: 'Xoá khuyến mãi', api: () => mocks.deletePromotion, refresh: 'listPromotions', confirm: true, trigger: (c) => rowButton(c, 'MUA 2 TẶNG 1 · Hè', 'Xoá') },
  { name: 'Lưu thông tin nhãn', api: () => mocks.updateBrand, refresh: 'listBrands', trigger: (c) => btnByText(c, 'Lưu thông tin'), input: true },
  {
    name: 'Gán chủ nhãn',
    api: () => mocks.updateBrand,
    refresh: 'listBrands',
    prepare: async (c) => {
      mocks.searchAdminUsers.mockResolvedValue({ data: [{ id: 'u7', fullName: 'Lan', phone: '0911111111', role: 'DEALER' }], meta: { total: 1, page: 1, limit: 8 } });
      typeInto(c.querySelector('input[aria-label="Chọn đối tác làm chủ nhãn"]'), '0911');
      await new Promise((r) => setTimeout(r, 400));
      await flush();
      click([...c.querySelectorAll('button')].find((b) => b.textContent?.includes('Lan'))!);
      await flush();
    },
    trigger: (c) => btnByText(c, 'Gán chủ nhãn'),
  },
];

describe.each(BRAND_ACTIONS)('Nhãn hàng: $name', (a) => {
  const openRow = async () => {
    const c = await mount('brands');
    click(btnByText(c, 'Quản lý'));
    await flush();
    await a.prepare?.(c);
    return c;
  };
  /** Bấm nút; lệnh có hộp xác nhận thì xác nhận luôn (nút đang bận thì không mở hộp, xem test "chạm tiếp"). */
  const fire = async (c: HTMLElement) => {
    click(a.trigger(c));
    await flush();
    if (a.confirm && confirmDialog()) {
      answerConfirm(true);
      await flush();
    }
  };
  const hold = () => {
    const g = gate();
    mocks.hold[a.refresh] = { after: 1, promise: g.promise };
    return g;
  };
  const errorAlert = (c: HTMLElement) => c.querySelector('[role="alert"]')?.textContent;

  it('chạm lại khi lệnh còn bay (kể cả bấm đúp cùng khung hình) chỉ gửi một lệnh', async () => {
    const g = gate();
    a.api().mockReturnValue(g.promise);
    const c = await openRow();
    if (a.confirm) {
      await fire(c);
      await fire(c);
    } else {
      const b = a.trigger(c);
      await tap(b, b);
      await flush();
      await tap(a.trigger(c));
    }
    await flush();
    expect(a.api()).toHaveBeenCalledTimes(1);
    g.resolve(a.ok ?? {});
    await flush();
  });

  it('đang chạy: nút báo bận bằng aria-busy/aria-disabled, không disabled', async () => {
    const g = gate();
    a.api().mockReturnValue(g.promise);
    const c = await openRow();
    await fire(c);
    expect(busy(a.trigger(c))).toEqual(BUSY);
    g.resolve(a.ok ?? {});
    await flush();
  });

  it('lệnh xong mà dữ liệu làm mới chưa về: nút còn bận, chạm tiếp không gửi lệnh; về rồi mới nhả', async () => {
    a.api().mockResolvedValue(a.ok ?? {});
    const list = hold();
    const c = await openRow();
    const before = reads(a.refresh);
    await fire(c);
    expect(reads(a.refresh)).toBe(before + 1);
    expect(busy(a.trigger(c)).busy).toBe('true');
    // Chạm tay (không dùng fire, vì fire tự xác nhận hộp nếu có): nút đang bận thì không mở hộp, không gửi lệnh.
    click(a.trigger(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(a.api()).toHaveBeenCalledTimes(1);
    list.resolve();
    await flush();
    expect(busy(a.trigger(c)).busy).toBeNull();
  });

  it('dữ liệu làm mới không bao giờ về: còn bận ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    a.api().mockResolvedValue(a.ok ?? {});
    mocks.hold[a.refresh] = { after: 1, promise: new Promise(() => {}) };
    const c = await openRow();
    await fire(c);
    await advance(3_500);
    expect(busy(a.trigger(c)).busy).toBe('true');
    await advance(600);
    expect(busy(a.trigger(c)).busy).toBeNull();
  });

  it.each(a.input ? [404, 409] : [400, 404, 409])('bị từ chối %i: lời lỗi hiện ngay ở cấp trang (role alert), tải lại dữ liệu rồi mới nhả', async (status) => {
    a.api().mockRejectedValue(new HttpError('Dữ liệu vừa đổi.', status));
    const list = hold();
    const c = await openRow();
    const before = reads(a.refresh);
    await fire(c);
    expect(errorAlert(c)).toBe('Dữ liệu vừa đổi.');
    // 404/409 có thể làm hàng biến mất sau lần tải lại nên lời lỗi đi lên đầu tab, không nằm trong form/hàng.
    if (a.input) expect(a.trigger(c).closest('.rounded-card')!.contains(c.querySelector('[role="alert"]'))).toBe(false);
    expect(reads(a.refresh)).toBe(before + 1);
    expect(busy(a.trigger(c)).busy).toBe('true');
    list.resolve();
    await flush();
    expect(busy(a.trigger(c)).busy).toBeNull();
  });

  if (a.input) {
    it('bị từ chối 400 (lỗi nhập liệu): lời lỗi hiện ngay trong form đang gõ (không dồn lên đầu tab), KHÔNG tải lại dữ liệu, nhả khoá ngay', async () => {
      a.api().mockRejectedValue(new HttpError('Dữ liệu nhập không hợp lệ.', 400));
      const c = await openRow();
      const before = reads(a.refresh);
      await fire(c);
      const alerts = [...c.querySelectorAll('[role="alert"]')];
      expect(alerts.map((x) => x.textContent)).toEqual(['Dữ liệu nhập không hợp lệ.']);
      expect(a.trigger(c).closest('.rounded-card')!.contains(alerts[0]!)).toBe(true);
      expect(reads(a.refresh)).toBe(before);
      expect(busy(a.trigger(c)).busy).toBeNull();
    });

    it('lỗi nhập trong form biến mất khi lệnh mới bắt đầu', async () => {
      a.api().mockRejectedValueOnce(new HttpError('Dữ liệu nhập không hợp lệ.', 400));
      a.api().mockResolvedValue(a.ok ?? {});
      const c = await openRow();
      await fire(c);
      expect(c.querySelectorAll('[role="alert"]')).toHaveLength(1);
      await fire(c);
      expect(a.api()).toHaveBeenCalledTimes(2);
      expect(c.querySelectorAll('[role="alert"]')).toHaveLength(0);
    });
  }

  it('bị từ chối mà tải lại treo: nhả sau hạn 4 giây', async () => {
    useHangTimers();
    a.api().mockRejectedValue(new HttpError('Dữ liệu vừa đổi.', 409));
    mocks.hold[a.refresh] = { after: 1, promise: new Promise(() => {}) };
    const c = await openRow();
    await fire(c);
    await advance(3_500);
    expect(busy(a.trigger(c)).busy).toBe('true');
    await advance(600);
    expect(busy(a.trigger(c)).busy).toBeNull();
  });

  it('lỗi cũ biến mất khi lệnh mới bắt đầu (không dính lại sau khi thành công)', async () => {
    a.api().mockRejectedValueOnce(new HttpError('Máy chủ từ chối.', 500));
    a.api().mockResolvedValue(a.ok ?? {});
    const c = await openRow();
    await fire(c);
    expect(errorAlert(c)).toBe('Máy chủ từ chối.');
    await fire(c);
    expect(a.api()).toHaveBeenCalledTimes(2);
    expect(errorAlert(c)).toBeUndefined();
  });

  it.each([401, 403, 500])('lỗi %i: hiện lỗi, lệnh KHÔNG tự tải lại (QueryClient trần; production vẫn làm cũ khoá admin-* qua MutationCache), nhả ngay', async (status) => {
    a.api().mockRejectedValue(new HttpError('Máy chủ từ chối.', status));
    const c = await openRow();
    const before = reads(a.refresh);
    await fire(c);
    expect(errorAlert(c)).toBe('Máy chủ từ chối.');
    expect(reads(a.refresh)).toBe(before);
    expect(busy(a.trigger(c)).busy).toBeNull();
  });
});


describe('khung dựng', () => {
  it('tab Người dùng hiện danh sách và tab Đại lý hiện hồ sơ', async () => {
    const c = await mount('users');
    expect(c.textContent).toContain('Nguyễn An');
    mounted!.unmount();
    const d = await mount('dealers');
    expect(d.textContent).toContain('Cửa hàng Xanh');
  });
});
