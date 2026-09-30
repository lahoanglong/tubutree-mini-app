import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

const loyalty = { reverseOrderPoints: jest.fn().mockResolvedValue(undefined) } as unknown as LoyaltyService;
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
  /** SELECT … FOR UPDATE khoá dòng đơn trong tx. */
  const lockRow = jest.fn().mockResolvedValue([{ id: row.id }]);
  /** Đọc lại đơn TRONG tx (sau khoá) — trả dòng DB hiện tại, không phải ảnh chụp. */
  const txFindUnique = jest.fn(async () => ({ ...row }));
  const historyCreate = jest.fn().mockResolvedValue({});
  // $transaction giờ là CALLBACK form (flip-status + hoàn ví/xu + restock ATOMIC). Forward tx ops vào cùng mock.
  const $transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      $queryRaw: lockRow,
      order: { updateMany, findUnique: txFindUnique },
      orderStatusHistory: { create: historyCreate },
      user: { update: userUpdate },
      $executeRaw: executeRaw,
      coinTransaction: { create: coinCreate },
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
    svc: new OrdersService(prisma, loyalty, cart, notifications, config, affiliate, reversal, spies.gomdonQueue as never),
    updateMany,
    userUpdate,
    executeRaw,
    coinCreate,
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

  it('đơn dùng coupon → hoàn coupon (release) khi hủy, không bị đốt vĩnh viễn', async () => {
    const { svc } = makeService({ ...baseOrder, status: 'CONFIRMED', couponCode: 'BDAY50K' });
    await svc.cancel('u1', 'TUBU1');
    expect((coupons.release as jest.Mock)).toHaveBeenCalledWith('BDAY50K', 'o1', expect.anything());
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

  it('hoàn XU (coinsBalance + CoinTransaction) khi đơn trả bằng XU + PAID — KHÔNG hoàn ví', async () => {
    const { svc, userUpdate, coinCreate } = makeService({
      ...baseOrder,
      paymentMethod: 'XU',
      paymentStatus: 'PAID',
    });
    await svc.cancel('u1', 'TUBU1');
    // Hoàn vào coinsBalance, KHÔNG phải walletBalance (xu không rút được → tránh leak giá trị).
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { coinsBalance: { increment: 300000 } } }),
    );
    expect(userUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { walletBalance: { increment: 300000 } } }),
    );
    // Ghi sổ cái xu (+total) giữ bất biến coinsBalance == Σdelta.
    expect(coinCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'u1', delta: 300000, reason: 'ORDER_REFUND:TUBU1', refType: 'ORDER' }),
      }),
    );
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
    // hoàn tiền nào (khác bản cũ: luôn thử guard PAID rồi thua). Chỉ có 1 lệnh updateMany — flip status.
    expect(updateMany).toHaveBeenCalledTimes(1);
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

describe('OrdersService.requestReturn', () => {
  const deliveredOrder = { ...baseOrder, status: 'DELIVERED', updatedAt: new Date(), createdAt: new Date() };

  function makeReturnService(over: { create?: jest.Mock; findFirst?: jest.Mock } = {}) {
    const create = over.create ?? jest.fn().mockResolvedValue({ id: 'r1' });
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(deliveredOrder) },
      returnRequest: { findFirst: over.findFirst ?? jest.fn().mockResolvedValue(null), create },
    } as unknown as PrismaService;
    return { svc: new OrdersService(prisma, loyalty, cart, notifications, config, affiliate, reversal), create };
  }

  it('race: 2 request đổi/trả song song — pre-check đọc "chưa có" nhưng create() đụng unique index partial (orderId, status=REQUESTED) → BadRequest, KHÔNG tạo 2 dòng', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
    const { svc } = makeReturnService({ create });
    await expect(svc.requestReturn('u1', 'TUBU1', { reason: 'lỗi' })).rejects.toThrow(
      'Đơn đang có yêu cầu đổi/trả chờ xử lý.',
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('gửi hợp lệ (chưa có yêu cầu chờ xử lý) → tạo return request', async () => {
    const { svc, create } = makeReturnService();
    const r = await svc.requestReturn('u1', 'TUBU1', { reason: 'lỗi sản phẩm' });
    expect(r).toEqual({ id: 'r1' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('OrdersService.cancel — đơn thu gom tái chế (Gomdon)', () => {
  beforeEach(() => jest.clearAllMocks());
  const queue = () => ({ getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue({}) });

  it('khách huỷ đơn thu gom đã có vận đơn → enqueue job huỷ vận đơn Gomdon', async () => {
    const q = queue();
    const { svc } = makeService({ ...baseOrder, hasRecyclingPickup: true, gomdonOrderId: '77', gomdonStatus: '1' }, { gomdonQueue: q });
    await svc.cancel('u1', 'TUBU1');
    expect(q.add).toHaveBeenCalledWith('cancel', { orderId: 'o1' }, { jobId: 'cancel-o1' });
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

describe('OrdersService.requestReturn — hạn đổi/trả tính từ mốc giao THẬT (deliveredAt), không phải updatedAt', () => {
  const DAY = 864e5;
  function svcFor(order: Record<string, unknown>, history: { createdAt: Date } | null = null, windowDays = 7) {
    const create = jest.fn().mockResolvedValue({ id: 'r1' });
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue({ ...baseOrder, status: 'DELIVERED', createdAt: new Date(Date.now() - 30 * DAY), ...order }) },
      orderStatusHistory: { findFirst: jest.fn().mockResolvedValue(history) },
      returnRequest: { findFirst: jest.fn().mockResolvedValue(null), create },
    } as unknown as PrismaService;
    const cfg = {
      get: async <T>(k: string, fb?: T): Promise<T> => (k === 'returns.window_days' ? (windowDays as T) : (fb as T)),
    } as unknown as SystemConfigService;
    return { svc: new OrdersService(prisma, loyalty, cart, notifications, cfg, affiliate, reversal), create };
  }

  it('giao 10 ngày trước, webhook vận chuyển vừa ghi đơn (updatedAt = hôm nay) → QUÁ HẠN 7 ngày', async () => {
    const { svc, create } = svcFor({ deliveredAt: new Date(Date.now() - 10 * DAY), updatedAt: new Date() });
    await expect(svc.requestReturn('u1', 'TUBU1', { reason: 'lỗi' })).rejects.toThrow('Quá hạn đổi/trả');
    expect(create).not.toHaveBeenCalled();
  });

  it('giao 2 ngày trước → còn hạn, tạo yêu cầu', async () => {
    const { svc, create } = svcFor({ deliveredAt: new Date(Date.now() - 2 * DAY), updatedAt: new Date() });
    await svc.requestReturn('u1', 'TUBU1', { reason: 'lỗi' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('đơn cũ chưa có deliveredAt → lấy lần lật DELIVERED trong order_status_history', async () => {
    const { svc, create } = svcFor({ deliveredAt: null, updatedAt: new Date() }, { createdAt: new Date(Date.now() - 9 * DAY) });
    await expect(svc.requestReturn('u1', 'TUBU1', { reason: 'lỗi' })).rejects.toThrow('Quá hạn đổi/trả');
    expect(create).not.toHaveBeenCalled();
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
});

describe('OrdersService.repurchase v2 — mỗi dòng xử lý độc lập (A2-05)', () => {
  const CART = { items: [{ id: 'ci1' }], couponCode: null, subtotal: 150000, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 3 };
  const variation = (id: string, stock: number, over: { isActive?: boolean; productActive?: boolean; approval?: string } = {}) => ({
    id, stock, isActive: over.isActive ?? true,
    product: { isActive: over.productActive ?? true, approvalStatus: over.approval ?? 'APPROVED' },
  });

  function makeRepurchaseService(opts: {
    items: ReturnType<typeof line>[];
    variations: ReturnType<typeof variation>[];
    inCart?: { variationId: string; quantity: number }[];
    addItem?: jest.Mock;
  }) {
    const addItem = opts.addItem ?? jest.fn().mockResolvedValue(CART);
    const getCart = jest.fn().mockResolvedValue(CART);
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue({ ...baseOrder, status: 'DELIVERED', items: opts.items }) },
      variation: { findMany: jest.fn().mockResolvedValue(opts.variations) },
      cart: { findUnique: jest.fn().mockResolvedValue(opts.inCart ? { items: opts.inCart } : null) },
    } as unknown as PrismaService;
    const cartSvc = { addItem, getCart } as unknown as CartService;
    return { svc: new OrdersService(prisma, loyalty, cartSvc, notifications, config, affiliate, reversal), addItem, getCart };
  }

  it('không body (client cũ): thêm mọi dòng, addSource=repurchase; response VẪN là giỏ ở top-level + cart + results', async () => {
    const { svc, addItem } = makeRepurchaseService({
      items: [line('i1', 'v1', 2), line('i2', 'v2', 1)],
      variations: [variation('v1', 10), variation('v2', 10)],
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(addItem).toHaveBeenNthCalledWith(1, 'u1', { variationId: 'v1', quantity: 2, addSource: 'repurchase' });
    expect(addItem).toHaveBeenNthCalledWith(2, 'u1', { variationId: 'v2', quantity: 1, addSource: 'repurchase' });
    expect(res).toMatchObject({ items: CART.items, subtotal: 150000, itemCount: 3 });
    expect(res.cart).toEqual(CART);
    expect(res.results).toEqual([
      { orderItemId: 'i1', status: 'added', addedQuantity: 2 },
      { orderItemId: 'i2', status: 'added', addedQuantity: 1 },
    ]);
  });

  it('items: chỉ các dòng được chọn, số lượng theo client', async () => {
    const { svc, addItem } = makeRepurchaseService({
      items: [line('i1', 'v1', 2), line('i2', 'v2', 1)],
      variations: [variation('v2', 10)],
    });
    const res = await svc.repurchase('u1', 'TUBU1', { items: [{ orderItemId: 'i2', quantity: 4 }] });
    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem).toHaveBeenCalledWith('u1', { variationId: 'v2', quantity: 4, addSource: 'repurchase' });
    expect(res.results).toEqual([{ orderItemId: 'i2', status: 'added', addedQuantity: 4 }]);
  });

  it('orderItemId không thuộc đơn → 400 TRƯỚC mọi lần ghi', async () => {
    const { svc, addItem } = makeRepurchaseService({ items: [line('i1', 'v1', 1)], variations: [variation('v1', 10)] });
    await expect(svc.repurchase('u1', 'TUBU1', { items: [{ orderItemId: 'khac', quantity: 1 }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(addItem).not.toHaveBeenCalled();
  });

  it.each([
    ['variation tắt', variation('v1', 10, { isActive: false }), 'INACTIVE'],
    ['sản phẩm tắt', variation('v1', 10, { productActive: false }), 'INACTIVE'],
    ['sản phẩm chưa duyệt (trước đây thiếu kiểm này)', variation('v1', 10, { approval: 'REJECTED' }), 'NOT_APPROVED'],
    ['hết hàng', variation('v1', 0), 'OUT_OF_STOCK'],
  ])('%s → skipped, không gọi addItem', async (_l, v, reason) => {
    const { svc, addItem } = makeRepurchaseService({ items: [line('i1', 'v1', 1)], variations: [v] });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(addItem).not.toHaveBeenCalled();
    expect(res.results).toEqual([{ orderItemId: 'i1', status: 'skipped', reason, addedQuantity: 0 }]);
  });

  it('variation đã bị xoá → skipped INACTIVE', async () => {
    const { svc } = makeRepurchaseService({ items: [line('i1', 'gone', 1)], variations: [] });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(res.results[0]).toMatchObject({ status: 'skipped', reason: 'INACTIVE' });
  });

  it('giỏ đã giữ hết tồn → EXCEEDS_STOCK; dòng sau vẫn được thêm (trước đây addItem ném giữa vòng lặp)', async () => {
    const { svc, addItem } = makeRepurchaseService({
      items: [line('i1', 'v1', 1), line('i2', 'v2', 1)],
      variations: [variation('v1', 3), variation('v2', 5)],
      inCart: [{ variationId: 'v1', quantity: 3 }],
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(res.results).toEqual([
      { orderItemId: 'i1', status: 'skipped', reason: 'EXCEEDS_STOCK', addedQuantity: 0 },
      { orderItemId: 'i2', status: 'added', addedQuantity: 1 },
    ]);
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it('muốn 5, còn chỗ 2 → partial, kẹp đúng 2', async () => {
    const { svc, addItem } = makeRepurchaseService({
      items: [line('i1', 'v1', 5)],
      variations: [variation('v1', 3)],
      inCart: [{ variationId: 'v1', quantity: 1 }],
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(addItem).toHaveBeenCalledWith('u1', { variationId: 'v1', quantity: 2, addSource: 'repurchase' });
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

  it('addItem ném lỗi nghiệp vụ cho 1 dòng (race tồn kho / SP vừa bị ẩn) → dòng đó skipped, dòng khác vẫn chạy', async () => {
    const addItem = jest
      .fn()
      .mockRejectedValueOnce(new BadRequestException('Chỉ còn 0 sản phẩm trong kho.'))
      .mockRejectedValueOnce(new NotFoundException('Sản phẩm không khả dụng.'))
      .mockResolvedValue(CART);
    const { svc } = makeRepurchaseService({
      items: [line('i1', 'v1', 1), line('i2', 'v2', 1), line('i3', 'v3', 1)],
      variations: [variation('v1', 5), variation('v2', 5), variation('v3', 5)],
      addItem,
    });
    const res = await svc.repurchase('u1', 'TUBU1');
    expect(res.results.map((r) => [r.orderItemId, r.status, r.reason])).toEqual([
      ['i1', 'skipped', 'EXCEEDS_STOCK'],
      ['i2', 'skipped', 'INACTIVE'],
      ['i3', 'added', undefined],
    ]);
  });

  it('lỗi hạ tầng (không phải lỗi nghiệp vụ) → ném ra, không nuốt', async () => {
    const addItem = jest.fn().mockRejectedValue(new Error('connection reset'));
    const { svc } = makeRepurchaseService({ items: [line('i1', 'v1', 1)], variations: [variation('v1', 5)], addItem });
    await expect(svc.repurchase('u1', 'TUBU1')).rejects.toThrow('connection reset');
  });

  it('addSource=reorder_notification được chuyển tới add_to_cart', async () => {
    const { svc, addItem } = makeRepurchaseService({ items: [line('i1', 'v1', 1)], variations: [variation('v1', 5)] });
    await svc.repurchase('u1', 'TUBU1', { addSource: 'reorder_notification' });
    expect(addItem).toHaveBeenCalledWith('u1', { variationId: 'v1', quantity: 1, addSource: 'reorder_notification' });
  });
});
