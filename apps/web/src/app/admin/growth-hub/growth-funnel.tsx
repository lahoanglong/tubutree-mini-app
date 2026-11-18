'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  GROWTH_WINDOW_DAYS,
  type AdminGrowthOverviewDTO,
  type GrowthDailyPoint,
  type GrowthWindowDays,
  type PurchaseFunnelStep,
} from '@tubutree/shared-types';
import { apiFetch } from '@/lib/client-api';
import { formatCount, formatPct, ratioPct } from '@/components/admin/launch-watch-format';
import { chipClass, ListSkeleton, LoadError, ScrollRegion, StatCardsSkeleton } from '@/components/admin/ui';

export const getGrowthOverview = (days: GrowthWindowDays) => apiFetch<AdminGrowthOverviewDTO>(`/admin/growth/overview?days=${days}`);

/** Bốn bước phễu của Trung tâm tăng trưởng; bước "Bấm Đặt hàng" chỉ nằm ở bảng Theo dõi 72h. */
export const GROWTH_FUNNEL_STEPS: ReadonlyArray<{ step: PurchaseFunnelStep; label: string }> = [
  { step: 'product_viewed', label: 'Xem sản phẩm' },
  { step: 'add_or_buy', label: 'Thêm giỏ' },
  { step: 'checkout_started', label: 'Bắt đầu thanh toán' },
  { step: 'order_placed', label: 'Đặt đơn thành công' },
];

const GAME_LABELS: Record<string, string> = {
  sort: 'Đúng Thùng',
  daily_quiz: 'Đố Xanh Mỗi Ngày',
  match: 'Ghép Cặp',
  origin: 'Đoán Xuất Xứ',
  basket: 'Giỏ Đúng Việc',
  matcher: 'Chọn Chuẩn Xanh',
  kitchen_swap: 'Căn Bếp Không Nhựa',
};
export const gameLabel = (game: string): string => GAME_LABELS[game] ?? game;

/** Mỗi bước kèm số phiên và % so với bước liền trước (bước đầu: null). */
export function funnelSteps(funnel: AdminGrowthOverviewDTO['funnel']): Array<{ step: PurchaseFunnelStep; label: string; total: number; pctOfPrev: number | null; pctOfFirst: number | null }> {
  const byStep = new Map(funnel.rows.map((r) => [r.step, r.total]));
  const first = byStep.get('product_viewed') ?? 0;
  return GROWTH_FUNNEL_STEPS.map((s, i) => {
    const total = byStep.get(s.step) ?? 0;
    const prev = i === 0 ? null : byStep.get(GROWTH_FUNNEL_STEPS[i - 1]!.step) ?? 0;
    return { ...s, total, pctOfPrev: prev === null ? null : ratioPct(total, prev), pctOfFirst: ratioPct(total, first) };
  });
}

/** "2026-11-08" → "08/11". */
export const shortDay = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <p className="text-xs text-stone-600">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold tabular-nums text-stone-900">{value}</p>
      <p className="mt-0.5 text-xs leading-snug text-stone-600">{sub}</p>
    </div>
  );
}

function FunnelBars({ steps }: { steps: ReturnType<typeof funnelSteps> }) {
  return (
    <ol aria-label="Phễu theo bước" className="space-y-2">
      {steps.map((s) => {
        const width = s.pctOfFirst === null ? 0 : Math.max(s.total > 0 ? 1 : 0, Math.min(100, s.pctOfFirst));
        return (
          <li key={s.step} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[11rem_1fr_7rem]">
            <span className="text-stone-700">{s.label}</span>
            <span className="relative block h-5 rounded-r bg-stone-100" title={`${s.label}: ${formatCount(s.total)} phiên`}>
              <span className="absolute inset-y-0 left-0 rounded-r bg-forest-600" style={{ width: `${width}%` }} />
            </span>
            <span className="col-start-2 text-xs tabular-nums text-stone-700 sm:col-start-auto sm:text-right sm:text-sm">
              {formatCount(s.total)}
              {s.pctOfPrev !== null && <span className="text-stone-500"> · {formatPct(s.pctOfPrev)}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Cột theo ngày, một chuỗi số; di chuột hay chạm vào cột hiện ngày và số. Bảng số đầy đủ nằm trong "Xem bảng số theo ngày". */
function DailyBars({ title, points, field, unit }: { title: string; points: GrowthDailyPoint[]; field: 'orders' | 'players'; unit: string }) {
  const max = Math.max(0, ...points.map((p) => p[field]));
  const n = points.length;
  const W = 100;
  const H = 40;
  const gap = n > 14 ? 0.6 : 1.2;
  const barW = n > 0 ? (W - gap * (n - 1)) / n : 0;
  const total = points.reduce((s, p) => s + p[field], 0);
  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span className="font-medium text-stone-900">{title}</span>
        <span className="text-xs tabular-nums text-stone-600">
          Tổng {formatCount(total)} · cao nhất {formatCount(max)} {unit}/ngày
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${title}: tổng ${formatCount(total)}, cao nhất ${formatCount(max)} một ngày`} className="mt-2 block h-28 w-full">
        <line x1="0" y1={H - 0.25} x2={W} y2={H - 0.25} className="stroke-stone-300" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => {
          const v = p[field];
          const h = max > 0 ? Math.max(v > 0 ? 1 : 0, (v / max) * (H - 2)) : 0;
          return (
            <g key={p.day}>
              {/* Vùng chạm cao hết khung để cột thấp vẫn di chuột/chạm được. */}
              <rect x={i * (barW + gap)} y={0} width={barW} height={H} className="fill-transparent">
                <title>{`${shortDay(p.day)}: ${formatCount(v)} ${unit}`}</title>
              </rect>
              {h > 0 && <rect x={i * (barW + gap)} y={H - h} width={barW} height={h} rx={Math.min(0.8, barW / 2)} className="pointer-events-none fill-forest-600" />}
            </g>
          );
        })}
      </svg>
      {n > 0 && (
        <div className="mt-1 flex justify-between text-[11px] tabular-nums text-stone-500" aria-hidden="true">
          <span>{shortDay(points[0]!.day)}</span>
          {n > 2 && <span>{shortDay(points[Math.floor((n - 1) / 2)]!.day)}</span>}
          <span>{shortDay(points[n - 1]!.day)}</span>
        </div>
      )}
    </figure>
  );
}

function Overview({ data }: { data: AdminGrowthOverviewDTO }) {
  const steps = funnelSteps(data.funnel);
  const { repeat, games } = data;
  const secondPct = ratioPct(repeat.newBuyersWithSecond, repeat.newBuyers);
  const returningPct = ratioPct(repeat.returningBuyers, repeat.buyers);
  const gamePct = ratioPct(games.buyers, games.players);
  const viewToOrder = steps[3]!.pctOfFirst;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {steps.map((s, i) => (
          <KpiCard
            key={s.step}
            label={s.label}
            value={formatCount(s.total)}
            sub={i === 0 ? `phiên, trên ${formatCount(data.funnel.sessions.total)} phiên` : `phiên, ${formatPct(s.pctOfPrev)} so với bước trước`}
          />
        ))}
        <KpiCard
          label="Quay lại mua lần 2"
          value={formatPct(secondPct)}
          sub={`${formatCount(repeat.newBuyersWithSecond)}/${formatCount(repeat.newBuyers)} khách mua lần đầu trong kỳ đã có đơn thứ hai`}
        />
        <KpiCard
          label="Người chơi game đặt đơn"
          value={formatPct(gamePct)}
          sub={`${formatCount(games.buyers)}/${formatCount(games.players)} người chơi có đơn sau lượt chơi đầu trong kỳ`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="growth-funnel-bars" className="min-w-0">
          <h3 id="growth-funnel-bars" className="text-sm font-semibold text-stone-900">Phễu mua theo phiên</h3>
          <p className="mt-0.5 text-xs text-stone-600">
            Từ xem sản phẩm tới đặt đơn: <strong className="tabular-nums text-stone-900">{formatPct(viewToOrder)}</strong>. Số sau dấu chấm là % so với bước liền trước. Phễu tính theo {data.days}×24 giờ tới lúc này; thẻ số và biểu đồ ngày tính từ 00:00 giờ VN nên có thể lệch nhẹ.
          </p>
          <div className="mt-3">
            <FunnelBars steps={steps} />
          </div>
          <p className="mt-3 text-xs text-stone-600">
            Khách cũ quay lại: {formatCount(repeat.returningBuyers)}/{formatCount(repeat.buyers)} khách đặt đơn trong kỳ đã từng mua trước đó ({formatPct(returningPct)}).
            {data.days === 7 && ' Kỳ 7 ngày còn ngắn, khách mua lần đầu chưa đủ thời gian quay lại; xem kỳ 30 ngày để đánh giá.'}
          </p>
        </section>
        <section aria-labelledby="growth-games" className="min-w-0">
          <h3 id="growth-games" className="text-sm font-semibold text-stone-900">Game dẫn tới đơn</h3>
          {games.byGame.length === 0 ? (
            <p className="mt-2 text-sm text-stone-600">Chưa có ai chơi trong kỳ này.</p>
          ) : (
            <ScrollRegion label="Người chơi và đơn theo game">
              <table className="mt-2 w-full min-w-[320px] text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-stone-500">
                    <th scope="col" className="py-1 pr-2 font-medium">Game</th>
                    <th scope="col" className="px-2 text-right font-medium">Người chơi</th>
                    <th scope="col" className="px-2 text-right font-medium">Đã đặt đơn</th>
                    <th scope="col" className="pl-2 text-right font-medium">Tỷ lệ</th>
                  </tr>
                </thead>
                <tbody>
                  {games.byGame.map((g) => (
                    <tr key={g.game} className="border-t border-stone-200">
                      <th scope="row" className="py-2 pr-2 text-left font-normal text-stone-900">{gameLabel(g.game)}</th>
                      <td className="px-2 text-right">{formatCount(g.players)}</td>
                      <td className="px-2 text-right">{formatCount(g.buyers)}</td>
                      <td className="pl-2 text-right">{formatPct(ratioPct(g.buyers, g.players))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
          <p className="mt-2 text-xs text-stone-600">Người chơi là tài khoản đã nộp một ván game mini hoặc có lượt Chọn Chuẩn Xanh; một người chơi nhiều game được tính ở mỗi game.</p>
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DailyBars title="Đơn thành công mỗi ngày" points={data.daily} field="orders" unit="đơn" />
        <DailyBars title="Người chơi game mỗi ngày" points={data.daily} field="players" unit="người" />
      </div>
      <details className="rounded-card border border-stone-200 p-3">
        <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-medium text-stone-900 sm:min-h-[32px]">Xem bảng số theo ngày</summary>
        <ScrollRegion label="Số theo ngày">
          <table className="mt-2 w-full min-w-[280px] text-sm tabular-nums">
            <thead>
              <tr className="text-left text-stone-500">
                <th scope="col" className="py-1 pr-2 font-medium">Ngày</th>
                <th scope="col" className="px-2 text-right font-medium">Đơn thành công</th>
                <th scope="col" className="pl-2 text-right font-medium">Người chơi game</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((p) => (
                <tr key={p.day} className="border-t border-stone-200">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal text-stone-900">{shortDay(p.day)}</th>
                  <td className="px-2 text-right">{formatCount(p.orders)}</td>
                  <td className="pl-2 text-right">{formatCount(p.players)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </details>
    </div>
  );
}

export function GrowthFunnel() {
  const [days, setDays] = useState<GrowthWindowDays>(7);
  const q = useQuery({ queryKey: ['admin-growth-overview', days], queryFn: () => getGrowthOverview(days) });
  return (
    <section aria-labelledby="growth-funnel-title" className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="growth-funnel-title" className="font-display text-base font-semibold text-stone-900">Phễu chuyển đổi và giữ chân</h2>
        <div role="group" aria-label="Kỳ xem" className="flex gap-1.5">
          {GROWTH_WINDOW_DAYS.map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={chipClass(days === d)}>
              {d} ngày
            </button>
          ))}
        </div>
      </div>
      <p className="mt-0.5 text-xs text-stone-600">
        Số phiên lấy từ sự kiện ẩn danh của web và Mini App (khách bật Do Not Track trên web không được đếm). Đơn bỏ đơn huỷ, trả hàng và chờ thanh toán. Tính lại tối đa mỗi phút.
      </p>
      <div className="mt-3">
        {q.isLoading ? (
          <>
            <StatCardsSkeleton label="Đang tải chỉ số tăng trưởng" count={6} />
            <div className="mt-3"><ListSkeleton label="Đang tải phễu" rows={2} className="h-24" /></div>
          </>
        ) : q.isError || !q.data ? (
          <LoadError message="Không tải được số liệu tăng trưởng." onRetry={() => q.refetch()} retrying={q.isFetching} />
        ) : (
          <Overview data={q.data} />
        )}
      </div>
    </section>
  );
}
