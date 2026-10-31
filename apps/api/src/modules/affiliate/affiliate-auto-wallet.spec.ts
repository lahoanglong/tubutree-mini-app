import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AffiliateService, PIT_TAX_ID_REQUIRED } from './affiliate.service';
import { CTV_NOTIFICATION } from './ctv-notification-codes';
import { AFFILIATE_AUTO_WALLET_TRANSFER_KEY } from './affiliate-auto-transfer-config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { RewardPointsService } from '../wallet/reward-points.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { NotificationsService } from '../notifications/notifications.service';

const noop = {} as never;
type Row = { id: string; affiliateUserId: string; amount: number };

function build(opts: { rows?: Row[]; flag?: unknown; payout?: { amount: number; taxWithheld: number } | null } = {}) {
  const flagValue = 'flag' in opts ? opts.flag : undefined;
  const config = {
    get: async <T>(k: string, fb?: T): Promise<T> =>
      (k === AFFILIATE_AUTO_WALLET_TRANSFER_KEY && flagValue !== undefined ? flagValue : fb) as T,
  } as unknown as SystemConfigService;
  const findMany = jest.fn().mockResolvedValue(opts.rows ?? []);
  const payoutFindUnique = jest.fn().mockResolvedValue(opts.payout === undefined ? { amount: 0, taxWithheld: 0 } : opts.payout);
  const notify = jest.fn().mockResolvedValue(undefined);
  const prisma = { commission: { findMany }, payout: { findUnique: payoutFindUnique } } as unknown as PrismaService;
  const svc = new AffiliateService(
    prisma,
    config,
    noop as PricingService,
    noop as PancakeOrderService,
    noop as RewardPointsService,
    noop as AnalyticsEventsService,
    { notify } as unknown as NotificationsService,
  );
  const requestPayout = jest.spyOn(svc, 'requestPayout');
  return { svc, findMany, requestPayout, notify, payoutFindUnique };
}

const rows = (userId: string, ...amounts: number[]): Row[] =>
  amounts.map((amount, i) => ({ id: `${userId}-c${i}`, affiliateUserId: userId, amount }));

describe('AffiliateService.autoTransferApprovedToWallet', () => {
  it('cờ tắt → không đọc hoa hồng, không chuyển, không báo (giữ hành vi bấm tay)', async () => {
    const t = build({ flag: false, rows: rows('a', 10_000) });
    const credited = await t.svc.autoTransferApprovedToWallet();
    expect(credited.size).toBe(0);
    expect(t.findMany).not.toHaveBeenCalled();
    expect(t.requestPayout).not.toHaveBeenCalled();
    expect(t.notify).not.toHaveBeenCalled();
  });

  it('giá trị cờ lạ (chuỗi "false") không được coi là bật', async () => {
    const t = build({ flag: 'false', rows: rows('a', 10_000) });
    await t.svc.autoTransferApprovedToWallet();
    expect(t.requestPayout).not.toHaveBeenCalled();
  });

  it('thiếu dòng cấu hình → mặc định bật: chuyển toàn bộ khả dụng của từng CTV qua requestPayout (đường duy nhất ghi tiền)', async () => {
    const t = build({ rows: [...rows('a', 10_000, 5_000), ...rows('b', 7_000)] });
    t.requestPayout.mockResolvedValue({ ok: true, method: 'WALLET_BALANCE', credited: 1, note: '' });
    const credited = await t.svc.autoTransferApprovedToWallet();
    expect(t.findMany.mock.calls[0][0].where).toEqual({ status: 'APPROVED', payoutBatchId: null, user: { isBlocked: false } });
    expect(t.requestPayout).toHaveBeenCalledTimes(2);
    expect(t.requestPayout).toHaveBeenCalledWith('a', 15_000, 'WALLET_BALANCE', undefined, expect.stringMatching(/^auto-wallet:a:/));
    expect(t.requestPayout).toHaveBeenCalledWith('b', 7_000, 'WALLET_BALANCE', undefined, expect.stringMatching(/^auto-wallet:b:/));
    expect([...credited].sort()).toEqual(['a', 'b']);
  });

  it('khoá idempotency xác định theo tập commission: đảo thứ tự dòng vẫn cùng khoá, thêm một khoản thì khác khoá', async () => {
    const keyOf = async (r: Row[]) => {
      const t = build({ rows: r });
      t.requestPayout.mockResolvedValue({ ok: true, method: 'WALLET_BALANCE', credited: 1, note: '' });
      await t.svc.autoTransferApprovedToWallet();
      return t.requestPayout.mock.calls[0]![4] as string;
    };
    const base = rows('a', 10_000, 5_000);
    const k1 = await keyOf(base);
    expect(await keyOf([...base].reverse())).toBe(k1);
    expect(await keyOf([...base, { id: 'a-c9', affiliateUserId: 'a', amount: 1 }])).not.toBe(k1);
  });

  it('báo CTV "Đã cộng … hoa hồng vào Ví Tubu" theo số thực vào Ví, kèm dedupeKey = khoá idempotency; ghi chú thuế khi có khấu trừ', async () => {
    const t = build({ rows: rows('a', 6_000_000), payout: { amount: 5_400_000, taxWithheld: 600_000 } });
    t.requestPayout.mockResolvedValue({ ok: true, method: 'WALLET_BALANCE', credited: 5_400_000, note: '' });
    await t.svc.autoTransferApprovedToWallet();
    const key = t.requestPayout.mock.calls[0]![4] as string;
    expect(t.notify).toHaveBeenCalledWith(
      'a',
      CTV_NOTIFICATION.AUTO_WALLET,
      { amount: '5.400.000đ', count: '1', tax_note: ' (đã khấu trừ thuế TNCN 600.000đ)' },
      { dedupeKey: key },
    );
  });

  it('không có thuế → tax_note rỗng', async () => {
    const a = build({ rows: rows('a', 10_000), payout: { amount: 10_000, taxWithheld: 0 } });
    a.requestPayout.mockResolvedValue({ ok: true, method: 'WALLET_BALANCE', credited: 10_000, note: '' });
    await a.svc.autoTransferApprovedToWallet();
    expect(a.notify.mock.calls[0][2]).toEqual({ amount: '10.000đ', count: '1', tax_note: '' });
  });

  it('thuế truy thu ăn hết (payout đã tạo, vào Ví 0đ) → báo "đã khấu trừ toàn bộ thuế", không báo "đã cộng", và CTV không nhận tin dặn bấm tay', async () => {
    const b = build({ rows: rows('a', 10_000), payout: { amount: 0, taxWithheld: 10_000 } });
    b.requestPayout.mockResolvedValue({ ok: true, method: 'WALLET_BALANCE', credited: 0, note: '' });
    const credited = await b.svc.autoTransferApprovedToWallet();
    const key = b.requestPayout.mock.calls[0]![4] as string;
    expect(b.notify).toHaveBeenCalledTimes(1);
    expect(b.notify).toHaveBeenCalledWith('a', CTV_NOTIFICATION.AUTO_WALLET_TAX_ONLY, { amount: '10.000đ', tax: '10.000đ' }, { dedupeKey: key });
    expect(credited.has('a')).toBe(true);
  });

  it('một CTV lỗi (thiếu MST, đã bị bấm tay trước, lỗi lạ) thì CTV khác vẫn được chuyển; người lỗi không vào danh sách đã cộng', async () => {
    const t = build({ rows: [...rows('a', 1_000), ...rows('b', 2_000), ...rows('c', 3_000), ...rows('d', 4_000)] });
    t.requestPayout
      .mockRejectedValueOnce(new BadRequestException({ code: PIT_TAX_ID_REQUIRED, message: 'cần MST' }))
      .mockRejectedValueOnce(new BadRequestException('Hoa hồng đã được xử lý.'))
      .mockRejectedValueOnce(new ConflictException('Dữ liệu hoa hồng đã thay đổi, vui lòng thử lại.'))
      .mockResolvedValueOnce({ ok: true, method: 'WALLET_BALANCE', credited: 4_000, note: '' });
    const credited = await t.svc.autoTransferApprovedToWallet();
    expect(t.requestPayout).toHaveBeenCalledTimes(4);
    expect([...credited]).toEqual(['d']);
  });

  it('có ứng viên nhưng không ai chuyển được vì lỗi thật (DB chập): ok=false để không ghi mốc ngày, và log error', async () => {
    const t = build({ rows: [...rows('a', 1_000), ...rows('b', 2_000)] });
    t.requestPayout.mockRejectedValue(new Error('db chập'));
    const err = jest.spyOn((t.svc as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
    const r = await (t.svc as unknown as { transferApproved(): Promise<{ credited: Set<string>; ok: boolean }> }).transferApproved();
    expect(r.ok).toBe(false);
    expect(r.credited.size).toBe(0);
    expect(err).toHaveBeenCalled();
  });

  it('không ai chuyển được nhưng toàn là ca bỏ qua có chủ ý (thiếu MST, bị bấm tay trước): ok=true', async () => {
    const t = build({ rows: [...rows('a', 1_000), ...rows('b', 2_000)] });
    t.requestPayout
      .mockRejectedValueOnce(new BadRequestException({ code: PIT_TAX_ID_REQUIRED, message: 'cần MST' }))
      .mockRejectedValueOnce(new BadRequestException('Hoa hồng đã được xử lý.'));
    const r = await (t.svc as unknown as { transferApproved(): Promise<{ ok: boolean }> }).transferApproved();
    expect(r.ok).toBe(true);
  });

  it('đã có ít nhất một CTV chuyển xong thì ok=true dù CTV khác lỗi thật (lỗi đó log error)', async () => {
    const t = build({ rows: [...rows('a', 1_000), ...rows('b', 2_000)] });
    t.requestPayout
      .mockRejectedValueOnce(new Error('db chập'))
      .mockResolvedValueOnce({ ok: true, method: 'WALLET_BALANCE', credited: 2_000, note: '' });
    const err = jest.spyOn((t.svc as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
    const r = await (t.svc as unknown as { transferApproved(): Promise<{ credited: Set<string>; ok: boolean }> }).transferApproved();
    expect(r.ok).toBe(true);
    expect([...r.credited]).toEqual(['b']);
    expect(err).toHaveBeenCalled();
  });

  it('truy vấn lỗi → không ném (cron không được sập process)', async () => {
    const t = build();
    t.findMany.mockRejectedValue(new Error('db down'));
    await expect(t.svc.autoTransferApprovedToWallet()).resolves.toEqual(new Set());
  });
});

describe('AffiliateService.approveDueCommissions (duyệt mỗi giờ, chuyển Ví mỗi ngày)', () => {
  function cron(opts: { count?: number; locked?: boolean } = {}) {
    const updateMany = jest.fn().mockResolvedValue({ count: opts.count ?? 0 });
    const findMany = jest.fn().mockResolvedValue([]);
    const notify = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
      commission: { updateMany, findMany },
      cronRun: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([{ locked: opts.locked ?? true }]),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
    const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
    const svc = new AffiliateService(
      prisma as unknown as PrismaService, config, noop as PricingService, noop as PancakeOrderService, noop as RewardPointsService, noop as AnalyticsEventsService,
      { notify } as unknown as NotificationsService,
    );
    return { svc, notify, updateMany, prisma };
  }
  const SEVEN_VN = new Date('2026-10-31T00:00:00Z');
  const NINE_VN = new Date('2026-10-31T02:00:00Z');

  it('chạy mỗi giờ (duyệt không được dời giờ vì approvedAt là mốc doanh số tháng)', () => {
    const opts = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', AffiliateService.prototype.approveDueCommissions) as { cronTime: string; timeZone: string };
    expect(opts.cronTime).toBe('0 0 * * * *');
    expect(opts.timeZone).toBe('Asia/Ho_Chi_Minh');
  });

  it('trước 8:00 giờ VN: duyệt nhưng không chuyển Ví, không báo', async () => {
    const t = cron({ count: 2 });
    const auto = jest.spyOn(t.svc, 'autoTransferApprovedToWallet');
    await t.svc.approveDueCommissions(SEVEN_VN);
    expect(t.updateMany).toHaveBeenCalledTimes(1);
    expect(auto).not.toHaveBeenCalled();
    expect(t.notify).not.toHaveBeenCalled();
  });

  it('từ 8:00 giờ VN, hôm nay chưa có lượt ngày: chạy lượt ngày (kể cả lượt trước lỡ thì chạy bù ở giờ này)', async () => {
    const t = cron();
    const daily = jest.spyOn(t.svc, 'runDailyWalletTransferIfDue');
    await t.svc.approveDueCommissions(NINE_VN);
    expect(daily).toHaveBeenCalledTimes(1);
    expect(t.prisma.cronRun.upsert).toHaveBeenCalledTimes(1);
  });

  it('đối số không phải Date hợp lệ (vd. scheduler truyền thứ khác) thì dùng giờ hiện tại', async () => {
    const t = cron();
    await expect(t.svc.approveDueCommissions('x' as unknown as Date)).resolves.toBeUndefined();
    await expect(t.svc.approveDueCommissions(new Date('nope'))).resolves.toBeUndefined();
    expect(t.updateMany).toHaveBeenCalledTimes(2);
  });

  it('thua khoá advisory: không duyệt, không chuyển', async () => {
    const t = cron({ locked: false, count: 1 });
    await t.svc.approveDueCommissions(NINE_VN);
    expect(t.updateMany).not.toHaveBeenCalled();
    expect(t.prisma.cronRun.upsert).not.toHaveBeenCalled();
  });

  it('lỗi DB giữa chừng không ném (cron không được sập process)', async () => {
    const t = cron();
    t.prisma.returnRequest.findMany.mockRejectedValue(new Error('db down'));
    await expect(t.svc.approveDueCommissions(NINE_VN)).resolves.toBeUndefined();
  });
});
