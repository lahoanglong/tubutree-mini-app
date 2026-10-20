import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrderReversalService } from './order-reversal.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { CartService } from '../cart/cart.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { FlashSaleService } from '../flash-sale/flash-sale.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { CouponsService } from '../coupons/coupons.service';

// Sổ cái thật (khoá dòng + wallet_transactions) chạy trên Postgres ở
// test/integration-race/wallet-ledger*.race-spec.ts. Ở đây thay bằng đúng tác động số dư của nó
// (increment walletBalance trên tx) để các mock tx sẵn có vẫn đo được tiền vào ví.
jest.mock('../wallet/wallet-ledger.service', () => ({
  applyWalletDelta: jest.fn(
    async (tx: { user: { update: (a: unknown) => Promise<unknown> } }, input: { userId: string; delta: number }) => {
      await tx.user.update({ where: { id: input.userId }, data: { walletBalance: { increment: input.delta } } });
      return { applied: true, balanceAfter: 0, entryId: 'wtx' };
    },
  ),
}));

const POINTS_EXPIRES_AT = new Date('2027-10-20T00:00:00.000Z');
const loyalty = {
  reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
  pointsExpiresAt: jest.fn().mockResolvedValue(POINTS_EXPIRES_AT),
} as unknown as LoyaltyService;
const cart = {} as unknown as CartService;
const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
const flash = { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService;
const affiliate = { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined) } as unknown as AffiliateService;
const coupons = { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService;
// reverseFinancials dùng chung với admin.reviewReturn/OrderStatusService — dựng instance THẬT
// (không mock) trên top of cùng `flash` mock để test vẫn xác minh hành vi qua spy ở tầng tx.
const reversal = new OrderReversalService(flash, coupons);

function makeService(
  order: Record<string, unknown>,
  spies: {
    updateMany?: jest.Mock;
    userUpdate?: jest.Mock;
    /** Hoàn kho đi bằng SQL thô (catalog/variation-stock.ts). */
    executeRaw?: jest.Mock;
    coinCreate?: jest.Mock;
    gomdonQueue?: { getJob: jest.Mock; add: jest.Mock };
    orderStatus?: { precheckPancakeCancel: jest.Mock; afterPancakeCancel: jest.Mock; flagPancakeCancelDivergence?: jest.Mock };
    wastePickupHooks?: { onOrderCancelled: jest.Mock };
    /**
     * Trạng thái dòng `orders` ĐANG nằm trong DB lúc tx huỷ chạy — lệch ảnh chụp mà detail() đọc
     * trước đó (admin xác nhận chuyển khoản / webhook lật PAID, admin chuyển giao vận…). Mặc định = ảnh chụp.
     */
    db?: Record<string, unknown>;
  } = {},
) {
  const row: Record<string, unknown> = { ...order, ...(spies.db ?? {}) };
  const matches = (where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      v !== null && typeof v === 'object' && Array.isArray((v as { in?: unknown[] }).in)
        ? (v as { in: unknown[] }).in.includes(row[k])
        : row[k] === v,
    );
  // updateMany phản ánh ĐÚNG guard của Postgres: count=1 chỉ khi `where` khớp dòng trong DB (rồi ghi
  // `data` vào dòng). Bản cũ trả count=1 cho MỌI câu — guard hoàn tiền PAID→REFUNDED "thắng" cả với
  // đơn COD UNPAID. Test race "thua mọi câu ghi" vẫn truyền count=0 qua spies.updateMany.
  const updateMany =
    spies.updateMany ??
    jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (!matches(where)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    });
  const userUpdate = spies.userUpdate ?? jest.fn().mockResolvedValue({});
  const executeRaw = spies.executeRaw ?? jest.fn().mockResolvedValue(1);
  const coinCreate = spies.coinCreate ?? jest.fn().mockResolvedValue({});
  /** PD-3: hoàn đơn XU cũ ghi Điểm Xanh lô quy đổi (INSERT ... ON CONFLICT DO NOTHING). */
  const pointsInsert = jest.fn().mockResolvedValue([{ id: 'ptx' }]);
  /** SELECT … FOR UPDATE khoá dòng đơn trong tx. */
  const lockRow = jest.fn().mockResolvedValue([{ id: row.id }]);
  /** Đọc lại đơn TRONG tx (sau khoá) — trả dòng DB hiện tại, không phải ảnh chụp. */
  const txFindUnique = jest.fn(async () => ({ ...row }));
  const historyCreate = jest.fn().mockResolvedValue({});
  /** Dòng vết khoản đã hoàn vào Ví (chi tiết đơn của khách đọc lại). */
  const refundTrace = jest.fn().mockResolvedValue({ count: 1 });
  // $transaction giờ là CALLBACK form (flip-status + hoàn ví/xu + restock ATOMIC). Forward tx ops vào cùng mock.
  const $transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      $queryRaw: lockRow,
      order: { updateMany, findUnique: txFindUnique },
      orderStatusHistory: { create: historyCreate },
      user: { update: userUpdate },
      $executeRaw: executeRaw,
      coinTransaction: { create: coinCreate },
      pointsTransaction: { createManyAndReturn: pointsInsert },
      orderCustomerRefund: { createMany: refundTrace },
    }),
  );
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order), updateMany },
    user: { update: userUpdate },
    $executeRaw: executeRaw,
    coinTransaction: { create: coinCreate },
    $transaction,
  } as unknown as PrismaService;
  return {
    svc: new OrdersService(prisma, loyalty, cart, notifications, config, affiliate, reversal, spies.gomdonQueue as never, spies.orderStatus as never, spies.wastePickupHooks as never),
    updateMany,
    userUpdate,
    executeRaw,
    coinCreate,
    pointsInsert,
    $transaction,
    row,
    lockRow,
    txFindUnique,
    historyCreate,
  };
}

const baseOrder = {
  id: 'o1',
  code: 'TUBU1',
  userId: 'u1',
  status: 'CONFIRMED',
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  total: 300000,
  items: [],
};

/** Dòng đơn (OrderItem) dùng chung cho các describe ảnh/tồn kho và mua lại. */
const line = (id: string, variationId: string, quantity = 1) => ({
  id, orderId: 'o1', variationId, productName: `SP ${id}`, productSlug: null, variationName: 'Mặc định',
  unitPrice: 50000, quantity, total: 50000 * quantity, flashSaleItemId: null, backorderedQty: 0,
});

describe('OrdersService.cancel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hủy được đơn CONFIRMED → set CANCELLED (atomic guard) + hoàn điểm + notify', async () => {
    const { svc, updateMany } = makeService({ ...baseOrder, status: 'CONFIRMED' });
    await svc.cancel('u1', 'TUBU1');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1', status: 'CONFIRMED' },
        data: { status: 'CANCELLED' },
      }),
    );
    expect((loyalty.reverseOrderPoints as jest.Mock)).toHaveBeenCalledWith('o1');
    expect((affiliate.reverseCommissionsForOrder as jest.Mock)).toHaveBeenCalledWith('o1');
    expect((notifications.notify as jest.Mock)).toHaveBeenCalled();
  });

  it('Q19: huỷ xong trọn vẹn ghi mốc reversalEffectsAt; đảo điểm lỗi thì KHÔNG ghi (cron chạy lại)', async () => {
    const ok = makeService({ ...baseOrder, status: 'CONFIRMED' });
    await ok.svc.cancel('u1', 'TUBU1');
    expect(ok.updateMany).toHaveBeenCalledWith({ where: { id: 'o1', reversalEffectsAt: null }, data: { reversalEffectsAt: expect.any(Date) } });

    (loyalty.reverseOrderPoints as jest.Mock).mockRejectedValueOnce(new Error('P2024'));
    const failed = makeService({ ...baseOrder, status: 'CONFIRMED' });
    await expect(failed.svc.cancel('u1', 'TUBU1')).rejects.toThrow('P2024');
    expect(failed.updateMany.mock.calls.some(([a]) => 'reversalEffectsAt' in (a as { data: object }).data)).toBe(false);
  });

  it('R3-MONEY-7: khách tự huỷ đơn đã trả có dùng Điểm Xanh → tin huỷ nói cả số tiền vào Ví lẫn số điểm thường được hoàn', async () => {
    (loyalty.reverseOrderPoints as jest.Mock).mockResolvedValueOnce(19);
    const { svc } = makeService({ ...baseOrder, status: 'CONFIRMED', paymentMethod: 'WALLET', paymentStatus: 'PAID', total: 95000 });
    await svc.cancel('u1', 'TUBU1');
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'ORDER_CANCELLED', {
      order_code: 'TUBU1',
      refund_note: ' Đã hoàn 95.000đ vào Ví Tubu. Đã hoàn 19 Điểm Xanh.',
    });
  });

  it('đơn dùng coupon → hoàn coupon (release) khi hủy, không bị đốt vĩnh viễn', async () => {
    const { svc } = makeService({ ...baseOrder, status: 'CONFIRMED', couponCode: 'BDAY50K' });
    await svc.cancel('u1', 'TUBU1');
    expect((coupons.release as jest.Mock)).toHaveBeenCalledWith('BDAY50K', 'o1', expect.anything());
  });

  // MONEY-15: bấm huỷ lần hai (double-tap/mạng chậm) vào đơn vừa huỷ bị báo "Đơn đã vào quy trình giao" như thể đang giao.
  it('đơn đã CANCELLED (bấm huỷ lần hai) → trả đơn hiện tại, không ném lỗi, không hoàn tiền/thông báo lần nữa', async () => {
    const { svc, updateMany, $transaction } = makeService({ ...baseOrder, status: 'CANCELLED' });
    jest.clearAllMocks();
    await expect(svc.cancel('u1', 'TUBU1')).resolves.toMatchObject({ code: 'TUBU1', status: 'CANCELLED' });
    expect($transaction).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(loyalty.reverseOrderPoints as jest.Mock).not.toHaveBeenCalled();
    expect(affiliate.reverseCommissionsForOrder as jest.Mock).not.toHaveBeenCalled();
    expect(notifications.notify as jest.Mock).not.toHaveBeenCalled();
  });

  it('R2-MERCHANT-14: đơn trả về sau khi huỷ không kèm phí sàn đối tác hay cột vận hành Pancake/Gomdon', async () => {
    const internal = { merchantCommissionPct: '0.1500', endCustomerKey: '0909', pancakeSyncError: 'lỗi', gomdonAttempt: 1, recipientSearch: 'nguyen van a' };
    for (const status of ['CONFIRMED', 'CANCELLED']) {
      const { svc } = makeService({ ...baseOrder, ...internal, status });
      const res = (await svc.cancel('u1', 'TUBU1')) as unknown as Record<string, unknown>;
      expect(res).toMatchObject({ code: 'TUBU1' });
      for (const k of Object.keys(internal)) expect(res).not.toHaveProperty(k);
    }
  });

  it('KHÔNG hủy được đơn SHIPPING (đã vào giao)', async () => {
    const { svc, updateMany } = makeService({ ...baseOrder, status: 'SHIPPING' });
    await expect(svc.cancel('u1', 'TUBU1')).rejects.toThrow();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('hủy đồng thời (race): request THUA (count=0) KHÔNG hoàn ví lần 2', async () => {
    const userUpdate = jest.fn().mockResolvedValue({});
    const { svc } = makeService(
      { ...baseOrder, paymentMethod: 'WALLET', paymentStatus: 'PAID' },
      { updateMany: jest.fn().mockResolvedValue({ count: 0 }), userUpdate },
    );
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).not.toHaveBeenCalled();
    expect((loyalty.reverseOrderPoints as jest.Mock)).not.toHaveBeenCalled();
  });

  it('hoàn Ví khi đơn thanh toán bằng WALLET + PAID', async () => {
    const { svc, userUpdate } = makeService({
      ...baseOrder,
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
    });
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { walletBalance: { increment: 300000 } } }),
    );
  });

  it('hoàn Ví khi đơn thanh toán bằng ZALOPAY + PAID (kênh prepaid, nhất quán reviewReturn)', async () => {
    const { svc, userUpdate } = makeService({
      ...baseOrder,
      paymentMethod: 'ZALOPAY',
      paymentStatus: 'PAID',
    });
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { walletBalance: { increment: 300000 } } }),
    );
  });

  it('KHÔNG hoàn Ví khi thanh toán COD', async () => {
    const { svc, userUpdate } = makeService({ ...baseOrder, paymentMethod: 'COD', paymentStatus: 'UNPAID' });
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('PD-3: đơn XU cũ + PAID huỷ → hoàn đúng total Điểm Xanh lô quy đổi (1 điểm = 1đ) — KHÔNG hoàn ví, KHÔNG cộng xu', async () => {
    const { svc, userUpdate, coinCreate, pointsInsert } = makeService({
      ...baseOrder,
      paymentMethod: 'XU',
      paymentStatus: 'PAID',
    });
    await svc.cancel('u1', 'TUBU1');
    // Xu không ra tiền (Q-03a): không vào walletBalance; xu đã khoá (users_coins_frozen): không vào coinsBalance.
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pointsConvertedBalance: { increment: 300000 } } }),
    );
    expect(userUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { walletBalance: { increment: 300000 } } }),
    );
    expect(pointsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ userId: 'u1', delta: 300000, lot: 'CONVERTED', reason: 'ORDER_REFUND_XU:TUBU1', refType: 'ORDER' })],
      }),
    );
    expect(coinCreate).not.toHaveBeenCalled();
  });

  // D12-02: hoàn điểm thường sau commit mà lỗi (đứt DB, SIGTERM) thì bấm huỷ lại bị chặn bởi "đã CANCELLED" → khách mất điểm vĩnh viễn.
  it('đơn dùng 20.000 Điểm Xanh thường → hoàn trong CÙNG tx huỷ (ORDER_REFUND_POINTS, lô STANDARD, có hạn), kể cả khi reverseOrderPoints sau commit ném lỗi', async () => {
    (loyalty.reverseOrderPoints as jest.Mock).mockRejectedValueOnce(new Error('P2024'));
    const { svc, pointsInsert, userUpdate } = makeService({ ...baseOrder, status: 'CONFIRMED', pointsUsed: 20000, pointsUsedConverted: 0 });
    await expect(svc.cancel('u1', 'TUBU1')).rejects.toThrow('P2024');
    expect(pointsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ userId: 'u1', delta: 20000, lot: 'STANDARD', reason: 'ORDER_REFUND_POINTS:TUBU1', refType: 'ORDER', refId: 'o1', expiresAt: POINTS_EXPIRES_AT })],
      }),
    );
    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { pointsBalance: { increment: 20000 } } }));
  });

  it('đơn không dùng điểm thường → không đọc cấu hình hạn điểm, không ghi dòng hoàn điểm', async () => {
    const { svc, pointsInsert } = makeService({ ...baseOrder, status: 'CONFIRMED', pointsUsed: 0, pointsUsedConverted: 0 });
    await svc.cancel('u1', 'TUBU1');
    expect(loyalty.pointsExpiresAt as jest.Mock).not.toHaveBeenCalled();
    expect(pointsInsert).not.toHaveBeenCalled();
  });

  it('hủy XU race THUA (count=0) → KHÔNG hoàn xu, KHÔNG ghi sổ cái', async () => {
    const { svc, userUpdate, coinCreate } = makeService(
      { ...baseOrder, paymentMethod: 'XU', paymentStatus: 'PAID' },
      { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    );
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).not.toHaveBeenCalled();
    expect(coinCreate).not.toHaveBeenCalled();
  });

  it('chặn xem/hủy đơn của người khác', async () => {
    const { svc } = makeService({ ...baseOrder, userId: 'someone-else' });
    await expect(svc.cancel('u1', 'TUBU1')).rejects.toThrow();
  });
});

describe('OrdersService.cancel — Pancake (D1: PANCAKE-2, BUYERMINI-1, MONEY-2, BUYERWEB-5)', () => {
  beforeEach(() => jest.clearAllMocks());

  function gate(precheck: jest.Mock = jest.fn().mockResolvedValue({ kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: 'pk-1' })) {
    return {
      precheckPancakeCancel: precheck,
      afterPancakeCancel: jest.fn().mockResolvedValue(undefined),
      flagPancakeCancelDivergence: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('hỏi Pancake TRƯỚC khi lật trạng thái; Pancake huỷ xong → huỷ ở Tubu + ghi kết quả', async () => {
    const orderStatus = gate();
    const { svc, $transaction, row } = makeService({ ...baseOrder, pancakeOrderId: 'pk-1' }, { orderStatus });
    await svc.cancel('u1', 'TUBU1');
    expect(orderStatus.precheckPancakeCancel).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1', pancakeOrderId: 'pk-1' }), 'CUSTOMER');
    expect(orderStatus.precheckPancakeCancel.mock.invocationCallOrder[0]).toBeLessThan($transaction.mock.invocationCallOrder[0]!);
    expect(row.status).toBe('CANCELLED');
    expect(orderStatus.afterPancakeCancel).toHaveBeenCalledWith('o1', { kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: 'pk-1' });
  });

  it('Pancake đã gửi hàng → từ chối "liên hệ CSKH", KHÔNG lật trạng thái, KHÔNG hoàn tiền', async () => {
    const orderStatus = gate(jest.fn().mockRejectedValue(new BadRequestException('Đơn đã bàn giao cho đơn vị vận chuyển, vui lòng liên hệ CSKH')));
    const { svc, $transaction, row, userUpdate } = makeService(
      { ...baseOrder, pancakeOrderId: 'pk-1', paymentMethod: 'WALLET', paymentStatus: 'PAID' },
      { orderStatus },
    );
    await expect(svc.cancel('u1', 'TUBU1')).rejects.toThrow('Đơn đã bàn giao cho đơn vị vận chuyển, vui lòng liên hệ CSKH');
    expect($transaction).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(row.status).toBe('CONFIRMED');
    expect(orderStatus.afterPancakeCancel).not.toHaveBeenCalled();
  });

  it('không hỏi được Pancake → từ chối "Kho chưa phản hồi…", KHÔNG lật trạng thái, KHÔNG hoàn tiền (R3-CANCEL-1)', async () => {
    const orderStatus = gate(jest.fn().mockRejectedValue(new ConflictException('Kho chưa phản hồi, vui lòng thử lại sau ít phút')));
    const { svc, $transaction, row, userUpdate } = makeService(
      { ...baseOrder, pancakeOrderId: 'pk-1', paymentMethod: 'WALLET', paymentStatus: 'PAID' },
      { orderStatus },
    );
    await expect(svc.cancel('u1', 'TUBU1')).rejects.toThrow('Kho chưa phản hồi, vui lòng thử lại sau ít phút');
    expect($transaction).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(row.status).toBe('CONFIRMED');
    expect(orderStatus.afterPancakeCancel).not.toHaveBeenCalled();
  });

  it('Pancake trả lời chưa gửi hàng nhưng chưa nhận lệnh huỷ (DEFERRED) → huỷ + hoàn tiền, job huỷ thử lại', async () => {
    const deferred = { kind: 'DEFERRED', reason: 'timeout' };
    const orderStatus = gate(jest.fn().mockResolvedValue(deferred));
    const { svc, row } = makeService({ ...baseOrder, pancakeOrderId: 'pk-1' }, { orderStatus });
    await svc.cancel('u1', 'TUBU1');
    expect(row.status).toBe('CANCELLED');
    expect(orderStatus.afterPancakeCancel).toHaveBeenCalledWith('o1', deferred);
  });

  it('đơn đang đóng gói (PACKED, chưa bàn giao) → khách vẫn huỷ được', async () => {
    const orderStatus = gate(jest.fn().mockResolvedValue({ kind: 'NONE' }));
    const { svc, row } = makeService({ ...baseOrder, status: 'PACKED' }, { orderStatus });
    await svc.cancel('u1', 'TUBU1');
    expect(row.status).toBe('CANCELLED');
  });

  it('đơn đại lý PACKED → giữ mốc cũ (đã tính doanh số thưởng), không huỷ', async () => {
    const orderStatus = gate();
    const { svc } = makeService({ ...baseOrder, type: 'DEALER', status: 'PACKED' }, { orderStatus });
    await expect(svc.cancel('u1', 'TUBU1')).rejects.toThrow('Đơn đã vào quy trình giao');
    expect(orderStatus.precheckPancakeCancel).not.toHaveBeenCalled();
  });

  it('thua race huỷ (đã bị huỷ bởi request khác) → không ghi kết quả Pancake lần hai', async () => {
    const orderStatus = gate();
    const { svc } = makeService({ ...baseOrder, pancakeOrderId: 'pk-1' }, { orderStatus, updateMany: jest.fn().mockResolvedValue({ count: 0 }) });
    await svc.cancel('u1', 'TUBU1');
    expect(orderStatus.afterPancakeCancel).not.toHaveBeenCalled();
  });
});

describe('OrdersService.cancel — Pancake đã huỷ mà đơn Tubu không huỷ được (SYNC-1)', () => {
  beforeEach(() => jest.clearAllMocks());

  const decision = { kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: 'pk-1' };
  const gate = () => ({
    precheckPancakeCancel: jest.fn().mockResolvedValue(decision),
    afterPancakeCancel: jest.fn().mockResolvedValue(undefined),
    flagPancakeCancelDivergence: jest.fn().mockResolvedValue(undefined),
  });

  it('tx đọc lại thấy đơn đã sang đang giao (không còn tự huỷ được) → ném đúng lỗi 400 cũ, và ghi dấu lệch', async () => {
    const orderStatus = gate();
    const { svc, row, userUpdate } = makeService(
      { ...baseOrder, pancakeOrderId: 'pk-1', paymentMethod: 'WALLET', paymentStatus: 'PAID' },
      { orderStatus, db: { status: 'SHIPPING' } },
    );
    await expect(svc.cancel('u1', 'TUBU1')).rejects.toThrow('Đơn đã vào quy trình giao');
    expect(row.status).toBe('SHIPPING');
    expect(userUpdate).not.toHaveBeenCalled();
    expect(orderStatus.afterPancakeCancel).not.toHaveBeenCalled();
    expect(orderStatus.flagPancakeCancelDivergence).toHaveBeenCalledWith('o1', decision, expect.stringContaining('Đơn đã vào quy trình giao'));
  });

  it('tx thua (đơn đổi chen giữa) → trả đơn như cũ, và ghi dấu lệch', async () => {
    const orderStatus = gate();
    const { svc } = makeService({ ...baseOrder, pancakeOrderId: 'pk-1' }, { orderStatus, updateMany: jest.fn().mockResolvedValue({ count: 0 }) });
    await svc.cancel('u1', 'TUBU1');
    expect(orderStatus.flagPancakeCancelDivergence).toHaveBeenCalledWith('o1', decision, expect.any(String));
  });

  it('huỷ thành công → không ghi dấu lệch', async () => {
    const orderStatus = gate();
    const { svc, row } = makeService({ ...baseOrder, pancakeOrderId: 'pk-1' }, { orderStatus });
    await svc.cancel('u1', 'TUBU1');
    expect(row.status).toBe('CANCELLED');
    expect(orderStatus.flagPancakeCancelDivergence).not.toHaveBeenCalled();
  });
});

describe('OrdersService.cancel — atomic flip+refund (B1)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('WALLET+PAID: status flip + walletBalance increment THỰC HIỆN trong cùng $transaction callback', async () => {
    const { svc, $transaction, updateMany, userUpdate } = makeService({
      ...baseOrder,
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
    });
    await svc.cancel('u1', 'TUBU1');
    // $transaction được gọi với 1 callback (function), không phải array of ops
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(typeof $transaction.mock.calls[0]?.[0]).toBe('function');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1', status: 'CONFIRMED' },
        data: { status: 'CANCELLED' },
      }),
    );
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { walletBalance: { increment: 300000 } } }),
    );
  });

  it('COD+UNPAID huỷ TRƯỚC khi giao (status snapshot=CONFIRMED): chỉ flip status, KHÔNG thử guard hoàn tiền, KHÔNG đụng walletBalance', async () => {
    const { svc, $transaction, userUpdate, updateMany, row } = makeService({
      ...baseOrder,
      status: 'CONFIRMED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
    });
    await svc.cancel('u1', 'TUBU1');
    expect($transaction).toHaveBeenCalledTimes(1);
    // A6-06 (docs/audit-2026-09/06-web.md): COD chỉ coi là "đã thu tiền" khi status snapshot TRƯỚC
    // lần đảo là DELIVERED (xem OrderReversalService.reverseFinancials) — khách tự huỷ đơn COD chỉ
    // được phép khi còn PENDING_PAYMENT/CONFIRMED (chưa giao), nên ở đây KHÔNG được thử bất kỳ guard
    // hoàn tiền nào (khác bản cũ: luôn thử guard PAID rồi thua). Chỉ có 1 lệnh updateMany — flip status (ghi mốc
    // reversalEffectsAt sau commit là lệnh riêng, không phải guard hoàn tiền).
    expect(updateMany.mock.calls.filter(([a]) => !('reversalEffectsAt' in (a as { data: object }).data))).toHaveLength(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1', status: 'CONFIRMED' }, data: { status: 'CANCELLED' } }),
    );
    expect(userUpdate).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
  });

  it('race count=0: KHÔNG gọi reverseOrderPoints, KHÔNG hoàn ví', async () => {
    const userUpdate = jest.fn().mockResolvedValue({});
    const { svc } = makeService(
      { ...baseOrder, paymentMethod: 'WALLET', paymentStatus: 'PAID' },
      { updateMany: jest.fn().mockResolvedValue({ count: 0 }), userUpdate },
    );
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).not.toHaveBeenCalled();
    expect((loyalty.reverseOrderPoints as jest.Mock)).not.toHaveBeenCalled();
    expect((affiliate.reverseCommissionsForOrder as jest.Mock)).not.toHaveBeenCalled();
  });
});

/**
 * RACE tiền: cancel() đọc đơn (detail) NGOÀI tx. Giữa lần đọc đó và tx huỷ, admin xác nhận chuyển khoản
 * (POST /admin/dealer-orders/:id/confirm-payment: PENDING_PAYMENT+UNPAID → CONFIRMED+PAID) hoặc webhook
 * Pancake/ZaloPay lật PAID. Bản cũ: đơn vẫn bị huỷ nhưng KHÔNG hoàn tiền (ảnh chụp nói UNPAID).
 */
describe('OrdersService.cancel — trạng thái đổi giữa lúc đọc đơn và tx huỷ', () => {
  beforeEach(() => jest.clearAllMocks());
  const pending = { ...baseOrder, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' };

  it('ảnh chụp UNPAID nhưng DB đã PAID (admin xác nhận CK chen giữa) → hoàn ví ĐÚNG 1 lần, kể cả khi huỷ lặp', async () => {
    const { svc, userUpdate, row, historyCreate } = makeService(pending, {
      db: { status: 'CONFIRMED', paymentStatus: 'PAID' },
    });
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { walletBalance: { increment: 300000 } } });
    expect(row).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });
    // Lịch sử ghi đúng trạng thái THẬT trước khi huỷ (CONFIRMED), không phải ảnh chụp PENDING_PAYMENT.
    expect(historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: 'CONFIRMED', toStatus: 'CANCELLED', actorType: 'CUSTOMER', actorId: 'u1' }),
    });
    // Double-tap / retry: ảnh chụp vẫn cũ nhưng DB đã CANCELLED → không hoàn lần 2, không ghi vết lần 2.
    await svc.cancel('u1', 'TUBU1');
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(historyCreate).toHaveBeenCalledTimes(1);
    expect((loyalty.reverseOrderPoints as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('guard lật trạng thái theo ĐÚNG trạng thái hiện tại trong DB (đọc lại sau khi khoá dòng FOR UPDATE)', async () => {
    const { svc, updateMany, lockRow, txFindUnique } = makeService(pending, {
      db: { status: 'CONFIRMED', paymentStatus: 'PAID' },
    });
    await svc.cancel('u1', 'TUBU1');
    const sql = (lockRow.mock.calls[0]![0] as string[]).join('?');
    expect(sql).toMatch(/FROM "orders"[\s\S]*FOR UPDATE/);
    expect(lockRow.mock.invocationCallOrder[0]).toBeLessThan(txFindUnique.mock.invocationCallOrder[0]!);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'o1', status: 'CONFIRMED' }, data: { status: 'CANCELLED' } });
  });

  it('DB đã chuyển SHIPPING sau khi đọc đơn → từ chối huỷ, KHÔNG lật trạng thái, KHÔNG hoàn tiền/kho', async () => {
    const { svc, updateMany, userUpdate, executeRaw, historyCreate, row } = makeService(
      { ...baseOrder, paymentMethod: 'WALLET', paymentStatus: 'PAID', items: [{ variationId: 'v1', quantity: 1, backorderedQty: 0 }] },
      { db: { status: 'SHIPPING' } },
    );
    await expect(svc.cancel('u1', 'TUBU1')).rejects.toThrow('Đơn đã vào quy trình giao');
    expect(updateMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(historyCreate).not.toHaveBeenCalled();
    expect(row.status).toBe('SHIPPING');
    expect((loyalty.reverseOrderPoints as jest.Mock)).not.toHaveBeenCalled();
  });

  it('webhook Gomdon báo bưu tá đã lấy hàng sau khi đọc đơn → từ chối huỷ trong tx', async () => {
    const { svc, updateMany } = makeService(
      { ...baseOrder, hasRecyclingPickup: true, gomdonOrderId: '77', gomdonStatus: '1' },
      { db: { gomdonStatus: '3' } },
    );
    await expect(svc.cancel('u1', 'TUBU1')).rejects.toThrow('bưu tá lấy hàng');
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('OrdersService.cancel — B5 restock', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cancel THẮNG → tx.variation.update increment cho mỗi item', async () => {
    const items = [
      { variationId: 'v1', quantity: 2, backorderedQty: 0 },
      { variationId: 'v2', quantity: 5, backorderedQty: 0 },
    ];
    const { svc, executeRaw } = makeService({ ...baseOrder, items });
    await svc.cancel('u1', 'TUBU1');
    expect(executeRaw).toHaveBeenCalledTimes(2);
    // Tham số câu UPDATE hoàn kho: (số lượng, số lượng, variationId).
    expect(executeRaw.mock.calls[0]!.slice(1)).toEqual([2, 2, 'v1']);
    expect(executeRaw.mock.calls[1]!.slice(1)).toEqual([5, 5, 'v2']);
  });

  it('cancel THUA race (count=0) → KHÔNG restock', async () => {
    const items = [{ variationId: 'v1', quantity: 2, backorderedQty: 0 }];
    const { svc, executeRaw } = makeService(
      { ...baseOrder, items },
      { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    );
    await svc.cancel('u1', 'TUBU1');
    expect(executeRaw).not.toHaveBeenCalled();
  });
});

describe('OrdersService.cancel — flash sale quota restore', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cancel THẮNG → gọi flash.restore(tx, itemId, userId, qty) cho item có flashSaleItemId', async () => {
    const items = [
      { variationId: 'v1', quantity: 2, flashSaleItemId: 'fi1', backorderedQty: 0 },
      { variationId: 'v2', quantity: 5, flashSaleItemId: null, backorderedQty: 0 },
    ];
    const { svc } = makeService({ ...baseOrder, items });
    await svc.cancel('u1', 'TUBU1');
    expect(flash.restore).toHaveBeenCalledTimes(1);
    expect(flash.restore).toHaveBeenCalledWith(expect.anything(), 'fi1', 'u1', 2);
  });

  it('cancel THUA race (count=0) → KHÔNG gọi flash.restore', async () => {
    const items = [{ variationId: 'v1', quantity: 2, flashSaleItemId: 'fi1', backorderedQty: 0 }];
    const { svc } = makeService(
      { ...baseOrder, items },
      { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    );
    await svc.cancel('u1', 'TUBU1');
    expect(flash.restore).not.toHaveBeenCalled();
  });
});

describe('OrdersService.cancel — đơn thu gom tái chế (Gomdon)', () => {
  beforeEach(() => jest.clearAllMocks());
  const queue = () => ({ getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue({}) });

  it('khách huỷ đơn thu gom đã có vận đơn → enqueue job huỷ vận đơn Gomdon', async () => {
    const q = queue();
    const { svc } = makeService({ ...baseOrder, hasRecyclingPickup: true, gomdonOrderId: '77', gomdonStatus: '1' }, { gomdonQueue: q });
    await svc.cancel('u1', 'TUBU1');
    expect(q.add).toHaveBeenCalledWith('cancel', { orderId: 'o1' }, expect.objectContaining({ jobId: 'cancel-o1' }));
  });

  it('bưu tá Gomdon đã lấy hàng (webhook SHIPPING tới trễ) → KHÔNG cho khách tự huỷ', async () => {
    const q = queue();
    const { svc, updateMany } = makeService({ ...baseOrder, hasRecyclingPickup: true, gomdonOrderId: '77', gomdonStatus: '3' }, { gomdonQueue: q });
    await expect(svc.cancel('u1', 'TUBU1')).rejects.toThrow('bưu tá lấy hàng');
    expect(updateMany).not.toHaveBeenCalled();
    expect(q.add).not.toHaveBeenCalled();
  });

  it('đơn thường → không enqueue huỷ Gomdon; thua race (count=0) → không enqueue', async () => {
    const q = queue();
    const a = makeService({ ...baseOrder }, { gomdonQueue: q });
    await a.svc.cancel('u1', 'TUBU1');
    expect(q.add).not.toHaveBeenCalled();
    const q2 = queue();
    const b = makeService(
      { ...baseOrder, hasRecyclingPickup: true, gomdonOrderId: '77' },
      { gomdonQueue: q2, updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    );
    await b.svc.cancel('u1', 'TUBU1').catch(() => undefined);
    expect(q2.add).not.toHaveBeenCalled();
  });
});

describe('OrdersService.list / activeCount — nhóm trạng thái (tab Đơn hàng)', () => {
  function makeListService() {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      order: { findMany, count },
      variation: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    return { svc: new OrdersService(prisma, loyalty, cart, notifications, config, affiliate, reversal), findMany, count };
  }

  it('group=processing → CONFIRMED + PACKED', async () => {
    const { svc, findMany, count } = makeListService();
    await svc.list('u1', { group: 'processing' }, 1, 20);
    const where = { userId: 'u1', status: { in: ['CONFIRMED', 'PACKED'] } };
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('group=closed → CANCELLED + RETURNED (trước đây RETURNED chỉ thấy ở "Tất cả" — A2-47)', async () => {
    const { svc, findMany } = makeListService();
    await svc.list('u1', { group: 'closed' }, 1, 20);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', status: { in: ['CANCELLED', 'RETURNED'] } } }),
    );
  });

  it('status đơn lẻ thắng group; phân trang giữ nguyên', async () => {
    const { svc, findMany } = makeListService();
    await svc.list('u1', { status: 'SHIPPING', group: 'closed' }, 2, 10);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', status: 'SHIPPING' }, skip: 10, take: 10 }),
    );
  });

  it('không lọc → chỉ theo userId', async () => {
    const { svc, findMany } = makeListService();
    await svc.list('u1', {}, 1, 20);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
  });

  it('activeCount đếm 4 trạng thái đang xử lý của chính user', async () => {
    const { svc, count } = makeListService();
    count.mockResolvedValue(2);
    await expect(svc.activeCount('u1')).resolves.toEqual({ count: 2 });
    expect(count).toHaveBeenCalledWith({
      where: { userId: 'u1', status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'] } },
    });
  });
});

describe('OrdersService.list — ô tìm kiếm theo mã đơn / tên sản phẩm (R2-BUYERWEB-8)', () => {
  const order = (id: string, code: string, names: string[]) => ({
    ...baseOrder, id, code, items: names.map((n, i) => ({ ...line(`${id}-${i}`, `v-${id}-${i}`), productName: n })),
  });
  const ORDERS = [
    order('o1', 'TUBU2026101401', ['Dầu gội bưởi', 'Nước rửa chén']),
    order('o2', 'TUBU2026101302', ['Mật ong rừng']),
    order('o3', 'TUBU2026101203', ['Dầu gội bồ kết']),
  ];

  function makeSearchService() {
    const findMany = jest.fn(async (args: { where: Record<string, unknown>; select?: unknown }) => {
      if (args.select) return ORDERS.map(({ id, code, items }) => ({ id, code, items: items.map((i) => ({ productName: i.productName })) }));
      const ids = (args.where.id as { in: string[] } | undefined)?.in;
      return ids ? ORDERS.filter((o) => ids.includes(o.id)) : [];
    });
    const count = jest.fn().mockResolvedValue(999);
    const prisma = {
      order: { findMany, count },
      variation: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    return { svc: new OrdersService(prisma, loyalty, cart, notifications, config, affiliate, reversal), findMany, count };
  }

  it('gõ không dấu vẫn khớp tên sản phẩm có dấu, đơn mới nhất trước, tổng = số đơn khớp', async () => {
    const { svc } = makeSearchService();
    const res = await svc.list('u1', { q: 'dau goi' }, 1, 20);
    expect(res.data.map((o) => o.code)).toEqual(['TUBU2026101401', 'TUBU2026101203']);
    expect(res.meta).toEqual({ page: 1, limit: 20, total: 2 });
  });

  it('khớp mã đơn (không phân biệt hoa thường, bỏ dấu # đầu)', async () => {
    const { svc } = makeSearchService();
    const res = await svc.list('u1', { q: '#tubu20261013' }, 1, 20);
    expect(res.data.map((o) => o.code)).toEqual(['TUBU2026101302']);
  });

  it('chỉ quét đơn của chính user và áp luôn bộ lọc trạng thái', async () => {
    const { svc, findMany } = makeSearchService();
    await svc.list('u1', { q: 'mat ong', group: 'closed' }, 1, 20);
    expect(findMany.mock.calls[0]![0].where).toEqual({ userId: 'u1', status: { in: ['CANCELLED', 'RETURNED'] } });
  });

  it('phân trang trên tập đã khớp', async () => {
    const { svc } = makeSearchService();
    const page2 = await svc.list('u1', { q: 'dau goi' }, 2, 1);
    expect(page2.data.map((o) => o.code)).toEqual(['TUBU2026101203']);
    expect(page2.meta.total).toBe(2);
  });

  it('không khớp đơn nào → danh sách rỗng, không truy vấn trang', async () => {
    const { svc, findMany } = makeSearchService();
    const res = await svc.list('u1', { q: 'khong co' }, 1, 20);
    expect(res.data).toEqual([]);
    expect(res.meta.total).toBe(0);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('q rỗng/chỉ khoảng trắng → danh sách thường (đếm bằng count)', async () => {
    const { svc, count } = makeSearchService();
    await svc.list('u1', { q: '   ' }, 1, 20);
    expect(count).toHaveBeenCalled();
  });
});

describe('OrdersService — ảnh + tồn kho từng dòng đơn (join theo variationId, không thêm cột)', () => {
  const v = (id: string, over: Record<string, unknown> = {}, product: Record<string, unknown> = {}) => ({
    id, stock: 5, isActive: true, retailPrice: 60000, salePrice: null, ...over,
    product: { thumbnail: `https://img.test/${id}.jpg`, images: [], isActive: true, approvalStatus: 'APPROVED', ...product },
  });

  function makeMediaService(orders: Record<string, unknown>[], variations: Record<string, unknown>[]) {
    const variationFindMany = jest.fn().mockResolvedValue(variations);
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue(orders),
        count: jest.fn().mockResolvedValue(orders.length),
        findUnique: jest.fn().mockResolvedValue(orders[0] ?? null),
      },
      variation: { findMany: variationFindMany },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    return { svc: new OrdersService(prisma, loyalty, cart, notifications, config, affiliate, reversal), variationFindMany };
  }

  it('list: MỘT truy vấn variation cho cả trang; mỗi dòng có thumbnail/stock/available/currentPrice', async () => {
    const orders = [
      { ...baseOrder, id: 'o1', code: 'A', items: [line('i1', 'v1'), line('i2', 'v2')] },
      { ...baseOrder, id: 'o2', code: 'B', items: [line('i3', 'v1')] },
    ];
    const { svc, variationFindMany } = makeMediaService(orders, [v('v1', { salePrice: 55000 }), v('v2', { stock: 0 })]);
    const res = await svc.list('u1', {}, 1, 20);
    expect(variationFindMany).toHaveBeenCalledTimes(1);
    expect(variationFindMany.mock.calls[0]![0].where).toEqual({ id: { in: ['v1', 'v2'] } });
    expect(res.data[0]!.items[0]).toMatchObject({ id: 'i1', thumbnail: 'https://img.test/v1.jpg', stock: 5, available: true, currentPrice: 55000 });
    expect(res.data[0]!.items[1]).toMatchObject({ id: 'i2', stock: 0, available: false, currentPrice: 60000 });
    expect(res.data[1]!.items[0]).toMatchObject({ id: 'i3', available: true });
  });

  it.each([
    ['variation tắt', { isActive: false }, {}],
    ['sản phẩm tắt', {}, { isActive: false }],
    ['sản phẩm chưa duyệt', {}, { approvalStatus: 'PENDING_REVIEW' }],
    ['sản phẩm bị từ chối', {}, { approvalStatus: 'REJECTED' }],
  ])('available=false khi %s', async (_label, vOver, pOver) => {
    const { svc } = makeMediaService([{ ...baseOrder, items: [line('i1', 'v1')] }], [v('v1', vOver, pOver)]);
    const res = await svc.list('u1', {}, 1, 20);
    expect(res.data[0]!.items[0]!.available).toBe(false);
  });

  it('variation đã bị xoá → thumbnail null, stock 0, available false, currentPrice null', async () => {
    const { svc } = makeMediaService([{ ...baseOrder, items: [line('i1', 'gone')] }], []);
    const res = await svc.list('u1', {}, 1, 20);
    expect(res.data[0]!.items[0]).toMatchObject({ thumbnail: null, stock: 0, available: false, currentPrice: null });
  });

  it('thumbnail rơi về images[0] khi product.thumbnail null', async () => {
    const { svc } = makeMediaService(
      [{ ...baseOrder, items: [line('i1', 'v1')] }],
      [v('v1', {}, { thumbnail: null, images: ['https://img.test/first.jpg'] })],
    );
    const res = await svc.list('u1', {}, 1, 20);
    expect(res.data[0]!.items[0]!.thumbnail).toBe('https://img.test/first.jpg');
  });

  it('detailView: gắn media cho đơn của chính user; đơn không có dòng nào → không truy vấn variation', async () => {
    const withItems = makeMediaService([{ ...baseOrder, items: [line('i1', 'v1')] }], [v('v1')]);
    const view = await withItems.svc.detailView('u1', 'TUBU1');
    expect(view.items[0]).toMatchObject({ id: 'i1', available: true, stock: 5 });

    const empty = makeMediaService([{ ...baseOrder, items: [] }], []);
    await empty.svc.detailView('u1', 'TUBU1');
    expect(empty.variationFindMany).not.toHaveBeenCalled();
  });

  it('D4: đơn đối tác tự giao → chi tiết đơn nêu gian hàng giao + hotline, và các đơn cùng lần đặt', async () => {
    const order = { ...baseOrder, code: 'TUBU2', items: [], fulfiller: 'MERCHANT', fulfillerStorefrontId: 'sf-a', checkoutGroup: 'TUBU1' };
    const siblings = [{ code: 'TUBU1', status: 'CONFIRMED', total: 120_000, fulfiller: 'TUBU', fulfillerStorefront: null }];
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(order), findMany: jest.fn().mockResolvedValue(siblings) },
      storefront: { findUnique: jest.fn().mockResolvedValue({ title: 'Xanh Shop', warehousePhone: '0909000111' }) },
      variation: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const view = await new OrdersService(prisma, loyalty, cart, notifications, config, affiliate, reversal).detailView('u1', 'TUBU2');
    expect(view.fulfilment).toEqual({ kind: 'MERCHANT', name: 'Xanh Shop', phone: '0909000111' });
    expect(view.siblings).toEqual([{ code: 'TUBU1', status: 'CONFIRMED', total: 120_000, fulfillerName: 'Tubu Tree' }]);
    expect((prisma.order.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      checkoutGroup: 'TUBU1',
      userId: 'u1',
      code: { not: 'TUBU2' },
    });
  });

  describe('R4-BUYER-6: đơn tách của gian hàng đối tác nêu mã giảm giá của lần đặt', () => {
    const detailWith = async (order: Record<string, unknown>, siblings: Record<string, unknown>[]) => {
      const prisma = {
        order: { findUnique: jest.fn().mockResolvedValue(order), findMany: jest.fn().mockResolvedValue(siblings) },
        storefront: { findUnique: jest.fn().mockResolvedValue({ title: 'Xanh Shop', warehousePhone: null }) },
        variation: { findMany: jest.fn() },
      } as unknown as PrismaService;
      return new OrdersService(prisma, loyalty, cart, notifications, config, affiliate, reversal).detailView('u1', String(order.code));
    };
    const sibling = (over: Record<string, unknown> = {}) => ({
      code: 'TUBU1', status: 'CONFIRMED', total: 120_000, fulfiller: 'TUBU', fulfillerStorefront: null, couponCode: null, ...over,
    });

    it('đơn đối tác không giữ lượt dùng mã (couponCode null) mà đơn đầu của nhóm giữ → trả groupCouponCode để màn khách ghi đúng mã', async () => {
      const order = { ...baseOrder, code: 'TUBU2', items: [], fulfiller: 'MERCHANT', fulfillerStorefrontId: 'sf-a', checkoutGroup: 'TUBU1', couponCode: null };
      const view = await detailWith(order, [sibling({ couponCode: 'XANH10' })]);
      expect(view.groupCouponCode).toBe('XANH10');
      expect(view.couponCode).toBeNull();
    });

    it('đơn giữ mã thì không cần groupCouponCode; nhóm không có mã thì null', async () => {
      const holder = { ...baseOrder, code: 'TUBU1', items: [], fulfiller: 'TUBU', checkoutGroup: 'TUBU1', couponCode: 'XANH10' };
      expect((await detailWith(holder, [sibling({ code: 'TUBU2', couponCode: null })])).groupCouponCode).toBeNull();
      const none = { ...baseOrder, code: 'TUBU2', items: [], fulfiller: 'MERCHANT', fulfillerStorefrontId: 'sf-a', checkoutGroup: 'TUBU1', couponCode: null };
      expect((await detailWith(none, [sibling()])).groupCouponCode).toBeNull();
    });

    it('chỉ đọc thêm cột couponCode của đơn cùng nhóm, đơn không tách không truy vấn nhóm', async () => {
      const order = { ...baseOrder, code: 'TUBU2', items: [], fulfiller: 'MERCHANT', fulfillerStorefrontId: 'sf-a', checkoutGroup: 'TUBU1', couponCode: null };
      const prisma = {
        order: { findUnique: jest.fn().mockResolvedValue(order), findMany: jest.fn().mockResolvedValue([sibling()]) },
        storefront: { findUnique: jest.fn().mockResolvedValue({ title: 'Xanh Shop', warehousePhone: null }) },
        variation: { findMany: jest.fn() },
      } as unknown as PrismaService;
      await new OrdersService(prisma, loyalty, cart, notifications, config, affiliate, reversal).detailView('u1', 'TUBU2');
      expect((prisma.order.findMany as jest.Mock).mock.calls[0][0].select).toMatchObject({ couponCode: true });
      const solo = makeMediaService([{ ...baseOrder, items: [] }], []);
      expect((await solo.svc.detailView('u1', 'TUBU1')).groupCouponCode).toBeNull();
    });
  });

  it('R2-MERCHANT-14, R3-MERCHANT-1: đơn trả cho khách không kèm phí sàn đối tác, hoa hồng CTV, mã đơn Pancake, khoá chống đặt trùng hay cột vận hành nội bộ', async () => {
    const internal = {
      merchantCommissionPct: '0.1500',
      commission: 12_000,
      endCustomerKey: '0909',
      pancakeSyncError: 'lỗi',
      pancakePushStatus: 'FAILED',
      pancakePushAttempts: 3,
      pancakeAttention: 'X',
      merchantSlaNotifiedAt: new Date(),
      gomdonAttempt: 1,
      pancakeOrderId: 'pk-1',
      idempotencyKey: 'idem-1',
      reviewInvitedAt: new Date(),
      autoCancelBlockedAt: new Date(),
      recipientSearch: 'nguyen van a 12 le loi',
    };
    const { svc } = makeMediaService([{ ...baseOrder, ...internal, items: [] }], []);
    const view = (await svc.detailView('u1', 'TUBU1')) as unknown as Record<string, unknown>;
    const page = (await svc.list('u1', {}, 1, 20)).data[0] as unknown as Record<string, unknown>;
    for (const k of Object.keys(internal)) {
      expect(view).not.toHaveProperty(k);
      expect(page).not.toHaveProperty(k);
    }
    expect(view).toMatchObject({ code: baseOrder.code, total: baseOrder.total });
  });

  describe('canCancel — nút "Hủy đơn" theo đúng luật huỷ của khách, gồm mốc bàn giao vận chuyển (R3-CANCEL-2)', () => {
    it.each([
      ['Đang đóng gói, chưa đặt hãng', { status: 'PACKED' }, true],
      ['Đang đóng gói, kho đã đặt hãng (Pancake gắn mã GHN)', { status: 'PACKED', shippingCode: 'GHN1933', shippingPartner: 'GHN' }, false],
      ['Đã xác nhận, gian hàng đã gửi hàng', { status: 'CONFIRMED', shippedAt: new Date() }, false],
      ['Đang đóng gói, mã vận đơn là của Gomdon (bưu tá chưa tới)', { status: 'PACKED', hasRecyclingPickup: true, gomdonPartnerCode: 'BE1', shippingCode: 'BE1', gomdonStatus: '1' }, true],
      ['Bưu tá Gomdon đã lấy hàng', { status: 'CONFIRMED', hasRecyclingPickup: true, gomdonPartnerCode: 'BE1', gomdonStatus: '3' }, false],
      ['Đang giao', { status: 'SHIPPING' }, false],
      ['Đơn đại lý đang đóng gói', { status: 'PACKED', type: 'DEALER' }, false],
      ['CTV xem đơn lên hộ khách đã trả', { status: 'CONFIRMED', placedForCustomer: true, paymentStatus: 'PAID', referrerUserId: 'u1' }, false],
      [
        'Chờ chuyển khoản, hệ thống đã thôi tự huỷ vì Pancake đã gửi hàng (R5-SYNC-1)',
        { status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', autoCancelBlockedAt: new Date() },
        false,
      ],
    ])('%s → canCancel=%s (list + chi tiết)', async (_label, over, expected) => {
      const { svc } = makeMediaService([{ ...baseOrder, ...over, items: [] }], []);
      expect((await svc.detailView('u1', 'TUBU1')).canCancel).toBe(expected);
      expect((await svc.list('u1', {}, 1, 20)).data[0]!.canCancel).toBe(expected);
    });

    it('khớp đúng lần huỷ thật: canCancel=false thì POST huỷ bị từ chối với lời "đã bàn giao"', async () => {
      const shipped = { ...baseOrder, status: 'PACKED', shippingCode: 'GHN1933', shippingPartner: 'GHN' };
      const { svc } = makeMediaService([{ ...shipped, items: [] }], []);
      expect((await svc.detailView('u1', 'TUBU1')).canCancel).toBe(false);
      const { svc: cancelSvc, updateMany } = makeService(shipped);
      await expect(cancelSvc.cancel('u1', 'TUBU1')).rejects.toThrow('Đơn đã bàn giao cho đơn vị vận chuyển');
      expect(updateMany).not.toHaveBeenCalled();
    });
  });

  describe('đơn chờ chuyển khoản mà hàng đã bàn giao vận chuyển — hệ thống thôi tự huỷ (R5-SYNC-1)', () => {
    const created = new Date('2026-10-14T01:20:56.000Z');
    const waiting = { ...baseOrder, type: 'RETAIL', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', createdAt: created, items: [] };

    it('không còn hạn thanh toán / "quá hạn đơn sẽ tự huỷ", không có nút huỷ, báo app/web hiện câu trung tính (manualHandling)', async () => {
      const { svc } = makeMediaService([{ ...waiting, autoCancelBlockedAt: new Date('2026-10-15T02:30:00Z') }], []);
      const view = await svc.detailView('u1', 'TUBU1');
      expect(view).toMatchObject({ paymentDeadline: null, canCancel: false, manualHandling: true });
      expect(view).not.toHaveProperty('autoCancelBlockedAt');
      expect((await svc.list('u1', {}, 1, 20)).data[0]).toMatchObject({ canCancel: false, manualHandling: true });
    });

    it('đơn chờ chuyển khoản bình thường vẫn có hạn và nút huỷ, manualHandling=false', async () => {
      const { svc } = makeMediaService([{ ...waiting, autoCancelBlockedAt: null }], []);
      const view = await svc.detailView('u1', 'TUBU1');
      expect(view).toMatchObject({ paymentDeadline: '2026-10-15T01:20:56.000Z', canCancel: true, manualHandling: false });
    });

    it('đã nhận tiền sau đó (CONFIRMED) → không còn câu trung tính, vẫn không tự huỷ được (hàng đã ở hãng)', async () => {
      const { svc } = makeMediaService([{ ...waiting, status: 'CONFIRMED', paymentStatus: 'PAID', autoCancelBlockedAt: new Date() }], []);
      expect(await svc.detailView('u1', 'TUBU1')).toMatchObject({ canCancel: false, manualHandling: false, paymentDeadline: null });
    });

    it('POST huỷ bị từ chối với lời rõ ràng, KHÔNG hỏi Pancake (không đồng bộ lại → không quay về "Cần xử lý Pancake"), không lật trạng thái', async () => {
      const orderStatus = { precheckPancakeCancel: jest.fn(), afterPancakeCancel: jest.fn() };
      const { svc, $transaction, row } = makeService({ ...waiting, pancakeOrderId: 'pk-1', autoCancelBlockedAt: new Date() }, { orderStatus });
      const err = await svc.cancel('u1', 'TUBU1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toBe(
        'Đơn đã bàn giao cho đơn vị vận chuyển và Tubu đang xử lý, bạn không tự huỷ được nữa. Vui lòng liên hệ hotline hoặc Zalo OA của Tubu nếu cần hỗ trợ.',
      );
      expect(orderStatus.precheckPancakeCancel).not.toHaveBeenCalled();
      expect($transaction).not.toHaveBeenCalled();
      expect(row.status).toBe('PENDING_PAYMENT');
    });
  });

  // Mỗi lần mua một đánh giá: màn chi tiết đơn cần biết từng dòng đã có đánh giá của đơn này chưa để nói "Viết đánh giá"
  // hay "Sửa đánh giá", cùng luật với can-review (chỉ đơn đã nhận mua lẻ cho chính mình).
  describe('trạng thái đánh giá từng dòng ở chi tiết đơn', () => {
    const delivered = { ...baseOrder, status: 'DELIVERED', type: 'RETAIL', placedForCustomer: false };
    function reviewService(order: Record<string, unknown>, reviews: { id: string; productId: string }[] = []) {
      const variationFindMany = jest.fn(async (args: { select: Record<string, unknown> }) =>
        args.select.productId
          ? [{ id: 'v1', productId: 'p1' }, { id: 'v1b', productId: 'p1' }, { id: 'v2', productId: 'p2' }]
          : [v('v1'), v('v1b'), v('v2')],
      );
      const reviewFindMany = jest.fn().mockResolvedValue(reviews);
      const prisma = {
        order: { findUnique: jest.fn().mockResolvedValue(order), findMany: jest.fn().mockResolvedValue([order]), count: jest.fn().mockResolvedValue(1) },
        variation: { findMany: variationFindMany },
        review: { findMany: reviewFindMany },
        pointsTransaction: { aggregate: jest.fn().mockResolvedValue({ _sum: { delta: null } }) },
        $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      } as unknown as PrismaService;
      return { svc: new OrdersService(prisma, loyalty, cart, notifications, config, affiliate, reversal), reviewFindMany };
    }

    it('đơn đã nhận: dòng có đánh giá của đơn này → reviewId, không viết mới; dòng chưa có → viết được; hai biến thể cùng sản phẩm chung một đánh giá', async () => {
      const { svc, reviewFindMany } = reviewService(
        { ...delivered, items: [line('i1', 'v1'), line('i2', 'v2'), line('i3', 'v1b')] },
        [{ id: 'r-p1', productId: 'p1' }],
      );
      const view = await svc.detailView('u1', 'TUBU1');
      expect(view.items.map((it) => [it.id, it.reviewId, it.reviewable])).toEqual([
        ['i1', 'r-p1', false],
        ['i2', null, true],
        ['i3', 'r-p1', false],
      ]);
      expect(reviewFindMany).toHaveBeenCalledWith({
        where: { userId: 'u1', orderId: 'o1', productId: { in: ['p1', 'p2'] } },
        select: { id: true, productId: true },
      });
    });

    it('biến thể đã bị xoá (không biết sản phẩm) → không viết được, không có đánh giá', async () => {
      const { svc } = reviewService({ ...delivered, items: [line('i1', 'gone')] });
      expect((await svc.detailView('u1', 'TUBU1')).items[0]).toMatchObject({ reviewId: null, reviewable: false });
    });

    it.each([
      ['chưa giao xong', { status: 'SHIPPING' }],
      ['đơn CTV lên hộ khách', { placedForCustomer: true }],
      ['đơn đại lý', { type: 'DEALER' }],
    ])('%s → mọi dòng không viết được, không tra đánh giá', async (_n, over) => {
      const { svc, reviewFindMany } = reviewService({ ...delivered, ...over, items: [line('i1', 'v1')] }, [{ id: 'r-p1', productId: 'p1' }]);
      expect((await svc.detailView('u1', 'TUBU1')).items[0]).toMatchObject({ reviewId: null, reviewable: false });
      expect(reviewFindMany).not.toHaveBeenCalled();
    });

    it('danh sách đơn không tra đánh giá (chỉ màn chi tiết cần)', async () => {
      const { svc, reviewFindMany } = reviewService({ ...delivered, items: [line('i1', 'v1')] });
      const page = await svc.list('u1', {}, 1, 20);
      expect(reviewFindMany).not.toHaveBeenCalled();
      expect(page.data[0]!.items[0]).not.toHaveProperty('reviewable');
    });
  });

  it('D4: đơn Tubu không tách → nơi giao Tubu Tree, không truy vấn đơn cùng lần đặt', async () => {
    const withItems = makeMediaService([{ ...baseOrder, items: [] }], []);
    const view = await withItems.svc.detailView('u1', 'TUBU1');
    expect(view.fulfilment).toEqual({ kind: 'TUBU', name: 'Tubu Tree', phone: null });
    expect(view.siblings).toEqual([]);
  });
});

describe('OrdersService.list — hạn thanh toán trên thẻ đơn (D7-2)', () => {
  const created = new Date('2026-10-14T01:20:56.000Z');
  const waiting = {
    ...baseOrder, type: 'RETAIL', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID',
    createdAt: created, autoCancelBlockedAt: null, items: [],
  };

  function listService(orders: Record<string, unknown>[], ttl: Record<string, unknown> = {}) {
    const get = jest.fn(async (key: string, fb?: unknown) => (key in ttl ? ttl[key] : fb));
    const prisma = {
      order: { findMany: jest.fn().mockResolvedValue(orders), count: jest.fn().mockResolvedValue(orders.length) },
      variation: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as PrismaService;
    const cfg = { get } as unknown as SystemConfigService;
    return { svc: new OrdersService(prisma, loyalty, cart, notifications, cfg, affiliate, reversal), get };
  }

  it('đơn chuyển khoản chờ tiền có paymentDeadline = lúc đặt + TTL (mặc định 24 giờ); đơn khác để null', async () => {
    const { svc } = listService([
      { ...waiting, id: 'o1', code: 'A' },
      { ...waiting, id: 'o2', code: 'B', paymentMethod: 'COD' },
      { ...waiting, id: 'o3', code: 'C', status: 'CONFIRMED', paymentStatus: 'PAID' },
      { ...waiting, id: 'o4', code: 'D', autoCancelBlockedAt: new Date('2026-10-15T02:30:00Z') },
    ]);
    const res = await svc.list('u1', {}, 1, 20);
    expect(res.data.map((o) => o.paymentDeadline)).toEqual(['2026-10-15T01:20:56.000Z', null, null, null]);
  });

  it('đọc TTL MỘT lần cho cả trang dù nhiều đơn chờ tiền; đơn đại lý dùng TTL riêng', async () => {
    const { svc, get } = listService(
      [
        { ...waiting, id: 'o1', code: 'A' },
        { ...waiting, id: 'o2', code: 'B' },
        { ...waiting, id: 'o3', code: 'C', type: 'DEALER' },
      ],
      { 'orders.pending_payment_ttl_hours': 12, 'orders.dealer_pending_payment_ttl_hours': 48 },
    );
    const res = await svc.list('u1', {}, 1, 20);
    expect(res.data.map((o) => o.paymentDeadline)).toEqual(['2026-10-14T13:20:56.000Z', '2026-10-14T13:20:56.000Z', '2026-10-16T01:20:56.000Z']);
    expect(get.mock.calls.filter(([k]) => k === 'orders.pending_payment_ttl_hours')).toHaveLength(1);
  });

  it('trang không có đơn chờ tiền thì không đọc cấu hình TTL', async () => {
    const { svc, get } = listService([{ ...baseOrder, items: [] }]);
    await svc.list('u1', {}, 1, 20);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('OrdersService.repurchase v2 — mỗi dòng xử lý độc lập (A2-05)', () => {
  const CART = { items: [{ id: 'ci1', fulfiller: { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' } }], couponCode: null, subtotal: 150000, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 3 };
  const variation = (id: string, stock: number, over: { isActive?: boolean; productActive?: boolean; approval?: string } = {}) => ({
    id, stock, isActive: over.isActive ?? true,
    product: { isActive: over.productActive ?? true, approvalStatus: over.approval ?? 'APPROVED' },
  });

  function makeRepurchaseService(opts: {
    items: ReturnType<typeof line>[];
    variations: ReturnType<typeof variation>[];
    inCart?: { variationId: string; quantity: number }[];
    addItem?: jest.Mock;
    addItems?: jest.Mock;
  }) {
    const addItem = opts.addItem ?? jest.fn().mockResolvedValue(CART);
    const addItems = opts.addItems ?? jest.fn().mockImplementation(async (_u: string, ls: unknown[]) => ls.map(() => ({ ok: true })));
    const getCart = jest.fn().mockResolvedValue(CART);
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue({ ...baseOrder, status: 'DELIVERED', items: opts.items }) },
      variation: { findMany: jest.fn().mockResolvedValue(opts.variations) },
      cart: { findUnique: jest.fn().mockResolvedValue(opts.inCart ? { items: opts.inCart } : null) },
    } as unknown as PrismaService;
    const cartSvc = { addItem, addItems, getCart } as unknown as CartService;
    return { svc: new OrdersService(prisma, loyalty, cartSvc, notifications, config, affiliate, reversal), addItem, addItems, getCart };
  }

  it('D9-05: đơn 8 dòng → thêm cả loạt một lần và dựng giỏ đúng một lần, không gọi addItem từng dòng', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => i + 1);
    const { svc, addItem, addItems, getCart } = makeRepurchaseService({
      items: ids.map((i) => line(`i${i}`, `v${i}`, i)),
      variations: ids.map((i) => variation(`v${i}`, 50)),
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(addItem).not.toHaveBeenCalled();
    expect(addItems).toHaveBeenCalledTimes(1);
    expect(addItems.mock.calls[0][1]).toHaveLength(8);
    expect(getCart).toHaveBeenCalledTimes(1);
    expect(res.results).toHaveLength(8);
  });

  it('không body (client cũ): thêm mọi dòng, addSource=repurchase; response VẪN là giỏ ở top-level + cart + results', async () => {
    const { svc, addItems } = makeRepurchaseService({
      items: [line('i1', 'v1', 2), line('i2', 'v2', 1)],
      variations: [variation('v1', 10), variation('v2', 10)],
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(addItems).toHaveBeenCalledWith('u1', [
      { variationId: 'v1', quantity: 2, addSource: 'repurchase' },
      { variationId: 'v2', quantity: 1, addSource: 'repurchase' },
    ]);
    expect(res).toMatchObject({ items: CART.items, subtotal: 150000, itemCount: 3 });
    expect(res.cart).toEqual(CART);
    expect(res.results).toEqual([
      { orderItemId: 'i1', status: 'added', addedQuantity: 2 },
      { orderItemId: 'i2', status: 'added', addedQuantity: 1 },
    ]);
  });

  it('R2-MERCHANT-14: giỏ trả về sau khi mua lại không kèm ID chủ gian hàng ở nơi giao từng dòng', async () => {
    const fulfiller = { kind: 'MERCHANT', storefrontId: 'sf1', name: 'Shop Xanh', ownerUserId: 'owner-9' };
    const withOwner = { ...CART, items: [{ id: 'ci1', fulfiller }] };
    const { svc } = makeRepurchaseService({ items: [line('i1', 'v1', 1)], variations: [variation('v1', 10)], addItem: jest.fn().mockResolvedValue(withOwner) });
    (svc as unknown as { cart: { getCart: jest.Mock } }).cart.getCart.mockResolvedValue(withOwner);
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(JSON.stringify(res)).not.toContain('owner-9');
    expect(res.items[0]).toMatchObject({ id: 'ci1', fulfiller: { kind: 'MERCHANT', storefrontId: 'sf1', name: 'Shop Xanh' } });
    expect(res.cart.items[0]).toEqual(res.items[0]);
  });

  it('items: chỉ các dòng được chọn, số lượng theo client', async () => {
    const { svc, addItems } = makeRepurchaseService({
      items: [line('i1', 'v1', 2), line('i2', 'v2', 1)],
      variations: [variation('v2', 10)],
    });
    const res = await svc.repurchase('u1', 'TUBU1', { items: [{ orderItemId: 'i2', quantity: 4 }] });
    expect(addItems).toHaveBeenCalledTimes(1);
    expect(addItems).toHaveBeenCalledWith('u1', [{ variationId: 'v2', quantity: 4, addSource: 'repurchase' }]);
    expect(res.results).toEqual([{ orderItemId: 'i2', status: 'added', addedQuantity: 4 }]);
  });

  it('orderItemId không thuộc đơn → 400 TRƯỚC mọi lần ghi', async () => {
    const { svc, addItems } = makeRepurchaseService({ items: [line('i1', 'v1', 1)], variations: [variation('v1', 10)] });
    await expect(svc.repurchase('u1', 'TUBU1', { items: [{ orderItemId: 'khac', quantity: 1 }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(addItems).not.toHaveBeenCalled();
  });

  it.each([
    ['variation tắt', variation('v1', 10, { isActive: false }), 'INACTIVE'],
    ['sản phẩm tắt', variation('v1', 10, { productActive: false }), 'INACTIVE'],
    ['sản phẩm chưa duyệt (trước đây thiếu kiểm này)', variation('v1', 10, { approval: 'REJECTED' }), 'NOT_APPROVED'],
    ['hết hàng', variation('v1', 0), 'OUT_OF_STOCK'],
  ])('%s → skipped, không ghi giỏ', async (_l, v, reason) => {
    const { svc, addItems } = makeRepurchaseService({ items: [line('i1', 'v1', 1)], variations: [v] });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(addItems).not.toHaveBeenCalled();
    expect(res.results).toEqual([{ orderItemId: 'i1', status: 'skipped', reason, addedQuantity: 0 }]);
  });

  it('variation đã bị xoá → skipped INACTIVE', async () => {
    const { svc } = makeRepurchaseService({ items: [line('i1', 'gone', 1)], variations: [] });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(res.results[0]).toMatchObject({ status: 'skipped', reason: 'INACTIVE' });
  });

  it('giỏ đã giữ hết tồn → EXCEEDS_STOCK; dòng sau vẫn được thêm', async () => {
    const { svc, addItems } = makeRepurchaseService({
      items: [line('i1', 'v1', 1), line('i2', 'v2', 1)],
      variations: [variation('v1', 3), variation('v2', 5)],
      inCart: [{ variationId: 'v1', quantity: 3 }],
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(res.results).toEqual([
      { orderItemId: 'i1', status: 'skipped', reason: 'EXCEEDS_STOCK', addedQuantity: 0 },
      { orderItemId: 'i2', status: 'added', addedQuantity: 1 },
    ]);
    expect(addItems).toHaveBeenCalledWith('u1', [{ variationId: 'v2', quantity: 1, addSource: 'repurchase' }]);
  });

  it('muốn 5, còn chỗ 2 → partial, kẹp đúng 2', async () => {
    const { svc, addItems } = makeRepurchaseService({
      items: [line('i1', 'v1', 5)],
      variations: [variation('v1', 3)],
      inCart: [{ variationId: 'v1', quantity: 1 }],
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(addItems).toHaveBeenCalledWith('u1', [{ variationId: 'v1', quantity: 2, addSource: 'repurchase' }]);
    expect(res.results).toEqual([{ orderItemId: 'i1', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 2 }]);
  });

  it('2 dòng cùng variation: dòng sau tính cả phần dòng trước vừa thêm', async () => {
    const { svc } = makeRepurchaseService({
      items: [line('i1', 'v1', 2), line('i2', 'v1', 2)],
      variations: [variation('v1', 3)],
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(res.results).toEqual([
      { orderItemId: 'i1', status: 'added', addedQuantity: 2 },
      { orderItemId: 'i2', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 1 },
    ]);
  });

  it('addItems báo lỗi nghiệp vụ cho 1 dòng (race tồn kho / SP vừa bị ẩn) → dòng đó skipped, dòng khác vẫn được thêm', async () => {
    const addItems = jest.fn().mockResolvedValue([{ ok: false, error: 'STOCK' }, { ok: false, error: 'UNAVAILABLE' }, { ok: true }]);
    const { svc } = makeRepurchaseService({
      items: [line('i1', 'v1', 1), line('i2', 'v2', 1), line('i3', 'v3', 1)],
      variations: [variation('v1', 5), variation('v2', 5), variation('v3', 5)],
      addItems,
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(res.results.map((r) => [r.orderItemId, r.status, r.reason])).toEqual([
      ['i1', 'skipped', 'EXCEEDS_STOCK'],
      ['i2', 'skipped', 'INACTIVE'],
      ['i3', 'added', undefined],
    ]);
  });

  it('dòng đứng trước bị addItems từ chối → phần chỗ nó giữ chỗ được trả cho dòng sau cùng variation, thêm bằng một lần addItems nữa', async () => {
    const addItems = jest
      .fn()
      .mockResolvedValueOnce([{ ok: false, error: 'STOCK' }, { ok: true }])
      .mockResolvedValueOnce([{ ok: true }]);
    const { svc } = makeRepurchaseService({
      items: [line('i1', 'v1', 2), line('i2', 'v1', 2)],
      variations: [variation('v1', 3)],
      addItems,
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(addItems).toHaveBeenCalledTimes(2);
    expect(addItems.mock.calls[1]).toEqual(['u1', [{ variationId: 'v1', quantity: 1, addSource: 'repurchase' }]]);
    expect(res.results).toEqual([
      { orderItemId: 'i1', status: 'skipped', reason: 'EXCEEDS_STOCK', addedQuantity: 0 },
      { orderItemId: 'i2', status: 'added', addedQuantity: 2 },
    ]);
  });

  it('lượt thêm bù bị từ chối thì dòng sau giữ kết quả partial cũ; không có dòng nào bị từ chối thì không có lượt bù', async () => {
    const addItems = jest
      .fn()
      .mockResolvedValueOnce([{ ok: false, error: 'STOCK' }, { ok: true }])
      .mockResolvedValueOnce([{ ok: false, error: 'STOCK' }]);
    const { svc } = makeRepurchaseService({ items: [line('i1', 'v1', 2), line('i2', 'v1', 2)], variations: [variation('v1', 3)], addItems });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(res.results[1]).toEqual({ orderItemId: 'i2', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 1 });

    const plain = makeRepurchaseService({ items: [line('i1', 'v1', 2), line('i2', 'v1', 2)], variations: [variation('v1', 3)] });
    await plain.svc.repurchase('u1', 'TUBU1');
    expect(plain.addItems).toHaveBeenCalledTimes(1);
  });

  it('lỗi hạ tầng (không phải lỗi nghiệp vụ) → ném ra, không nuốt', async () => {
    const addItems = jest.fn().mockRejectedValue(new Error('connection reset'));
    const { svc } = makeRepurchaseService({ items: [line('i1', 'v1', 1)], variations: [variation('v1', 5)], addItems });
    await expect(svc.repurchase('u1', 'TUBU1')).rejects.toThrow('connection reset');
  });

  it('addSource=reorder_notification được chuyển tới add_to_cart', async () => {
    const { svc, addItems } = makeRepurchaseService({ items: [line('i1', 'v1', 1)], variations: [variation('v1', 5)] });
    await svc.repurchase('u1', 'TUBU1', { addSource: 'reorder_notification' });
    expect(addItems).toHaveBeenCalledWith('u1', [{ variationId: 'v1', quantity: 1, addSource: 'reorder_notification' }]);
  });
});

describe('OrdersService.cancel — hook thu kèm rác (§12.2 bước 3, §17.3)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('khách tự huỷ thắng → onOrderCancelled(o1) trong cùng lần gọi, sau khi tx huỷ đã xong (spec 10.1), trước hoàn điểm thường', async () => {
    const seen: string[] = [];
    const wastePickupHooks = { onOrderCancelled: jest.fn(async () => { seen.push('onOrderCancelled'); }) };
    const { svc, $transaction } = makeService({ ...baseOrder, status: 'CONFIRMED' }, { wastePickupHooks });
    const run = $transaction.getMockImplementation()!;
    $transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const r = await run(cb);
      seen.push('tx end');
      return r;
    });
    await svc.cancel('u1', 'TUBU1');
    expect(wastePickupHooks.onOrderCancelled).toHaveBeenCalledWith('o1');
    expect(seen.indexOf('tx end')).toBeGreaterThanOrEqual(0);
    expect(seen.indexOf('tx end')).toBeLessThan(seen.indexOf('onOrderCancelled'));
    expect(wastePickupHooks.onOrderCancelled.mock.invocationCallOrder[0]!).toBeLessThan((loyalty.reverseOrderPoints as jest.Mock).mock.invocationCallOrder[0]!);
  });

  it('thua đua (đơn đã bị huỷ bởi request khác) → không gọi hook', async () => {
    const wastePickupHooks = { onOrderCancelled: jest.fn().mockResolvedValue(undefined) };
    const { svc } = makeService({ ...baseOrder, status: 'CONFIRMED' }, { wastePickupHooks, updateMany: jest.fn().mockResolvedValue({ count: 0 }) });
    await svc.cancel('u1', 'TUBU1');
    expect(wastePickupHooks.onOrderCancelled).not.toHaveBeenCalled();
  });

  it('hook lỗi → huỷ vẫn xong và khách vẫn nhận ORDER_CANCELLED', async () => {
    const wastePickupHooks = { onOrderCancelled: jest.fn().mockRejectedValue(new Error('hook')) };
    const { svc } = makeService({ ...baseOrder, status: 'CONFIRMED' }, { wastePickupHooks });
    await expect(svc.cancel('u1', 'TUBU1')).resolves.toBeDefined();
    expect(notifications.notify as jest.Mock).toHaveBeenCalledWith('u1', 'ORDER_CANCELLED', expect.anything());
  });
});
