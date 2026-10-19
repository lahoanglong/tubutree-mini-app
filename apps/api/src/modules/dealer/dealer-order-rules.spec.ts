import { DealerService } from './dealer.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

/**
 * Luật đơn sỉ đã chốt (nhóm C, 03-cau-hoi-sang.md): tối thiểu 3 triệu, miễn phí giao từ 5 triệu,
 * khoá mua chịu khi quá hạn. Đơn dưới 5 triệu thu phí giao phẳng; ngưỡng/phí nằm ở SystemConfig.
 */

const DAY = 24 * 60 * 60 * 1000;

function makeConfig(values: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(key: string, fb?: T): Promise<T> => (key in values ? values[key] : fb) as T,
  } as unknown as SystemConfigService;
}

type LedgerRow = { delta: number; refType: string; refId: string | null; createdAt: Date };

function build(opts: { unitPrice: number; terms?: string | null; ledger?: LedgerRow[]; creditLimit?: number }) {
  const tier = {
    id: 't1',
    creditLimit: opts.creditLimit ?? 100_000_000,
    paymentTerms: opts.terms === undefined ? 'NET 15' : opts.terms,
    discountRules: { default: 0 },
  };
  const ledger = opts.ledger ?? [];
  const orderCreate = jest.fn().mockResolvedValue({ id: 'o1' });
  const ledgerCreate = jest.fn().mockResolvedValue({});
  const base: Record<string, unknown> = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'd1', role: 'DEALER', metadata: { dealerTierId: 't1' } }) },
    dealerTier: { findUnique: jest.fn().mockResolvedValue(tier) },
    variation: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'v1', isActive: true, retailPrice: opts.unitPrice, dealerPrices: null, name: '500ml', product: { name: 'SP', slug: 'sp', isActive: true, approvalStatus: 'APPROVED' } },
      ]),
    },
    order: {
      create: orderCreate,
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'o1', items: [] }),
    },
    dealerCreditLedger: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { delta: ledger.reduce((s, r) => s + r.delta, 0) } }),
      findMany: jest.fn().mockResolvedValue(ledger),
      create: ledgerCreate,
    },
    address: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'addr1', recipient: 'Đại lý', phone: '0911111111', street: '5 Trần Phú', ward: 'P', district: '', province: 'Đà Nẵng',
        provinceCode: '84_VN48', districtCode: '', wardCode: '84_VN4820',
      }),
    },
    dealerApplication: { findFirst: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn(async (_s: unknown, ...vals: unknown[]) => [{ reserved: (vals.find((v) => typeof v === 'number') as number) ?? 0 }]),
  };
  base.$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(base));
  return { prisma: base as unknown as PrismaService, orderCreate, ledgerCreate };
}

const place = (prisma: PrismaService, method: 'PREPAID' | 'CREDIT', config: Record<string, unknown> = {}) =>
  new DealerService(prisma, makeConfig(config)).placeOrder('d1', { items: [{ variationId: 'v1', quantity: 1 }], paymentMethod: method } as never);

const createdData = (orderCreate: jest.Mock) => orderCreate.mock.calls[0]![0].data as { subtotal: number; shippingFee: number; total: number };

describe('DealerService.placeOrder — tối thiểu 3 triệu, phí giao theo ngưỡng 5 triệu', () => {
  it('đơn 2.999.999đ → 400 nêu mức tối thiểu, không giữ kho, không tạo đơn', async () => {
    const { prisma, orderCreate } = build({ unitPrice: 2_999_999 });
    await expect(place(prisma, 'PREPAID')).rejects.toMatchObject({
      response: { message: expect.stringMatching(/tối thiểu 3\.000\.000đ/) },
      status: 400,
    });
    expect(orderCreate).not.toHaveBeenCalled();
    expect((prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw).not.toHaveBeenCalled();
  });

  it('đơn đúng 3.000.000đ → qua, thu phí giao vì dưới 5 triệu', async () => {
    const { prisma, orderCreate } = build({ unitPrice: 3_000_000 });
    await place(prisma, 'PREPAID');
    expect(createdData(orderCreate)).toMatchObject({ subtotal: 3_000_000, shippingFee: 19_000, total: 3_019_000 });
  });

  it('đơn 4.000.000đ → shippingFee > 0 và total = subtotal + phí', async () => {
    const { prisma, orderCreate } = build({ unitPrice: 4_000_000 });
    await place(prisma, 'PREPAID');
    const d = createdData(orderCreate);
    expect(d.shippingFee).toBeGreaterThan(0);
    expect(d.total).toBe(d.subtotal + d.shippingFee);
  });

  it('đơn 5.000.000đ → miễn phí giao', async () => {
    const { prisma, orderCreate } = build({ unitPrice: 5_000_000 });
    await place(prisma, 'PREPAID');
    expect(createdData(orderCreate)).toMatchObject({ shippingFee: 0, total: 5_000_000 });
  });

  it('phí giao dưới ngưỡng lấy theo khoá riêng của đại lý; không có khoá thì dùng phí phẳng của đơn lẻ', async () => {
    const own = build({ unitPrice: 4_000_000 });
    await place(own.prisma, 'PREPAID', { 'dealer.shipping_fee_below_threshold_vnd': 30_000 });
    expect(createdData(own.orderCreate).shippingFee).toBe(30_000);

    const retail = build({ unitPrice: 4_000_000 });
    await place(retail.prisma, 'PREPAID', { 'shipping.flat_fee_below_threshold': 25_000 });
    expect(createdData(retail.orderCreate).shippingFee).toBe(25_000);
  });

  it('ngưỡng chỉnh được ở cấu hình: tối thiểu 0 = không chặn', async () => {
    const { prisma, orderCreate } = build({ unitPrice: 100_000 });
    await place(prisma, 'PREPAID', { 'dealer.min_order_value_vnd': 0 });
    expect(orderCreate).toHaveBeenCalled();
  });

  it('đơn ghi công nợ: dư nợ tăng đúng total gồm phí giao, và hạn mức kiểm theo total', async () => {
    const ok = build({ unitPrice: 4_000_000 });
    await place(ok.prisma, 'CREDIT');
    expect(ok.ledgerCreate.mock.calls[0]![0].data.delta).toBe(4_019_000);

    // 4.000.000 + phí 19.000 vượt hạn mức 4.010.000 dù tiền hàng chưa vượt.
    const tight = build({ unitPrice: 4_000_000, creditLimit: 4_010_000 });
    await expect(place(tight.prisma, 'CREDIT')).rejects.toThrow('Vượt hạn mức công nợ.');
    expect(tight.orderCreate).not.toHaveBeenCalled();
  });
});

describe('DealerService.placeOrder — khoá mua chịu khi nợ đơn quá hạn', () => {
  const orderDebt = (daysAgo: number, delta = 15_000_000, refId = 'oOld'): LedgerRow => ({
    delta,
    refType: 'ORDER',
    refId,
    createdAt: new Date(Date.now() - daysAgo * DAY),
  });

  it('nợ đơn NET 15 đã 16 ngày chưa trả → CREDIT bị 400 nêu quá hạn, không tạo đơn, không ghi nợ', async () => {
    const { prisma, orderCreate, ledgerCreate } = build({ unitPrice: 3_500_000, ledger: [orderDebt(16)] });
    await expect(place(prisma, 'CREDIT')).rejects.toMatchObject({
      response: { message: expect.stringMatching(/quá hạn/) },
      status: 400,
    });
    expect(orderCreate).not.toHaveBeenCalled();
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('cùng đại lý quá hạn nhưng chọn trả trước (PREPAID) → vẫn đặt được', async () => {
    const { prisma, orderCreate } = build({ unitPrice: 3_500_000, ledger: [orderDebt(16)] });
    await place(prisma, 'PREPAID');
    expect(orderCreate).toHaveBeenCalled();
  });

  it('nợ mới 10 ngày (chưa tới hạn NET 15) → CREDIT vẫn được', async () => {
    const { prisma, orderCreate } = build({ unitPrice: 3_500_000, ledger: [orderDebt(10)] });
    await place(prisma, 'CREDIT');
    expect(orderCreate).toHaveBeenCalled();
  });

  it('đã chuyển khoản trả đủ đơn cũ → hết quá hạn', async () => {
    const paid: LedgerRow = { delta: -15_000_000, refType: 'PAYMENT', refId: null, createdAt: new Date(Date.now() - 2 * DAY) };
    const { prisma, orderCreate } = build({ unitPrice: 3_500_000, ledger: [orderDebt(60), paid] });
    await place(prisma, 'CREDIT');
    expect(orderCreate).toHaveBeenCalled();
  });

  it('trả một phần: tiền trả trừ vào đơn cũ nhất trước, đơn cũ còn dư thì vẫn quá hạn', async () => {
    const partial: LedgerRow = { delta: -5_000_000, refType: 'PAYMENT', refId: null, createdAt: new Date(Date.now() - 2 * DAY) };
    const { prisma, orderCreate } = build({ unitPrice: 3_500_000, ledger: [orderDebt(60), partial] });
    await expect(place(prisma, 'CREDIT')).rejects.toThrow(/quá hạn/);
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('đơn cũ đã huỷ (ORDER_CANCEL) không tính là nợ quá hạn', async () => {
    const cancel: LedgerRow = { delta: -15_000_000, refType: 'ORDER_CANCEL', refId: 'oOld', createdAt: new Date(Date.now() - 50 * DAY) };
    const { prisma, orderCreate } = build({ unitPrice: 3_500_000, ledger: [orderDebt(60), cancel] });
    await place(prisma, 'CREDIT');
    expect(orderCreate).toHaveBeenCalled();
  });

  it('tắt khoá bằng dealer.block_credit_when_overdue=false → CREDIT quá hạn vẫn được', async () => {
    const { prisma, orderCreate } = build({ unitPrice: 3_500_000, ledger: [orderDebt(60)] });
    await place(prisma, 'CREDIT', { 'dealer.block_credit_when_overdue': false });
    expect(orderCreate).toHaveBeenCalled();
  });

  it('bậc trả trước (PREPAID) không có hạn nợ → không khoá theo tuổi nợ', async () => {
    const { prisma, orderCreate } = build({ unitPrice: 3_500_000, terms: 'PREPAID', ledger: [orderDebt(60)] });
    await place(prisma, 'CREDIT');
    expect(orderCreate).toHaveBeenCalled();
  });

  it('khoá được kiểm lại trong transaction (đại lý quá hạn chen vào giữa lúc fast-fail và lúc ghi)', async () => {
    const { prisma, orderCreate } = build({ unitPrice: 3_500_000 });
    const findMany = (prisma as unknown as { dealerCreditLedger: { findMany: jest.Mock } }).dealerCreditLedger.findMany;
    findMany.mockResolvedValueOnce([]).mockResolvedValue([orderDebt(40)]);
    await expect(place(prisma, 'CREDIT')).rejects.toThrow(/quá hạn/);
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

describe('DealerService.getMe — luật đơn sỉ trả kèm để màn đại lý báo trước phí giao và mức tối thiểu', () => {
  it('trả orderRules mặc định: tối thiểu 3 triệu, miễn phí giao từ 5 triệu, phí dưới ngưỡng bằng phí phẳng đơn lẻ', async () => {
    const { prisma } = build({ unitPrice: 1 });
    const me = await new DealerService(prisma, makeConfig()).getMe('d1');
    expect(me.orderRules).toEqual({ minOrderValue: 3_000_000, freeShipThreshold: 5_000_000, shippingFee: 19_000 });
  });

  it('theo khoá cấu hình đã đặt', async () => {
    const { prisma } = build({ unitPrice: 1 });
    const cfg = {
      'dealer.min_order_value_vnd': 2_000_000,
      'dealer.free_ship_threshold_vnd': 6_000_000,
      'dealer.shipping_fee_below_threshold_vnd': 30_000,
    };
    const me = await new DealerService(prisma, makeConfig(cfg)).getMe('d1');
    expect(me.orderRules).toEqual({ minOrderValue: 2_000_000, freeShipThreshold: 6_000_000, shippingFee: 30_000 });
  });
});
