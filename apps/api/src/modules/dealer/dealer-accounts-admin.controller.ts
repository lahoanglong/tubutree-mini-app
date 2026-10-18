import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { DealerAccountsAdminService } from './dealer-accounts-admin.service';
import { TIER_ID_PATTERN } from './dealer-tier-input';

export class ListDealerAccountsQuery extends PaginationQuery {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(64) tierId?: string;
  /** `?debtOnly=1` / `true`: chỉ đại lý còn dư nợ. */
  @IsOptional()
  @Transform(({ value }) => (value === '1' || value === 'true' ? true : value === '0' || value === 'false' || value === '' ? false : value))
  @IsBoolean()
  debtOnly?: boolean;
}

/** Kiểu dữ liệu ở đây; khoảng giá trị và trần chiết khấu kiểm ở `tierProblems` để trả câu tiếng Việt gom đủ lỗi. */
export class TierValuesDto {
  @IsString() name!: string;
  @IsInt() minOrderVolume!: number;
  /** Phần trăm: 30 là 30%. */
  @IsNumber({ allowNaN: false, allowInfinity: false }) discountPct!: number;
  @IsInt() creditLimit!: number;
  @IsOptional() @IsString() @MaxLength(40) paymentTerms?: string | null;
}

/** Giá trị bậc admin đã thấy lúc mở form; đã khác trong DB thì server từ chối ghi đè (409). */
export class UpdateDealerTierDto extends TierValuesDto {
  @IsDefined() @ValidateNested() @Type(() => TierValuesDto) expected!: TierValuesDto;
}

export class CreateDealerTierDto extends TierValuesDto {
  @Matches(TIER_ID_PATTERN, { message: 'Mã bậc gồm chữ in hoa, số, gạch dưới, bắt đầu bằng chữ, dài 2–32 ký tự (vd DEALER_1).' }) id!: string;
}

/** Danh sách đại lý đã duyệt kèm công nợ (D1-06). Chỉ đọc; ghi nhận tiền trả nợ vẫn ở DealerCreditAdminController. */
@ApiTags('admin-dealers')
@Roles('ADMIN')
@Controller('admin/dealers')
export class DealerAccountsAdminController {
  constructor(private readonly service: DealerAccountsAdminService) {}

  @AllowStaff('KE_TOAN')
  @Get('accounts')
  accounts(@Query() q: ListDealerAccountsQuery) {
    return this.service.listAccounts({ page: q.page, limit: q.limit, search: q.search, tierId: q.tierId, debtOnly: q.debtOnly });
  }
}

/**
 * Bậc đại lý: chiết khấu, hạn mức công nợ, điều kiện. Đây là chỗ ghi tham số tiền nên chỉ ADMIN; GET admin/dealer-tiers (chọn bậc
 * khi duyệt đại lý) vẫn ở AdminController.
 */
@ApiTags('admin-dealers')
@Roles('ADMIN')
@Controller('admin/dealer-tiers')
export class DealerTierAdminController {
  constructor(private readonly service: DealerAccountsAdminService) {}

  @Get('manage')
  manage() {
    return this.service.listTiers();
  }

  @Get('history')
  history() {
    return this.service.tierHistory();
  }

  @Post()
  create(@CurrentUser('sub') adminId: string, @Body() dto: CreateDealerTierDto) {
    return this.service.createTier(adminId, dto);
  }

  @Put(':id')
  update(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: UpdateDealerTierDto) {
    const { expected, ...input } = dto;
    return this.service.updateTier(adminId, id, input, expected);
  }
}
