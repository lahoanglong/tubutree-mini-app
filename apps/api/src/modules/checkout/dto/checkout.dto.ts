import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsInt, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
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
  @IsOptional() @IsArray() @IsString({ each: true }) itemIds?: string[];
}

/**
 * Phương thức thanh toán CÓ settlement path thật ở checkout. `PaymentMethod` (shared-types)
 * còn liệt kê VNPAY cho tương thích dữ liệu cũ/enum Prisma, nhưng KHÔNG có service/controller/
 * webhook nào xử lý nó — nhận đơn VNPAY vẫn trừ kho + đứng PENDING_PAYMENT vĩnh viễn (không
 * cron nào hết hạn đơn PENDING_PAYMENT), nên lặp đặt đơn VNPAY là cách rẻ tiền khóa chết tồn
 * kho (P1-2, docs/2026-09-08-review-progress.md). Chỉ nới danh sách này khi đã nối cổng thật.
 */
const CHECKOUT_PAYMENT_METHODS = ['COD', 'BANK_TRANSFER', 'WALLET', 'XU', 'ZALOPAY'] as const;

export class PlaceOrderDto {
  @IsString() addressId!: string;

  @IsIn(CHECKOUT_PAYMENT_METHODS)
  paymentMethod!: PaymentMethod;

  @IsOptional() @IsInt() @Min(0) pointsToUse?: number;

  @IsOptional() @IsString() note?: string;

  /** Mã giới thiệu CTV (nếu mua qua link chia sẻ). */
  @IsOptional() @IsString() referralCode?: string;

  /** Slug gian hàng CTV (attribution — lưu vào Order.storefrontSlug). */
  @IsOptional() @IsString() storefrontSlug?: string;

  /** ID các dòng giỏ được CHỌN để thanh toán. Rỗng/thiếu = toàn giỏ (tương thích ngược). */
  @IsOptional() @IsArray() @IsString({ each: true }) itemIds?: string[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => InvoiceRequestDto)
  invoiceRequest?: InvoiceRequestDto;
}
