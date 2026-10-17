/**
 * Tắt dữ liệu demo mà migration 20260616000000_demo_catalog_multibrand nạp vào mọi DB mới (44 sản phẩm, 48 biến thể,
 * 3 mã giảm giá công khai). Chạy MỘT lần sau `prisma migrate deploy` đầu tiên trên PROD, trước khi mở bán.
 *
 * Dùng (trong container api trên máy chủ):
 *   pnpm run prisma:cleanup-demo                                   # xem trước: không ghi gì
 *   pnpm run prisma:cleanup-demo -- --apply                        # tắt sản phẩm, biến thể; giữ nguyên mã
 *   pnpm run prisma:cleanup-demo -- --apply --coupons=expire       # thêm: tắt cả 3 mã demo
 *   pnpm run prisma:cleanup-demo -- --apply --coupons=expire --keep-coupon=WELCOME30   # tắt mã demo, trừ mã được duyệt
 *
 * Thoát 0 khi xong (kể cả khi không còn gì để đổi), 2 khi tham số sai hoặc DB không có dòng demo nào, 1 khi lỗi khác.
 * Logic nằm ở src/config/demo-data (có test); file này chỉ nối DB và in kết quả.
 */
import {
  applyDemoCleanup,
  formatPlan,
  formatResult,
  formatUndoSql,
  hasDemoData,
  NoDemoDataError,
  parseCleanupArgs,
  previewDemoCleanup,
} from '../src/config/demo-data/cleanup';

// Đọc TRƯỚC khi nạp @prisma/client: lúc import, Prisma tự đổ file .env (vd apps/api/.env trỏ DB dev) vào process.env,
// nên kiểm sau đó thì "chưa đặt DATABASE_URL" không bao giờ xảy ra và script lặng lẽ chạy lên DB trong file .env.
const DATABASE_URL = process.env.DATABASE_URL;

/** Máy, cổng, tên DB (không in tài khoản/mật khẩu) để người chạy thấy đúng DB trước khi đọc kết quả. */
function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}${u.searchParams.get('schema') ? ` (schema ${u.searchParams.get('schema')})` : ''}`;
  } catch {
    return 'DATABASE_URL không đọc được';
  }
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseCleanupArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return 2;
  }
  // Truyền thẳng URL cho Prisma: DB in ra dưới đây đúng là DB sẽ bị đổi.
  const url = DATABASE_URL;
  if (!url) {
    console.error('Chưa đặt DATABASE_URL. Chạy trong container api, hoặc đặt biến này trỏ đúng DB cần dọn.');
    return 2;
  }
  console.log(`DB: ${describeTarget(url)}, lúc ${new Date().toISOString()}`);
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    if (!args.apply) {
      const plan = await previewDemoCleanup(prisma);
      if (!hasDemoData(plan)) {
        console.error(new NoDemoDataError().message);
        return 2;
      }
      console.log(formatPlan(plan, args));
      return 0;
    }
    const { plan, result } = await applyDemoCleanup(prisma, { coupons: args.coupons, keepCoupons: args.keepCoupons });
    console.log(formatPlan(plan, args));
    console.log('');
    console.log(formatResult(result));
    console.log('');
    console.log(formatUndoSql(result));
    return 0;
  } catch (e) {
    if (e instanceof NoDemoDataError) {
      console.error(e.message);
      return 2;
    }
    throw e;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    // Chỉ in tên và mã lỗi: thông điệp gốc của Prisma có thể chứa địa chỉ hoặc tên đăng nhập DB.
    const code = (e as { code?: unknown }).code;
    console.error(`Dọn dữ liệu demo lỗi (${e instanceof Error ? e.name : 'lỗi không rõ'}${typeof code === 'string' ? ` ${code}` : ''}), transaction đã huỷ, DB không đổi.`);
    process.exitCode = 1;
  });
