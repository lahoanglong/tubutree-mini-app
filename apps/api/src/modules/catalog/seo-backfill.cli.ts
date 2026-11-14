/**
 * Backfill W160: điền `metaTitle`/`metaDesc` còn trống cho mọi SP nhà đang bán, và thành phần THẬT cho SP chưa có.
 *
 * Dùng:
 *   pnpm exec tsx src/modules/catalog/seo-backfill.cli.ts                      # DRY-RUN (mặc định): in kế hoạch, KHÔNG ghi DB
 *   pnpm exec tsx src/modules/catalog/seo-backfill.cli.ts --apply              # GHI các trường đang trống
 *   thêm --verified-file=<json|->: bản đồ {"<slug>": ["tên thành phần", ...]} do người đã đọc từ bao bì (dùng "-" để đọc stdin)
 * Trên PROD container chỉ có `dist/`: docker compose exec -T api node dist/modules/catalog/seo-backfill.cli.js [--apply] [--verified-file=-]
 *
 * An toàn: idempotent, chỉ điền ô đang trống, UPDATE có điều kiện `updatedAt`, không đụng SP đối tác hay SP đang ẩn. Thành phần chỉ ghi khi có nhãn
 * "Thành phần:" trong mô tả hoặc có trong file đã xác minh; không có thì để trống và liệt kê. In tên DB đích trước khi chạy. Không làm tươi bộ nhớ đệm API.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { applyBackfill, loadBackfillRows, parseBackfillArgs, parseVerifiedIngredients, planBackfill, renderReport, summarizeBackfill, type VerifiedIngredients } from './seo-backfill.core';

function target(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? '');
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(không đọc được DATABASE_URL)';
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseBackfillArgs(argv);
  if (!args.ok) {
    console.error(args.error);
    process.exitCode = 2;
    return;
  }
  const { apply, verifiedFile } = args.value;

  let verified: VerifiedIngredients | undefined;
  if (verifiedFile !== null) {
    const parsed = parseVerifiedIngredients(readFileSync(verifiedFile === '-' ? 0 : verifiedFile, 'utf8'));
    if (!parsed.ok) {
      console.error(parsed.error);
      process.exitCode = 2;
      return;
    }
    verified = parsed.value;
  }

  const prisma = new PrismaClient();
  try {
    console.log(`\n=== BACKFILL SEO + THÀNH PHẦN W160 ${apply ? '(APPLY — sẽ ghi DB)' : '(DRY-RUN — chỉ xem)'} ===`);
    console.log(`DB đích: ${target()}\n`);

    const rows = await loadBackfillRows(prisma);
    const plans = planBackfill(rows, { verified });
    const unknown = Object.keys(verified ?? {}).filter((slug) => !rows.some((r) => r.slug === slug));
    if (unknown.length > 0) console.log(`⚠️  ${unknown.length} slug trong file xác minh không khớp SP đang bán nào: ${unknown.join(', ')}\n`);
    console.log(renderReport(plans, summarizeBackfill(plans)));

    const written = await applyBackfill(prisma, rows, plans, { apply });
    if (apply) {
      const changed = written.filter((r) => r.status === 'SKIPPED_CHANGED');
      console.log(`\nĐã ghi ${written.filter((r) => r.status === 'APPLIED').length} SP.${changed.length ? ` Bỏ qua ${changed.length} SP vì vừa bị sửa xen giữa: ${changed.map((r) => r.slug).join(', ')}. Chạy lại.` : ''}`);
      if (changed.length > 0) process.exitCode = 1;
    } else {
      console.log('\n⚠️  DRY-RUN: chưa ghi gì. Chạy lại với --apply để ghi.');
    }
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
