// Tạo hoặc gỡ 3 gian hàng mẫu trên máy thử. KHÔNG chạy trong seed tham chiếu hay bước deploy.
// Tạo:  cd apps/api && pnpm seed:sample-storefronts
// Gỡ:   cd apps/api && pnpm unseed:sample-storefronts
// Chỉ chạy được khi DATABASE_URL trỏ localhost/127.0.0.1 và NODE_ENV khác production, trừ khi thêm --i-know-this-is-prod.
// DB dev cục bộ tên `tubutree` phải thêm --allow-db=tubutree (tên này cũng là DB PROD nên không nằm trong danh sách mặc định).
import { readFileSync } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  assertSampleSeedAllowed,
  describeDatabaseTarget,
  effectiveDatabaseUrl,
  removeSampleStorefronts,
  seedSampleStorefronts,
  SampleSeedRefusal,
} from '../src/modules/storefront/sample-storefronts';

async function main() {
  const argv = process.argv.slice(2);
  let dotenvText: string | null = null;
  try {
    dotenvText = readFileSync(path.resolve(__dirname, '../.env'), 'utf-8');
  } catch {
    dotenvText = null;
  }
  const databaseUrl = effectiveDatabaseUrl(process.env, dotenvText);
  assertSampleSeedAllowed({ env: process.env, databaseUrl, argv });
  console.log(`Ghi vào: ${describeDatabaseTarget(databaseUrl)}`);
  if (databaseUrl && !process.env.DATABASE_URL) process.env.DATABASE_URL = databaseUrl;

  const prisma = new PrismaClient();
  try {
    if (argv.includes('--remove')) {
      const r = await removeSampleStorefronts(prisma);
      console.log(`Đã gỡ ${r.storefronts} gian hàng mẫu và ${r.owners} tài khoản chủ.`);
      if (r.keptOwners.length > 0) console.log(`Giữ lại (đã có dữ liệu liên quan): ${r.keptOwners.join(', ')}`);
      return;
    }
    const results = await seedSampleStorefronts(prisma);
    for (const r of results) {
      console.log(`${r.action === 'created' ? 'Tạo' : 'Cập nhật'} /s/${r.slug}: ${r.items} sản phẩm`);
      if (r.missingProducts.length > 0) console.log(`  Thiếu sản phẩm trong DB: ${r.missingProducts.join(', ')}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof SampleSeedRefusal ? e.message : e);
  process.exit(1);
});
