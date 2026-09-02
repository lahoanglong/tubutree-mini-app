import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  registerDecorator,
} from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { AdminService } from './admin.service';
import { CatalogService } from '../catalog/catalog.service';

/**
 * value <= max CHỈ khi type=PERCENT (chặn admin nhập % vô lý, vd 500%).
 * Không dùng @ValidateIf ở đây vì nó sẽ tắt LUÔN @IsInt/@Min(0) của cùng field khi
 * type khác PERCENT — đây là constraint riêng, cộng thêm chứ không thay thế.
 */
function MaxIfPercent(max: number, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'maxIfPercent',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [max],
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const dto = args.object as { type?: string };
          if (dto.type !== 'PERCENT') return true;
          return typeof value === 'number' && value <= max;
        },
        defaultMessage(args: ValidationArguments) {
          return `value phải <= ${args.constraints[0]} khi type=PERCENT.`;
        },
      },
    });
  };
}

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
  @IsString() @IsNotEmpty() key!: string;
  // value tự do (object/số/chuỗi/boolean) — @Allow để ValidationPipe không loại bỏ.
  // null/undefined bị chặn ở SystemConfigService.set() (không chặn ở DTO vì @Allow không hỗ trợ).
  @Allow() value!: object | string | number | boolean;
}
// Export để test DTO validation trực tiếp (xem admin.controller.spec.ts).
export class CreateCouponDto {
  @IsString() code!: string;
  @IsIn(['PERCENT', 'AMOUNT', 'FREESHIP']) type!: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  @IsInt() @Min(0) @MaxIfPercent(100) value!: number;
  @IsOptional() @IsInt() minOrder?: number;
  @IsOptional() @IsInt() maxDiscount?: number;
  @IsString() startAt!: string;
  @IsString() endAt!: string;
  @IsOptional() @IsInt() usageLimit?: number;
  // perUserLimit <= 0 = "không giới hạn" (nhất quán với coupons.service.ts / loyalty.service.ts —
  // grep `perUserLimit > 0`). @Min(0) chỉ chặn số âm vô nghĩa, KHÔNG cấm 0.
  @IsOptional() @IsInt() @Min(0) perUserLimit?: number;
  @IsIn(['PUBLIC', 'TIER', 'USER_GROUP', 'BIRTHDAY', 'INVITE'])
  scope!: 'PUBLIC' | 'TIER' | 'USER_GROUP' | 'BIRTHDAY' | 'INVITE';
}
class ImportDealerPricesDto {
  @IsString() tierId!: string;
  // Dán trực tiếp 2 cột Excel "sku,giá" (mỗi dòng 1 SKU). Hoặc gửi rows JSON.
  @IsOptional() @IsString() csv?: string;
  @IsOptional() @IsArray() rows?: { sku: string; price: number }[];
}
class ImportSoldExternalDto {
  // Dán "sku,số-đã-bán" (mỗi dòng 1 SKU) — tổng đã bán gom từ sàn ngoài. Hoặc rows JSON.
  @IsOptional() @IsString() csv?: string;
  @IsOptional() @IsArray() rows?: { sku: string; count: number }[];
}
class SetUserRoleDto {
  @IsString() phone!: string;
  @IsIn(['CUSTOMER', 'AFFILIATE', 'DEALER', 'STAFF', 'ADMIN'])
  role!: 'CUSTOMER' | 'AFFILIATE' | 'DEALER' | 'STAFF' | 'ADMIN';
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
  constructor(
    private readonly admin: AdminService,
    private readonly catalog: CatalogService,
  ) {}

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

  // Cấp/đổi role theo SĐT — thay script SSH grant-admin.js (có guard @Roles + log ai đổi).
  @Post('users/role')
  setUserRole(@CurrentUser('sub') adminId: string, @Body() dto: SetUserRoleDto) {
    return this.admin.setUserRole(adminId, dto.phone, dto.role);
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

  // "Đã bán" gom từ sàn ngoài: dán "sku,số-đã-bán" hoặc rows JSON.
  @Post('products/sold-external')
  setSoldExternal(@Body() dto: ImportSoldExternalDto) {
    const rows = dto.csv
      ? parseDealerPriceCsv(dto.csv).map((r) => ({ sku: r.sku, count: r.price }))
      : (dto.rows ?? []);
    return this.catalog.setSoldExternal(rows);
  }

  // Tính lại "đã bán trong app" ngay (thường chạy cron 03:00).
  @Post('products/recompute-sold')
  recomputeSold() {
    return this.catalog.recomputeSoldCounts();
  }
}
