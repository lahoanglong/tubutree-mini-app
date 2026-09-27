// apps/api/scripts/backfill-analytics-2026-09.ts
// Chạy 1 LẦN sau khi đã áp migration analytics_foundation. KHÔNG chạy trong CI/migrate deploy.
// Usage: cd apps/api && npx ts-node scripts/backfill-analytics-2026-09.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1) source/platform best-effort cho đơn cũ — không chính xác 100%, xem spec §Rollout.
  //    LƯU Ý: KHÔNG dùng `"subscriptionId" IS NOT NULL` để nhận diện đơn định kỳ CŨ — cột này
  //    chỉ được Task 8 set cho đơn TẠO SAU migration, nên với dữ liệu lịch sử luôn NULL và điều
  //    kiện đó khớp 0 dòng (verify lại code thật lúc soát plan: subscriptions.service.ts luôn
  //    hard-code `note: 'Đơn đặt định kỳ (Subscribe & Save)'`, đó mới là dấu hiệu nhận diện được
  //    cho đơn cũ). Đơn tạo SAU migration đã có `subscriptionId` set trực tiếp bởi Task 8, không
  //    cần dòng UPDATE này chạm tới.
  await prisma.$executeRaw`
    UPDATE orders SET source = 'subscription', platform = 'system'
    WHERE note = 'Đơn đặt định kỳ (Subscribe & Save)' AND source IS NULL
  `;
  await prisma.$executeRaw`
    UPDATE orders SET source = 'dealer', platform = 'web'
    WHERE type = 'DEALER' AND source IS NULL
  `;
  // "ctv_assisted" gồm 2 luồng khác nhau (phân biệt được qua placedForCustomer nếu cần phân
  // tích sâu hơn sau này): khách tự chọn mua trên gian hàng CTV (storefrontSlug có giá trị) HOẶC
  // CTV tự lên đơn hộ khách (placedForCustomer=true — CTV cũ có thể CHƯA có gian hàng riêng nên
  // storefrontSlug vẫn null, riêng điều kiện storefrontSlug sẽ bỏ sót nhóm này — phát hiện ở
  // review Task 10).
  await prisma.$executeRaw`
    UPDATE orders SET source = 'ctv_assisted', platform = 'miniapp'
    WHERE ("storefrontSlug" IS NOT NULL OR "placedForCustomer" = true) AND source IS NULL
  `;
  await prisma.$executeRaw`
    UPDATE orders SET source = 'checkout', platform = 'miniapp'
    WHERE source IS NULL
  `;

  // 2) paidAt — CHỈ COD (paidAt := deliveredAt, suy luận nghiệp vụ đúng). Đơn online cũ không
  //    backfill được đáng tin cậy (order_status_history chưa từng ghi lúc lật PAID) — để trống.
  await prisma.$executeRaw`
    UPDATE orders SET "paidAt" = "deliveredAt"
    WHERE "paymentMethod" = 'COD' AND "paymentStatus" = 'PAID' AND "deliveredAt" IS NOT NULL AND "paidAt" IS NULL
  `;

  // 2b) endCustomerKey cho đơn CTV lên-đơn-hộ CŨ (trước khi Task 10 kịp set cho đơn mới) — lấy
  //     từ shippingAddress->>'phone' (JSON snapshot luôn có field `phone`, xem
  //     checkout.service.ts addressSnapshot() / affiliate.service.ts customerSnapshot()).
  //     QUAN TRỌNG (phát hiện ở review Task 10): CTV order-sheet FE chấp nhận CẢ 2 dạng nhập
  //     `0xxxxxxxxx` VÀ `+84xxxxxxxxx` — nếu chỉ strip ký tự không phải số thì SĐT dạng `84...`
  //     (11 chữ số) sẽ KHÔNG khớp `user.phone` (luôn ở dạng `0...`, 10 chữ số — xem
  //     zalo.service.ts/loyalty.service.ts đã tự quy đổi 84→0). Phải quy đổi CÙNG kiểu ở đây,
  //     khớp đúng helper `normalizeToLocalPhone()` Task 10 đã thêm vào affiliate.service.ts.
  await prisma.$executeRaw`
    UPDATE orders SET "endCustomerKey" = NULLIF(
      regexp_replace(
        regexp_replace("shippingAddress"->>'phone', '\\D', '', 'g'),
        '^84(\\d{9})$', '0\\1'
      ), ''
    )
    WHERE "placedForCustomer" = true AND "endCustomerKey" IS NULL AND "shippingAddress"->>'phone' IS NOT NULL
  `;

  // 3) baseline NS-1/repeat theo cohort — CHỈ ĐỌC, in ra console để lưu snapshot tay lần đầu.
  const baseline = await prisma.$queryRaw<Array<{ cohort: Date; new_buyers: bigint; repeat_30d: number }>>`
    WITH v AS (
      SELECT
        COALESCE(
          CASE WHEN o."placedForCustomer" THEN o."endCustomerKey" END,
          NULLIF(regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g'), ''),
          o."userId"
        ) AS customer_key,
        (o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh' AS t,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(
            CASE WHEN o."placedForCustomer" THEN o."endCustomerKey" END,
            NULLIF(regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g'), ''),
            o."userId"
          )
          ORDER BY o."createdAt", o.id
        ) AS n
      FROM orders o
      JOIN users u ON u.id = o."userId"
      WHERE o.type = 'RETAIL' AND o.status NOT IN ('CANCELLED', 'RETURNED')
    ), f AS (
      SELECT a.customer_key, a.t AS t1, b.t AS t2
      FROM v a LEFT JOIN v b ON b.customer_key = a.customer_key AND b.n = 2
      WHERE a.n = 1
    )
    SELECT date_trunc('month', t1) AS cohort, COUNT(*) AS new_buyers,
           AVG(CASE WHEN t2 <= t1 + interval '30 days' THEN 1.0 ELSE 0 END) AS repeat_30d
    FROM f
    WHERE t1 < now() AT TIME ZONE 'Asia/Ho_Chi_Minh' - interval '30 days'
    GROUP BY 1 ORDER BY 1;
  `;
  console.log('Baseline NS-1 theo cohort:', baseline);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
