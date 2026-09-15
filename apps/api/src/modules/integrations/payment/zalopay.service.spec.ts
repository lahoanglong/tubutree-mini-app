import { createHmac } from 'node:crypto';
import axios from 'axios';

// createPayment gọi ZaloPay thật qua axios — mock ở mức module để test không đụng mạng.
jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
const axiosPost = (axios as unknown as { post: jest.Mock }).post;
import { ZalopayService } from './zalopay.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { ConfigService } from '@nestjs/config';

const KEY2 = 'test-key2';

function makeConfig(configured = true): ConfigService {
  const map: Record<string, string> = configured
    ? {
        ZALOPAY_APP_ID: '2553',
        ZALOPAY_KEY1: 'k1',
        ZALOPAY_KEY2: KEY2,
        ZALOPAY_ENDPOINT: 'https://sb-openapi.zalopay.vn/v2',
      }
    : { ZALOPAY_APP_ID: '', ZALOPAY_KEY1: '', ZALOPAY_KEY2: '', ZALOPAY_ENDPOINT: '' };
  return { get: (k: string) => map[k] ?? '' } as unknown as ConfigService;
}

function sign(rawData: string): string {
  return createHmac('sha256', KEY2).update(rawData).digest('hex');
}

describe('ZalopayService.handleCallback (verify MAC §10.1)', () => {
  const order = { id: 'o1', code: 'TUBU1', userId: 'u1', paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT' };

  function setup(over: Record<string, unknown> = {}) {
    // update() dùng bởi createPayment (paymentTxnId); updateMany() dùng bởi handleCallback
    // (guard atomic paymentStatus:'UNPAID' — mặc định count:1 mô phỏng update thành công).
    const update = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValue(order);
    const attemptFindUnique = jest.fn().mockResolvedValue(null);
    const prisma = {
      order: { findFirst, update, updateMany },
      paymentAttempt: { findUnique: attemptFindUnique, create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const notify = jest.fn().mockResolvedValue(undefined);
    const notifications = { notify } as unknown as NotificationsService;
    const svc = new ZalopayService(prisma, notifications, makeConfig(true) as never);
    return { svc, update, updateMany, findFirst, notify, attemptFindUnique, prisma, ...over };
  }

  it('chưa cấu hình → return_code 2, không xử lý', async () => {
    const prisma = { order: { findFirst: jest.fn(), update: jest.fn() } } as unknown as PrismaService;
    const svc = new ZalopayService(prisma, { notify: jest.fn() } as unknown as NotificationsService, makeConfig(false) as never);
    const r = await svc.handleCallback('{}', 'whatever');
    expect(r.return_code).toBe(2);
  });

  it('MAC sai → return_code -1, KHÔNG cập nhật đơn', async () => {
    const { svc, updateMany } = setup();
    const raw = JSON.stringify({ app_trans_id: '250101_TUBU1' });
    const r = await svc.handleCallback(raw, 'mac-gia-mao');
    expect(r.return_code).toBe(-1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('MAC đúng → set PAID + CONFIRMED + notify', async () => {
    const { svc, updateMany, notify } = setup();
    const raw = JSON.stringify({ app_trans_id: '250101_TUBU1' });
    const r = await svc.handleCallback(raw, sign(raw));
    expect(r.return_code).toBe(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const call = (updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual(expect.objectContaining({ id: 'o1', paymentStatus: 'UNPAID' }));
    expect(call.data.paymentStatus).toBe('PAID');
    expect(call.data.status).toBe('CONFIRMED');
    expect(notify).toHaveBeenCalledWith('u1', 'ORDER_CONFIRMED', { order_code: 'TUBU1' });
  });

  it('MAC đúng nhưng đơn đã PAID → không xử lý lại (idempotent)', async () => {
    // Guard atomic where:{paymentStatus:'UNPAID'} không khớp đơn đã PAID → updateMany VẪN được
    // gọi (code không tự kiểm tra paymentStatus trước, để DB làm trọng tài) nhưng count:0 →
    // không notify. Mock phải mô phỏng đúng hành vi WHERE-không-khớp của Postgres thật.
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue({ ...order, paymentStatus: 'PAID' }), update: jest.fn(), updateMany },
      // Đơn tạo TRƯỚC bản vá PaymentAttempt: không có dòng attempt nào → fallback paymentTxnId.
      paymentAttempt: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const notify = jest.fn();
    const svc = new ZalopayService(prisma, { notify } as unknown as NotificationsService, makeConfig(true) as never);
    const raw = JSON.stringify({ app_trans_id: '250101_TUBU1' });
    const r = await svc.handleCallback(raw, sign(raw));
    expect(r.return_code).toBe(1);
    expect(updateMany).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  // P1-3 (docs/2026-09-08-review-progress.md): callback thanh toán tới SAU khi đơn đã hủy/trả
  // trước đây vẫn bị lật PAID êm ru (chỉ check paymentStatus !== 'PAID', không check status) —
  // đơn đứng CANCELLED + PAID, không cơ chế nào tự phát hiện cần hoàn tiền thật cho khách.
  it('đơn ĐÃ HỦY nhận callback thanh toán trễ → KHÔNG lật PAID, không notify (vẫn trả return_code=1 cho ZaloPay biết đã nhận)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const notify = jest.fn();
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue({ ...order, status: 'CANCELLED' }), update: jest.fn(), updateMany },
      // Đơn tạo TRƯỚC bản vá PaymentAttempt: không có dòng attempt nào → fallback paymentTxnId.
      paymentAttempt: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const svc = new ZalopayService(prisma, { notify } as unknown as NotificationsService, makeConfig(true) as never);
    const raw = JSON.stringify({ app_trans_id: '250101_TUBU1' });
    const r = await svc.handleCallback(raw, sign(raw));
    expect(r.return_code).toBe(1);
    expect(updateMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('đơn ĐÃ TRẢ HÀNG nhận callback thanh toán trễ → KHÔNG lật PAID', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue({ ...order, status: 'RETURNED' }), update: jest.fn(), updateMany },
      // Đơn tạo TRƯỚC bản vá PaymentAttempt: không có dòng attempt nào → fallback paymentTxnId.
      paymentAttempt: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const svc = new ZalopayService(prisma, { notify: jest.fn() } as unknown as NotificationsService, makeConfig(true) as never);
    const raw = JSON.stringify({ app_trans_id: '250101_TUBU1' });
    await svc.handleCallback(raw, sign(raw));
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('MAC đúng độ dài khác (timingSafeEqual không ném) → -1', async () => {
    const { svc, updateMany } = setup();
    const raw = JSON.stringify({ app_trans_id: 'x' });
    const r = await svc.handleCallback(raw, 'short'); // ngắn hơn hex digest → length khác
    expect(r.return_code).toBe(-1);
    expect(updateMany).not.toHaveBeenCalled();
  });
});


// P2 (docs/2026-09-08-review-progress.md): app_trans_id của ZaloPay có tiền tố NGÀY
// (yymmdd_<order code>) nên mỗi ngày bấm thanh toán lại sinh mã khác, mà trước đây chỉ có
// orders.paymentTxnId lưu mã MỚI NHẤT. Khách bấm hôm nay rồi bỏ dở, mai bấm lại, sau đó hoàn
// tất giao dịch của HÔM QUA → callback mang mã cũ, tra paymentTxnId không khớp đơn nào, handler
// im lặng trả success trong khi TIỀN ĐÃ THU và đơn vẫn UNPAID.
describe('ZalopayService — nhiều lần thử thanh toán (PaymentAttempt)', () => {
  const order = { id: 'o1', code: 'TUBU1', userId: 'u1', paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT', total: 250000 };

  function setup(attempt: unknown, orderRow: unknown = order) {
    // update() dùng bởi createPayment (paymentTxnId); updateMany() dùng bởi handleCallback.
    const update = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      order: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(orderRow), update, updateMany },
      paymentAttempt: {
        findUnique: jest.fn().mockResolvedValue(attempt),
        create: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;
    const notify = jest.fn().mockResolvedValue(undefined);
    const svc = new ZalopayService(prisma, { notify } as unknown as NotificationsService, makeConfig(true) as never);
    return { svc, update, updateMany, prisma, notify };
  }

  function callbackFor(appTransId: string, amount = 250000) {
    const raw = JSON.stringify({ app_trans_id: appTransId, amount });
    return { raw, mac: sign(raw) };
  }

  it('callback của lần thử CŨ (hôm qua) vẫn khớp đúng đơn qua PaymentAttempt', async () => {
    const { svc, updateMany } = setup({ appTransId: '260910_TUBU1', orderId: 'o1', amount: 250000, order });
    const { raw, mac } = callbackFor('260910_TUBU1');
    const r = await svc.handleCallback(raw, mac);
    expect(r.return_code).toBe(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paymentStatus: 'PAID' }) }));
  });

  it('số tiền callback KHÁC số tiền lúc tạo lệnh → KHÔNG lật PAID (chống sửa amount)', async () => {
    const { svc, updateMany } = setup({ appTransId: '260910_TUBU1', orderId: 'o1', amount: 250000, order });
    const { raw, mac } = callbackFor('260910_TUBU1', 1000);
    const r = await svc.handleCallback(raw, mac);
    expect(updateMany).not.toHaveBeenCalled();
    expect(r.return_code).toBe(1); // vẫn báo đã nhận để ZaloPay không retry vô hạn
  });

  it('không tìm thấy attempt → fallback tra theo orders.paymentTxnId (đơn tạo TRƯỚC bản vá)', async () => {
    const { svc, prisma, updateMany } = setup(null);
    (prisma.order.findFirst as jest.Mock).mockResolvedValue(order);
    const { raw, mac } = callbackFor('260910_TUBU1');
    await svc.handleCallback(raw, mac);
    expect(prisma.order.findFirst).toHaveBeenCalledWith({ where: { paymentTxnId: '260910_TUBU1' } });
    expect(updateMany).toHaveBeenCalled();
  });

  it('createPayment ghi lại từng lần thử vào PaymentAttempt', async () => {
    const { svc, prisma } = setup(null);
    axiosPost.mockResolvedValue({ data: { order_url: 'x' } });
    await svc.createPayment('u1', 'TUBU1');
    expect(prisma.paymentAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderId: 'o1', provider: 'ZALOPAY', amount: 250000 }) }),
    );
  });
});
