const OG_IMAGE_TYPES = ['image/png', 'image/jpeg'];

/**
 * Tải ảnh về dạng data URI cho bộ dựng ảnh chia sẻ (satori không đọc được webp và ném lỗi nếu ảnh không tải được, làm hỏng cả
 * ảnh OG). Ảnh chậm, quá nặng, sai loại hoặc lỗi thì bỏ qua: thẻ chia sẻ vẫn ra, chỉ thiếu ảnh đó.
 */
export async function fetchOgImage(url: string, { timeoutMs = 3000, maxBytes = 1_500_000 } = {}): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!OG_IMAGE_TYPES.includes(type)) return null;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > maxBytes) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}
