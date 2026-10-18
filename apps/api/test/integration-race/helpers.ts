import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Prisma, type UserRole } from '@prisma/client';
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

/** Đại lý kèm địa chỉ mặc định — đơn đại lý cần người nhận cho kho Pancake (DealerService.placeOrder). */
export async function createDealer(
  prisma: PrismaService,
  data: Partial<Prisma.UserUncheckedCreateInput> = {},
) {
  const user = await createUser(prisma, { role: 'DEALER', ...data });
  await prisma.address.create({
    data: {
      userId: user.id,
      recipient: 'Dai ly IT',
      phone: '0911000000',
      street: '2 Duong IT',
      ward: 'Phuong IT',
      district: '',
      province: 'Ha Noi',
      provinceCode: '84_VN01',
      districtCode: '',
      wardCode: '00001',
      isDefault: true,
    },
  });
  return user;
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

/**
 * Ghim tạm một khoá cấu hình và trả hàm khôi phục đúng giá trị trước đó (xoá dòng nếu trước đó chưa có). Spec ghim tỉ giá điểm
 * phải khôi phục: DB dùng chung mà để lại loyalty.vnd_per_point_redeem = 1000 thì seed/migration sau đó thấy tỉ giá cũ.
 */
export async function pinConfig(prisma: PrismaService, key: string, value: Prisma.InputJsonValue): Promise<() => Promise<void>> {
  const prev = await prisma.systemConfig.findUnique({ where: { key } });
  await setConfig(prisma, key, value);
  return async () => {
    if (prev) await prisma.systemConfig.update({ where: { key }, data: { value: prev.value as Prisma.InputJsonValue } });
    else await prisma.systemConfig.deleteMany({ where: { key } });
  };
}

/**
 * Đơn dựng thẳng ở DELIVERED mặc định đã xong việc sau giao (có mốc deliveredEffectsAt), như đơn đi qua setStatus thật: nếu không,
 * DB dùng chung đầy đơn "giao mà chưa xong việc" và cron chạy lại / Sức khoẻ hệ thống của spec khác thấy chúng. Ca cần đơn chưa
 * xong thì truyền `deliveredEffectsAt: null`.
 */
export async function createOrder(
  prisma: PrismaService,
  data: Partial<Prisma.OrderUncheckedCreateInput> & { userId: string },
) {
  const total = data.total ?? 100_000;
  const effectsDone =
    data.status === 'DELIVERED' && data.deliveredEffectsAt === undefined ? { deliveredEffectsAt: data.deliveredAt ?? new Date() } : {};
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
        provinceCode: '84_VN01',
        districtCode: '',
        wardCode: '00001',
      },
      ...effectsDone,
      ...data,
    },
  });
}

/**
 * Đánh dấu xong việc sau giao cho mọi đơn DELIVERED còn thiếu mốc (đơn spec khác lật thẳng bằng prisma.order.update hoặc giao
 * qua setStatus với việc sau giao giả lập lỗi). Spec đọc Sức khoẻ hệ thống gọi trước mỗi ca để chỉ thấy sự cố của chính nó.
 */
export async function markDeliveredEffectsDone(prisma: PrismaService) {
  await prisma.$executeRaw`
    UPDATE "orders" SET "deliveredEffectsAt" = COALESCE("deliveredAt", now())
     WHERE "status" = 'DELIVERED' AND "deliveredEffectsAt" IS NULL`;
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

/**
 * Mở sẵn nhiều kết nối trong pool Prisma để các request "đồng thời" thật sự chạy song song ở DB.
 * Mở mới quá ~20 kết nối cùng lúc qua Docker Desktop có thể treo hàng giây (P2028 ở tx đầu), nên khởi động trước đủ.
 */
export async function warmPool(prisma: PrismaService, connections = 20) {
  await Promise.all(Array.from({ length: connections }, () => prisma.$queryRaw`SELECT pg_sleep(0.05)::text AS s`));
}

/**
 * Xoá dữ liệu một spec đã tạo (khách và mọi dòng của họ, sản phẩm/biến thể, đợt giờ vàng), theo thứ tự khoá ngoại RESTRICT: đợt
 * giờ vàng còn hiệu lực hay đơn/sổ của khách thử ở lại DB dùng chung làm sai các spec sau liệt kê giờ vàng hay quét đơn.
 */
export async function deleteItData(
  prisma: PrismaService,
  ids: { userIds?: string[]; productIds?: string[]; flashSaleIds?: string[] },
) {
  const userIds = ids.userIds ?? [];
  const productIds = ids.productIds ?? [];
  const flashSaleIds = ids.flashSaleIds ?? [];
  const orders = Prisma.sql`SELECT "id" FROM "orders" WHERE "userId" = ANY(${userIds}::text[])`;
  const variations = Prisma.sql`SELECT "id" FROM "variations" WHERE "productId" = ANY(${productIds}::text[])`;
  await prisma.$executeRaw`DELETE FROM "return_requests" WHERE "userId" = ANY(${userIds}::text[])`;
  // Mọi bảng tham chiếu users/đơn/sản phẩm/biến thể bằng khoá ngoại RESTRICT (ON DELETE CASCADE/SET NULL tự dọn theo).
  for (const table of [
    'points_transactions',
    'wallet_transactions',
    'coin_transactions',
    'flash_sale_purchases',
    'affiliate_links',
    'cashback_clicks',
    'cashback_transactions',
    'ctv_milestone_claims',
    'dealer_applications',
    'dealer_order_templates',
    'payouts',
    'xu_points_conversions',
  ]) {
    await prisma.$executeRaw`DELETE FROM ${Prisma.raw(`"${table}"`)} WHERE "userId" = ANY(${userIds}::text[])`;
  }
  await prisma.$executeRaw`
    DELETE FROM "pos_point_credits" WHERE "memberId" = ANY(${userIds}::text[]) OR "staffUserId" = ANY(${userIds}::text[])`;
  await prisma.$executeRaw`
    DELETE FROM "reviews" WHERE "userId" = ANY(${userIds}::text[]) OR "productId" = ANY(${productIds}::text[])`;
  await prisma.$executeRaw`DELETE FROM "order_customer_refunds" WHERE "orderId" IN (${orders})`;
  await prisma.$executeRaw`DELETE FROM "merchant_payout_lines" WHERE "orderId" IN (${orders})`;
  await prisma.$executeRaw`DELETE FROM "commissions" WHERE "affiliateUserId" = ANY(${userIds}::text[]) OR "orderId" IN (${orders})`;
  await prisma.$executeRaw`DELETE FROM "orders" WHERE "userId" = ANY(${userIds}::text[])`;
  await prisma.$executeRaw`DELETE FROM "flash_sales" WHERE "id" = ANY(${flashSaleIds}::text[])`;
  await prisma.$executeRaw`DELETE FROM "flash_sale_items" WHERE "variationId" IN (${variations})`;
  await prisma.$executeRaw`DELETE FROM "cart_items" WHERE "variationId" IN (${variations})`;
  await prisma.$executeRaw`
    DELETE FROM "merchant_pancake_links" WHERE "productId" = ANY(${productIds}::text[]) OR "variationId" IN (${variations})`;
  await prisma.$executeRaw`DELETE FROM "storefront_items" WHERE "productId" = ANY(${productIds}::text[])`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ANY(${userIds}::text[])`;
  await prisma.$executeRaw`DELETE FROM "products" WHERE "id" = ANY(${productIds}::text[])`;
}
