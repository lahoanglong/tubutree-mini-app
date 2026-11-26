/**
 * Dò Pancake CHỈ GET trước khi bật `loyalty.marketplace_claim_enabled` (wave tubu-w42-01): với mỗi sàn trong `pancake.order_source_map`,
 * lấy tối đa 5 đơn sàn cập nhật trong 7 ngày (`listUpdatedOrders`), in dạng SĐT người mua (FULL / MASK có đầu số / MASK chỉ đuôi / NONE)
 * và thử tra lại từng đơn bằng mã vận đơn đầu tiên (`searchOrders`). Báo đã che: không chữ số SĐT, không tên, không địa chỉ, không khoá
 * API; mã vận đơn chỉ 3 ký tự đầu và cuối. Thoát mã 0 khi mọi sàn có mẫu đều LOOKUP_READY (≥ 80% đơn tra lại đúng), 1 khi có sàn chưa
 * sẵn sàng, 2 khi không chạy được hoặc không có mẫu.
 *
 * Dùng (trong container api trên máy chủ, chủ dự án cho phép trước):
 *   pnpm exec tsx scripts/pancake-marketplace-probe.ts
 *
 * Không ghi DB (chỉ đọc một dòng system_configs), không mở hàng đợi hay Redis. Mọi request không phải GET bị chặn ở tầng axios.
 * Logic nằm ở src/modules/external-points/marketplace-phone-probe.ts (có test); file này chỉ nối DB và mạng.
 */
import { PrismaClient } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/env.validation';
import { PancakeClient } from '../src/modules/integrations/pancake/pancake.client';
import { assertGetOnly } from '../src/modules/integrations/pancake/pancake-self-edit-probe';
import { ORDER_SOURCE_MAP_KEY, resolveOrderSourceMap } from '../src/modules/external-points/external-order.config';
import { extractTrackingCodes } from '../src/modules/external-points/external-order.mapper';
import {
  formatMarketplaceProbeReport,
  marketplaceProbeExitCode,
  pickChannelSamples,
  sampleOf,
  summarizeChannel,
} from '../src/modules/external-points/marketplace-phone-probe';

const PANCAKE_BASE_URL_DEFAULT = 'https://pos.pages.fm/api/v1';
const WINDOW_SEC = 7 * 86_400;
const PAGE_SIZE = 50;

/** Lỗi in ra không được mang khoá API (axios có thể kèm URL có `api_key=`). */
const scrub = (msg: string): string => msg.replace(/api_key=[^&\s"']+/gi, 'api_key=***');

async function main(): Promise<number> {
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

  const prisma = new PrismaClient();
  let mapValue: unknown = null;
  try {
    mapValue = (await prisma.systemConfig.findUnique({ where: { key: ORDER_SOURCE_MAP_KEY }, select: { value: true } }))?.value ?? null;
  } finally {
    await prisma.$disconnect();
  }
  const map = resolveOrderSourceMap(mapValue);
  const sinceEpochSec = Math.floor(Date.now() / 1000) - WINDOW_SEC;
  const rows = [];
  for (const [marketplaceId, channel] of Object.entries(map.marketplaceIds)) {
    const list = await client.listUpdatedOrders({ sinceEpochSec, orderSources: [marketplaceId], page: 1, pageSize: PAGE_SIZE });
    const picked = pickChannelSamples(list as unknown as Record<string, unknown>[], channel, map);
    const samples = [];
    for (const data of picked) {
      const code = extractTrackingCodes(data)[0];
      const hit = code ? (await client.searchOrders(code)).some((o) => String((o as unknown as Record<string, unknown>)['id']) === String(data['id'])) : null;
      samples.push(sampleOf(data, hit));
    }
    rows.push({ summary: summarizeChannel(channel, samples), samples });
  }
  console.log(formatMarketplaceProbeReport(rows));
  return marketplaceProbeExitCode(rows.map((r) => r.summary));
}

main()
  .then((exit) => {
    process.exitCode = exit;
  })
  .catch((e: unknown) => {
    console.error('Dò Pancake lỗi:', scrub(e instanceof Error ? `${e.name}: ${e.message}` : 'lỗi không rõ'));
    process.exitCode = 2;
  });
