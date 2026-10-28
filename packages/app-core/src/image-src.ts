/**
 * Ảnh sản phẩm theo đúng bề rộng hiển thị: API đổi cỡ ảnh Pancake/Cloudinary/ảnh của chính nó (GET {api}/img?u=&w=) thành bản nhỏ
 * webp, thay vì tải ảnh gốc hàng trăm KB cho thẻ rộng ~170px. Chỉ nhận các bề rộng cố định của API (RESIZE_WIDTHS ở apps/api).
 */
export const IMAGE_WIDTHS: readonly number[] = [160, 320, 640, 960];

/** Host ảnh nguồn mà API chịu đổi cỡ; phải khớp PANCAKE_IMAGE_HOSTS và UPLOAD_IMAGE_HOSTS của API. */
const RESIZABLE_HOSTS: readonly string[] = ['content.pancake.vn', 'res.cloudinary.com'];

const OWN_IMAGE_PATH = /\/public-image\/[a-z]+\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9]{1,8}(?:\?v=[A-Za-z0-9]{1,32})?$/;

/** Bề rộng nhỏ nhất trong danh sách mà không nhỏ hơn `px` (ảnh to nhất khi `px` vượt danh sách). */
export function pickImageWidth(px: number): number {
  return IMAGE_WIDTHS.find((w) => w >= px) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]!;
}

/** Nguồn gửi cho API: link đầy đủ của host cho phép, hoặc đường dẫn `/public-image/...` của chính API. Null khi không đổi cỡ được. */
function resizeSource(src: string, apiBase: string): string | null {
  if (src.startsWith('data:') || src.startsWith('blob:')) return null;
  if (src.startsWith('/public-image/')) return OWN_IMAGE_PATH.test(src) ? src : null;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const own = apiBase ? safeUrl(apiBase) : null;
  if (own && url.origin === own.origin && url.pathname.startsWith(`${own.pathname.replace(/\/+$/, '')}/public-image/`)) {
    const path = `${url.pathname.slice(own.pathname.replace(/\/+$/, '').length)}${url.search}`;
    return OWN_IMAGE_PATH.test(path) ? path : null;
  }
  return url.protocol === 'https:' && RESIZABLE_HOSTS.includes(url.hostname.toLowerCase()) ? src : null;
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export interface ImageVariants {
  /** Bản 1x. */
  src: string;
  /** "url 1x, url 2x" khi hai bản khác nhau; không có khi cùng một bề rộng. */
  srcSet?: string;
}

/**
 * URL đổi cỡ cho ảnh hiển thị rộng `cssWidth` px: 1x và 2x. Null khi ảnh không đổi cỡ được (host lạ, base64, chưa biết địa chỉ API):
 * nơi gọi dùng nguyên ảnh gốc.
 */
export function imageVariants(src: string | null | undefined, cssWidth: number, apiBase: string | null | undefined): ImageVariants | null {
  if (!src || !apiBase || !(cssWidth > 0)) return null;
  const base = apiBase.replace(/\/+$/, '');
  const source = resizeSource(src, base);
  if (!source) return null;
  const url = (w: number) => `${base}/img?w=${w}&u=${encodeURIComponent(source)}`;
  const w1 = pickImageWidth(cssWidth);
  const w2 = pickImageWidth(cssWidth * 2);
  return w1 === w2 ? { src: url(w1) } : { src: url(w1), srcSet: `${url(w1)} 1x, ${url(w2)} 2x` };
}
