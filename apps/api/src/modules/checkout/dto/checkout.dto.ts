import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { PaymentMethod } from '@tubutree/shared-types';
import { IsIn } from 'class-validator';

export class InvoiceRequestDto {
  @IsString() taxCode!: string;
  @IsString() companyName!: string;
  @IsString() address!: string;
  @IsEmail() email!: string; // e-invoice gửi qua email → phải hợp lệ
}

export class QuoteDto {
  @IsString() addressId!: string;
  @IsOptional() @IsInt() @Min(0) pointsToUse?: number;
  /** Slug gian hàng — để tính giảm combo (nếu mua qua gian hàng). */
  @IsOptional() @IsString() storefrontSlug?: string;
  /** ID các dòng giỏ được CHỌN để thanh toán. Rỗng/thiếu = toàn giỏ (tương thích ngược). */
  // Giới hạn để 1 request không ép server duyệt mảng vô hạn (giỏ thật tối đa vài chục dòng).
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) itemIds?: string[];
}

/**
 * Xem trước mức giảm từng mã trong ví: cùng tham số với báo giá để ra đúng số checkout trừ. Thiếu `addressId` (trang giỏ) thì
 * không tính phí giao nên mã freeship không có số tiền miễn.
 */
export class CouponPreviewDto {
  @IsOptional() @IsString() addressId?: string;
  @IsOptional() @IsString() storefrontSlug?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) itemIds?: string[];
}

/**
 * Phương thức thanh toán CÓ settlement path thật ở checkout. `PaymentMethod` (shared-types)
 * còn liệt kê VNPAY cho tương thích dữ liệu cũ/enum Prisma, nhưng KHÔNG có service/controller/
 * webhook nào xử lý nó — nhận đơn VNPAY vẫn trừ kho + đứng PENDING_PAYMENT vĩnh viễn (không
 * cron nào hết hạn đơn PENDING_PAYMENT), nên lặp đặt đơn VNPAY là cách rẻ tiền khóa chết tồn
 * kho (P1-2, docs/2026-09-08-review-progress.md). Chỉ nới danh sách này khi đã nối cổng thật.
 */
// PD-3 (Q-03): XU bỏ khỏi danh sách (TubuXu gộp vào Điểm Xanh, tiêu qua pointsToUse). Enum vẫn giữ XU
// cho đơn cũ.
const CHECKOUT_PAYMENT_METHODS = ['COD', 'BANK_TRANSFER', 'WALLET', 'ZALOPAY'] as const;

export class PlaceOrderDto {
  @IsString() addressId!: string;

  @IsIn(CHECKOUT_PAYMENT_METHODS)
  paymentMethod!: PaymentMethod;

  @IsOptional() @IsInt() @Min(0) pointsToUse?: number;

  /**
   * FE báo khách đã thấy đơn 0đ và đã ẩn chọn phương thức (gửi COD thay khách). Nếu lúc đặt tổng > 0
   * (lô điểm vừa bị tiêu bớt) thì BE từ chối thay vì tạo đơn COD có tiền phải trả mà khách không chọn.
   */
  @IsOptional() @IsBoolean() quotedZeroTotal?: boolean;

  /**
   * Tổng tiền khách đang thấy trên màn thanh toán (từ báo giá). Lúc đặt mà tổng tính lại CAO HƠN số này
   * (giá đồng bộ Pancake/phí giao vừa đổi) thì BE trả TOTAL_CHANGED thay vì âm thầm thu số mới. Client cũ
   * không gửi thì giữ hành vi cũ.
   */
  @IsOptional() @IsInt() @Min(0) expectedTotal?: number;

  @IsOptional() @IsString() @MaxLength(500) note?: string;

  /** Mã giới thiệu CTV (nếu mua qua link chia sẻ). */
  @IsOptional() @IsString() referralCode?: string;

  /** Slug gian hàng CTV (attribution — lưu vào Order.storefrontSlug). */
  @IsOptional() @IsString() storefrontSlug?: string;

  /** ID các dòng giỏ được CHỌN để thanh toán. Rỗng/thiếu = toàn giỏ (tương thích ngược). */
  // Giới hạn để 1 request không ép server duyệt mảng vô hạn (giỏ thật tối đa vài chục dòng).
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) itemIds?: string[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => InvoiceRequestDto)
  invoiceRequest?: InvoiceRequestDto;

  /** Yêu cầu thu kèm rác (PICKUP, OPEN, chưa gắn đơn) của chính khách; server khoá và gắn vào kiện Tubu (§12.2). */
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64) wasteRequestId?: string;
}
