import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VITAL_THRESHOLDS, vitalRating, type VitalName, type VitalRating } from '@tubutree/shared-types';
import { PrismaService } from '../../../prisma/prisma.service';

/** Dưới ngần này mẫu thì p75 chưa đáng tin: thẻ admin ghi "chưa đủ mẫu" thay vì tô màu. */
export const VITALS_MIN_SAMPLES = 50;
/**
 * Số mẫu route tối đa mỗi nền tảng trong bảng (route nhiều mẫu nhất). Route do máy khách gửi lên: không trần thì một người gửi hàng nghìn route giả
 * (hay trang 404 tự nhiên) làm truy vấn và thẻ admin phình không giới hạn. Dòng `*` vẫn gộp MỌI route.
 */
export const VITALS_MAX_ROUTES = 30;
export const VITALS_WINDOWS = [7, 28] as const;
export type VitalsWindow = (typeof VITALS_WINDOWS)[number];

export interface VitalsRow {
  platform: 'web' | 'miniapp';
  name: VitalName;
  /** Mẫu route; `*` là gộp mọi route của nhóm khung nhìn đó. */
  route: string;
  viewport: string;
  samples: number;
  p75: number;
  good: number;
  needsImprovement: number;
  poor: number;
  rating: VitalRating;
  enoughSamples: boolean;
}

export interface VitalsSummary {
  days: VitalsWindow;
  since: string;
  minSamples: number;
  rows: VitalsRow[];
}

interface RawRow {
  platform: string;
  name: string;
  route: string | null;
  vp: string;
  samples: number;
  p75: number;
  good: number;
  poor: number;
}

export const parseVitalsWindow = (raw: unknown): VitalsWindow => (String(raw) === '28' ? 28 : 7);

const roundValue = (name: VitalName, v: number) => (name === 'CLS' ? Math.round(v * 1000) / 1000 : Math.round(v));

/**
 * p75 của từng số đo theo nền tảng, mẫu route (`VITALS_MAX_ROUTES` route nhiều mẫu nhất mỗi nền tảng) và nhóm khung nhìn (thêm một dòng `*` gộp
 * mọi route), kèm số mẫu tốt / cần cải thiện / kém theo
 * ngưỡng Core Web Vitals. Mốc thời gian là `receivedAt` (giờ máy chủ): `occurredAt` do máy khách tự khai.
 */
@Injectable()
export class VitalsSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(days: VitalsWindow, now: Date = new Date()): Promise<VitalsSummary> {
    const since = new Date(now.getTime() - days * 86_400_000);
    const thresholds = Prisma.join(
      Object.entries(VITAL_THRESHOLDS).map(([name, [good, poor]]) => Prisma.sql`(${name}::text, ${good}::float8, ${poor}::float8)`),
    );
    const raw = await this.prisma.$queryRaw<RawRow[]>`
      WITH v AS (
        SELECT e.platform, e.props->>'name' AS name, e.props->>'route' AS route, e.props->>'vp' AS vp, (e.props->>'value')::float8 AS value
        FROM analytics_events e
        WHERE e."eventName" IN ('web_vital', 'mini_vital') AND e."receivedAt" >= ${since} AND e."receivedAt" <= ${now}
          AND jsonb_typeof(e.props->'value') = 'number'
      ),
      top AS (
        SELECT platform, route FROM (
          SELECT platform, route, row_number() OVER (PARTITION BY platform ORDER BY count(*) DESC, route) AS rank
          FROM v WHERE route IS NOT NULL GROUP BY platform, route
        ) ranked
        WHERE rank <= ${VITALS_MAX_ROUTES}
      ),
      a AS (
        SELECT v.platform, v.name, NULL::text AS route, v.vp, v.value FROM v
        UNION ALL
        SELECT v.platform, v.name, v.route, v.vp, v.value FROM v JOIN top ON top.platform = v.platform AND top.route = v.route
      )
      SELECT a.platform, a.name, a.route, a.vp,
        count(*)::int AS samples,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY a.value) AS p75,
        (count(*) FILTER (WHERE a.value <= t.good))::int AS good,
        (count(*) FILTER (WHERE a.value > t.poor))::int AS poor
      FROM a JOIN (VALUES ${thresholds}) AS t(name, good, poor) ON t.name = a.name
      GROUP BY a.platform, a.name, a.vp, a.route
      ORDER BY a.platform, a.route NULLS FIRST, a.vp, a.name`;
    const rows = raw.map((r): VitalsRow => {
      const name = r.name as VitalName;
      const p75 = roundValue(name, Number(r.p75));
      const samples = Number(r.samples);
      const good = Number(r.good);
      const poor = Number(r.poor);
      return {
        platform: r.platform === 'miniapp' ? 'miniapp' : 'web',
        name,
        route: r.route ?? '*',
        viewport: r.vp,
        samples,
        p75,
        good,
        needsImprovement: samples - good - poor,
        poor,
        rating: vitalRating(name, p75),
        enoughSamples: samples >= VITALS_MIN_SAMPLES,
      };
    });
    return { days, since: since.toISOString(), minSamples: VITALS_MIN_SAMPLES, rows };
  }
}
