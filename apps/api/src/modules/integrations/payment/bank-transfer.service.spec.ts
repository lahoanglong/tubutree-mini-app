import { BadRequestException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { BankTransferService } from './bank-transfer.service';
import { crc16ccitt } from './vietqr';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';

function makeConfig(o: Record<string, unknown> = {}): SystemConfigService {
  const def: Record<string, unknown> = {
    'payment.bank_bin': '970407',
    'payment.bank_account_no': '9984606774',
    'payment.bank_account_name': 'CONG TY TUBU TREE',
    'payment.bank_name': 'Techcombank',
  };
  const v = { ...def, ...o };
  return { get: async <T>(k: string, fb?: T): Promise<T> => (k in v ? (v[k] as T) : (fb as T)) } as unknown as SystemConfigService;
}

function makePrisma(order: unknown) {
  return {
    order: { findUnique: jest.fn().mockResolvedValue(order) },
    dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;
}

const ORDER = { id: 'o1', code: 'TUBU250625001', userId: 'u1', type: 'RETAIL', total: 250000, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' };

describe('BankTransferService.getBankQr', () => {
  it('đơn không tồn tại / không thuộc user → NotFound', async () => {
    await expect(new BankTransferService(makePrisma(null), makeConfig()).getBankQr('x', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(new BankTransferService(makePrisma(ORDER), makeConfig()).getBankQr('TUBU250625001', 'kẻ-khác')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('đơn không phải chuyển khoản → BadRequest', async () => {
    const prisma = makePrisma({ ...ORDER, paymentMethod: 'COD' });
    await expect(new BankTransferService(prisma, makeConfig()).getBankQr('TUBU250625001', 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('đơn đại lý ghi công nợ → 400, không sinh QR; đơn đại lý trả trước vẫn có QR', async () => {
    const debtOrder = { ...ORDER, type: 'DEALER', status: 'CONFIRMED' };
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(debtOrder) },
      dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue({ id: 'l1' }) },
    } as unknown as PrismaService;
    await expect(new BankTransferService(prisma, makeConfig()).getBankQr('TUBU250625001', 'u1')).rejects.toThrow('Đơn ghi công nợ trả qua sổ công nợ.');
    (prisma as unknown as { dealerCreditLedger: { findFirst: jest.Mock } }).dealerCreditLedger.findFirst.mockResolvedValue(null);
    const r = await new BankTransferService(prisma, makeConfig()).getBankQr('TUBU250625001', 'u1');
    expect(r.amount).toBe(250000);
  });

  it('chưa cấu hình TK ngân hàng → 503 (thử lại được), không phải 400', async () => {
    const prisma = makePrisma(ORDER);
    const svc = new BankTransferService(prisma, makeConfig({ 'payment.bank_account_no': '' }));
    const err = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const rejected = await svc.getBankQr('TUBU250625001', 'u1').catch((e: unknown) => e);
      expect(rejected).toBeInstanceOf(ServiceUnavailableException);
      expect((rejected as Error).message).toBe('Chưa tạo được mã chuyển khoản lúc này. Bạn thử lại sau ít phút nhé.');
      expect(err).toHaveBeenCalledWith(expect.stringContaining('payment.bank_account_no'));
      expect(err).toHaveBeenCalledWith(expect.not.stringContaining('payment.bank_bin'));
    } finally {
      err.mockRestore();
    }
  });

  it('chưa cấu hình TK ngân hàng mà đơn đã PAID → vẫn trả paymentStatus=PAID, không QR, để màn đang dò thấy tiền về', async () => {
    const svc = new BankTransferService(makePrisma({ ...ORDER, paymentStatus: 'PAID' }), makeConfig({ 'payment.bank_account_no': '' }));
    const r = await svc.getBankQr('TUBU250625001', 'u1');
    expect(r.paymentStatus).toBe('PAID');
    expect(r.qrString).toBe('');
    expect(r.qrImageUrl).toBe('');
  });

  it('hợp lệ → trả VietQR hợp lệ, memo = mã đơn, amount = total', async () => {
    const r = await new BankTransferService(makePrisma(ORDER), makeConfig()).getBankQr('TUBU250625001', 'u1');
    expect(r.amount).toBe(250000);
    expect(r.memo).toBe('TUBU250625001');
    expect(r.paymentStatus).toBe('UNPAID');
    expect(r.bank).toMatchObject({ bin: '970407', accountNo: '9984606774', name: 'Techcombank' });
    // qrString là VietQR hợp lệ (CRC tự kiểm chứng) + chứa mã đơn + số tiền
    expect(crc16ccitt(r.qrString.slice(0, -4))).toBe(r.qrString.slice(-4));
    expect(r.qrString).toContain('TUBU250625001');
    expect(r.qrString).toContain('540625000'); // 54 len6 250000
    expect(r.qrImageUrl).toContain('img.vietqr.io');
  });

  it('codSwitchable: đơn chuyển khoản chưa trả, chưa mở lệnh thanh toán, trong trần thu hộ của người xem', async () => {
    const pending = { ...ORDER, status: 'PENDING_PAYMENT', createdAt: new Date(), fulfiller: 'TUBU', placedForCustomer: false, autoCancelBlockedAt: null, paymentUnlinkedAt: null, paymentUnlinkedFirstAt: null, pancakePaidReported: null };
    const prismaWith = (order: unknown, attempts: number) =>
      ({ ...makePrisma(order), paymentAttempt: { count: jest.fn().mockResolvedValue(attempts) } }) as unknown as PrismaService;
    const qr = (order: unknown, attempts = 0, codMax?: number) => new BankTransferService(prismaWith(order, attempts), makeConfig()).getBankQr('TUBU250625001', 'u1', { codMax });
    expect((await qr(pending)).codSwitchable).toBe(true);
    expect((await qr(pending, 1)).codSwitchable).toBe(false);
    expect((await qr(pending, 0, 200_000)).codSwitchable).toBe(false);
    expect((await qr({ ...pending, paymentStatus: 'PAID', status: 'CONFIRMED' })).codSwitchable).toBe(false);
    expect((await qr({ ...pending, pancakePaidReported: 100_000 })).codSwitchable).toBe(false);
  });

  // U1-B04: khách chuyển thiếu 100k/199k rồi quét lại QR cũ chuyển đủ 199k → Pancake cộng dồn 299k → khoản chuyển dư.
  it('đơn đã nhận một phần → amount, trường 54 của VietQR và ảnh QR đều là phần còn thiếu, kèm paidSoFar', async () => {
    const order = { ...ORDER, total: 199000, pancakePaidReported: 100000 };
    const r = await new BankTransferService(makePrisma(order), makeConfig()).getBankQr('TUBU250625001', 'u1');
    expect(r.amount).toBe(99000);
    expect(r.paidSoFar).toBe(100000);
    expect(r.qrString).toContain('540599000'); // 54 len5 99000
    expect(r.qrString).not.toContain('5406199000');
    expect(crc16ccitt(r.qrString.slice(0, -4))).toBe(r.qrString.slice(-4));
    expect(r.qrImageUrl).toContain('amount=99000&');
    expect(r.memo).toBe('TUBU250625001');
    expect(r.qrString).toContain('TUBU250625001');
  });

  it('đơn chưa nhận đồng nào → paidSoFar 0, amount = total', async () => {
    const r = await new BankTransferService(makePrisma({ ...ORDER, pancakePaidReported: null }), makeConfig()).getBankQr('TUBU250625001', 'u1');
    expect(r.paidSoFar).toBe(0);
    expect(r.amount).toBe(250000);
  });

  it('số Pancake báo đã nhận vượt tổng đơn mà đơn còn UNPAID → amount không âm', async () => {
    const r = await new BankTransferService(makePrisma({ ...ORDER, pancakePaidReported: 300000 }), makeConfig()).getBankQr('TUBU250625001', 'u1');
    expect(r.amount).toBe(0);
    expect(r.paidSoFar).toBe(300000);
  });

  it('đơn đã PAID: số báo thiếu cũ không làm giảm amount của đơn', async () => {
    const r = await new BankTransferService(makePrisma({ ...ORDER, paymentStatus: 'PAID', pancakePaidReported: 100000 }), makeConfig()).getBankQr('TUBU250625001', 'u1');
    expect(r.amount).toBe(250000);
    expect(r.paidSoFar).toBe(0);
  });

  it('trả giờ máy chủ để app bù lệch đồng hồ điện thoại khi tính hạn chuyển khoản', async () => {
    const before = Date.now();
    const r = await new BankTransferService(makePrisma(ORDER), makeConfig()).getBankQr('TUBU250625001', 'u1');
    const ms = Date.parse(r.serverNow);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(Date.now());
  });

  it('đơn đã thanh toán → vẫn trả nhưng paymentStatus=PAID (FE ẩn QR)', async () => {
    const r = await new BankTransferService(makePrisma({ ...ORDER, paymentStatus: 'PAID' }), makeConfig()).getBankQr('TUBU250625001', 'u1');
    expect(r.paymentStatus).toBe('PAID');
  });

  // P1-3 (docs/2026-09-08-review-progress.md): trước đây KHÔNG kiểm status — đơn đã hủy vẫn
  // sinh QR chuyển khoản sống, khách lỡ quét (tab cũ/ảnh chụp màn hình lưu trước khi hủy) là
  // tiền thật vào TK shop cho một đơn không còn tồn tại về mặt nghiệp vụ, không ai tự động
  // hoàn lại.
  it('đơn ĐÃ HỦY → BadRequest, không sinh QR sống cho đơn không còn hiệu lực', async () => {
    const prisma = makePrisma({ ...ORDER, status: 'CANCELLED' });
    await expect(new BankTransferService(prisma, makeConfig()).getBankQr('TUBU250625001', 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('đơn ĐÃ TRẢ HÀNG → BadRequest, không sinh QR sống', async () => {
    const prisma = makePrisma({ ...ORDER, status: 'RETURNED' });
    await expect(new BankTransferService(prisma, makeConfig()).getBankQr('TUBU250625001', 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // A2-01 = A5-02 = A6-03 (docs/audit-2026-09): TRƯỚC ĐÂY đơn có storefrontSlug ưu tiên dùng
  // bankBin/bankAccountNo do CHÍNH gian hàng (CTV) tự khai trong storefront-builder.tsx — tiền
  // khách chuyển khoản chảy thẳng vào TK CÁ NHÂN của CTV thay vì Tubu, và đối soát Pancake (chỉ
  // chạy trên TK Tubu) không bao giờ khớp nên đơn kẹt "Chờ thanh toán" dù khách đã trả tiền.
  // Từ nay: MỌI đơn BANK_TRANSFER luôn dùng đúng TK Tubu cấu hình (payment.bank_*), bất kể
  // storefrontSlug trỏ tới gian hàng loại gì (CTV/MERCHANT/BRAND) hay gian hàng đó có tự khai TK
  // ngân hàng hay không — không có loại gian hàng nào hiện có quy trình đối soát/xác nhận thanh
  // toán trực tiếp nào hoạt động thật (đã rà checkout.service.ts, pancake-order.service.ts, các
  // luồng đơn admin). CTV/đối tác được trả hoa hồng riêng qua hệ thống payout (affiliate/dealer),
  // không bao giờ thu tiền khách trực tiếp qua QR này.
  it('đơn gắn gian hàng CTV (storefront.type=CTV, ownerUserId set) dù TỰ KHAI đủ TK ngân hàng → VẪN dùng TK Tubu, KHÔNG dùng TK CTV', async () => {
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          ...ORDER,
          storefrontSlug: 'ctv-hoa',
        }),
      },
      storefront: {
        findFirst: jest.fn().mockResolvedValue({
          type: 'CTV',
          ownerUserId: 'ctv-user-1',
          brandId: null,
          bankBin: '970436',
          bankAccountNo: '001122334455',
          bankAccountName: 'NGUYEN VAN A',
          bankName: 'Vietcombank',
        }),
      },
    } as unknown as PrismaService;

    const r = await new BankTransferService(prisma, makeConfig()).getBankQr('TUBU250625001', 'u1');
    expect(r.bank).toMatchObject({
      bin: '970407',
      accountNo: '9984606774',
      name: 'Techcombank',
      accountName: 'CONG TY TUBU TREE',
    });
    expect(r.qrString).toContain('9984606774');
    expect(r.qrString).not.toContain('001122334455');
  });

  it('đơn gắn gian hàng MERCHANT tự đăng ký (storefront.type=MERCHANT, ownerUserId set) có TK ngân hàng → VẪN dùng TK Tubu (chưa có cờ đối tác đã ký hợp đồng + đối soát riêng)', async () => {
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          ...ORDER,
          storefrontSlug: 'dealer-shop',
        }),
      },
      storefront: {
        findFirst: jest.fn().mockResolvedValue({
          type: 'MERCHANT',
          ownerUserId: 'dealer-user-1',
          brandId: null,
          bankBin: '970418',
          bankAccountNo: '999888777',
          bankAccountName: 'TRAN VAN B',
          bankName: 'BIDV',
        }),
      },
    } as unknown as PrismaService;

    const r = await new BankTransferService(prisma, makeConfig()).getBankQr('TUBU250625001', 'u1');
    expect(r.bank).toMatchObject({ bin: '970407', accountNo: '9984606774' });
    expect(r.qrString).not.toContain('999888777');
  });

  it('đơn gắn gian hàng BRAND (storefront.type=BRAND, brandId set) có TK ngân hàng → VẪN dùng TK Tubu (brand không có quy trình đối soát thanh toán trực tiếp nào hoạt động)', async () => {
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          ...ORDER,
          storefrontSlug: 'thuong-hieu-xyz',
        }),
      },
      storefront: {
        findFirst: jest.fn().mockResolvedValue({
          type: 'BRAND',
          ownerUserId: null,
          brandId: 'brand-1',
          bankBin: '970422',
          bankAccountNo: '555666777',
          bankAccountName: 'CONG TY XYZ',
          bankName: 'MB Bank',
        }),
      },
    } as unknown as PrismaService;

    const r = await new BankTransferService(prisma, makeConfig()).getBankQr('TUBU250625001', 'u1');
    expect(r.bank).toMatchObject({ bin: '970407', accountNo: '9984606774' });
    expect(r.qrString).not.toContain('555666777');
  });

  it('đơn không gắn storefrontSlug nào → dùng TK Tubu như bình thường (không đổi hành vi)', async () => {
    const prisma = makePrisma({ ...ORDER, storefrontSlug: null });
    const r = await new BankTransferService(prisma, makeConfig()).getBankQr('TUBU250625001', 'u1');
    expect(r.bank).toMatchObject({ bin: '970407', accountNo: '9984606774' });
  });
});

describe('BankTransferService.getBankQr — hạn thanh toán (BUYERMINI-8)', () => {
  const created = new Date('2026-10-13T03:00:00Z');

  it('đơn chờ chuyển khoản → paymentDeadline = lúc đặt + orders.pending_payment_ttl_hours', async () => {
    const r = await new BankTransferService(
      makePrisma({ ...ORDER, status: 'PENDING_PAYMENT', createdAt: created }),
      makeConfig({ 'orders.pending_payment_ttl_hours': 12 }),
    ).getBankQr('TUBU250625001', 'u1');
    expect(r.paymentDeadline).toBe('2026-10-13T15:00:00.000Z');
  });

  it('hệ thống đã thôi tự huỷ vì hàng đã bàn giao vận chuyển → vẫn có QR nhưng không còn hạn "quá hạn đơn sẽ tự huỷ" (R5-SYNC-1)', async () => {
    const r = await new BankTransferService(
      makePrisma({ ...ORDER, status: 'PENDING_PAYMENT', createdAt: created, autoCancelBlockedAt: new Date('2026-10-14T03:30:00Z') }),
      makeConfig(),
    ).getBankQr('TUBU250625001', 'u1');
    expect(r.paymentDeadline).toBeNull();
    expect(r.qrString).toContain('TUBU250625001');
  });

  it('đơn đại lý trả trước → hạn theo TTL đơn đại lý, đúng mốc cron tự huỷ', async () => {
    const r = await new BankTransferService(
      makePrisma({ ...ORDER, type: 'DEALER', status: 'PENDING_PAYMENT', createdAt: created }),
      makeConfig({ 'orders.pending_payment_ttl_hours': 12, 'orders.dealer_pending_payment_ttl_hours': 48 }),
    ).getBankQr('TUBU250625001', 'u1');
    expect(r.paymentDeadline).toBe('2026-10-15T03:00:00.000Z');
  });

  it('đơn đã trả hoặc đã xác nhận → không có hạn', async () => {
    const paid = await new BankTransferService(
      makePrisma({ ...ORDER, status: 'CONFIRMED', paymentStatus: 'PAID', createdAt: created }),
      makeConfig(),
    ).getBankQr('TUBU250625001', 'u1');
    expect(paid.paymentDeadline).toBeNull();
  });
});


describe('BankTransferService.getTransferPreview (cờ checkout.transfer_preview_enabled)', () => {
  const ON = { 'checkout.transfer_preview_enabled': true };

  it('cờ tắt (mặc định) → enabled false, không đọc ra thông tin ngân hàng nào', async () => {
    const r = await new BankTransferService(makePrisma(null), makeConfig()).getTransferPreview();
    expect(r).toEqual({ enabled: false, bank: null });
    const off = await new BankTransferService(makePrisma(null), makeConfig({ 'checkout.transfer_preview_enabled': 'true' })).getTransferPreview();
    expect(off).toEqual({ enabled: false, bank: null });
  });

  it('cờ bật → chỉ tên ngân hàng và tên chủ tài khoản; không số tài khoản, BIN, chuỗi QR hay ảnh QR', async () => {
    const r = await new BankTransferService(makePrisma(null), makeConfig(ON)).getTransferPreview();
    expect(r).toEqual({ enabled: true, bank: { name: 'Techcombank', accountName: 'CONG TY TUBU TREE' } });
    const json = JSON.stringify(r);
    expect(json).not.toContain('9984606774');
    expect(json).not.toContain('970407');
    expect(Object.keys(r.bank ?? {}).sort()).toEqual(['accountName', 'name']);
  });

  it.each([
    ['payment.bank_bin', ''],
    ['payment.bank_account_no', ''],
    ['payment.bank_account_name', '  '],
    ['payment.bank_name', ''],
  ])('thiếu %s → bank null để app ẩn thẻ (không hứa mã QR không tạo được)', async (key, value) => {
    const r = await new BankTransferService(makePrisma(null), makeConfig({ ...ON, [key]: value })).getTransferPreview();
    expect(r).toEqual({ enabled: true, bank: null });
  });

  it('cờ bật hay tắt thì câu trả lời của GET /payments/bank-qr/:code giữ đúng một bộ khoá', async () => {
    const keys = async (o: Record<string, unknown>) =>
      Object.keys(await new BankTransferService(makePrisma(ORDER), makeConfig(o)).getBankQr('TUBU250625001', 'u1')).sort();
    const expected = ['amount', 'bank', 'codSwitchable', 'memo', 'orderCode', 'paidSoFar', 'paymentDeadline', 'paymentStatus', 'qrImageUrl', 'qrString', 'serverNow', 'zaloFriendCard'];
    expect(await keys({})).toEqual(expected);
    expect(await keys(ON)).toEqual(expected);
  });
});

describe('BankTransferService.getBankQr — thẻ kết bạn Zalo (zaloFriendCard, w39-02)', () => {
  const ON = { enabled: true, open: true, rolloutPct: 100 };
  const PENDING = { ...ORDER, status: 'PENDING_PAYMENT', orderZaloConsent: true, createdAt: new Date(), pancakePaidReported: null };
  const mss = (gate: unknown) => ({ gate: () => gate }) as never;
  const withOutbox = (order: unknown, friendRow: { id: string } | null = null) => {
    const findFirst = jest.fn().mockResolvedValue(friendRow);
    const prisma = { ...makePrisma(order), paymentAttempt: { count: jest.fn().mockResolvedValue(0) }, mssOrderEventOutbox: { findFirst } };
    return { prisma: prisma as unknown as PrismaService, findFirst };
  };

  it('dựng bằng hai đối số (không có MssModule): false, không đụng outbox', async () => {
    const { prisma, findFirst } = withOutbox(PENDING);
    const r = await new BankTransferService(prisma, makeConfig()).getBankQr('TUBU250625001', 'u1');
    expect(r.zaloFriendCard).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('khách đăng nhập (mặc định account): chưa có tin bạn bè trong 90 ngày → true; hỏi outbox theo chủ đơn', async () => {
    const { prisma, findFirst } = withOutbox(PENDING);
    const r = await new BankTransferService(prisma, makeConfig(), mss(ON)).getBankQr('TUBU250625001', 'u1');
    expect(r.zaloFriendCard).toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ order: { userId: 'u1' }, recipientRole: 'buyer', status: 'RESULT_SENT', resultReason: null });
  });

  it('khách vãng lai (friendScope order): hỏi outbox theo đơn này, không theo tài khoản', async () => {
    const { prisma, findFirst } = withOutbox(PENDING);
    const r = await new BankTransferService(prisma, makeConfig(), mss(ON)).getBankQr('TUBU250625001', 'u1', { codMax: 1_000_000, friendScope: 'order' });
    expect(r.zaloFriendCard).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({ where: { orderId: 'o1', recipientRole: 'buyer', status: 'RESULT_SENT', resultReason: null }, select: { id: true } });
  });

  it('đã có tin bạn bè → false', async () => {
    const { prisma } = withOutbox(PENDING, { id: 'r1' });
    expect((await new BankTransferService(prisma, makeConfig(), mss(ON)).getBankQr('TUBU250625001', 'u1')).zaloFriendCard).toBe(false);
  });

  it('đơn vừa nhận tiền (CONFIRMED, PAID) vẫn mời: màn "Đã nhận thanh toán" cũng có thẻ', async () => {
    const { prisma } = withOutbox({ ...PENDING, status: 'CONFIRMED', paymentStatus: 'PAID' });
    expect((await new BankTransferService(prisma, makeConfig(), mss(ON)).getBankQr('TUBU250625001', 'u1')).zaloFriendCard).toBe(true);
  });

  it.each<[string, unknown, Record<string, unknown>]>([
    ['cổng đóng', { ...ON, open: false }, {}],
    ['khách không đồng ý', ON, { orderZaloConsent: false }],
    ['chưa hỏi đồng ý', ON, { orderZaloConsent: null }],
  ])('%s → false, không truy vấn outbox', async (_n, gate, over) => {
    const { prisma, findFirst } = withOutbox({ ...PENDING, ...over });
    expect((await new BankTransferService(prisma, makeConfig(), mss(gate)).getBankQr('TUBU250625001', 'u1')).zaloFriendCard).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
