import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { CatalogService } from './catalog.service';
import type { ProductQuery } from './dto/product-query.dto';

// Không còn @Public() ở class — mỗi route public tự khai báo, để route
// /products/for-you (cá nhân hoá) bắt buộc JWT theo JwtAuthGuard mặc định.
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('products')
  list(@Query() query: ProductQuery) {
    return this.catalog.list(query);
  }

  // Cần đăng nhập — gợi ý cá nhân hoá theo lịch sử mua + nhãn theo dõi (Feed "Dành cho bạn").
  // Đặt TRƯỚC ':slug' để không bị route param nuốt mất "for-you".
  @Get('products/for-you')
  forYou(@CurrentUser('sub') userId: string) {
    return this.catalog.getForYou(userId);
  }

  @Public()
  @Get('products/:slug')
  detail(@Param('slug') slug: string) {
    return this.catalog.getBySlug(slug);
  }

  @Public()
  @Get('products/:slug/related')
  related(@Param('slug') slug: string) {
    return this.catalog.related(slug);
  }

  @Public()
  @Get('products/:slug/bought-together')
  boughtTogether(@Param('slug') slug: string) {
    return this.catalog.boughtTogether(slug);
  }

  @Public()
  @Get('brands')
  brands() {
    return this.catalog.brands();
  }

  @Public()
  @Get('categories')
  categories() {
    return this.catalog.categories();
  }

  @Public()
  @Get('search/suggest')
  suggest(@Query('q') q: string) {
    return this.catalog.suggest(q ?? '');
  }
}
