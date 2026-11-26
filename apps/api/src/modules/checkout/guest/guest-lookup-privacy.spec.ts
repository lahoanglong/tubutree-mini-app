import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { GUEST_LOOKUP_LIMIT } from '@tubutree/shared-types';
import { throttleRefusalOf } from '../../../common/throttle/throttle.config';
import { GuestCheckoutController, GUEST_LOOKUP_CODE_LIMIT, GUEST_LOOKUP_IP_LIMIT, GUEST_LOOKUP_PHONE_LIMIT, GUEST_LOOKUP_PHONE_TTL_MS } from './guest-checkout.controller';
import { GuestCheckoutService } from './guest-checkout.service';
import { GUEST_COD_MAX_DEFAULT } from './guest-checkout.config';

/**
 * tubu-w28-02: trang /don hiện các mốc có giờ và nút nhắn Zalo kèm mã đơn, nên bản xem đơn khách là thứ duy nhất trình duyệt nhận được. Khoá danh sách
 * trường của bản xem (thêm trường mới phải sửa spec này, tức là phải nghĩ lại về dữ liệu cá nhân) và trần tra cứu mã + SĐT không đổi.
 */

const KEY = 'K'.repeat(43);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PHONE = '0912345678';
const ORDER = {
  id: 'o1',
  code: 'TUBU2026112412345',
  userId: 'u-guest',
  status: 'SHIPPING',
  paymentMethod: 'BANK_TRANSFER',
  paymentStatus: 'PAID',
  createdAt: new Date('2026-11-24T02:00:00.000Z'),
  updatedAt: new Date('2026-11-25T01:00:00.000Z'),
  deliveredAt: null,
  subtotal: 240_000,
  discount: 0,
  shippingFee: 0,
  total: 240_000,
  checkoutGroup: 'grp-1',
  guestPhone: PHONE,
  guestTokenHash: sha(KEY),
  guestIpHash: 'ip-hash-secret',
  note: 'Gọi trước khi giao, nhà số 12 ngõ 34',
  shippingAddress: {
    recipient: 'Nguyễn Văn An',
    phone: PHONE,
    street: '12 ngõ 34 Trần Duy Hưng',
    ward: 'Trung Hoà',
    district: 'Cầu Giấy',
    province: 'Hà Nội',
    wardCode: '00166',
  },
};

const SIBLING_ROW = { code: 'TUBU2026112412346', status: 'CONFIRMED', total: 99_000 };

function service(
  opts: {
    order?: Partial<typeof ORDER> & { orderZaloConsent?: boolean | null };
    gate?: { enabled: boolean; open: boolean; rolloutPct: number };
    friendRow?: { id: string } | null;
    bankTransfer?: { getBankQr: jest.Mock };
  } = {},
) {
  const order = { orderZaloConsent: null, ...ORDER, ...opts.order };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order), findMany: jest.fn().mockResolvedValue([SIBLING_ROW]) },
    mssOrderEventOutbox: { findFirst: jest.fn().mockResolvedValue(opts.friendRow ?? null) },
    orderStatusHistory: {
      findMany: jest.fn().mockResolvedValue([
        { fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED', createdAt: new Date('2026-11-24T02:00:00.000Z') },
        { fromStatus: 'CONFIRMED', toStatus: 'SHIPPING', createdAt: new Date('2026-11-25T01:00:00.000Z') },
      ]),
    },
    orderItem: {
      findMany: jest.fn().mockResolvedValue([
        { productName: 'Dầu gội', variationName: 'Chai 500ml', quantity: 2, unitPrice: 120_000, total: 240_000, isGift: false, note: 'x' },
      ]),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ phone: null, zaloId: 'guest_abc', mergedIntoId: null }) },
    paymentAttempt: { count: jest.fn().mockResolvedValue(0) },
  };
  const config = { get: jest.fn(async (_key: string, fallback: unknown) => (_key === 'web.guest_checkout_enabled' ? true : fallback)) };
  const env = { get: jest.fn(() => 'test-jwt-access-secret-test-jwt-access-secret') };
  const none = {} as never;
  const mss = opts.gate ? ({ gate: () => opts.gate } as never) : undefined;
  const bankTransfer = (opts.bankTransfer ?? none) as never;
  return { svc: new GuestCheckoutService(prisma as never, none, none, bankTransfer, config as never, none, env as never, none, mss), prisma };
}

const TRACK_FIELDS = [
  'area',
  'codSwitchable',
  'code',
  'createdAt',
  'deliveredAt',
  'discount',
  'expiresAt',
  'items',
  'paymentMethod',
  'paymentStatus',
  'phoneMasked',
  'shippingFee',
  'siblings',
  'status',
  'statusTimes',
  'subtotal',
  'total',
  'zaloFriendCard',
];

function expectNoPii(view: unknown) {
  const json = JSON.stringify(view);
  for (const secret of [PHONE, 'Nguyễn Văn An', '12 ngõ 34', 'Cầu Giấy', '00166', 'ip-hash-secret', ORDER.guestTokenHash, 'Gọi trước khi giao']) {
    expect(json).not.toContain(secret);
  }
}

describe('bản xem đơn khách (/don) không lộ dữ liệu cá nhân', () => {
  it('theo dõi bằng khoá: đúng danh sách trường, SĐT che, chỉ phường và tỉnh; mốc giờ đủ cho Đã đặt, Đã xác nhận, Đang giao', async () => {
    const { svc, prisma } = service();
    const view = await svc.track(ORDER.code, KEY);
    expect(Object.keys(view).sort()).toEqual(TRACK_FIELDS);
    expect(view.siblings).toEqual([SIBLING_ROW]);
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { code: true, status: true, total: true } }));
    expect(Object.keys(view.items[0]!).sort()).toEqual(['isGift', 'productName', 'quantity', 'total', 'unitPrice', 'variationName']);
    expect(view.phoneMasked).toBe('091****678');
    expect(view.area).toEqual({ ward: 'Trung Hoà', province: 'Hà Nội' });
    expect(view.createdAt).toBe('2026-11-24T02:00:00.000Z');
    expect(view.statusTimes).toEqual({ CONFIRMED: '2026-11-24T02:00:00.000Z', SHIPPING: '2026-11-25T01:00:00.000Z' });
    expectNoPii(view);
  });

  it('tra bằng mã + SĐT: bản xem cùng danh sách trường, đường dẫn chỉ mang mã và khoá tạm, không mang SĐT', async () => {
    const res = await service().svc.lookup({ orderCode: ORDER.code, phone: PHONE } as never);
    expect(Object.keys(res).sort()).toEqual(['bankPath', 'linkExpiresAt', 'order', 'trackPath', 'trackingKey']);
    expect(Object.keys(res.order).sort()).toEqual(TRACK_FIELDS);
    expect(res.trackPath).toBe(`/don/${ORDER.code}#k=${res.trackingKey}`);
    expect(res.trackingKey).not.toBe(KEY);
    expectNoPii(res);
  });
});

describe('trần tra cứu mã + SĐT giữ nguyên (GUEST_LOOKUP_LIMIT)', () => {
  const handler = GuestCheckoutController.prototype.lookup;
  const meta = (key: string) => Reflect.getMetadata(key, handler) as unknown;

  it('10/phút/mã, 30/phút/IP, 10/15 phút/SĐT', () => {
    expect([GUEST_LOOKUP_CODE_LIMIT, GUEST_LOOKUP_IP_LIMIT, GUEST_LOOKUP_PHONE_LIMIT, GUEST_LOOKUP_PHONE_TTL_MS]).toEqual([10, 30, 10, 15 * 60_000]);
    expect([meta('THROTTLER:LIMITdefault'), meta('THROTTLER:TTLdefault')]).toEqual([10, 60_000]);
    expect([meta('THROTTLER:LIMITauthIp'), meta('THROTTLER:TTLauthIp')]).toEqual([30, 60_000]);
    expect([meta('THROTTLER:LIMITlookupPhone'), meta('THROTTLER:TTLlookupPhone')]).toEqual([10, 15 * 60_000]);
  });

  it('trần mã đếm theo mã đã chuẩn hoá (mọi IP chung một bộ đếm), trần SĐT đếm theo SĐT (mọi mã chung một bộ đếm), khoá đã băm', () => {
    const req = (orderCode: string, phone: string, ip: string) => ({ body: { orderCode, phone }, ip, headers: {}, socket: { remoteAddress: ip } });
    const byCode = meta('THROTTLER:TRACKERdefault') as (r: unknown) => string;
    const byPhone = meta('THROTTLER:TRACKERlookupPhone') as (r: unknown) => string;
    const a = req('TUBU2026112412345', PHONE, '1.1.1.1');
    const sameCodeOtherIp = req(' tubu2026112412345 ', '0987654321', '2.2.2.2');
    const otherCodeSamePhone = req('TUBU2026112499999', PHONE, '3.3.3.3');
    expect(byCode(sameCodeOtherIp)).toBe(byCode(a));
    expect(byCode(otherCodeSamePhone)).not.toBe(byCode(a));
    expect(byPhone(otherCodeSamePhone)).toBe(byPhone(a));
    expect(byPhone(sameCodeOtherIp)).not.toBe(byPhone(a));
    expect(byCode(a)).not.toContain('TUBU');
    expect(byPhone(a)).not.toContain(PHONE);
  });

  it('chạm trần: 429 mang mã GUEST_LOOKUP_LIMIT và câu tiếng Việt có số phút', () => {
    const refusal = throttleRefusalOf(handler);
    expect(refusal?.code).toBe(GUEST_LOOKUP_LIMIT);
    expect(refusal?.message(15)).toBe('Bạn tra hơi nhiều lần. Thử lại sau 15 phút nhé.');
  });
});

describe('U3 zaloFriendCard: thẻ kết bạn Zalo ở /don', () => {
  const ON = { enabled: true, open: true, rolloutPct: 100 };

  it('cổng mở, khách đồng ý ở đơn này, đơn đang đi, MSS chưa nhắn được như bạn bè: hiện; truy vấn đúng dòng người mua của đơn', async () => {
    const { svc, prisma } = service({ gate: ON, order: { orderZaloConsent: true } });
    expect((await svc.track(ORDER.code, KEY)).zaloFriendCard).toBe(true);
    expect(prisma.mssOrderEventOutbox.findFirst).toHaveBeenCalledWith({
      where: { orderId: ORDER.id, recipientRole: 'buyer', status: 'RESULT_SENT', resultReason: null },
      select: { id: true },
    });
  });

  it.each<[string, Parameters<typeof service>[0]]>([
    ['MSS đã gửi tin đơn này như bạn bè', { gate: ON, order: { orderZaloConsent: true }, friendRow: { id: 'r1' } }],
    ['khách không đồng ý', { gate: ON, order: { orderZaloConsent: false } }],
    ['chưa hỏi đồng ý (null)', { gate: ON, order: { orderZaloConsent: null } }],
    ['đơn đã giao', { gate: ON, order: { orderZaloConsent: true, status: 'DELIVERED' } }],
    ['đơn đã huỷ', { gate: ON, order: { orderZaloConsent: true, status: 'CANCELLED' } }],
    ['cờ tắt', { gate: { enabled: false, open: false, rolloutPct: 0 }, order: { orderZaloConsent: true } }],
    ['MSS chưa công bố order_events', { gate: { ...ON, open: false }, order: { orderZaloConsent: true } }],
    ['tỉ lệ 0', { gate: { ...ON, rolloutPct: 0 }, order: { orderZaloConsent: true } }],
    ['không có MssModule', { order: { orderZaloConsent: true } }],
  ])('%s: không hiện', async (_n, opts) => {
    expect((await service(opts).svc.track(ORDER.code, KEY)).zaloFriendCard).toBe(false);
  });
});

describe('GET mã QR chuyển khoản của khách vãng lai: thẻ Zalo chỉ xét tin của đơn này', () => {
  it("gọi getBankQr với friendScope 'order' và trần COD của khách vãng lai, trả nguyên kết quả", async () => {
    const qr = { orderCode: ORDER.code, zaloFriendCard: true };
    const getBankQr = jest.fn().mockResolvedValue(qr);
    const { svc } = service({ order: { status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' }, bankTransfer: { getBankQr } });
    await expect(svc.bankQr(ORDER.code, KEY)).resolves.toBe(qr);
    expect(getBankQr).toHaveBeenCalledWith(ORDER.code, ORDER.userId, { codMax: GUEST_COD_MAX_DEFAULT, friendScope: 'order' });
  });

  it('khoá sai: không gọi getBankQr', async () => {
    const getBankQr = jest.fn();
    const { svc } = service({ bankTransfer: { getBankQr } });
    await expect(svc.bankQr(ORDER.code, 'X'.repeat(43))).rejects.toThrow();
    expect(getBankQr).not.toHaveBeenCalled();
  });
});
