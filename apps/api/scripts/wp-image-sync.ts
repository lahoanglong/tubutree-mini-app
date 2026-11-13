/**
 * Nạp ảnh sản phẩm từ WordPress cũ (tubutree.com) về kho riêng của hệ thống cho các SP đang bán mà `images` rỗng (W146A).
 *
 * Vì sao cần: tắt WordPress mà ảnh còn nằm ở `tubutree.com/wp-content/uploads` thì ảnh chết. Script chỉ GET công khai (Store API + tệp ảnh), nén WebP
 * rồi ghi base64 vào `products.images` như ảnh admin tải lên.
 *
 * Dùng:
 *   pnpm --filter @tubutree/api wp-image:sync                 # DRY-RUN: liệt kê ảnh sẽ nạp, KHÔNG ghi DB
 *   pnpm --filter @tubutree/api wp-image:sync -- --apply-exact # GHI: chỉ 4 SP khớp chắc chắn (EXACT)
 *   thêm --max-images=N (1..8, mặc định 3)
 *
 * Nhóm cùng dòng/khớp yếu/combo KHÔNG nạp ở đây: ảnh có thể sai bao bì nên phải duyệt từng dòng ở Admin → Sản phẩm → "Ứng viên ảnh từ WordPress".
 *
 * An toàn: idempotent (SP đã có ảnh bị bỏ qua, không bao giờ đè), UPDATE có điều kiện `images = {}`, không đụng SP đối tác. Chạy với DATABASE_URL nào thì
 * ghi vào DB đó: in tên DB đích trước khi chạy. Script không làm tươi bộ nhớ đệm ảnh của API (tối đa 5 phút, hoặc khởi động lại API).
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_MAX_IMAGES, PRODUCT_IMAGES_LIMIT, WP_IMAGE_CANDIDATES, nodeWpHttp, runExactSync } from '../src/modules/catalog/wp-image-sync.core';

const prisma = new PrismaClient();

function target(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? '');
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(không đọc được DATABASE_URL)';
  }
}

async function main() {
  const apply = process.argv.includes('--apply-exact');
  const raw = process.argv.find((a) => a.startsWith('--max-images='))?.split('=')[1];
  const maxImages = raw === undefined ? DEFAULT_MAX_IMAGES : Number(raw);
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > PRODUCT_IMAGES_LIMIT) {
    console.error(`--max-images phải là số nguyên từ 1 đến ${PRODUCT_IMAGES_LIMIT}.`);
    process.exitCode = 2;
    return;
  }

  console.log(`\n=== NẠP ẢNH WORDPRESS ${apply ? '(APPLY — sẽ ghi DB, chỉ nhóm EXACT)' : '(DRY-RUN — chỉ xem)'} ===`);
  console.log(`DB đích: ${target()}`);
  console.log(`Ứng viên: ${WP_IMAGE_CANDIDATES.length} SP, trong đó EXACT ${WP_IMAGE_CANDIDATES.filter((c) => c.tier === 'EXACT').length}\n`);

  const rows = await runExactSync({ store: prisma, http: nodeWpHttp }, { apply, maxImages, actor: 'script:wp-image-sync' });
  let failed = 0;
  for (const { productSlug, outcome } of rows) {
    if (outcome.status === 'DRY_RUN') {
      console.log(`  ${productSlug}: ${outcome.urls.length} ảnh sẽ nạp${outcome.errors.length ? ` — LỖI: ${outcome.errors.join(' ')}` : ''}`);
      for (const u of outcome.urls) console.log(`      ${u}`);
      if (outcome.urls.length === 0) failed += 1;
    } else if (outcome.status === 'APPLIED') {
      console.log(`  ${productSlug}: ĐÃ NẠP ${outcome.imageCount} ảnh${outcome.failed ? ` (${outcome.failed} ảnh lỗi bị bỏ)` : ''}`);
    } else if (outcome.status === 'SKIPPED') {
      console.log(`  ${productSlug}: bỏ qua (${outcome.reason})`);
    } else {
      console.log(`  ${productSlug}: THẤT BẠI — ${outcome.reason}`);
      failed += 1;
    }
  }

  if (!apply) console.log('\n⚠️  DRY-RUN: chưa ghi gì. Chạy lại với "-- --apply-exact" để ghi 4 SP nhóm EXACT.');
  else console.log('\nẢnh API phát ra có thể cũ tối đa 5 phút (bộ nhớ đệm); khởi động lại API để thấy ngay.');
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
