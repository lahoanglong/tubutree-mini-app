import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrderReturnsService, refundNote } from './order-returns.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { OrderReversalService } from './order-reversal.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { AffiliateService } from '../affiliate/affiliate.service';
import type { NotificationsService } from '../notifications/notifications.service';

const DAY = 864e5;
const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;

const line = (id: string, quantity: number, total: number) => ({
  id,
  orderId: 'o1',
  variationId: `v-${id}`,
  productName: `SP ${id}`,
  variationName: 'Mặc định',
  unitPrice: total / quantity,
  quantity,
  total,
  flashSaleItemId: null,
  backorderedQty: 0,
});

const deliveredOrder = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  code: 'TUBU1',
  userId: 'u1',
  type: 'RETAIL',
  status: 'DELIVERED',
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  placedForCustomer: false,
  total: 300_000,
  shippingFee: 0,
  deliveredAt: new Date(Date.now() - 2 * DAY),
  updatedAt: new Date(),
  createdAt: new Date(Date.now() - 5 * DAY),
  items: [line('a', 3, 270_000), line('b', 1, 30_000)],
  ...over,
});

function makeService(
  order: Record<string, unknown> | null,
  over: {
    create?: jest.Mock;
    findFirst?: jest.Mock;
    approved?: unknown[];
    history?: { createdAt: Date } | null;
    windowDays?: number;
  } = {},
) {
  const create = over.create ?? jest.fn(async ({ data }: { data: unknown }) => ({ id: 'r1', ...(data as object), items: [] }));
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order) },
    orderStatusHistory: { findFirst: jest.fn().mockResolvedValue(over.history ?? null) },
    returnRequest: {
      findFirst: over.findFirst ?? jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue(over.approved ?? []),
      create,
    },
  } as unknown as PrismaService;
  const config = {
    get: async <T>(k: string, fb?: T): Promise<T> => (k === 'returns.window_days' ? ((over.windowDays ?? 7) as T) : (fb as T)),
  } as unknown as SystemConfigService;
  const svc = new OrderReturnsService(
    prisma,
    config,
    {} as OrderReversalService,
    {} as LoyaltyService,
    {} as AffiliateService,
    notifications,
  );
  return { svc, create, prisma };
}

describe('OrderReturnsService.request — chọn dòng/số lượng (BUYERMINI-11, MONEY-7)', () => {
  it('lưu đúng dòng + số lượng khách chọn, lý do chọn sẵn và nơi nhận Ví mặc định', async () => {
    const { svc, create } = makeService(deliveredOrder());
    await svc.request('u1', 'TUBU1', { reasonCode: 'DEFECTIVE', items: [{ orderItemId: 'a', quantity: 1 }] });
    const data = create.mock.calls[0][0].data;
    expect(data.items.create).toEqual([{ orderItemId: 'a', quantity: 1 }]);
    expect(data.reasonCode).toBe('DEFECTIVE');
    expect(data.reason).toBe('Sản phẩm lỗi, hỏng');
    expect(data.refundMethod).toBe('WALLET');
  });

  it('app bản cũ không gửi dòng → trả mọi phần còn lại (trừ phần đã duyệt trả trước đó)', async () => {
    const { svc, create } = makeService(deliveredOrder(), {
      approved: [{ refundAmount: 0, shippingRefund: 0, pointsRefunded: 0, convertedPointsRefunded: 0, pointsReversed: 0, commissionReversed: 0, receivedAt: null, items: [{ orderItemId: 'a', quantity: 2 }] }],
    });
    await svc.request('u1', 'TUBU1', { reason: 'hàng lỗi cả đơn' });
    expect(create.mock.calls[0][0].data.items.create).toEqual([
      { orderItemId: 'a', quantity: 1 },
      { orderItemId: 'b', quantity: 1 },
    ]);
  });

  it('số lượng vượt phần còn lại hoặc dòng lạ → 400, không tạo', async () => {
    const { svc, create } = makeService(deliveredOrder());
    await expect(svc.request('u1', 'TUBU1', { reasonCode: 'DEFECTIVE', items: [{ orderItemId: 'a', quantity: 4 }] })).rejects.toThrow(
      'vượt số còn lại',
    );
    await expect(svc.request('u1', 'TUBU1', { reasonCode: 'DEFECTIVE', items: [{ orderItemId: 'zz', quantity: 1 }] })).rejects.toThrow(
      'không thuộc đơn',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('không chọn lý do sẵn hoặc chọn "Lý do khác" thì phải mô tả ≥ 5 ký tự', async () => {
    const { svc } = makeService(deliveredOrder());
    await expect(svc.request('u1', 'TUBU1', { reasonCode: 'OTHER', reason: 'abc' })).rejects.toThrow('ít nhất 5 ký tự');
    await expect(svc.request('u1', 'TUBU1', {})).rejects.toThrow('ít nhất 5 ký tự');
  });

  it('chọn nhận về ngân hàng: chuẩn hoá số tài khoản, tên chủ tài khoản viết hoa', async () => {
    const { svc, create } = makeService(deliveredOrder({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' }));
    await svc.request('u1', 'TUBU1', {
      reasonCode: 'WRONG_ITEM',
      items: [{ orderItemId: 'b', quantity: 1 }],
      refundMethod: 'BANK',
      bankName: 'Techcombank',
      accountNumber: '1903 1234 5678',
      accountName: 'Nguyen Van A',
    });
    expect(create.mock.calls[0][0].data).toMatchObject({
      refundMethod: 'BANK',
      bankName: 'Techcombank',
      bankAccountNo: '190312345678',
      bankAccountName: 'NGUYEN VAN A',
    });
  });

  it('đơn trả bằng Ví chọn ngân hàng → 400 (Ví hoàn về Ví)', async () => {
    const { svc } = makeService(deliveredOrder({ paymentMethod: 'WALLET', paymentStatus: 'PAID' }));
    await expect(
      svc.request('u1', 'TUBU1', { reasonCode: 'DEFECTIVE', refundMethod: 'BANK', bankName: 'VCB', accountNumber: '123456789', accountName: 'A B' }),
    ).rejects.toThrow('Ví Tubu');
  });

  it('đơn đại lý chỉ trả cả đơn', async () => {
    const { svc } = makeService(deliveredOrder({ type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' }));
    await expect(svc.request('u1', 'TUBU1', { reasonCode: 'DEFECTIVE', items: [{ orderItemId: 'b', quantity: 1 }] })).rejects.toThrow(
      'Đơn đại lý chỉ trả được cả đơn',
    );
  });

  it('race: 2 request song song — create() đụng unique index partial (orderId, REQUESTED) → 400, không tạo 2 dòng', async () => {
    const create = jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
    const { svc } = makeService(deliveredOrder(), { create });
    await expect(svc.request('u1', 'TUBU1', { reason: 'lỗi sản phẩm' })).rejects.toThrow('Đơn đang có yêu cầu đổi/trả chờ xử lý.');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('OrderReturnsService.request — hạn đổi/trả tính từ mốc giao THẬT (deliveredAt), không phải updatedAt', () => {
  it('giao 10 ngày trước, webhook vừa ghi đơn (updatedAt = hôm nay) → QUÁ HẠN 7 ngày', async () => {
    const { svc, create } = makeService(deliveredOrder({ deliveredAt: new Date(Date.now() - 10 * DAY) }));
    await expect(svc.request('u1', 'TUBU1', { reason: 'lỗi sản phẩm' })).rejects.toThrow('Quá hạn đổi/trả');
    expect(create).not.toHaveBeenCalled();
  });

  it('đơn cũ chưa có deliveredAt → lấy lần lật DELIVERED trong order_status_history', async () => {
    const { svc, create } = makeService(deliveredOrder({ deliveredAt: null }), { history: { createdAt: new Date(Date.now() - 9 * DAY) } });
    await expect(svc.request('u1', 'TUBU1', { reason: 'lỗi sản phẩm' })).rejects.toThrow('Quá hạn đổi/trả');
    expect(create).not.toHaveBeenCalled();
  });

  it('đơn chưa giao → 400; đơn của người khác → 404', async () => {
    await expect(makeService(deliveredOrder({ status: 'SHIPPING' })).svc.request('u1', 'TUBU1', { reason: 'lỗi sản phẩm' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(makeService(deliveredOrder()).svc.request('u2', 'TUBU1', { reason: 'lỗi sản phẩm' })).rejects.toThrow('Không tìm thấy');
  });
});

describe('OrderReturnsService.review — từ chối', () => {
  it('bắt buộc ghi lý do từ chối để báo khách (ADMINOPS-6)', async () => {
    const prisma = {
      returnRequest: { findUnique: jest.fn().mockResolvedValue({ id: 'r1', orderId: 'o1', userId: 'u1', items: [] }), updateMany: jest.fn() },
    } as unknown as PrismaService;
    const svc = new OrderReturnsService(prisma, {} as never, {} as never, {} as never, {} as never, notifications);
    await expect(svc.review('a1', 'r1', { approve: false })).rejects.toThrow('lý do từ chối');
    expect((prisma.returnRequest.updateMany as jest.Mock)).not.toHaveBeenCalled();
  });
});

describe('OrderReturnsService.listForAdmin — kèm đơn, khách, tên dòng trả', () => {
  it('ghép order + user + tên sản phẩm của từng dòng trả, chỉ 2 truy vấn phụ cho cả trang', async () => {
    const orderFindMany = jest.fn().mockResolvedValue([
      { id: 'o1', code: 'TUBU1', total: 250_000, items: [{ id: 'a', productName: 'Nước giặt', variationName: '1L', quantity: 3 }] },
    ]);
    const userFindMany = jest.fn().mockResolvedValue([{ id: 'u1', fullName: 'Lã Hoàng Long', phone: '0899625240' }]);
    const prisma = {
      returnRequest: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r1', orderId: 'o1', userId: 'u1', reasonCode: 'DEFECTIVE', items: [{ orderItemId: 'a', quantity: 1 }] },
          { id: 'r2', orderId: 'o1', userId: 'u1', reasonCode: null, items: [] },
        ]),
        count: jest.fn().mockResolvedValue(2),
      },
      order: { findMany: orderFindMany },
      user: { findMany: userFindMany },
      $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
    } as unknown as PrismaService;
    const svc = new OrderReturnsService(prisma, {} as never, {} as never, {} as never, {} as never, notifications);
    const res = (await svc.listForAdmin('REQUESTED', 1, 20, 'asc')) as {
      data: { order: { code: string } | null; user: { phone: string } | null; reasonLabel: string | null; items: { productName: string | null; orderedQuantity: number | null }[] }[];
      meta: { total: number };
    };
    expect(res.meta.total).toBe(2);
    expect(res.data[0]).toMatchObject({ order: { code: 'TUBU1' }, user: { phone: '0899625240' }, reasonLabel: 'Sản phẩm lỗi, hỏng' });
    expect(res.data[0]!.items[0]).toMatchObject({ productName: 'Nước giặt', orderedQuantity: 3 });
    expect(res.data[1]!.reasonLabel).toBeNull();
    expect(orderFindMany).toHaveBeenCalledTimes(1);
    expect(orderFindMany.mock.calls[0][0].where.id.in).toEqual(['o1']);
    expect((prisma.returnRequest.findMany as jest.Mock).mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
  });
});

describe('OrderReturnsService.listForAdmin — khoản hoàn thật của từng yêu cầu (R2-LIFECYCLE-6)', () => {
  it('kèm khoản RETURN theo refKey = id yêu cầu (khách có thể đã đổi sang Ví, admin có thể chưa chuyển)', async () => {
    const refundFindMany = jest.fn().mockResolvedValue([
      { refKey: 'r1', method: 'WALLET', status: 'COMPLETED', amount: 19_500, bankName: 'MB', bankAccountNo: '123456', completedAt: null },
    ]);
    const prisma = {
      returnRequest: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r1', orderId: 'o1', userId: 'u1', reasonCode: null, items: [] },
          { id: 'r2', orderId: 'o1', userId: 'u1', reasonCode: null, items: [] },
        ]),
        count: jest.fn().mockResolvedValue(2),
      },
      order: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      orderCustomerRefund: { findMany: refundFindMany },
      $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
    } as unknown as PrismaService;
    const svc = new OrderReturnsService(prisma, {} as never, {} as never, {} as never, {} as never, notifications);
    const res = (await svc.listForAdmin(undefined, 1, 20)) as { data: { refund: { method: string } | null }[] };
    expect(refundFindMany.mock.calls[0][0].where).toEqual({ kind: 'RETURN', refKey: { in: ['r1', 'r2'] } });
    expect(res.data[0]!.refund).toMatchObject({ method: 'WALLET', status: 'COMPLETED' });
    expect(res.data[1]!.refund).toBeNull();
  });
});

describe('refundNote — khách được báo số tiền và nơi nhận (D2)', () => {
  it('Ví, ngân hàng (che số tài khoản), điểm, không có tiền', () => {
    expect(refundNote({ amount: 114_000, to: 'WALLET' }, null)).toBe(' Đã hoàn 114.000đ vào Ví Tubu.');
    expect(refundNote({ amount: 60_000, to: 'BANK' }, { bankName: 'Techcombank', bankAccountNo: '190312345678' })).toBe(
      ' Tubu sẽ chuyển khoản 60.000đ về Techcombank ••• 5678 trong 1-3 ngày làm việc, miễn phí.',
    );
    expect(refundNote(null, null, 18)).toBe(' Đã hoàn 18 Điểm Xanh.');
    expect(refundNote(null, null)).toBe('');
  });
});

describe('OrderReturnsService — hàng trả của đơn gian hàng tự giao về gian hàng, không về kho Tubu (D3 × D4)', () => {
  const approved = { id: 'r1', orderId: 'o1', userId: 'u1', status: 'APPROVED', receivedAt: null, items: [{ orderItemId: 'a', quantity: 1 }] };
  function receiveHarness(order: Record<string, unknown>) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const restockReturnedItems = jest.fn().mockResolvedValue(1);
    const tx = {
      returnRequest: { updateMany, findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: { findUniqueOrThrow: jest.fn().mockResolvedValue(deliveredOrder()) },
    };
    const prisma = {
      returnRequest: {
        findUnique: jest.fn().mockResolvedValue(approved),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...approved, receivedAt: new Date() }),
      },
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaService;
    const svc = new OrderReturnsService(
      prisma,
      {} as never,
      { restockReturnedItems } as unknown as OrderReversalService,
      {} as never,
      {} as never,
      notifications,
    );
    jest.spyOn(svc as unknown as { withContext: (r: unknown) => unknown }, 'withContext').mockImplementation(async (r) => r);
    return { svc, updateMany, restockReturnedItems };
  }
  const merchantOrder = {
    code: 'TUBU1',
    fulfiller: 'MERCHANT',
    fulfillerStorefront: { ownerUserId: 'shop-owner', type: 'MERCHANT', title: 'Vườn Bà Năm' },
  };

  it('admin bấm "đã nhận hàng" cho đơn gian hàng → 400 chỉ đường về Cổng người bán, không lật, không cộng kho Tubu', async () => {
    const h = receiveHarness(merchantOrder);
    await expect(h.svc.markReceived('admin1', 'r1')).rejects.toThrow('gian hàng Vườn Bà Năm');
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(h.restockReturnedItems).not.toHaveBeenCalled();
  });

  it('chủ gian hàng xác nhận nhận hàng → lật receivedBy = chủ gian hàng và cộng kho sản phẩm của gian hàng', async () => {
    const h = receiveHarness(merchantOrder);
    await h.svc.markReceivedByMerchant('shop-owner', 'r1');
    expect(h.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1', status: 'APPROVED', receivedAt: null }, data: expect.objectContaining({ receivedBy: 'shop-owner' }) }),
    );
    expect(h.restockReturnedItems).toHaveBeenCalledTimes(1);
  });

  it('gian hàng khác, hoặc đơn kho Tubu → 404, không lật', async () => {
    const other = receiveHarness(merchantOrder);
    await expect(other.svc.markReceivedByMerchant('stranger', 'r1')).rejects.toThrow('gian hàng bạn');
    expect(other.updateMany).not.toHaveBeenCalled();
    const tubu = receiveHarness({ code: 'TUBU1', fulfiller: 'TUBU', fulfillerStorefront: null });
    await expect(tubu.svc.markReceivedByMerchant('shop-owner', 'r1')).rejects.toThrow('gian hàng bạn');
    expect(tubu.updateMany).not.toHaveBeenCalled();
  });

  it('đơn kho Tubu: admin vẫn nhận hàng về kho như cũ', async () => {
    const h = receiveHarness({ code: 'TUBU1', fulfiller: 'TUBU', fulfillerStorefront: null });
    await h.svc.markReceived('admin1', 'r1');
    expect(h.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ receivedBy: 'admin1' }) }));
    expect(h.restockReturnedItems).toHaveBeenCalledTimes(1);
  });

  it('listForMerchant: chỉ đơn của gian hàng mình, không lộ tài khoản ngân hàng nhận hoàn của khách', async () => {
    const prisma = {
      storefront: { findFirst: jest.fn().mockResolvedValue({ id: 'sf1' }) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'r1' }]),
      returnRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'r1',
            orderId: 'o1',
            status: 'APPROVED',
            createdAt: new Date(),
            reviewedAt: new Date(),
            receivedAt: null,
            reasonCode: 'DEFECTIVE',
            reason: 'Hỏng',
            fullReturn: false,
            shopFault: true,
            bankName: 'VCB',
            bankAccountNo: '0123456789',
            bankAccountName: 'NGUYEN VAN A',
            items: [{ orderItemId: 'a', quantity: 2 }],
          },
        ]),
      },
      order: { findMany: jest.fn().mockResolvedValue([{ id: 'o1', code: 'TUBU1', items: [{ id: 'a', productName: 'Bưởi', variationName: '1kg', quantity: 3 }] }]) },
    } as unknown as PrismaService;
    const svc = new OrderReturnsService(prisma, {} as never, {} as never, {} as never, {} as never, notifications);
    const rows = await svc.listForMerchant('shop-owner');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orderCode: 'TUBU1', reasonLabel: 'Sản phẩm lỗi, hỏng', lines: [{ productName: 'Bưởi', quantity: 2 }] });
    expect(JSON.stringify(rows)).not.toContain('0123456789');
    expect(JSON.stringify(rows)).not.toContain('NGUYEN VAN A');
    expect((prisma.$queryRaw as jest.Mock).mock.calls[0].slice(1)).toContain('sf1');
  });

  it('listForMerchant: tài khoản không có gian hàng tự giao → 403', async () => {
    const prisma = { storefront: { findFirst: jest.fn().mockResolvedValue(null) } } as unknown as PrismaService;
    const svc = new OrderReturnsService(prisma, {} as never, {} as never, {} as never, {} as never, notifications);
    await expect(svc.listForMerchant('u1')).rejects.toThrow('gian hàng đối tác');
  });
});
