/**
 * Dò Pancake CHỈ GET trước khi bật `orders.customer_self_edit_enabled` (wave tubu-w41-01): đọc một đơn Tubu, gọi `getOrder()` đúng một lần,
 * so tên và dạng trường với điều job khách tự sửa đọc. In bảng PASS/WARN/FAIL đã che (SĐT chỉ 3 số cuối, không tên, không địa chỉ chữ, không
 * khoá API), thoát mã 1 khi có FAIL, mã 2 khi không chạy được.
 *
 * Dùng (trong container api trên máy chủ, chủ dự án cho phép trước):
 *   pnpm exec tsx scripts/pancake-self-edit-probe.ts              # đơn mới nhất hợp lệ (84_VN, PENDING_PAYMENT/CONFIRMED, kho Tubu giao)
 *   pnpm exec tsx scripts/pancake-self-edit-probe.ts --code TB…   # đúng đơn này
 *
 * Không ghi DB (chỉ `findFirst`), không mở hàng đợi hay Redis, không dùng PancakeOrderService. Mọi request không phải GET bị chặn ở tầng axios.
 * Logic nằm ở src/modules/integrations/pancake/pancake-self-edit-probe.ts (có test); file này chỉ nối DB và mạng.
 */
import { PrismaClient } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../src/config/env.validation';
import { PancakeClient } from '../src/modules/integrations/pancake/pancake.client';
import {
  assertGetOnly,
  formatProbeReport,
  parseProbeCode,
  probeExitCode,
  probeOrderWhere,
  selfEditProbe,
} from '../src/modules/integrations/pancake/pancake-self-edit-probe';

const PANCAKE_BASE_URL_DEFAULT = 'https://pos.pages.fm/api/v1';

/** Lỗi in ra không được mang khoá API (axios có thể kèm URL có `api_key=`). */
const scrub = (msg: string): string => msg.replace(/api_key=[^&\s"']+/gi, 'api_key=***');

async function main(): Promise<number> {
  const code = parseProbeCode(process.argv.slice(2));
  const env = {
    get: (k: string) => (k === 'PANCAKE_BASE_URL' ? process.env.PANCAKE_BASE_URL || PANCAKE_BASE_URL_DEFAULT : (process.env[k] ?? '')),
  } as unknown as ConfigService<Env, true>;
  const client = new PancakeClient(env);
  if (!client.isConfigured()) {
    console.error('Pancake chưa cấu hình (PANCAKE_API_KEY/PANCAKE_SHOP_ID): không dò.');
    return 2;
  }
  // `http` là trường private của PancakeClient: gắn chặn ghi vào đúng instance mà getOrder() dùng.
  assertGetOnly((client as unknown as { http: Parameters<typeof assertGetOnly>[0] }).http);

  const prisma = new PrismaClient();
  try {
    const order = await prisma.order.findFirst({
      where: probeOrderWhere(code),
      orderBy: { createdAt: 'desc' },
      select: { code: true, status: true, pancakeOrderId: true, shippingAddress: true },
    });
    if (!order?.pancakeOrderId) {
      console.error(code ? `Không có đơn ${code} đã gắn mã Pancake.` : 'Không có đơn hợp lệ để dò (84_VN, PENDING_PAYMENT/CONFIRMED, đã có mã Pancake, kho Tubu giao).');
      return 2;
    }
    const dto = await client.getOrder(order.pancakeOrderId);
    const lines = selfEditProbe(order, dto);
    console.log(formatProbeReport({ code: order.code, pancakeOrderId: order.pancakeOrderId, orderStatus: order.status, shippingAddress: order.shippingAddress }, dto, lines));
    return probeExitCode(lines);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((exit) => {
    process.exitCode = exit;
  })
  .catch((e: unknown) => {
    console.error('Dò Pancake lỗi:', scrub(e instanceof Error ? `${e.name}: ${e.message}` : 'lỗi không rõ'));
    process.exitCode = 2;
  });
