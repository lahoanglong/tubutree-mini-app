import { Controller, Get, Param } from '@nestjs/common';
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
}
