import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { VouchersService } from '../../src/modules/vouchers/vouchers.service';
import { createOrder, createUser, pinConfig, warmPool } from './helpers';

const DAY = 864e5;
/** 10:00 giờ VN ngày 20/10/2026: giữa tháng nên mọi đơn "N ngày trước" trong ca đều cùng một tháng VN. */
const NOW = new Date('2026-10-20T03:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

/**
 * Voucher mốc chi tiêu chỉ cộng đơn đã hết hạn đổi/trả: nếu không, khách nhận mã rồi trả hàng mà mã vẫn giữ.
 * Chỉ đơn RETAIL khách tự đặt (như voucher đơn thứ 2): đơn đại lý và đơn CTV đặt hộ không phải chi tiêu của chính họ.
 */
describe('milestoneVouchers: điều kiện đơn được tính (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let vouchers: VouchersService;
  let restoreWindow: () => Promise<void>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, VouchersService, { provide: NotificationsService, useValue: { notify: async () => undefined } }],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    vouchers = moduleRef.get(VouchersService);
    await warmPool(prisma);
    restoreWindow = await pinConfig(prisma, 'returns.window_days', 7);
  });

  afterAll(async () => {
    await restoreWindow?.();
    await moduleRef?.close();
  });

  /** Chỉ Date.now() bị ghim (service đọc giờ qua Date.now), timer và pool của driver giữ nguyên. */
  async function runAt(now: Date): Promise<void> {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now.getTime());
    try {
      await vouchers.milestoneVouchers();
    } finally {
      spy.mockRestore();
    }
  }
  const realUser = () => createUser(prisma, { phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` });
  async function milestoneCodes(userId: string): Promise<string[]> {
    const rows = await prisma.coupon.findMany({
      where: { scope: 'USER_GROUP', scopeMeta: { path: ['userId'], equals: userId } },
      select: { code: true },
    });
    return rows.map((c) => c.code).filter((c) => c.startsWith('MILESTONE'));
  }
  const order = (userId: string, extra: Record<string, unknown> = {}) =>
    createOrder(prisma, {
      userId,
      status: 'DELIVERED',
      total: 5_000_000,
      subtotal: 5_000_000,
      createdAt: ago(10),
      deliveredAt: ago(8),
      ...extra,
    });

  it('giao 1 ngày trước (còn trong hạn đổi trả) → chưa cấp', async () => {
    const u = await realUser();
    await order(u.id, { deliveredAt: ago(1) });
    await runAt(NOW);
    expect(await milestoneCodes(u.id)).toEqual([]);
  });

  it('giao 8 ngày trước (qua hạn 7 ngày) → cấp mốc 5tr', async () => {
    const u = await realUser();
    await order(u.id);
    await runAt(NOW);
    expect(await milestoneCodes(u.id)).toEqual([expect.stringContaining('MILESTONE5000000-2026-10-')]);
  });

  it('đúng mốc hết hạn (giao đúng 7 ngày trước) → cấp', async () => {
    const u = await realUser();
    await order(u.id, { deliveredAt: ago(7) });
    await runAt(NOW);
    expect(await milestoneCodes(u.id)).toHaveLength(1);
  });

  it('đơn thiếu deliveredAt → chưa cấp (không biết hạn đổi trả hết lúc nào)', async () => {
    const u = await realUser();
    await order(u.id, { deliveredAt: null, deliveredEffectsAt: new Date(NOW.getTime()) });
    await runAt(NOW);
    expect(await milestoneCodes(u.id)).toEqual([]);
  });

  it('đơn đại lý (type DEALER) → không tính', async () => {
    const u = await realUser();
    await order(u.id, { type: 'DEALER' });
    await runAt(NOW);
    expect(await milestoneCodes(u.id)).toEqual([]);
  });

  it('đơn CTV đặt hộ khách (placedForCustomer) → không tính cho CTV', async () => {
    const u = await realUser();
    await order(u.id, { placedForCustomer: true });
    await runAt(NOW);
    expect(await milestoneCodes(u.id)).toEqual([]);
  });

  it('đơn đại lý + đơn lên hộ chỉ không tính, đơn RETAIL cùng khách vẫn cộng', async () => {
    const u = await realUser();
    await order(u.id, { type: 'DEALER', total: 4_000_000, subtotal: 4_000_000 });
    await order(u.id, { placedForCustomer: true, total: 4_000_000, subtotal: 4_000_000 });
    await order(u.id, { total: 1_200_000, subtotal: 1_200_000 });
    await runAt(NOW);
    expect(await milestoneCodes(u.id)).toEqual([expect.stringContaining('MILESTONE1000000-2026-10-')]);
  });

  it('có yêu cầu trả hàng REQUESTED → chưa cấp; bị REJECTED thì cấp', async () => {
    const u = await realUser();
    const o = await order(u.id);
    const rr = await prisma.returnRequest.create({
      data: { orderId: o.id, userId: u.id, reason: 'IT', status: 'REQUESTED', fullReturn: false },
    });
    await runAt(NOW);
    expect(await milestoneCodes(u.id)).toEqual([]);
    await prisma.returnRequest.update({ where: { id: rr.id }, data: { status: 'REJECTED' } });
    await runAt(NOW);
    expect(await milestoneCodes(u.id)).toHaveLength(1);
  });

  it('trả một phần đã duyệt nhưng chưa nhận hàng về (APPROVED, receivedAt null) → chưa cấp; nhận xong thì cấp theo số ròng', async () => {
    const u = await realUser();
    const o = await order(u.id, { total: 1_200_000, subtotal: 1_200_000 });
    const rr = await prisma.returnRequest.create({
      data: { orderId: o.id, userId: u.id, reason: 'IT', status: 'APPROVED', refundAmount: 100_000, fullReturn: false },
    });
    await runAt(NOW);
    expect(await milestoneCodes(u.id)).toEqual([]);
    await prisma.returnRequest.update({ where: { id: rr.id }, data: { receivedAt: ago(1) } });
    await runAt(NOW);
    expect(await milestoneCodes(u.id)).toEqual([expect.stringContaining('MILESTONE1000000-2026-10-')]);
  });

  it('đơn tạo ngày 30 tháng trước, qua hạn đổi trả ngày 8 tháng này → mã của kỳ tháng trước, đúng một lần', async () => {
    const u = await realUser();
    // Tạo 30/10, giao 01/11 09:00 VN, hết hạn 7 ngày vào 08/11 09:00 VN.
    await order(u.id, { createdAt: new Date('2026-10-30T05:00:00Z'), deliveredAt: new Date('2026-11-01T02:00:00Z') });
    await runAt(new Date('2026-11-07T03:00:00Z')); // chưa hết hạn
    expect(await milestoneCodes(u.id)).toEqual([]);
    await runAt(new Date('2026-11-08T03:00:00Z'));
    await runAt(new Date('2026-11-09T03:00:00Z'));
    const codes = await milestoneCodes(u.id);
    expect(codes).toHaveLength(1);
    expect(codes[0]).toContain('MILESTONE5000000-2026-10-');
  });

  it('chi tiêu kỳ tháng trước và tháng này không cộng dồn: mỗi tháng tính riêng theo tháng tạo đơn', async () => {
    const u = await realUser();
    await order(u.id, { total: 600_000, subtotal: 600_000, createdAt: new Date('2026-10-29T05:00:00Z'), deliveredAt: new Date('2026-10-30T02:00:00Z') });
    await order(u.id, { total: 600_000, subtotal: 600_000, createdAt: new Date('2026-11-01T05:00:00Z'), deliveredAt: new Date('2026-11-02T02:00:00Z') });
    await runAt(new Date('2026-11-20T03:00:00Z'));
    expect(await milestoneCodes(u.id)).toEqual([]);
  });
});
