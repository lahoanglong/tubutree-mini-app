import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import { ProductQuery } from './dto/product-query.dto';

@Public()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  list(@Query() query: ProductQuery) {
    return this.catalog.list(query);
  }

  @Get('products/:slug')
  detail(@Param('slug') slug: string) {
    return this.catalog.getBySlug(slug);
  }

  @Get('products/:slug/related')
  related(@Param('slug') slug: string) {
    return this.catalog.related(slug);
  }

  @Get('products/:slug/bought-together')
  boughtTogether(@Param('slug') slug: string) {
    return this.catalog.boughtTogether(slug);
  }

  @Get('brands')
  brands() {
    return this.catalog.brands();
  }

  @Get('categories')
  categories() {
    return this.catalog.categories();
  }

  @Get('search/suggest')
  suggest(@Query('q') q: string) {
    return this.catalog.suggest(q ?? '');
  }
}
