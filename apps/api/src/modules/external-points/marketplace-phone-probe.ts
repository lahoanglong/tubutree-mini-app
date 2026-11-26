import { maskClaimCode } from './external-points-rate';
import { buyerPhonePattern, classifyPancakeOrder, extractTrackingCodes } from './external-order.mapper';
import type { OrderSourceMap } from './external-order.config';

/**
 * Lõi của `scripts/pancake-marketplace-probe.ts` (W42, chỉ GET): xem đơn sàn thật trên Pancake trả SĐT người mua ở dạng nào và tra lại
 * được bằng mã vận đơn không, trước khi bật `loyalty.marketplace_claim_enabled`. Không bao giờ in chữ số SĐT, tên, địa chỉ hay khoá API:
 * chỉ dạng SĐT, số chữ số nhìn thấy và mã vận đơn đã che.
 */
export type PhoneShape = 'FULL' | 'MASK_LEAD_TAIL' | 'MASK_TAIL_ONLY' | 'NONE';

export const PROBE_SAMPLES_PER_CHANNEL = 5;
/** Kênh sẵn sàng khi ít nhất 80% đơn mẫu tra lại được đúng đơn bằng mã vận đơn đầu tiên. */
export const LOOKUP_READY_MIN_RATE = 0.8;

type Data = Record<string, unknown>;

export function phoneShapeOf(data: Data): PhoneShape {
  const p = buyerPhonePattern(data);
  if (p.kind === 'FULL') return 'FULL';
  if (p.kind === 'NONE') return 'NONE';
  return p.lead ? 'MASK_LEAD_TAIL' : 'MASK_TAIL_ONLY';
}

/** Đơn sàn của đúng kênh `channel` theo `pancake.order_source_map`, tối đa PROBE_SAMPLES_PER_CHANNEL đơn. */
export function pickChannelSamples(orders: readonly Data[], channel: string, map: OrderSourceMap): Data[] {
  return orders
    .filter((o) => {
      const c = classifyPancakeOrder(o, map);
      return c.kind === 'MARKETPLACE' && c.channel === channel;
    })
    .slice(0, PROBE_SAMPLES_PER_CHANNEL);
}

export interface ProbeSample {
  orderId: string;
  shape: PhoneShape;
  visibleDigits: number;
  maskedCode: string | null;
  /** null: không có mã để tra; true: searchOrders(mã) trả đúng đơn này. */
  searchHit: boolean | null;
}

export function sampleOf(data: Data, searchHit: boolean | null): ProbeSample {
  const p = buyerPhonePattern(data);
  const visible = p.kind === 'FULL' ? 10 : p.kind === 'NONE' ? 0 : p.positional ? p.positional.replace(/\*/g, '').length : p.lead.length + p.tail.length;
  const code = extractTrackingCodes(data)[0] ?? null;
  return { orderId: String(data['id'] ?? ''), shape: phoneShapeOf(data), visibleDigits: visible, maskedCode: code ? maskClaimCode(code) : null, searchHit };
}

export interface ChannelSummary {
  channel: string;
  samples: number;
  shapes: Record<PhoneShape, number>;
  trackingRate: number;
  searchHitRate: number;
  phoneNoneRate: number;
  lookupReady: boolean;
}

const rate = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 100) / 100 : 0);

export function summarizeChannel(channel: string, samples: readonly ProbeSample[]): ChannelSummary {
  const shapes: Record<PhoneShape, number> = { FULL: 0, MASK_LEAD_TAIL: 0, MASK_TAIL_ONLY: 0, NONE: 0 };
  for (const s of samples) shapes[s.shape]++;
  const withCode = samples.filter((s) => s.maskedCode !== null).length;
  const hits = samples.filter((s) => s.searchHit === true).length;
  const searchHitRate = rate(hits, samples.length);
  return {
    channel,
    samples: samples.length,
    shapes,
    trackingRate: rate(withCode, samples.length),
    searchHitRate,
    phoneNoneRate: rate(shapes.NONE, samples.length),
    lookupReady: samples.length > 0 && searchHitRate >= LOOKUP_READY_MIN_RATE,
  };
}

/** 0: mọi kênh có mẫu đều LOOKUP_READY; 1: có kênh chưa sẵn sàng; 2: không kênh nào có mẫu (không kết luận được). */
export function marketplaceProbeExitCode(summaries: readonly ChannelSummary[]): 0 | 1 | 2 {
  const sampled = summaries.filter((s) => s.samples > 0);
  if (sampled.length === 0) return 2;
  return sampled.every((s) => s.lookupReady) ? 0 : 1;
}

export function formatMarketplaceProbeReport(rows: readonly { summary: ChannelSummary; samples: readonly ProbeSample[] }[]): string {
  const out: string[] = ['Dò đơn sàn Pancake (chỉ GET, đã che): dạng SĐT người mua và tra lại bằng mã vận đơn'];
  for (const { summary: s, samples } of rows) {
    out.push(
      `- ${s.channel}: ${s.samples} đơn mẫu | FULL ${s.shapes.FULL} · MASK lead+tail ${s.shapes.MASK_LEAD_TAIL} · MASK tail-only ${s.shapes.MASK_TAIL_ONLY} · NONE ${s.shapes.NONE}` +
        ` | có mã vận đơn ${s.trackingRate} | tra lại đúng đơn ${s.searchHitRate} | PHONE_NONE_RATE ${s.phoneNoneRate} | LOOKUP_READY ${s.lookupReady ? 'có' : 'không'}`,
    );
    for (const x of samples) {
      out.push(`    · ${x.maskedCode ?? '(không có mã)'} SĐT ${x.shape} (${x.visibleDigits} số nhìn thấy) tra lại: ${x.searchHit === null ? 'không có mã' : x.searchHit ? 'đúng đơn' : 'không thấy'}`);
    }
  }
  return out.join('\n');
}
