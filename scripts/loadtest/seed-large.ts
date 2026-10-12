/**
 * Sinh dữ liệu LỚN thực tế vào DB đo hiệu năng `tubutree_perf` (KHÔNG chạy vào DB khác).
 *
 * Tái tạo từ đầu (xem docs/2026-10-review/03-perf.md, mục "Cách tái tạo"):
 *   docker exec tubu_pg createdb -U tubu tubutree_perf
 *   cd apps/api
 *   DATABASE_URL=postgresql://tubu:tubu@localhost:5434/tubutree_perf?schema=public npx prisma migrate deploy
 *   DATABASE_URL=... npx tsx prisma/seed.ts
 *   DATABASE_URL=... npx tsx ../../scripts/loadtest/seed-large.ts
 *
 * Idempotent: xoá các dòng có id bắt đầu bằng "perf_" rồi sinh lại. Dữ liệu tất định (hash theo chỉ số
 * dòng, không dùng random()) nên hai lần chạy cho cùng phân phối.
 * Quy mô mặc định: 3.000 SP (6.000 variation), 50.000 user, 200.000 đơn (~500k order_items),
 * 500.000 notification_logs, 500.000 analytics_events, 300.000 refresh_tokens, 100.000 coupon cá nhân...
 * Biến môi trường PERF_USERS/PERF_PRODUCTS/PERF_ORDERS/PERF_EVENTS/PERF_NOTIFS để chỉnh quy mô.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const apiDir = path.resolve(__dirname, '../../apps/api');
const req = createRequire(path.join(apiDir, 'package.json'));
const { PrismaClient } = req('@prisma/client') as typeof import('@prisma/client');

const url = process.env.DATABASE_URL ?? '';
if (!/\/tubutree_perf(\?|$)/.test(url)) {
  console.error('TỪ CHỐI: DATABASE_URL phải trỏ tới database "tubutree_perf". Hiện tại:', url.replace(/:[^:@]*@/, ':***@'));
  process.exit(2);
}

const N_USERS = Number(process.env.PERF_USERS ?? 50_000);
const N_PRODUCTS = Number(process.env.PERF_PRODUCTS ?? 3_000);
const N_ORDERS = Number(process.env.PERF_ORDERS ?? 200_000);
const N_EVENTS = Number(process.env.PERF_EVENTS ?? 500_000);
const N_NOTIFS = Number(process.env.PERF_NOTIFS ?? 500_000);
const N_TOKENS = Number(process.env.PERF_TOKENS ?? 300_000);
const N_COUPONS = Number(process.env.PERF_COUPONS ?? 100_000);

const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Số giả ngẫu nhiên tất định trong [0,1) từ chỉ số dòng `i` + muối. */
const R = (salt: string, col = 'i') => `((hashtext('${salt}' || ${col}::text)::bigint & 2147483647) / 2147483648.0)`;
/** Chọn user lệch (power-user): chỉ số 1..N_USERS, dồn về chỉ số nhỏ. */
const SKEW_USER = (salt: string, col = 'i', pow = 1.8) => `(floor(${N_USERS} * power(${R(salt, col)}, ${pow}))::int + 1)`;
/** Chọn SP lệch (hàng bán chạy): 1..N_PRODUCTS. */
const SKEW_PROD = (salt: string, col = 'i') => `(floor(${N_PRODUCTS} * power(${R(salt, col)}, 2.0))::int + 1)`;

async function step(name: string, sql: string): Promise<void> {
  const t0 = Date.now();
  const n = await prisma.$executeRawUnsafe(sql);
  console.log(`[seed-large] ${name}: ${n} dòng, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('[seed-large] DB OK; users=%d products=%d orders=%d', N_USERS, N_PRODUCTS, N_ORDERS);

  // ── Dọn dữ liệu perf cũ (đúng thứ tự FK) ──────────────────────────────────────────────────────
  const wipes: [string, string][] = [
    ['flash_sale_purchases', `DELETE FROM flash_sale_purchases WHERE "flashSaleItemId" LIKE 'perf_%'`],
    ['flash_sale_items', `DELETE FROM flash_sale_items WHERE id LIKE 'perf_%'`],
    ['flash_sales', `DELETE FROM flash_sales WHERE id LIKE 'perf_%'`],
    ['subscriptions', `DELETE FROM subscriptions WHERE id LIKE 'perf_%'`],
    ['wishlists', `DELETE FROM wishlists WHERE id LIKE 'perf_%'`],
    ['feed_comments', `DELETE FROM feed_comments WHERE id LIKE 'perf_%'`],
    ['feed_reactions', `DELETE FROM feed_reactions WHERE id LIKE 'perf_%'`],
    ['feed_posts', `DELETE FROM feed_posts WHERE id LIKE 'perf_%'`],
    ['reviews', `DELETE FROM reviews WHERE id LIKE 'perf_%'`],
    ['coupon_redemptions', `DELETE FROM coupon_redemptions WHERE id LIKE 'perf_%'`],
    ['coupons', `DELETE FROM coupons WHERE id LIKE 'perf_%'`],
    ['points_transactions', `DELETE FROM points_transactions WHERE id LIKE 'perf_%'`],
    ['refresh_tokens', `DELETE FROM refresh_tokens WHERE id LIKE 'perf_%'`],
    ['analytics_events', `DELETE FROM analytics_events WHERE id LIKE 'perf_%'`],
    ['notification_logs', `DELETE FROM notification_logs WHERE id LIKE 'perf_%'`],
    ['order_status_history', `DELETE FROM order_status_history WHERE id LIKE 'perf_%'`],
    ['order_items', `DELETE FROM order_items WHERE id LIKE 'perf_%'`],
    ['orders', `DELETE FROM orders WHERE id LIKE 'perf_%'`],
    ['cart_items', `DELETE FROM cart_items WHERE id LIKE 'perf_%'`],
    ['carts', `DELETE FROM carts WHERE id LIKE 'perf_%'`],
    ['addresses', `DELETE FROM addresses WHERE id LIKE 'perf_%'`],
    ['users', `DELETE FROM users WHERE id LIKE 'perf_%'`],
    ['variations', `DELETE FROM variations WHERE id LIKE 'perf_%'`],
    ['products', `DELETE FROM products WHERE id LIKE 'perf_%'`],
    ['brands', `DELETE FROM brands WHERE id LIKE 'perf_%'`],
  ];
  for (const [name, sql] of wipes) await step(`wipe ${name}`, sql);

  // ── Brands ────────────────────────────────────────────────────────────────────────────────────
  await step(
    'brands',
    `INSERT INTO brands (id, slug, name, "isPublished", "isVerified", "updatedAt")
     SELECT 'perf_b_' || i, 'perf-nhan-hang-' || i, 'Nhãn Perf ' || i, true, (i % 3 = 0), now()
     FROM generate_series(1, 40) AS i`,
  );

  // ── Products (3.000) ──────────────────────────────────────────────────────────────────────────
  await step(
    'products',
    `INSERT INTO products (id, "pancakeId", brand, "brandId", slug, name, description, "shortDesc", images, thumbnail,
                           "categoryIds", tags, "isActive", "isFeatured", "ratingAvg", "reviewCount", "soldExternal", "soldApp",
                           "basePrice", "salePrice", "forSegment", ingredients, certifications, "approvalStatus", "createdAt", "updatedAt")
     SELECT 'perf_p_' || i, 'perf-pc-' || i,
            'Nhãn Perf ' || (1 + (i % 40)), 'perf_b_' || (1 + (i % 40)),
            'perf-san-pham-' || i,
            (ARRAY['Phân bón hữu cơ','Hạt giống rau muống','Chậu cây thông minh','Đất trồng sạch','Máy phun sương','Cây lưỡi hổ','Sen đá mini','Bình tưới nước','Dung dịch dinh dưỡng','Kéo cắt tỉa'])[1 + (i % 10)] || ' ' || i,
            repeat('Sản phẩm thử nghiệm hiệu năng, mô tả dài để phản ánh dung lượng thật của cột description. ', 4),
            'Mô tả ngắn sản phẩm ' || i,
            ARRAY['https://example.invalid/img/' || i || '-1.jpg', 'https://example.invalid/img/' || i || '-2.jpg'],
            'https://example.invalid/img/' || i || '-1.jpg',
            ARRAY[(SELECT id FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM categories) c WHERE c.rn = 1 + (i % 7))],
            ARRAY['tag' || (i % 25), 'perf'],
            (i % 20 <> 0), (i % 20 = 1),
            round((3 + ${R('rt')} * 2)::numeric, 1)::float8, (${R('rc')} * 200)::int,
            (${R('se')} * 1500)::int, (${R('sa')} * 800)::int,
            (50 + (${R('bp')} * 450)::int) * 1000, CASE WHEN i % 4 = 0 THEN (40 + (${R('sp')} * 300)::int) * 1000 END,
            ARRAY[(ARRAY['seed','vegetable','indoor','gift'])[1 + (i % 4)]],
            '{"thanhPhan":["a","b"]}'::jsonb, ARRAY['VietGAP'], 'APPROVED',
            now() - ((${R('pc')} * 700) || ' days')::interval, now()
     FROM generate_series(1, ${N_PRODUCTS}) AS i`,
  );
  await step(
    'variations',
    `INSERT INTO variations (id, "pancakeId", "productId", sku, name, attributes, "retailPrice", "salePrice", stock, "isActive", weight)
     SELECT 'perf_v_' || p || '_' || k, 'perf-vpc-' || p || '-' || k, 'perf_p_' || p, 'PERF-' || p || '-' || k,
            CASE k WHEN 1 THEN 'Loại nhỏ' ELSE 'Loại lớn' END, '{"size":"S"}'::jsonb,
            (50 + (${R('vp', 'p')} * 450)::int) * 1000 + (k - 1) * 20000, NULL,
            CASE WHEN p <= 600 THEN 100000 ELSE (${R('vs', "(p*3+k)")} * 200)::int END, true, 300 * k
     FROM generate_series(1, ${N_PRODUCTS}) AS p, generate_series(1, 2) AS k`,
  );

  // ── Users + addresses ────────────────────────────────────────────────────────────────────────
  await step(
    'users',
    `INSERT INTO users (id, "zaloId", phone, "fullName", role, "referralCode", "pointsBalance", "walletBalance", "coinsBalance", "isBlocked", "createdAt", "updatedAt")
     SELECT 'perf_u_' || i, 'perf_zalo_' || i, '09' || lpad(i::text, 8, '0'), 'Khách Perf ' || i,
            (CASE WHEN i = 1 THEN 'ADMIN' WHEN i % 100 = 0 THEN 'AFFILIATE' WHEN i % 1000 = 7 THEN 'DEALER' ELSE 'CUSTOMER' END)::"UserRole",
            'PF' || lpad(i::text, 7, '0'), (${R('ub')} * 5000)::int, 0, 0, false,
            now() - ((${R('uc')} * 540) || ' days')::interval, now()
     FROM generate_series(1, ${N_USERS}) AS i`,
  );
  await step(
    'addresses',
    `INSERT INTO addresses (id, "userId", recipient, phone, province, district, ward, street, "isDefault", "provinceCode", "districtCode", "wardCode")
     SELECT 'perf_a_' || i, 'perf_u_' || i, 'Khách Perf ' || i, '09' || lpad(i::text, 8, '0'),
            'Hà Nội', 'Cầu Giấy', 'Dịch Vọng', i || ' Đường Perf', true, '01', '005', '00160'
     FROM generate_series(1, ${N_USERS}) AS i`,
  );

  // ── Carts (20% user có giỏ, 1–3 dòng) ────────────────────────────────────────────────────────
  await step(
    'carts',
    `INSERT INTO carts (id, "userId", "updatedAt") SELECT 'perf_c_' || i, 'perf_u_' || i, now() - ((${R('cu')} * 20) || ' days')::interval
     FROM generate_series(1, ${N_USERS}) AS i WHERE i % 5 = 0`,
  );
  await step(
    'cart_items',
    `INSERT INTO cart_items (id, "cartId", "variationId", quantity)
     SELECT 'perf_ci_' || i || '_' || k, 'perf_c_' || i, 'perf_v_' || (1 + ((i * 7 + k * 131) % ${N_PRODUCTS})) || '_1', 1 + (k % 3)
     FROM generate_series(1, ${N_USERS}) AS i, generate_series(1, 1 + (i % 3)) AS k WHERE i % 5 = 0`,
  );

  // ── Orders (200k) + items + history ──────────────────────────────────────────────────────────
  // Tuổi đơn lệch về gần đây; đơn > 10 ngày tuổi chỉ ở trạng thái cuối.
  await step(
    'orders',
    `INSERT INTO orders (id, code, "userId", type, status, subtotal, discount, "shippingFee", total, "pointsEarned", "pointsUsed",
                         "paymentMethod", "paymentStatus", "shippingAddress", "storefrontSlug", "referrerUserId", source, platform,
                         "createdAt", "updatedAt", "placedForCustomer", commission, "hasRecyclingPickup", "invoiceStatus")
     SELECT id, code, uid, type, status, sub, 0, 20000, sub + 20000, sub / 10000, 0,
            (CASE WHEN pm < 0.7 THEN 'COD' WHEN pm < 0.9 THEN 'BANK_TRANSFER' ELSE 'ZALOPAY' END)::"PaymentMethod",
            (CASE WHEN status = 'DELIVERED' THEN 'PAID' WHEN status IN ('CANCELLED','RETURNED') THEN 'REFUNDED' ELSE 'UNPAID' END)::"PaymentStatus",
            jsonb_build_object('recipient', 'Khách Perf', 'phone', '0900000000', 'province', 'Hà Nội', 'street', 'Số ' || i),
            CASE WHEN sf < 0.03 THEN 'perf-store-' || (i % 50) END, CASE WHEN sf < 0.02 THEN 'perf_u_' || (1 + (i % 500)) END,
            'checkout', 'miniapp', created, created, false, 0, false, 'NOT_REQUESTED'::"InvoiceStatus"
     FROM (
       SELECT i, 'perf_o_' || i AS id, 'TUBUPERF' || lpad(i::text, 9, '0') AS code, 'perf_u_' || ${SKEW_USER('ou')} AS uid,
              (CASE WHEN ${R('ot')} < 0.02 THEN 'DEALER' ELSE 'RETAIL' END)::"OrderType" AS type,
              (CASE WHEN age_d > 10 THEN (CASE WHEN st < 0.80 THEN 'DELIVERED' WHEN st < 0.92 THEN 'CANCELLED' ELSE 'RETURNED' END)
                    ELSE (CASE WHEN st < 0.35 THEN 'DELIVERED' WHEN st < 0.50 THEN 'PENDING_PAYMENT' WHEN st < 0.70 THEN 'CONFIRMED'
                               WHEN st < 0.80 THEN 'PACKED' WHEN st < 0.92 THEN 'SHIPPING' ELSE 'CANCELLED' END) END)::"OrderStatus" AS status,
              (100 + (${R('os')} * 1100)::int) * 1000 AS sub, ${R('pm')} AS pm, ${R('sf')} AS sf,
              now() - (age_d || ' days')::interval - ((${R('oh')} * 86400) || ' seconds')::interval AS created
       FROM (SELECT i, power(${R('oa')}, 1.4) * 540 AS age_d, ${R('st')} AS st FROM generate_series(1, ${N_ORDERS}) AS i) base
     ) o`,
  );
  await step(
    'order_items',
    `INSERT INTO order_items (id, "orderId", "variationId", "productName", "productSlug", "variationName", "unitPrice", quantity, total)
     SELECT 'perf_oi_' || i || '_' || k, 'perf_o_' || i, 'perf_v_' || p || '_' || (1 + ((i + k) % 2)),
            'Sản phẩm perf ' || p, 'perf-san-pham-' || p, 'Loại ' || (1 + ((i + k) % 2)),
            u, q, u * q
     FROM (
       SELECT i, k, ${SKEW_PROD('op', "(i*10+k)")} AS p, (50 + (${R('ou2', "(i*10+k)")} * 450)::int) * 1000 AS u, 1 + (${R('oq', "(i*10+k)")} * 2)::int AS q
       FROM generate_series(1, ${N_ORDERS}) AS i, generate_series(1, 4) AS k
       WHERE k <= 1 + floor(power(${R('on')}, 1.5) * 4)::int
     ) x`,
  );
  await step(
    'order_status_history',
    `INSERT INTO order_status_history (id, "orderId", "fromStatus", "toStatus", "actorType", "createdAt")
     SELECT 'perf_h_' || o.id || '_' || s, o.id, CASE s WHEN 1 THEN 'NEW' ELSE 'PENDING_PAYMENT' END, CASE s WHEN 1 THEN 'PENDING_PAYMENT' ELSE o.status::text END, 'SYSTEM',
           o."createdAt" + (s || ' hours')::interval
     FROM orders o, generate_series(1, 2) AS s WHERE o.id LIKE 'perf_o_%'`,
  );

  // ── Notification logs / analytics / refresh tokens ───────────────────────────────────────────
  await step(
    'notification_logs',
    `INSERT INTO notification_logs (id, "userId", "templateCode", channel, payload, status, "sentAt")
     SELECT 'perf_n_' || i, 'perf_u_' || ${SKEW_USER('nu', 'i', 1.5)},
            (ARRAY['ORDER_CONFIRMED','ORDER_SHIPPING','REORDER_REMINDER','FLASH_START','POINTS_EXPIRING'])[1 + (i % 5)],
            CASE WHEN ${R('nc')} < 0.85 THEN 'INAPP' ELSE 'ZNS' END,
            jsonb_build_object('title', 'Thông báo ' || i, 'body', 'Nội dung thông báo thử nghiệm'),
            CASE WHEN ${R('ns')} < 0.6 THEN 'READ' ELSE 'SENT' END,
            now() - ((${R('nt')} * 400) || ' days')::interval
     FROM generate_series(1, ${N_NOTIFS}) AS i`,
  );
  await step(
    'analytics_events',
    `INSERT INTO analytics_events (id, "eventId", "eventName", "occurredAt", "userId", "anonymousId", "sessionId", platform, props)
     SELECT 'perf_e_' || i, 'perf-ev-' || i,
            (ARRAY['app_open','product_view','search_performed','add_to_cart','checkout_started','order_placed','home_view','browse_view'])[1 + (i % 8)],
            now() - ((${R('et')} * 60) || ' days')::interval,
            CASE WHEN ${R('eu')} < 0.6 THEN 'perf_u_' || ${SKEW_USER('ev', 'i', 1.5)} END,
            'anon-' || (i % 80000), 'sess-' || (i % 200000), 'miniapp',
            jsonb_build_object('slug', 'perf-san-pham-' || (i % ${N_PRODUCTS}))
     FROM generate_series(1, ${N_EVENTS}) AS i`,
  );
  await step(
    'refresh_tokens',
    `INSERT INTO refresh_tokens (id, "userId", "tokenHash", "expiresAt", "revokedAt", "createdAt")
     SELECT 'perf_r_' || i, 'perf_u_' || ${SKEW_USER('ru', 'i', 1.4)}, md5('perf-rt-' || i) || md5('x' || i),
            t + interval '30 days', CASE WHEN ${R('rr')} < 0.7 THEN t + interval '1 day' END, t
     FROM (SELECT i, now() - ((${R('rt2')} * 400) || ' days')::interval AS t FROM generate_series(1, ${N_TOKENS}) AS i) x`,
  );

  // ── Coupons (PUBLIC + cá nhân USER_GROUP theo A7-09), redemptions ────────────────────────────
  await step(
    'coupons',
    `INSERT INTO coupons (id, code, type, value, "minOrder", "startAt", "endAt", "usageLimit", "perUserLimit", scope, "scopeMeta")
     SELECT 'perf_cp_' || i, 'PERF' || i, 'AMOUNT'::"CouponType", 20000, 100000,
            now() - interval '60 days',
            CASE WHEN ${R('cx')} < 0.3 THEN now() + interval '30 days' ELSE now() - interval '5 days' END,
            1, 1,
            (CASE WHEN i <= 20 THEN 'PUBLIC' ELSE 'USER_GROUP' END)::"CouponScope",
            CASE WHEN i > 20 THEN jsonb_build_object('userId', 'perf_u_' || (1 + (i % ${N_USERS}))) END
     FROM generate_series(1, ${N_COUPONS}) AS i`,
  );
  await step(
    'coupon_redemptions',
    `INSERT INTO coupon_redemptions (id, "couponId", "userId", "orderId", "redeemedAt")
     SELECT 'perf_cr_' || i, 'perf_cp_' || i, 'perf_u_' || (1 + (i % ${N_USERS})), 'perf_o_' || i, now() - interval '10 days'
     FROM generate_series(21, ${Math.min(60_000, N_COUPONS)}) AS i`,
  );

  // ── Reviews / feed / points / wishlist ───────────────────────────────────────────────────────
  await step(
    'reviews',
    `INSERT INTO reviews (id, "userId", "productId", "orderId", rating, comment, "createdAt")
     SELECT 'perf_rv_' || n, 'perf_u_' || (1 + (n % ${N_USERS})), 'perf_p_' || (1 + ((n * 131) % ${N_PRODUCTS})), 'perf_o_' || (1 + (n % ${N_ORDERS})),
            3 + (n % 3), 'Đánh giá thử nghiệm số ' || n, now() - ((${R('rvt', 'n')} * 300) || ' days')::interval
     FROM generate_series(1, 60000) AS n ON CONFLICT DO NOTHING`,
  );
  await step(
    'feed_posts',
    `INSERT INTO feed_posts (id, "userId", body, status, "categoryId", "createdAt")
     SELECT 'perf_fp_' || i, 'perf_u_' || (1 + (i % ${N_USERS})), 'Bài viết cộng đồng số ' || i || ' — chia sẻ kinh nghiệm trồng cây.', 'PUBLISHED',
            (SELECT id FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM community_categories) c WHERE c.rn = 1 + (i % 6)),
            now() - ((${R('fpt')} * 200) || ' days')::interval
     FROM generate_series(1, 20000) AS i`,
  );
  await step(
    'feed_reactions',
    `INSERT INTO feed_reactions (id, "postId", "userId") SELECT 'perf_fr_' || i, 'perf_fp_' || (1 + (i % 20000)), 'perf_u_' || (1 + ((i * 37) % ${N_USERS}))
     FROM generate_series(1, 100000) AS i ON CONFLICT DO NOTHING`,
  );
  await step(
    'feed_comments',
    `INSERT INTO feed_comments (id, "postId", "userId", body) SELECT 'perf_fc_' || i, 'perf_fp_' || (1 + (i % 20000)), 'perf_u_' || (1 + ((i * 53) % ${N_USERS})), 'Bình luận ' || i
     FROM generate_series(1, 50000) AS i`,
  );
  await step(
    'points_transactions',
    `INSERT INTO points_transactions (id, "userId", delta, reason, "expiresAt", "createdAt")
     SELECT 'perf_pt_' || i, 'perf_u_' || ${SKEW_USER('pu')}, CASE WHEN i % 5 = 0 THEN -100 ELSE 50 END, 'ORDER',
            CASE WHEN i % 5 <> 0 THEN now() + ((${R('pe')} * 700 - 100) || ' days')::interval END,
            now() - ((${R('pt')} * 500) || ' days')::interval
     FROM generate_series(1, 300000) AS i`,
  );
  await step(
    'wishlists',
    `INSERT INTO wishlists (id, "userId", "productId") SELECT 'perf_w_' || i, 'perf_u_' || ${SKEW_USER('wu')}, 'perf_p_' || ${SKEW_PROD('wp')}
     FROM generate_series(1, 100000) AS i ON CONFLICT DO NOTHING`,
  );

  // ── Subscriptions (20k, một phần đến hạn) ────────────────────────────────────────────────────
  await step(
    'subscriptions',
    `INSERT INTO subscriptions (id, "userId", "variationId", quantity, "intervalWeeks", "addressId", status, "nextRunAt", "updatedAt")
     SELECT 'perf_s_' || i, 'perf_u_' || i, 'perf_v_' || (1 + (i % 600)) || '_1', 1, 4 + 2 * (i % 4), 'perf_a_' || i,
            CASE WHEN i % 10 = 0 THEN 'PAUSED' ELSE 'ACTIVE' END,
            now() + ((${R('sn')} * 60 - 3) || ' days')::interval, now()
     FROM generate_series(1, 20000) AS i`,
  );

  // ── Flash sale đang chạy: 20 item quota 500 + 1 item "oversell" quota 50 ─────────────────────
  await step(
    'flash_sales',
    `INSERT INTO flash_sales (id, title, "startAt", "endAt", "isActive", "createdBy", "updatedAt")
     VALUES ('perf_fs_1', 'Giờ vàng perf', now() - interval '1 hour', now() + interval '90 days', true, 'perf_u_1', now())`,
  );
  await step(
    'flash_sale_items',
    `INSERT INTO flash_sale_items (id, "flashSaleId", "variationId", "flashPrice", quota, "soldCount", "perUserLimit")
     SELECT 'perf_fsi_' || p, 'perf_fs_1', 'perf_v_' || p || '_1', 29000, CASE WHEN p = 1 THEN 50 ELSE 500 END, 0, CASE WHEN p = 1 THEN 1 ELSE 2 END
     FROM generate_series(1, 20) AS p`,
  );
  await step('flash price sanity', `UPDATE variations SET "retailPrice" = 99000, stock = 100000 WHERE id LIKE 'perf_v_%\\_1' AND id IN (SELECT 'perf_v_' || p || '_1' FROM generate_series(1, 20) p)`);

  // ── Thống kê cho planner ─────────────────────────────────────────────────────────────────────
  for (const t of [
    'brands', 'products', 'variations', 'users', 'addresses', 'carts', 'cart_items', 'orders', 'order_items', 'order_status_history',
    'notification_logs', 'analytics_events', 'refresh_tokens', 'coupons', 'coupon_redemptions', 'reviews', 'feed_posts', 'feed_reactions',
    'feed_comments', 'points_transactions', 'wishlists', 'subscriptions', 'flash_sales', 'flash_sale_items',
  ]) {
    await prisma.$executeRawUnsafe(`ANALYZE ${t}`);
  }
  console.log(`[seed-large] ANALYZE xong. Tổng ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const rows = await prisma.$queryRawUnsafe<{ relname: string; n: bigint }[]>(
    `SELECT relname, reltuples::bigint AS n FROM pg_class WHERE relname IN
     ('users','products','variations','orders','order_items','notification_logs','analytics_events','refresh_tokens','coupons','points_transactions','reviews','feed_posts','wishlists') ORDER BY n DESC`,
  );
  for (const r of rows) console.log(`  ${r.relname.padEnd(22)} ${String(r.n)}`);
}

main()
  .catch((e) => {
    console.error('[seed-large] LỖI', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
