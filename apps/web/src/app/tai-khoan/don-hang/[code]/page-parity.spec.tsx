// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';

// Phần chi tiết đơn của Mini App (order-detail.tsx) mà trang web cần có đủ: mốc thời gian, dòng Điểm Xanh, đặt trước,
// sao chép mã vận đơn, hoá đơn VAT, phiếu thu rác, lời mời theo dõi OA, hạn đổi/trả, đơn đã bàn giao vận chuyển.

const mocks = vi.hoisted(() => ({
  order: null as Record<string, unknown> | null,
  returns: [] as unknown[],
  ordersTotal: 1 as number | undefined,
  config: { returnWindowDays: 7 } as Record<string, unknown>,
  waste: null as Record<string, unknown> | null,
  wasteCalls: [] as string[],
  routeReady: true,
  storage: {} as Record<string, string>,
  follow: vi.fn(),
  oaAvailable: true,
  writeText: vi.fn(),
  orderCalls: 0,
  orderFails: false,
  orderGate: null as Promise<void> | null,
  storageFails: false,
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, status: 'authenticated', initialized: true }) }));
vi.mock('next/navigation', () => ({ useParams: () => ({ code: 'TB-9' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getPublicSupport: async () => ({ hotline: '0984 606 774', email: 'tubutree@gmail.com' }),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  fetchOrder: async () => {
    mocks.orderCalls += 1;
    if (mocks.orderGate) await mocks.orderGate;
    if (mocks.orderFails) throw new Error('boom');
    return mocks.order;
  },
  fetchMyReturns: async () => mocks.returns,
  fetchMyRefunds: async () => [],
  fetchOrdersPage: async () => ({ data: [], meta: { page: 1, limit: 20, total: mocks.ordersTotal } }),
  getPublicConfig: async () => mocks.config,
}));
vi.mock('@tubutree/app-core/api/waste', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tubutree/app-core/api/waste')>()),
  getWasteRequestByOrder: async (_http: unknown, orderId: string) => {
    mocks.wasteCalls.push(orderId);
    if (!mocks.waste) throw new Error('404');
    return mocks.waste;
  },
}));
vi.mock('@/lib/route-map', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/route-map')>()),
  isWebRouteReady: () => mocks.routeReady,
}));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: {
    platform: 'web',
    capabilities: {},
    get oa() {
      return {
        available: mocks.oaAvailable,
        openChat: async () => undefined,
        follow: mocks.follow,
      };
    },
    storage: {
      get: async (k: string) => mocks.storage[k] ?? null,
      set: async (k: string, v: string) => {
        if (mocks.storageFails) throw new Error('disk');
        mocks.storage[k] = v;
      },
    },
  },
}));

import OrderDetailPage from './page';

const ORDER = {
  id: 'o1',
  code: 'TB-9',
  status: 'CONFIRMED',
  subtotal: 300000,
  discount: 0,
  shippingFee: 0,
  total: 300000,
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  createdAt: '2026-10-01T03:00:00Z',
  pointsUsed: 0,
  pointsEarned: 0,
  shippingAddress: { recipient: 'An', phone: '0912345678', street: '1 Xuân Thuỷ', ward: 'Cầu Giấy', province: 'Hà Nội' },
  items: [{ id: 'i1', productName: 'Dầu gội', variationName: '500ml', unitPrice: 150000, quantity: 2, total: 300000 }],
};

// Hoá đơn, phiếu thu rác và lời mời OA nạp bằng next/dynamic; lần nạp đầu phải biên dịch, trên máy CI chậm lâu hơn các nhịp flush() của mount.
beforeAll(async () => {
  await import('./order-extras');
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<OrderDetailPage />);
  mounted.push(r);
  await flush(10);
  return r;
};
const text = (c: HTMLElement) => c.textContent ?? '';

beforeEach(() => {
  mocks.order = structuredClone(ORDER);
  mocks.returns = [];
  mocks.ordersTotal = 2;
  mocks.config = { returnWindowDays: 7 };
  mocks.waste = null;
  mocks.wasteCalls = [];
  mocks.routeReady = true;
  mocks.storage = {};
  mocks.oaAvailable = true;
  mocks.follow.mockReset();
  mocks.writeText.mockReset();
  mocks.orderCalls = 0;
  mocks.orderFails = false;
  mocks.orderGate = null;
  mocks.storageFails = false;
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: mocks.writeText }, configurable: true });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('chi tiết đơn web — mốc thời gian và Điểm Xanh', () => {
  it('đơn đã giao có mốc giao: "Giao lúc"; đơn chưa giao: "Đặt lúc"', async () => {
    mocks.order = { ...ORDER, status: 'DELIVERED', deliveredAt: '2026-10-03T03:00:00Z' };
    expect(text((await mount()).container)).toMatch(/Giao lúc 10:00 03\/10(?!\d)/);
    mounted.forEach((m) => m.unmount());
    mounted = [];
    mocks.order = { ...ORDER };
    expect(text((await mount()).container)).toMatch(/Đặt lúc 10:00 01\/10(?!\d)/);
  });

  it('hành trình ghi giờ từng bước đã tới; bước chưa tới không có giờ; đơn huỷ ghi "Huỷ lúc"', async () => {
    mocks.order = {
      ...ORDER,
      status: 'PACKED',
      paymentMethod: 'COD',
      statusTimes: { CONFIRMED: '2026-10-01T03:05:00Z', PACKED: '2026-10-02T04:30:00Z' },
    };
    const { container } = await mount();
    const steps = [...container.querySelectorAll('ol[aria-label="Hành trình đơn hàng"] > li')].map((li) => li.textContent ?? '');
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatch(/10:05 01\/10/);
    expect(steps[1]).toMatch(/11:30 02\/10/);
    expect(steps[2]).not.toMatch(/\d\d:\d\d/);
    mounted.forEach((m) => m.unmount());
    mounted = [];
    mocks.order = { ...ORDER, status: 'CANCELLED', statusTimes: { CANCELLED: '2026-10-03T07:45:00Z' } };
    expect(text((await mount()).container)).toMatch(/Huỷ lúc 14:45 03\/10(?!\d)/);
  });

  it('dòng Điểm Xanh theo trạng thái: chưa giao thì "Nhận +…", đã giao thì "Đã cộng +…"', async () => {
    mocks.order = { ...ORDER, pointsEarned: 1200 };
    expect(text((await mount()).container)).toContain('Nhận +1.200 Điểm Xanh khi giao thành công');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    mocks.order = { ...ORDER, status: 'DELIVERED', pointsEarned: 50 };
    expect(text((await mount()).container)).toContain('Đã cộng +50 Điểm Xanh vào tài khoản');
  });

  it('đã trả hàng: số điểm thực thu của API thắng; chưa có thì cộng phần thu hồi của các phiếu đã duyệt, ghi "tối đa"', async () => {
    mocks.order = { ...ORDER, status: 'DELIVERED', pointsEarned: 50, pointsReturnReversed: 20 };
    expect(text((await mount()).container)).toContain('Đã cộng +50, đã thu lại 20 điểm do trả hàng');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    mocks.order = { ...ORDER, status: 'DELIVERED', pointsEarned: 50 };
    mocks.returns = [
      { id: 'r1', orderId: 'o1', status: 'APPROVED', pointsReversed: 10, reason: 'x', createdAt: '2026-10-04T00:00:00Z' },
      { id: 'r2', orderId: 'o1', status: 'REJECTED', pointsReversed: 99, reason: 'x', createdAt: '2026-10-04T00:00:00Z' },
      { id: 'r3', orderId: 'khac', status: 'APPROVED', pointsReversed: 99, reason: 'x', createdAt: '2026-10-04T00:00:00Z' },
    ];
    expect(text((await mount()).container)).toContain('Đã cộng +50, đã thu lại tối đa 10 do trả hàng');
  });

  it('đơn cũ chỉ có tổng giảm giá: nói số điểm đã dùng nằm trong dòng giảm giá', async () => {
    mocks.order = { ...ORDER, discount: 20000, pointsUsed: 2000, pointsDiscount: 0 };
    const t = text((await mount()).container);
    expect(t).toContain('Điểm Xanh đã dùng');
    expect(t).toContain('2.000 điểm');
  });
});

describe('chi tiết đơn web — dòng hàng và vận chuyển', () => {
  it('dòng đặt trước vượt tồn: badge "Đặt trước x/y — chờ hàng về"', async () => {
    mocks.order = { ...ORDER, items: [{ ...ORDER.items[0], quantity: 5, backorderedQty: 2 }] };
    expect(text((await mount()).container)).toContain('Đặt trước 2/5 — chờ hàng về');
  });

  it('có mã vận đơn: hiện trạng thái hãng và nút Chép mã đưa đúng mã vào clipboard', async () => {
    mocks.order = { ...ORDER, status: 'SHIPPING', shippingPartner: 'GHN', shippingCode: 'GHN123', shippingStatus: 'delivering' };
    const { container } = await mount();
    expect(text(container)).toContain('Đang giao hàng');
    click(byText(container, 'button', 'Chép mã'));
    await flush();
    expect(mocks.writeText).toHaveBeenCalledWith('GHN123');
    expect(text(container)).toContain('Đã sao chép mã vận đơn');
  });

  it('trạng thái hãng lạ dùng nhãn như Mini App, không in mã tiếng Anh', async () => {
    mocks.order = { ...ORDER, status: 'SHIPPING', shippingPartner: 'GHN', shippingCode: 'GHN123', shippingStatus: 'lost' };
    const t = text((await mount()).container);
    expect(t).toContain('Thất lạc kiện hàng');
    expect(t).not.toContain('lost');
  });

  it('thứ tự khối như Mini App: câu "không huỷ được" ở đầu trang, rồi Vận chuyển, Địa chỉ giao hàng, phần liên hệ', async () => {
    mocks.order = { ...ORDER, status: 'SHIPPING', shippingPartner: 'GHN', shippingCode: 'GHN123' };
    const t = text((await mount()).container);
    const at = (s: string) => t.indexOf(s);
    expect(at('không huỷ được')).toBeGreaterThan(-1);
    expect(at('không huỷ được')).toBeLessThan(at('Vận chuyển'));
    expect(at('Vận chuyển')).toBeGreaterThan(-1);
    expect(at('Vận chuyển')).toBeLessThan(at('Địa chỉ giao hàng'));
  });

  it('có cả hoá đơn VAT và phiếu thu rác: Vận chuyển → Hoá đơn VAT → thu rác → Địa chỉ → liên hệ', async () => {
    mocks.order = {
      ...ORDER,
      status: 'SHIPPING',
      shippingPartner: 'GHN',
      shippingCode: 'GHN123',
      invoiceStatus: 'ISSUED',
      invoiceUrl: 'https://hd.example/1.pdf',
      hasRecyclingPickup: true,
    };
    mocks.waste = { id: 'w1', code: 'RC-77' };
    const t = text((await mount()).container);
    const order = ['Vận chuyển', 'Hoá đơn VAT', 'Yêu cầu thu rác RC-77', 'Địa chỉ giao hàng', 'Cần hỗ trợ'].map((s) => t.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('không chép được thì báo chép tay', async () => {
    mocks.writeText.mockRejectedValue(new Error('chặn'));
    mocks.order = { ...ORDER, status: 'SHIPPING', shippingCode: 'GHN123' };
    const { container } = await mount();
    click(byText(container, 'button', 'Chép mã'));
    await flush();
    expect(text(container)).toContain('Không sao chép được — hãy chép mã thủ công.');
  });

  it('đơn đã giao cho vận chuyển: nói rõ không huỷ được, khi nhận hàng có thể gửi yêu cầu đổi/trả', async () => {
    mocks.order = { ...ORDER, status: 'SHIPPING' };
    expect(text((await mount()).container)).toContain(
      'Hàng đã giao cho đơn vị vận chuyển nên đơn không huỷ được. Khi nhận hàng, bạn có thể đổi/trả trong 7 ngày.',
    );
  });

  it('đơn còn huỷ được: không có câu trên', async () => {
    expect(text((await mount()).container)).not.toContain('không huỷ được');
  });
});

describe('chi tiết đơn web — hoá đơn VAT', () => {
  const invoiceBlock = (c: HTMLElement) => byText(c, 'h2', 'Hoá đơn VAT')?.parentElement ?? null;

  it('đã phát hành kèm link: "Đã phát hành" và Tải PDF mở tab mới', async () => {
    mocks.order = { ...ORDER, invoiceStatus: 'ISSUED', invoiceUrl: 'https://hd.example/1.pdf' };
    const { container } = await mount();
    const b = invoiceBlock(container)!;
    expect(b.textContent).toContain('Đã phát hành');
    const a = b.querySelector('a')!;
    expect(a.textContent).toContain('Tải PDF');
    expect(a.getAttribute('href')).toBe('https://hd.example/1.pdf');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('đang xử lý / phát hành lỗi: đúng chữ, không link khi chưa có URL', async () => {
    mocks.order = { ...ORDER, invoiceStatus: 'REQUESTED' };
    let { container } = await mount();
    expect(invoiceBlock(container)!.textContent).toContain('Đang xử lý');
    expect(invoiceBlock(container)!.querySelector('a')).toBeNull();
    mounted.forEach((m) => m.unmount());
    mounted = [];
    mocks.order = { ...ORDER, invoiceStatus: 'FAILED' };
    ({ container } = await mount());
    expect(invoiceBlock(container)!.textContent).toContain('Phát hành lỗi. Liên hệ Tubu để được hỗ trợ.');
  });

  it('không yêu cầu hoá đơn hoặc URL không phải http(s): không khối, không link', async () => {
    mocks.order = { ...ORDER, invoiceStatus: 'NOT_REQUESTED' };
    expect(invoiceBlock((await mount()).container)).toBeNull();
    mounted.forEach((m) => m.unmount());
    mounted = [];
    mocks.order = { ...ORDER, invoiceStatus: 'ISSUED', invoiceUrl: 'javascript:alert(1)' };
    const { container } = await mount();
    expect(invoiceBlock(container)!.querySelector('a')).toBeNull();
  });
});

describe('chi tiết đơn web — phiếu thu rác kèm đơn', () => {
  const WASTE = { id: 'w1', code: 'RC-77' };

  it('đơn có thu gom và route phiếu đã mở: link tới /doi-rac/yeu-cau/:id', async () => {
    mocks.order = { ...ORDER, hasRecyclingPickup: true };
    mocks.waste = WASTE;
    const { container } = await mount();
    expect(mocks.wasteCalls).toEqual(['o1']);
    const a = container.querySelector('a[href="/doi-rac/yeu-cau/w1"]')!;
    expect(a.textContent).toContain('Yêu cầu thu rác RC-77');
    expect(a.textContent).toContain('Xem tiến độ thu rác kèm đơn');
  });

  it('route phiếu còn pending: ẩn link', async () => {
    mocks.order = { ...ORDER, hasRecyclingPickup: true };
    mocks.waste = WASTE;
    mocks.routeReady = false;
    const { container } = await mount();
    expect(container.querySelector('a[href^="/doi-rac"]')).toBeNull();
  });

  it('đơn không thu gom: không gọi API phiếu; chưa có phiếu (404): không link', async () => {
    mocks.waste = WASTE;
    let { container } = await mount();
    expect(mocks.wasteCalls).toEqual([]);
    expect(container.querySelector('a[href^="/doi-rac"]')).toBeNull();
    mounted.forEach((m) => m.unmount());
    mounted = [];
    mocks.order = { ...ORDER, hasRecyclingPickup: true };
    mocks.waste = null;
    ({ container } = await mount());
    expect(container.querySelector('a[href^="/doi-rac"]')).toBeNull();
  });
});

describe('chi tiết đơn web — lời mời theo dõi OA sau đơn đầu', () => {
  const heading = 'Theo dõi Tubu Tree trên Zalo';

  it('đơn đầu tiên, OA đã cấu hình, chưa hỏi: hiện lời mời chỉ hứa cập nhật đơn và tư vấn', async () => {
    mocks.ordersTotal = 1;
    const t = text((await mount()).container);
    expect(t).toContain(heading);
    expect(t).toContain('Nhận cập nhật đơn và tư vấn từ Tubu Tree qua Zalo — không bỏ lỡ tin quan trọng.');
    expect(t).not.toMatch(/ưu đãi mới/i);
  });

  it.each([
    ['đơn thứ hai trở đi', () => (mocks.ordersTotal = 2)],
    ['OA chưa cấu hình', () => (mocks.oaAvailable = false)],
    ['đã hỏi trên máy này', () => (mocks.storage.tubu_oa_prompt = JSON.stringify({ promptSeen: true, followed: false }))],
  ])('không hiện: %s', async (_name, arrange) => {
    mocks.ordersTotal = 1;
    arrange();
    expect(text((await mount()).container)).not.toContain(heading);
  });

  it('"Để sau": ghi đã hỏi rồi ẩn, không mở trang OA', async () => {
    mocks.ordersTotal = 1;
    const { container } = await mount();
    click(byText(container, 'button', 'Để sau'));
    await flush();
    expect(JSON.parse(mocks.storage.tubu_oa_prompt!).promptSeen).toBe(true);
    expect(mocks.follow).not.toHaveBeenCalled();
    expect(text(container)).not.toContain(heading);
  });

  it('"Theo dõi ngay": mở trang OA qua bridge, ghi đã hỏi, ẩn lời mời và nói khách bấm Quan tâm ở Zalo', async () => {
    mocks.ordersTotal = 1;
    mocks.follow.mockResolvedValue(false);
    const { container } = await mount();
    click(byText(container, 'button', 'Theo dõi ngay'));
    await flush();
    expect(mocks.follow).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.storage.tubu_oa_prompt!)).toEqual({ promptSeen: true, followed: false });
    const t = text(container);
    expect(t).not.toContain(heading);
    expect(t).toContain('Đã mở trang Tubu Tree trên Zalo, bấm "Quan tâm" để nhận cập nhật đơn.');
  });
});

describe('chi tiết đơn web — khoá đồng bộ chạm đúp (W78B)', () => {
  const heading = 'Theo dõi Tubu Tree trên Zalo';
  const twice = (el: HTMLElement) =>
    act(() => {
      el.click();
      el.click();
    });

  it('"Theo dõi ngay" chạm đúp cùng khung hình: chỉ mở trang OA một lần; nút bận giữ focus, "Để sau" bị chặn tới khi xong', async () => {
    mocks.ordersTotal = 1;
    let release!: (v: boolean) => void;
    mocks.follow.mockReturnValue(new Promise<boolean>((r) => (release = r)));
    const { container } = await mount();
    const follow = byText(container, 'button', 'Theo dõi ngay') as HTMLButtonElement;
    twice(follow);
    await flush(3);
    expect(mocks.follow).toHaveBeenCalledTimes(1);
    expect(follow.getAttribute('aria-busy')).toBe('true');
    expect(follow.getAttribute('aria-disabled')).toBe('true');
    expect(follow.disabled).toBe(false);
    const later = byText(container, 'button', 'Để sau') as HTMLButtonElement;
    expect(later.getAttribute('aria-disabled')).toBe('true');
    click(later);
    await flush(3);
    expect(mocks.storage.tubu_oa_prompt).toBeUndefined();
    await act(async () => release(true));
    await flush(4);
    expect(mocks.follow).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.storage.tubu_oa_prompt!)).toEqual({ promptSeen: true, followed: true });
    expect(text(container)).toContain('Đã theo dõi Tubu Tree trên Zalo!');
  });

  it('ghi cờ đã hỏi lỗi (setOaPromptState tự nuốt): vẫn báo kết quả, không ném lỗi, đúng một lần mở OA', async () => {
    mocks.ordersTotal = 1;
    mocks.follow.mockResolvedValue(false);
    mocks.storageFails = true;
    const { container } = await mount();
    const seen = await captureUnhandledRejections(async () => {
      twice(byText(container, 'button', 'Theo dõi ngay') as HTMLElement);
      await flush(4);
    });
    expect(seen).toEqual([]);
    expect(mocks.follow).toHaveBeenCalledTimes(1);
    expect(text(container)).toContain('Đã mở trang Tubu Tree trên Zalo');
  });

  // Đơn đã tải rồi mà lần tải lại nền lỗi: khối lỗi vẫn hiện kèm dữ liệu cũ, nên `refetch()` thứ hai huỷ lượt đầu và gọi API lần nữa; chỉ khoá nút mới giữ một lượt.
  it('lỗi tải lại khi đã có đơn cũ: "Thử lại" chạm đúp cùng khung hình chỉ gọi API thêm một lần', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = render(<OrderDetailPage />, client);
    mounted.push(r);
    await flush(10);
    expect(text(r.container)).toContain('TB-9');
    mocks.orderFails = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['order'] });
    });
    await flush(4);
    const retry = byText(r.container, 'button', 'Thử lại') as HTMLButtonElement;
    expect(retry).not.toBeNull();
    const before = mocks.orderCalls;
    let release!: () => void;
    mocks.orderFails = false;
    mocks.orderGate = new Promise<void>((res) => (release = res));
    twice(retry);
    await flush(3);
    expect(mocks.orderCalls).toBe(before + 1);
    release();
    await flush(8);
    expect(mocks.orderCalls).toBe(before + 1);
    expect(text(r.container)).toContain('TB-9');
  });

  it('lỗi tải đơn: "Thử lại" trả refetch cho nút, chạm đúp cùng khung hình chỉ tải lại một lần', async () => {
    mocks.orderFails = true;
    const { container } = await mount();
    // Truy vấn đơn tự thử lại một lần sau 1 giây trước khi báo lỗi.
    await new Promise<void>((r) => setTimeout(r, 1100));
    await flush(4);
    const retry = byText(container, 'button', 'Thử lại') as HTMLButtonElement;
    expect(retry).not.toBeNull();
    const before = mocks.orderCalls;
    let release!: () => void;
    mocks.orderFails = false;
    mocks.orderGate = new Promise<void>((r) => (release = r));
    twice(retry);
    await flush(3);
    expect(mocks.orderCalls).toBe(before + 1);
    release();
    await flush(8);
    expect(text(container)).toContain('TB-9');
    expect(mocks.orderCalls).toBe(before + 1);
  });
});

describe('chi tiết đơn web — hạn đổi/trả', () => {
  it('đơn đã giao quá hạn (theo returnWindowDays của cấu hình): báo quá hạn, không nút đổi/trả', async () => {
    mocks.order = { ...ORDER, status: 'DELIVERED', deliveredAt: '2026-09-01T00:00:00Z' };
    const { container } = await mount();
    expect(text(container)).toContain('Đã hết hạn đổi/trả.');
    expect(container.querySelector('button[aria-label="Thêm thao tác"]')).not.toBeNull();
    click(container.querySelector('button[aria-label="Thêm thao tác"]'));
    expect(Array.from(document.body.querySelectorAll('[role="group"] [role="button"]')).map((n) => n.textContent?.trim())).not.toContain('Yêu cầu đổi/trả');
  });

  it('còn hạn: có nút đổi/trả, không có câu quá hạn', async () => {
    mocks.order = { ...ORDER, status: 'DELIVERED', deliveredAt: new Date().toISOString() };
    const { container } = await mount();
    click(container.querySelector('button[aria-label="Thêm thao tác"]'));
    expect(Array.from(document.body.querySelectorAll('[role="group"] [role="button"]')).map((n) => n.textContent?.trim())).toContain('Yêu cầu đổi/trả');
    expect(text(container)).not.toContain('Đã hết hạn đổi/trả');
  });

  it('cấu hình chưa tải/không có returnWindowDays: dùng 7 ngày như Mini App', async () => {
    mocks.config = {};
    mocks.order = { ...ORDER, status: 'DELIVERED', deliveredAt: '2026-09-01T00:00:00Z' };
    expect(text((await mount()).container)).toContain('Đã hết hạn đổi/trả.');
  });
});
