import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { CAMPAIGN_ENTITY_SLUG_MAX, CAMPAIGN_LINK_TYPES } from '@tubutree/shared-types';
import { IsImageRef } from '../../../common/uploaded-image';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { Trim } from '../../../common/decorators/trim.decorator';

export const CAMPAIGN_PLACEMENTS = ['HOME_TOP', 'OFFERS_TOP'] as const;
export { CAMPAIGN_LINK_TYPES };
export const CAMPAIGN_AUDIENCES = ['ALL', 'NEW', 'RETURNING'] as const;
export const CAMPAIGN_MAX_PRODUCTS = 200;
export const CAMPAIGN_MAX_COUPONS = 10;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class CreateCampaignDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(120) title!: string;
  @IsOptional() @Trim() @IsString() @MaxLength(200) subtitle?: string;
  @IsOptional() @IsString() @MaxLength(80) @Matches(SLUG, { message: 'slug chỉ gồm chữ thường không dấu, số và dấu gạch ngang.' }) slug?: string;
  @IsIn([...CAMPAIGN_PLACEMENTS]) placement!: (typeof CAMPAIGN_PLACEMENTS)[number];
  @Trim() @IsString() @IsNotEmpty() @IsImageRef() image!: string;
  @IsOptional() @IsIn([...CAMPAIGN_LINK_TYPES]) linkType?: (typeof CAMPAIGN_LINK_TYPES)[number];
  @IsOptional() @IsString() @MaxLength(CAMPAIGN_ENTITY_SLUG_MAX) linkValue?: string;
  @IsOptional() @IsIn([...CAMPAIGN_AUDIENCES]) audience?: (typeof CAMPAIGN_AUDIENCES)[number];
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Thay hết danh sách sản phẩm trong CÙNG lệnh lưu (một giao dịch); không gửi thì giữ nguyên. */
  @IsOptional() @IsArray() @ArrayMaxSize(CAMPAIGN_MAX_PRODUCTS) @IsString({ each: true }) @IsNotEmpty({ each: true }) productIds?: string[];
  /** Thay hết mã gắn kèm trong CÙNG lệnh lưu; không gửi thì giữ nguyên. */
  @IsOptional() @IsArray() @ArrayMaxSize(CAMPAIGN_MAX_COUPONS) @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(64, { each: true }) couponCodes?: string[];
}

/** Không nhận `slug`: đổi slug làm gãy mọi liên kết đã chia sẻ. */
export class UpdateCampaignDto {
  @OptionalNotNull() @Trim() @IsString() @IsNotEmpty() @MaxLength(120) title?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(200) subtitle?: string | null;
  @OptionalNotNull() @IsIn([...CAMPAIGN_PLACEMENTS]) placement?: (typeof CAMPAIGN_PLACEMENTS)[number];
  @OptionalNotNull() @Trim() @IsString() @IsNotEmpty() @IsImageRef() image?: string;
  @OptionalNotNull() @IsIn([...CAMPAIGN_LINK_TYPES]) linkType?: (typeof CAMPAIGN_LINK_TYPES)[number];
  @IsOptional() @IsString() @MaxLength(CAMPAIGN_ENTITY_SLUG_MAX) linkValue?: string | null;
  @OptionalNotNull() @IsIn([...CAMPAIGN_AUDIENCES]) audience?: (typeof CAMPAIGN_AUDIENCES)[number];
  @OptionalNotNull() @IsDateString() startAt?: string;
  @OptionalNotNull() @IsDateString() endAt?: string;
  @OptionalNotNull() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @OptionalNotNull() @IsBoolean() isActive?: boolean;
  /** Thay hết danh sách sản phẩm trong CÙNG lệnh lưu (một giao dịch); không gửi thì giữ nguyên. */
  @OptionalNotNull() @IsArray() @ArrayMaxSize(CAMPAIGN_MAX_PRODUCTS) @IsString({ each: true }) @IsNotEmpty({ each: true }) productIds?: string[];
  /** Thay hết mã gắn kèm trong CÙNG lệnh lưu; không gửi thì giữ nguyên. */
  @OptionalNotNull() @IsArray() @ArrayMaxSize(CAMPAIGN_MAX_COUPONS) @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(64, { each: true }) couponCodes?: string[];
}

export class SetCampaignProductsDto {
  @IsArray() @ArrayMaxSize(CAMPAIGN_MAX_PRODUCTS) @IsString({ each: true }) @IsNotEmpty({ each: true }) productIds!: string[];
}

export class SetCampaignCouponsDto {
  @IsArray() @ArrayMaxSize(CAMPAIGN_MAX_COUPONS) @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(64, { each: true }) codes!: string[];
}

/** Kiểm trước khi lưu: cùng trường với tạo/sửa (không cần ảnh), kèm danh sách sản phẩm/mã đang soạn. `id` có khi sửa chiến dịch đã lưu. */
export class CheckCampaignDto {
  @IsOptional() @IsString() @MaxLength(64) id?: string;
  @IsIn([...CAMPAIGN_PLACEMENTS]) placement!: (typeof CAMPAIGN_PLACEMENTS)[number];
  @IsOptional() @IsIn([...CAMPAIGN_LINK_TYPES]) linkType?: (typeof CAMPAIGN_LINK_TYPES)[number];
  @IsOptional() @IsString() @MaxLength(CAMPAIGN_ENTITY_SLUG_MAX) linkValue?: string | null;
  @IsOptional() @IsIn([...CAMPAIGN_AUDIENCES]) audience?: (typeof CAMPAIGN_AUDIENCES)[number];
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  /** Mặc định bật (kiểm "như thể đã bật"); phán quyết lưu dùng giá trị này. */
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(CAMPAIGN_MAX_PRODUCTS) @IsString({ each: true }) @IsNotEmpty({ each: true }) productIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(CAMPAIGN_MAX_COUPONS) @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(64, { each: true }) couponCodes?: string[];
}

export class AdminCampaignListQuery {
  @IsOptional() @IsIn([...CAMPAIGN_PLACEMENTS]) placement?: (typeof CAMPAIGN_PLACEMENTS)[number];
}
