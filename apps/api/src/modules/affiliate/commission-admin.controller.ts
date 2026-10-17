import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPageQuery } from '../../common/cursor-page-query.dto';
import { clampTake } from '../../common/pagination';
import { CommissionAdminService } from './commission-admin.service';
import { RATE_CSV_MAX_LENGTH } from './commission-rate-csv';

export class ListCommissionRatesQuery extends CursorPageQuery {
  @IsOptional() @IsString() @MaxLength(64) q?: string;
  /** `?missing=1` / `true`: chỉ sản phẩm còn biến thể đang bán chưa có %. */
  @IsOptional()
  @Transform(({ value }) => (value === '1' || value === 'true' ? true : value === '0' || value === 'false' || value === '' ? false : value))
  @IsBoolean()
  missing?: boolean;
}

/** Trần và số chữ số thập phân kiểm ở service (trần đọc từ cấu hình `affiliate.max_rate_pct`). */
export class SetCommissionRateDto {
  @IsNumber({ allowNaN: false, allowInfinity: false }) rate!: number;
}

export class ImportCommissionRatesDto {
  @IsString() @IsNotEmpty() @MaxLength(RATE_CSV_MAX_LENGTH) csv!: string;
}

/** % hoa hồng CTV theo biến thể (D1-01/D3-01) và tra người giới thiệu + hoa hồng của đơn (D3-07). Chỉ ADMIN. */
@ApiTags('admin-commission')
@Roles('ADMIN')
@Controller('admin')
export class CommissionAdminController {
  constructor(private readonly commission: CommissionAdminService) {}

  @Get('commission-rates')
  list(@Query() q: ListCommissionRatesQuery) {
    return this.commission.listProducts({ q: q.q, missing: q.missing, cursor: q.cursor, take: clampTake(q.take, 20, 50) });
  }

  @Put('commission-rates/variations/:id')
  setVariation(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: SetCommissionRateDto) {
    return this.commission.setVariationRate(adminId, id, dto.rate);
  }

  @Put('commission-rates/products/:id')
  setProduct(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: SetCommissionRateDto) {
    return this.commission.setProductRate(adminId, id, dto.rate);
  }

  @Post('commission-rates/fill-missing')
  fillMissing(@CurrentUser('sub') adminId: string, @Body() dto: SetCommissionRateDto) {
    return this.commission.fillMissingRates(adminId, dto.rate);
  }

  @Post('commission-rates/import/preview')
  previewImport(@Body() dto: ImportCommissionRatesDto) {
    return this.commission.previewImport(dto.csv);
  }

  @Post('commission-rates/import/apply')
  applyImport(@CurrentUser('sub') adminId: string, @Body() dto: ImportCommissionRatesDto) {
    return this.commission.applyImport(adminId, dto.csv);
  }

  @Get('orders/:id/referral')
  orderReferral(@Param('id') id: string) {
    return this.commission.orderReferral(id);
  }
}
