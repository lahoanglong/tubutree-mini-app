import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminReportsService } from '../../src/modules/admin/admin-reports.service';
import { GMV_ORDER_SQL, REVENUE_ORDER_SQL } from '../../src/modules/admin/admin-revenue';
import { NEW_CUSTOMER_SQL } from '../../src/modules/admin/admin-source-report';
import { resolveReportRange } from '../../src/modules/admin/report-range';
import { randCode, warmPool } from './helpers';

/**
 * D9-01: Prisma giữ câu đã prepare; sau 5 lần thực thi Postgres chuyển sang kế hoạch generic (không biết khoảng ngày).
 * Câu cũ (CTE tự join) khi đó rơi vào Nested Loop bình phương theo số khách mới. Ca này gọi báo cáo nhiều lần trên cùng
 * một kết nối và đòi thời gian các lần sau không vọt so với 5 lần đầu, đồng thời đối chiếu số liệu với câu cũ.
 */
const USERS = 6000;
const FROM = '2018-03-01';
const TO = '2018-03-28';
const NOW = new Date('2018-04-02T00:00:00Z');

/** Bản nguyên văn của câu trước D9-01, giữ làm chuẩn đối chiếu số liệu. */
function legacySourceSql(range: { start: Date; end: Date }) {
  const window = Prisma.raw(`interval '30 days'`);
  const window2 = Prisma.raw(`interval '60 days'`);
  return Prisma.sql`
      WITH cohort AS (
        SELECT u.id,
               u."createdAt" AS created_at,
               COALESCE(u."firstTouchSource", ${'unknown'}) AS source,
               to_char(date_trunc('week', u."createdAt" + interval '7 hours'), 'YYYY-MM-DD') AS week
        FROM users u
        WHERE u."createdAt" >= ${range.start} AND u."createdAt" < ${range.end}
          AND ${NEW_CUSTOMER_SQL}
      ),
      purchase AS (
        SELECT c.id AS user_id,
               COALESCE(o."checkoutGroup", o.code) AS purchase_key,
               MIN(o."createdAt") AS at
        FROM cohort c
        JOIN orders o ON o."userId" = c.id
        WHERE ${GMV_ORDER_SQL}
          AND o."createdAt" >= c.created_at AND o."createdAt" < c.created_at + ${window2}
        GROUP BY c.id, COALESCE(o."checkoutGroup", o.code)
      ),
      valid AS (
        SELECT p.user_id, p.at, ROW_NUMBER() OVER (PARTITION BY p.user_id ORDER BY p.at, p.purchase_key) AS n
        FROM purchase p
      ),
      first_order AS (
        SELECT v.user_id, v.at FROM valid v JOIN cohort c ON c.id = v.user_id WHERE v.n = 1 AND v.at < c.created_at + ${window}
      ),
      second_order AS (
        SELECT v.user_id FROM valid v JOIN first_order f ON f.user_id = v.user_id WHERE v.n = 2 AND v.at <= f.at + ${window}
      ),
      revenue AS (
        SELECT c.id AS user_id, SUM(o.total - COALESCE(pr.refund, 0)) AS amount
        FROM cohort c
        JOIN orders o ON o."userId" = c.id
        LEFT JOIN LATERAL (
          SELECT SUM(r."refundAmount" + r."shippingRefund") AS refund
          FROM return_requests r
          WHERE r."orderId" = o.id AND r.status = 'APPROVED'
        ) pr ON true
        WHERE ${REVENUE_ORDER_SQL}
          AND o."createdAt" >= c.created_at AND o."createdAt" < c.created_at + ${window}
        GROUP BY c.id
      )
      SELECT c.week, c.source,
             COUNT(*)::int AS new_users,
             COUNT(f.user_id)::int AS first_order_users,
             COUNT(s.user_id)::int AS second_order_users,
             COALESCE(SUM(r.amount), 0)::bigint AS revenue
      FROM cohort c
      LEFT JOIN first_order f ON f.user_id = c.id
      LEFT JOIN second_order s ON s.user_id = c.id
      LEFT JOIN revenue r ON r.user_id = c.id
      GROUP BY c.week, c.source`;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe('Báo cáo nguồn khách mới: kế hoạch không phụ thuộc tham số (D9-01, real Postgres)', () => {
  let prisma: PrismaService;
  const tag = `pl${randCode(6).toLowerCase()}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id,"zaloId","fullName",role,"referralCode","updatedAt","createdAt","firstTouchSource","firstTouchAt")
       SELECT '${tag}-u-'||g,'${tag}-z-'||g,'Khách '||g,'CUSTOMER'::"UserRole",'${tag.toUpperCase()}'||lpad(g::text,6,'0'),now(),
              timestamptz '2018-03-04 03:00:00+00' + ((g % 22) || ' days')::interval + ((g % 24) || ' hours')::interval,
              (ARRAY['shopee','card-A','oa','organic','tiktok'])[1+g%5],
              timestamptz '2018-03-04 03:00:00+00' + ((g % 22) || ' days')::interval + ((g % 24) || ' hours')::interval
       FROM generate_series(1,${USERS}) g`,
    );
    // g%7=0: đơn đầu sau 45 ngày (ngoài kỳ đơn đầu); g%9=0: đơn từ lần thứ hai cách xa hơn 30 ngày (ngoài kỳ đơn hai);
    // k%4=0 chung checkoutGroup (một lần mua); (g+k)%11=0 bỏ đơn; trạng thái xoay vòng gồm huỷ và chờ thanh toán.
    await prisma.$executeRawUnsafe(
      `INSERT INTO orders (id,code,"userId",type,status,subtotal,total,"paymentMethod","paymentStatus","shippingAddress","updatedAt","createdAt","recipientSearch",platform,"checkoutGroup")
       SELECT '${tag}-o-'||u.g||'-'||k,'${tag.toUpperCase()}'||u.g||'K'||k,'${tag}-u-'||u.g,'RETAIL'::"OrderType",
              (ARRAY['DELIVERED','CONFIRMED','SHIPPING','PENDING_PAYMENT','DELIVERED','CANCELLED','DELIVERED','PACKED'])[1+(u.g+k)%8]::"OrderStatus",
              100000+k*1000,100000+k*1000,'COD'::"PaymentMethod",'UNPAID'::"PaymentStatus",
              '{"recipient":"B","phone":"0700000001","province":"HCM","district":"","ward":"P","street":"1","provinceCode":"84_VN79","districtCode":"","wardCode":"x"}'::jsonb,
              now(),
              timestamptz '2018-03-04 03:00:00+00' + ((u.g % 22) || ' days')::interval + ((u.g % 24) || ' hours')::interval
                + ((k*k*20 + (u.g%5) + CASE WHEN u.g%7=0 THEN 45*24 ELSE 0 END + CASE WHEN u.g%9=0 AND k>=2 THEN 35*24 ELSE 0 END) || ' hours')::interval,
              'x','miniapp', CASE WHEN k%4=0 THEN '${tag}-G'||u.g ELSE NULL END
       FROM generate_series(1,${USERS}) u(g) CROSS JOIN generate_series(1,5) k WHERE (u.g+k)%11 <> 0`,
    );
    await prisma.$executeRawUnsafe('ANALYZE users');
    await prisma.$executeRawUnsafe('ANALYZE orders');
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRawUnsafe(`DELETE FROM orders WHERE id LIKE '${tag}-o-%'`);
      await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE '${tag}-u-%'`);
    }
    await prisma?.$disconnect();
  });

  it('số liệu từng ô tuần × nguồn khớp câu cũ trên 6.000 khách trộn đủ ca biên', async () => {
    const range = resolveReportRange(FROM, TO, { maxDays: 180, now: NOW });
    const legacy = await prisma.$queryRaw<
      { week: string; source: string; new_users: number; first_order_users: number; second_order_users: number; revenue: bigint }[]
    >(legacySourceSql(range));
    const fresh = await new AdminReportsService(prisma).sourceReport({ from: FROM, to: TO }, NOW);

    const want = legacy
      .map((r) => `${r.week}|${r.source}|${r.new_users}|${r.first_order_users}|${r.second_order_users}|${Number(r.revenue)}`)
      .sort();
    const got = fresh.rows
      .map((r) => `${r.week}|${r.source}|${r.newUsers}|${r.firstOrderUsers}|${r.secondOrderUsers}|${r.revenue}`)
      .sort();
    expect(got).toEqual(want);
    expect(fresh.totals.newUsers).toBeGreaterThanOrEqual(USERS - 1);
    // Dữ liệu có đủ ba trạng thái: có khách chưa mua, có khách mua một lần, có khách mua lại
    expect(fresh.totals.firstOrderUsers).toBeLessThan(fresh.totals.newUsers);
    expect(fresh.totals.secondOrderUsers).toBeGreaterThan(0);
    expect(fresh.totals.secondOrderUsers).toBeLessThan(fresh.totals.firstOrderUsers);
  });

  it('gọi 10 lần liên tiếp trên một kết nối: các lần sau kế hoạch generic không chậm hơn 3 lần các lần đầu', async () => {
    const svc = new AdminReportsService(prisma);
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = Date.now();
      await svc.sourceReport({ from: FROM, to: TO }, NOW);
      times.push(Date.now() - t);
    }
    const early = median(times.slice(0, 5));
    const late = median(times.slice(6));
    // Cộng 80 ms để nhiễu của máy dùng chung không làm ca đỏ giả khi cả hai đều chỉ vài chục ms.
    console.log(`sourceReport ms/lần: ${times.join(' ')}`);
    expect(late).toBeLessThanOrEqual(3 * early + 80);
  }, 120_000);
});
