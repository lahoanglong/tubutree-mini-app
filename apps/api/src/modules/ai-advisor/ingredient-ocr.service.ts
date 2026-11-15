import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AnthropicCallError, AnthropicClient, AnthropicTruncatedError, type AnthropicImageInput } from './anthropic.client';
import { buildIngredientOcrMessages, OCR_MAX_TOKENS, parseIngredientOcrReply, type IngredientOcrReply } from './ingredient-ocr';

/** Apache proxy cắt ở 60 giây: dừng chờ model ở 40 giây để còn chỗ cho truy vấn DB và gửi JSON về. */
export const OCR_TIMEOUT_MS = 40_000;
/** Mỗi lượt giữ một kết nối tới model tới 40 giây và tốn tiền; công cụ này chỉ cho admin dùng nên hai lượt cùng lúc là đủ. */
export const OCR_MAX_CONCURRENT = 2;

export const OCR_MSG = {
  notConfigured: 'Chưa cấu hình AI đọc ảnh bao bì (thiếu ANTHROPIC_API_KEY). Bạn vẫn nhập tay thành phần rồi bấm Lưu được.',
  busy: 'AI đang đọc ảnh khác. Thử lại sau ít phút, hoặc nhập tay thành phần.',
  timeout: 'AI đọc ảnh quá thời gian chờ. Thử lại với ảnh nhỏ hơn, hoặc nhập tay thành phần.',
  error: 'AI chưa đọc được ảnh lúc này. Thử lại sau, hoặc nhập tay thành phần.',
  truncated: 'Mục Thành phần trên nhãn dài quá nên AI đọc chưa hết, danh sách bị cắt giữa chừng. Chụp riêng phần "Thành phần" thật gần và rõ rồi thử lại, hoặc nhập tay thành phần.',
} as const;

/**
 * AI đọc mục "Thành phần" trên ảnh bao bì cho admin (dùng chung ANTHROPIC_API_KEY và CLAUDE_API_MODEL với Story Studio). Chỉ trả bản nháp tên thành phần:
 * không ghi DB, không tự lưu. Mọi lỗi từ model đổi thành 503 tiếng Việt, log chỉ mang loại lỗi, không bao giờ mang ảnh, lời model hay khoá.
 */
@Injectable()
export class IngredientOcrService {
  private readonly logger = new Logger(IngredientOcrService.name);
  private inFlight = 0;

  constructor(private readonly anthropic: AnthropicClient) {}

  isConfigured(): boolean {
    return this.anthropic.isConfigured();
  }

  async read(image: AnthropicImageInput, productName: string): Promise<IngredientOcrReply> {
    if (!this.anthropic.isConfigured()) throw new ServiceUnavailableException(OCR_MSG.notConfigured);
    if (this.inFlight >= OCR_MAX_CONCURRENT) {
      this.logger.warn('Đã đủ lượt đọc ảnh bao bì đang chạy, bỏ qua lượt này.');
      throw new ServiceUnavailableException(OCR_MSG.busy);
    }
    this.inFlight += 1;
    try {
      const { system, user } = buildIngredientOcrMessages(productName);
      const text = await this.anthropic.completeWithImage(system, user, image, OCR_MAX_TOKENS, OCR_TIMEOUT_MS);
      const reply = parseIngredientOcrReply(text);
      if (!reply) {
        this.logger.warn('Đọc ảnh bao bì: Claude trả chữ không dựng được JSON.');
        // Có mở ngoặc `{` mà không có `}` nào sau nó là JSON cụt giữa chừng (proxy không báo stop_reason), khác ảnh không có mục Thành phần và khác JSON đủ nhưng sai định dạng.
        if (text.indexOf('{') >= 0 && text.lastIndexOf('}') < text.indexOf('{')) throw new ServiceUnavailableException(OCR_MSG.truncated);
        return { readable: false, ingredients: [] };
      }
      return reply;
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      if (e instanceof AnthropicTruncatedError) {
        this.logger.warn('Đọc ảnh bao bì: Claude chạm trần token, JSON bị cụt.');
        throw new ServiceUnavailableException(OCR_MSG.truncated);
      }
      const kind = e instanceof AnthropicCallError ? e.kind : 'error';
      this.logger.warn(`Đọc ảnh bao bì: Claude lỗi (${kind}).`);
      throw new ServiceUnavailableException(kind === 'busy' ? OCR_MSG.busy : kind === 'timeout' ? OCR_MSG.timeout : OCR_MSG.error);
    } finally {
      this.inFlight -= 1;
    }
  }
}
