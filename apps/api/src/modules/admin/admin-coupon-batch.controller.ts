import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { AdminCouponBatchService, BATCH_PREFIX_RE, COUPON_BATCH_MAX } from './admin-coupon-batch.service';
import { COUPON_AMOUNT_MAX, MaxIfAmount, MaxIfPercent } from './admin.controller';

const upperTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

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
  create(@Body() dto: CreateCouponBatchDto) {
    return this.batches.create(dto);
  }

  @Get()
  list() {
    return this.batches.list();
  }

  @Get(':batch/codes')
  codes(@Param('batch') batch: string) {
    return this.batches.codes(batch);
  }

  @Patch(':batch')
  setActive(@Param('batch') batch: string, @Body() dto: SetCouponBatchActiveDto) {
    return this.batches.setActive(batch, dto.isActive);
  }
}
