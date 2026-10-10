import { Allow, ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Ảnh có thể là URL Cloudinary HOẶC data URL base64 (fallback khi chưa cấu hình Cloudinary), nên
// trần phải rộng — đủ cho ảnh nén ~1MB nhưng chặn payload vô hạn. Mirror IMAGE_MAX của
// storefront.controller.ts (không export sẵn nên khai lại hằng số tương đương ở đây).
const IMAGE_MAX = 1_500_000;

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
  @IsString() name!: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() @MaxLength(IMAGE_MAX) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(IMAGE_MAX) coverUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) tagline?: string;
  @IsOptional() @IsString() story?: string;
  @IsOptional() @IsString() @MaxLength(200) origin?: string;
  @IsOptional() @Allow() certifications?: unknown;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class UpdateBrandDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() @MaxLength(IMAGE_MAX) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(IMAGE_MAX) coverUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) tagline?: string;
  @IsOptional() @IsString() story?: string;
  @IsOptional() @IsString() @MaxLength(200) origin?: string;
  @IsOptional() @Allow() certifications?: unknown;
  @IsOptional() @IsBoolean() isPublished?: boolean;
  // Gán chủ nhãn (lộ trình B): userId của đối tác → cho phép họ tự quản nhãn.
  @IsOptional() @IsString() ownerUserId?: string;
}

export class VerifyBrandDto {
  @IsBoolean() isVerified!: boolean;
}

/** Brand-owner CHỈ sửa thông tin nhãn (không name/slug/verified/publish/cert). */
export class UpdateOwnedBrandDto {
  @IsOptional() @IsString() @MaxLength(IMAGE_MAX) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(IMAGE_MAX) coverUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) tagline?: string;
  @IsOptional() @IsString() story?: string;
  @IsOptional() @IsString() @MaxLength(200) origin?: string;
}

export class PromotionDto {
  @IsString() title!: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() themeColor?: string;
  @IsOptional() @IsString() @MaxLength(64) couponCode?: string;
  // @IsDateString: endpoint self-service /brand/owner/* dùng chung DTO này với client ít
  // tin cậy hơn admin → chặn chuỗi không phải ngày (new Date('x')→Invalid Date→Prisma 500).
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdatePromotionDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() themeColor?: string;
  @IsOptional() @IsString() @MaxLength(64) couponCode?: string;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class DealerRewardDto {
  @IsOptional() @IsString() brandId?: string;
  @IsIn(['TOUR', 'GIFT', 'OTHER']) type!: 'TOUR' | 'GIFT' | 'OTHER';
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsInt() @Min(0) @Max(DEALER_REWARD_THRESHOLD_MAX) threshold!: number;
  @IsOptional() @IsIn(['QUARTER', 'YEAR']) period?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class ProductIdsDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsString({ each: true }) productIds!: string[];
}

export class UpdateDealerRewardDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) @Max(DEALER_REWARD_THRESHOLD_MAX) threshold?: number;
  @IsOptional() @IsIn(['QUARTER', 'YEAR']) period?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
