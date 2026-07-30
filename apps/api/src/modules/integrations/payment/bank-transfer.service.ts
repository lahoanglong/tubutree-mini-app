import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';
import { buildVietQrPayload } from './vietqr';

/**
 * Thanh toán chuyển khoản qua VietQR (Napas 247). Sinh QR phía server cho đơn BANK_TRANSFER:
 * nội dung CK = mã đơn để Pancake POS (đã liên kết TK ngân hàng) tự đối soát rồi bắn webhook
 * → processor lật đơn sang PAID. Không phụ thuộc API sinh QR của bên thứ ba.
 */
@Injectable()
export class BankTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async getBankQr(orderCode: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { code: orderCode } });
    // Không lộ đơn người khác: sai chủ sở hữu coi như không tìm thấy.
    if (!order || order.userId !== userId) throw new NotFoundException('Không tìm thấy đơn hàng.');
    if (order.paymentMethod !== 'BANK_TRANSFER') {
      throw new BadRequestException('Đơn này không thanh toán bằng chuyển khoản.');
    }

    const [bin, accountNo, accountName, bankName] = await Promise.all([
      this.config.get<string>('payment.bank_bin', ''),
      this.config.get<string>('payment.bank_account_no', ''),
      this.config.get<string>('payment.bank_account_name', ''),
      this.config.get<string>('payment.bank_name', ''),
    ]);
    if (!bin || !accountNo) {
      throw new BadRequestException('Chưa cấu hình tài khoản ngân hàng nhận chuyển khoản.');
    }

    const memo = order.code; // nội dung CK = mã đơn (để đối soát)
    const qrString = buildVietQrPayload({ bin, accountNo, amount: order.total, addInfo: memo });
    // Ảnh QR tiện hiển thị (FE có thể render qrString bằng lib QR nếu muốn tự chủ hoàn toàn).
    const qrImageUrl =
      `https://img.vietqr.io/image/${bin}-${accountNo}-compact2.png` +
      `?amount=${order.total}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(accountName)}`;

    return {
      orderCode: order.code,
      amount: order.total,
      paymentStatus: order.paymentStatus,
      bank: { bin, name: bankName, accountNo, accountName },
      memo,
      qrString,
      qrImageUrl,
    };
  }
}
