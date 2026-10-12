/**
 * Prod không chạy `prisma db seed` (nhiều migration ghi rõ điều này) mà quy ước đó chỉ nằm trong tài
 * liệu: seed ghi đè sản phẩm, hạng và mọi khoá không đánh dấu `createOnly`, trong đó có tài khoản ngân
 * hàng nhận tiền chuyển khoản. Chạy nhầm trên DB thật thì khách chuyển tiền vào tài khoản mẫu, và
 * không có thông báo lỗi nào. Cờ phải gõ tay nên không thể bật do nhầm lệnh.
 */
export function assertSeedAllowed(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production' && env.ALLOW_PROD_SEED !== '1') {
    throw new Error(
      'Seed bị chặn khi NODE_ENV=production: nó ghi đè sản phẩm, hạng và các khoá cấu hình không đánh dấu createOnly (gồm tài khoản ngân hàng nhận tiền). Chỉ đặt ALLOW_PROD_SEED=1 khi chắc chắn đây là DB mới chưa có dữ liệu thật.',
    );
  }
}
