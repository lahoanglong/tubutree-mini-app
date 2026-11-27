import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { RECIPIENT_PAYLOAD_KEY } from './claim-trust-signals';
import type { OrderSourceMap } from './external-order.config';
import type { ExternalOrderKind } from './external-order.mapper';
import {
  buyerPhone,
  buyerPhonePattern,
  classifyPancakeOrder,
  deliveredAt,
  externalStatusOf,
  extractTrackingCodes,
  goodsValue,
  marketplaceOrderIdCode,
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
  // Mã lấy từ `id` chỉ là mã đơn sàn khi đơn được xếp MARKETPLACE; đơn loại khác (vd marketplace_id chưa có trong bản đồ, nguồn chat) không
  // được tính `id` nội bộ là vận đơn (luật requireCarrier của đơn chat) hay mã đơn sàn.
  const internalId = klass.kind === 'MARKETPLACE' ? null : marketplaceOrderIdCode(data);
  const codes = extractTrackingCodes(data).filter((c) => c !== internalId);
  const phone = buyerPhone(data);
  // Mẫu che (W42) chỉ lưu khi không có số đầy đủ; 3 số cuối cho admin lấy từ đuôi che khi đuôi đủ 3 số. FULL ở đây chỉ đến từ hồ sơ khách
  // (buyerPhone đã null): lưu ở phoneMask để đối chiếu, không ở `phone`, vì `phone` là số của chính đơn mà đường ghép đơn chat dùng.
  const pattern = phone ? null : buyerPhonePattern(data);
  const phoneMask = pattern?.kind === 'MASK' ? pattern.mask : pattern?.kind === 'FULL' ? pattern.phone : null;
  const phoneLast3 = phone
    ? phone.slice(-3)
    : pattern?.kind === 'FULL'
      ? pattern.phone.slice(-3)
      : pattern?.kind === 'MASK' && pattern.tail.length >= 3
        ? pattern.tail.slice(-3)
        : null;
  const payloadDeliveredAt = deliveredAt(data);
  const closed = CLOSED.includes(status);
  const updatedAt = pancakeTime(data['updated_at']);
  const insertedAt = pancakeTime(data['inserted_at']);
  const orderSn = marketplaceOrderSn(data);
  const sn = orderSn === internalId ? null : orderSn;

  const sourceKey = sourceKeyOf(data);
  const goods = goodsValue(data);
  const storedData = payloadForStorage(data);
  const stored = storedData as Prisma.InputJsonValue;
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
        phoneMask,
        phoneLast3,
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

  // Payload có giỏ hàng nhưng thiếu tên người nhận không được xoá dấu vân tay tên đã lưu: lượt duyệt nhanh đơn Lazada đọc nó để chặn tên lệch.
  if (hasItems && storedData[RECIPIENT_PAYLOAD_KEY] === undefined) {
    const prev = await prisma.externalOrder.findUnique({ where: { pancakeOrderId }, select: { lastPayload: true } });
    const keep = prev?.lastPayload && typeof prev.lastPayload === 'object' && !Array.isArray(prev.lastPayload) ? prev.lastPayload[RECIPIENT_PAYLOAD_KEY] : undefined;
    if (keep !== undefined && keep !== null) storedData[RECIPIENT_PAYLOAD_KEY] = keep;
  }

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
      ...(phone ? { phone, phoneMask: null, phoneLast3 } : phoneMask ? { phoneMask, ...(phoneLast3 ? { phoneLast3 } : {}) } : {}),
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
