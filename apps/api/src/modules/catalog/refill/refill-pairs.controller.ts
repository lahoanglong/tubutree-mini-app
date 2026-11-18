import { Controller, Get, Header, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { MaxCsvItems } from '../../../common/decorators/max-csv-items.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { PublicCache } from '../../../common/decorators/public-cache.decorator';
import { REFILL_PAIRS_IDS_MAX, parseRefillIds } from './refill-pairs';
import { RefillPairsService } from './refill-pairs.service';

export class RefillPairsQuery {
  /** Id sản phẩm (chai) cách nhau bằng dấu phẩy, tối đa `REFILL_PAIRS_IDS_MAX`. */
  @IsOptional() @IsString() @MaxLength(REFILL_PAIRS_IDS_MAX * 41) @MaxCsvItems(REFILL_PAIRS_IDS_MAX)
  ids?: string;
}

@Controller('catalog/refill-pairs')
export class RefillPairsController {
  constructor(private readonly refill: RefillPairsService) {}

  // Công khai và không đọc người gọi: kết quả chỉ phụ thuộc danh mục và cấu hình nên cache chung như /products. Cờ tắt trả `{}`.
  @Public()
  @PublicCache('CATALOG')
  @Get()
  pairs(@Query() q: RefillPairsQuery) {
    return this.refill.pairsFor(parseRefillIds(q.ids));
  }

  /** Chỉ chai khách đã nhận trong một đơn đã giao; theo khách nên không để proxy/CDN giữ chung. */
  @Header('Cache-Control', 'private, no-store')
  @Get('mine')
  mine(@CurrentUser('sub') userId: string, @Query() q: RefillPairsQuery) {
    return this.refill.minePairsFor(userId, parseRefillIds(q.ids));
  }
}
