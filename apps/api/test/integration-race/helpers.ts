import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Prisma, UserRole } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';

// Giữ log lỗi/cảnh báo của service (hữu ích khi điều tra), bỏ log/debug ồn ào.
Logger.overrideLogger(['error', 'warn']);

const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Mã ngẫu nhiên in hoa, đủ dài để parseMemberCode chấp nhận (≥ 8). */
export function randCode(len = 10): string {
  const bytes = randomBytes(len);
  let s = '';
  for (const b of bytes) s += ALNUM[b % ALNUM.length];
  return s;
}

export async function createUser(
  prisma: PrismaService,
  data: Partial<Prisma.UserUncheckedCreateInput> & { role?: UserRole } = {},
) {
  return prisma.user.create({
    data: {
      referralCode: randCode(10),
      fullName: `IT ${randCode(4)}`,
      ...data,
    },
  });
}

/** Upsert SystemConfig trực tiếp (trước khi service đọc — SystemConfigService cache 60s). */
export async function setConfig(prisma: PrismaService, key: string, value: Prisma.InputJsonValue) {
  const category = key.includes('.') ? key.slice(0, key.indexOf('.')) : 'misc';
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value, category },
  });
}

export async function createOrder(
  prisma: PrismaService,
  data: Partial<Prisma.OrderUncheckedCreateInput> & { userId: string },
) {
  const total = data.total ?? 100_000;
  return prisma.order.create({
    data: {
      code: `IT${Date.now()}${randCode(5)}`,
      type: 'RETAIL',
      status: 'CONFIRMED',
      subtotal: total,
      total,
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      shippingAddress: {
        recipient: 'Khach IT',
        phone: '0900000000',
        street: '1 Duong IT',
        ward: 'Phuong IT',
        district: '',
        province: 'Ha Noi',
        provinceCode: '01',
        districtCode: '',
        wardCode: '00001',
      },
      ...data,
    },
  });
}

/** Tóm tắt Promise.allSettled: số fulfilled/rejected + message các lỗi (để in khi assert fail). */
export function summarize<T>(results: PromiseSettledResult<T>[]) {
  const fulfilled = results.filter((r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled');
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  return {
    fulfilled,
    rejected,
    errors: rejected.map((r) => {
      const e = r.reason as { name?: string; message?: string; code?: string };
      return `${e?.name ?? 'Error'}${e?.code ? `[${e.code}]` : ''}: ${e?.message ?? String(r.reason)}`;
    }),
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Rào chắn tất định cho pre-check "đọc ngoài tx": N lần gọi ĐẦU TIÊN của `obj[method]` chạy query
 * THẬT, nhưng KHÔNG ai nhận kết quả cho tới khi cả N query đã xong. Vì không caller nào qua được
 * pre-check trước khi mọi pre-check đã đọc DB, tất cả đều thấy "chưa có" và lao vào bước ghi →
 * chứng minh chính ràng buộc DB (unique/guard) chặn kẻ thua, chứ không phải pre-check may mắn tuần
 * tự hoá (vd pool nguội: 1 caller chạy hết trên kết nối ấm trước khi các kết nối mới kịp mở).
 * Các lần gọi sau N đi thẳng (vd re-read sau P2002). Trả về spy (mockRestore khi xong).
 */
export function barrierOnFirstCalls<T extends object, K extends keyof T>(obj: T, method: K, n: number) {
  const original = (obj[method] as unknown as (...a: unknown[]) => unknown).bind(obj);
  let calls = 0;
  let done = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jest.spyOn(obj as any, method as any).mockImplementation(async (...args: unknown[]) => {
    const idx = calls++;
    let result: unknown;
    let error: unknown;
    let failed = false;
    try {
      result = await original(...args);
    } catch (e) {
      failed = true;
      error = e;
    }
    if (idx < n) {
      done += 1;
      if (done === n) release();
      await gate;
    }
    if (failed) throw error;
    return result;
  });
}

/** Mở sẵn nhiều kết nối trong pool Prisma để các request "đồng thời" thật sự chạy song song ở DB. */
export async function warmPool(prisma: PrismaService, connections = 12) {
  await Promise.all(Array.from({ length: connections }, () => prisma.$queryRaw`SELECT pg_sleep(0.05)::text AS s`));
}
