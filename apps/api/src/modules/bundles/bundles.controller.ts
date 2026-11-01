import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/public-cache.decorator';
import { BundlesService, HOME_COMBOS_DEFAULT } from './bundles.service';

/** Combo và mua kèm: công khai, không phụ thuộc người gọi nên cache chung. Giá thật vẫn tính lại ở giỏ/báo giá/đặt đơn. */
@Controller()
export class BundlesController {
  constructor(private readonly bundles: BundlesService) {}

  @Public()
  @PublicCache('CATALOG')
  @Get('products/:slug/bundles')
  forProduct(@Param('slug') slug: string) {
    return this.bundles.forProduct(slug);
  }

  @Public()
  @PublicCache('CATALOG')
  @Get('bundles/combos')
  homeCombos(@Query('limit', new DefaultValuePipe(HOME_COMBOS_DEFAULT), ParseIntPipe) limit: number) {
    return this.bundles.homeCombos(limit);
  }
}
