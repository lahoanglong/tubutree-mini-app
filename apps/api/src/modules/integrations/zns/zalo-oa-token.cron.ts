import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ZaloOaTokenService } from './zalo-oa-token.service';

/** Làm mới OA access token Zalo định kỳ (token sống ~25h) → ZNS không chết giữa chừng. */
@Injectable()
export class ZaloOaTokenCron {
  private readonly logger = new Logger(ZaloOaTokenCron.name);
  constructor(private readonly tokens: ZaloOaTokenService) {}

  // Mỗi 6 giờ: chỉ refresh khi token sắp hết hạn (≤6h) — tránh xoay refresh_token vô ích.
  //
  // Toàn thân bọc try/catch: @Cron của @nestjs/schedule không tự bắt lỗi — một lần refresh lỗi
  // (network, Zalo trả lỗi...) ném ra ngoài là unhandledRejection, mà Node 20 mặc định crash cả
  // process (sập toàn bộ API, không chỉ riêng ZNS).
  @Cron('0 0 */6 * * *')
  async refresh() {
    try {
      const ok = await this.tokens.refreshIfNeeded();
      if (ok) this.logger.log('Đã làm mới Zalo OA access token.');
    } catch (err) {
      this.logger.error(`Làm mới Zalo OA access token lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }
}
