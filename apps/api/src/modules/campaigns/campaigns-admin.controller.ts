import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { CampaignsAdminService } from './campaigns-admin.service';
import { AdminCampaignListQuery, CreateCampaignDto, SetCampaignCouponsDto, SetCampaignProductsDto, UpdateCampaignDto } from './dto/campaign.dto';

@Roles('ADMIN')
@AllowStaff('MARKETING')
@Controller('admin/campaigns')
export class CampaignsAdminController {
  constructor(private readonly campaigns: CampaignsAdminService) {}

  @Get()
  list(@Query() q: AdminCampaignListQuery) {
    return this.campaigns.list(q.placement);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.campaigns.get(id);
  }

  @Post()
  create(@Body() dto: CreateCampaignDto) {
    return this.campaigns.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaigns.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.campaigns.remove(id);
  }

  @Put(':id/products')
  setProducts(@Param('id') id: string, @Body() dto: SetCampaignProductsDto) {
    return this.campaigns.setProducts(id, dto.productIds);
  }

  @Put(':id/coupons')
  setCoupons(@Param('id') id: string, @Body() dto: SetCampaignCouponsDto) {
    return this.campaigns.setCoupons(id, dto.codes);
  }
}
