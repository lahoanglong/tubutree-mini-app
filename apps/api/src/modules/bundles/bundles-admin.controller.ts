import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { JwtPayload } from '@tubutree/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import type { CouponActor } from '../admin/coupon-input-rules';
import { BundlesAdminService } from './bundles-admin.service';
import { AdminBundleListQuery, CreateBundleDto, UpdateBundleDto } from './dto/bundle.dto';

const actorOf = (user: JwtPayload): CouponActor => ({ id: user.sub, staff: user.role !== 'ADMIN' });

@Roles('ADMIN')
@AllowStaff('MARKETING')
@Controller('admin/bundles')
export class BundlesAdminController {
  constructor(private readonly bundles: BundlesAdminService) {}

  @Get()
  list(@Query() q: AdminBundleListQuery) {
    return this.bundles.list(q.status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.bundles.get(id);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateBundleDto) {
    return this.bundles.create(dto, actorOf(user));
  }

  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateBundleDto) {
    return this.bundles.update(id, dto, actorOf(user));
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.bundles.remove(id, actorOf(user));
  }
}
