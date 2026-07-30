import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { BrandService } from './brand.service';
import type { PromotionDto, UpdateOwnedBrandDto, UpdatePromotionDto } from './dto/brand.dto';

@Controller('brand')
export class BrandController {
  constructor(private readonly svc: BrandService) {}

  @Public()
  @Get('public/:slug')
  publicView(@Param('slug') slug: string) {
    return this.svc.getPublicBySlug(slug);
  }

  // Cần đăng nhập: chỉ AFFILIATE nhận %HH; khách thường eligible=false.
  @Get(':slug/share-to-earn')
  shareToEarn(@Param('slug') slug: string, @CurrentUser('sub') uid: string) {
    return this.svc.getShareToEarn(slug, uid);
  }

  // Theo dõi nhãn (cần đăng nhập).
  @Get(':slug/follow-state')
  followState(@Param('slug') slug: string, @CurrentUser('sub') uid: string) {
    return this.svc.followState(uid, slug);
  }
  @Post(':slug/follow')
  follow(@Param('slug') slug: string, @CurrentUser('sub') uid: string) {
    return this.svc.followBrand(uid, slug);
  }
  @Delete(':slug/follow')
  unfollow(@Param('slug') slug: string, @CurrentUser('sub') uid: string) {
    return this.svc.unfollowBrand(uid, slug);
  }

  // ---- Brand-owner tự quản (lộ trình B) — auth bằng quyền sở hữu (Brand.ownerUserId) ----
  // Đặt TRƯỚC ':slug/...' không cần vì prefix 'owner' khác param; route literal 'owner' ưu tiên.
  @Get('owner/me')
  ownedBrand(@CurrentUser('sub') uid: string) {
    return this.svc.getOwnedBrand(uid);
  }
  @Patch('owner/me')
  updateOwned(@CurrentUser('sub') uid: string, @Body() dto: UpdateOwnedBrandDto) {
    return this.svc.updateOwnedBrand(uid, dto);
  }
  @Get('owner/me/promotions')
  ownedPromos(@CurrentUser('sub') uid: string) {
    return this.svc.listOwnedPromotions(uid);
  }
  @Post('owner/me/promotions')
  addOwnedPromo(@CurrentUser('sub') uid: string, @Body() dto: PromotionDto) {
    return this.svc.createOwnedPromotion(uid, dto);
  }
  @Patch('owner/me/promotions/:id')
  updOwnedPromo(@CurrentUser('sub') uid: string, @Param('id') id: string, @Body() dto: UpdatePromotionDto) {
    return this.svc.updateOwnedPromotion(uid, id, dto);
  }
  @Delete('owner/me/promotions/:id')
  delOwnedPromo(@CurrentUser('sub') uid: string, @Param('id') id: string) {
    return this.svc.deleteOwnedPromotion(uid, id);
  }
}
