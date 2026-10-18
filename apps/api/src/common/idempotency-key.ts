import { BadRequestException } from '@nestjs/common';
import { parseTreeBuyKey } from '../modules/game/tree-purchase-key';

/** Cùng mẫu và cùng câu báo lỗi với POST /game/tree/buy; khác ở chỗ thiếu header cũng là 400. */
export function requireIdempotencyKey(raw: unknown): string {
  const key = parseTreeBuyKey(raw);
  if (key === undefined) {
    throw new BadRequestException(
      'Thiếu Idempotency-Key: cần 8 đến 128 ký tự gồm chữ cái, chữ số, dấu gạch dưới (_) hoặc gạch nối (-).',
    );
  }
  return key;
}
