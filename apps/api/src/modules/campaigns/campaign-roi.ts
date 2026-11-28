import type { PrismaClient } from '@prisma/client';
import { GMV_ORDER_SQL } from '../admin/admin-revenue';
import { toCount } from '../admin/coupon-roi';

/** Khách mở trang `/chien-dich/<slug>` (web) hoặc `/campaign/<slug>` (Mini App); `props.campaignId` là id chiến dịch, không mang thông tin khách. */
export const CAMPAIGN_LANDING_VIEW_EVENT = 'campaign_landing_view';
/** Khách chạm một banner chiến dịch ở Trang chủ hoặc Ưu đãi (bất kể banner dẫn tới đâu); `props.campaignId` như trên. */
export const CAMPAIGN_BANNER_CLICK_EVENT = 'campaign_banner_click';

/**
 * Hiệu quả một chiến dịch trong khung ngày của chính nó (`startAt` đến trước `endAt`).
 * `views`/`clicks` là số sự kiện (không phải số khách khác nhau). `ordersCount`/`gmv` là các đơn đang chạy hoặc đã giao (cùng định nghĩa GMV với
 * báo cáo admin) đã dùng một MÃ GẮN VÀO chiến dịch: đơn không có liên kết trực tiếp tới chiến dịch nên mã là dấu vết duy nhất, chiến dịch không gắn mã luôn 0 đơn.
 * Một mã gắn vào hai chiến dịch chạy chồng thời gian thì đơn tính cho cả hai. Giỏ tách nhiều đơn giao chỉ ghi lượt dùng mã ở đơn đầu: các đơn con cùng
 * `checkoutGroup` tính chung với đơn đó (mỗi đơn xét trạng thái và ngày tạo của chính nó).
 */
export interface CampaignRoi {
  views: number;
  clicks: number;
  ordersCount: number;
  gmv: number;
}

export const ZERO_CAMPAIGN_ROI: Readonly<CampaignRoi> = { views: 0, clicks: 0, ordersCount: 0, gmv: 0 };

export interface CampaignWindow {
  id: string;
  startAt: Date;
  endAt: Date;
}

type Num = number | bigint | string | null | undefined;

/**
 * Hiệu quả của một lô chiến dịch bằng hai truy vấn gom (sự kiện, đơn), không truy vấn từng chiến dịch. Chiến dịch không có dòng nào không nằm
 * trong kết quả: nơi dùng đọc `?? ZERO_CAMPAIGN_ROI`. Mốc giờ lọc theo giờ máy chủ nhận sự kiện (`receivedAt`), như `referralShareStats`: `occurredAt` do
 * máy khách gửi, đồng hồ máy lệch hay hàng đợi Mini gửi muộn thì sự kiện rơi ra ngoài khung.
 */
export async function campaignRoiBatch(db: Pick<PrismaClient, '$queryRaw'>, campaigns: readonly CampaignWindow[]): Promise<Map<string, CampaignRoi>> {
  const out = new Map<string, CampaignRoi>();
  if (campaigns.length === 0) return out;
  const ids = campaigns.map((c) => c.id);
  const starts = campaigns.map((c) => c.startAt.toISOString());
  const ends = campaigns.map((c) => c.endAt.toISOString());
  const earliest = starts.reduce((a, b) => (a < b ? a : b));
  const [events, orders] = await Promise.all([
    db.$queryRaw<Array<{ id: string; views: Num; clicks: Num }>>`
      SELECT w.id AS id,
             count(*) FILTER (WHERE e."eventName" = ${CAMPAIGN_LANDING_VIEW_EVENT}) AS views,
             count(*) FILTER (WHERE e."eventName" = ${CAMPAIGN_BANNER_CLICK_EVENT}) AS clicks
        FROM unnest(${ids}::text[], ${starts}::text[], ${ends}::text[]) AS w(id, starts_at, ends_at)
        JOIN analytics_events e ON e.props->>'campaignId' = w.id
       WHERE e."eventName" IN (${CAMPAIGN_LANDING_VIEW_EVENT}, ${CAMPAIGN_BANNER_CLICK_EVENT})
         AND e."receivedAt" >= ${earliest}::timestamp
         AND e."receivedAt" >= w.starts_at::timestamp
         AND e."receivedAt" < w.ends_at::timestamp
       GROUP BY w.id`,
    db.$queryRaw<Array<{ id: string; orders: Num; gmv: Num }>>`
      SELECT x.id AS id, count(*) AS orders, COALESCE(SUM(x.total), 0) AS gmv
        FROM (
          SELECT DISTINCT w.id AS id, o.id AS order_id, o.total AS total
            FROM unnest(${ids}::text[], ${starts}::text[], ${ends}::text[]) AS w(id, starts_at, ends_at)
            JOIN campaign_coupons cc ON cc."campaignId" = w.id
            JOIN coupon_redemptions r ON r."couponId" = cc."couponId"
            JOIN orders p ON p.id = r."orderId"
            JOIN orders o ON o.id = p.id OR o."checkoutGroup" = p."checkoutGroup"
           WHERE o."createdAt" >= w.starts_at::timestamp
             AND o."createdAt" < w.ends_at::timestamp
             AND ${GMV_ORDER_SQL}
        ) x
       GROUP BY x.id`,
  ]);
  for (const row of events) out.set(row.id, { ...ZERO_CAMPAIGN_ROI, views: toCount(row.views), clicks: toCount(row.clicks) });
  for (const row of orders) {
    out.set(row.id, { ...(out.get(row.id) ?? ZERO_CAMPAIGN_ROI), ordersCount: toCount(row.orders), gmv: toCount(row.gmv) });
  }
  return out;
}
