import { BadRequestException } from '@nestjs/common';
import { formatVnd } from '../orders/refund-destination';

/** Mã % từ mức này trở lên bắt buộc có Giảm tối đa: 100% không trần là gõ nhầm hoặc mã lộ ra là mất cả đơn. */
export const COUPON_PERCENT_NEEDS_CAP = 50;

/** Luật tiền và ngày chung cho mọi mã admin tạo (từng mã ở tab Voucher, lô mã thẻ hộp hàng). */
export function assertCouponInput(data: {
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder?: number;
  maxDiscount?: number;
  startAt: Date;
  endAt: Date;
}): void {
  if (data.endAt <= data.startAt) throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu.');
  if (data.endAt <= new Date()) throw new BadRequestException('Ngày kết thúc đã qua — mã tạo ra sẽ không dùng được.');
  if (data.type !== 'FREESHIP' && data.value <= 0) throw new BadRequestException('Mức giảm phải lớn hơn 0.');
  if (data.type === 'PERCENT' && data.value >= COUPON_PERCENT_NEEDS_CAP && !data.maxDiscount) {
    throw new BadRequestException(`Mã giảm từ ${COUPON_PERCENT_NEEDS_CAP}% phải đặt Giảm tối đa (đ) để một đơn lớn không được giảm gần hết.`);
  }
  if (data.type === 'AMOUNT' && data.minOrder && data.value >= data.minOrder) {
    throw new BadRequestException(
      `Mức giảm ${formatVnd(data.value)} phải nhỏ hơn đơn tối thiểu ${formatVnd(data.minOrder)} — không thì đơn ở mức tối thiểu được giảm hết tiền hàng. ` +
        'Kiểm tra lại số 0 của hai ô.',
    );
  }
}
