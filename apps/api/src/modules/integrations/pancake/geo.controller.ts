import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Public } from '../../../common/decorators/public.decorator';
import { PublicCache } from '../../../common/decorators/public-cache.decorator';
import { GeoService } from './geo.service';

/** Mảng/object (?provinceCode=a&provinceCode=b) không được lọt xuống làm khoá cache của GeoService. */
export class GeoCommunesQuery {
  @IsOptional() @IsString() provinceCode?: string;
}

/**
 * Địa giới hành chính (proxy Pancake) cho FE address-picker. PUBLIC: dữ liệu tham chiếu,
 * cần cả khi khách chưa đăng nhập. Mã trả về đúng hệ Pancake → đặt đơn không lỗi.
 */
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Public()
  @PublicCache('STATIC')
  @Get('provinces')
  async provinces() {
    return this.geo.provinces();
  }

  @Public()
  @PublicCache('STATIC')
  @Get('communes')
  async communes(@Query() query: GeoCommunesQuery) {
    if (!query.provinceCode) throw new BadRequestException('provinceCode là bắt buộc.');
    return this.geo.communes(query.provinceCode);
  }
}
