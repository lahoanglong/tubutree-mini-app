import { randomInt } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Mã đơn theo nguồn tạo đơn. Mỗi loại giữ ĐÚNG định dạng đang chạy trên PROD (mã đã in trên đơn,
 * hoá đơn, Pancake) nên không được "thống nhất" thành một dạng.
 *  - RETAIL (checkout, đơn lên hộ của CTV): TUBU + yyyymmdd theo UTC + 5 số. Ngày tính theo UTC nên
 *    đơn đặt 00:00-07:00 giờ VN mang ngày hôm trước; đổi sang giờ VN sẽ đổi mã đơn đang chạy.
 *  - DEALER: DLR + 8 số cuối của epoch ms + 3 số, không có ngày lịch.
 *  - SUBSCRIPTION (đơn kỳ của gói định kỳ): TUBUSUB + 7 số cuối của epoch ms + 3 số.
 */
export type OrderCodeKind = 'RETAIL' | 'DEALER' | 'SUBSCRIPTION';

const MAX_ATTEMPTS = 6;

const pad = (n: number, width: number) => String(n).padStart(width, '0');

function utcYmd(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`;
}

const BUILDERS: Record<OrderCodeKind, () => string> = {
  RETAIL: () => `TUBU${utcYmd(new Date())}${pad(randomInt(0, 100000), 5)}`,
  DEALER: () => `DLR${Date.now().toString().slice(-8)}${pad(randomInt(0, 1000), 3)}`,
  SUBSCRIPTION: () => `TUBUSUB${Date.now().toString().slice(-7)}${pad(randomInt(0, 1000), 3)}`,
};

const FALLBACK_PREFIX: Record<OrderCodeKind, string> = {
  RETAIL: 'TUBU',
  DEALER: 'DLR',
  SUBSCRIPTION: 'TUBUSUB',
};

/**
 * Sinh mã đơn chưa tồn tại. Thử tối đa 6 lần; hết lượt trả `<prefix><Date.now()>` (không kiểm lại).
 * Đây chỉ là kiểm tra thân thiện: tính duy nhất thật nằm ở unique `orders.code`, nên hai request cùng
 * sinh một mã vẫn bị chặn ở lúc ghi đơn.
 */
export async function generateUniqueOrderCode(
  prisma: Pick<PrismaClient, 'order'>,
  kind: OrderCodeKind,
): Promise<string> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const code = BUILDERS[kind]();
    const exists = await prisma.order.findUnique({ where: { code } });
    if (!exists) return code;
  }
  return `${FALLBACK_PREFIX[kind]}${Date.now()}`;
}
