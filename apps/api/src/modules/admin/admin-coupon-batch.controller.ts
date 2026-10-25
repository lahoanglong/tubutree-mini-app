import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminCouponBatchService, BATCH_PREFIX_RE, COUPON_BATCH_MAX, LINK_TOKEN_RE } from './admin-coupon-batch.service';
import { COUPON_AMOUNT_MAX, MaxIfAmount, MaxIfPercent } from './admin.controller';

const upperTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** Trang đích và nhãn nguồn của link in trong CSV. */
export class ClaimLinkDto {
  @IsOptional() @IsIn(['home', 'scan']) page?: 'home' | 'scan';
  @IsOptional() @Transform(lowerTrim) @Matches(LINK_TOKEN_RE, { message: 'Nhãn nguồn gồm chữ thường không dấu, số, gạch ngang hoặc gạch dưới, tối đa 40 ký tự.' }) src?: string;
  @IsOptional() @Transform(lowerTrim) @Matches(LINK_TOKEN_RE, { message: 'Tên đợt thẻ gồm chữ thường không dấu, số, gạch ngang hoặc gạch dưới, tối đa 40 ký tự, vd 2611.' }) card?: string;
}

export class CreateCouponBatchDto {
  @Transform(upperTrim)
  @Matches(BATCH_PREFIX_RE, { message: 'Tiền tố gồm 2–16 chữ in hoa không dấu hoặc số, vd SHOPEE11.' })
  prefix!: string;
  @IsInt() @Min(1) @Max(COUPON_BATCH_MAX, { message: `Mỗi lô tối đa ${COUPON_BATCH_MAX} mã; cần nhiều hơn thì tạo thêm lô với tiền tố khác.` })
  quantity!: number;
  @IsIn(['PERCENT', 'AMOUNT', 'FREESHIP']) type!: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  @IsInt() @Min(0) @MaxIfPercent(100) @MaxIfAmount(COUPON_AMOUNT_MAX) value!: number;
  @IsOptional() @IsInt() @Min(0, { message: 'Đơn tối thiểu không được âm.' }) minOrder?: number;
  @IsOptional() @IsInt() @Min(0, { message: 'Giảm tối đa không được âm.' }) maxDiscount?: number;
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsOptional() @IsBoolean() newCustomerOnly?: boolean;
  @IsOptional() @ValidateNested() @Type(() => ClaimLinkDto) link?: ClaimLinkDto;
}

export class SetCouponBatchActiveDto {
  @IsBoolean() isActive!: boolean;
}

@ApiTags('admin-coupon-batches')
@Roles('ADMIN')
@AllowStaff('MARKETING')
@Controller('admin/coupon-batches')
export class AdminCouponBatchController {
  constructor(private readonly batches: AdminCouponBatchService) {}

  @Post()
  create(@CurrentUser('sub') actorId: string, @CurrentUser('role') role: string, @Body() dto: CreateCouponBatchDto) {
    return this.batches.create(dto, { id: actorId, staff: role !== 'ADMIN' });
  }

  @Get()
  list(@CurrentUser('sub') actorId: string, @CurrentUser('role') role: string) {
    return this.batches.list({ id: actorId, staff: role !== 'ADMIN' });
  }

  /** Link gốc Mini App để in QR mã chung; nhân viên Marketing không đọc được tab Cấu hình. */
  @Get('claim-url-base')
  claimUrlBase() {
    return this.batches.claimBase();
  }

  @Get(':batch/codes')
  codes(@CurrentUser('sub') actorId: string, @CurrentUser('role') role: string, @Param('batch') batch: string, @Query() link: ClaimLinkDto) {
    return this.batches.codes(batch, { id: actorId, staff: role !== 'ADMIN' }, link);
  }

  @Patch(':batch')
  setActive(
    @CurrentUser('sub') actorId: string,
    @CurrentUser('role') role: string,
    @Param('batch') batch: string,
    @Body() dto: SetCouponBatchActiveDto,
  ) {
    return this.batches.setActive(batch, dto.isActive, { id: actorId, staff: role !== 'ADMIN' });
  }
}
