import { randomInt } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { ORDER_CODE_ALPHABET } from '@tubutree/shared-types';

/**
 * Mã đơn theo nguồn tạo đơn. Mã mới là mã ngắn (khuôn ở `@tubutree/shared-types` order-code): tiền tố theo loại đơn + 4 ký tự
 * không nhầm lẫn, ví dụ TB7K4M. Mã dài cũ đã nằm trên đơn, hoá đơn, Pancake và tin nhắn nên không bao giờ bị đổi; mọi chỗ đọc mã
 * nhận cả hai dạng.
 *  - RETAIL (checkout, đơn lên hộ của CTV): TB.
 *  - DEALER: DL.
 *  - SUBSCRIPTION (đơn kỳ của gói định kỳ): TS.
 */
export type OrderCodeKind = 'RETAIL' | 'DEALER' | 'SUBSCRIPTION';

const SHORT_PREFIX: Record<OrderCodeKind, string> = { RETAIL: 'TB', DEALER: 'DL', SUBSCRIPTION: 'TS' };

/** Mỗi độ dài thử chừng này lần. 32^4 ≈ 1 triệu mã mỗi tiền tố, nên trùng 6 lần liền chỉ xảy ra khi đã có hàng trăm nghìn đơn. */
const ATTEMPTS_PER_STEP = 6;
const SHORT_LENGTHS = [4, 5] as const;

/**
 * Chuỗi đọc lên khó coi (tiếng Việt viết tắt, tiếng Anh), so trên cả mã kể cả tiền tố. Có thì bốc lại phần ngẫu nhiên, nên khách
 * không nhận mã kiểu TBCAC2. Chữ I và O không có trong bảng ký tự, nên các từ cần I/O tự không thể xuất hiện.
 */
const UNSEEMLY = ['ASS', 'CAC', 'CL', 'CMM', 'DCM', 'DJT', 'DKM', 'DM', 'FUCK', 'KKK', 'LZ', 'SEX', 'VL'];
/** Bốc lại tối đa chừng này lần; xác suất cả loạt đều khó coi là không đáng kể, và mã vẫn hợp lệ nếu chuyện đó xảy ra. */
const MAX_REDRAWS = 20;

const pad = (n: number, width: number) => String(n).padStart(width, '0');

function utcYmd(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`;
}

const isUnseemly = (code: string) => UNSEEMLY.some((s) => code.includes(s));

function shortCode(kind: OrderCodeKind, length: number): string {
  let code = '';
  for (let draw = 0; draw < MAX_REDRAWS; draw++) {
    let body = '';
    for (let i = 0; i < length; i++) body += ORDER_CODE_ALPHABET[randomInt(0, ORDER_CODE_ALPHABET.length)];
    code = `${SHORT_PREFIX[kind]}${body}`;
    if (!isUnseemly(code)) break;
  }
  return code;
}

/**
 * Mã dài cũ, chỉ dùng khi mã ngắn trùng hết lượt (đúng định dạng đang có trên PROD, nên mọi chỗ đọc mã đã nhận):
 *  - RETAIL: TUBU + yyyymmdd theo UTC + 5 số.
 *  - DEALER: DLR + 8 số cuối của epoch ms + 3 số.
 *  - SUBSCRIPTION: TUBUSUB + 7 số cuối của epoch ms + 3 số.
 */
const LEGACY_BUILDERS: Record<OrderCodeKind, () => string> = {
  RETAIL: () => `TUBU${utcYmd(new Date())}${pad(randomInt(0, 100000), 5)}`,
  DEALER: () => `DLR${Date.now().toString().slice(-8)}${pad(randomInt(0, 1000), 3)}`,
  SUBSCRIPTION: () => `TUBUSUB${Date.now().toString().slice(-7)}${pad(randomInt(0, 1000), 3)}`,
};

/**
 * Sinh mã đơn chưa tồn tại: 6 lần mã ngắn 4 ký tự, rồi 6 lần 5 ký tự, rồi 6 lần mã dài cũ. Mã nào trả ra cũng đã được hỏi DB.
 * Hết cả ba lượt thì báo lỗi thay vì trả một mã chưa kiểm. Đây chỉ là kiểm tra thân thiện: tính duy nhất thật nằm ở unique
 * `orders.code`, nên hai request cùng sinh một mã vẫn bị chặn ở lúc ghi đơn.
 */
export async function generateUniqueOrderCode(
  prisma: Pick<PrismaClient, 'order'>,
  kind: OrderCodeKind,
): Promise<string> {
  const free = async (code: string) => !(await prisma.order.findUnique({ where: { code } }));
  for (const length of SHORT_LENGTHS) {
    for (let i = 0; i < ATTEMPTS_PER_STEP; i++) {
      const code = shortCode(kind, length);
      if (await free(code)) return code;
    }
  }
  for (let i = 0; i < ATTEMPTS_PER_STEP; i++) {
    const code = LEGACY_BUILDERS[kind]();
    if (await free(code)) return code;
  }
  throw new ServiceUnavailableException('Chưa tạo được mã đơn. Bạn thử đặt lại sau ít phút nhé.');
}
