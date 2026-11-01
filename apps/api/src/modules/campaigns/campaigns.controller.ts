import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/public-cache.decorator';
import { PaginationQuery } from '../../common/pagination';
import { CampaignsService } from './campaigns.service';
import { CampaignListQuery } from './dto/campaign-query.dto';

/** Banner và trang chiến dịch: công khai, không phụ thuộc người gọi nên cache chung (lọc loại khách làm ở máy khách, trừ khi hỏi `audience`). */
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Public()
  @PublicCache('CATALOG')
  @Get()
  list(@Query() q: CampaignListQuery) {
    return this.campaigns.listPublic(q.placement, q.audience);
  }

  @Public()
  @PublicCache('CATALOG')
  @Get(':slug')
  detail(@Param('slug') slug: string) {
    return this.campaigns.getPublic(slug);
  }

  @Public()
  @PublicCache('CATALOG')
  @Get(':slug/products')
  products(@Param('slug') slug: string, @Query() q: PaginationQuery) {
    return this.campaigns.getProducts(slug, q.page, q.limit);
  }
}
