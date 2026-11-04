import { Allow, ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';

// Ảnh có thể là URL Cloudinary HOẶC data URL base64 (fallback khi chưa cấu hình Cloudinary), nên
// trần phải rộng — đủ cho ảnh nén ~1MB nhưng chặn payload vô hạn. Mirror IMAGE_MAX của
// storefront.controller.ts (không export sẵn nên khai lại hằng số tương đương ở đây).
const IMAGE_MAX = 1_500_000;

// Câu chuyện nhãn là đoạn văn dài; id là cuid/uuid nên 64 ký tự là dư.
const STORY_MAX = 20000;
const ID_MAX = 64;

// Cột threshold là BigInt nhưng API trao đổi bằng number JSON: trần 1 nghìn tỷ vừa rộng hơn mọi
// doanh số năm thực tế, vừa nằm xa dưới Number.MAX_SAFE_INTEGER nên không mất chính xác.
export const DEALER_REWARD_THRESHOLD_MAX = 1_000_000_000_000;

// Kỳ báo cáo doanh thu của chủ nhãn (tính theo giờ Việt Nam) — danh sách cố định, không nhận khoảng ngày tự do.
export const BRAND_SALES_PERIODS = ['7d', '30d', '90d', 'month', 'prev_month'] as const;
export type BrandSalesPeriod = (typeof BRAND_SALES_PERIODS)[number];

export class BrandSalesQueryDto {
  @IsOptional() @IsIn([...BRAND_SALES_PERIODS]) period?: BrandSalesPeriod;
}

export class CreateBrandDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() @MaxLength(IMAGE_MAX) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(IMAGE_MAX) coverUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) tagline?: string;
  @IsOptional() @IsString() @MaxLength(STORY_MAX) story?: string;
  @IsOptional() @IsString() @MaxLength(200) origin?: string;
  @IsOptional() @Allow() certifications?: unknown;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class UpdateBrandDto {
  @OptionalNotNull() @IsString() @MaxLength(120) name?: string;
  @OptionalNotNull() @IsString() @MaxLength(80) slug?: string;
  @OptionalNotNull() @IsString() @MaxLength(IMAGE_MAX) logoUrl?: string;
  @OptionalNotNull() @IsString() @MaxLength(IMAGE_MAX) coverUrl?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) tagline?: string;
  @OptionalNotNull() @IsString() @MaxLength(STORY_MAX) story?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) origin?: string;
  @IsOptional() @Allow() certifications?: unknown;
  @OptionalNotNull() @IsBoolean() isPublished?: boolean;
  // Gán chủ nhãn (lộ trình B): userId của đối tác → cho phép họ tự quản nhãn.
  @OptionalNotNull() @IsString() @MaxLength(ID_MAX) ownerUserId?: string;
}

export class VerifyBrandDto {
  @IsBoolean() isVerified!: boolean;
}

/** Brand-owner CHỈ sửa thông tin nhãn (không name/slug/verified/publish/cert). */
export class UpdateOwnedBrandDto {
  @OptionalNotNull() @IsString() @MaxLength(IMAGE_MAX) logoUrl?: string;
  @OptionalNotNull() @IsString() @MaxLength(IMAGE_MAX) coverUrl?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) tagline?: string;
  @OptionalNotNull() @IsString() @MaxLength(STORY_MAX) story?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) origin?: string;
}

// themeColor được nội suy thẳng vào style của trang công khai (border-color), nên chỉ nhận mã hex:
// chuỗi tự do cho phép chủ nhãn chèn thêm khai báo CSS (position:fixed, background:url(...)).
const THEME_COLOR_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const THEME_COLOR_MESSAGE = 'themeColor phải là mã màu hex dạng #RGB hoặc #RRGGBB.';

export class PromotionDto {
  @IsString() @MaxLength(160) title!: string;
  @IsOptional() @IsString() @MaxLength(240) subtitle?: string;
  @IsOptional() @IsString() @Matches(THEME_COLOR_HEX, { message: THEME_COLOR_MESSAGE }) themeColor?: string;
  @IsOptional() @IsString() @MaxLength(64) couponCode?: string;
  // @IsDateString: endpoint self-service /brand/owner/* dùng chung DTO này với client ít
  // tin cậy hơn admin → chặn chuỗi không phải ngày (new Date('x')→Invalid Date→Prisma 500).
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdatePromotionDto {
  @OptionalNotNull() @IsString() @MaxLength(160) title?: string;
  @OptionalNotNull() @IsString() @MaxLength(240) subtitle?: string;
  @OptionalNotNull() @IsString() @Matches(THEME_COLOR_HEX, { message: THEME_COLOR_MESSAGE }) themeColor?: string;
  @OptionalNotNull() @IsString() @MaxLength(64) couponCode?: string;
  @OptionalNotNull() @IsDateString() startAt?: string;
  @OptionalNotNull() @IsDateString() endAt?: string;
  @OptionalNotNull() @IsBoolean() isActive?: boolean;
  @OptionalNotNull() @IsInt() @Min(0) sortOrder?: number;
}

export class DealerRewardDto {
  @IsOptional() @IsString() @MaxLength(ID_MAX) brandId?: string;
  @IsIn(['TOUR', 'GIFT', 'OTHER']) type!: 'TOUR' | 'GIFT' | 'OTHER';
  @IsString() @MaxLength(160) title!: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsInt() @Min(0) @Max(DEALER_REWARD_THRESHOLD_MAX) threshold!: number;
  @IsOptional() @IsIn(['QUARTER', 'YEAR']) period?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class ProductIdsDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(ID_MAX, { each: true }) productIds!: string[];
}

export class UpdateDealerRewardDto {
  @OptionalNotNull() @IsString() @MaxLength(160) title?: string;
  @OptionalNotNull() @IsString() @MaxLength(5000) description?: string;
  @OptionalNotNull() @IsInt() @Min(0) @Max(DEALER_REWARD_THRESHOLD_MAX) threshold?: number;
  @OptionalNotNull() @IsIn(['QUARTER', 'YEAR']) period?: string;
  @OptionalNotNull() @IsBoolean() isActive?: boolean;
  @OptionalNotNull() @IsInt() @Min(0) sortOrder?: number;
}
