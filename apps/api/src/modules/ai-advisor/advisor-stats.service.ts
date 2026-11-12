import { Injectable } from '@nestjs/common';
import type { AdvisorStatsDto } from '@tubutree/shared-types';

export type AdvisorOutcome = 'ok' | 'fallback';

export interface AdvisorStatsEvent {
  outcome: AdvisorOutcome;
  /** Thời gian cả lượt `chat` (mili giây). */
  ms: number;
  /** Sản phẩm đã gợi ý cho khách ở lượt này. */
  products: readonly { slug: string; name: string }[];
}

const LATENCY_SAMPLES = 500;
const MAX_SKU_KEYS = 500;
const TOP_SKUS = 5;
const P95 = 0.95;

/**
 * Thống kê AI tư vấn cho admin, không migration và không bảng mới: bộ đếm nằm trong bộ nhớ của MỘT instance API (compose Vietnix chạy một
 * instance), khởi động lại là về 0; chạy nhiều instance thì mỗi instance báo số riêng. Không có dữ liệu bấm vào gợi ý nên chỉ đo "số lần gợi ý".
 * Không lưu câu hỏi hay câu trả lời của khách, chỉ số đếm, thời gian và slug+tên sản phẩm.
 * Bộ nhớ bị chặn cứng: vòng đệm 500 mẫu độ trễ và tối đa 500 khoá sản phẩm, nên không phình theo lưu lượng.
 */
@Injectable()
export class AdvisorStatsService {
  private readonly since = Date.now();
  private ok = 0;
  private fallback = 0;
  private readonly latencies: number[] = [];
  private nextSlot = 0;
  private readonly skus = new Map<string, { name: string; count: number }>();

  record(event: AdvisorStatsEvent): void {
    if (event.outcome === 'ok') this.ok += 1;
    else this.fallback += 1;

    if (Number.isFinite(event.ms) && event.ms >= 0) {
      if (this.latencies.length < LATENCY_SAMPLES) this.latencies.push(event.ms);
      else this.latencies[this.nextSlot] = event.ms;
      this.nextSlot = (this.nextSlot + 1) % LATENCY_SAMPLES;
    }

    // Một lượt chỉ tính một lần cho mỗi sản phẩm dù danh sách gợi ý lặp.
    for (const [slug, name] of new Map(event.products.map((p) => [p.slug, p.name] as const))) {
      const hit = this.skus.get(slug);
      if (hit) {
        hit.count += 1;
        hit.name = name;
        continue;
      }
      if (this.skus.size >= MAX_SKU_KEYS) this.evictLeastCounted();
      this.skus.set(slug, { name, count: 1 });
    }
  }

  snapshot(): AdvisorStatsDto {
    return {
      since: new Date(this.since).toISOString(),
      total: this.ok + this.fallback,
      ok: this.ok,
      fallback: this.fallback,
      latencyP95Ms: this.p95(),
      latencySamples: this.latencies.length,
      topSkus: [...this.skus.entries()]
        .map(([slug, v]) => ({ slug, name: v.name, count: v.count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'vi') || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
        .slice(0, TOP_SKUS),
    };
  }

  /** Nearest-rank: phần tử thứ ceil(0.95·n) của dãy tăng dần. */
  private p95(): number | null {
    const n = this.latencies.length;
    if (n === 0) return null;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return sorted[Math.ceil(P95 * n) - 1]!;
  }

  /** Hoà số đếm thì bỏ khoá vào Map sớm nhất (thứ tự chèn của Map). */
  private evictLeastCounted(): void {
    let victim: string | undefined;
    let lowest = Infinity;
    for (const [slug, v] of this.skus) {
      if (v.count < lowest) {
        lowest = v.count;
        victim = slug;
      }
    }
    if (victim !== undefined) this.skus.delete(victim);
  }
}
