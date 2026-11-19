import { Controller, Get, Headers, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ImageFallbackRedirect, ImageResizeService } from './image-resize.service';
import { negotiateFormat } from './image-resize';
import { clientIp } from '../../common/throttle/throttle.config';

@Controller()
export class ImageResizeController {
  constructor(private readonly images: ImageResizeService) {}

  /**
   * Ảnh sản phẩm đổi cỡ: `?u=<ảnh nguồn>&w=<160|320|480|640|960|1280|1920>`. Nguồn chỉ nhận host Pancake/Cloudinary và ảnh của chính API.
   * URL đổi theo nguồn nên cache vĩnh viễn (immutable) + ETag; `Vary: Accept` vì webp/jpeg tuỳ trình duyệt. Thẻ img không kèm token và
   * đếm theo IP, một trang danh mục xin cả chục ảnh nên nâng hạn mức riêng như public-image.
   */
  @Throttle({ default: { limit: 1200, ttl: 60_000 } })
  @Public()
  @Get('img')
  async image(
    @Query('u') source: unknown,
    @Query('w') widthRaw: unknown,
    @Headers('accept') accept: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const width = Number(widthRaw);
    const format = negotiateFormat(accept);
    const headers = {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Accept',
    };
    const key = this.images.keyFor(source, width, format);
    if (key && ifNoneMatch && ifNoneMatch.split(',').map((t) => t.trim().replace(/^W\//, '')).includes(`"${key}"`)) {
      res.status(304).set({ ...headers, ETag: `"${key}"` });
      return;
    }
    let out;
    try {
      out = await this.images.get(source, width, format, clientIp(req));
    } catch (e) {
      // Máy bận (hàng đợi đầy, IP gửi quá nhiều ?v= sai): chuyển về ảnh gốc thay vì 503, không cho cache để lần sau xin lại bản đổi cỡ.
      if (!(e instanceof ImageFallbackRedirect)) throw e;
      res.status(302).set({ ...headers, 'Cache-Control': 'no-store', Location: e.location, 'X-Image-Fallback': e.reason });
      return;
    }
    if (out.degraded) {
      // Bản WebP thay cho AVIF lúc bận mã hoá: cache ngắn, riêng trình duyệt, để vài phút sau xin lại được AVIF.
      res.set({ ...headers, 'Cache-Control': 'private, max-age=300', ETag: out.etag, 'X-Image-Fallback': 'avif-busy' });
    } else {
      res.set({ ...headers, ETag: out.etag });
    }
    return new StreamableFile(out.data, { type: out.mime });
  }
}
