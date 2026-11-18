import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { FREESHIP_UPSELL_EXCLUDE_MAX, PRODUCT_SLUGS_QUERY_MAX_CHARS } from '@tubutree/shared-types';
import { MaxCsvItems } from '../../../common/decorators/max-csv-items.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { PublicCache } from '../../../common/decorators/public-cache.decorator';
import { parseExcludeSlugs } from './freeship-upsell';
import { FreeshipUpsellService } from './freeship-upsell.service';

export class FreeshipUpsellQuery {
  /** Số còn thiếu để Miễn phí giao hàng (đồng), đúng số app đang hiện trên thanh tiến độ. */
  @Type(() => Number) @IsInt() @Min(1) @Max(100_000_000)
  gap!: number;

  /** Slug các món đã có trong giỏ, cách nhau bằng dấu phẩy (tối đa `FREESHIP_UPSELL_EXCLUDE_MAX`). */
  @IsOptional() @IsString() @MaxLength(PRODUCT_SLUGS_QUERY_MAX_CHARS) @MaxCsvItems(FREESHIP_UPSELL_EXCLUDE_MAX)
  exclude?: string;
}

@Controller('upsell')
export class FreeshipUpsellController {
  constructor(private readonly upsell: FreeshipUpsellService) {}

  // Công khai (giỏ khách chưa đăng nhập trên web cũng gọi được) và không đọc người gọi: kết quả chỉ phụ thuộc tham số nên cache chung như /products.
  @Public()
  @PublicCache('CATALOG')
  @Get('freeship')
  freeship(@Query() query: FreeshipUpsellQuery) {
    return this.upsell.addons(query.gap, parseExcludeSlugs(query.exclude));
  }
}
