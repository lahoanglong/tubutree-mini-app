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

  /** Trang Bộ quà tặng & combo khởi đầu: combo đang bán được và mốc quà dùng thử 0đ (null khi không còn quà). */
  @Public()
  @PublicCache('CATALOG')
  @Get('bundles/gift-landing')
  giftLanding() {
    return this.bundles.giftLanding();
  }

  /** Trang ghép Hộp Xanh: món đủ điều kiện nhóm theo danh mục, kèm bảng bậc. Cờ tắt trả `enabled: false`. */
  @Public()
  @PublicCache('CATALOG')
  @Get('bundles/green-box')
  greenBox() {
    return this.bundles.greenBoxPage();
  }
}
