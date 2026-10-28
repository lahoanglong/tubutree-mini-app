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
    expect(t.findMany.mock.calls[0][0].where).toEqual({ status: 'APPROVED', payoutBatchId: null });
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
      { amount: '5.400.000đ', tax_note: ' (đã khấu trừ thuế TNCN 600.000đ)' },
      { dedupeKey: key },
    );
  });

  it('không có thuế → tax_note rỗng; thực vào Ví 0đ (thuế truy thu ăn hết) → không báo "đã cộng"', async () => {
    const a = build({ rows: rows('a', 10_000), payout: { amount: 10_000, taxWithheld: 0 } });
    a.requestPayout.mockResolvedValue({ ok: true, method: 'WALLET_BALANCE', credited: 10_000, note: '' });
    await a.svc.autoTransferApprovedToWallet();
    expect(a.notify.mock.calls[0][2]).toEqual({ amount: '10.000đ', tax_note: '' });

    const b = build({ rows: rows('a', 10_000) });
    b.requestPayout.mockResolvedValue({ ok: true, method: 'WALLET_BALANCE', credited: 0, note: '' });
    const credited = await b.svc.autoTransferApprovedToWallet();
    expect(b.notify).not.toHaveBeenCalled();
    expect(credited.has('a')).toBe(false);
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

  it('truy vấn lỗi → không ném (cron không được sập process)', async () => {
    const t = build();
    t.findMany.mockRejectedValue(new Error('db down'));
    await expect(t.svc.autoTransferApprovedToWallet()).resolves.toEqual(new Set());
  });
});

describe('AffiliateService.approveDueCommissions + tự chuyển vào Ví', () => {
  function cron(opts: { count: number; approved: { affiliateUserId: string; amount: number }[]; flag?: boolean }) {
    const updateMany = jest.fn().mockResolvedValue({ count: opts.count });
    const findMany = jest.fn().mockResolvedValue(opts.approved);
    const notify = jest.fn().mockResolvedValue(undefined);
    const config = {
      get: async <T>(k: string, fb?: T): Promise<T> => (k === AFFILIATE_AUTO_WALLET_TRANSFER_KEY && opts.flag !== undefined ? opts.flag : fb) as T,
    } as unknown as SystemConfigService;
    const prisma = { returnRequest: { findMany: jest.fn().mockResolvedValue([]) }, commission: { updateMany, findMany } } as unknown as PrismaService;
    const svc = new AffiliateService(
      prisma, config, noop as PricingService, noop as PancakeOrderService, noop as RewardPointsService, noop as AnalyticsEventsService,
      { notify } as unknown as NotificationsService,
    );
    return { svc, notify, updateMany };
  }

  it('chạy tự chuyển SAU bước duyệt, kể cả khi lượt này không duyệt thêm khoản nào (quét phần còn sót)', async () => {
    const t = cron({ count: 0, approved: [] });
    const auto = jest.spyOn(t.svc, 'autoTransferApprovedToWallet').mockResolvedValue(new Set());
    await t.svc.approveDueCommissions();
    expect(t.updateMany).toHaveBeenCalledTimes(1);
    expect(auto).toHaveBeenCalledTimes(1);
  });

  it('CTV đã được tự cộng vào Ví thì KHÔNG nhận thêm tin "đã duyệt, hãy chuyển vào Ví"; CTV chưa chuyển được vẫn nhận', async () => {
    const t = cron({ count: 2, approved: [{ affiliateUserId: 'a', amount: 10_000 }, { affiliateUserId: 'b', amount: 7_000 }] });
    jest.spyOn(t.svc, 'autoTransferApprovedToWallet').mockResolvedValue(new Set(['a']));
    await t.svc.approveDueCommissions();
    expect(t.notify).toHaveBeenCalledTimes(1);
    expect(t.notify).toHaveBeenCalledWith('b', CTV_NOTIFICATION.APPROVED, { count: '1', amount: '7.000đ' });
  });

  it('tự chuyển ném lỗi thì cron vẫn báo CTV như cũ và không ném', async () => {
    const t = cron({ count: 1, approved: [{ affiliateUserId: 'a', amount: 10_000 }] });
    jest.spyOn(t.svc, 'autoTransferApprovedToWallet').mockRejectedValue(new Error('boom'));
    await expect(t.svc.approveDueCommissions()).resolves.toBeUndefined();
    expect(t.notify).toHaveBeenCalledTimes(1);
  });
});
