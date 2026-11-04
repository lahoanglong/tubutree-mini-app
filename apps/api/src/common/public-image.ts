import { createHash } from 'node:crypto';
import { decodeServedImage } from './served-image';

export type PublicImageKind = 'product' | 'brand' | 'academy' | 'campaign';

export const PUBLIC_IMAGE_PREFIX = '/public-image';

/** `thumb` = ảnh đại diện; số = ảnh thứ n của sản phẩm; `logo`/`cover` cho nhãn hàng, khoá học và chiến dịch (chỉ `cover`). */
export type PublicImageSlot = 'thumb' | 'logo' | 'cover' | number;

export const isPublicImageKind = (v: unknown): v is PublicImageKind => v === 'product' || v === 'brand' || v === 'academy' || v === 'campaign';

/** Mã `v` theo nội dung ảnh: đổi ảnh thì URL đổi nên cache được lâu; ảnh này không mở được ảnh khác. */
export function publicImageVersion(kind: PublicImageKind, id: string, slot: PublicImageSlot, image: string): string {
  return createHash('md5').update(`${kind}:${id}:${slot}:${image}`).digest('hex').slice(0, 16);
}

export function publicImageRef(kind: PublicImageKind, id: string, slot: PublicImageSlot, image: string): string {
  return `${PUBLIC_IMAGE_PREFIX}/${kind}/${id}/${slot}?v=${publicImageVersion(kind, id, slot, image)}`;
}

/**
 * Giá trị ảnh đưa vào JSON công khai: ảnh base64 (ảnh tải thẳng khi chưa có Cloudinary, tới ~1,5 MB) đi ra dưới dạng đường dẫn tới
 * endpoint ảnh để danh mục, thẻ sản phẩm, giỏ, đơn không nhúng cả ảnh. Link thường và đường dẫn đã là tham chiếu giữ nguyên;
 * data URL không phục vụ được (SVG, base64 hỏng) bỏ đi.
 */
export function publicImage(kind: PublicImageKind, id: string, slot: PublicImageSlot, value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('data:')) return value;
  return decodeServedImage(value) ? publicImageRef(kind, id, slot, value) : null;
}

export function publicImages(kind: PublicImageKind, id: string, values: readonly string[]): string[] {
  return values.map((v, i) => publicImage(kind, id, i, v)).filter((v): v is string => v !== null);
}

/** Ảnh đại diện sản phẩm cho thẻ: thumbnail, không có thì ảnh đầu; base64 thành đường dẫn `thumb`. */
export function publicProductThumb(p: { id: string; thumbnail: string | null; images?: readonly string[] | null }): string | null {
  if (p.thumbnail) return publicImage('product', p.id, 'thumb', p.thumbnail);
  const first = p.images?.[0];
  return first ? publicImage('product', p.id, 0, first) : null;
}

/** Tham chiếu lưu sẵn vào `thumbnail` khi ảnh đầu là base64, để không lưu cùng một ảnh hai lần (cột `images` giữ bản gốc). */
export function storedThumbnailFor(productId: string, firstImage: string | undefined): string | null {
  if (!firstImage) return null;
  return firstImage.startsWith('data:') ? publicImageRef('product', productId, 0, firstImage) : firstImage;
}

const FIRST_IMAGE_REF_RE = new RegExp(`^${PUBLIC_IMAGE_PREFIX}/product/[A-Za-z0-9_-]+/0\\?v=[0-9a-f]+$`);

/**
 * Thumbnail đem lưu cho dữ liệu nhập tay (đối tác, bản sửa chờ duyệt): data URL trùng đúng ảnh đầu thì chỉ lưu đường dẫn tới ảnh đó,
 * như `storedThumbnailFor`; đường dẫn tới ảnh đầu đã lưu thì dựng lại theo ảnh đầu hiện tại (mã `v` đi theo nội dung). Data URL khác
 * ảnh đầu không có chỗ để trỏ (endpoint ảnh chỉ phục vụ phần tử của `images`) nên giữ nguyên.
 */
export function storedThumbnailOf(productId: string, thumbnail: string | null | undefined, firstImage: string | undefined): string | null {
  if (!thumbnail) return null;
  if (FIRST_IMAGE_REF_RE.test(thumbnail)) return storedThumbnailFor(productId, firstImage);
  return thumbnail.startsWith('data:') && thumbnail === firstImage ? publicImageRef('product', productId, 0, firstImage) : thumbnail;
}

/** Thumbnail chính là ảnh đầu: đường dẫn `/public-image/product/<id>/0?v=…` đã lưu, hay đúng chuỗi của ảnh đầu. */
export function isFirstImageThumb(thumbnail: string | null | undefined, firstImage: string | undefined): boolean {
  if (!thumbnail) return false;
  return thumbnail === firstImage || FIRST_IMAGE_REF_RE.test(thumbnail);
}
