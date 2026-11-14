/**
 * Điền chữ còn thiếu (mô tả, thành phần) cho SKU nhà Tubu đang bán, từ bảng chữ dự phòng có nguồn của shared-types (W147A).
 *
 * Dùng (chạy từ apps/api):
 *   pnpm exec tsx src/modules/catalog/catalog-copy-enrichment.cli.ts                 # DRY-RUN (mặc định): in bảng, KHÔNG ghi DB
 *   pnpm exec tsx src/modules/catalog/catalog-copy-enrichment.cli.ts --apply         # GHI các trường đang trống
 *   thêm --force: cho phép đè chữ đã có bằng chữ dự phòng (mặc định KHÔNG đè chữ người đã sửa)
 *
 * An toàn: idempotent (chạy lại thì mọi dòng đã đủ), UPDATE có điều kiện `updatedAt`, không đụng SP đối tác hay SP đang ẩn. Chạy với DATABASE_URL nào thì ghi vào DB đó:
 * script in tên DB đích trước khi chạy. Script không làm tươi bộ nhớ đệm API (khởi động lại API để thấy ngay).
 */
import { PrismaClient } from '@prisma/client';
import { MIN_DESCRIPTION_CHARS, NOT_WRITTEN, RICH_DESCRIPTION_MIN_CHARS, applyPlans, loadHouseProducts, parseCliArgs, planEnrichment, renderTable, summarize } from './catalog-copy-enrichment.core';

function target(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? '');
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(không đọc được DATABASE_URL)';
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.error);
    process.exitCode = 2;
    return;
  }
  const { apply, force } = args.value;
  const prisma = new PrismaClient();
  try {
    console.log(`\n=== BỔ SUNG CHỮ SẢN PHẨM ${apply ? '(APPLY — sẽ ghi DB)' : '(DRY-RUN — chỉ xem)'}${force ? ' + FORCE (đè chữ đã có)' : ''} ===`);
    console.log(`DB đích: ${target()}\n`);
    if (apply && force) console.log('⚠️  --force --apply: chữ đã có của chủ hàng sẽ bị thay bằng chữ dự phòng.\n');

    const rows = await loadHouseProducts(prisma);
    const plans = planEnrichment(rows, { force });
    console.log(renderTable(plans));

    const s = summarize(plans);
    console.log(`\nTổng ${s.total} SKU nhà (kể cả đang ẩn): cần ghi ${s.byStatus.ENRICH}, đã đủ ${s.byStatus.COMPLETE}, thiếu nguồn ${s.byStatus.NO_SOURCE}, bị chặn ${s.byStatus.BLOCKED_BY_GUARD}, loại ${s.byStatus.EXCLUDED}.`);
    console.log(`Sẽ ghi: ${s.descriptionWrites} mô tả, ${s.ingredientWrites} thành phần${s.forced ? ` (${s.forced} dòng đè chữ đã có)` : ''}.`);
    console.log(`SKU đang bán chưa có storyConfig: ${s.storyConfigNull} (không ghi, xem bên dưới).`);
    console.log('\nKhông ghi (cố ý):');
    for (const [field, why] of Object.entries(NOT_WRITTEN)) console.log(`  - ${field}: ${why}`);

    const written = await applyPlans(prisma, rows, plans, { apply });
    if (apply) {
      const changed = written.filter((r) => r.status === 'SKIPPED_CHANGED');
      console.log(`\nĐã ghi ${written.filter((r) => r.status === 'APPLIED').length} SP.${changed.length ? ` Bỏ qua ${changed.length} SP vì vừa bị sửa xen giữa: ${changed.map((r) => r.slug).join(', ')}. Chạy lại.` : ''}`);
      if (changed.length > 0) process.exitCode = 1;
    } else {
      console.log('\n⚠️  DRY-RUN: chưa ghi gì. Chạy lại với --apply để ghi.');
    }
    const blocked = plans.filter((p) => p.status === 'BLOCKED_BY_GUARD');
    if (blocked.length > 0) {
      console.log(`\n${blocked.length} SP KHÔNG ghi vì chữ dự phòng vi phạm bộ chặn (sửa ở packages/shared-types/src/product-copy-fallback.ts):`);
      for (const b of blocked) console.log(`  - ${b.slug}: ${b.reason}`);
    }
    if (force) console.log(`\nLưu ý: đồng bộ Pancake 15 phút không bao giờ ghi đè mô tả đã có từ ${RICH_DESCRIPTION_MIN_CHARS} ký tự (không phải bản chép tên), nên mô tả đè bằng --force sẽ được giữ. Mô tả ngắn hơn ${RICH_DESCRIPTION_MIN_CHARS} ký tự vẫn có thể bị chữ Pancake từ ${MIN_DESCRIPTION_CHARS} ký tự trở lên ghi đè.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
