/**
 * Dò Pancake CHỈ GET (W44, PO cho phép 27/11): với mỗi sàn trong `pancake.order_source_map`, kéo đơn sàn cập nhật trong `--days` ngày
 * (`listUpdatedOrders`, từng nguồn riêng vì Pancake chỉ lọc theo giá trị `order_sources[]` cuối, tối đa 6 trang × 50 đơn), lấy mẫu tối đa
 * `--per-channel` đơn ưu tiên DELIVERED rồi SHIPPED rồi OPEN, đếm trường mang mã và trường SĐT theo nhóm trạng thái, rồi tra lại tối đa
 * `--search-samples` đơn nhóm nhận bằng `searchOrders` theo đúng vị từ của lookup. Thêm bảng `external_orders` đọc trong giao dịch READ ONLY.
 *
 * Dùng (trong container api trên máy chủ, chủ dự án cho phép trước):
 *   pnpm exec tsx scripts/pancake-marketplace-probe.ts --days=30 --per-channel=50 --search-samples=10 [--json]
 *
 * Báo cáo đã che: không chữ số SĐT, không tên, không địa chỉ, không khoá API, mã chỉ 3 ký tự đầu và cuối. Mọi request không phải GET bị
 * chặn ở tầng axios; nghỉ 250 ms giữa hai lệnh GET. Thoát 0 khi mọi sàn có đơn nhóm nhận đều LOOKUP_READY, 1 khi có sàn chưa, 2 khi không
 * chạy được hoặc không có đơn nhóm nhận. Logic nằm ở src/modules/external-points/marketplace-field-census.ts (có test).
 */
import { PrismaClient } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/env.validation';
import { PancakeClient } from '../src/modules/integrations/pancake/pancake.client';
import { assertGetOnly } from '../src/modules/integrations/pancake/pancake-self-edit-probe';
import { ORDER_SOURCE_MAP_KEY, resolveOrderSourceMap } from '../src/modules/external-points/external-order.config';
import {
  censusChannel,
  censusExitCode,
  channelOrders,
  formatCensusReport,
  isClaimBucket,
  liveLookupPredicate,
  pickCensusSample,
  pickSearchSamples,
  runSearchChecks,
  statusBucketOf,
  type ChannelCensus,
  type DbSummaryRow,
} from '../src/modules/external-points/marketplace-field-census';

const PANCAKE_BASE_URL_DEFAULT = 'https://pos.pages.fm/api/v1';
const PAGE_SIZE = 50;
const MAX_PAGES = 6;
const DELAY_MS = 250;

type Data = Record<string, unknown>;

/** Lỗi in ra không được mang khoá API (axios có thể kèm URL có `api_key=`). */
const scrub = (msg: string): string => msg.replace(/api_key=[^&\s"']+/gi, 'api_key=***');

function intArg(name: string, fallback: number, max: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const n = raw === undefined ? fallback : Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readDb(prisma: PrismaClient): Promise<{ mapValue: unknown; db: DbSummaryRow[] }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const mapValue = (await tx.systemConfig.findUnique({ where: { key: ORDER_SOURCE_MAP_KEY }, select: { value: true } }))?.value ?? null;
    const db = await tx.$queryRaw<DbSummaryRow[]>`
      SELECT channel, status::text AS status, count(*)::int AS n,
             (count(*) FILTER (WHERE cardinality("trackingCodes") = 0))::int AS "noCode",
             (count(*) FILTER (WHERE phone IS NULL AND "phoneMask" IS NULL))::int AS "noPhone",
             (count(*) FILTER (WHERE "marketplaceOrderSn" IS NOT NULL))::int AS "withOrderSn"
      FROM external_orders WHERE source = 'MARKETPLACE' GROUP BY 1, 2 ORDER BY 1, 2`;
    return { mapValue, db };
  });
}

async function main(): Promise<number> {
  const days = intArg('days', 30, 90);
  const perChannel = intArg('per-channel', 50, 300);
  const searchSamples = intArg('search-samples', 10, 20);
  const json = process.argv.includes('--json');

  const env = {
    get: (k: string) => (k === 'PANCAKE_BASE_URL' ? process.env.PANCAKE_BASE_URL || PANCAKE_BASE_URL_DEFAULT : (process.env[k] ?? '')),
  } as unknown as ConfigService<Env, true>;
  const client = new PancakeClient(env);
  if (!client.isConfigured()) {
    console.error('Pancake chưa cấu hình (PANCAKE_API_KEY/PANCAKE_SHOP_ID): không dò.');
    return 2;
  }
  // `http` là trường private của PancakeClient: gắn chặn ghi vào đúng instance mà listUpdatedOrders()/searchOrders() dùng.
  assertGetOnly((client as unknown as { http: Parameters<typeof assertGetOnly>[0] }).http);
  let getCalls = 0;
  const throttled = async <T>(call: () => Promise<T>): Promise<T> => {
    if (getCalls > 0) await sleep(DELAY_MS);
    getCalls++;
    return call();
  };

  const prisma = new PrismaClient();
  let read: { mapValue: unknown; db: DbSummaryRow[] };
  try {
    read = await readDb(prisma);
  } finally {
    await prisma.$disconnect();
  }
  const map = resolveOrderSourceMap(read.mapValue);
  const sinceEpochSec = Math.floor(Date.now() / 1000) - days * 86_400;
  const channels: ChannelCensus[] = [];
  for (const [marketplaceId, channel] of Object.entries(map.marketplaceIds)) {
    const byId = new Map<string, Data>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const list = (await throttled(() => client.listUpdatedOrders({ sinceEpochSec, orderSources: [marketplaceId], page, pageSize: PAGE_SIZE }))) as unknown as Data[];
      for (const o of channelOrders(list, channel, map)) byId.set(String(o['id'] ?? `#${byId.size}`), o);
      const claimable = [...byId.values()].filter((o) => isClaimBucket(statusBucketOf(o))).length;
      if (list.length < PAGE_SIZE || claimable >= perChannel) break;
    }
    const orders = [...byId.values()];
    const census = censusChannel({ channel, orders }, perChannel);
    const searched = pickSearchSamples(pickCensusSample(orders, perChannel), searchSamples);
    const search = async (text: string) => (await throttled(() => client.searchOrders(text))) as unknown as Data[];
    channels.push(await runSearchChecks(census, searched, search, liveLookupPredicate));
  }
  const report = { days, perChannel, getCalls, channels, db: read.db };
  console.log(json ? JSON.stringify(report, null, 2) : formatCensusReport(report));
  return censusExitCode(channels);
}

main()
  .then((exit) => {
    process.exitCode = exit;
  })
  .catch((e: unknown) => {
    console.error('Dò Pancake lỗi:', scrub(e instanceof Error ? `${e.name}: ${e.message}` : 'lỗi không rõ'));
    process.exitCode = 2;
  });
