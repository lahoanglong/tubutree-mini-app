/**
 * Thư viện media của trang chi tiết (Mini App và web dùng chung): ảnh trước, video sau. Video chỉ là một ô trong dải cuộn, cùng khung
 * vuông với ảnh nên không làm trang nhảy; trình phát chỉ tải khi khách bấm (xem `PdpVideoSlide` của từng nền tảng).
 */
export type PdpMediaItem = { kind: 'image'; src: string } | { kind: 'video'; src: string; poster: string | null };

/** Khớp trần của API (`PANCAKE_VIDEOS_MAX`): dữ liệu cũ hay đối tác nhập tay không làm dải dài vô hạn. */
export const PDP_VIDEOS_MAX = 6;

const HTTP_URL = /^https?:\/\//i;

/**
 * Video hợp lệ để phát: URL http(s), bỏ trùng và mục không phải chuỗi. `javascript:`/`data:` không bao giờ vào thẻ video. `http:` nâng thành `https:`:
 * trang và webview Zalo chạy https nên trình duyệt chặn video http (mixed content), và nguồn video Pancake đều có https.
 */
export function pdpVideoUrls(videos: readonly unknown[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const v of Array.isArray(videos) ? videos : []) {
    const url = typeof v === 'string' ? v.trim() : '';
    if (HTTP_URL.test(url)) out.add(url.replace(/^http:/i, 'https:'));
    if (out.size >= PDP_VIDEOS_MAX) break;
  }
  return [...out];
}

/** Ảnh trước rồi video; poster của video là ảnh đầu (không có ảnh thì không poster, ô vẫn có nút phát). */
export function pdpMedia(images: readonly string[], videos: readonly unknown[] | null | undefined): PdpMediaItem[] {
  const poster = images[0] ?? null;
  return [...images.map((src): PdpMediaItem => ({ kind: 'image', src })), ...pdpVideoUrls(videos).map((src): PdpMediaItem => ({ kind: 'video', src, poster }))];
}

/** Vị trí ô ảnh của biến thể trong thư viện, -1 nếu biến thể không có ảnh riêng hoặc ảnh đó không nằm trong thư viện. */
export function pdpMediaIndexOfImage(media: readonly PdpMediaItem[], imageUrl: string | null | undefined): number {
  if (!imageUrl) return -1;
  return media.findIndex((m) => m.kind === 'image' && m.src === imageUrl);
}
