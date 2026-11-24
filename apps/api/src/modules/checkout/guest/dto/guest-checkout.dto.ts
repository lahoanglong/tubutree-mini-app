import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { NO_HTML } from '../../../users/dto/address.dto';
import { MAX_ITEM_QUANTITY } from '../../../cart/dto/cart.dto';
import { toLocalPhone } from '../../../../common/phone';

/** Số di động Việt Nam dạng 0xxxxxxxxx (đầu 03, 05, 07, 08, 09): web chuẩn hoá +84, dấu cách trước khi gửi. */
export const GUEST_MOBILE_RE = /^0[35789]\d{8}$/;
/** Khoá theo dõi đơn: 32 byte ngẫu nhiên (Web Crypto) mã base64url không đệm, 43 ký tự = 256 bit. */
export const GUEST_TRACKING_KEY_RE = /^[A-Za-z0-9_-]{43}$/;
/** deviceId của trình duyệt (header x-guest-device): cùng khuôn với GuestLoginDto của Mini App. */
export const GUEST_DEVICE_RE = /^[A-Za-z0-9_-]{16,128}$/;
export const GUEST_MAX_LINES = 50;

const NO_HTML_MSG = { message: 'Tên người nhận và địa chỉ không được chứa ký tự < hoặc >.' };
const MOBILE_MSG = { message: 'Số điện thoại di động chưa đúng (10 số, bắt đầu bằng 03, 05, 07, 08 hoặc 09).' };
const GEO_MSG = { message: 'Tỉnh/thành chưa theo địa giới mới, bạn chọn lại nhé.' };

export class GuestLineDto {
  @IsString() @MaxLength(64) @Matches(/^[A-Za-z0-9_-]+$/) variationId!: string;
  @IsInt() @Min(1) @Max(MAX_ITEM_QUANTITY) quantity!: number;
}

/** Cùng trường và trần với CreateAddressDto; SĐT người nhận là SĐT đặt hàng (một ô trên biểu mẫu). */
export class GuestAddressDto {
  @Trim() @IsString() @MaxLength(120) @Matches(NO_HTML, NO_HTML_MSG) recipient!: string;
  @Trim() @IsString() @Matches(GUEST_MOBILE_RE, MOBILE_MSG) phone!: string;
  @Trim() @IsString() @MaxLength(120) province!: string;
  @Trim() @IsString() @MaxLength(120) district!: string;
  @Trim() @IsString() @MaxLength(120) ward!: string;
  @Trim() @IsString() @MaxLength(255) @Matches(NO_HTML, NO_HTML_MSG) street!: string;
  @IsString() @MaxLength(20) @Matches(/^84_VN[0-9A-Za-z_]+$/, GEO_MSG) provinceCode!: string;
  @IsString() @MaxLength(20) districtCode!: string;
  @IsString() @MaxLength(20) wardCode!: string;
}

export class GuestQuoteDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(GUEST_MAX_LINES) @ValidateNested({ each: true }) @Type(() => GuestLineDto) lines!: GuestLineDto[];
  @ValidateNested() @Type(() => GuestAddressDto) address!: GuestAddressDto;
}

export class GuestPlaceOrderDto extends GuestQuoteDto {
  @IsIn(['COD', 'BANK_TRANSFER']) paymentMethod!: 'COD' | 'BANK_TRANSFER';
  @IsOptional() @IsInt() @Min(0) expectedTotal?: number;
  @IsOptional() @Trim() @IsString() @MaxLength(500) @Matches(NO_HTML, NO_HTML_MSG) note?: string;
  @IsOptional() @IsString() @MaxLength(64) giftVariationId?: string | null;
  @IsOptional() @IsBoolean() orderZaloConsent?: boolean;
  @IsString() @Matches(GUEST_TRACKING_KEY_RE, { message: 'Phiên đặt hàng không hợp lệ, bạn tải lại trang nhé.' }) trackingKey!: string;
  /** Ô bẫy ẩn khỏi người dùng: có giá trị là máy tự điền. */
  @IsOptional() @IsString() @MaxLength(200) website?: string;
  /** Số mili giây từ lúc mở biểu mẫu tới lúc bấm Đặt hàng. */
  @IsInt() @Min(0) @Max(86_400_000) fillMs!: number;
  /** Mã giới thiệu của link khách mở (`?ref=`, gian hàng CTV): máy chủ chỉ ghi công CTV/đại lý (CheckoutService.guestReferrer). */
  @IsOptional() @Trim() @IsString() @MaxLength(64) referralCode?: string;
  /** Mã link CTV (`?l=`): như PlaceOrderDto.affiliateLinkCode, chỉ lưu khi thuộc đúng người giới thiệu của đơn. */
  @IsOptional() @Trim() @IsString() @MaxLength(64) affiliateLinkCode?: string;
}

/** Mã đơn trên đơn hàng: chữ hoa, số, gạch nối (mã ngắn TB…, DL…, TS…; mã dài cũ TUBU…, DLR…, TUBUSUB…). */
export const GUEST_LOOKUP_CODE_RE = /^[A-Z0-9-]{4,40}$/;

/** Mã đơn khách gõ hay dán: bỏ mọi khoảng trắng, dấu # ở đầu và viết hoa. */
export function normalizeLookupCode(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/\s+/g, '').replace(/^#+/, '').toUpperCase() : value;
}

/** SĐT khách gõ: bỏ ký tự không phải số, 84 + 9 số (kể cả "+84 0…" gõ thừa số 0) về 0 + 9 số (cùng dạng `orders.guestPhone`). */
export function normalizeLookupPhone(value: unknown): unknown {
  return typeof value === 'string' ? (toLocalPhone(value) ?? '').replace(/^840(\d{9})$/, '0$1') : value;
}

/** Tra đơn đặt không đăng nhập: mã đơn + đúng SĐT đặt hàng. Sai khuôn 400 (không lộ gì về đơn); đúng khuôn mà không khớp thì 404. */
export class GuestLookupDto {
  @Transform(({ value }: { value: unknown }) => normalizeLookupCode(value))
  @IsString()
  @Matches(GUEST_LOOKUP_CODE_RE, { message: 'Mã đơn chưa đúng. Mã đơn in trong tin xác nhận, bắt đầu bằng TB hoặc TUBU.' })
  orderCode!: string;

  @Transform(({ value }: { value: unknown }) => normalizeLookupPhone(value))
  @IsString()
  @Matches(GUEST_MOBILE_RE, MOBILE_MSG)
  phone!: string;
}
