import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import type { BrandService } from './brand.service';
import type {
  CreateBrandDto,
  DealerRewardDto,
  ProductIdsDto,
  PromotionDto,
  UpdateBrandDto,
  UpdateDealerRewardDto,
  UpdatePromotionDto,
  VerifyBrandDto,
} from './dto/brand.dto';

@Roles('ADMIN')
@Controller('admin')
export class BrandAdminController {
  constructor(private readonly svc: BrandService) {}

  @Get('brands') list() {
    return this.svc.listBrands();
  }
  @Post('brands') create(@Body() dto: CreateBrandDto) {
    return this.svc.createBrand(dto);
  }
  @Patch('brands/:id') update(@Param('id') id: string, @Body() dto: UpdateBrandDto) {
    return this.svc.updateBrand(id, dto);
  }
  @Patch('brands/:id/verify') verify(@Param('id') id: string, @Body() dto: VerifyBrandDto) {
    return this.svc.verifyBrand(id, dto.isVerified);
  }

  // Gán/gỡ sản phẩm vào nhãn (Product.brandId).
  @Get('brands/:id/products') listProducts(@Param('id') id: string) {
    return this.svc.listBrandProducts(id);
  }
  @Post('brands/:id/products') attachProducts(@Param('id') id: string, @Body() dto: ProductIdsDto) {
    return this.svc.attachProducts(id, dto.productIds);
  }
  @Delete('brands/:id/products') detachProducts(@Param('id') id: string, @Body() dto: ProductIdsDto) {
    return this.svc.detachProducts(id, dto.productIds);
  }
  @Post('brands/:id/link-by-name') linkByName(@Param('id') id: string) {
    return this.svc.linkProductsByName(id);
  }

  @Get('brands/:id/promotions') listPromos(@Param('id') id: string) {
    return this.svc.listPromotions(id);
  }
  @Post('brands/:id/promotions') addPromo(@Param('id') id: string, @Body() dto: PromotionDto) {
    return this.svc.createPromotion(id, dto);
  }
  @Patch('promotions/:id') updPromo(@Param('id') id: string, @Body() dto: UpdatePromotionDto) {
    return this.svc.updatePromotion(id, dto);
  }
  @Delete('promotions/:id') delPromo(@Param('id') id: string) {
    return this.svc.deletePromotion(id);
  }

  @Get('dealer-rewards') listRewards() {
    return this.svc.listDealerRewards();
  }
  @Post('dealer-rewards') addReward(@Body() dto: DealerRewardDto) {
    return this.svc.createDealerReward(dto);
  }
  @Patch('dealer-rewards/:id') updReward(@Param('id') id: string, @Body() dto: UpdateDealerRewardDto) {
    return this.svc.updateDealerReward(id, dto);
  }
  @Delete('dealer-rewards/:id') delReward(@Param('id') id: string) {
    return this.svc.deleteDealerReward(id);
  }
}
