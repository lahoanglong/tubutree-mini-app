import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/public-cache.decorator';
import { CatalogService } from './catalog.service';
import { toPublicProductDetail } from './catalog-public';
import { BrandProductsQuery } from './dto/brand-products-query.dto';
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
  async detail(@Param('slug') slug: string) {
    return toPublicProductDetail(await this.catalog.getBySlug(slug));
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

  // Trang thương hiệu phân trang thật. Đặt ở đây (không ở BrandController) để dùng chung cách xếp và dựng thẻ của /products
  // mà BrandModule không phải import CatalogModule; đường dẫn vẫn nằm dưới /brand.
  @Public()
  @PublicCache('CATALOG')
  @Get('brand/public/:slug/products')
  brandProducts(@Param('slug') slug: string, @Query() query: BrandProductsQuery) {
    return this.catalog.listBrandProducts(slug, query);
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
  categories(@Query('flat') flat?: string) {
    // Mặc định là cây cho trang mua sắm; `?flat=1` là danh sách phẳng cho bộ chọn danh mục (admin, gian hàng CTV),
    // nơi danh mục con phải chọn được như danh mục gốc.
    return flat === '1' || flat === 'true' ? this.catalog.categoriesFlat() : this.catalog.categories();
  }

  @Public()
  @Get('search/suggest')
  suggest(@Query() query: SuggestQuery) {
    return this.catalog.suggest(query.q ?? '');
  }
}
