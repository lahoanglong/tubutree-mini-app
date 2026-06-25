import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  Allow,
  IsArray,
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
class ReviewReturnDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() note?: string;
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
class ImportDealerPricesDto {
  @IsString() tierId!: string;
  // Dán trực tiếp 2 cột Excel "sku,giá" (mỗi dòng 1 SKU). Hoặc gửi rows JSON.
  @IsOptional() @IsString() csv?: string;
  @IsOptional() @IsArray() rows?: { sku: string; price: number }[];
}

/** Parse CSV "sku,giá" (phân tách , ; hoặc tab); bỏ dòng header/giá không hợp lệ. */
function parseDealerPriceCsv(csv: string): { sku: string; price: number }[] {
  return csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [sku, priceRaw] = line.split(/[,;\t]/);
      return { sku: (sku ?? '').trim(), price: Number((priceRaw ?? '').replace(/[^\d.-]/g, '')) };
    })
    .filter((r) => r.sku && Number.isFinite(r.price) && r.price > 0);
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

  @Get('return-requests')
  returns(@Query('status') status?: string) {
    return this.admin.listReturnRequests(status);
  }

  @Post('return-requests/:id/review')
  reviewReturn(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ReviewReturnDto) {
    return this.admin.reviewReturn(adminId, id, dto.approve, dto.note);
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

  // Import bảng giá đại lý theo bậc (dán CSV "sku,giá" từ Excel hoặc gửi rows JSON).
  @Post('dealer-prices/import')
  importDealerPrices(@CurrentUser('sub') adminId: string, @Body() dto: ImportDealerPricesDto) {
    const rows = dto.csv ? parseDealerPriceCsv(dto.csv) : (dto.rows ?? []);
    return this.admin.importDealerPrices(adminId, dto.tierId, rows);
  }

  @Get('dealer-prices/history')
  dealerPriceHistory(@Query('variationId') variationId?: string) {
    return this.admin.getDealerPriceHistory(variationId);
  }
}
