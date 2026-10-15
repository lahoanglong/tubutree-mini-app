import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { StorefrontService } from './storefront.service';
import { StorefrontQuestService } from './storefront-quest.service';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';

// Ảnh có thể là URL Cloudinary HOẶC data URL base64 (fallback khi chưa cấu hình Cloudinary),
// nên trần phải rộng — đủ cho ảnh nén ~1MB nhưng chặn payload vô hạn (body limit là 10MB).
const IMAGE_MAX = 1_500_000;

class UpdateStorefrontDto {
  @OptionalNotNull()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Tên gian hàng không được để trống.' })
  @MaxLength(120)
  title?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) headerNote?: string;
  @OptionalNotNull() @IsString() @MaxLength(IMAGE_MAX) avatarUrl?: string;
  @OptionalNotNull() @IsString() @MaxLength(IMAGE_MAX) coverUrl?: string;
  @OptionalNotNull() @IsString() theme?: string;
  // Không tìm thấy danh sách theme hợp lệ tường minh trong storefront.service.ts để dùng @IsIn —
  // chỉ ràng buộc themeColor (mã hex #rrggbb, khớp default '#16a34a' ở getPublicBySlug).
  @OptionalNotNull() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'themeColor phải là mã màu hex dạng #rrggbb.' }) themeColor?: string;
  @OptionalNotNull() @IsString() subdomain?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) bankName?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) bankBin?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) bankAccountNo?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) bankAccountName?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) warehouseAddress?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) warehouseCity?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) warehouseDistrict?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) warehouseWard?: string;
  @OptionalNotNull() @IsString() @MaxLength(200) warehousePhone?: string;
}
class PublishDto { @IsBoolean() isPublished!: boolean; }
class ApplyTemplateDto { @IsString() categoryId!: string; }
class CreateCollectionDto {
  @IsString() @MaxLength(80) title!: string;
  @IsOptional() @IsIn(['NORMAL', 'COMBO']) kind?: 'NORMAL' | 'COMBO';
  @IsOptional() @IsIn(['GRID', 'CAROUSEL', 'STACK']) layout?: 'GRID' | 'CAROUSEL' | 'STACK';
  @IsOptional() @IsInt() @Min(0) @Max(100) comboDiscountPct?: number;
}
class UpdateCollectionDto {
  @OptionalNotNull() @IsString() @MaxLength(80) title?: string;
  @OptionalNotNull() @IsIn(['GRID', 'CAROUSEL', 'STACK']) layout?: 'GRID' | 'CAROUSEL' | 'STACK';
  @OptionalNotNull() @IsInt() @Min(0) @Max(100) comboDiscountPct?: number;
}
class AddItemDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() variationId?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}
class UpdateItemDto {
  @OptionalNotNull() @IsString() @MaxLength(200) note?: string;
  @OptionalNotNull() @IsBoolean() isPinned?: boolean;
  @OptionalNotNull() @IsBoolean() isHidden?: boolean;
}
class ReorderDto { @IsArray() @IsString({ each: true }) orderedIds!: string[]; }
class PickerQuery {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

@Controller('storefront')
export class StorefrontController {
  constructor(
    private readonly svc: StorefrontService,
    private readonly quests: StorefrontQuestService,
  ) {}

  @Post() create(@CurrentUser('sub') uid: string) { return this.svc.getOrCreateMine(uid); }
  @Get('me') me(@CurrentUser('sub') uid: string) { return this.svc.getMine(uid); }
  @Patch('me') update(@CurrentUser('sub') uid: string, @Body() dto: UpdateStorefrontDto) { return this.svc.updateMine(uid, dto); }
  @Post('me/publish') publish(@CurrentUser('sub') uid: string, @Body() dto: PublishDto) { return this.svc.publishMine(uid, dto.isPublished); }

  @Post('me/collections') addCol(@CurrentUser('sub') uid: string, @Body() dto: CreateCollectionDto) { return this.svc.createCollection(uid, dto); }
  @Post('me/apply-template') applyTemplate(@CurrentUser('sub') uid: string, @Body() dto: ApplyTemplateDto) { return this.svc.applyTemplate(uid, dto.categoryId); }
  @Patch('me/collections/:id') updCol(@CurrentUser('sub') uid: string, @Param('id') id: string, @Body() dto: UpdateCollectionDto) { return this.svc.updateCollection(uid, id, dto); }
  @Delete('me/collections/:id') delCol(@CurrentUser('sub') uid: string, @Param('id') id: string) { return this.svc.deleteCollection(uid, id); }
  @Post('me/collections/reorder') reorderCol(@CurrentUser('sub') uid: string, @Body() dto: ReorderDto) { return this.svc.reorderCollections(uid, dto.orderedIds); }

  @Post('me/collections/:id/items') addItem(@CurrentUser('sub') uid: string, @Param('id') id: string, @Body() dto: AddItemDto) { return this.svc.addItem(uid, id, dto); }
  @Patch('me/items/:id') updItem(@CurrentUser('sub') uid: string, @Param('id') id: string, @Body() dto: UpdateItemDto) { return this.svc.updateItem(uid, id, dto); }
  @Delete('me/items/:id') delItem(@CurrentUser('sub') uid: string, @Param('id') id: string) { return this.svc.removeItem(uid, id); }
  @Post('me/collections/:id/items/reorder') reorderItems(@CurrentUser('sub') uid: string, @Param('id') id: string, @Body() dto: ReorderDto) { return this.svc.reorderItems(uid, id, dto.orderedIds); }

  @Get('me/products') picker(@CurrentUser('sub') uid: string, @Query() q: PickerQuery) { return this.svc.pickerProducts(uid, q); }
  @Get('me/stats') stats(@CurrentUser('sub') uid: string) { return this.svc.getStats(uid); }

  @Get('me/quests') listQuests(@CurrentUser('sub') uid: string) { return this.quests.listQuests(uid); }
  @Post('me/quests/:code/claim') claimQuest(@CurrentUser('sub') uid: string, @Param('code') code: string) { return this.quests.claimQuest(uid, code); }

  @Public() @Get('public/:slug') publicView(@Param('slug') slug: string) { return this.svc.getPublicBySlug(slug); }
  @Public() @Get('by-host') byHost(@Query('host') host: string) { return this.svc.getPublicByHost(host); }
  // Danh sách nhẹ cho web sitemap.ts — KHÔNG dùng path param ':slug' nên không đụng route
  // 'public/:slug' phía trên (2 literal segment khác nhau, Express không mơ hồ).
  @Public() @Get('public-list') publicList() { return this.svc.getPublicList(); }
}
