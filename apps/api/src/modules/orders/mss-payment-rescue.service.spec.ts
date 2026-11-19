import { BadRequestException, ConflictException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { MSS_PAYMENT_RESCUE_CANCEL_KEY } from '../integrations/mss/mss-flag-keys';
import { MssPaymentRescueService, overdueCancelNote } from './mss-payment-rescue.service';
import { CancelAfterHandoverError } from './order-transition';
import { PENDING_PAYMENT_TTL_KEY } from './pending-payment-ttl';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { OrderStatusService, SetStatusOutcome } from './order-status.service';

const CREATED = new Date('2026-11-19T07:00:00Z');
const AFTER_24H = new Date('2026-11-20T07:00:01Z');

const pending = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  type: 'RETAIL',
  status: 'PENDING_PAYMENT',
  paymentStatus: 'UNPAID',
  paymentMethod: 'BANK_TRANSFER',
  createdAt: CREATED,
  autoCancelBlockedAt: null,
  paymentUnlinkedAt: null,
  pancakePaidReported: null,
  ...over,
});

function setup(order: Record<string, unknown> | null, configs: Record<string, unknown> = { [MSS_PAYMENT_RESCUE_CANCEL_KEY]: true }) {
  const findUnique = jest.fn().mockResolvedValue(order);
  const prisma = { order: { findUnique } } as unknown as PrismaService;
  const config = { get: jest.fn(async (key: string, fallback: unknown) => (key in configs ? configs[key] : fallback)) } as unknown as SystemConfigService;
  const setStatus = jest.fn(async (_id: string, _to: string, opts: { outcome?: SetStatusOutcome }) => {
    if (opts.outcome) opts.outcome.flipped = true;
    return { status: 'CANCELLED' };
  });
  const orderStatus = { setStatus } as unknown as OrderStatusService;
  return { svc: new MssPaymentRescueService(prisma, config, orderStatus), setStatus, findUnique };
}

describe('MssPaymentRescueService.handleOverdue (hợp đồng W4-02)', () => {
  beforeAll(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));
  afterAll(() => jest.restoreAllMocks());

  it('đơn chuyển khoản chờ tiền, chưa có khoản nào về, đã qua hạn 24 giờ: huỷ qua đường huỷ chuẩn với lý do chuẩn', async () => {
    const { svc, setStatus, findUnique } = setup(pending());
    await expect(svc.handleOverdue('TUBU2026111912345', AFTER_24H)).resolves.toEqual({ outcome: 'cancelled' });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'TUBU2026111912345' } }));
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith(
      'o1',
      'CANCELLED',
      expect.objectContaining({
        actorType: 'SYSTEM',
        note: 'Tự động hủy do quá hạn chuyển khoản 24h',
        onlyIfUnpaid: true,
        expectedStatus: 'PENDING_PAYMENT',
        pancakeGate: true,
        notifyEvent: 'ORDER_PAYMENT_EXPIRED',
      }),
    );
  });

  it('lý do theo hạn thanh toán Tubu đang ghi cho khách', async () => {
    expect(overdueCancelNote(24)).toBe('Tự động hủy do quá hạn chuyển khoản 24h');
    const { svc, setStatus } = setup(pending(), { [MSS_PAYMENT_RESCUE_CANCEL_KEY]: true, [PENDING_PAYMENT_TTL_KEY]: 12 });
    await svc.handleOverdue('C', new Date('2026-11-19T19:00:00Z'));
    expect(setStatus).toHaveBeenCalledWith('o1', 'CANCELLED', expect.objectContaining({ note: 'Tự động hủy do quá hạn chuyển khoản 12h' }));
  });

  it.each([
    ['cờ chưa có', {}],
    ['cờ tắt', { [MSS_PAYMENT_RESCUE_CANCEL_KEY]: false }],
    ['chuỗi "true" không phải bật', { [MSS_PAYMENT_RESCUE_CANCEL_KEY]: 'true' }],
  ])('%s: disabled, không đọc đơn', async (_name, configs) => {
    const { svc, setStatus, findUnique } = setup(pending(), configs);
    await expect(svc.handleOverdue('C', AFTER_24H)).resolves.toEqual({ outcome: 'disabled' });
    expect(findUnique).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('đơn lạ: unknown_order', async () => {
    const { svc, setStatus } = setup(null);
    await expect(svc.handleOverdue('C', AFTER_24H)).resolves.toEqual({ outcome: 'unknown_order' });
    expect(setStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['COD', { paymentMethod: 'COD' }, 'not_bank_transfer'],
    ['ZaloPay', { paymentMethod: 'ZALOPAY' }, 'not_bank_transfer'],
    ['đã trả tiền', { paymentStatus: 'PAID' }, 'paid'],
    ['đã trả, đã xác nhận', { status: 'CONFIRMED', paymentStatus: 'PAID' }, 'paid'],
    ['đơn đại lý ghi công nợ (CONFIRMED, UNPAID)', { type: 'DEALER', status: 'CONFIRMED' }, 'not_pending'],
    ['Pancake báo có khoản về chưa gắn đơn', { paymentUnlinkedAt: new Date() }, 'payment_unlinked'],
    ['khách đã chuyển một phần', { pancakePaidReported: 50_000 }, 'partially_paid'],
    ['đã thôi tự huỷ (hàng đã bàn giao)', { autoCancelBlockedAt: new Date() }, 'auto_cancel_blocked'],
  ])('%s: không huỷ (skipped %s)', async (_name, over, reason) => {
    const { svc, setStatus } = setup(pending(over));
    await expect(svc.handleOverdue('C', AFTER_24H)).resolves.toEqual({ outcome: 'skipped', reason });
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('đơn đã huỷ (MSS gửi lại, hay cron đã huỷ trước): already_cancelled, không gọi lại đường huỷ', async () => {
    const { svc, setStatus } = setup(pending({ status: 'CANCELLED' }));
    await expect(svc.handleOverdue('C', AFTER_24H)).resolves.toEqual({ outcome: 'already_cancelled' });
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('MSS báo sớm hơn hạn Tubu ghi cho khách (MSS chỉnh được từ 6 giờ; đơn đại lý hạn 72 giờ): not_due, để cron huỷ đúng giờ', async () => {
    const early = setup(pending());
    await expect(early.svc.handleOverdue('C', new Date('2026-11-19T13:00:00Z'))).resolves.toEqual({ outcome: 'not_due', deadline: '2026-11-20T07:00:00.000Z' });
    expect(early.setStatus).not.toHaveBeenCalled();
    const dealer = setup(pending({ type: 'DEALER' }));
    await expect(dealer.svc.handleOverdue('C', AFTER_24H)).resolves.toEqual({ outcome: 'not_due', deadline: '2026-11-22T07:00:00.000Z' });
    expect(dealer.setStatus).not.toHaveBeenCalled();
  });

  it('thua lần lật (tiền về hay cron chen giữa): không báo là đã huỷ', async () => {
    const { svc, setStatus } = setup(pending());
    setStatus.mockResolvedValueOnce({ status: 'PENDING_PAYMENT' });
    await expect(svc.handleOverdue('C', AFTER_24H)).resolves.toEqual({ outcome: 'skipped', reason: 'raced' });
    setStatus.mockResolvedValueOnce({ status: 'CANCELLED' });
    await expect(svc.handleOverdue('C', AFTER_24H)).resolves.toEqual({ outcome: 'already_cancelled' });
  });

  it('hàng đã bàn giao vận chuyển: skipped handover (200, MSS thôi gửi); lỗi khác ném tiếp để MSS gửi lại', async () => {
    const { svc, setStatus } = setup(pending());
    setStatus.mockRejectedValueOnce(new CancelAfterHandoverError('C', 'PENDING_PAYMENT', { kind: 'CARRIER_WAYBILL', detail: 'mã vận đơn GHN 123' }));
    await expect(svc.handleOverdue('C', AFTER_24H)).resolves.toEqual({ outcome: 'skipped', reason: 'handover' });
    setStatus.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.handleOverdue('C', AFTER_24H)).rejects.toThrow('db down');
  });

  it('Pancake chưa hỏi được, hay đơn đang đổi trạng thái liên tục (409 của setStatus): 503 để MSS gửi lại, không trả 4xx', async () => {
    const { svc, setStatus } = setup(pending());
    setStatus.mockRejectedValueOnce(new ConflictException({ code: 'PANCAKE_UNREACHABLE', message: 'x' }));
    await expect(svc.handleOverdue('C', AFTER_24H)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('setStatus từ chối huỷ bằng 400 (Pancake báo đã bàn giao, hay đơn vừa đổi trạng thái): đọc lại đơn, trả 200 kèm lý do', async () => {
    const { svc, setStatus, findUnique } = setup(pending());
    setStatus.mockRejectedValueOnce(new BadRequestException('Pancake báo đã bàn giao'));
    findUnique.mockResolvedValueOnce(pending()).mockResolvedValueOnce({ status: 'PENDING_PAYMENT', autoCancelBlockedAt: new Date() });
    await expect(svc.handleOverdue('C', AFTER_24H)).resolves.toEqual({ outcome: 'skipped', reason: 'handover' });

    setStatus.mockRejectedValueOnce(new BadRequestException('Không chuyển được trạng thái'));
    findUnique.mockResolvedValueOnce(pending()).mockResolvedValueOnce({ status: 'CONFIRMED', autoCancelBlockedAt: null });
    await expect(svc.handleOverdue('C', AFTER_24H)).resolves.toEqual({ outcome: 'skipped', reason: 'raced' });

    setStatus.mockRejectedValueOnce(new BadRequestException('x'));
    findUnique.mockResolvedValueOnce(pending()).mockResolvedValueOnce({ status: 'CANCELLED', autoCancelBlockedAt: null });
    await expect(svc.handleOverdue('C', AFTER_24H)).resolves.toEqual({ outcome: 'already_cancelled' });
  });
});

describe('MssPaymentRescueService.recordReminders (w8-01, số lần MSS nhắc chuyển khoản)', () => {
  const make = (updateMany: jest.Mock = jest.fn().mockResolvedValue({ count: 1 })) => {
    const prisma = { order: { updateMany } } as unknown as PrismaService;
    return { svc: new MssPaymentRescueService(prisma, { get: jest.fn() } as unknown as SystemConfigService, {} as OrderStatusService), updateMany };
  };
  const AT = new Date('2026-11-19T13:02:00.000Z');

  it('ghi cả hai trường lên đơn chuyển khoản, mỗi trường chỉ khi giá trị mới không nhỏ hơn giá trị đang lưu (tin tới trễ không làm lùi)', async () => {
    const { svc, updateMany } = make();
    await svc.recordReminders('TUBU2026111912345', { sent: 2, lastAt: AT });
    expect(updateMany.mock.calls).toEqual([
      [
        {
          where: { code: 'TUBU2026111912345', paymentMethod: 'BANK_TRANSFER', OR: [{ paymentRemindersSent: null }, { paymentRemindersSent: { lte: 2 } }] },
          data: { paymentRemindersSent: 2 },
        },
      ],
      [
        {
          where: { code: 'TUBU2026111912345', paymentMethod: 'BANK_TRANSFER', OR: [{ paymentLastRemindedAt: null }, { paymentLastRemindedAt: { lte: AT } }] },
          data: { paymentLastRemindedAt: AT },
        },
      ],
    ]);
  });

  it('chỉ có last_reminded_at (số nhắc thiếu hay hỏng): vẫn chỉ ghi mốc mới hơn mốc đang lưu, không đụng số nhắc', async () => {
    const { svc, updateMany } = make();
    await svc.recordReminders('C', { sent: null, lastAt: AT });
    expect(updateMany.mock.calls).toEqual([
      [{ where: { code: 'C', paymentMethod: 'BANK_TRANSFER', OR: [{ paymentLastRemindedAt: null }, { paymentLastRemindedAt: { lte: AT } }] }, data: { paymentLastRemindedAt: AT } }],
    ]);
  });

  it('MSS chưa gửi hai trường (bản cũ): không ghi gì', async () => {
    const { svc, updateMany } = make();
    await svc.recordReminders('C', { sent: null, lastAt: null });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('lỗi DB khi ghi chỉ log cảnh báo, không chặn việc huỷ phía sau', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc } = make(jest.fn().mockRejectedValue(new Error('db down')));
    await expect(svc.recordReminders('C', { sent: 1, lastAt: null })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
    warn.mockRestore();
  });
});
