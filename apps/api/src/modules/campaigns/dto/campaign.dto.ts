import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { IsImageRef } from '../../../common/uploaded-image';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { Trim } from '../../../common/decorators/trim.decorator';

export const CAMPAIGN_PLACEMENTS = ['HOME_TOP', 'OFFERS_TOP'] as const;
export const CAMPAIGN_LINK_TYPES = ['CAMPAIGN_PAGE', 'PRODUCT', 'CATEGORY', 'URL_INTERNAL'] as const;
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
  @IsOptional() @IsString() @MaxLength(200) linkValue?: string;
  @IsOptional() @IsIn([...CAMPAIGN_AUDIENCES]) audience?: (typeof CAMPAIGN_AUDIENCES)[number];
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** Không nhận `slug`: đổi slug làm gãy mọi liên kết đã chia sẻ. */
export class UpdateCampaignDto {
  @OptionalNotNull() @Trim() @IsString() @IsNotEmpty() @MaxLength(120) title?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(200) subtitle?: string | null;
  @OptionalNotNull() @IsIn([...CAMPAIGN_PLACEMENTS]) placement?: (typeof CAMPAIGN_PLACEMENTS)[number];
  @OptionalNotNull() @Trim() @IsString() @IsNotEmpty() @IsImageRef() image?: string;
  @OptionalNotNull() @IsIn([...CAMPAIGN_LINK_TYPES]) linkType?: (typeof CAMPAIGN_LINK_TYPES)[number];
  @IsOptional() @IsString() @MaxLength(200) linkValue?: string | null;
  @OptionalNotNull() @IsIn([...CAMPAIGN_AUDIENCES]) audience?: (typeof CAMPAIGN_AUDIENCES)[number];
  @OptionalNotNull() @IsDateString() startAt?: string;
  @OptionalNotNull() @IsDateString() endAt?: string;
  @OptionalNotNull() @IsInt() @Min(0) @Max(9999) sortOrder?: number;
  @OptionalNotNull() @IsBoolean() isActive?: boolean;
}

export class SetCampaignProductsDto {
  @IsArray() @ArrayMaxSize(CAMPAIGN_MAX_PRODUCTS) @IsString({ each: true }) @IsNotEmpty({ each: true }) productIds!: string[];
}

export class SetCampaignCouponsDto {
  @IsArray() @ArrayMaxSize(CAMPAIGN_MAX_COUPONS) @IsString({ each: true }) @IsNotEmpty({ each: true }) codes!: string[];
}

export class AdminCampaignListQuery {
  @IsOptional() @IsIn([...CAMPAIGN_PLACEMENTS]) placement?: (typeof CAMPAIGN_PLACEMENTS)[number];
}
