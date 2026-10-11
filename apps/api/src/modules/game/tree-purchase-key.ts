import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Idempotency-Key của POST /game/tree/buy: vắng header thì trả undefined (hành vi cũ, không idempotent);
 * có header mà sai định dạng thì 400 thay vì lặng lẽ bỏ qua, để lỗi client không biến thành "tưởng đã
 * chống bấm đôi". Không trim: khoảng trắng là sai, vì key được dùng nguyên văn để suy ra mã chứng nhận.
 */
export function parseTreeBuyKey(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !KEY_PATTERN.test(raw)) {
    throw new BadRequestException(
      'Idempotency-Key không hợp lệ: cần 8 đến 128 ký tự gồm chữ cái, chữ số, dấu gạch dưới (_) hoặc gạch nối (-).',
    );
  }
  return raw;
}

/**
 * Mã chứng nhận suy ra tất định từ (user, key): chính cột unique `planted_trees.certificateCode` là khoá
 * idempotency nên không cần cột/migration mới. Gắn userId vào đầu vào hash để key của hai user không bao giờ
 * cho cùng mã. Tiền tố cố định tách khỏi mọi chỗ khác dùng sha256 trên key; key không chứa ':' nên chuỗi
 * "user:key" không nhập nhằng.
 *
 * Dài 12 ký tự hex (48 bit), dài hơn mã ngẫu nhiên 8 ký tự của luồng không key: mã này do client chọn gián
 * tiếp, nếu trùng một cây có sẵn thì lượt đó không bao giờ thành công với key ấy, nên cần va chạm tình cờ
 * không đáng kể ở quy mô hàng triệu cây. Không thể trùng mã ngẫu nhiên vì khác độ dài.
 */
export function treeCertificateCodeFor(userId: string, key: string): string {
  const digest = createHash('sha256').update(`game:tree-buy:${userId}:${key}`).digest('hex');
  return `TUBU-${digest.slice(0, 12).toUpperCase()}`;
}
