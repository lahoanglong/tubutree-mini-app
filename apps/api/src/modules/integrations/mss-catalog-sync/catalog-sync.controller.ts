import { BadRequestException, Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { MssSignedRoute } from '../mss/mss-inbound.guard';
import { MSS_TIMESTAMP_HEADER } from '../mss/mss-signer';
import { mssSignedAt, parseCatalogSyncBody } from './catalog-sync-body';
import { CatalogSyncService, type CatalogSyncReply } from './catalog-sync.service';

/**
 * MSS đẩy nội dung sản phẩm và tồn Pancake sang Tubu (sau MssInboundGuard: HMAC trên thân thô, ±300 giây). Đường chính
 * `/api/integrations/mss/catalog-sync` đi qua biên như các route MSS khác; `/api/internal/mss/catalog-sync` là tên khác cho lời gọi trong
 * mạng nội bộ (Caddy/Apache chặn `/api/internal/*` với Internet). Trả 200 kèm số đếm từng phần; cờ chưa có hiệu lực vẫn 200 với
 * `status: "disabled"` để MSS không gửi lại mãi. Hợp đồng ở `docs/integrations/mss-catalog-sync.md`.
 */
@Controller(['integrations/mss', 'internal/mss'])
@MssSignedRoute()
@SkipThrottle()
export class CatalogSyncController {
  constructor(private readonly sync: CatalogSyncService) {}

  @Post('catalog-sync')
  @HttpCode(200)
  async receive(@Body() body: unknown, @Headers(MSS_TIMESTAMP_HEADER) timestamp?: string): Promise<CatalogSyncReply> {
    const parsed = parseCatalogSyncBody(body);
    if (!parsed.ok) throw new BadRequestException({ error: parsed.error, message: parsed.error });
    const signedAt = mssSignedAt(timestamp);
    if (!signedAt) throw new BadRequestException({ error: 'invalid_body', message: 'invalid_body' });
    return this.sync.receive({ ...parsed.value, signedAt });
  }
}
