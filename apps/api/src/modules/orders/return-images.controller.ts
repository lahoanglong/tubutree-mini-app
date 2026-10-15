import { Controller, Get, Param, ParseIntPipe, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { OrderReturnsService } from './order-returns.service';

/**
 * Ảnh minh chứng đổi/trả base64 (danh sách trả đường dẫn này thay vì nhúng nguyên văn). Không đăng nhập được: thẻ img
 * không gửi token, nên quyền xem là mã `v` (md5 nội dung) mà chỉ danh sách của chính khách/admin/gian hàng mới có.
 * Nội dung gắn với `v` nên cache vĩnh viễn được, nhưng `private` để CDN dùng chung không giữ ảnh của khách. helmet đặt
 * Cross-Origin-Resource-Policy: same-origin mặc định; miniapp và web khác origin nạp ảnh bằng thẻ img nên route này phải
 * mở cross-origin.
 */
@Controller('returns')
export class ReturnImagesController {
  constructor(private readonly returns: OrderReturnsService) {}

  @Public()
  @Get(':id/images/:index')
  async image(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @Query('v') version: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { mime, data } = await this.returns.getImage(id, index, version);
    res.set({
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(data, { type: mime });
  }
}
