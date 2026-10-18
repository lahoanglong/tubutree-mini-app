import { BadRequestException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { decodeServedImage } from '../../common/served-image';
import { isStorefrontImageValue } from '../../common/uploaded-image';

export type StorefrontImageKind = 'avatar' | 'cover';

export const isStorefrontImageKind = (v: unknown): v is StorefrontImageKind => v === 'avatar' || v === 'cover';

/**
 * Mã `v` gắn vào đường dẫn ảnh: đổi theo nội dung ảnh nên URL cũ không phục vụ ảnh mới và trình duyệt cache vĩnh viễn được.
 * Gắn thêm gian hàng và loại ảnh để mã của ảnh này không mở được ảnh khác.
 */
export function storefrontImageVersion(storefrontId: string, kind: StorefrontImageKind, image: string): string {
  return createHash('md5').update(`${storefrontId}:${kind}:${image}`).digest('hex');
}

/** Đường dẫn tương đối tới API của ảnh base64 (đích của endpoint ảnh gian hàng). */
export function storefrontImageRef(storefrontId: string, kind: StorefrontImageKind, version: string): string {
  return `/storefront/image/${storefrontId}/${kind}?v=${version}`;
}

export function matchesStorefrontImageVersion(given: unknown, storefrontId: string, kind: StorefrontImageKind, image: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(storefrontImageVersion(storefrontId, kind, image));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Giá trị ảnh đưa vào JSON công khai: ảnh base64 (ảnh tải thẳng khi chưa có Cloudinary, tới ~1,5 MB) chỉ đi ra dưới dạng đường dẫn
 * tới endpoint ảnh để JSON nhẹ, trang công khai và thẻ chia sẻ không nhúng cả ảnh. URL thường giữ nguyên. data URL không phục vụ
 * được (SVG, HTML, base64 hỏng) bỏ đi thay vì lọt ra công khai.
 */
export function publicStorefrontImage(storefrontId: string, kind: StorefrontImageKind, value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('data:')) return value;
  return decodeServedImage(value) ? storefrontImageRef(storefrontId, kind, storefrontImageVersion(storefrontId, kind, value)) : null;
}

const IMAGE_FIELDS = ['avatarUrl', 'coverUrl'] as const;

/**
 * Ảnh đại diện/ảnh bìa mới phải là https hoặc ảnh raster base64 (hoặc rỗng để xoá). Chỉ kiểm giá trị khác giá trị đang lưu: trình dựng
 * và cổng /merchant gửi lại cả hai ảnh mỗi lần Lưu, nên gian hàng cũ lưu ảnh http hay SVG từ trước vẫn đổi được tên mà không bị 400.
 */
export function assertStorefrontImagesAllowed(
  dto: { avatarUrl?: string; coverUrl?: string },
  current: { avatarUrl?: string | null; coverUrl?: string | null },
): void {
  for (const field of IMAGE_FIELDS) {
    const next = dto[field];
    if (next === undefined || next === current[field]) continue;
    if (!isStorefrontImageValue(next)) {
      throw new BadRequestException(`${field} chỉ nhận đường dẫn https hoặc ảnh base64 png/jpeg/webp/gif (để trống để xoá ảnh).`);
    }
  }
}
