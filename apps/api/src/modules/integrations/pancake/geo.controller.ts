import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import type { GeoService } from './geo.service';

/**
 * Địa giới hành chính (proxy Pancake) cho FE address-picker. PUBLIC: dữ liệu tham chiếu,
 * cần cả khi khách chưa đăng nhập. Mã trả về đúng hệ Pancake → đặt đơn không lỗi.
 */
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Public()
  @Get('provinces')
  async provinces() {
    return this.geo.provinces();
  }

  @Public()
  @Get('communes')
  async communes(@Query('provinceCode') provinceCode?: string) {
    if (!provinceCode) throw new BadRequestException('provinceCode là bắt buộc.');
    return this.geo.communes(provinceCode);
  }
}
