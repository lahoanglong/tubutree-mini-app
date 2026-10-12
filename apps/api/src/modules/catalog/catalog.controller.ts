import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/public-cache.decorator';
import { CatalogService } from './catalog.service';
import { ProductQuery } from './dto/product-query.dto';
import { SuggestQuery } from './dto/suggest-query.dto';

// Không còn @Public() ở class — mỗi route public tự khai báo, để route
// /products/for-you (cá nhân hoá) bắt buộc JWT theo JwtAuthGuard mặc định.
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @PublicCache('CATALOG')
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
  @PublicCache('CATALOG')
  @Get('products/:slug')
  detail(@Param('slug') slug: string) {
    return this.catalog.getBySlug(slug);
  }

  @Public()
  @PublicCache('CATALOG')
  @Get('products/:slug/related')
  related(@Param('slug') slug: string) {
    return this.catalog.related(slug);
  }

  @Public()
  @PublicCache('CATALOG')
  @Get('products/:slug/bought-together')
  boughtTogether(@Param('slug') slug: string) {
    return this.catalog.boughtTogether(slug);
  }

  @Public()
  @PublicCache('STATIC')
  @Get('brands')
  brands() {
    return this.catalog.brands();
  }

  @Public()
  @PublicCache('STATIC')
  @Get('categories')
  categories() {
    return this.catalog.categories();
  }

  @Public()
  @Get('search/suggest')
  suggest(@Query() query: SuggestQuery) {
    return this.catalog.suggest(query.q ?? '');
  }
}
