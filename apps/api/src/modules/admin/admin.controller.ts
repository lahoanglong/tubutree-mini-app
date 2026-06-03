import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  Allow,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { AdminService } from './admin.service';

class ReviewDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() tierId?: string;
  @IsOptional() @IsString() reason?: string;
}
class SetConfigDto {
  @IsString() key!: string;
  // value tự do (object/số/chuỗi/boolean) — @Allow để ValidationPipe không loại bỏ.
  @Allow() value!: object | string | number | boolean;
}
class CreateCouponDto {
  @IsString() code!: string;
  @IsIn(['PERCENT', 'AMOUNT', 'FREESHIP']) type!: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  @IsInt() @Min(0) value!: number;
  @IsOptional() @IsInt() minOrder?: number;
  @IsOptional() @IsInt() maxDiscount?: number;
  @IsString() startAt!: string;
  @IsString() endAt!: string;
  @IsOptional() @IsInt() usageLimit?: number;
  @IsOptional() @IsInt() perUserLimit?: number;
  @IsIn(['PUBLIC', 'TIER', 'USER_GROUP', 'BIRTHDAY', 'INVITE'])
  scope!: 'PUBLIC' | 'TIER' | 'USER_GROUP' | 'BIRTHDAY' | 'INVITE';
}

@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dealer-applications')
  dealerApps(@Query('status') status?: string) {
    return this.admin.listDealerApplications(status);
  }

  @Post('dealer-applications/:id/review')
  review(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.admin.reviewDealerApplication(adminId, id, dto.approve, dto.tierId, dto.reason);
  }

  @Get('users')
  users(@Query() q: PaginationQuery) {
    return this.admin.listUsers(q.page, q.limit);
  }

  @Get('orders')
  orders(@Query() q: PaginationQuery, @Query('status') status?: string) {
    return this.admin.listOrders(q.page, q.limit, status);
  }

  @Get('config')
  getConfig(@Query('category') category?: string) {
    return this.admin.getConfig(category);
  }

  @Put('config')
  setConfig(@CurrentUser('sub') adminId: string, @Body() dto: SetConfigDto) {
    return this.admin.setConfig(adminId, dto.key, dto.value);
  }

  @Post('coupons')
  createCoupon(@Body() dto: CreateCouponDto) {
    return this.admin.createCoupon(dto);
  }
}
