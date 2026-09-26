import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  registerDecorator,
} from 'class-validator';
import type { ValidationArguments, ValidationOptions } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { AdminService } from './admin.service';
import { CatalogService } from '../catalog/catalog.service';
import { ADMIN_ORDER_STATUSES, type RecyclingFilter } from './admin-order-filter';

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

/**
 * scopeMeta đúng field theo scope — PHẢI khớp isCouponEligible (coupon-scope.ts), nguồn sự thật
 * duy nhất cho điều kiện eligible: TIER cần meta.tierId (string không rỗng), USER_GROUP cần
 * meta.userId (string không rỗng). Trước đây DTO không có field scopeMeta → coupon tạo với scope
 * TIER/USER_GROUP luôn thiếu scopeMeta → isCouponEligible fail-closed ở MỌI user (không khớp
 * tierId/userId nào) → coupon KHÔNG AI DÙNG ĐƯỢC, không lỗi khi tạo nên bug lọt qua admin UI mà
 * không ai biết tới khi có khách báo "mã không dùng được".
 */
function RequiredScopeMeta(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'requiredScopeMeta',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const dto = args.object as { scope?: string };
          const meta = value as { tierId?: unknown; userId?: unknown } | null | undefined;
          if (dto.scope === 'TIER') {
            return typeof meta?.tierId === 'string' && meta.tierId.trim().length > 0;
          }
          if (dto.scope === 'USER_GROUP') {
            return typeof meta?.userId === 'string' && meta.userId.trim().length > 0;
          }
          return true; // scope khác (PUBLIC/BIRTHDAY/INVITE): không bắt buộc scopeMeta.
        },
        defaultMessage(args: ValidationArguments) {
          const dto = args.object as { scope?: string };
          if (dto.scope === 'TIER') return 'scopeMeta.tierId bắt buộc (không rỗng) khi scope=TIER.';
          if (dto.scope === 'USER_GROUP') return 'scopeMeta.userId bắt buộc (không rỗng) khi scope=USER_GROUP.';
          return 'scopeMeta không hợp lệ.';
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
export class ReviewMerchantProductDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() rejectReason?: string;
}
class SetConfigDto {
  @IsString() @IsNotEmpty() key!: string;
  // value tự do (object/số/chuỗi/boolean) — @Allow để ValidationPipe không loại bỏ.
  // null/undefined bị chặn ở SystemConfigService.set() (không chặn ở DTO vì @Allow không hỗ trợ).
  @Allow() value!: object | string | number | boolean;
}
// Export để test DTO validation trực tiếp (xem admin.controller.spec.ts).
export class CreateCouponDto {
  @IsString() @IsNotEmpty() @MaxLength(64) code!: string;
  @IsIn(['PERCENT', 'AMOUNT', 'FREESHIP']) type!: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  @IsInt() @Min(0) @MaxIfPercent(100) value!: number;
  @IsOptional() @IsInt() minOrder?: number;
  @IsOptional() @IsInt() maxDiscount?: number;
  // Bug 2: trước đây chỉ @IsString() — ngày sai định dạng lọt qua validation, new Date() ra
  // Invalid Date, Prisma serialize RangeError khi ghi startAt/endAt → lọt qua
  // PrismaExceptionFilter (chỉ bắt PrismaClientKnownRequestError) → 500 trần cho admin.
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsOptional() @IsInt() usageLimit?: number;
  // perUserLimit <= 0 = "không giới hạn" (nhất quán với coupons.service.ts / loyalty.service.ts —
  // grep `perUserLimit > 0`). @Min(0) chỉ chặn số âm vô nghĩa, KHÔNG cấm 0.
  @IsOptional() @IsInt() @Min(0) perUserLimit?: number;
  @IsIn(['PUBLIC', 'TIER', 'USER_GROUP', 'BIRTHDAY', 'INVITE'])
  scope!: 'PUBLIC' | 'TIER' | 'USER_GROUP' | 'BIRTHDAY' | 'INVITE';
  // Chỉ bắt buộc khi scope=TIER (cần tierId) hoặc USER_GROUP (cần userId) — xem RequiredScopeMeta().
  // Bỏ trống cho PUBLIC/BIRTHDAY/INVITE (BIRTHDAY/INVITE hiện DENY mọi user ở isCouponEligible,
  // chưa có logic chính thức — tạo được nhưng chưa dùng được, không phải lỗi của scopeMeta).
  @ValidateIf((o: CreateCouponDto) => o.scope === 'TIER' || o.scope === 'USER_GROUP')
  @IsObject()
  @RequiredScopeMeta()
  scopeMeta?: { tierId?: string; userId?: string };
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
class UpdateOrderStatusDto {
  @IsIn(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'RETURNED', 'CANCELLED'])
  status!: 'PENDING_PAYMENT' | 'CONFIRMED' | 'PACKED' | 'SHIPPING' | 'DELIVERED' | 'RETURNED' | 'CANCELLED';

  @IsOptional()
  @IsString()
  note?: string;
}

/**
 * Query có lọc — PHẢI khai báo trong DTO. ValidationPipe toàn cục bật forbidNonWhitelisted, nên
 * `@Query() q: PaginationQuery` kèm `@Query('status')` riêng làm MỌI request có `?status=`/`?search=`
 * bị 400 "property status should not exist" (web admin: lọc trạng thái/tìm đơn, lọc hồ sơ đại lý,
 * lọc đổi/trả đều hỏng).
 */
export class DealerAppsQuery extends PaginationQuery {
  // Giá trị lạ lọt xuống Prisma thành PrismaClientValidationError → 500 trần; chặn bằng enum thật.
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']) status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
}

export class ReturnRequestsQuery extends PaginationQuery {
  @IsOptional() @IsIn(['REQUESTED', 'APPROVED', 'REJECTED']) status?: 'REQUESTED' | 'APPROVED' | 'REJECTED';
}

export class ListOrdersQuery extends PaginationQuery {
  @IsOptional() @IsIn([...ADMIN_ORDER_STATUSES]) status?: (typeof ADMIN_ORDER_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  /** attention = "Cần xử lý thu gom"; all = mọi đơn có chọn thu gom tái chế. */
  @IsOptional() @IsIn(['attention', 'all']) recycling?: RecyclingFilter;
}

export class DealerPriceHistoryQuery extends PaginationQuery {
  @IsOptional() @IsString() @MaxLength(40) variationId?: string;
}

export class GomdonRetryDto {
  /**
   * Bắt buộc true khi vận đơn ở NEEDS_MANUAL_CHECK: admin đã tra Gomdon theo mã đơn và xác nhận KHÔNG
   * có vận đơn nào (tránh tạo vận đơn thứ hai → bưu tá giao 2 lần).
   */
  @IsOptional() @IsBoolean() confirmedNoWaybill?: boolean;
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

  @Get('dashboard/stats')
  dashboardStats() {
    return this.admin.getDashboardStats();
  }

  @Get('dealer-applications')
  dealerApps(@Query() q: DealerAppsQuery) {
    return this.admin.listDealerApplications(q.status, q.page, q.limit);
  }

  @Post('dealer-applications/:id/review')
  review(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.admin.reviewDealerApplication(adminId, id, dto.approve, dto.tierId, dto.reason);
  }

  @Get('return-requests')
  returns(@Query() q: ReturnRequestsQuery) {
    return this.admin.listReturnRequests(q.status, q.page, q.limit);
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
  orders(@Query() q: ListOrdersQuery) {
    return this.admin.listOrders(q.page, q.limit, q.status, q.search, q.recycling);
  }

  /**
   * Tạo lại vận đơn thu gom Gomdon (FAILED / NOT_CONFIGURED / NEEDS_MANUAL_CHECK + xác nhận / Gomdon đã
   * huỷ vận đơn cũ). Luật an toàn nằm ở GomdonOrderService.retryPush — lỗi của nó trả nguyên văn.
   */
  @Post('orders/:id/gomdon/retry')
  retryGomdon(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: GomdonRetryDto) {
    return this.admin.retryGomdonPush(adminId, id, dto.confirmedNoWaybill);
  }

  /** Huỷ vận đơn Gomdon (đơn đã huỷ → xếp job huỷ; đơn còn hiệu lực → huỷ ngay). */
  @Post('orders/:id/gomdon/cancel-waybill')
  cancelGomdonWaybill(@CurrentUser('sub') adminId: string, @Param('id') id: string) {
    return this.admin.cancelGomdonWaybill(adminId, id);
  }

  /** Tình trạng tích hợp Gomdon (chỉ boolean — không bao giờ trả tài khoản/mật khẩu). */
  @Get('gomdon/status')
  gomdonStatus() {
    return this.admin.gomdonStatus();
  }

  /** Sổ ghi vết: ai đổi trạng thái đơn này, từ đâu sang đâu, lúc nào. */
  @Get('orders/:id/status-history')
  orderStatusHistory(@Param('id') id: string) {
    return this.admin.orderStatusHistory(id);
  }

  @Put('orders/:id/status')
  updateOrderStatus(
    @CurrentUser('sub') adminId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.admin.updateOrderStatus(adminId, id, dto.status, dto.note);
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
  dealerPriceHistory(@Query() q: DealerPriceHistoryQuery) {
    return this.admin.getDealerPriceHistory(q.variationId, q.page, q.limit);
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

  // ── Duyệt sản phẩm do đối tác đăng ──
  @Get('merchant-products/pending')
  listPendingMerchantProducts(@Query() q: PaginationQuery) {
    return this.admin.listPendingMerchantProducts(q.page, q.limit);
  }

  @Post('merchant-products/:id/review')
  reviewMerchantProduct(
    @CurrentUser('sub') adminId: string,
    @Param('id') productId: string,
    @Body() dto: ReviewMerchantProductDto,
  ) {
    return this.admin.reviewMerchantProduct(adminId, productId, dto.approve, dto.rejectReason);
  }
}
