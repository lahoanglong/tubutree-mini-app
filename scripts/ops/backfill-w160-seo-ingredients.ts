/**
 * Lối vào W160 từ gốc repo, phần việc nằm ở `apps/api/src/modules/catalog/seo-backfill.cli.ts` (PROD chỉ có `dist/` nên không chạy file này trên PROD).
 *
 *   pnpm --filter @tubutree/api exec tsx ../../scripts/ops/backfill-w160-seo-ingredients.ts [--dry-run | --apply] [--verified-file=<json|->]
 */
import { main } from '../../apps/api/src/modules/catalog/seo-backfill.cli';

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
