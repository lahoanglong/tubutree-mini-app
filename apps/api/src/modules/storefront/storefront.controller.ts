import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { StorefrontService } from './storefront.service';
import { StorefrontQuestService } from './storefront-quest.service';

class UpdateStorefrontDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() headerNote?: string;
  @IsOptional() @IsString() avatarUrl?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() theme?: string;
}
class PublishDto { @IsBoolean() isPublished!: boolean; }
class CreateCollectionDto {
  @IsString() title!: string;
  @IsOptional() @IsIn(['NORMAL', 'COMBO']) kind?: 'NORMAL' | 'COMBO';
  @IsOptional() @IsIn(['GRID', 'CAROUSEL', 'STACK']) layout?: 'GRID' | 'CAROUSEL' | 'STACK';
  @IsOptional() @IsInt() @Min(0) comboDiscountPct?: number;
}
class UpdateCollectionDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsIn(['GRID', 'CAROUSEL', 'STACK']) layout?: 'GRID' | 'CAROUSEL' | 'STACK';
  @IsOptional() @IsInt() @Min(0) comboDiscountPct?: number;
}
class AddItemDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() variationId?: string;
  @IsOptional() @IsString() note?: string;
}
class UpdateItemDto {
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsBoolean() isPinned?: boolean;
  @IsOptional() @IsBoolean() isHidden?: boolean;
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
  @Patch('me/collections/:id') updCol(@CurrentUser('sub') uid: string, @Param('id') id: string, @Body() dto: UpdateCollectionDto) { return this.svc.updateCollection(uid, id, dto); }
  @Delete('me/collections/:id') delCol(@CurrentUser('sub') uid: string, @Param('id') id: string) { return this.svc.deleteCollection(uid, id); }
  @Post('me/collections/reorder') reorderCol(@CurrentUser('sub') uid: string, @Body() dto: ReorderDto) { return this.svc.reorderCollections(uid, dto.orderedIds); }

  @Post('me/collections/:id/items') addItem(@CurrentUser('sub') uid: string, @Param('id') id: string, @Body() dto: AddItemDto) { return this.svc.addItem(uid, id, dto); }
  @Patch('me/items/:id') updItem(@CurrentUser('sub') uid: string, @Param('id') id: string, @Body() dto: UpdateItemDto) { return this.svc.updateItem(uid, id, dto); }
  @Delete('me/items/:id') delItem(@CurrentUser('sub') uid: string, @Param('id') id: string) { return this.svc.removeItem(uid, id); }
  @Post('me/collections/:id/items/reorder') reorderItems(@CurrentUser('sub') uid: string, @Param('id') id: string, @Body() dto: ReorderDto) { return this.svc.reorderItems(uid, id, dto.orderedIds); }

  @Get('me/products') picker(@CurrentUser('sub') uid: string, @Query() q: PickerQuery) { return this.svc.pickerProducts(uid, q); }

  @Get('me/quests') listQuests(@CurrentUser('sub') uid: string) { return this.quests.listQuests(uid); }
  @Post('me/quests/:code/claim') claimQuest(@CurrentUser('sub') uid: string, @Param('code') code: string) { return this.quests.claimQuest(uid, code); }

  @Public() @Get('public/:slug') publicView(@Param('slug') slug: string) { return this.svc.getPublicBySlug(slug); }
}
