import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PublicImageService } from './public-image.service';

@Controller()
export class PublicImageController {
  constructor(private readonly images: PublicImageService) {}

  /**
   * Ảnh base64 của sản phẩm, nhãn hàng, khoá học: JSON công khai trả đường dẫn này thay vì nhúng nguyên văn. Cache vĩnh viễn khi mã
   * `v` khớp nội dung ảnh hiện tại, 5 phút khi `v` sai hoặc thiếu. helmet đặt Cross-Origin-Resource-Policy: same-origin mặc định;
   * web và Mini App khác origin nạp ảnh bằng thẻ img nên route này phải mở cross-origin. Thẻ img không kèm token và đếm theo IP,
   * một trang danh mục có nhiều ảnh nên nâng hạn mức riêng.
   */
  @Throttle({ default: { limit: 1200, ttl: 60_000 } })
  @Public()
  @Get('public-image/:kind/:id/:slot')
  async image(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Param('slot') slot: string,
    @Query('v') version: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { mime, data, versionOk } = await this.images.get(kind, id, slot, version);
    res.set({
      'Cache-Control': versionOk ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(data, { type: mime });
  }
}
