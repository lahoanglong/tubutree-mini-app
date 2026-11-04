import { createHash } from 'node:crypto';
import { safeEqualStrings } from '../../common/safe-equal';
import type { PrismaService } from '../../prisma/prisma.service';

/** Trần số ảnh mỗi bài (CreatePostDto.images); chỉ số ngoài trần không bao giờ có ảnh. */
export const MAX_FEED_IMAGES = 6;

/**
 * Mã phiên bản của một ảnh bài = md5 của `<id bài>:<chỉ số>:<nội dung>`. Postgres tính cùng giá trị bằng md5(text) nên
 * danh sách chỉ hỏi DB mã này, không kéo cả ảnh về Node. Mã đóng hai vai: khoá cache (sửa ảnh thì URL đổi) và, với bài
 * chờ duyệt, quyền xem cho thẻ img (không gửi được token): chỉ ai đã được danh sách của chính mình trả mới có mã; gắn id
 * + chỉ số để mã của ảnh này không mở được ảnh khác.
 */
export function feedImageVersion(postId: string, index: number, image: string): string {
  return createHash('md5').update(`${postId}:${index}:${image}`).digest('hex');
}

/** Đường dẫn tương đối tới API của ảnh base64 thứ `index` trong bài (đích của endpoint ảnh). */
export function feedImageRef(postId: string, index: number, version: string): string {
  return `/feed/posts/${postId}/images/${index}?v=${version}`;
}

/** So mã `v` trên URL với mã của ảnh đang lưu (so sánh thời gian không đổi). */
export function matchesFeedImageVersion(given: unknown, postId: string, index: number, image: string): boolean {
  if (typeof given !== 'string') return false;
  return safeEqualStrings(given, feedImageVersion(postId, index, image));
}

export interface FeedPostImages {
  /** Số ảnh thật của bài (kể cả ảnh danh sách không trả). */
  count: number;
  images: string[];
}

interface ImageRow {
  postId: string;
  count: number;
  idx: number;
  url: string | null;
  hash: string | null;
}

/**
 * Ảnh của các bài trong một trang, KHÔNG kéo ảnh base64 về Node: DB tự phân loại từng phần tử (https giữ nguyên, `data:`
 * thành mã md5) nên mỗi trang chỉ nhận vài chục byte mỗi ảnh. `coverOnly` (thẻ trong danh sách chỉ vẽ ảnh bìa) chỉ đọc hai
 * cột tóm tắt `imageCount`/`coverRef` (trigger giữ theo `images`): không giải nén mảng ảnh TOAST của cả trang.
 * Ảnh base64 trả đường dẫn tương đối tới endpoint ảnh, ảnh https/http (Cloudinary) trả nguyên; chuỗi lạ (dòng cũ trước khi
 * API chặn) bị bỏ. Bài không có ảnh không có mục trong Map.
 */
export async function loadFeedImages(
  db: Pick<PrismaService, '$queryRaw'>,
  postIds: string[],
  coverOnly: boolean,
): Promise<Map<string, FeedPostImages>> {
  const out = new Map<string, FeedPostImages>();
  if (postIds.length === 0) return out;
  const rows = coverOnly
    ? await db.$queryRaw<ImageRow[]>`
        SELECT p."id" AS "postId", p."imageCount" AS "count", 0 AS "idx",
               CASE WHEN p."coverRef" ~ '^https?://' THEN p."coverRef" END AS "url",
               CASE WHEN p."coverRef" !~ '^https?://' THEN p."coverRef" END AS "hash"
        FROM "feed_posts" p
        WHERE p."id" = ANY(${postIds}) AND p."imageCount" > 0
        ORDER BY p."id"`
    : await db.$queryRaw<ImageRow[]>`
        SELECT p."id" AS "postId", cardinality(p."images")::int AS "count", (t.idx - 1)::int AS "idx",
               CASE WHEN t.img ~ '^https?://' THEN t.img END AS "url",
               CASE WHEN t.img LIKE 'data:%' THEN md5(p."id" || ':' || (t.idx - 1)::text || ':' || t.img) END AS "hash"
        FROM "feed_posts" p
        CROSS JOIN LATERAL unnest(p."images") WITH ORDINALITY AS t(img, idx)
        WHERE p."id" = ANY(${postIds}) AND t.idx <= ${MAX_FEED_IMAGES}
        ORDER BY p."id", t.idx`;
  for (const r of rows) {
    if (typeof r.postId !== 'string') continue;
    const entry = out.get(r.postId) ?? { count: Number(r.count), images: [] };
    if (r.url) entry.images.push(r.url);
    else if (r.hash) entry.images.push(feedImageRef(r.postId, Number(r.idx), r.hash));
    out.set(r.postId, entry);
  }
  return out;
}
