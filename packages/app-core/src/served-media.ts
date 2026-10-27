/**
 * Ảnh do chính API phục vụ (sản phẩm, nhãn hàng, khoá học tải lên khi chưa có Cloudinary) về JSON dưới dạng đường dẫn tương đối
 * `/public-image/...` để danh sách nhẹ. Thẻ img cần địa chỉ đủ, nên mọi phản hồi đi qua đây một lần ở tầng gọi API thay vì
 * từng màn tự ghép. Sửa tại chỗ (JSON vừa parse, chưa ai giữ); chuỗi không bắt đầu bằng tiền tố này giữ nguyên.
 */
export const SERVED_MEDIA_PREFIX = '/public-image/';

export function resolveServedMedia<T>(value: T, apiBase: string): T {
  const base = apiBase.replace(/\/+$/, '');
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.startsWith(SERVED_MEDIA_PREFIX) ? `${base}${v}` : v;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i += 1) v[i] = walk(v[i]);
    } else if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) o[k] = walk(o[k]);
    }
    return v;
  };
  return walk(value) as T;
}
