import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { BrandService } from './brand.service';

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
}
