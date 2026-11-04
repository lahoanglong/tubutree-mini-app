import { Prisma } from '@prisma/client';
import { UPLOAD_IMAGE_HOSTS } from '../../common/uploaded-image';

/**
 * Truy vấn nạp danh sách URL ảnh https mà /img được đổi cỡ (ảnh base64 bị loại ngay trong SQL). Tách riêng để e2e chạy đúng câu này trên Postgres thật.
 *
 * Sản phẩm, nhãn, danh mục, vật phẩm/quà đổi rác do admin/đối tác nhập: mọi URL https. Banner chiến dịch và ảnh đại diện/bìa gian hàng thì chỉ host upload
 * tin cậy (Cloudinary): ảnh gian hàng do CTV tự dán, `isStorefrontImageValue` nhận mọi host https, nên đưa hết vào sẽ biến /img thành proxy đổi cỡ
 * cho nội dung tuỳ ý (kể cả mọi ảnh content.pancake.vn hay cloud Cloudinary khác). Có biến CLOUDINARY_CLOUD_NAME thì khoá tới
 * `/<cloud>/image/upload/`; không có thì chỉ kiểm host (parseRemoteSource vẫn bắt buộc dạng `/image/upload/`).
 */
/** Thoát ký tự đặc biệt của LIKE (mặc định của Postgres dùng `\` làm ký tự thoát) để tên cloud không thành mẫu so khớp. */
export const escapeLike = (v: string): string => v.replace(/[\\_%]/g, (c) => `\\${c}`);

/** Mẫu LIKE của ảnh upload: có tên cloud thì khoá tới `/<cloud>/image/upload/`, không thì chỉ host. */
export function uploadLikePatterns(hosts: readonly string[], cloud: string): string[] {
  const name = cloud.trim();
  return hosts.map((h) => (name ? `https://${h}/${escapeLike(name)}/image/upload/%` : `https://${h}/%`));
}

/**
 * Gian hàng chỉ tính khi đang đăng và không bị gỡ: bản nháp, chưa từng đăng, bị admin gỡ thì ảnh không còn được đổi cỡ.
 * `left(col, 8)` chặn trước để LIKE không phải đọc hết ảnh base64 dài mỗi lần nạp.
 */
export function registrySql(hosts: readonly string[] = UPLOAD_IMAGE_HOSTS, cloud: string = process.env.CLOUDINARY_CLOUD_NAME ?? ''): Prisma.Sql {
  const likes = uploadLikePatterns(hosts, cloud);
  return Prisma.sql`
      SELECT u FROM (SELECT unnest("images") AS u FROM "products") a WHERE left(u, 8) = 'https://'
      UNION ALL SELECT "thumbnail" FROM "products" WHERE left("thumbnail", 8) = 'https://'
      UNION ALL SELECT "logoUrl" FROM "brands" WHERE left("logoUrl", 8) = 'https://'
      UNION ALL SELECT "coverUrl" FROM "brands" WHERE left("coverUrl", 8) = 'https://'
      UNION ALL SELECT u FROM (SELECT unnest("storyImages") AS u FROM "brands") b WHERE left(u, 8) = 'https://'
      UNION ALL SELECT "imageUrl" FROM "waste_items" WHERE left("imageUrl", 8) = 'https://'
      UNION ALL SELECT "imageUrl" FROM "waste_gifts" WHERE left("imageUrl", 8) = 'https://'
      UNION ALL SELECT "image" FROM "categories" WHERE left("image", 8) = 'https://'
      UNION ALL SELECT "image" FROM "campaigns" WHERE left("image", 8) = 'https://' AND left("image", 300) LIKE ANY(${likes})
      UNION ALL SELECT "avatarUrl" FROM "storefronts" WHERE "isPublished" AND "takenDownAt" IS NULL AND left("avatarUrl", 8) = 'https://' AND left("avatarUrl", 300) LIKE ANY(${likes})
      UNION ALL SELECT "coverUrl" FROM "storefronts" WHERE "isPublished" AND "takenDownAt" IS NULL AND left("coverUrl", 8) = 'https://' AND left("coverUrl", 300) LIKE ANY(${likes})`;
}
