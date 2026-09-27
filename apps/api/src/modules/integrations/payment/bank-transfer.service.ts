import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
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
    // P1-3 (docs/2026-09-08-review-progress.md): trước đây không kiểm status — đơn đã hủy/trả
    // vẫn sinh QR sống trỏ về TK ngân hàng thật. Khách lỡ quét (tab cũ, ảnh chụp màn hình lưu
    // trước khi hủy) là tiền thật vào TK shop cho một đơn không còn tồn tại về nghiệp vụ, và
    // không có cơ chế tự động hoàn lại khoản đó.
    if (order.status === 'CANCELLED' || order.status === 'RETURNED') {
      throw new BadRequestException('Đơn đã hủy/trả, không thể thanh toán.');
    }

    // A2-01 = A5-02 = A6-03 (docs/audit-2026-09/00-MASTER-SUMMARY.md + 02/05/06 chi tiết): TRƯỚC
    // ĐÂY, đơn có `storefrontSlug` (gắn gian hàng CTV/đối tác) ưu tiên dùng bankBin/bankAccountNo
    // mà CHÍNH gian hàng đó tự khai trong trình dựng gian hàng (storefront-builder.tsx) — tiền
    // khách chuyển khoản chảy thẳng vào TK CÁ NHÂN của CTV/đối tác thay vì Tubu. Đối soát Pancake
    // chỉ chạy trên TK Tubu nên đơn không bao giờ lên PAID dù khách đã trả tiền thật.
    //
    // Đã rà checkout.service.ts, pancake-order.service.ts và các luồng đơn ở admin: KHÔNG có loại
    // gian hàng nào (CTV, MERCHANT tự đăng ký qua /merchant, hay BRAND) hiện có một quy trình đối
    // soát/xác nhận-đã-thanh-toán nào hoạt động thật cho đơn BANK_TRANSFER gắn storefrontSlug. Vì
    // vậy: MỌI đơn chuyển khoản luôn dùng đúng MỘT tài khoản do Tubu cấu hình (payment.bank_*),
    // bất kể order.storefrontSlug trỏ tới gian hàng nào hay gian hàng đó có tự khai TK ngân hàng
    // hay không. CTV/đối tác được trả hoa hồng riêng qua hệ thống payout (affiliate/dealer) —
    // không bao giờ được thu tiền khách trực tiếp qua QR này.
    //
    // (Nếu sau này có mô hình đối tác tự thu tiền có hợp đồng + đối soát riêng, đó là một hệ
    // thống mới cần thiết kế/xây riêng — nằm ngoài phạm vi bản vá khẩn cấp này.)
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
