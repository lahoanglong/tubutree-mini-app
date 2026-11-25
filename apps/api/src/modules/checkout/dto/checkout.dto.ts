import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PaymentMethod } from '@tubutree/shared-types';
import { IsIn } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { splitIds } from '../../cart/dto/cart.dto';

/** MST doanh nghiệp 10 số (chi nhánh thêm -3 số); từ 01/07/2025 cá nhân và hộ kinh doanh dùng số CCCD 12 số làm MST. */
export const TAX_CODE_RE = /^(\d{10}(-\d{3})?|\d{12})$/;

export class InvoiceRequestDto {
  @Trim() @IsString() @Matches(TAX_CODE_RE, { message: 'Mã số thuế gồm 10 số (chi nhánh thêm -3 số) hoặc 12 số.' }) taxCode!: string;
  @Trim() @IsString() @MaxLength(255) companyName!: string;
  @Trim() @IsString() @MaxLength(500) address!: string;
  @Trim() @IsEmail() @MaxLength(254) email!: string; // e-invoice gửi qua email → phải hợp lệ
}

/** Một dòng món rác khách chọn ngay trên thanh toán (đơn vị theo món: thùng, túi, vỏ...). */
export class InlinePickupLineDto {
  @IsString() @IsNotEmpty() @MaxLength(64) itemId!: string;
  @IsInt() @Min(1) @Max(100_000) qty!: number;
}

/** Cân nặng gói rác gửi lại: sàn 0,5 kg (Gomdon tính tối thiểu) và trần 10 kg một kiện; trần theo kiện mua do máy chủ tính. */
export const RETURN_WEIGHT_MIN_GRAMS = 500;
export const RETURN_WEIGHT_MAX_GRAMS = 10_000;
const RETURN_WEIGHT_MESSAGE = 'Cân nặng gói rác gửi lại phải là số gram nguyên từ 500 tới 10000.';

export class InlinePickupDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => InlinePickupLineDto) lines!: InlinePickupLineDto[];
  @IsOptional()
  @IsInt({ message: RETURN_WEIGHT_MESSAGE })
  @Min(RETURN_WEIGHT_MIN_GRAMS, { message: RETURN_WEIGHT_MESSAGE })
  @Max(RETURN_WEIGHT_MAX_GRAMS, { message: RETURN_WEIGHT_MESSAGE })
  returnWeightGrams?: number;
}

/**
 * Trường thu rác kèm đơn dùng chung báo giá và đặt đơn. `wasteRequestId` và `inlinePickup` loại trừ nhau (service trả 400 khi gửi cả hai,
 * để câu báo nêu đúng việc cần làm). Không gửi trường nào thì hành vi như bản app cũ.
 */
export abstract class CheckoutPickupFieldsDto {
  /** Yêu cầu thu kèm rác (PICKUP, OPEN, chưa gắn đơn) của chính khách; server khoá và gắn vào kiện Tubu (§12.2). */
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64) wasteRequestId?: string;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => InlinePickupDto) inlinePickup?: InlinePickupDto;

  @IsOptional()
  @IsInt({ message: RETURN_WEIGHT_MESSAGE })
  @Min(RETURN_WEIGHT_MIN_GRAMS, { message: RETURN_WEIGHT_MESSAGE })
  @Max(RETURN_WEIGHT_MAX_GRAMS, { message: RETURN_WEIGHT_MESSAGE })
  returnWeightGrams?: number;

  /** Quà hiện vật khách bỏ ra khỏi đơn này; quà đó ở lại ví cho đơn sau. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(64, { each: true }) excludeGiftRedemptionIds?: string[];
}

export class QuoteDto extends CheckoutPickupFieldsDto {
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

export class PlaceOrderDto extends CheckoutPickupFieldsDto {
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

  @IsOptional() @Trim() @IsString() @MaxLength(500) note?: string;

  /**
   * Quà tặng dùng thử 0đ khách thấy ở màn thanh toán (id biến thể quà), hoặc `null` = khách không nhận quà. Thiếu trường (app cũ) thì máy chủ
   * theo lựa chọn ở giỏ. Quà gửi lên không còn mở với phần hàng đang đặt thì 409 GIFT_TRIAL_CHANGED, hết kho thì 409 GIFT_TRIAL_UNAVAILABLE.
   */
  @IsOptional() @IsString() @MaxLength(64) giftVariationId?: string | null;

  /** Mã giới thiệu CTV (nếu mua qua link chia sẻ). */
  @IsOptional() @Trim() @IsString() referralCode?: string;

  /** Slug gian hàng CTV (attribution — lưu vào Order.storefrontSlug). */
  @IsOptional() @IsString() storefrontSlug?: string;

  /**
   * Mã link CTV (`?l=` của link sâu) khách mở trước khi đặt. Sai khuôn, không có thật hay của CTV khác người giới thiệu thì máy chủ bỏ qua
   * (đơn vẫn đặt), không trả 400: dữ liệu ghi công lỗi không được chặn khách mua.
   */
  @IsOptional() @Trim() @IsString() @MaxLength(64) affiliateLinkCode?: string;

  /** ID các dòng giỏ được CHỌN để thanh toán. Rỗng/thiếu = toàn giỏ (tương thích ngược). */
  // Giới hạn để 1 request không ép server duyệt mảng vô hạn (giỏ thật tối đa vài chục dòng).
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) itemIds?: string[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => InvoiceRequestDto)
  invoiceRequest?: InvoiceRequestDto;

  /**
   * Ô "nhận tin xác nhận hành trình đơn qua Zalo" ở bước đặt hàng (hợp đồng tubu-mss-order-events mục 7). true/false được nhớ cho
   * khách; bỏ trống (client cũ) thì dùng lựa chọn đã nhớ. Chỉ có tác dụng khi cờ `mss.order_events_enabled` bật.
   */
  @IsOptional() @IsBoolean() orderZaloConsent?: boolean;

  /**
   * PO A1: số nhận hàng khác số người mua, khách bật "gửi thêm thông báo giao hàng (không kèm giá) cho số người nhận". Chỉ ghi lên đơn khi
   * cùng lần đặt có `orderZaloConsent === true`; bộ ghi sự kiện còn xét cờ `mss.order_recipient_enabled` và số lúc từng sự kiện.
   */
  @IsOptional() @IsBoolean() notifyRecipientZalo?: boolean;
}

/** `GET /checkout/pickup-options?addressId=&itemIds=a,b`: cùng địa chỉ và phần giỏ đang thanh toán như báo giá. */
export class PickupOptionsQueryDto {
  @IsString() addressId!: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => splitIds(value))
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  itemIds?: string[];
}
