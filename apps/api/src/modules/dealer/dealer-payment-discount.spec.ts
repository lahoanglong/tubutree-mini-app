import { BadRequestException } from '@nestjs/common';
import { DealerService } from './dealer.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * Chuẩn kế toán của Anh Thư (W154):
 *  - Chiết khấu thương mại (bậc đại lý): đơn giá dòng hàng giữ giá lẻ, phần giảm là một dòng giảm trên đơn (`discount`).
 *  - Chiết khấu thanh toán: hoá đơn vẫn đủ 100%; lúc thu tiền khách trả tiền thực thu, phần chênh được xoá nợ và ghi Chi phí
 *    tài chính TK 635 bằng dòng sổ riêng refType PAYMENT_DISCOUNT.
 */

function makeConfig(values: Record<string, unknown> = {}): SystemConfigService {
  return { get: async <T>(key: string, fb?: T): Promise<T> => (key in values ? values[key] : fb) as T } as unknown as SystemConfigService;
}

describe('DealerService.placeOrder — chiết khấu thương mại giữ nguyên đơn giá hàng', () => {
  function build(opts: { retailPrice: number; tierPct: number; dealerPrices?: Record<string, number> | null }) {
    const tier = { id: 't1', creditLimit: 100_000_000, paymentTerms: 'NET 15', discountRules: { default: opts.tierPct } };
    const orderCreate = jest.fn().mockResolvedValue({ id: 'o1' });
    const ledgerCreate = jest.fn().mockResolvedValue({});
    const base: Record<string, unknown> = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'd1', role: 'DEALER', metadata: { dealerTierId: 't1' } }) },
      dealerTier: { findUnique: jest.fn().mockResolvedValue(tier) },
      variation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'v1',
            isActive: true,
            retailPrice: opts.retailPrice,
            dealerPrices: opts.dealerPrices ?? null,
            name: '500ml',
            product: { name: 'SP', slug: 'sp', isActive: true, approvalStatus: 'APPROVED' },
          },
        ]),
      },
      order: { create: orderCreate, findUnique: jest.fn().mockResolvedValue(null), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'o1', items: [] }) },
      dealerCreditLedger: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { delta: 0 } }),
        findMany: jest.fn().mockResolvedValue([]),
        create: ledgerCreate,
      },
      address: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'addr1', recipient: 'Đại lý', phone: '0911111111', street: '5 Trần Phú', ward: 'P', district: '', province: 'Đà Nẵng',
          provinceCode: '84_VN48', districtCode: '', wardCode: '84_VN4820',
        }),
      },
      dealerApplication: { findFirst: jest.fn().mockResolvedValue(null) },
      storefront: { findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn(async (_s: unknown, ...vals: unknown[]) => [{ reserved: (vals.find((v) => typeof v === 'number') as number) ?? 0 }]),
    };
    base.$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(base));
    return { prisma: base as unknown as PrismaService, orderCreate, ledgerCreate };
  }

  const place = (prisma: PrismaService, method: 'PREPAID' | 'CREDIT' = 'PREPAID', qty = 1) =>
    new DealerService(prisma, makeConfig()).placeOrder('d1', { items: [{ variationId: 'v1', quantity: qty }], paymentMethod: method } as never);

  type Created = {
    subtotal: number;
    discount: number;
    shippingFee: number;
    total: number;
    tierDiscount?: number;
    items: { create: { unitPrice: number; quantity: number; total: number; paidTotal: number }[] };
  };
  const created = (orderCreate: jest.Mock) => orderCreate.mock.calls[0]![0].data as Created;

  it('bậc 20%: đơn giá dòng vẫn là giá lẻ, tiền hàng gốc ở subtotal, chiết khấu thương mại ở discount, phải trả = tiền hàng gốc − chiết khấu + phí giao', async () => {
    const { prisma, orderCreate } = build({ retailPrice: 5_000_000, tierPct: 0.2 });
    await place(prisma);
    const d = created(orderCreate);
    expect(d.subtotal).toBe(5_000_000);
    expect(d.discount).toBe(1_000_000);
    expect(d.items.create[0]).toMatchObject({ unitPrice: 5_000_000, quantity: 1, total: 5_000_000, paidTotal: 4_000_000 });
    expect(d.shippingFee).toBe(19_000);
    expect(d.total).toBe(5_000_000 - 1_000_000 + 19_000);
  });

  it('không điền tierDiscount (nhãn "Ưu đãi hạng thành viên" của khách lẻ): chiết khấu bậc đại lý chỉ nằm ở discount', async () => {
    const { prisma, orderCreate } = build({ retailPrice: 5_000_000, tierPct: 0.2 });
    await place(prisma);
    expect(created(orderCreate).tierDiscount).toBeUndefined();
  });

  it('tổng phải trả bằng đúng số trước khi tách: giá lẻ × (1 − bậc) × số lượng — không đổi tiền đại lý phải trả', async () => {
    const { prisma, orderCreate } = build({ retailPrice: 1_000_000, tierPct: 0.2 });
    await place(prisma, 'PREPAID', 5);
    const d = created(orderCreate);
    expect(d.subtotal - d.discount).toBe(Math.round(1_000_000 * 0.8) * 5);
    expect(d.items.create[0]!.paidTotal).toBe(Math.round(1_000_000 * 0.8) * 5);
  });

  it('hoá đơn khớp nhau: tổng dòng hàng = subtotal, trừ dòng CK thương mại ra tiền hàng phải trả, paidTotal các dòng cộng đúng tiền hàng của đơn', async () => {
    const { prisma, orderCreate } = build({ retailPrice: 1_000_000, tierPct: 0.2 });
    await place(prisma, 'PREPAID', 5);
    const d = created(orderCreate);
    const lines = d.items.create;
    expect(lines.reduce((s, l) => s + l.total, 0)).toBe(d.subtotal);
    expect(lines.reduce((s, l) => s + l.total, 0) - d.discount).toBe(d.total - d.shippingFee);
    expect(lines.reduce((s, l) => s + l.paidTotal, 0)).toBe(d.total - d.shippingFee);
    for (const l of lines) expect(l.total).toBe(l.unitPrice * l.quantity);
  });

  it('ngưỡng tối thiểu tính trên tiền hàng SAU chiết khấu: gốc 3,5tr − 20% = 2,8tr dưới mức tối thiểu 3tr → 400', async () => {
    const { prisma, orderCreate } = build({ retailPrice: 3_500_000, tierPct: 0.2 });
    await expect(place(prisma)).rejects.toMatchObject({ status: 400, response: { code: 'DEALER_ORDER_BELOW_MIN' } });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('gốc 6,5tr − 20% = 5,2tr đủ freeship 5tr → không thu phí giao', async () => {
    const { prisma, orderCreate } = build({ retailPrice: 6_500_000, tierPct: 0.2 });
    await place(prisma);
    const d = created(orderCreate);
    expect(d.shippingFee).toBe(0);
    expect(d.total).toBe(5_200_000);
  });

  it('gốc 5,5tr − 20% = 4,4tr dưới freeship 5tr dù tiền hàng gốc vượt 5tr → vẫn thu phí giao', async () => {
    const { prisma, orderCreate } = build({ retailPrice: 5_500_000, tierPct: 0.2 });
    await place(prisma);
    expect(created(orderCreate).shippingFee).toBe(19_000);
  });

  it('giá riêng theo bậc thấp hơn giá lẻ cũng là chiết khấu thương mại: giữ đơn giá lẻ, phần chênh vào discount', async () => {
    const { prisma, orderCreate } = build({ retailPrice: 5_000_000, tierPct: 0.2, dealerPrices: { t1: 3_500_000 } });
    await place(prisma);
    const d = created(orderCreate);
    expect(d.items.create[0]).toMatchObject({ unitPrice: 5_000_000, total: 5_000_000, paidTotal: 3_500_000 });
    expect(d.discount).toBe(1_500_000);
  });

  it('giá riêng cao hơn giá lẻ thì không có gì để giảm: giữ giá đó, discount 0, không ghi dòng giảm âm', async () => {
    const { prisma, orderCreate } = build({ retailPrice: 4_000_000, tierPct: 0.2, dealerPrices: { t1: 4_200_000 } });
    await place(prisma);
    const d = created(orderCreate);
    expect(d.discount).toBe(0);
    expect(d.items.create[0]).toMatchObject({ unitPrice: 4_200_000, total: 4_200_000, paidTotal: 4_200_000 });
    expect(d.subtotal).toBe(4_200_000);
  });

  it('trần một đơn tính trên tiền hàng SAU chiết khấu: gốc 2,1 tỷ − 20% = 1,68 tỷ vẫn nhận', async () => {
    const { prisma, orderCreate } = build({ retailPrice: 1_000_000, tierPct: 0.2 });
    await place(prisma, 'PREPAID', 2_100);
    const d = created(orderCreate);
    expect(d.subtotal).toBe(2_100_000_000);
    expect(d.total - d.shippingFee).toBe(1_680_000_000);
  });

  it('tiền hàng sau chiết khấu vượt trần 2 tỷ → 400 nêu đúng số đại lý thấy', async () => {
    const { prisma, orderCreate } = build({ retailPrice: 1_000_000, tierPct: 0.2 });
    await expect(place(prisma, 'PREPAID', 2_600)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('2.080.000.000đ') });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('tiền hàng theo giá gốc vượt số nguyên 32 bit của cột subtotal dù sau chiết khấu còn dưới trần → 400, không ghi đơn', async () => {
    const { prisma, orderCreate } = build({ retailPrice: 1_000_000, tierPct: 0.2 });
    await expect(place(prisma, 'PREPAID', 2_200)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('giới hạn của hệ thống') });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('bậc 0%: không có chiết khấu thương mại, discount 0, mọi con số như trước khi tách', async () => {
    const { prisma, orderCreate } = build({ retailPrice: 5_000_000, tierPct: 0 });
    await place(prisma);
    const d = created(orderCreate);
    expect(d.discount).toBe(0);
    expect(d.subtotal).toBe(5_000_000);
    expect(d.total).toBe(5_000_000);
  });

  it('đơn ghi công nợ ghi nợ đúng tổng phải trả (sau chiết khấu thương mại), không ghi nợ tiền hàng gốc', async () => {
    const { prisma, ledgerCreate } = build({ retailPrice: 5_000_000, tierPct: 0.2 });
    await place(prisma, 'CREDIT');
    expect(ledgerCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ delta: 4_019_000, refType: 'ORDER' }) });
  });
});

describe('DealerService.adminRecordCreditPayment — chiết khấu thanh toán (TK 635)', () => {
  type LedgerData = { userId: string; delta: number; refType: string; refId?: string; note?: string };

  function build(opts: { debt?: number; existing?: { payment?: { delta: number }; discount?: { delta: number } } } = {}) {
    const debt = opts.debt ?? 100_000;
    const ledgerCreate = jest.fn().mockResolvedValue({});
    const notify = jest.fn().mockResolvedValue(undefined);
    const findFirst = jest.fn(async ({ where }: { where: { refType?: string } }) => {
      if (where.refType === 'PAYMENT') return opts.existing?.payment ?? null;
      if (where.refType === 'PAYMENT_DISCOUNT') return opts.existing?.discount ?? null;
      return null;
    });
    let txOptions: unknown;
    const prisma: Record<string, unknown> = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'd1', role: 'DEALER', fullName: 'Cty A', phone: '0900000000' }) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      orderStatusHistory: { findMany: jest.fn().mockResolvedValue([]) },
      orderCustomerRefund: { findMany: jest.fn().mockResolvedValue([]) },
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      dealerCreditLedger: {
        findFirst,
        aggregate: jest.fn().mockResolvedValue({ _sum: { delta: debt } }),
        create: ledgerCreate,
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const transaction = jest.fn((cb: (t: unknown) => unknown, o?: unknown) => {
      txOptions = o;
      return cb(prisma);
    });
    prisma.$transaction = transaction;
    const svc = new DealerService(prisma as unknown as PrismaService, makeConfig(), { notify } as never);
    const rows = () => ledgerCreate.mock.calls.map((c) => (c[0] as { data: LedgerData }).data);
    return { svc, transaction, txOptions: () => txOptions, ledgerCreate, rows, findFirst, notify };
  }

  it('hoá đơn 100.000đ: thu 80.000đ + chiết khấu thanh toán 20.000đ → hai dòng sổ trong MỘT transaction Serializable, công nợ về 0đ', async () => {
    const { svc, rows, transaction, txOptions, ledgerCreate } = build({ debt: 100_000 });
    await svc.adminRecordCreditPayment('admin1', 'd1', 80_000, { idempotencyKey: 'FT1', paymentDiscount: 20_000, note: 'Trả sớm 10 ngày theo hợp đồng' });

    expect(ledgerCreate).toHaveBeenCalledTimes(2);
    const [payment, discount] = rows();
    expect(payment).toMatchObject({ userId: 'd1', delta: -80_000, refType: 'PAYMENT', refId: 'FT1' });
    expect(discount).toMatchObject({ userId: 'd1', delta: -20_000, refType: 'PAYMENT_DISCOUNT', refId: 'FT1:ck' });
    expect(discount!.note).toContain('Chi phí tài chính (TK 635)');
    expect(discount!.note).toContain('Trả sớm 10 ngày theo hợp đồng');
    expect(100_000 + payment!.delta + discount!.delta).toBe(0);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txOptions()).toEqual({ isolationLevel: 'Serializable' });
  });

  it('dòng chiết khấu thanh toán không chứa "Mã GD" (kiểm trùng mã giao dịch chỉ đếm dòng PAYMENT là một lần thu tiền)', async () => {
    const { svc, rows } = build({ debt: 100_000 });
    await svc.adminRecordCreditPayment('admin1', 'd1', 80_000, { bankRef: 'FT777', paymentDiscount: 20_000, note: 'Trả đúng hạn' });
    const [payment, discount] = rows();
    expect(payment!.note).toContain('Mã GD FT777');
    expect(discount!.note).not.toContain('Mã GD');
  });

  it('kết quả báo lại chiết khấu vừa ghi; không có chiết khấu thì không có trường paymentDiscount và chỉ một dòng sổ như cũ', async () => {
    const withDiscount = build({ debt: 100_000 });
    const r = await withDiscount.svc.adminRecordCreditPayment('admin1', 'd1', 80_000, { paymentDiscount: 20_000, note: 'Trả sớm' });
    expect(r).toMatchObject({ paymentDiscount: 20_000 });

    const plain = build({ debt: 100_000 });
    const p = await plain.svc.adminRecordCreditPayment('admin1', 'd1', 80_000);
    expect(p).not.toHaveProperty('paymentDiscount');
    expect(plain.ledgerCreate).toHaveBeenCalledTimes(1);
  });

  it('không có khoá và không có báo cáo: dòng chiết khấu không có refId (không đụng unique)', async () => {
    const { svc, rows } = build({ debt: 100_000 });
    await svc.adminRecordCreditPayment('admin1', 'd1', 80_000, { paymentDiscount: 20_000, note: 'Trả sớm' });
    expect(rows()[1]).not.toHaveProperty('refId');
  });

  it('chiết khấu mà không ghi lý do → 400, không ghi dòng nào', async () => {
    const { svc, ledgerCreate } = build({ debt: 100_000 });
    await expect(svc.adminRecordCreditPayment('admin1', 'd1', 80_000, { paymentDiscount: 20_000 })).rejects.toThrow(/lý do chiết khấu thanh toán/);
    await expect(svc.adminRecordCreditPayment('admin1', 'd1', 80_000, { paymentDiscount: 20_000, note: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('thu + chiết khấu vượt dư nợ → 400, không ghi dòng nào (kiểm lại ngay trong transaction)', async () => {
    const { svc, ledgerCreate } = build({ debt: 100_000 });
    await expect(svc.adminRecordCreditPayment('admin1', 'd1', 90_000, { paymentDiscount: 20_000, note: 'Trả sớm' })).rejects.toThrow(/vượt phải thu 100\.000đ/);
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('chiết khấu vượt trần 20% khoản xoá nợ → 400, không xoá nợ tuỳ ý dưới tên chi phí tài chính', async () => {
    const { svc, ledgerCreate } = build({ debt: 100_000 });
    await expect(svc.adminRecordCreditPayment('admin1', 'd1', 50_000, { paymentDiscount: 50_000, note: 'Trả sớm' })).rejects.toThrow(/tối đa 20%/);
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('chiết khấu âm hoặc số lẻ → 400 trước khi đụng sổ', async () => {
    const { svc, ledgerCreate, transaction } = build({ debt: 100_000 });
    await expect(svc.adminRecordCreditPayment('admin1', 'd1', 80_000, { paymentDiscount: -1, note: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.adminRecordCreditPayment('admin1', 'd1', 80_000, { paymentDiscount: 10.5, note: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    expect(ledgerCreate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('chiết khấu 0 giữ nguyên luật cũ: số tiền vượt dư nợ vẫn báo câu cũ "vượt dư nợ hiện tại"', async () => {
    const { svc } = build({ debt: 50_000 });
    await expect(svc.adminRecordCreditPayment('admin1', 'd1', 80_000, { paymentDiscount: 0 })).rejects.toThrow(/vượt dư nợ hiện tại/);
  });

  it('bấm lại cùng khoá với đúng số tiền và đúng chiết khấu → phát lại, không ghi thêm dòng nào', async () => {
    const { svc, ledgerCreate } = build({ existing: { payment: { delta: -80_000 }, discount: { delta: -20_000 } } });
    const r = await svc.adminRecordCreditPayment('admin1', 'd1', 80_000, { idempotencyKey: 'FT1', paymentDiscount: 20_000, note: 'Trả sớm' });
    expect(r).toMatchObject({ replayed: true });
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('cùng khoá nhưng đổi chiết khấu → 400, không coi là phát lại (tránh nuốt một khoản chiết khấu khác)', async () => {
    const { svc, ledgerCreate } = build({ existing: { payment: { delta: -80_000 } } });
    await expect(svc.adminRecordCreditPayment('admin1', 'd1', 80_000, { idempotencyKey: 'FT1', paymentDiscount: 20_000, note: 'Trả sớm' })).rejects.toThrow(/chiết khấu thanh toán khác/);
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('khoá cũ ghi không chiết khấu, lần này bấm lại cũng không chiết khấu → vẫn phát lại như cũ', async () => {
    const { svc, ledgerCreate } = build({ existing: { payment: { delta: -80_000 } } });
    const r = await svc.adminRecordCreditPayment('admin1', 'd1', 80_000, { idempotencyKey: 'FT1' });
    expect(r).toMatchObject({ replayed: true });
    expect(ledgerCreate).not.toHaveBeenCalled();
  });
});
