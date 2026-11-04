import { Prisma } from '@prisma/client';
import { UPLOAD_IMAGE_HOSTS } from '../../common/uploaded-image';

/**
 * Truy vấn nạp danh sách URL ảnh https mà /img được đổi cỡ (ảnh base64 bị loại ngay trong SQL). Tách riêng để e2e chạy đúng câu này trên Postgres thật.
 *
 * Sản phẩm, nhãn, danh mục, vật phẩm/quà đổi rác do admin/đối tác nhập: mọi URL https. Banner chiến dịch và ảnh đại diện/bìa gian hàng thì chỉ host upload
 * tin cậy (Cloudinary): ảnh gian hàng do CTV tự dán, `isStorefrontImageValue` nhận mọi host https, nên đưa hết vào sẽ biến /img thành proxy đổi cỡ
 * cho nội dung tuỳ ý (kể cả mọi ảnh content.pancake.vn hay cloud Cloudinary khác). API chưa biết tên cloud của Tubu Tree (chỉ có ở biến build
 * Mini App VITE_CLOUDINARY_CLOUD_NAME) nên chưa khoá được tới `/<cloud>/image/upload/`; parseRemoteSource vẫn bắt buộc dạng `/image/upload/`.
 */
export function registrySql(hosts: readonly string[] = UPLOAD_IMAGE_HOSTS): Prisma.Sql {
  const uploadLikes = hosts.map((h) => `https://${h}/%`);
  return Prisma.sql`
      SELECT u FROM (SELECT unnest("images") AS u FROM "products") a WHERE left(u, 8) = 'https://'
      UNION ALL SELECT "thumbnail" FROM "products" WHERE left("thumbnail", 8) = 'https://'
      UNION ALL SELECT "logoUrl" FROM "brands" WHERE left("logoUrl", 8) = 'https://'
      UNION ALL SELECT "coverUrl" FROM "brands" WHERE left("coverUrl", 8) = 'https://'
      UNION ALL SELECT u FROM (SELECT unnest("storyImages") AS u FROM "brands") b WHERE left(u, 8) = 'https://'
      UNION ALL SELECT "imageUrl" FROM "waste_items" WHERE left("imageUrl", 8) = 'https://'
      UNION ALL SELECT "imageUrl" FROM "waste_gifts" WHERE left("imageUrl", 8) = 'https://'
      UNION ALL SELECT "image" FROM "categories" WHERE left("image", 8) = 'https://'
      UNION ALL SELECT "image" FROM "campaigns" WHERE "image" LIKE ANY(${uploadLikes})
      UNION ALL SELECT "avatarUrl" FROM "storefronts" WHERE "avatarUrl" LIKE ANY(${uploadLikes})
      UNION ALL SELECT "coverUrl" FROM "storefronts" WHERE "coverUrl" LIKE ANY(${uploadLikes})`;
}
