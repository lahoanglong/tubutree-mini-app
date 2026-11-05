import { applyDecorators, BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const BAD_CURSOR = 'Con trỏ trang không hợp lệ. Bạn tải lại danh sách nhé.';

export interface KeysetCursor {
  createdAt: Date;
  id: string;
}

/** Con trỏ keyset `(createdAt, id)` cho danh sách sắp xếp mới nhất trước; opaque với client. `createdAt` là timestamp(3) nên mili giây là đủ. */
export function encodeKeysetCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.getTime()}|${row.id}`, 'utf8').toString('base64url');
}

export function decodeKeysetCursor(raw: string): KeysetCursor {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = text.indexOf('|');
  const ms = Number(text.slice(0, sep));
  const id = text.slice(sep + 1);
  if (sep <= 0 || !/^\d{1,15}$/.test(text.slice(0, sep)) || !Number.isFinite(ms) || !id || id.length > 64) {
    throw new BadRequestException(BAD_CURSOR);
  }
  const createdAt = new Date(ms);
  if (Number.isNaN(createdAt.getTime())) throw new BadRequestException(BAD_CURSOR);
  return { createdAt, id };
}

/** Điều kiện lấy các dòng đứng SAU con trỏ khi sắp `createdAt desc, id desc`. */
export function keysetAfter(c: KeysetCursor) {
  return { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] };
}

export const KEYSET_ORDER = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

/** Thuộc tính `cursor` tuỳ chọn của query danh sách; chuỗi rỗng coi như không gửi. */
export const KeysetCursorField = () =>
  applyDecorators(
    IsOptional(),
    Transform(({ value }) => (value === '' ? undefined : value)),
    IsString(),
    MaxLength(120),
  );
