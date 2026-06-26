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
});
