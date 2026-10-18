import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OrderSourceMap } from './external-order.config';
import type { ExternalOrderKind } from './external-order.mapper';
import {
  buyerPhone,
  classifyPancakeOrder,
  deliveredAt,
  externalStatusOf,
  extractTrackingCodes,
  goodsValue,
  marketplaceOrderSn,
  pancakeTime,
  payloadForStorage,
  sourceKeyOf,
} from './external-order.mapper';

/**
 * NOT_EXTERNAL: đơn app hoặc payload không có id — để processor xử lý như cũ.
 * STORED: đã ghi (mới hoặc cập nhật). STALE: Pancake gửi bản cũ hơn bản đã lưu nên bỏ qua.
 */
export type IngestResult = 'NOT_EXTERNAL' | 'STORED' | 'STALE';

/** `kind` là loại đã phân (null khi NOT_EXTERNAL): processor giữ UNMATCHED cho UNKNOWN để cron còn ghép lại với đơn Tubu. */
export interface IngestOutcome {
  result: IngestResult;
  kind: ExternalOrderKind | null;
}

type Db = Pick<PrismaService, 'externalOrder'>;

const CLOSED = ['RETURNED', 'CANCELLED', 'DELETED'];

/**
 * Ghi đơn Pancake không thuộc app vào `external_orders` (khoá `pancakeOrderId`). Hai webhook song song của cùng một đơn:
 * createMany bỏ qua dòng trùng, rồi UPDATE có điều kiện `updated_at` không cũ hơn — Postgres khoá dòng và đọc lại điều kiện
 * sau khi chờ nên bản mới nhất thắng, không bao giờ tạo hai dòng. So `updated_at` của Pancake với của Pancake (R5-SYNC-3).
 */
export async function ingestExternalOrder(
  prisma: Db,
  data: Record<string, unknown>,
  map: OrderSourceMap,
  now: Date = new Date(),
): Promise<IngestOutcome> {
  const rawId = data['id'] ?? data['order_id'];
  if (rawId === null || rawId === undefined || rawId === '') return { result: 'NOT_EXTERNAL', kind: null };
  const pancakeOrderId = String(rawId);

  const klass = classifyPancakeOrder(data, map);
  if (klass.kind === 'APP') return { result: 'NOT_EXTERNAL', kind: null };

  const { pancakeStatus, status } = externalStatusOf(data);
  const codes = extractTrackingCodes(data);
  const phone = buyerPhone(data);
  const payloadDeliveredAt = deliveredAt(data);
  const closed = CLOSED.includes(status);
  const updatedAt = pancakeTime(data['updated_at']);
  const insertedAt = pancakeTime(data['inserted_at']);
  const sn = marketplaceOrderSn(data);

  const sourceKey = sourceKeyOf(data);
  const goods = goodsValue(data);
  const stored = payloadForStorage(data) as Prisma.InputJsonValue;
  const hasItems = Array.isArray(data['items']) && data['items'].length > 0;
  // Webhook một phần (vd {id, status, updated_at}) không mang nguồn nên phân thành UNKNOWN: không được đè loại, khoá nguồn,
  // tiền hàng hay payload đã biết bằng thứ rỗng.
  const carriesSource = klass.kind !== 'UNKNOWN' || data['marketplace_id'] != null || data['order_sources'] != null;

  const created = await prisma.externalOrder.createMany({
    data: [
      {
        source: klass.kind,
        channel: klass.channel,
        sourceKey,
        goodsValue: goods,
        lastPayload: stored,
        pancakeOrderId,
        trackingCode: codes[0] ?? null,
        trackingCodes: codes,
        marketplaceOrderSn: sn,
        phone,
        phoneLast3: phone ? phone.slice(-3) : null,
        pancakeStatus,
        status,
        pancakeInsertedAt: insertedAt,
        pancakeUpdatedAt: updatedAt,
        deliveredAt: payloadDeliveredAt ?? (status === 'DELIVERED' ? now : null),
        closedAt: closed ? now : null,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count > 0) return { result: 'STORED', kind: klass.kind };

  // Payload thiếu field (webhook một phần) không được xoá thứ đã biết: chỉ ghi đè khi có giá trị mới.
  const updated = await prisma.externalOrder.updateMany({
    where: {
      pancakeOrderId,
      // Sự kiện không có updated_at không có gì để so: chỉ được áp lên dòng cũng chưa có mốc, không đè bản đã có mốc.
      ...(updatedAt ? { OR: [{ pancakeUpdatedAt: null }, { pancakeUpdatedAt: { lte: updatedAt } }] } : { pancakeUpdatedAt: null }),
    },
    data: {
      ...(carriesSource ? { source: klass.kind, channel: klass.channel, sourceKey } : {}),
      ...(goods !== null ? { goodsValue: goods } : {}),
      ...(hasItems ? { lastPayload: stored } : {}),
      ...(codes.length > 0 ? { trackingCode: codes[0]!, trackingCodes: codes } : {}),
      ...(sn ? { marketplaceOrderSn: sn } : {}),
      ...(phone ? { phone, phoneLast3: phone.slice(-3) } : {}),
      ...(pancakeStatus !== null ? { pancakeStatus, status } : {}),
      ...(insertedAt ? { pancakeInsertedAt: insertedAt } : {}),
      ...(updatedAt ? { pancakeUpdatedAt: updatedAt } : {}),
      ...(payloadDeliveredAt ? { deliveredAt: payloadDeliveredAt } : {}),
      ...(pancakeStatus !== null && !closed ? { closedAt: null } : {}),
    },
  });
  if (updated.count === 0) return { result: 'STALE', kind: klass.kind };

  // Mốc "lần đầu thấy" chỉ đặt một lần: điều kiện IS NULL giữ đúng mốc đầu khi hai webhook chạy song song.
  if (status === 'DELIVERED' && !payloadDeliveredAt) {
    await prisma.externalOrder.updateMany({ where: { pancakeOrderId, deliveredAt: null }, data: { deliveredAt: now } });
  }
  if (closed) await prisma.externalOrder.updateMany({ where: { pancakeOrderId, closedAt: null }, data: { closedAt: now } });
  return { result: 'STORED', kind: klass.kind };
}
