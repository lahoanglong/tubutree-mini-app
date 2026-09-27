import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  return { order: { findUnique: jest.fn().mockResolvedValue(order) } } as unknown as PrismaService;
}

const ORDER = { id: 'o1', code: 'TUBU250625001', userId: 'u1', total: 250000, paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' };

describe('BankTransferService.getBankQr', () => {
  it('đơn không tồn tại / không thuộc user → NotFound', async () => {
    await expect(new BankTransferService(makePrisma(null), makeConfig()).getBankQr('x', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(new BankTransferService(makePrisma(ORDER), makeConfig()).getBankQr('TUBU250625001', 'kẻ-khác')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('đơn không phải chuyển khoản → BadRequest', async () => {
    const prisma = makePrisma({ ...ORDER, paymentMethod: 'COD' });
    await expect(new BankTransferService(prisma, makeConfig()).getBankQr('TUBU250625001', 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('chưa cấu hình TK ngân hàng → BadRequest', async () => {
    const prisma = makePrisma(ORDER);
    await expect(new BankTransferService(prisma, makeConfig({ 'payment.bank_account_no': '' })).getBankQr('TUBU250625001', 'u1')).rejects.toBeInstanceOf(BadRequestException);
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
