import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ZaloOaTokenService } from '../zns/zalo-oa-token.service';

/**
 * Client gửi tin "Tư vấn/CSKH" qua Zalo OA — KHÁC API ZNS templated (`ZnsClient`): đây là
 * tin nhắn văn bản tự do, chỉ gửi được trong cửa sổ 48h kể từ tương tác cuối của user
 * (§ docs/2026-07-05-retention-ctv-conversion-research.md). Dùng cho CSKH quick-reply/auto-reply.
 *
 * TODO xác nhận lại endpoint/format request chính xác với tài liệu chính thức Zalo OA (Send API)
 * lúc go-live — request body dưới đây theo cấu trúc `recipient.user_id` + `message.text` chuẩn
 * OA Send API tại thời điểm viết, có thể cần điều chỉnh khi đăng ký quyền gửi tin CSKH thật.
 */
@Injectable()
export class ZaloOaMessageClient {
  private readonly logger = new Logger(ZaloOaMessageClient.name);
  private readonly baseUrl = 'https://openapi.zalo.me/v3.0/oa/message/cs';

  constructor(private readonly tokens: ZaloOaTokenService) {}

  async sendText(zaloUserId: string, text: string): Promise<boolean> {
    const accessToken = await this.tokens.getAccessToken();
    if (!accessToken) {
      this.logger.warn(`Zalo OA chưa cấu hình access token — skip gửi tin CSKH cho ${zaloUserId}.`);
      return false;
    }
    try {
      await axios.post(
        this.baseUrl,
        { recipient: { user_id: zaloUserId }, message: { text } },
        { headers: { access_token: accessToken }, timeout: 10000 },
      );
      return true;
    } catch (err) {
      this.logger.error(`Gửi tin CSKH Zalo OA thất bại: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
